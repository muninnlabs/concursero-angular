import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { EmailTakenError, type User, type UserStore } from '../users/store.ts';
import { hashPassword, verifyPassword } from './password.ts';

const TOKEN_TTL = '7d';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(userId: string): Promise<string> {
    return new SignJWT().setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(TOKEN_TTL).sign(this.key);
  }

  async verify(token: string): Promise<string | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      return payload.sub;
    } catch {
      return undefined;
    }
  }
}

/** Rejects the request with 401 unless it carries a valid `Authorization: Bearer <token>`. */
export function requireAuth(tokens: TokenService) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const userId = header.startsWith('Bearer ') ? await tokens.verify(header.slice(7)) : undefined;
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    req.userId = userId;
    next();
  };
}

export function authRoutes(store: UserStore, tokens: TokenService): Router {
  const router = Router();

  const session = async (user: User) => ({ token: await tokens.sign(user.id), user });

  router.post('/register', async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!name || !EMAIL.test(email) || password.length < 8) {
      res.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.' });
      return;
    }
    try {
      const user = await store.createUser({ name, email, passwordHash: await hashPassword(password) });
      res.status(201).json(await session(user));
    } catch (error) {
      if (error instanceof EmailTakenError) {
        res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
        return;
      }
      throw error;
    }
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const found = await store.findUserByEmail(email);

    if (!found || !(await verifyPassword(password, found.passwordHash))) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }
    const { passwordHash: _hash, ...user } = found;
    res.json(await session(user));
  });

  router.get('/me', requireAuth(tokens), async (req: AuthenticatedRequest, res) => {
    const user = await store.findUserById(req.userId!);
    if (!user) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    res.json(user);
  });

  return router;
}
