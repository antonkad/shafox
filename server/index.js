// Shafox server — a tiny zero-dependency Node HTTP server.
//
// Its only jobs: serve the static Vite build, and read/write a single JSON
// file inside the MOUNTED STORAGE volume. That file is what makes the
// per-commit storage story real:
//
//   • Each commit deploys with its own PVC subPath (commits/<sha>/) on kad.dev,
//     so the guestbook below is ISOLATED per commit — a forked commit starts
//     with an empty folder.
//   • Turn on "seed previews from canonical" and kad.dev copies the canonical
//     commit's folder into the new one at boot — the guestbook is MIGRATED, and
//     each entry remembers which commit wrote it.
//   • Roll back to an older commit and its folder (and guestbook) is still
//     there, untouched.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { execSync } from "node:child_process";
import { join, normalize, extname } from "node:path";

const PORT = Number(process.env.PORT || 8080);

// DATA_DIR is the mounted storage volume on kad.dev (chart `storage.mountPath`).
// Locally it falls back to ./.data so the app runs without a cluster.
const DATA_DIR =
  process.env.DATA_DIR || process.env.STORAGE_PATH || (process.env.NODE_ENV === "production" ? "/data" : "./.data");
const GUESTBOOK = join(DATA_DIR, "guestbook.json");
const MAX_ENTRIES = 200;
const MAX_NAME = 40;

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const COMMIT =
  process.env.SHAFOX_COMMIT ||
  process.env.COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  process.env.BUILD_COMMIT_SHA || // kad.dev sets this on the pod (short hash)
  gitHead() ||
  "devfox0000000000000000000000000000000000";
const SHORT = (COMMIT.match(/[0-9a-f]/gi)?.join("") || COMMIT).slice(0, 7);
const REF =
  process.env.SHAFOX_REF ||
  process.env.GIT_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  process.env.CI_COMMIT_REF_NAME ||
  "";
const BUILD_TIME = process.env.SHAFOX_BUILD_TIME || "";

const DIST = join(process.cwd(), "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function ensureDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {
    /* may already exist or be read-only; reads still work */
  }
}

async function readMarks() {
  try {
    const raw = await readFile(GUESTBOOK, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function info() {
  let fileExists = false;
  let mtime = null;
  try {
    const s = await stat(GUESTBOOK);
    fileExists = true;
    mtime = s.mtimeMs;
  } catch {
    /* no file yet */
  }
  const marks = await readMarks();
  const foreign = marks.filter((m) => m.commit && m.commit !== COMMIT).length;
  return {
    commit: COMMIT,
    shortSha: SHORT,
    dataDir: DATA_DIR,
    fileExists,
    mtime,
    count: marks.length,
    seededCount: foreign, // entries written by OTHER commits == migrated/seeded data
  };
}

function sendJSON(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 4096) req.destroy(); // hard cap
    });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}

function jsAttr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Serve index.html with the runtime identity injected, so the page reflects the
// commit kad.dev actually deployed (BUILD_COMMIT_SHA) instead of whatever the
// build environment baked in.
async function sendIndex(res) {
  const index = join(DIST, "index.html");
  if (!existsSync(index)) {
    res.writeHead(404).end("not found");
    return;
  }
  let html = await readFile(index, "utf8");
  html = html
    .replace("%%COMMIT%%", jsAttr(COMMIT))
    .replace("%%REF%%", jsAttr(REF))
    .replace("%%BUILDTIME%%", jsAttr(BUILD_TIME));
  res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
  res.end(html);
}

async function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/" || rel === "/index.html") return sendIndex(res);
  const path = normalize(join(DIST, rel));
  if (!path.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(path)) {
    return sendIndex(res); // SPA fallback
  }
  const type = MIME[extname(path)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/api/info" && req.method === "GET") {
    return sendJSON(res, 200, await info());
  }

  if (url === "/api/marks" && req.method === "GET") {
    return sendJSON(res, 200, await readMarks());
  }

  if (url === "/api/marks" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return sendJSON(res, 400, { error: "bad json" });
    }
    const name = String(payload.name || "").trim().slice(0, MAX_NAME);
    const emoji = String(payload.emoji || "🦊").trim().slice(0, 8) || "🦊";
    if (!name) return sendJSON(res, 400, { error: "name required" });

    await ensureDir();
    const marks = await readMarks();
    marks.push({ name, emoji, commit: COMMIT, shortSha: SHORT, ts: Date.now() });
    const trimmed = marks.slice(-MAX_ENTRIES);
    try {
      await writeFile(GUESTBOOK, JSON.stringify(trimmed, null, 2));
    } catch (e) {
      return sendJSON(res, 500, { error: "storage write failed: " + (e?.code || "unknown") });
    }
    return sendJSON(res, 200, { ok: true, marks: trimmed, info: await info() });
  }

  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  return serveStatic(req, res);
});

await ensureDir();
server.listen(PORT, () => {
  console.log(`[shafox] commit ${SHORT} · serving dist + /api · data dir ${DATA_DIR} · port ${PORT}`);
});
