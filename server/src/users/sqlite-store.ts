import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { SqlUserStore, type SqlDatabase } from './sql-store.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));

/**
 * Applies the migrations the database hasn't seen yet, tracked in
 * PRAGMA user_version (D1 keeps its own table via wrangler instead).
 */
function migrate(db: DatabaseSync) {
  const { user_version: applied } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  MIGRATIONS.slice(applied).forEach((sql, i) => {
    db.exec('BEGIN');
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${applied + i + 1}`);
    db.exec('COMMIT');
  });
}

/** node:sqlite adapter for local development and tests. Pass ':memory:' for tests. */
export function createSqliteStore(dbPath: string): SqlUserStore {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);

  const adapter: SqlDatabase = {
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const { sql, params } of statements) db.prepare(sql).run(...(params as SQLInputValue[]));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return new SqlUserStore(adapter);
}
