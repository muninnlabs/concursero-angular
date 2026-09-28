import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { SqlUserStore, type SqlDatabase } from './sql-store.ts';

const SCHEMA = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '0001_initial.sql'),
  'utf8',
);

/** node:sqlite adapter for local development and tests. Pass ':memory:' for tests. */
export function createSqliteStore(dbPath: string): SqlUserStore {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

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
