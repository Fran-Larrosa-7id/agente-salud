import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request } from 'express';
import type { Config } from '../config.js';
import type { JobManager } from '../jobs/job-manager.js';
import type { GoogleServices } from './google-services.js';
import { DRIVE_SCOPE } from './google-oauth.js';
import { CloudError } from '../storage/errors.js';

type RequestLike = { secure?: boolean; headers: Request['headers'] };
export interface Principal { id: string; email: string; displayName: string }
export interface PortalAccess { resolve(req: RequestLike): Principal | null; owner(req: RequestLike): string | null }

/** Google deployments use the configured public origin, never unverified forwarded headers. */
export function isSecureRequest(req: RequestLike, config?: Config): boolean {
  if (config?.publicBaseUrl) return config.publicBaseUrl.startsWith('https:');
  if (req.secure) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}
export function requestOrigin(req: RequestLike, config?: Config): string | null {
  if (config?.publicBaseUrl) return config.publicBaseUrl;
  if (!req.headers.host) return null;
  try { return new URL(`${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}`).origin; } catch { return null; }
}
const cookie = (req: RequestLike, name: string) => new RegExp('(?:^|;\\s*)' + name + '=([a-f0-9]{64})(?:;|$)').exec(req.headers.cookie || '')?.[1] || '';

export function installPortalAuth(app: Express, config: Config, manager: JobManager, google?: GoogleServices): PortalAccess {
  const googleMode = config.authMode === 'google';
  if (googleMode && (!google || !config.google)) throw new Error('GOOGLE_NOT_CONFIGURED');
  const enabled = googleMode || !!config.portalAuth;
  const hash = (value: string) => googleMode ? createHmac('sha256', config.google!.sessionSecret).update(value).digest() : createHash('sha256').update(value).digest();
  const key = (req: RequestLike) => hash(cookie(req, 'portal_session')).toString('hex');
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const ttl = googleMode ? 8 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const pilot: Principal = { id: 'pilot', email: '', displayName: '' };
  const resolve = (req: RequestLike): Principal | null => googleMode ? google!.db.session(key(req)) : !enabled || (sessions.get(key(req)) || 0) > Date.now() ? pilot : null;
  const access: PortalAccess = { resolve, owner: req => resolve(req)?.id || null };
  const sessionCookie = (req: RequestLike) => ({ httpOnly: true, sameSite: googleMode ? 'lax' as const : 'strict' as const, secure: isSecureRequest(req, config), path: '/' });
  const rateLimited = (req: Request, maximum = 20) => {
    const address = req.ip || 'local';
    for (const [id, value] of attempts) if (value.until <= Date.now()) attempts.delete(id);
    let limit = attempts.get(address);
    if (!limit) { if (attempts.size >= 256) attempts.delete(attempts.keys().next().value!); limit = { count: 0, until: Date.now() + 60000 }; attempts.set(address, limit); }
    return ++limit.count > maximum;
  };
  app.use((req, res, next) => {
    if (enabled && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      let same = false; try { same = !!origin && new URL(origin).origin === requestOrigin(req, config); } catch {}
      if (req.headers['sec-fetch-site'] === 'cross-site' || (googleMode ? !same : origin && !same && !config.allowedOrigins.includes(origin))) return void res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    }
    next();
  });
  app.use('/api/auth', express.json({ limit: '2kb' }), (_req, res, next) => { res.set('cache-control', 'no-store'); res.set('referrer-policy', 'no-referrer'); next(); });
  app.get('/api/auth/session', (req, res) => {
    const user = resolve(req);
    res.json({ enabled, authenticated: !!user, mode: config.authMode, storageProvider: config.storageProvider,
      ...(googleMode ? { user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null, drive: user ? google!.db.connection(user.id).status : 'disconnected' } : {}) });
  });
  app.post('/api/auth/login', (req, res) => {
    if (googleMode) return void res.status(404).json({ error: 'NOT_FOUND' });
    if (!enabled) return void res.json({ authenticated: true });
    if (rateLimited(req)) return void res.status(429).json({ error: 'LOGIN_RATE_LIMIT' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !timingSafeEqual(hash(`${username}:${password}`), hash(`${config.portalAuth?.username}:${config.portalAuth?.password}`))) return void res.status(401).json({ error: 'INVALID_LOGIN' });
    for (const [id, expires] of sessions) if (expires <= Date.now()) sessions.delete(id);
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString('hex'); sessions.delete(key(req)); sessions.set(hash(token).toString('hex'), Date.now() + ttl);
    res.cookie('portal_session', token, { ...sessionCookie(req), maxAge: ttl }); res.json({ authenticated: true });
  });
  if (googleMode) {
    const begin = (purpose: 'login' | 'drive') => (req: Request, res: express.Response) => {
      res.set('cache-control', 'no-store'); res.set('referrer-policy', 'no-referrer');
      const user = resolve(req);
      if (purpose === 'drive' && !user) return void res.redirect(303, '/#/login?error=SESSION_EXPIRED');
      if (rateLimited(req, 60)) return void res.status(429).json({ error: 'LOGIN_RATE_LIMIT' });
      const state = randomBytes(32).toString('hex'), binder = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url');
      const job = purpose === 'drive' && typeof req.query.job === 'string' ? manager.getForOwner(req.query.job, user!.id) : undefined;
      google!.db.putOAuth(hash(state).toString('hex'), hash(binder).toString('hex'), { purpose, nonce, verifier, ...(purpose === 'drive' ? { ownerId: user!.id, sessionHash: key(req), jobId: job?.id } : {}) });
      res.cookie('portal_oauth', binder, { httpOnly: true, secure: isSecureRequest(req, config), sameSite: 'lax', path: '/api/auth/google/callback', maxAge: 600_000 });
      res.redirect(303, google!.oauth.authorization({ state, nonce, verifier, drive: purpose === 'drive', loginHint: purpose === 'drive' ? user!.email : undefined }));
    };
    app.get('/api/auth/google/start', begin('login'));
    app.get('/api/drive/connect', begin('drive'));
    app.get('/api/auth/google/callback', async (req, res) => {
      let purpose: 'login' | 'drive' = 'login';
      res.clearCookie('portal_oauth', { httpOnly: true, secure: isSecureRequest(req, config), sameSite: 'lax', path: '/api/auth/google/callback' });
      try {
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const binder = cookie(req, 'portal_oauth');
        if (!/^[a-f0-9]{64}$/.test(state) || !binder) throw new CloudError('GOOGLE_ACCESS_DENIED', 401);
        const attempt = google!.db.takeOAuth(hash(state).toString('hex'), hash(binder).toString('hex'));
        if (!attempt) throw new CloudError('GOOGLE_ACCESS_DENIED', 401);
        purpose = attempt.purpose;
        const current = resolve(req);
        if (purpose === 'drive' && (!current || current.id !== attempt.ownerId || key(req) !== attempt.sessionHash)) throw new CloudError('SESSION_EXPIRED', 401);
        if (req.query.error || typeof req.query.code !== 'string' || req.query.code.length > 4096) throw new CloudError('GOOGLE_ACCESS_DENIED', 401);
        const tokens = await google!.oauth.exchange(req.query.code, attempt.verifier);
        const identity = await google!.oauth.verifyIdentity(tokens.idToken, attempt.nonce);
        if (purpose === 'drive') {
          if (google!.db.user(current!.id)?.googleSub !== identity.sub || !tokens.scope?.split(' ').includes(DRIVE_SCOPE)) throw new CloudError('GOOGLE_ACCESS_DENIED', 401);
          if (access.owner(req) !== current!.id) throw new CloudError('SESSION_EXPIRED', 401);
          google!.drive.forgetAuthorization(current!.id); google!.db.saveCredentials(current!.id, tokens);
          const job = attempt.jobId ? manager.getForOwner(attempt.jobId, current!.id) : undefined;
          if (job && !job.isTerminal) {
            if (job.state === 'IMPORTING') await manager.retryStorage(job.id).catch(() => {});
            const institution = job.provider === 'centrodm' ? 'cdm' : job.provider === 'rdcchacabuco' ? 'rdc' : 'pc';
            return void res.redirect(303, '/#/traer?inst=' + institution + '&job=' + job.id);
          }
          return void res.redirect(303, '/#/perfil?drive=connected');
        }
        const user = google!.db.upsertUser(identity.sub, identity.email, identity.name);
        google!.db.revokeSession(key(req));
        if (current && current.id !== user.id) await Promise.all(manager.activeJobs().filter(job => job.ownerUserId === current.id).map(job => manager.cancel(job.id)));
        const token = randomBytes(32).toString('hex'); google!.db.createSession(hash(token).toString('hex'), user.id, Date.now() + ttl);
        res.cookie('portal_session', token, { ...sessionCookie(req), maxAge: ttl }); res.redirect(303, '/#/inicio');
      } catch (error) {
        const code = error instanceof CloudError && error.code === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'GOOGLE_ACCESS_DENIED';
        res.redirect(303, purpose === 'drive' && code !== 'SESSION_EXPIRED' ? '/#/perfil?drive=GOOGLE_ACCESS_DENIED' : '/#/login?error=' + code);
      }
    });
  }
  app.post('/api/auth/logout', async (req, res) => {
    const user = resolve(req);
    if (googleMode) google!.db.revokeSession(key(req)); else sessions.delete(key(req));
    res.clearCookie('portal_session', sessionCookie(req));
    if (user) await Promise.all(manager.activeJobs().filter(job => job.ownerUserId === user.id).map(job => manager.cancel(job.id)));
    res.json({ authenticated: false });
  });
  app.use((req, res, next) => {
    const privatePath = req.path.startsWith('/api/') || req.path.startsWith('/remote/') || req.path.startsWith('/remote-assets/');
    if (!privatePath || resolve(req)) return next();
    res.set('cache-control', 'no-store');
    if (req.path.startsWith('/remote/')) return void res.redirect(303, '/?returnTo=' + encodeURIComponent(req.originalUrl) + '#/login');
    res.status(401).json({ error: googleMode ? 'SESSION_EXPIRED' : 'UNAUTHORIZED' });
  });
  return access;
}
