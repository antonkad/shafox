# Shafox

> Public repo — keep everything here shareable. No secrets, tokens, private
> hostnames, or internal infrastructure details.

The demo app for [kad.dev](https://kad.dev). A one-screen, no-scroll cover whose
**colour + codename are derived from the build-time commit SHA**, so every
deployed commit looks distinct. It also keeps a per-commit guestbook on its
storage volume and shows a data-provenance view — a small, tangible tour of
kad.dev's per-commit deploy model (fork & compare, per-commit storage, rollback).

## Stack

- **Frontend:** Vite + vanilla TypeScript (no framework, no runtime deps).
- **Server:** one zero-dependency Node file (`server/index.js`) that serves the
  build and a tiny `/api` over a JSON file in the storage volume.
- Fonts: Fraunces (display), IBM Plex Sans (body), JetBrains Mono (code).

## Commands

```sh
npm install
npm run build      # -> dist/
npm run serve      # build + run the server (PORT=8099 if 8080 is taken)
npm run dev        # Vite dev server (run `npm start` alongside for /api)
```

## How the per-commit identity works

The commit SHA is resolved at build time from env (kad.dev sets `BUILD_COMMIT`),
then local git, then a dev sentinel — see `vite.config.ts`. It's baked into the
bundle via `define`. `src/identity.ts` turns the SHA into a deterministic
codename, and `src/vineyard.ts` into an accent colour. The same SHA always
produces the same result. When run as a server, `server/index.js` can also
inject the identity at request time so it reflects the deployed commit.

## Key files

| File | Purpose |
|---|---|
| `src/main.ts` | renders the four-block layout, wires the guestbook |
| `src/identity.ts` | SHA → codename |
| `src/vineyard.ts` | palette + per-commit accent |
| `src/api.ts` | client for the storage `/api` |
| `server/index.js` | static server + guestbook API |
| `vite.config.ts` | commit-SHA injection at build time |

## Conventions

- Keep it dependency-light: no frontend framework, no runtime deps.
- Identity is a pure function of the commit SHA — deterministic, no randomness.
- Every commit should build cleanly (`npm run build`); each is independently
  deployable.

## A tiny history

- Replaces the original `love-letter` demo app.
- Briefly explored a fox mascot, then a Mondrian grid, before settling on the
  current warm "Vineyard" colour-field cover.
- Built collaboratively with Claude Code as a living kad.dev demo.
