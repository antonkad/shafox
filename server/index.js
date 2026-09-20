// Shafox server — one Node HTTP server.
//
// Its jobs: serve the static Vite build, and expose a tiny `/api` over
//  • a JSON guestbook in the MOUNTED STORAGE volume (the disk proof),
//  • a managed Postgres table of timestamped rows,
//  • one fixed object in managed S3-compatible storage.
//
// The per-commit identity is resolved once (server/lib/identity.js) and every
// piece of state written carries that SHA. Missing or partial backend env is
// normal: that slot renders "not provisioned" and nothing else is affected.

import { createServer } from "node:http";
import { readConfig } from "./lib/config.js";
import { createApp } from "./app.js";

const config = readConfig();
const app = createApp(config);

const server = createServer(app);
server.listen(config.port, () => {
  const backends = `postgres=${config.postgres ? "on" : "off"} s3=${config.s3 ? "on" : "off"}`;
  console.log(
    `[shafox] commit ${config.identity.shortSha} · serving dist + /api · data dir ${config.dataDir} · ${backends} · port ${config.port}`
  );
});
