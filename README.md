# Shafox

**Every commit gets its own face.**

Shafox is the demo app for [kad.dev](https://kad.dev). It turns kad.dev's core
moat — *every commit is a first-class, addressable, stateful deployment* — into
a single screen you can read at a glance.

## The idea

Shafox is a one-screen, no-scroll cover split into four colour-field blocks in
kad.dev's "Vineyard" palette. From the build-time commit SHA it deterministically
derives a **codename** and an **accent hue** (terracotta / cognac / steel-blue /
olive / gold) that recolours the whole page — the same SHA always looks the same,
on any machine, forever. On top of that, the app keeps a guestbook **on its
mounted storage volume**. Together they make three kad.dev features tangible:

| Feature | How Shafox shows it |
|---|---|
| **Fork & compare** concurrent deploys | Each commit deploys to `shafox-<sha>.kad.dev` with its own colour + codename. Open two — instantly distinguishable, so you never confuse two builds. |
| **Per-commit storage & data migration** | Each commit mounts its own PVC folder (`commits/<sha>/`). The guestbook lives there — empty and isolated by default. Turn on kad.dev's *seed previews from canonical* and the new commit **inherits** production data. The **provenance strata** panel nests the folder's data by the commit that wrote it, so seeded (migrated) layers are visible. |
| **Rollback** | Promote an older commit and its exact colour + codename return *and* its data folder is still there, untouched — code and data restored together. |

## How the SHA gets in

At build time `vite.config.ts` resolves the commit from (in order) a build-arg
env var, then local `git HEAD`, then a dev sentinel:

```
SHAFOX_COMMIT · COMMIT_SHA · GIT_COMMIT · GIT_SHA · SOURCE_COMMIT
GITHUB_SHA · VERCEL_GIT_COMMIT_SHA · CI_COMMIT_SHA
```

It's baked into the bundle via `define`, so the identity travels with the
artifact. The server reads the same env vars, so each mark is tagged with the
commit that wrote it.

## Stack

- **Frontend:** Vite + vanilla TypeScript (no framework, no runtime deps), ~10 KB JS.
  Fonts: Fraunces, IBM Plex Sans, JetBrains Mono.
- **Server:** a single zero-dependency Node file (`server/index.js`) that serves
  the static build and exposes a tiny `/api` reading/writing one JSON file in the
  mounted storage volume.

## Develop

```sh
npm install
npm run serve      # build + run the server on http://localhost:8080
# or, with hot reload:
npm start          # term 1 — Node server on :8080 (the /api backend)
npm run dev        # term 2 — Vite on :5173, proxies /api to :8080
```

Data lives in `./.data/guestbook.json` locally, or `$DATA_DIR` (default `/data`
in production) when deployed.

> If port 8080 is already taken locally, run with `PORT=8099 npm run serve`.

Preview any commit's identity without checking it out:

```sh
SHAFOX_COMMIT=deadbeefcafe npm run serve
```

## Deploy on kad.dev

1. Push this repo to GitHub.
2. kad.dev → **New project → paste the repo URL**.
3. Framework **Node**: build `npm run build`, start `npm start`, port `8080`.
4. **Storage tab:** enable storage, mount path `/data`. To demo migration, turn
   on **Seed previews from canonical** — new commits inherit canonical's
   guestbook; leave it off to show isolated, empty-per-commit folders.
5. Deploy a few commits, promote one to `shafox.kad.dev`, then roll back and
   watch both the identity and its data return.

---

Successor to [`love-letter`](https://github.com/antonkad/love-letter) as the
kad.dev demo app.
