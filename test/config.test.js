import test from "node:test";
import assert from "node:assert/strict";

import { readConfig, readS3 } from "../server/lib/config.js";

const FULL = {
  S3_ENDPOINT: "https://objects.example.test",
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY: "key",
  S3_SECRET_KEY: "secret",
  S3_REGION: "region",
  S3_FORCE_PATH_STYLE: "true",
};

test("readS3 returns null when any required var is missing or blank", () => {
  assert.equal(readS3({}), null);
  for (const key of Object.keys(FULL)) {
    const partial = { ...FULL };
    delete partial[key];
    assert.equal(readS3(partial), null, `missing ${key} must be not provisioned`);
  }
  assert.equal(readS3({ ...FULL, S3_BUCKET: "   " }), null);
});

test("readS3 parses forcePathStyle from its string forms", () => {
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "true" }).forcePathStyle, true);
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "TRUE" }).forcePathStyle, true);
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "1" }).forcePathStyle, true);
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "false" }).forcePathStyle, false);
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "False" }).forcePathStyle, false);
  assert.equal(readS3({ ...FULL, S3_FORCE_PATH_STYLE: "0" }).forcePathStyle, false);
});

test("readConfig keeps a complete backend and drops a partial one", () => {
  const complete = readConfig({ SHAFOX_COMMIT: "abc1234", DATABASE_URL: "postgres://x", ...FULL });
  assert.equal(complete.postgres.url, "postgres://x");
  assert.equal(complete.s3.bucket, "bucket");
  assert.equal(complete.s3.forcePathStyle, true);
  assert.equal(complete.identity.shortSha, "abc1234");

  const partial = readConfig({ SHAFOX_COMMIT: "abc1234", DATABASE_URL: "postgres://x", ...FULL, S3_BUCKET: "" });
  assert.equal(partial.postgres.url, "postgres://x");
  assert.equal(partial.s3, null);
});
