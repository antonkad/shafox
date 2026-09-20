// api.ts — thin client for the server API.
//
// Three kinds of state, each on a different backend:
//  • the JSON guestbook on the mounted storage volume (the disk proof),
//  • timestamped rows in managed Postgres,
//  • one fixed picture in managed S3-compatible object storage.

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
  backends?: { postgres: boolean; s3: boolean };
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

// ---- rows · Postgres -------------------------------------------------------

export interface Row {
  id: number;
  commit: string;
  shortSha: string;
  ts: string;
}

export interface RowsResult {
  ok: boolean;
  provisioned: boolean;
  rows: Row[];
  error?: string;
  retryAfterSeconds?: number;
}

export async function getRows(): Promise<RowsResult> {
  try {
    const r = await fetch("/api/rows", { cache: "no-store" });
    const body = (await r.json()) as { provisioned?: boolean; rows?: Row[]; error?: string };
    if (!r.ok) {
      return { ok: false, provisioned: body.provisioned ?? true, rows: body.rows ?? [], error: body.error || `http ${r.status}` };
    }
    return { ok: true, provisioned: !!body.provisioned, rows: body.rows ?? [] };
  } catch (e) {
    return { ok: false, provisioned: true, rows: [], error: e instanceof Error ? e.message : "network error" };
  }
}

export async function addRow(): Promise<RowsResult> {
  try {
    const r = await fetch("/api/rows", { method: "POST" });
    const body = (await r.json()) as { provisioned?: boolean; rows?: Row[]; error?: string; retryAfterSeconds?: number };
    if (!r.ok) {
      return {
        ok: false,
        provisioned: body.provisioned ?? true,
        rows: body.rows ?? [],
        error: body.error || `http ${r.status}`,
        retryAfterSeconds: body.retryAfterSeconds,
      };
    }
    return { ok: true, provisioned: true, rows: body.rows ?? [] };
  } catch (e) {
    return { ok: false, provisioned: true, rows: [], error: e instanceof Error ? e.message : "network error" };
  }
}

// ---- picture · S3 ----------------------------------------------------------

export interface PictureMeta {
  provisioned: boolean;
  present: boolean;
  contentType?: string;
  mediaType?: string;
  commit?: string;
  shortSha?: string;
  bytes?: number;
  updatedAt?: string | null;
  error?: string;
}

export async function getPictureMeta(): Promise<PictureMeta> {
  try {
    const r = await fetch("/api/picture/meta", { cache: "no-store" });
    const body = (await r.json()) as PictureMeta;
    if (!r.ok) return { provisioned: body.provisioned ?? true, present: false, error: body.error || `http ${r.status}` };
    return body;
  } catch (e) {
    return { provisioned: true, present: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export interface UploadResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
  contentType?: string;
  bytes?: number;
  commit?: string;
  shortSha?: string;
}

export async function uploadPicture(file: File): Promise<UploadResult> {
  try {
    const r = await fetch("/api/picture", {
      method: "PUT",
      // The server decides the type from magic bytes; this header is only a hint.
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const body = (await r.json()) as UploadResult;
    if (!r.ok) return { ok: false, error: body.error || `http ${r.status}`, retryAfterSeconds: body.retryAfterSeconds };
    return { ...body, ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
