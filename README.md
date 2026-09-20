# Shafox

**Every commit gets its own face.**

Shafox is the demo app for [kad.dev](https://kad.dev). It turns kad.dev's core
moat — *every commit is a first-class, addressable, stateful deployment* — into
a single screen you can read at a glance. This is commit **one** of a
three-commit guided tour.

## The idea

Shafox is a one-screen, no-scroll cover split into colour-field blocks in
kad.dev's "Vineyard" palette. Each stage of the tour has a fixed, accessible
**stage colour** — commit one is blue (commit two green, commit three yellow) —
so the three deployments read as a sequence. Separately, the build-time commit
SHA deterministically derives a **codename** and the per-written-commit
provenance colours, so the same SHA always looks the same, on any machine,
forever.

On top of that identity, c1 tells the story through three stable slots:

| Slot | What it shows |
|---|---|
| **Picture · object storage** | One picture at a fixed key. Upload a bounded JPEG, PNG or WebP (verified from magic bytes, 2 MiB cap); the slot shows the current image or a not-provisioned state. |
| **Rows · Postgres** | A bounded list of timestamped rows. `Add a row` writes one row tagged with the writing commit's full and short SHA, then keeps only the newest 50. |
| **Next step** | The c1 copy: upload a picture and add a row, then the owner deploys commit 2. |

A small JSON guestbook on the mounted app disk remains as a **disk proof**, and
the identity hero shows a data-provenance view. `Shafox · one` is the visible
page title; the derived codename and the per-written-commit provenance badges
are the secondary identity.

## Canonical vs preview data

Canonical commits serve the shared **main** data. Preview commits run against
**isolated clones** of that data, so anything a visitor writes on a preview stays
on the preview until the owner promotes it. Shafox does not claim that every
commit inherently owns an independent picture or database.

## How the SHA gets in

At build time `vite.config.ts` resolves the commit from (in order) a build-arg
env var, then local `git HEAD`, then a dev sentinel:

```
SHAFOX_COMMIT · COMMIT_SHA · GIT_COMMIT · GIT_SHA · SOURCE_COMMIT
GITHUB_SHA · VERCEL_GIT_COMMIT_SHA · CI_COMMIT_SHA
```

It's baked into the bundle via `define`, so the identity travels with the
artifact. When the app runs as a server it can also inject the identity at
request time, and the server reads the same env vars so each mark is tagged with
the commit that wrote it.

For a deployed commit, that **runtime request injection is authoritative**: the
`dockerfile` preset does not pass `BUILD_COMMIT` as a build argument, so the
server injects the deployed identity at request time instead of relying on a
baked-in value.

## Stack

- **Frontend:** Vite + vanilla TypeScript (no framework), ~10 KB JS.
  Fonts: Fraunces, IBM Plex Sans, JetBrains Mono.
- **Server:** a Node HTTP server (`server/index.js` + `server/app.js` + helpers
  in `server/lib/`) that serves the static build and a bounded `/api` over:
  - managed Postgres (`DATABASE_URL`),
  - managed S3-compatible object storage (`S3_ENDPOINT`, `S3_BUCKET`,
    `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE`),
  - a JSON guestbook on the mounted app disk (`DATA_DIR` / `STORAGE_PATH`).
- **Runtime dependencies:** exactly two — `pg` and `@aws-sdk/client-s3`. Both are
  imported lazily on first use, so a commit without a given backend still boots
  and simply renders that slot as "not provisioned".
- **Node:** 20 or newer (`engines.node` is `>=20`). `@aws-sdk/client-s3` v3
  declares `node >=20.0.0`, so the app must not be built or run on Node 18.

## Develop

```sh
npm install
npm test           # Node's built-in test runner (no framework)
npx tsc --noEmit   # type-check the frontend
npm run build      # -> dist/
npm run serve      # build + run the server on http://localhost:8080
# or, with hot reload:
npm start          # term 1 — Node server on :8080 (the /api backend)
npm run dev        # term 2 — Vite on :5173, proxies /api to :8080
```

Guestbook data lives in `./.data/guestbook.json` locally, or `$DATA_DIR` when
deployed. Postgres and object storage are only used when their env vars are set.

> If port 8080 is already taken locally, run with `PORT=8099 npm run serve`.

Preview any commit's identity without checking it out:

```sh
SHAFOX_COMMIT=deadbeefcafe npm run serve
```

## Deploy on kad.dev

1. Push this repo to GitHub.
2. kad.dev → **New project → paste the repo URL**.
3. Framework **`dockerfile`**, port **`8080`**. The `vite` preset is
   static-nginx: it would publish `dist/` and omit the Node `/api` server
   entirely, so the app must deploy with the `dockerfile` preset.
4. Optionally provision **Postgres** and **object storage** from the project's
   settings so the rows and picture slots light up. Without them those slots
   render as "not provisioned" and the rest of the page still works.
5. Deploy a few commits, promote one, and watch the identity follow the SHA.

### The container image

`Dockerfile` is a two-stage Node 20 slim image:

- **build stage** — `npm ci` then `npm run build`, producing `dist/`.
- **runtime stage** — production dependencies only (`npm ci --omit=dev`), then
  `node server/index.js`.

The container intentionally runs as **root**. The platform's app chart renders
an empty pod/container securityContext (no `fsGroup`, no `runAsUser`) and its
storage-prep init container leaves `/data` root-owned, so a non-root `node` user
could not write the JSON guestbook — non-root guestbook writes were verified to
fail with `EACCES`.

`package-lock.json` resolves packages through `registry.npmjs.org`.

---

Successor to [`love-letter`](https://github.com/antonkad/love-letter) as the
kad.dev demo app.
