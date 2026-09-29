// Cloudflare Worker entry: serves the whole app under munninlabs.com/concursero-angular/.
//   /concursero-angular/api/*  → the API (app.ts), exams from static assets, users in D1
//   /concursero-angular/*      → static files (Angular build, exam JSON, question images),
//                                falling back to index.html for Angular routes
import { createApp } from './app.ts';
import { firebaseVerifier } from './auth/firebase.ts';
import { AssetsExamSource } from './exams/assets-source.ts';
import { createD1Store } from './users/d1-store.ts';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
}

const BASE = '/concursero-angular/';

let api: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === BASE.slice(0, -1)) return Response.redirect(`${url.origin}${BASE}${url.search}`, 301);
    if (!url.pathname.startsWith(BASE)) return new Response('Not found', { status: 404 });

    if (url.pathname.startsWith(`${BASE}api/`)) {
      api ??= createApp({
        exams: new AssetsExamSource(env.ASSETS, BASE),
        store: createD1Store(env.DB),
        verifyToken: firebaseVerifier(env.FIREBASE_PROJECT_ID),
      });
      // The API's routes start at /api; drop the public prefix.
      const inner = new URL(url);
      inner.pathname = url.pathname.slice(BASE.length - 1);
      return api.fetch(new Request(inner, request));
    }

    const asset = await env.ASSETS.fetch(request);
    // Angular routes (/concursero-angular/app, /entrar, …) aren't files: serve the app shell.
    if (asset.status === 404 && request.method === 'GET' && !url.pathname.split('/').pop()?.includes('.')) {
      // Ask for the folder, not index.html: the asset handler redirects /index.html to /.
      return env.ASSETS.fetch(new Request(new URL(BASE, url), request));
    }
    return asset;
  },
} satisfies ExportedHandler<Env>;
