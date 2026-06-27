import "./style.css";
import { deriveIdentity } from "./identity.ts";
import { commitAccent } from "./vineyard.ts";
import { addMark, getInfo, getMarks, type Mark, type StorageInfo } from "./api.ts";

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

const id = deriveIdentity(COMMIT);
const accent = commitAccent(COMMIT);
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}


// ---- panel C: storage status ---------------------------------------------

function statusContent(info: StorageInfo | null): { big: string; p: string; path: string } {
  if (!info) {
    return {
      big: "Offline",
      p: "Storage API unreachable — run the server to see this commit's per-commit folder.",
      path: "",
    };
  }
  const path = `${esc(info.dataDir)} · ${info.count} mark${info.count === 1 ? "" : "s"}`;
  if (info.count === 0) {
    return {
      big: "Isolated",
      p: "Booted with an empty folder. On kad.dev every commit gets its own PVC subPath — a fork never sees another's data.",
      path,
    };
  }
  if (info.seededCount > 0) {
    return {
      big: "Migrated",
      p: `${info.seededCount} mark${info.seededCount === 1 ? "" : "s"} were seeded from another commit at boot — kad.dev's “seed from canonical”. Foreign colours appear in the guestbook.`,
      path,
    };
  }
  return {
    big: "Persisted",
    p: "All marks written by this commit and kept on the volume. Roll back to this SHA and the data is still here.",
    path,
  };
}

// ---- panel C (strata): data provenance by contributing commit ------------

interface Layer {
  commit: string;
  shortSha: string;
  count: number;
  lastTs: number;
}

function groupByCommit(marks: Mark[]): Layer[] {
  const m = new Map<string, Layer>();
  for (const k of marks) {
    const g = m.get(k.commit) || { commit: k.commit, shortSha: k.shortSha, count: 0, lastTs: 0 };
    g.count += 1;
    g.lastTs = Math.max(g.lastTs, k.ts);
    m.set(k.commit, g);
  }
  // always include the current commit as the outermost layer ("you are here")
  if (!m.has(COMMIT)) {
    m.set(COMMIT, { commit: COMMIT, shortSha: id.shortSha, count: 0, lastTs: Infinity });
  }
  const cur = m.get(COMMIT)!;
  const rest = [...m.values()].filter((g) => g.commit !== COMMIT).sort((a, b) => b.lastTs - a.lastTs);
  let ordered = [cur, ...rest]; // outer -> inner, oldest data innermost
  // cap depth: keep current + 2 newest seeded, fold the rest into a base layer
  if (ordered.length > 4) {
    const head = ordered.slice(0, 3);
    const tail = ordered.slice(3);
    const folded: Layer = {
      commit: "",
      shortSha: `+${tail.length} older`,
      count: tail.reduce((s, g) => s + g.count, 0),
      lastTs: 0,
    };
    ordered = [...head, folded];
  }
  return ordered;
}

function strataHTML(layers: Layer[]): string {
  const total = Math.max(1, layers.reduce((s, g) => s + g.count, 0));
  const H = 150; // px budget for proportional bands
  const build = (i: number): string => {
    const g = layers[i];
    const last = i === layers.length - 1;
    const color = g.commit ? commitAccent(g.commit).color : "#6b675c";
    const on = g.commit ? commitAccent(g.commit).on : "#fffef8";
    const isHere = g.commit === COMMIT;
    const band = Math.max(28, Math.round((g.count / total) * H));
    const inner = last ? "" : build(i + 1);
    const padding = last ? "" : `padding:${band}px 0 0 14px;`;
    const tag = isHere ? `<span class="here-tag">you are here</span>` : "";
    return `
      <div class="layer${isHere ? " is-here" : ""}" style="background:${color};color:${on};${padding}">
        <span class="layer-label">${g.commit && !isHere ? "↳ " : ""}${esc(g.shortSha)} · ${g.count} ${g.count === 1 ? "mark" : "marks"}${tag}</span>
        ${inner}
      </div>`;
  };
  return `<div class="strata">${build(0)}</div>`;
}

// ---- panel B: marks -------------------------------------------------------

function markRow(m: Mark): string {
  // colour is a function of the writing commit, so the dot always matches that
  // commit's layer in the provenance strata.
  const color = commitAccent(m.commit).color;
  const foreign = m.commit !== COMMIT;
  return `
    <li class="mark">
      <span class="dot" style="background:${esc(color)}"></span>
      <span class="nm">${esc(m.name)}</span>
      <span class="sx" title="${foreign ? "seeded from another commit" : "this commit"}">${foreign ? "↳" : ""}${esc(m.shortSha)} · ${timeAgo(m.ts)}</span>
    </li>`;
}

function marksView(marks: Mark[]): string {
  if (!marks.length) return `<div class="empty">No marks yet — be the first to sign this commit.</div>`;
  return marks.slice().reverse().map(markRow).join("");
}

// ---- render ---------------------------------------------------------------

const app = document.getElementById("app")!;

function applyAccent(): void {
  document.documentElement.style.setProperty("--accent", accent.color);
  document.documentElement.style.setProperty("--accent-on", accent.on);
}

function renderShell(): void {
  app.innerHTML = `
    <div class="grid">
      <section class="panel hero">
        <div class="brand">
          <svg class="logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" aria-hidden="true">
            <line x1="2.5" y1="21.5" x2="8.3" y2="15.7" stroke="var(--ink)" stroke-width="2.2"/>
            <line x1="15.7" y1="8.3" x2="21.5" y2="2.5" stroke="var(--ink)" stroke-width="2.2"/>
            <circle cx="12" cy="12" r="4.6" fill="var(--accent)"/>
          </svg>
          Shafox
        </div>
        <div class="identity">
          <div class="eyebrow">this deploy is</div>
          <h1 class="codename">${esc(id.codename)}</h1>
          <p class="tagline">a colour &amp; a codename, grown from this commit's SHA</p>
          <div class="id-foot">
            <span class="sha">${id.shortSha}</span>
            <button class="copy-btn" id="copy">copy full sha</button>
          </div>
          <div class="id-meta">
            ${REF ? `<span>branch <b>${esc(REF)}</b></span>` : ""}
            <span>${isDev ? "built <b>in dev</b>" : BUILD_TIME ? `built <b>${esc(fmtDate(BUILD_TIME))}</b>` : "<b>live</b>"}</span>
          </div>
        </div>
      </section>

      <section class="panel gb">
        <div class="kicker">guestbook · on disk</div>
        <h2>Sign this commit</h2>
        <form class="gb-form" id="gb-form" autocomplete="off">
          <input id="gb-name" type="text" maxlength="40" placeholder="your name…" />
          <button class="btn" id="gb-submit" type="submit">Sign</button>
        </form>
        <div class="form-err" id="gb-err"></div>
        <ul class="marks" id="marks"><li class="empty">Loading folder…</li></ul>
      </section>

      <section class="panel status" id="status"></section>

      <section class="panel kad">
        <div class="kicker">why this is a kad.dev demo</div>
        <h3>Repo URL in.<br />App live. Every commit, forever.</h3>
        <ul>
          <li>Fork &amp; compare — every commit, its own URL &amp; colour</li>
          <li>Per-commit storage, seeded or isolated</li>
          <li>Promote &amp; roll back — code and data together</li>
        </ul>
        <div class="actions">
          <a class="go" href="${KAD_URL}" target="_blank" rel="noopener">Deploy your repo →</a>
          <a class="src" href="https://github.com/antonkad/shafox" target="_blank" rel="noopener">source</a>
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

  const form = document.getElementById("gb-form") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
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
    paint(res.info ?? (await getInfo()), res.marks ?? (await getMarks()));
  });
}

function paint(info: StorageInfo | null, marks: Mark[]): void {
  const statusEl = document.getElementById("status")!;
  const layers = groupByCommit(marks);
  const path = info ? `${esc(info.dataDir)} · ${info.count} mark${info.count === 1 ? "" : "s"}` : "";

  // Strata view only earns its place once data from >1 commit is present
  // (i.e. seeding/migration happened). Otherwise the glanceable word reads better.
  if (info && layers.length >= 2) {
    statusEl.classList.add("strata-mode");
    statusEl.innerHTML = `
      <div class="kicker">storage · data provenance</div>
      ${strataHTML(layers)}
      <div class="path"><span>${path}</span><span>each seed copies data forward</span></div>
    `;
  } else {
    statusEl.classList.remove("strata-mode");
    const s = statusContent(info);
    statusEl.innerHTML = `
      <div class="kicker">this commit's storage</div>
      <div class="big">${s.big}</div>
      <p>${s.p}</p>
      ${s.path ? `<div class="path"><span>${s.path}</span></div>` : ""}
    `;
  }
  document.getElementById("marks")!.innerHTML = marksView(marks);
}

// ---- boot -----------------------------------------------------------------

applyAccent();
renderShell();
Promise.all([getInfo(), getMarks()]).then(([info, marks]) => paint(info, marks));
