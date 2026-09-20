import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin the stable stage colour: c3 is yellow, and the blue/green/yellow mapping is
// fixed and legible. The page accent must come from the stage, never from the
// commit SHA (the SHA still drives the codename and the per-written-commit
// provenance badges). These read the source directly — no build harness.
const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

// The expected stage mapping, with the literal `on` constant each stage uses.
const STAGES = {
  c1: { key: "blue", color: "#347a9e", on: "CREAM" },
  c2: { key: "green", color: "#5a7d42", on: "CREAM" },
  c3: { key: "yellow", color: "#caa435", on: "INK" },
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("c3 selects the yellow stage and the page accent is not SHA-derived", async () => {
  const vineyard = await read("src/vineyard.ts");
  assert.match(vineyard, /export const STAGE:\s*Stage\s*=\s*"c3"/, "c3 must select the yellow stage");
  assert.match(vineyard, /export function stageAccent\(/, "a stageAccent() selector must exist");

  const main = await read("src/main.ts");
  assert.match(main, /const accent = stageAccent\(\)/, "the page accent must come from the stage");
  assert.doesNotMatch(main, /const accent = commitAccent\(/, "the page accent must not come from the SHA");
});

test("the pre-boot fallback and visible tagline agree with c3 yellow", async () => {
  const css = await read("src/style.css");
  assert.match(css, /--accent:\s*#caa435/, "the pre-boot fallback must be the c3 yellow");

  const main = await read("src/main.ts");
  assert.match(main, /stage three yellow/, "the visible tagline must name stage three yellow");
});

test("stage palette pins blue/green/yellow to their Vineyard values", async () => {
  const vineyard = await read("src/vineyard.ts");
  for (const [stage, spec] of Object.entries(STAGES)) {
    const line = new RegExp(
      `${stage}:\\s*\\{[^}]*key:\\s*"${spec.key}"[^}]*color:\\s*"${spec.color}"[^}]*on:\\s*${spec.on}`
    );
    assert.match(vineyard, line, `${stage} must map to ${spec.key} ${spec.color} on ${spec.on}`);
  }
});

test("every stage foreground is legible on its block colour (WCAG AA)", async () => {
  const vineyard = await read("src/vineyard.ts");
  const cream = vineyard.match(/export const CREAM = "(#[0-9a-f]{6})"/i)[1];
  const ink = vineyard.match(/export const INK = "(#[0-9a-f]{6})"/i)[1];

  for (const [stage, spec] of Object.entries(STAGES)) {
    const fg = spec.on === "CREAM" ? cream : ink;
    const ratio = contrast(spec.color, fg);
    assert.ok(
      ratio >= 4.5,
      `${stage}: foreground ${fg} on ${spec.color} is ${ratio.toFixed(2)}:1, needs >= 4.5:1`
    );
  }
});

test("per-written-commit provenance badges stay SHA-derived", async () => {
  const main = await read("src/main.ts");
  assert.match(main, /function shaBadge[\s\S]*?commitAccent\(commit\)/, "sha badges must use commitAccent");
  assert.match(main, /commitAccent\(m\.commit\)/, "mark dots must use commitAccent");
});
