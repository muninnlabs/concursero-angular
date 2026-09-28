import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { ExamCatalog } from './exams/catalog.ts';
import { SqliteUserStore } from './users/sqlite-store.ts';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const port = Number(process.env.PORT ?? 3000);
const assetsDir = path.resolve(process.env.ASSETS_DIR ?? path.join(serverDir, '..', 'assets'));
const dbPath = path.resolve(process.env.DB_PATH ?? path.join(serverDir, 'data', 'concursero.db'));

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  jwtSecret = randomBytes(32).toString('hex');
  console.warn('JWT_SECRET not set: using a random one, so logins reset when the server restarts.');
}

const catalog = await ExamCatalog.load(assetsDir);
const store = new SqliteUserStore(dbPath);

createApp({ catalog, store, jwtSecret, assetsDir }).listen(port, () => {
  console.log(`API on http://localhost:${port} — ${catalog.list().length} exams, ${catalog.totalQuestions()} questions from ${assetsDir}`);
});
