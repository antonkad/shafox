import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createPictureStore, bodyToBuffer, PictureTooLargeError, PICTURE_KEY } from "../server/lib/s3.js";
import { MAX_IMAGE_BYTES } from "../server/lib/image.js";

class Cmd {
  constructor(input) {
    this.input = input;
  }
}
class GetObjectCommand extends Cmd {}
class HeadObjectCommand extends Cmd {}
class PutObjectCommand extends Cmd {}
const commands = { GetObjectCommand, HeadObjectCommand, PutObjectCommand };

function storeWith(handler) {
  const sent = [];
  const client = {
    async send(cmd) {
      sent.push(cmd);
      return handler(cmd);
    },
  };
  const store = createPictureStore(
    { bucket: "b", endpoint: "e", region: "r", forcePathStyle: true, accessKeyId: "a", secretAccessKey: "s" },
    { client, getCommands: async () => commands }
  );
  return { store, sent };
}

test("put always writes the one fixed key with the commit metadata contract", async () => {
  const { store, sent } = storeWith(async () => ({}));
  const bytes = Buffer.from([1, 2, 3]);
  const out = await store.put(bytes, { contentType: "image/png", commit: "FULL", shortSha: "short" });

  const cmd = sent[0];
  assert.ok(cmd instanceof PutObjectCommand);
  assert.equal(cmd.input.Key, PICTURE_KEY);
  assert.equal(cmd.input.Body, bytes);
  assert.equal(cmd.input.ContentType, "image/png");
  assert.deepEqual(cmd.input.Metadata, {
    "shafox-commit": "FULL",
    "shafox-short-sha": "short",
    "shafox-media-type": "image/png",
  });
  assert.deepEqual(out, {
    key: PICTURE_KEY,
    bytes: 3,
    contentType: "image/png",
    commit: "FULL",
    shortSha: "short",
  });
});

test("head uses HeadObject and reports metadata without a body", async () => {
  const { store, sent } = storeWith(async () => ({
    ContentType: "image/webp",
    ContentLength: 123,
    Metadata: { "shafox-commit": "FULL", "shafox-short-sha": "short", "shafox-media-type": "image/webp" },
    LastModified: new Date("2026-01-02T03:04:05Z"),
  }));

  const head = await store.head();
  assert.ok(sent[0] instanceof HeadObjectCommand);
  assert.equal(sent[0].input.Key, PICTURE_KEY);
  assert.equal(head.bytes, 123);
  assert.equal(head.contentType, "image/webp");
  assert.equal(head.metadata["shafox-short-sha"], "short");
  assert.equal(head.lastModified, "2026-01-02T03:04:05.000Z");
});

test("head returns null for a missing object", async () => {
  const { store } = storeWith(async () => {
    const err = new Error("nope");
    err.name = "NoSuchKey";
    throw err;
  });
  assert.equal(await store.head(), null);
});

test("get refuses an advertised over-limit object before reading the body", async () => {
  let bodyRead = false;
  const { store } = storeWith(async () => ({
    ContentLength: MAX_IMAGE_BYTES + 1,
    Body: {
      transformToByteArray: async () => {
        bodyRead = true;
        return Buffer.alloc(0);
      },
    },
  }));

  await assert.rejects(store.get(), (err) => err instanceof PictureTooLargeError);
  assert.equal(bodyRead, false);
});

test("get returns null for a missing object", async () => {
  const { store } = storeWith(async () => {
    const err = new Error("nope");
    err.name = "NoSuchKey";
    throw err;
  });
  assert.equal(await store.get(), null);
});

test("bodyToBuffer enforces the cap while streaming", async () => {
  const body = Readable.from([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]);
  await assert.rejects(bodyToBuffer(body, 16), (err) => err instanceof PictureTooLargeError);
});

test("bodyToBuffer returns bytes under the cap", async () => {
  const body = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
  assert.equal((await bodyToBuffer(body, 16)).toString(), "abcd");
});
