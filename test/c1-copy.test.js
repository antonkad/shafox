import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The manual `Snapshot now` action proved unusable on this storage-v2 project,
// so it must not reappear in the visible c1 copy. This reads the rendered
// layout source directly — no build harness.
const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

test("visible c1 copy never promises the owner a manual snapshot", async () => {
  const main = await read("src/main.ts");
  assert.doesNotMatch(main, /snapshot\s*now/i, "`Snapshot now` must not appear in visible c1 copy");
});

test("c1 keeps the upload-a-picture, add-a-row, deploy-commit-2 sequence", async () => {
  const main = await read("src/main.ts");
  assert.match(main, /Upload a picture/);
  assert.match(main, /Add a row/);
  assert.match(main, /deploys commit 2/);
});
