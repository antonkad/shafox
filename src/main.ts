import "./style.css";
import { deriveIdentity } from "./identity.ts";
import { commitAccent, stageAccent } from "./vineyard.ts";
import {
  addMark,
  addRow,
  getInfo,
  getMarks,
  getPictureMeta,
  getRows,
  uploadPicture,
  type Mark,
  type PictureMeta,
  type Row,
  type RowsResult,
  type StorageInfo,
} from "./api.ts";

// Prefer values the server injected at request time (window.__SHAFOX__ from
// BUILD_COMMIT_SHA on the pod). Fall back to the build-time constants for local
// `vite dev`, where the %%…%% placeholders are never filled.
declare global {
  interface Window {
    __SHAFOX__?: { commit: string; ref: string; buildTime: string };
  }
}
const rt = window.__SHAFOX__;
const filled = (v: string | undefined): v is string => !!v && !v.startsWith("%%");

const COMMIT = filled(rt?.commit) ? rt!.commit : __SHAFOX_COMMIT__;
const REF = filled(rt?.ref) ? rt!.ref : __SHAFOX_REF__;
const BUILD_TIME = filled(rt?.buildTime) ? rt!.buildTime : __SHAFOX_BUILD_TIME__;
const KAD_URL = "https://kad.dev";
const SOURCE_URL = "https://github.com/antonkad/shafox";
const PROD_URL = "https://shafox-platform-demo.kad.dev";

const id = deriveIdentity(COMMIT);
// The page accent is the fixed stage colour, not the SHA; the SHA still drives
// the codename above and the per-written-commit badges below.
const accent = stageAccent();
const isDev = COMMIT.startsWith("devfox");

// ---- helpers --------------------------------------------------------------

function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(1, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function rowTime(ts: string): string {
  const n = Date.parse(ts);
  return Number.isNaN(n) ? "—" : timeAgo(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function shaBadge(commit: string, short: string): string {
  const a = commitAccent(commit);
  return `<span class="sha-badge" style="background:${esc(a.color)};color:${esc(a.on)}">${esc(short || "unknown")}</span>`;
}

// ---- picture · S3 ---------------------------------------------------------

let pictureMeta: PictureMeta | null = null;
let pictureLoading = true;
let selectedFile: File | null = null;
let previewUrl: string | null = null;

function clearPreview(): void {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  selectedFile = null;
}

function stageHTML(meta: PictureMeta | null, loading: boolean): string {
  if (loading) return `<div class="empty">Checking object storage…</div>`;
  if (!meta) return `<div class="empty">Object storage unreachable.</div>`;
  if (!meta.provisioned) return `<div class="empty">Not provisioned — no object storage is wired to this commit.</div>`;
  if (meta.error) return `<div class="empty">Object storage error. Try again shortly.</div>`;
  if (!meta.present) return `<div class="empty">No picture yet. Upload one to write the fixed key.</div>`;
  return `
    <img class="pic-img" id="pic-img" alt="Current picture for this commit" />
    <div class="pic-meta">
      ${shaBadge(meta.commit || "", meta.shortSha || "")}
      <span>${esc(meta.mediaType || meta.contentType || "image")}</span>
      ${typeof meta.bytes === "number" ? `<span>${esc(fmtBytes(meta.bytes))}</span>` : ""}
      ${meta.updatedAt ? `<span>${esc(fmtDate(meta.updatedAt))}</span>` : ""}
    </div>`;
}

function renderStage(): void {
  const el = document.getElementById("pic-stage");
  if (!el) return;
  if (previewUrl) {
    el.innerHTML = `
      <img class="pic-img" id="pic-img" alt="Local preview of the selected image" />
      <div class="pic-meta"><span class="pending-tag">local preview — not uploaded yet</span></div>`;
    const img = document.getElementById("pic-img") as HTMLImageElement | null;
    if (img) img.src = previewUrl;
    return;
  }
  el.innerHTML = stageHTML(pictureMeta, pictureLoading);
  const img = document.getElementById("pic-img") as HTMLImageElement | null;
  if (img && pictureMeta) img.src = `/api/picture?t=${encodeURIComponent(pictureMeta.updatedAt || "0")}`;
}

function paintPicture(meta: PictureMeta | null, loading: boolean): void {
  pictureMeta = meta;
  pictureLoading = loading;
  const controls = document.getElementById("pic-controls");
  const uploadBtn = document.getElementById("pic-upload") as HTMLButtonElement | null;
  // A missing backend or a backend error keeps the upload action disabled.
  const usable = !!(meta && meta.provisioned && !meta.error);
  if (controls) controls.hidden = !(meta && meta.provisioned);
  if (uploadBtn) uploadBtn.disabled = !usable;
  renderStage();
}

function setSelected(f: File | null): void {
  const fileName = document.getElementById("pic-file-name");
  const uploadBtn = document.getElementById("pic-upload") as HTMLButtonElement | null;
  const err = document.getElementById("pic-err");
  clearPreview();
  if (err) err.textContent = "";
  if (!f) {
    if (fileName) fileName.textContent = "";
    if (uploadBtn) uploadBtn.disabled = true;
    renderStage();
    return;
  }
  selectedFile = f;
  if (fileName) fileName.textContent = f.name;
  // Preview locally only for the raster types the server will accept; the
  // server's sniffed result stays authoritative.
  if (/^image\/(jpeg|png|webp)$/.test(f.type)) previewUrl = URL.createObjectURL(f);
  // Only enable Upload when the backend is actually usable; a missing backend
  // or a backend error keeps it disabled.
  const usable = !!(pictureMeta && pictureMeta.provisioned && !pictureMeta.error);
  if (uploadBtn) uploadBtn.disabled = !usable;
  renderStage();
}

async function doUpload(): Promise<void> {
  if (!selectedFile) return;
  const uploadBtn = document.getElementById("pic-upload") as HTMLButtonElement;
  const fileInput = document.getElementById("pic-file") as HTMLInputElement;
  const err = document.getElementById("pic-err")!;
  err.textContent = "";
  uploadBtn.disabled = true;
  fileInput.disabled = true;
  uploadBtn.textContent = "Uploading…";

  const res = await uploadPicture(selectedFile);

  fileInput.disabled = false;
  uploadBtn.textContent = "Upload";
  if (!res.ok) {
    err.textContent = res.error || "Upload failed.";
    if (res.retryAfterSeconds) err.textContent += ` Try again in ${res.retryAfterSeconds}s.`;
    // Keep the action disabled after an error; choosing a file again re-enables it.
    uploadBtn.disabled = true;
    return;
  }

  clearPreview();
  fileInput.value = "";
  const fileName = document.getElementById("pic-file-name");
  if (fileName) fileName.textContent = "";
  uploadBtn.disabled = true;
  pictureLoading = true;
  renderStage();
  pictureMeta = await getPictureMeta();
  pictureLoading = false;
  renderStage();
}

// ---- rows · Postgres ------------------------------------------------------

function rowHTML(r: Row): string {
  return `
    <li class="row">
      ${shaBadge(r.commit, r.shortSha)}
      <span class="row-time" title="${esc(r.ts)}">${esc(rowTime(r.ts))}</span>
      <span class="row-id">#${esc(String(r.id))}</span>
    </li>`;
}

function renderRows(res: RowsResult): void {
  const list = document.getElementById("rowlist");
  if (!list) return;
  if (!res.provisioned) {
    list.innerHTML = `<li class="empty">Not provisioned — no Postgres is wired to this commit.</li>`;
    return;
  }
  if (!res.ok) {
    list.innerHTML = `<li class="empty">Rows backend unavailable. Try again shortly.</li>`;
    return;
  }
  if (!res.rows.length) {
    list.innerHTML = `<li class="empty">No rows yet. Add the first one.</li>`;
    return;
  }
  list.innerHTML = res.rows.map(rowHTML).join("");
}

async function doAddRow(): Promise<void> {
  const btn = document.getElementById("row-add") as HTMLButtonElement;
  const err = document.getElementById("rows-err")!;
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Adding…";

  const res = await addRow();

  btn.textContent = "Add a row";
  if (!res.ok) {
    err.textContent = res.error || "Could not add a row.";
    if (res.retryAfterSeconds) err.textContent += ` Try again in ${res.retryAfterSeconds}s.`;
    renderRows(res);
    // Missing backend or backend error: leave the action disabled.
    btn.disabled = true;
    return;
  }
  renderRows(res);
  btn.disabled = false;
}

// ---- disk proof · JSON guestbook ------------------------------------------

function markRow(m: Mark): string {
  const a = commitAccent(m.commit);
  const foreign = m.commit !== COMMIT;
  return `
    <li class="mark">
      <span class="dot" style="background:${esc(a.color)}"></span>
      <span class="nm">${esc(m.name)}</span>
      <span class="sx" title="${foreign ? "written by another commit" : "this commit"}">${foreign ? "↳" : ""}${esc(m.shortSha)} · ${timeAgo(m.ts)}</span>
    </li>`;
}

function paintDisk(info: StorageInfo | null, marks: Mark[]): void {
  const pathEl = document.getElementById("disk-path");
  const countEl = document.getElementById("disk-count");
  const list = document.getElementById("marks");
  if (pathEl) pathEl.textContent = info ? `${info.dataDir}/guestbook.json` : "unreachable";
  if (countEl) countEl.textContent = info ? `${info.count} mark${info.count === 1 ? "" : "s"}` : "";
  if (!list) return;
  list.innerHTML = marks.length
    ? marks.slice().reverse().map(markRow).join("")
    : `<li class="empty">No marks yet.</li>`;
}

// ---- render ---------------------------------------------------------------

const app = document.getElementById("app")!;

function applyAccent(): void {
  document.documentElement.style.setProperty("--accent", accent.color);
  document.documentElement.style.setProperty("--accent-on", accent.on);
}

function renderShell(): void {
  app.innerHTML = `
    <div class="banner" role="note">test copy — changes stay isolated from production</div>
    <div class="grid">
      <section class="panel hero">
        <h1 class="brand">
          <svg class="logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" aria-hidden="true">
            <line x1="2.5" y1="21.5" x2="8.3" y2="15.7" stroke="var(--ink)" stroke-width="2.2"/>
            <line x1="15.7" y1="8.3" x2="21.5" y2="2.5" stroke="var(--ink)" stroke-width="2.2"/>
            <circle cx="12" cy="12" r="4.6" fill="var(--accent)"/>
          </svg>
          Shafox <span class="brand-stage">· three — test copy</span>
        </h1>
        <div class="identity">
          <div class="eyebrow">this deploy is</div>
          <p class="codename">${esc(id.codename)}</p>
          <p class="tagline">a codename from this commit's SHA &middot; stage three yellow</p>
          <div class="id-foot">
            <span class="sha">${id.shortSha}</span>
            <button class="copy-btn" id="copy">copy full sha</button>
          </div>
          <div class="id-meta">
            ${REF ? `<span>branch <b>${esc(REF)}</b></span>` : ""}
            <span>${isDev ? "built <b>in dev</b>" : BUILD_TIME ? `built <b>${esc(fmtDate(BUILD_TIME))}</b>` : "<b>live</b>"}</span>
          </div>
        </div>

        <div class="disk">
          <div class="kicker">disk proof · JSON on the mounted volume</div>
          <div class="disk-head">
            <span class="disk-path" id="disk-path">…</span>
            <span class="disk-count" id="disk-count"></span>
          </div>
          <form class="gb-form" id="gb-form" autocomplete="off">
            <input id="gb-name" type="text" maxlength="40" placeholder="your name…" aria-label="Your name" />
            <button class="btn" id="gb-submit" type="submit">Sign</button>
          </form>
          <div class="form-err" id="gb-err" role="status" aria-live="polite"></div>
          <ul class="marks" id="marks"><li class="empty">Loading…</li></ul>
        </div>
      </section>

      <section class="panel picture">
        <div class="kicker">picture · S3</div>
        <h2 class="slot-h">One picture, one fixed key</h2>
        <div class="pic-stage" id="pic-stage"><div class="empty">Loading…</div></div>
        <div class="pic-controls" id="pic-controls" hidden>
          <label class="file-btn" for="pic-file">Choose image</label>
          <input id="pic-file" type="file" accept="image/jpeg,image/png,image/webp" hidden />
          <span class="file-name" id="pic-file-name"></span>
          <button class="btn" id="pic-upload" type="button" disabled>Upload</button>
        </div>
        <div class="form-err" id="pic-err" role="status" aria-live="polite"></div>
      </section>

      <section class="panel rows">
        <div class="kicker">rows · Postgres</div>
        <div class="slot-head">
          <h2 class="slot-h">Timestamped rows, tagged by commit</h2>
          <button class="btn" id="row-add" type="button">Add a row</button>
        </div>
        <div class="form-err" id="rows-err" role="status" aria-live="polite"></div>
        <ul class="rowlist" id="rowlist"><li class="empty">Loading…</li></ul>
      </section>

      <section class="panel next">
        <div class="kicker">next step</div>
        <h2 class="slot-h">Commit three of three</h2>
        <ol class="steps">
          <li>This preview starts from clones of the canonical picture, Postgres rows, and app disk.</li>
          <li>Click <b>Add a row</b> here — the new row is tagged with commit three's short SHA.</li>
          <li>Open <b>production</b> in a separate tab and observe that the preview row is absent there.</li>
        </ol>
        <p>
          This is <b>shared preview state</b>, not a fresh per-visitor sandbox: preview writes persist until the operator
          resets or deletes the preview, and commit three is never promoted. Visitors cannot trigger deploy, promote,
          reset, or delete.
        </p>
        <div class="actions">
          <a class="go" href="${PROD_URL}" target="_blank" rel="noopener">Open production in a new tab →</a>
          <a class="src" href="${KAD_URL}" target="_blank" rel="noopener">kad.dev</a>
          <a class="src" href="${SOURCE_URL}" target="_blank" rel="noopener">source</a>
        </div>
      </section>
    </div>
  `;
  app.removeAttribute("aria-busy");

  document.getElementById("copy")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(COMMIT);
      btn.textContent = "copied!";
      setTimeout(() => (btn.textContent = "copy full sha"), 1400);
    } catch {
      btn.textContent = COMMIT.slice(0, 16);
    }
  });

  document.getElementById("gb-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("gb-name") as HTMLInputElement;
    const submit = document.getElementById("gb-submit") as HTMLButtonElement;
    const err = document.getElementById("gb-err")!;
    const name = input.value.trim();
    err.textContent = "";
    if (!name) {
      err.textContent = "Add a name first.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "…";
    const res = await addMark(name, accent.color);
    submit.disabled = false;
    submit.textContent = "Sign";
    if (!res.ok) {
      err.textContent = res.error || "Could not save.";
      return;
    }
    input.value = "";
    paintDisk(res.info ?? (await getInfo()), res.marks ?? (await getMarks()));
  });

  document.getElementById("row-add")?.addEventListener("click", () => void doAddRow());

  const fileInput = document.getElementById("pic-file") as HTMLInputElement;
  fileInput.addEventListener("change", () => setSelected(fileInput.files?.[0] ?? null));
  document.getElementById("pic-upload")?.addEventListener("click", () => void doUpload());
}

// ---- boot -----------------------------------------------------------------

async function boot(): Promise<void> {
  applyAccent();
  renderShell();
  const [info, marks, rowsRes, picMeta] = await Promise.all([getInfo(), getMarks(), getRows(), getPictureMeta()]);
  paintDisk(info, marks);
  renderRows(rowsRes);
  const rowBtn = document.getElementById("row-add") as HTMLButtonElement | null;
  if (rowBtn) rowBtn.disabled = !(rowsRes.provisioned && rowsRes.ok);
  paintPicture(picMeta, false);
}

void boot();
