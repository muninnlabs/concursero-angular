// Local development server: `npm run dev` (from the repo root or server/).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { firebaseVerifier } from './auth/firebase.ts';
import { StripeBilling } from './billing/stripe.ts';
import { loadExamsFromDisk } from './exams/fs-source.ts';
import { SiteStore } from './site/site-store.ts';
import { SqlUserStore } from './users/sql-store.ts';
import { sqliteDatabase } from './users/sqlite-store.ts';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 3000);
const assetsDir = path.resolve(process.env.ASSETS_DIR ?? path.join(serverDir, '..', 'assets'));
const dbPath = path.resolve(process.env.DB_PATH ?? path.join(serverDir, 'data', 'concursero.db'));
const projectId = process.env.FIREBASE_PROJECT_ID ?? 'concursero-8cc5b';

const exams = await loadExamsFromDisk(assetsDir);
const examCount = (await exams.list()).length;
// Payments are off unless server/.env has the Stripe test keys (see README).
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID } = process.env;
const billing =
  STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET && STRIPE_PRICE_ID
    ? new StripeBilling({ secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET, priceId: STRIPE_PRICE_ID, portalConfig: process.env.STRIPE_PORTAL_CONFIG || undefined })
    : undefined;
const db = sqliteDatabase(dbPath);
const api = createApp({
  exams,
  store: new SqlUserStore(db),
  site: new SiteStore(db),
  verifyToken: firebaseVerifier(projectId),
  billing,
  appUrl: process.env.APP_URL ?? 'http://localhost:4200',
});

const app = new Hono();
// Question images keep the Flutter paths ("assets/images/x.png"), so the
// image_url in the JSON works unchanged. The exam JSON itself isn't served here.
app.use('/assets/images/*', serveStatic({ root: path.relative(process.cwd(), path.dirname(assetsDir)) || '.' }));
app.route('/', api);

serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}: ${examCount} exams from ${assetsDir}`);
});
