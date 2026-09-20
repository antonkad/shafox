import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin the commit-three preview copy so a later edit cannot silently ship the
// wrong stage identity, hide the production link, or imply that a visitor can
// control the deploy. These read the source files directly: there is no
// frontend test harness by design.
const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

test("browser title, description and visible brand say commit three test copy", async () => {
  const [html, main] = await Promise.all([read("index.html"), read("src/main.ts")]);

  assert.match(html, /<title>Shafox · three — test copy<\/title>/);
  assert.match(html, /content="Commit three of a three-commit tour/);
  assert.match(main, /Shafox <span class="brand-stage">· three — test copy<\/span>/);
});

test("a prominent banner carries the exact isolation message", async () => {
  const main = await read("src/main.ts");

  assert.match(main, /class="banner"[^>]*>test copy — changes stay isolated from production</);
});

test("next-step slot names commit three and guides the production proof", async () => {
  const main = await read("src/main.ts");

  assert.match(main, /Commit three of three/);
  assert.match(main, /clones of the canonical picture, Postgres rows, and app disk/);
  assert.match(main, /Add a row<\/b> here/);
  assert.match(main, /absent there/);
  // The public canonical URL, opened in a separate tab.
  assert.match(main, /const PROD_URL = "https:\/\/shafox-platform-demo\.kad\.dev"/);
  assert.match(main, /href="\$\{PROD_URL\}" target="_blank" rel="noopener">Open production in a new tab/);
  // Never fall back to the legacy project hostname.
  assert.doesNotMatch(main, /shafox\.kad\.dev/);
});

test("preview semantics are precise: shared, persistent, never promoted", async () => {
  const main = await read("src/main.ts");

  assert.match(main, /shared preview state/);
  assert.match(main, /not a fresh per-visitor sandbox/);
  assert.match(main, /persist until the operator\s+resets or deletes the preview/);
  assert.match(main, /never promoted/);
});

test("no public control-plane controls are rendered", async () => {
  const main = await read("src/main.ts");

  assert.doesNotMatch(main, /id="(deploy|promote|rollback|snapshot|reset|delete|publish|start|stop)"/i);
});
