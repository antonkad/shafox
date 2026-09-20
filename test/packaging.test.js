import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin the deploy packaging contract: the dockerfile preset is the only route
// that keeps the Node `/api` server, and the lockfile must stay portable to
// public npm. These read the source files directly — no build harness.
const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

test("Dockerfile is a two-stage Node 20 build that runs the server on 8080", async () => {
  const dockerfile = await read("Dockerfile");

  const stages = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)];
  assert.ok(stages.length >= 2, "expected a multi-stage build");
  assert.match(stages[0][1], /^node:20-slim$/, "build stage must use node:20-slim");
  assert.equal(stages[0][2], "build");
  assert.match(stages.at(-1)[1], /^node:20-slim$/, "runtime stage must use node:20-slim");
  assert.equal(stages.at(-1)[2], "runtime");

  assert.match(dockerfile, /npm ci --ignore-scripts/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /COPY --from=build \/app\/dist \.\/dist/);
  assert.match(dockerfile, /COPY server \.\/server/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /CMD \["node", "server\/index\.js"\]/);
  assert.doesNotMatch(dockerfile, /^USER\s+(?!root\b)/im, "must not switch to a non-root user");
});

test(".dockerignore drops build artifacts but keeps every required source path", async () => {
  const ignore = (await read(".dockerignore"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const required of ["node_modules", "dist", ".git", ".data"]) {
    assert.ok(ignore.includes(required), `.dockerignore must ignore ${required}`);
  }
  for (const needed of [
    "package.json",
    "package-lock.json",
    "server",
    "src",
    "public",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
  ]) {
    assert.ok(!ignore.includes(needed), `.dockerignore must not ignore required path ${needed}`);
  }
});

test("package-lock.json resolves only public npm registry URLs", async () => {
  const lock = JSON.parse(await read("package-lock.json"));

  assert.equal(lock.lockfileVersion, 3);
  const urls = Object.values(lock.packages ?? {})
    .map((entry) => entry?.resolved)
    .filter((resolved) => typeof resolved === "string");
  assert.ok(urls.length > 0, "expected resolved URLs in the lockfile");
  for (const url of urls) {
    assert.match(url, /^https:\/\/registry\.npmjs\.org\//, `non-public resolved URL: ${url}`);
  }
  const text = JSON.stringify(lock);
  assert.doesNotMatch(text, /jfrog|artifactory|adeo/i, "private registry hostname leaked into the lockfile");
});

test("runtime dependencies stay exactly pg and @aws-sdk/client-s3", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const lock = JSON.parse(await read("package-lock.json"));

  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), [
    "@aws-sdk/client-s3",
    "pg",
  ]);
  assert.equal(lock.packages?.[""]?.name, pkg.name);
  assert.equal(lock.packages?.[""]?.version, pkg.version);
});
