// api.ts — thin client for the server-side storage API.
//
// Everything here reflects state held on the MOUNTED PVC volume (per-commit
// subPath on kad.dev), not the browser. That's the whole point of the storage
// demo: the guestbook lives on disk, isolated per commit, and migrated by the
// seed toggle.

export interface Mark {
  name: string;
  emoji: string;
  commit: string;
  shortSha: string;
  ts: number;
}

export interface StorageInfo {
  commit: string;
  shortSha: string;
  dataDir: string;
  fileExists: boolean;
  mtime: number | null;
  count: number;
  seededCount: number; // entries written by OTHER commits == migrated data
}

export async function getInfo(): Promise<StorageInfo | null> {
  try {
    const r = await fetch("/api/info", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as StorageInfo;
  } catch {
    return null;
  }
}

export async function getMarks(): Promise<Mark[]> {
  try {
    const r = await fetch("/api/marks", { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()) as Mark[];
  } catch {
    return [];
  }
}

export interface PostResult {
  ok: boolean;
  marks?: Mark[];
  info?: StorageInfo;
  error?: string;
}

export async function addMark(name: string, emoji: string): Promise<PostResult> {
  try {
    const r = await fetch("/api/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, emoji }),
    });
    const body = (await r.json()) as PostResult;
    if (!r.ok) return { ok: false, error: body.error || `http ${r.status}` };
    return body;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
