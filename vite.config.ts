import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// The whole point of Shafox: the commit SHA is baked into the artifact at
// build time, so every deployed commit carries its own identity. We look at a
// generous set of env vars (kad.dev, GitHub Actions, Vercel, generic CI) and
// fall back to the local git HEAD, then to a dev sentinel.
function resolveCommitSha(): string {
  const fromEnv =
    process.env.SHAFOX_COMMIT ||
    process.env.BUILD_COMMIT || // kad.dev injects the full SHA into the build container
    process.env.COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.GIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CI_COMMIT_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // No git, no env — running outside a checkout. Use a stable dev sentinel so
    // the local experience is deterministic.
    return "devfox0000000000000000000000000000000000";
  }
}

function resolveCommitRef(): string {
  const fromEnv =
    process.env.SHAFOX_REF ||
    process.env.GIT_BRANCH ||
    process.env.GITHUB_REF_NAME ||
    process.env.CI_COMMIT_REF_NAME;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // kad.dev doesn't inject a ref into the build; leave empty so the UI omits
    // the branch line rather than showing a misleading "local".
    return "";
  }
}

const commitSha = resolveCommitSha();
const commitRef = resolveCommitRef();
const buildTime =
  process.env.SHAFOX_BUILD_TIME ||
  process.env.BUILD_COMMIT_TIME || // kad.dev: committer time, RFC3339
  new Date().toISOString();

export default defineConfig({
  define: {
    __SHAFOX_COMMIT__: JSON.stringify(commitSha),
    __SHAFOX_REF__: JSON.stringify(commitRef),
    __SHAFOX_BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
  server: {
    // In dev, proxy the storage API to the Node server (run `npm start` alongside).
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
