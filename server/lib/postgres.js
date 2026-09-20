// postgres.js — lazy Postgres access for the "rows" slot.
//
// `pg` is imported only on first use, so a commit with no DATABASE_URL never
// pays for it and never crashes. The store creates its own tiny table
// idempotently and keeps it bounded to the newest 50 rows.

const KEEP_ROWS = 50;

/**
 * Build the rows store. `deps.pool` lets tests inject a narrow query-only
 * collaborator (`{ query(text, params) }`) instead of opening a real socket.
 */
export function createRowsStore(postgres, deps = {}) {
  const url = postgres?.url;
  const injected = deps.pool;
  if (!url && !injected) return null;

  let poolPromise = null;
  let initPromise = null;

  async function pool() {
    if (injected) return injected;
    if (!poolPromise) {
      poolPromise = import("pg").then((mod) => {
        const pg = mod.default ?? mod;
        const p = new pg.Pool({
          connectionString: url,
          max: 3,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        });
        p.on("error", () => {
          /* a pooled idle client dropped; the next query reconnects */
        });
        return p;
      });
    }
    return poolPromise;
  }

  async function ensureSchema(p) {
    if (!initPromise) {
      initPromise = p
        .query(
          `CREATE TABLE IF NOT EXISTS shafox_rows (
             id BIGSERIAL PRIMARY KEY,
             commit_sha TEXT NOT NULL,
             short_sha TEXT NOT NULL,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )`
        )
        .catch((err) => {
          initPromise = null; // allow a retry on the next request
          throw err;
        });
    }
    return initPromise;
  }

  const map = (r) => ({
    id: Number(r.id),
    commit: r.commit_sha,
    shortSha: r.short_sha,
    ts: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  });

  async function list() {
    const p = await pool();
    await ensureSchema(p);
    const { rows } = await p.query(
      `SELECT id, commit_sha, short_sha, created_at
         FROM shafox_rows
        ORDER BY id DESC
        LIMIT $1`,
      [KEEP_ROWS]
    );
    return rows.map(map);
  }

  async function add({ commit, shortSha }) {
    const p = await pool();
    await ensureSchema(p);
    const { rows } = await p.query(
      `INSERT INTO shafox_rows (commit_sha, short_sha)
       VALUES ($1, $2)
       RETURNING id, commit_sha, short_sha, created_at`,
      [commit, shortSha]
    );
    await p.query(
      `DELETE FROM shafox_rows
        WHERE id NOT IN (SELECT id FROM shafox_rows ORDER BY id DESC LIMIT $1)`,
      [KEEP_ROWS]
    );
    return { row: map(rows[0]), rows: await list() };
  }

  return { provisioned: true, list, add };
}
