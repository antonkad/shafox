import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import {
  BodyTooLargeError,
  RateLimiter,
  clientKey,
  effectiveHost,
  originAllowed,
  readBody,
} from "../server/lib/http.js";

// ---- origin guard ---------------------------------------------------------

test("origin: no Origin is allowed (non-browser client)", () => {
  assert.equal(originAllowed(undefined, "example.test"), true);
  assert.equal(originAllowed("", "example.test"), true);
});

test("origin: matching host is allowed", () => {
  assert.equal(originAllowed("http://example.test", "example.test"), true);
  assert.equal(originAllowed("https://example.test:8443", "example.test:8443"), true);
});

test("origin: mismatched host is refused", () => {
  assert.equal(originAllowed("https://evil.test", "example.test"), false);
  assert.equal(originAllowed("https://example.test", "other.test"), false);
});

test("origin: opaque and malformed origins are refused", () => {
  assert.equal(originAllowed("null", "example.test"), false);
  assert.equal(originAllowed("not a url", "example.test"), false);
});

test("effectiveHost prefers x-forwarded-host then host", () => {
  assert.equal(effectiveHost({ headers: { host: "a.test" } }), "a.test");
  assert.equal(
    effectiveHost({ headers: { host: "internal:8080", "x-forwarded-host": "public.test, proxy.test" } }),
    "public.test"
  );
});

// ---- body limit -----------------------------------------------------------

test("readBody returns the body under the limit", async () => {
  const buf = await readBody(Readable.from([Buffer.from("hello "), Buffer.from("world")]), 64);
  assert.equal(buf.toString(), "hello world");
});

test("readBody rejects the moment the limit is exceeded", async () => {
  await assert.rejects(
    readBody(Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), 15),
    (err) => err instanceof BodyTooLargeError
  );
});

// ---- client key -----------------------------------------------------------

test("clientKey prefers cf-connecting-ip, then x-forwarded-for, then remote", () => {
  assert.equal(
    clientKey({
      headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "203.0.113.9"
  );
  assert.equal(
    clientKey({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }),
    "203.0.113.9"
  );
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  assert.equal(clientKey({ headers: {} }), "unknown");
});

test("clientKey skips blank headers and normalizes case/whitespace", () => {
  assert.equal(clientKey({ headers: { "cf-connecting-ip": "   ", "x-forwarded-for": "1.2.3.4" } }), "1.2.3.4");
  assert.equal(clientKey({ headers: { "cf-connecting-ip": "  203.0.113.9  " } }), "203.0.113.9");
});

test("clientKey caps hostile unbounded header text", () => {
  const key = clientKey({ headers: { "x-forwarded-for": `${"A".repeat(500)}, 10.0.0.1` } });
  assert.equal(key.length, 64);
  assert.equal(key, "a".repeat(64));
});

// ---- rate limiter ---------------------------------------------------------

test("rate limiter allows up to the limit then returns retry advice", () => {
  let now = 1_000_000;
  const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.equal(rl.check("ip").allowed, true);
  assert.equal(rl.check("ip").allowed, true);
  assert.equal(rl.check("ip").allowed, true);
  const blocked = rl.check("ip");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  // A different client is unaffected.
  assert.equal(rl.check("other").allowed, true);

  // Window slides.
  now += 1001;
  assert.equal(rl.check("ip").allowed, true);
});

test("rate limiter bounds the number of distinct keys", () => {
  const rl = new RateLimiter({ limit: 5, windowMs: 1000, maxKeys: 4 });
  for (let i = 0; i < 100; i++) rl.check(`ip-${i}`);
  assert.equal(rl.hits.size, 4);
  assert.ok(rl.hits.size <= 4);
});

test("bounded limiter evicts the least-recently-used key", () => {
  let now = 0;
  const rl = new RateLimiter({ limit: 5, windowMs: 1000, maxKeys: 2, now: () => now });
  rl.check("a");
  now += 1;
  rl.check("b");
  now += 1;
  rl.check("a"); // touch "a" so "b" is now the least recently used
  now += 1;
  rl.check("c"); // evicts "b"
  assert.equal(rl.hits.has("b"), false);
  assert.equal(rl.hits.has("a"), true);
  assert.equal(rl.hits.has("c"), true);
  assert.equal(rl.hits.size, 2);
});

test("an evicted client starts a fresh window instead of inheriting a block", () => {
  let now = 0;
  const rl = new RateLimiter({ limit: 1, windowMs: 1000, maxKeys: 1, now: () => now });
  assert.equal(rl.check("a").allowed, true);
  assert.equal(rl.check("a").allowed, false); // "a" is now blocked
  rl.check("b"); // evicts "a"
  now += 1;
  assert.equal(rl.check("a").allowed, true); // fresh window after eviction
});

test("rate limiter default bound is finite", () => {
  const rl = new RateLimiter({ limit: 5, windowMs: 1000 });
  for (let i = 0; i < 20_000; i++) rl.check(`ip-${i}`);
  assert.ok(rl.hits.size <= 10_000);
});
