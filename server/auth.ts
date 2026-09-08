import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Router, type RequestHandler } from 'express';
import { createRateLimiter } from './rate-limit.js';

const COOKIE = 'jobs_session';
const SESSION_MS = 24 * 60 * 60 * 1000;

/** Compare fixed-size digests without disclosing a credential through timing. */
export function tokenMatches(candidate: unknown, expected: string | null): boolean {
  if (!expected) return true;
  if (typeof candidate !== 'string' || candidate.length > 4096) return false;
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

function bearer(req: IncomingMessage): string | undefined {
  return req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
}

/** Browsers must connect from this origin; non-browser integrations omit Origin. */
export function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
  } catch {
    return false;
  }
}

export function requireBearer(token: string | null): RequestHandler {
  return (req, res, next) => {
    if (!sameOrigin(req) || !tokenMatches(bearer(req), token)) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }
    next();
  };
}

/** Server-owned, revocable sessions. The configured token never goes into HTML/storage. */
export class ViewerAuth {
  private readonly sessions = new Map<string, number>();

  constructor(
    readonly token: string | null,
    private readonly sessionMs = SESSION_MS,
    private readonly secureCookie = process.env.COOKIE_SECURE === 'true',
  ) {}

  private sessionId(req: IncomingMessage): string | undefined {
    return req.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }

  authenticated(req: IncomingMessage): boolean {
    if (!this.token || tokenMatches(bearer(req), this.token)) return true;
    const id = this.sessionId(req);
    if (!id) return false;
    const expires = this.sessions.get(id);
    if (expires && expires > Date.now()) return true;
    this.sessions.delete(id);
    return false;
  }

  canConnect(req: IncomingMessage): boolean {
    return sameOrigin(req) && this.authenticated(req);
  }

  readonly requireViewer: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.canConnect(req)) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }
    next();
  };

  router(wsPath: string): Router {
    const router = Router();
    const loginLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    router.use('/api/auth', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });
    router.get('/api/auth', (req, res) => {
      res.json({ required: !!this.token, authenticated: this.canConnect(req), wsPath });
    });
    router.post('/api/auth/login', loginLimiter, (req, res) => {
      if (!sameOrigin(req)) {
        res.status(403).json({ ok: false, error: 'Use this office to sign in' });
        return;
      }
      if (!tokenMatches(req.body?.token, this.token)) {
        res.status(401).json({ ok: false, error: 'Incorrect access token' });
        return;
      }
      for (const [id, expires] of this.sessions) {
        if (expires <= Date.now()) this.sessions.delete(id);
      }
      if (this.sessions.size >= 1000) {
        res.status(503).json({ ok: false, error: 'Session limit reached. Try again later.' });
        return;
      }
      const previous = this.sessionId(req);
      if (previous) this.sessions.delete(previous);
      if (this.token) {
        const id = randomBytes(32).toString('hex');
        this.sessions.set(id, Date.now() + this.sessionMs);
        res.cookie(COOKIE, id, {
          httpOnly: true, sameSite: 'strict', secure: this.secureCookie || req.secure,
          path: '/', maxAge: this.sessionMs,
        });
      }
      res.json({ ok: true });
    });
    router.post('/api/auth/logout', (req, res) => {
      if (!sameOrigin(req)) {
        res.status(403).json({ ok: false, error: 'Invalid origin' });
        return;
      }
      const id = this.sessionId(req);
      if (id) this.sessions.delete(id);
      res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: this.secureCookie || req.secure, path: '/' });
      res.json({ ok: true });
    });
    return router;
  }
}
