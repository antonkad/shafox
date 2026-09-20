import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin the commit-two stage copy so a later edit cannot silently ship the wrong
// stage identity or mis-state the owner's rollback outcomes. These read the
// source files directly: there is no frontend test harness by design.
const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

test("browser title, description and visible brand say commit two", async () => {
  const [html, main] = await Promise.all([read("index.html"), read("src/main.ts")]);

  assert.match(html, /<title>Shafox · two<\/title>/);
  assert.match(html, /content="Commit two of a three-commit tour/);
  assert.match(main, /Shafox <span class="brand-stage">· two<\/span>/);
});

test("next-step slot names commit two and both owner rollback outcomes", async () => {
  const main = await read("src/main.ts");

  assert.match(main, /Commit two of three/);
  assert.match(main, /Add a row<\/b> again/);
  assert.match(main, /Keep current data/);
  assert.match(main, /Restore commit-one data/);
  assert.match(main, /destructive/);
  // The outcomes are described, never offered as visitor controls.
  assert.doesNotMatch(main, /id="(deploy|promote|rollback|snapshot)"/i);
});
