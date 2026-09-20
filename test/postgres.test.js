import test from "node:test";
import assert from "node:assert/strict";

import { createRowsStore } from "../server/lib/postgres.js";

test("rows store is null without a url and no injected pool", () => {
  assert.equal(createRowsStore(null), null);
  assert.equal(createRowsStore({}), null);
});

test("add inserts exactly one tagged row then trims to the newest 50", async () => {
  const stored = [];
  let nextId = 1;
  const queries = [];
  const pool = {
    async query(text, params) {
      queries.push({ text, params });
      if (text.startsWith("CREATE TABLE")) return { rows: [] };
      if (text.startsWith("INSERT")) {
        const row = {
          id: nextId++,
          commit_sha: params[0],
          short_sha: params[1],
          created_at: new Date("2026-01-02T03:04:05Z"),
        };
        stored.unshift(row);
        return { rows: [row] };
      }
      if (text.startsWith("DELETE")) return { rows: [] };
      if (text.startsWith("SELECT")) return { rows: stored.slice(0, params[0]) };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const store = createRowsStore({ url: "postgres://test" }, { pool });
  assert.equal(store.provisioned, true);

  const out = await store.add({ commit: "FULLSHA", shortSha: "fullsha" });
  assert.deepEqual(out.row, {
    id: 1,
    commit: "FULLSHA",
    shortSha: "fullsha",
    ts: "2026-01-02T03:04:05.000Z",
  });
  assert.deepEqual(out.rows, [out.row]);

  const insert = queries.find((q) => q.text.startsWith("INSERT"));
  assert.deepEqual(insert.params, ["FULLSHA", "fullsha"]);
  const del = queries.find((q) => q.text.startsWith("DELETE"));
  assert.deepEqual(del.params, [50]);
  const select = queries.find((q) => q.text.startsWith("SELECT"));
  assert.deepEqual(select.params, [50]);
  assert.equal(queries.filter((q) => q.text.startsWith("CREATE TABLE")).length, 1);
});

test("list maps rows newest-first and bounds the query", async () => {
  const queries = [];
  const pool = {
    async query(text, params) {
      queries.push({ text, params });
      if (text.startsWith("CREATE TABLE")) return { rows: [] };
      if (text.startsWith("SELECT")) {
        return {
          rows: [
            { id: 2, commit_sha: "B", short_sha: "bbbbbbb", created_at: "2026-02-03T00:00:00.000Z" },
            { id: 1, commit_sha: "A", short_sha: "aaaaaaa", created_at: new Date("2026-02-01T00:00:00Z") },
          ],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const store = createRowsStore({ url: "postgres://test" }, { pool });
  const list = await store.list();
  assert.deepEqual(list, [
    { id: 2, commit: "B", shortSha: "bbbbbbb", ts: "2026-02-03T00:00:00.000Z" },
    { id: 1, commit: "A", shortSha: "aaaaaaa", ts: "2026-02-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(queries.find((q) => q.text.startsWith("SELECT")).params, [50]);
});
