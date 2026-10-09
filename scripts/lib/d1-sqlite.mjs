// A stand-in for a Cloudflare D1 database, made of Node's built-in SQLite. It has just the part of D1's API the Worker uses
// (prepare, bind, first, run, all), so the same Worker code runs in tests and in the local server without Cloudflare.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const SCHEMA = new URL("../../worker/schema.sql", import.meta.url);

/** `file` is a path, or ":memory:" for a database that lives only as long as the program. The real schema is applied to it. */
export function localDatabase(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(SCHEMA, "utf8"));
  return {
    raw: db,
    prepare(sql) {
      const statement = db.prepare(sql);
      const make = (values) => ({
        bind: (...more) => make(more),
        first: async () => statement.get(...values) ?? null,
        all: async () => ({ results: statement.all(...values) }),
        run: async () => { statement.run(...values); return { success: true }; },
      });
      return make([]);
    },
  };
}
