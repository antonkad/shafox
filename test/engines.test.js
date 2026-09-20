import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

function floorMajor(range) {
  const match = /^\s*>=\s*(\d+)(?:\.\d+){0,2}\s*$/.exec(range ?? "");
  assert.ok(match, `engines.node must be a simple ">=x" range, got: ${range}`);
  return Number(match[1]);
}

test("root engines.node satisfies every runtime dependency's floor", () => {
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.ok(deps.length > 0, "expected at least one runtime dependency");
  const rootFloor = floorMajor(pkg.engines?.node);
  for (const name of deps) {
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.ok(entry, `lockfile must contain ${name}`);
    const depFloor = floorMajor(entry.engines?.node);
    assert.ok(
      rootFloor >= depFloor,
      `root engines.node ${pkg.engines.node} is below ${name}'s ${entry.engines.node}`,
    );
  }
});

test("lockfile root engines.node mirrors package.json", () => {
  assert.equal(lock.packages?.[""]?.engines?.node, pkg.engines?.node);
});
