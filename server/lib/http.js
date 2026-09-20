// http.js — small, dependency-free request helpers shared by every route.
//
// All of these are deliberately pure/injectable so they can be unit-tested
// without a cluster: body limits, same-origin mutation checks and the
// best-effort per-client rate limiter.

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

export function sendJSON(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(data);
}

/**
 * Read a request body with a hard byte cap. Resolves a Buffer on success and
 * rejects with BodyTooLargeError the moment the cap is exceeded (the caller
 * responds and destroys the socket). A transport error resolves to empty.
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        cleanup();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.alloc(0));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** The host a request effectively targeted, honouring a proxy's forwarded host. */
export function effectiveHost(req) {
  const forwarded = req.headers["x-forwarded-host"];
  if (forwarded) return String(forwarded).split(",")[0].trim().toLowerCase();
  const host = req.headers.host;
  return host ? String(host).trim().toLowerCase() : "";
}

/**
 * CSRF-style guard for browser mutations: the Origin, when present, must match
 * the effective request host. No Origin (curl, server-to-server) may proceed.
 */
export function originAllowed(origin, host) {
  if (!origin) return true;
  if (origin === "null") return false;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return originHost === String(host).toLowerCase();
}

// Distinct client keys are bounded so a caller rotating spoofed IPs cannot grow
// the limiter's Map without limit. This is a best-effort memory cap, NOT
// distributed protection: eviction only forgets a client's recent hits.
const MAX_RATE_LIMIT_KEYS = 10_000;

/**
 * Best-effort in-memory sliding-window limiter, keyed per client.
 *
 * The key set is bounded by `maxKeys` (default 10_000). On every check the
 * touched key is moved to the most-recent end, and once the map is full the
 * least-recently-seen key is evicted before the new one is inserted. Eviction is
 * deterministic given the same call sequence and clock, and only ever resets an
 * evicted client's window — it never grants access to a still-tracked client.
 */
export class RateLimiter {
  constructor({ limit, windowMs, now = Date.now, maxKeys = MAX_RATE_LIMIT_KEYS }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = Math.max(1, maxKeys);
    this.hits = new Map();
  }

  check(key) {
    const t = this.now();
    const recent = (this.hits.get(key) || []).filter((ts) => t - ts < this.windowMs);

    // Refresh recency (delete + set moves the key to the end) and keep the map
    // within its bound before inserting this key's entry.
    this.hits.delete(key);
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      this.hits.delete(oldest);
    }

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const retryMs = this.windowMs - (t - recent[0]);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}

// Header text is attacker-controlled and can be arbitrarily long. We never use
// raw header text as a Map key: take the first value, trim, lowercase and cap
// the length so one hostile request cannot grow the limiter's map without bound.
const MAX_CLIENT_KEY_LENGTH = 64;

function normalizeClientKey(raw) {
  if (raw === undefined || raw === null) return "";
  const first = String(raw).split(",")[0].trim().toLowerCase();
  return first.slice(0, MAX_CLIENT_KEY_LENGTH);
}

/**
 * Best-effort client identity for rate limiting. Behind the trusted reverse
 * proxy we prefer `cf-connecting-ip`, then the first `x-forwarded-for` address,
 * then the raw socket address. These headers are spoofable by anyone who can
 * reach the origin directly, so this only ever feeds a best-effort limiter —
 * never an authorization decision.
 */
export function clientKey(req) {
  const headers = req?.headers || {};
  const cf = normalizeClientKey(headers["cf-connecting-ip"]);
  if (cf) return cf;
  const forwarded = normalizeClientKey(headers["x-forwarded-for"]);
  if (forwarded) return forwarded;
  const remote = normalizeClientKey(req?.socket?.remoteAddress);
  return remote || "unknown";
}
