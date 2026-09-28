import { SqlUserStore, type SqlDatabase } from './sql-store.ts';

/** Cloudflare D1 adapter. The schema is applied with `wrangler d1 migrations apply`. */
export function createD1Store(db: D1Database): SqlUserStore {
  const adapter: SqlDatabase = {
    async all<T>(sql: string, params: unknown[] = []) {
      return (await db.prepare(sql).bind(...params).all<T>()).results;
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return (await db.prepare(sql).bind(...params).first<T>()) ?? undefined;
    },
    async batch(statements) {
      if (statements.length) await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
    },
  };
  return new SqlUserStore(adapter);
}
