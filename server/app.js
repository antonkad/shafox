// app.js — the request router.
//
// Kept in one place (rather than a framework) so the whole API is legible. The
// only external state is what the request handler closes over: the guestbook
// file, and the two managed backends (Postgres rows, S3 picture) which are
// null when not provisioned.

import { existsSync, createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";

import { createGuestbook, MAX_NAME } from "./lib/guestbook.js";
import { createRowsStore } from "./lib/postgres.js";
import { createPictureStore, PictureTooLargeError } from "./lib/s3.js";
import { sniffImage, MAX_IMAGE_BYTES } from "./lib/image.js";
import { jsAttr } from "./lib/inline.js";
import {
  BodyTooLargeError,
  RateLimiter,
  clientKey,
  effectiveHost,
  originAllowed,
  readBody,
  sendJSON,
} from "./lib/http.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
};

const ROW_BODY_LIMIT = 1024; // "Add a row" carries no visitor data
const MARK_BODY_LIMIT = 4096; // unchanged guestbook limit
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ROW_WRITE_LIMIT = 10;
const PICTURE_WRITE_LIMIT = 3;
const MARK_WRITE_LIMIT = 10; // guestbook text is arbitrary public input too

// A URL path is attacker-controlled. Decode it once (a single decode is the
// server's contract; double-encoded text stays literal) and turn malformed
// percent-encoding into a bounded client error instead of an uncaught throw.
function decodeStaticRel(rawUrl) {
  try {
    return decodeURIComponent((rawUrl || "/").split("?")[0]);
  } catch {
    return null;
  }
}

// Confine a decoded URL path to `dir` segment-safely. A plain
// `path.startsWith(dir)` also accepts siblings such as `dist-secret`, so
// compare on path segments: the target must be `dir` itself or a descendant.
function confineToDir(dir, rel) {
  const root = normalize(dir);
  const target = normalize(join(root, rel));
  if (target === root || target.startsWith(root + sep)) return target;
  return null;
}

export function createApp(config) {
  const identity = config.identity;
  const guestbook = createGuestbook({ dir: config.dataDir, file: config.guestbookPath, identity });
  // Stores may be injected wholesale (tests) or built from narrow deps.
  const rows =
    config.rowsStore !== undefined ? config.rowsStore : createRowsStore(config.postgres, config.rowsDeps);
  const pictures =
    config.pictureStore !== undefined ? config.pictureStore : createPictureStore(config.s3, config.pictureDeps);

  // Limits default to the production values; tests may inject smaller ones.
  const pictureLimit = config.limits?.pictureBytes ?? MAX_IMAGE_BYTES;
  const rowLimit = config.limits?.rowBytes ?? ROW_BODY_LIMIT;
  const markLimit = config.limits?.markBytes ?? MARK_BODY_LIMIT;

  const rowWrites = new RateLimiter({ limit: ROW_WRITE_LIMIT, windowMs: RATE_WINDOW_MS });
  const pictureWrites = new RateLimiter({ limit: PICTURE_WRITE_LIMIT, windowMs: RATE_WINDOW_MS });
  const markWrites = new RateLimiter({ limit: MARK_WRITE_LIMIT, windowMs: RATE_WINDOW_MS });

  guestbook.ensureDir().catch(() => {});

  function refuseCrossOrigin(req, res) {
    if (originAllowed(req.headers.origin, effectiveHost(req))) return false;
    sendJSON(res, 403, { error: "cross-origin request refused" });
    return true;
  }

  function refuseRateLimited(req, res, limiter, label) {
    const verdict = limiter.check(clientKey(req));
    if (verdict.allowed) return false;
    sendJSON(
      res,
      429,
      { error: `rate limit reached (${label})`, retryAfterSeconds: verdict.retryAfterSeconds },
      { "retry-after": String(verdict.retryAfterSeconds) }
    );
    return true;
  }

  function bodyTooLarge(res, req, message) {
    sendJSON(res, 413, { error: message });
    // Drain whatever is in flight so the response can flush, then drop the
    // connection: we never process more than the cap.
    req.on("error", () => {});
    req.resume();
    res.on("finish", () => req.destroy());
  }

  async function sendIndex(res) {
    const index = join(config.distDir, "index.html");
    if (!existsSync(index)) {
      res.writeHead(404).end("not found");
      return;
    }
    let html = await readFile(index, "utf8");
    html = html
      .replace("%%COMMIT%%", jsAttr(identity.commit))
      .replace("%%REF%%", jsAttr(identity.ref))
      .replace("%%BUILDTIME%%", jsAttr(identity.buildTime));
    res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
    res.end(html);
  }

  function serveStatic(req, res) {
    const rel = decodeStaticRel(req.url || "/");
    if (rel === null) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      return res.end("bad request");
    }
    if (rel === "/" || rel === "/index.html") return sendIndex(res);
    const path = confineToDir(config.distDir, rel);
    if (!path) {
      res.writeHead(403).end("forbidden");
      return;
    }
    // Only regular files are streamed. A missing path, a directory (which would
    // otherwise raise an uncaught EISDIR from the read stream), or a stat error
    // falls back to the SPA index — a bounded response, never a crash.
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return sendIndex(res);
    }
    if (!stat.isFile()) return sendIndex(res);
    const type = MIME[extname(path)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    createReadStream(path).pipe(res);
  }

  async function handleInfo(res) {
    const info = await guestbook.info();
    sendJSON(res, 200, { ...info, backends: { postgres: !!rows, s3: !!pictures } });
  }

  async function handleMarksPost(req, res) {
    if (refuseCrossOrigin(req, res)) return;
    if (refuseRateLimited(req, res, markWrites, "guestbook writes")) return;
    let raw;
    try {
      raw = (await readBody(req, markLimit)).toString("utf8");
    } catch (err) {
      if (err instanceof BodyTooLargeError) return bodyTooLarge(res, req, "body too large");
      throw err;
    }
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return sendJSON(res, 400, { error: "bad json" });
    }
    const name = String(payload.name || "").trim().slice(0, MAX_NAME);
    const emoji = String(payload.emoji || "🦊").trim().slice(0, 8) || "🦊";
    if (!name) return sendJSON(res, 400, { error: "name required" });

    try {
      const marks = await guestbook.add(name, emoji);
      return sendJSON(res, 200, { ok: true, marks, info: await guestbook.info() });
    } catch (err) {
      return sendJSON(res, 500, { error: `storage write failed: ${err?.code || "unknown"}` });
    }
  }

  async function handleRowsGet(res) {
    if (!rows) return sendJSON(res, 200, { provisioned: false, rows: [] });
    try {
      const list = await rows.list();
      return sendJSON(res, 200, { provisioned: true, rows: list, count: list.length });
    } catch {
      return sendJSON(res, 502, { provisioned: true, rows: [], error: "rows backend unavailable" });
    }
  }

  async function handleRowsPost(req, res) {
    if (refuseCrossOrigin(req, res)) return;
    if (refuseRateLimited(req, res, rowWrites, "row writes")) return;

    try {
      await readBody(req, rowLimit); // drained and ignored: no visitor data
    } catch (err) {
      if (err instanceof BodyTooLargeError) return bodyTooLarge(res, req, "body too large");
      throw err;
    }

    if (!rows) return sendJSON(res, 503, { error: "rows backend not provisioned" });
    try {
      const { row, rows: list } = await rows.add({ commit: identity.commit, shortSha: identity.shortSha });
      return sendJSON(res, 200, { ok: true, row, rows: list });
    } catch {
      return sendJSON(res, 502, { error: "rows write failed" });
    }
  }

  async function handlePictureMeta(res) {
    if (!pictures) return sendJSON(res, 200, { provisioned: false, present: false });
    try {
      // Metadata only: never download the object just to describe it.
      const obj = await pictures.head();
      if (!obj) return sendJSON(res, 200, { provisioned: true, present: false });
      const mediaType = obj.metadata["shafox-media-type"] || obj.contentType || "";
      return sendJSON(res, 200, {
        provisioned: true,
        present: true,
        contentType: obj.contentType || mediaType,
        mediaType,
        commit: obj.metadata["shafox-commit"] || "",
        shortSha: obj.metadata["shafox-short-sha"] || "",
        bytes: typeof obj.bytes === "number" ? obj.bytes : undefined,
        updatedAt: obj.lastModified,
      });
    } catch {
      return sendJSON(res, 502, { provisioned: true, present: false, error: "picture backend unavailable" });
    }
  }

  async function handlePictureGet(res) {
    if (!pictures) return sendJSON(res, 404, { error: "picture not provisioned" });
    let obj;
    try {
      obj = await pictures.get();
    } catch (err) {
      // A fixed key can be written by owner tooling too, so a stored object may
      // exceed the 2 MiB upload cap. Refuse it as a bounded app error rather
      // than buffering it, and never surface SDK details.
      if (err instanceof PictureTooLargeError) {
        return sendJSON(res, 413, { error: "stored picture exceeds the 2 MiB limit" });
      }
      return sendJSON(res, 502, { error: "picture backend unavailable" });
    }
    if (!obj) return sendJSON(res, 404, { error: "no picture" });
    const sniff = sniffImage(obj.bytes);
    if (!sniff) return sendJSON(res, 502, { error: "stored object is not a raster image" });
    res.writeHead(200, {
      "content-type": sniff.type,
      "content-length": String(obj.bytes.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(obj.bytes);
  }

  async function handlePicturePut(req, res) {
    if (refuseCrossOrigin(req, res)) return;
    if (refuseRateLimited(req, res, pictureWrites, "picture writes")) return;

    let body;
    try {
      body = await readBody(req, pictureLimit);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return bodyTooLarge(res, req, "image exceeds the 2 MiB limit");
      throw err;
    }
    if (!body.length) return sendJSON(res, 400, { error: "empty body" });

    const sniff = sniffImage(body);
    if (!sniff) {
      return sendJSON(res, 415, { error: "only JPEG, PNG or WebP raster images are accepted" });
    }
    if (!pictures) return sendJSON(res, 503, { error: "picture backend not provisioned" });

    try {
      const out = await pictures.put(body, {
        contentType: sniff.type,
        commit: identity.commit,
        shortSha: identity.shortSha,
      });
      return sendJSON(res, 200, { ok: true, ...out });
    } catch {
      return sendJSON(res, 502, { error: "picture write failed" });
    }
  }

  return async function handle(req, res) {
    const url = (req.url || "/").split("?")[0];
    const method = req.method || "GET";
    try {
      if (url === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("ok");
      }
      if (url === "/api/info" && method === "GET") return await handleInfo(res);
      if (url === "/api/marks" && method === "GET") return sendJSON(res, 200, await guestbook.readMarks());
      if (url === "/api/marks" && method === "POST") return await handleMarksPost(req, res);
      if (url === "/api/rows" && method === "GET") return await handleRowsGet(res);
      if (url === "/api/rows" && method === "POST") return await handleRowsPost(req, res);
      if (url === "/api/picture/meta" && method === "GET") return await handlePictureMeta(res);
      if (url === "/api/picture" && method === "GET") return await handlePictureGet(res);
      if (url === "/api/picture" && method === "PUT") return await handlePicturePut(req, res);

      if (url.startsWith("/api/")) return sendJSON(res, 404, { error: "not found" });
      return serveStatic(req, res);
    } catch (err) {
      // Never leak a DSN, credential or stack to the client.
      console.error(`[shafox] request error: ${err?.name || "Error"}${err?.code ? ` (${err.code})` : ""}`);
      if (res.headersSent) {
        try {
          res.destroy();
        } catch {
          /* already gone */
        }
        return;
      }
      return sendJSON(res, 500, { error: "internal error" });
    }
  };
}
