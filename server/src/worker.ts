// Cloudflare Worker entry: serves the whole app under BASE_PATH (wrangler.toml), e.g.
// concursero.com/ or staging.concursero.com/ (or a sub-path such as /concursero-angular/).
//   <base>api/*  → the API (app.ts), exams from static assets, users in D1
//   <base>*      → static files (Angular build, exam JSON, question images),
//                  falling back to index.html for Angular routes
import { createApp } from './app.ts';
import { redirectToCanonical } from './canonical.ts';
import { firebaseVerifier } from './auth/firebase.ts';
import { StripeBilling } from './billing/stripe.ts';
import { AssetsExamSource } from './exams/assets-source.ts';
import { SiteStore } from './site/site-store.ts';
import { d1Database } from './users/d1-store.ts';
import { SqlUserStore } from './users/sql-store.ts';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  APP_URL: string;
  /** Public path of the app, with slashes: "/concursero-angular/" or "/". */
  BASE_PATH?: string;
  /** "1" on staging: search engines shouldn't index it. */
  NOINDEX?: string;
  /** Production's own host (concursero.com): other hosts routed here (www, the old munninlabs.com path) redirect to it. */
  CANONICAL_HOST?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PORTAL_CONFIG?: string;
  /** Secrets: `wrangler secret put STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

let api: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const moved = redirectToCanonical(new URL(request.url), env.CANONICAL_HOST);
    if (moved) return Response.redirect(moved, 301);
    const response = await handle(request, env);
    if (env.NOINDEX !== '1') return response;
    const tagged = new Response(response.body, response);
    tagged.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return tagged;
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const BASE = env.BASE_PATH ?? '/';

  if (BASE !== '/' && url.pathname === BASE.slice(0, -1))
    return Response.redirect(`${url.origin}${BASE}${url.search}`, 301);
  if (!url.pathname.startsWith(BASE)) return new Response('Not found', { status: 404 });

  if (url.pathname.startsWith(`${BASE}api/`)) {
    const db = d1Database(env.DB);
    api ??= createApp({
      exams: new AssetsExamSource(env.ASSETS, BASE),
      store: new SqlUserStore(db),
      site: new SiteStore(db),
      verifyToken: firebaseVerifier(env.FIREBASE_PROJECT_ID),
      billing:
        env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID
          ? new StripeBilling({
              secretKey: env.STRIPE_SECRET_KEY,
              webhookSecret: env.STRIPE_WEBHOOK_SECRET,
              priceId: env.STRIPE_PRICE_ID,
              portalConfig: env.STRIPE_PORTAL_CONFIG || undefined,
            })
          : undefined,
      appUrl: env.APP_URL,
    });
    // The API's routes start at /api; drop the public prefix.
    const inner = new URL(url);
    inner.pathname = url.pathname.slice(BASE.length - 1);
    return api.fetch(new Request(inner, request));
  }

  const asset = await env.ASSETS.fetch(request);
  // Angular routes (<base>app, <base>entrar, …) aren't files: serve the app shell.
  if (
    asset.status === 404 &&
    request.method === 'GET' &&
    !url.pathname.split('/').pop()?.includes('.')
  ) {
    // Ask for the folder, not index.html: the asset handler redirects /index.html to /.
    return env.ASSETS.fetch(new Request(new URL(BASE, url), request));
  }
  return asset;
}
