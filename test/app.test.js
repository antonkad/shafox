import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../server/app.js";
import { PictureTooLargeError } from "../server/lib/s3.js";

const COMMIT = "abc1234def5678abc1234def5678abc1234def56";
const SHORT = "abc1234";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const SVG = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
const NOT_AN_IMAGE = Buffer.from("hello, definitely not an image");

function baseConfig(dir, overrides = {}) {
  return {
    dataDir: dir,
    guestbookPath: join(dir, "guestbook.json"),
    distDir: join(dir, "dist"), // absent on purpose; /api tests never need it
    identity: { commit: COMMIT, shortSha: SHORT, ref: "test", buildTime: "" },
    postgres: null,
    s3: null,
    ...overrides,
  };
}

async function withServer(overrides, fn) {
  const dir = await mkdtemp(join(tmpdir(), "shafox-test-"));
  const server = createServer(createApp(baseConfig(dir, overrides)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, dir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

const json = async (r) => ({ status: r.status, body: await r.json() });

// Send a raw request target verbatim. `fetch`/WHATWG URL normalizes dot
// segments (including %2e) before the bytes leave the client, so traversal
// regression tests must bypass it and drive the server's raw `req.url`.
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, method: "GET", path: rawPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ---- backend-missing is normal --------------------------------------------

test("missing backends render as not provisioned, not a crash", async () => {
  await withServer({}, async (base) => {
    const rows = await json(await fetch(`${base}/api/rows`));
    assert.equal(rows.status, 200);
    assert.deepEqual(rows.body, { provisioned: false, rows: [] });

    const meta = await json(await fetch(`${base}/api/picture/meta`));
    assert.equal(meta.status, 200);
    assert.deepEqual(meta.body, { provisioned: false, present: false });

    const picture = await json(await fetch(`${base}/api/picture`));
    assert.equal(picture.status, 404);

    const addRow = await json(await fetch(`${base}/api/rows`, { method: "POST" }));
    assert.equal(addRow.status, 503);

    const put = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: PNG }));
    assert.equal(put.status, 503);

    const info = await json(await fetch(`${base}/api/info`));
    assert.equal(info.status, 200);
    assert.deepEqual(info.body.backends, { postgres: false, s3: false });
    assert.equal(info.body.commit, COMMIT);
  });
});

// ---- guestbook keeps working ----------------------------------------------

test("guestbook still signs and reports the writing commit", async () => {
  await withServer({}, async (base) => {
    const post = await json(
      await fetch(`${base}/api/marks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      })
    );
    assert.equal(post.status, 200);
    assert.equal(post.body.ok, true);
    assert.equal(post.body.marks.length, 1);
    assert.equal(post.body.marks[0].commit, COMMIT);
    assert.equal(post.body.marks[0].shortSha, SHORT);

    const list = await json(await fetch(`${base}/api/marks`));
    assert.equal(list.body.length, 1);

    const info = await json(await fetch(`${base}/api/info`));
    assert.equal(info.body.count, 1);
    assert.equal(info.body.fileExists, true);
  });
});

test("guestbook body limit is enforced", async () => {
  await withServer({ limits: { markBytes: 16 } }, async (base) => {
    const r = await fetch(`${base}/api/marks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "a-name-that-is-longer-than-sixteen-bytes" }),
    });
    assert.equal(r.status, 413);
  });
});

// ---- origin guard ---------------------------------------------------------

test("cross-origin browser mutations are refused", async () => {
  await withServer({}, async (base) => {
    const origin = "https://evil.test";
    const marks = await json(
      await fetch(`${base}/api/marks`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ name: "Mallory" }),
      })
    );
    assert.equal(marks.status, 403);

    const rows = await json(await fetch(`${base}/api/rows`, { method: "POST", headers: { origin } }));
    assert.equal(rows.status, 403);

    const picture = await json(await fetch(`${base}/api/picture`, { method: "PUT", headers: { origin }, body: PNG }));
    assert.equal(picture.status, 403);
  });
});

test("same-origin mutations proceed and requests without Origin are allowed", async () => {
  await withServer({}, async (base) => {
    const sameOrigin = await json(
      await fetch(`${base}/api/marks`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ name: "Grace" }),
      })
    );
    assert.equal(sameOrigin.status, 200);

    const noOrigin = await json(await fetch(`${base}/api/rows`, { method: "POST" }));
    assert.equal(noOrigin.status, 503); // reached the handler, refused only by the missing backend
  });
});

// ---- image sniffing at the API boundary -----------------------------------

test("picture PUT rejects SVG and unknown bytes regardless of backend", async () => {
  await withServer({}, async (base) => {
    const svg = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: SVG }));
    assert.equal(svg.status, 415);

    const unknown = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: NOT_AN_IMAGE }));
    assert.equal(unknown.status, 415);

    const empty = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: Buffer.alloc(0) }));
    assert.equal(empty.status, 400);
  });
});

test("picture PUT enforces the body cap", async () => {
  await withServer({ limits: { pictureBytes: 32 } }, async (base) => {
    const r = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: Buffer.alloc(64, 1) }));
    assert.equal(r.status, 413);
  });
});

// ---- rate limits ----------------------------------------------------------

test("row writes are capped at 10 per window", async () => {
  await withServer({}, async (base) => {
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/api/rows`, { method: "POST" });
      assert.equal(r.status, 503);
    }
    const blocked = await json(await fetch(`${base}/api/rows`, { method: "POST" }));
    assert.equal(blocked.status, 429);
    assert.ok(blocked.body.retryAfterSeconds >= 1);
  });
});

test("picture writes are capped at 3 per window", async () => {
  await withServer({}, async (base) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${base}/api/picture`, { method: "PUT", body: PNG });
      assert.equal(r.status, 503);
    }
    const blocked = await json(await fetch(`${base}/api/picture`, { method: "PUT", body: PNG }));
    assert.equal(blocked.status, 429);
  });
});

test("guestbook writes are capped at 10 per window", async () => {
  await withServer({}, async (base) => {
    const post = (name) =>
      fetch(`${base}/api/marks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    for (let i = 0; i < 10; i++) {
      assert.equal((await post(`name-${i}`)).status, 200);
    }
    const blocked = await json(await post("one-too-many"));
    assert.equal(blocked.status, 429);
    assert.ok(blocked.body.retryAfterSeconds >= 1);
  });
});

// ---- picture store integration (injected store) ---------------------------

test("picture meta describes the object via head() without downloading it", async () => {
  let headCalls = 0;
  const pictureStore = {
    provisioned: true,
    async head() {
      headCalls++;
      return {
        contentType: "image/png",
        metadata: {
          "shafox-commit": COMMIT,
          "shafox-short-sha": SHORT,
          "shafox-media-type": "image/png",
        },
        bytes: 42,
        lastModified: "2026-01-02T03:04:05.000Z",
      };
    },
    async get() {
      throw new Error("meta must not download the object");
    },
    async put() {
      throw new Error("not used");
    },
  };

  await withServer({ pictureStore }, async (base) => {
    const meta = await json(await fetch(`${base}/api/picture/meta`));
    assert.equal(meta.status, 200);
    assert.equal(meta.body.provisioned, true);
    assert.equal(meta.body.present, true);
    assert.equal(meta.body.bytes, 42);
    assert.equal(meta.body.mediaType, "image/png");
    assert.equal(meta.body.commit, COMMIT);
    assert.equal(meta.body.shortSha, SHORT);
    assert.equal(headCalls, 1);
  });
});

test("picture GET maps an over-limit stored object to a bounded 413", async () => {
  const pictureStore = {
    provisioned: true,
    async head() {
      return null;
    },
    async get() {
      throw new PictureTooLargeError();
    },
    async put() {
      throw new Error("not used");
    },
  };

  await withServer({ pictureStore }, async (base) => {
    const r = await json(await fetch(`${base}/api/picture`));
    assert.equal(r.status, 413);
    assert.match(r.body.error, /2 MiB/);
    assert.equal(r.body.error.includes("Error"), false);
  });
});

// ---- runtime identity injection -------------------------------------------

test("runtime identity is injected as JSON-safe inline script content", async () => {
  const nastyRef = "feat</script>\u2028\u2029<ok>";
  await withServer({ identity: { commit: COMMIT, shortSha: SHORT, ref: nastyRef, buildTime: "" } }, async (base, dir) => {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "dist", "index.html"),
      `<script>window.__SHAFOX__ = { commit: "%%COMMIT%%", ref: "%%REF%%", buildTime: "%%BUILDTIME%%" };</script>`
    );

    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.equal(html.includes("</script>\u2028"), false);
    assert.equal(html.includes("\u2028"), false);
    assert.equal(html.includes("\u2029"), false);
    assert.equal(html.includes("<ok>"), false);

    const match = html.match(/ref: "([^"]*)"/);
    assert.ok(match, "ref value should be present");
    assert.equal(JSON.parse(`"${match[1]}"`), nastyRef);
  });
});

// ---- static serving confinement -------------------------------------------

async function withStaticTree(overrides, fn) {
  return withServer(overrides, async (base, dir) => {
    await mkdir(join(dir, "dist", "sub"), { recursive: true });
    await writeFile(join(dir, "dist", "index.html"), "<!doctype html><title>index</title>");
    await writeFile(join(dir, "dist", "asset.txt"), "asset");
    await writeFile(join(dir, "dist", "sub", "nested.txt"), "nested");
    await mkdir(join(dir, "dist-secret"), { recursive: true });
    await writeFile(join(dir, "dist-secret", "secret.txt"), "TOP SECRET");
    return fn(base, dir);
  });
}

test("static serving returns real files inside distDir", async () => {
  await withStaticTree({}, async (base) => {
    const asset = await rawGet(base, "/asset.txt");
    assert.equal(asset.status, 200);
    assert.equal(asset.body, "asset");

    const nested = await rawGet(base, "/sub/nested.txt");
    assert.equal(nested.status, 200);
    assert.equal(nested.body, "nested");
  });
});

test("static serving refuses traversal out of distDir, including encoded forms", async () => {
  await withStaticTree({}, async (base) => {
    const targets = [
      "/%2e%2e/dist-secret/secret.txt",
      "/..%2fdist-secret%2fsecret.txt",
      "/../dist-secret/secret.txt",
      "/sub/%2e%2e/%2e%2e/dist-secret/secret.txt",
    ];
    for (const target of targets) {
      const r = await rawGet(base, target);
      assert.equal(r.status, 403, `${target} should be forbidden`);
      assert.equal(r.body.includes("TOP SECRET"), false, `${target} must not leak the sibling`);
    }
  });
});

test("static serving falls back to the SPA index for missing files", async () => {
  await withStaticTree({}, async (base) => {
    const r = await rawGet(base, "/no/such/file.txt");
    assert.equal(r.status, 200);
    assert.match(r.body, /index/);
  });
});

test("a directory path is a bounded SPA fallback, not an uncaught stream error", async () => {
  await withStaticTree({}, async (base) => {
    const dir = await rawGet(base, "/sub");
    assert.equal(dir.status, 200);
    assert.match(dir.body, /index/);
  });
});

test("malformed percent-encoding is a bounded 400, not a crash or leak", async () => {
  await withStaticTree({}, async (base) => {
    for (const target of ["/%", "/%zz", "/%E0%A4%A", "/%c0%af"]) {
      const r = await rawGet(base, target);
      assert.equal(r.status, 400, `${target} should be a bounded 400`);
      assert.equal(r.body, "bad request");
      assert.equal(/URIError|at Object|node:internal/.test(r.body), false);
    }
  });
});

// ---- misc -----------------------------------------------------------------

test("unknown API paths are bounded JSON 404s", async () => {
  await withServer({}, async (base) => {
    const r = await json(await fetch(`${base}/api/nope`));
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "not found");
  });
});
