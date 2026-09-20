// guestbook.js — the JSON-file guestbook on the mounted app disk.
//
// Kept intact (same file, same limits, same API) as the small "disk proof"
// that a writable mounted disk really exists. It is intentionally NOT the
// primary panel any more.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

export const MAX_ENTRIES = 200;
export const MAX_NAME = 40;

export function createGuestbook({ dir, file, identity }) {
  async function ensureDir() {
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      /* may already exist or be read-only; reads still work */
    }
  }

  async function readMarks() {
    try {
      const raw = await readFile(file, "utf8");
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
      const s = await stat(file);
      fileExists = true;
      mtime = s.mtimeMs;
    } catch {
      /* no file yet */
    }
    const marks = await readMarks();
    const foreign = marks.filter((m) => m.commit && m.commit !== identity.commit).length;
    return {
      commit: identity.commit,
      shortSha: identity.shortSha,
      dataDir: dir,
      fileExists,
      mtime,
      count: marks.length,
      seededCount: foreign, // entries written by OTHER commits == migrated/seeded data
    };
  }

  async function add(name, emoji) {
    await ensureDir();
    const marks = await readMarks();
    marks.push({ name, emoji, commit: identity.commit, shortSha: identity.shortSha, ts: Date.now() });
    const trimmed = marks.slice(-MAX_ENTRIES);
    await writeFile(file, JSON.stringify(trimmed, null, 2));
    return trimmed;
  }

  return { ensureDir, readMarks, info, add };
}
