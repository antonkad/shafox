# Shafox

> Public repo — keep everything here shareable. No secrets, tokens, private
> hostnames, or internal infrastructure details.

The demo app for [kad.dev](https://kad.dev). A one-screen, no-scroll cover with
a fixed, accessible **stage colour** per stage of the tour (c1 blue, c2 green,
c3 yellow) and a **codename derived from the build-time commit SHA**, so every
deployed commit carries its own identity. It is commit **two** of a three-commit
tour of kad.dev's per-commit deploy model, built around three stable slots:

1. **Picture · object storage** — one fixed object; upload a bounded JPEG/PNG/WebP.
2. **Rows · Postgres** — timestamped rows, each tagged with the writing commit.
3. **Next step** — the c2 copy: the commit-one picture and rows stayed with the
   project; add another row to see it tagged by commit two; then the owner rolls
   the canonical pointer back to commit one, with the two owner outcomes
   (keep current data vs. destructive restore of commit-one data) named in text.

It also keeps a small JSON guestbook on its mounted app disk as a disk proof,
and shows a data-provenance view.

## Stack

- **Frontend:** Vite + vanilla TypeScript (no framework).
- **Server:** Node HTTP server in `server/index.js`, with the router in
  `server/app.js` and small helpers under `server/lib/`. It serves the static
  build and a bounded `/api` over:
  - managed Postgres (`DATABASE_URL`),
  - managed S3-compatible object storage (`S3_*`),
  - a JSON guestbook on the mounted app disk (`DATA_DIR`/`STORAGE_PATH`).
- **Runtime dependencies:** exactly two — `pg` and `@aws-sdk/client-s3`. Both are
  imported lazily on first use, so a commit without a given backend still boots
  and simply renders that slot as "not provisioned".
- **Node:** 20 or newer (`engines.node` is `>=20`); `@aws-sdk/client-s3` v3
  requires `node >=20.0.0`, so the app must not be built or run on Node 18.
- Fonts: Fraunces (display), IBM Plex Sans (body), JetBrains Mono (code).

## Deploy packaging

kad.dev must deploy this app with the **`dockerfile` preset on port 8080**. The
`vite` preset is static-nginx and would omit the Node `/api` server.

`Dockerfile` is a two-stage Node 20 slim image: build with `npm ci` and
`npm run build`, install runtime production dependencies only
(`npm ci --omit=dev`), then run `node server/index.js`.

Runtime request injection is **authoritative** for deployed commit identity —
the `dockerfile` preset does not pass `BUILD_COMMIT` as a build argument, so the
server injects the deployed identity at request time (`server/app.js`).

The container intentionally runs as **root**: the platform app chart has no
`fsGroup`/`runAsUser` and the storage-prep init container leaves `/data`
root-owned, so non-root guestbook writes were verified to fail with `EACCES`.

`package-lock.json` resolves packages through `registry.npmjs.org`.

## Commands

```sh
npm install
npm test           # Node's built-in test runner (no framework)
npx tsc --noEmit   # type-check the frontend
npm run build      # -> dist/
npm run serve      # build + run the server (PORT=8099 if 8080 is taken)
npm run dev        # Vite dev server (run `npm start` alongside for /api)
```

## How the stage colour and per-commit identity work

The **stage colour** is fixed, not SHA-derived: `src/vineyard.ts` maps each stage
to one accessible Vineyard colour (c1 blue, c2 green, c3 yellow) and exports the
explicit `STAGE` value the page reads. A later commit selects its stage colour by
changing only `STAGE`.

The commit SHA is resolved at build time from env (kad.dev sets `BUILD_COMMIT`),
then local git, then a dev sentinel — see `vite.config.ts`. It's baked into the
bundle via `define`. `src/identity.ts` turns the SHA into a deterministic
codename, and `commitAccent` in `src/vineyard.ts` into the colour of the
per-written-commit provenance badges. The same SHA always produces the same
result. When run as a server, `server/app.js` can also inject the identity at
request time so it reflects the deployed commit; those values are embedded in an
inline script using JSON-safe escaping (`server/lib/inline.js`).

## Data model

Canonical commits serve the shared main data. Preview commits run against
isolated clones of that data, so what a visitor writes on a preview stays on the
preview until the owner promotes it. The app does not claim that every commit
inherently owns an independent picture or database.

- `GET /api/rows` lists the newest rows; `POST /api/rows` inserts one row with
  the full commit, short SHA and server timestamp, then trims to the newest 50.
- `GET /api/picture/meta` describes the fixed object via `HeadObject`;
  `GET /api/picture` serves it; `PUT /api/picture` overwrites one fixed key with
  a magic-byte-verified raster image under a hard 2 MiB cap. Reads are bounded
  too, since the key can also be written by owner tooling.
- `POST /api/marks` appends to the JSON guestbook (200-entry cap, escaped).
- Mutations are same-origin checked and best-effort rate limited per client
  (10 guestbook writes, 10 row writes, 3 picture writes per 10 minutes).

## Key files

| File | Purpose |
|---|---|
| `src/main.ts` | renders the layout, wires the guestbook + slots |
| `src/identity.ts` | SHA → codename |
| `src/vineyard.ts` | palette + fixed stage colour + per-commit provenance accent |
| `src/api.ts` | client for the server `/api` |
| `server/app.js` | request router and route handlers |
| `server/index.js` | process entry: reads config, starts the server |
| `server/lib/config.js` | env parsing; partial backends render as absent |
| `server/lib/http.js` | body limits, origin guard, rate limiter, client key |
| `server/lib/s3.js` | bounded S3 picture store (lazy SDK) |
| `server/lib/postgres.js` | lazy Postgres rows store |
| `server/lib/inline.js` | JSON-safe inline-script escaping |
| `vite.config.ts` | commit-SHA injection at build time |
| `Dockerfile` | two-stage Node 20 slim image; dockerfile-preset deploy on 8080 |
| `.dockerignore` | build-context exclusions |

## Conventions

- Keep it dependency-light: no frontend framework; only the two declared
  runtime dependencies on the server.
- Identity (codename, provenance badges) is a pure function of the commit SHA —
  deterministic, no randomness. The stage colour is fixed per stage instead, so
  the three commits of the tour read as a sequence.
- Backends are optional: missing or partial env must never crash startup.
- Every commit should build cleanly (`npm run build`) and pass `npm test`; each
  is independently deployable.

## A tiny history

- Replaces the original `love-letter` demo app.
- Briefly explored a fox mascot, then a Mondrian grid, before settling on the
  current warm "Vineyard" colour-field cover.
- Built collaboratively with Claude Code as a living kad.dev demo.
