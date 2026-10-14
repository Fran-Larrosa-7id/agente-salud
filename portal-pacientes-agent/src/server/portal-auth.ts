import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request } from 'express';
import type { Config } from '../config.js';
import type { JobManager } from '../jobs/job-manager.js';

type RequestLike = { secure?: boolean; headers: Request['headers'] };

/** Reconoce HTTPS directo o terminado por un proxy que reenvía X-Forwarded-Proto. */
export function isSecureRequest(req: RequestLike): boolean {
  if (req.secure) return true;
  const forwarded = req.headers['x-forwarded-proto'];
  return String(forwarded || '').split(',')[0].trim().toLowerCase() === 'https';
}

/** Origen externo visto por el navegador, conservando el esquema tras el proxy. */
export function requestOrigin(req: RequestLike): string | null {
  const host = req.headers.host;
  if (!host) return null;
  try { return new URL(`${isSecureRequest(req) ? 'https' : 'http'}://${host}`).origin; } catch { return null; }
}

/** Una identidad de piloto, con sesiones independientes por navegador; ningún secreto en localStorage. */
export function installPortalAuth(app: Express, config: Config, manager: JobManager): void {
  const enabled = !!config.portalAuth;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const expected = hash(`${config.portalAuth?.username}:${config.portalAuth?.password}`);
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const ttl = 12 * 60 * 60 * 1000;
  const key = (req: Request) => {
    const token = /(?:^|;\s*)portal_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    return token ? hash(token).toString('hex') : '';
  };
  const authenticated = (req: Request) => !enabled || (sessions.get(key(req)) || 0) > Date.now();
  app.use((req, res, next) => {
    if (enabled && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      let sameOrigin = false;
      try { sameOrigin = !!origin && new URL(origin).origin === requestOrigin(req); } catch {}
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !sameOrigin && !config.allowedOrigins.includes(origin))) {
        return void res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      }
    }
    next();
  });
  app.use('/api/auth', express.json({ limit: '2kb' }), (_req, res, next) => { res.set('cache-control', 'no-store'); next(); });
  app.get('/api/auth/session', (req, res) => res.json({ enabled, authenticated: authenticated(req) }));
  app.post('/api/auth/login', (req, res) => {
    if (!enabled) return void res.json({ authenticated: true });
    const address = req.ip || 'local';
    let limit = attempts.get(address);
    if (!limit || limit.until <= Date.now()) {
      for (const [id, value] of attempts) if (value.until <= Date.now()) attempts.delete(id);
      if (attempts.size >= 256) attempts.delete(attempts.keys().next().value!);
      limit = { count: 0, until: Date.now() + 60000 }; attempts.set(address, limit);
    }
    if (++limit.count > 20) return void res.status(429).json({ error: 'LOGIN_RATE_LIMIT' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !timingSafeEqual(hash(`${username}:${password}`), expected)) {
      return void res.status(401).json({ error: 'INVALID_LOGIN' });
    }
    attempts.delete(address);
    for (const [id, expires] of sessions) if (expires <= Date.now()) sessions.delete(id);
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString('hex');
    sessions.delete(key(req)); sessions.set(hash(token).toString('hex'), Date.now() + ttl);
    res.cookie('portal_session', token, { httpOnly: true, sameSite: 'strict', secure: isSecureRequest(req), path: '/', maxAge: ttl });
    res.json({ authenticated: true });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const valid = authenticated(req);
    sessions.delete(key(req));
    res.clearCookie('portal_session', { httpOnly: true, sameSite: 'strict', secure: isSecureRequest(req), path: '/' });
    if (valid) await Promise.all(manager.activeJobs().map(job => manager.cancel(job.id)));
    res.json({ authenticated: false });
  });
  app.use((req, res, next) => {
    const privatePath = req.path.startsWith('/api/') || req.path.startsWith('/remote/') || req.path.startsWith('/remote-assets/');
    if (!privatePath || authenticated(req)) return next();
    res.set('cache-control', 'no-store');
    if (req.path.startsWith('/remote/')) return void res.redirect(303, '/?returnTo=' + encodeURIComponent(req.originalUrl) + '#/login');
    res.status(401).json({ error: 'UNAUTHORIZED' });
  });
}
