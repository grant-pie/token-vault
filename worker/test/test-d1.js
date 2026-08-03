// A minimal D1-compatible shim backed by node:sqlite, used so credits.js's
// ledger logic (spendCredits/grantCredits/getBalance) can be tested against a
// real SQLite engine running the project's actual migrations, instead of a
// hand-rolled re-implementation of D1's semantics that could silently drift
// from how SQLite really evaluates WHERE/ON CONFLICT/RETURNING.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function applyMigrations(sqliteDb) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqliteDb.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
}

// D1 statements only need the handful of methods credits.js actually calls:
// .bind(...).first() for single reads, and being handed to db.batch() as an
// array for the two-statement atomic writes.
function makeBoundStatement(sqliteDb, sql, params) {
  return {
    sql,
    params,
    async first() {
      const row = sqliteDb.prepare(sql).get(...params);
      return row ?? null;
    },
  };
}

// Real D1 returns `{ results, success, meta }` per batched statement; only
// `.results` is read by credits.js, so that's all this reproduces.
function runBatchStatement(sqliteDb, { sql, params }) {
  const compiled = sqliteDb.prepare(sql);
  if (/\bRETURNING\b/i.test(sql)) {
    return { results: compiled.all(...params) };
  }
  compiled.run(...params);
  return { results: [] };
}

export function createTestD1() {
  const sqliteDb = new DatabaseSync(":memory:");
  applyMigrations(sqliteDb);

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return makeBoundStatement(sqliteDb, sql, params);
        },
      };
    },
    // D1's batch() runs every statement as one atomic transaction — real
    // callers (grantCredits/spendCredits) depend on that for consistency, so
    // this wraps the same statements in BEGIN/COMMIT rather than just running
    // them one after another.
    async batch(statements) {
      sqliteDb.exec("BEGIN");
      try {
        const results = statements.map((stmt) => runBatchStatement(sqliteDb, stmt));
        sqliteDb.exec("COMMIT");
        return results;
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
