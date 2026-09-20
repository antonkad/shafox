// config.js — reads the environment once and describes which backends are
// wired. A backend is either fully provisioned or absent; a PARTIAL set of
// vars (e.g. a DSN but no bucket) must render as "not provisioned" rather than
// crashing the server or its unrelated slots.

import { join } from "node:path";
import { resolveIdentity } from "./identity.js";

export function readS3(env) {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;
  const region = env.S3_REGION;
  const forcePathStyleRaw = env.S3_FORCE_PATH_STYLE;

  const present = [endpoint, bucket, accessKeyId, secretAccessKey, region, forcePathStyleRaw];
  if (present.some((v) => v === undefined || v === null || String(v).trim() === "")) {
    return null; // partial or missing => not provisioned
  }
  return {
    endpoint: String(endpoint),
    bucket: String(bucket),
    accessKeyId: String(accessKeyId),
    secretAccessKey: String(secretAccessKey),
    region: String(region),
    forcePathStyle: !(String(forcePathStyleRaw).toLowerCase() === "false" || String(forcePathStyleRaw) === "0"),
  };
}

export function readConfig(env = process.env) {
  const dataDir =
    env.DATA_DIR || env.STORAGE_PATH || (env.NODE_ENV === "production" ? "/data" : "./.data");
  return {
    port: Number(env.PORT || 8080),
    dataDir,
    guestbookPath: join(dataDir, "guestbook.json"),
    distDir: join(process.cwd(), "dist"),
    identity: resolveIdentity(env),
    postgres: env.DATABASE_URL ? { url: String(env.DATABASE_URL) } : null,
    s3: readS3(env),
  };
}
