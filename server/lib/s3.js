// s3.js — lazy S3-compatible object storage for the "picture" slot.
//
// The SDK is imported only on first use, so a commit with partial or missing
// S3 env renders "not provisioned" instead of failing to boot. Exactly one
// fixed key is ever written; the writing commit and media type ride along as
// object metadata.
//
// Reads are BOUNDED. The fixed key can also be written by owner tooling, so a
// stored object is not assumed to have come through the 2 MiB PUT route:
// `head()` reports the advertised size without downloading, and `get()` refuses
// an over-limit ContentLength before buffering, with `bodyToBuffer()` enforcing
// the same cap while it reads.

import { MAX_IMAGE_BYTES } from "./image.js";

export const PICTURE_KEY = "picture/current";

export class PictureTooLargeError extends Error {
  constructor(limit = MAX_IMAGE_BYTES) {
    super("stored object exceeds the size limit");
    this.name = "PictureTooLargeError";
    this.limit = limit;
  }
}

function isNotFound(err) {
  const status = err?.$metadata?.httpStatusCode;
  const name = err?.name || err?.Code;
  return status === 404 || name === "NoSuchKey" || name === "NotFound";
}

/**
 * Buffer an SDK response body, refusing to grow past `maxBytes`. The async
 * iterable path checks each chunk as it arrives; the `transformToByteArray`
 * path can only check the assembled result, so callers should also check the
 * advertised ContentLength first (as `get()` does).
 */
export async function bodyToBuffer(body, maxBytes = MAX_IMAGE_BYTES) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") {
    const bytes = Buffer.from(await body.transformToByteArray());
    if (bytes.length > maxBytes) throw new PictureTooLargeError(maxBytes);
    return bytes;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new PictureTooLargeError(maxBytes);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function defaultClient(cfg) {
  const m = await import("@aws-sdk/client-s3");
  return new m.S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

const defaultCommands = () => import("@aws-sdk/client-s3");

/**
 * Build the picture store. `deps` lets tests inject narrow collaborators:
 *  • `client`     — an object with `send(command)`, replacing the real S3Client
 *  • `getCommands`— async () => { GetObjectCommand, HeadObjectCommand, PutObjectCommand }
 *  • `maxBytes`   — override the read/body cap
 */
export function createPictureStore(cfg = null, deps = {}) {
  if (!cfg) return null;

  const maxBytes = deps.maxBytes ?? MAX_IMAGE_BYTES;
  const getCommands = deps.getCommands || defaultCommands;

  let clientPromise = null;
  async function client() {
    if (deps.client) return deps.client;
    if (!clientPromise) clientPromise = defaultClient(cfg);
    return clientPromise;
  }

  let commandsPromise = null;
  async function commands() {
    if (!commandsPromise) commandsPromise = getCommands();
    return commandsPromise;
  }

  async function head() {
    const { HeadObjectCommand } = await commands();
    const c = await client();
    try {
      const out = await c.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: PICTURE_KEY }));
      return {
        contentType: out.ContentType || "",
        metadata: out.Metadata || {},
        bytes: typeof out.ContentLength === "number" ? out.ContentLength : null,
        lastModified: out.LastModified instanceof Date ? out.LastModified.toISOString() : null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function get() {
    const { GetObjectCommand } = await commands();
    const c = await client();
    let out;
    try {
      out = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: PICTURE_KEY }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    // Refuse an advertised over-limit object before buffering any bytes.
    if (typeof out.ContentLength === "number" && out.ContentLength > maxBytes) {
      throw new PictureTooLargeError(maxBytes);
    }
    const bytes = await bodyToBuffer(out.Body, maxBytes);
    return {
      bytes,
      contentType: out.ContentType || "",
      metadata: out.Metadata || {},
      lastModified: out.LastModified instanceof Date ? out.LastModified.toISOString() : null,
    };
  }

  async function put(bytes, { contentType, commit, shortSha }) {
    const { PutObjectCommand } = await commands();
    const c = await client();
    await c.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: PICTURE_KEY,
        Body: bytes,
        ContentType: contentType,
        Metadata: {
          "shafox-commit": commit,
          "shafox-short-sha": shortSha,
          "shafox-media-type": contentType,
        },
      })
    );
    return { key: PICTURE_KEY, bytes: bytes.length, contentType, commit, shortSha };
  }

  return { provisioned: true, maxBytes, head, get, put };
}
