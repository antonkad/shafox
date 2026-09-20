// identity.js — the single source of truth for "which commit is writing".
//
// The guestbook, the Postgres rows and the S3 object metadata all resolve the
// writing commit through here, so every mark of state on this page carries the
// same SHA. It mirrors the build-time resolution in vite.config.ts.

import { execSync } from "node:child_process";

export const DEV_SENTINEL = "devfox0000000000000000000000000000000000";

export function shortSha(commit) {
  const hex = (String(commit).match(/[0-9a-f]/gi)?.join("") || String(commit)).toLowerCase();
  return hex.slice(0, 7);
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

/**
 * Resolve the runtime identity from env, then local git, then a dev sentinel.
 * `allowGit: false` keeps tests deterministic (no reliance on the checkout).
 */
export function resolveIdentity(env = process.env, { allowGit = true } = {}) {
  const commit =
    env.SHAFOX_COMMIT ||
    env.COMMIT_SHA ||
    env.GIT_COMMIT ||
    env.GITHUB_SHA ||
    env.BUILD_COMMIT_SHA || // kad.dev sets this on the pod (short hash)
    env.BUILD_COMMIT || // kad.dev sets the full SHA in the build container
    (allowGit ? gitHead() : "") ||
    DEV_SENTINEL;
  const ref =
    env.SHAFOX_REF ||
    env.GIT_BRANCH ||
    env.GITHUB_REF_NAME ||
    env.CI_COMMIT_REF_NAME ||
    "";
  const buildTime = env.SHAFOX_BUILD_TIME || env.BUILD_COMMIT_TIME || "";
  return { commit: String(commit), shortSha: shortSha(commit), ref: String(ref), buildTime: String(buildTime) };
}
