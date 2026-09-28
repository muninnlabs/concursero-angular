import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { TokenService, authRoutes } from './auth/auth.ts';
import type { ExamCatalog } from './exams/catalog.ts';
import { examRoutes } from './exams/routes.ts';
import { statsRoutes } from './stats/routes.ts';
import type { UserStore } from './users/store.ts';

export interface AppDeps {
  catalog: ExamCatalog;
  store: UserStore;
  jwtSecret: string;
  assetsDir: string;
}

export function createApp({ catalog, store, jwtSecret, assetsDir }: AppDeps) {
  const app = express();
  const tokens = new TokenService(jwtSecret);

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes(store, tokens));
  app.use('/api', examRoutes(catalog));
  app.use('/api', statsRoutes(catalog, store, tokens));

  // Question images keep the Flutter paths ("assets/images/x.png"), so the
  // image_url in the JSON works as-is. The exam JSON is deliberately NOT served
  // statically: it contains the answer key.
  app.use('/assets/images', express.static(path.join(assetsDir, 'images'), { maxAge: '7d', fallthrough: false }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    if (status && status < 500) {
      res.status(status).json({ error: 'Requisição inválida' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
