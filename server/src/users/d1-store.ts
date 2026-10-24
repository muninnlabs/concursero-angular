import { SqlUserStore, type SqlDatabase } from './sql-store.ts';

/** Cloudflare D1 adapter. The schema is applied with `wrangler d1 migrations apply`. */
export function createD1Store(db: D1Database): SqlUserStore {
  return new SqlUserStore(d1Database(db));
}

/** The D1 database behind the stores (SqlUserStore, SiteStore). */
export function d1Database(db: D1Database): SqlDatabase {
  return {
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
}
