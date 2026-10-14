import { createReadStream, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AGENT_ROOT, type Config } from '../config.js';
import path from 'node:path';
import { isUuid } from '../jobs/file-store.js';
import { SelectionError } from '../jobs/job.js';
import { ManagerError, type JobManager } from '../jobs/job-manager.js';
import type { ProviderConfig } from '../providers/types.js';
import { streamJobEvents } from './sse.js';
import { desktopHtml, interactive, type RemoteDesktop } from './remote-desktop.js';
import { installPortalAuth } from './portal-auth.js';

export interface AppDeps {
  config: Config;
  manager: JobManager;
  providers: Record<string, ProviderConfig>;
  desktop?: RemoteDesktop;
  info: {
    runner: string;
    model: string;
    modelReady: boolean;
    browserReady?: boolean | null;
    browserChannel?: string;
  };
}

export function createApp({ config, manager, providers, info, desktop }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.get('/health', (_req, res) => res.set('cache-control', 'no-store').json({ ok: true }));
  installPortalAuth(app, config, manager);

  // CORS con lista blanca de orígenes del frontend.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-expose-headers', 'x-content-sha256, x-artifact-kind');
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return void res.status(204).end();
    next();
  });

  app.use('/api', (_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json({ limit: '8kb' }));

  const jobParam = (req: Request, res: Response) => {
    const id = String(req.params.jobId);
    const job = isUuid(id) ? manager.get(id) : undefined;
    if (!job) res.status(404).json({ error: 'JOB_NOT_FOUND' });
    return job;
  };

  if (desktop && config.remoteLogin) {
    app.get('/remote-assets/portal-login.js', (_req, res) => {
      res.set('cache-control', 'no-store').sendFile(path.join(AGENT_ROOT, 'src/server/remote-client.js'));
    });
    app.use('/remote-assets', (_req, res, next) => { res.set('cache-control', 'no-store'); next(); }, express.static('/usr/share/novnc', { etag: false, maxAge: 0 }));
    app.get('/remote/:jobId', async (req, res) => {
        const id = String(req.params.jobId);
        const job = isUuid(id) ? manager.get(id) : undefined;
        const nonce = randomBytes(16).toString('hex');
        res.set('cache-control', 'no-store');
        res.set('referrer-policy', 'no-referrer');
        // noVNC decodifica tiles PNG/JPEG en imágenes data: antes de dibujarlos en el canvas.
        res.set('content-security-policy', `default-src 'self'; img-src 'self' data:; script-src 'self' 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'self'`);
        res.status(job ? 200 : 404).type('html').send(desktopHtml(id, nonce, job?.providerName, job?.provider, !job));
    });
    app.post('/api/imports/:jobId/desktop', async (req, res) => {
      const job = jobParam(req, res);
      if (!job) return;
      if (!interactive(job)) return void res.status(409).json({ error: job.isTerminal ? 'JOB_TERMINAL' : 'DESKTOP_PREPARING' });
      try {
        const token = await desktop.start(job);
        if (!interactive(job)) return void res.status(409).json({ error: 'JOB_TERMINAL' });
        res.cookie('portal_remote', token, { httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', path: `/remote/${job.id}/`, maxAge: config.loginTimeoutMs });
        res.json({ ready: true });
      } catch { res.status(503).json({ error: 'DESKTOP_UNAVAILABLE' }); }
    });
    app.post('/api/imports/:jobId/resume', async (req, res) => {
      const job = jobParam(req, res);
      if (!job) return;
      try {
        await manager.resume(job.id, () => desktop.stop(job.id));
        res.json({ accepted: true });
      } catch (error) {
        if (error instanceof ManagerError) return void res.status(error.status).json({ error: error.code });
        throw error;
      }
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      runner: info.runner,
      model: info.model,
      modelReady: info.modelReady,
      headless: config.headless,
      remoteLogin: config.remoteLogin,
      browserReady: info.browserReady ?? null,
      browserChannel: info.browserChannel || null,
      providers: Object.values(providers).map((p) => ({ id: p.id, name: p.name })),
    });
  });

  app.post('/api/imports/:provider', (req, res) => {
    try {
      const job = manager.create(String(req.params.provider));
      res.status(201).json({ jobId: job.id, remoteLogin: config.remoteLogin });
    } catch (e) {
      if (e instanceof ManagerError) return void res.status(e.status).json({ error: e.code, ...(e.code === 'TOO_MANY_JOBS' ? { activeJobId: manager.activeJobs()[0]?.id } : {}) });
      throw e;
    }
  });

  app.get('/api/imports/:jobId', (req, res) => {
    const job = jobParam(req, res);
    if (job) res.json({ ...job.snapshot(), remoteLogin: config.remoteLogin });
  });

  app.get('/api/imports/:jobId/events', (req, res) => {
    const job = jobParam(req, res);
    if (job) streamJobEvents(req, res, job);
  });

  app.get('/api/imports/:jobId/studies', (req, res) => {
    const job = jobParam(req, res);
    if (job) res.json({ state: job.state, studies: job.studies });
  });

  app.post('/api/imports/:jobId/retry-discovery', async (req, res) => {
    const job = jobParam(req, res);
    if (!job) return;
    try {
      const retried = await manager.retryDiscovery(job.id);
      res.status(202).json({ accepted: true, state: retried.state });
    } catch (e) {
      if (e instanceof ManagerError) return void res.status(e.status).json({ error: e.code });
      throw e;
    }
  });

  app.post('/api/imports/:jobId/import', (req, res) => {
    const job = jobParam(req, res);
    if (!job) return;
    try {
      const body = req.body as { studyIds?: unknown; importedSourceKeys?: unknown } | undefined;
      const ids = manager.select(job.id, body?.studyIds, body?.importedSourceKeys);
      res.status(202).json({ accepted: ids });
    } catch (e) {
      if (e instanceof SelectionError) return void res.status(e.code === 'NOT_WAITING_SELECTION' || e.code === 'ALREADY_IMPORTED' ? 409 : 400).json({ error: e.code });
      if (e instanceof ManagerError) return void res.status(e.status).json({ error: e.code });
      throw e;
    }
  });

  app.post('/api/imports/:jobId/files/:fileId/ack', async (req, res) => {
    const job = jobParam(req, res);
    if (!job) return;
    const fileId = String(req.params.fileId);
    const body = req.body as { studyId?: unknown; persisted?: unknown } | undefined;
    if (!isUuid(fileId) || typeof body?.studyId !== 'string' || typeof body.persisted !== 'boolean') {
      return void res.status(400).json({ error: 'INVALID_FILE_ACK' });
    }
    try {
      const updated = await manager.acknowledgePortalImport(job.id, fileId, body.studyId, body.persisted);
      res.status(202).json({ accepted: true, state: updated.state, errorCode: updated.errorCode ?? null });
    } catch (e) {
      if (e instanceof ManagerError) return void res.status(e.status).json({ error: e.code });
      throw e;
    }
  });

  app.get('/api/imports/:jobId/files/:fileId', (req, res) => {
    const job = jobParam(req, res);
    if (!job) return;
    const file = manager.file(job.id, String(req.params.fileId));
    if (!file || !existsSync(file.path)) return void res.status(404).json({ error: 'FILE_NOT_FOUND' });
    res.setHeader('content-type', file.mimeType);
    res.setHeader('content-length', String(file.bytes));
    res.setHeader('content-disposition', file.kind === 'PDF'
      ? 'inline; filename="estudio.pdf"'
      : 'attachment; filename="estudio-dicom.zip"');
    res.setHeader('x-content-sha256', file.sha256);
    res.setHeader('x-artifact-kind', file.kind);
    const stream = createReadStream(file.path);
    stream.on('error', () => res.destroy());
    res.on('finish', () => void manager.markDelivered(job.id, file.id));
    stream.pipe(res);
  });

  app.delete('/api/imports/:jobId', async (req, res) => {
    const job = jobParam(req, res);
    if (!job) return;
    await manager.cancel(job.id);
    res.json({ state: job.state, errorCode: job.errorCode ?? null });
  });

  app.use('/api', (_req, res) => void res.status(404).json({ error: 'NOT_FOUND' }));

  // Frontend (opcional): sirve ../portal-pacientes para tener todo en un solo origen.
  if (config.portalDir && existsSync(config.portalDir)) {
    app.use(express.static(config.portalDir, { index: 'index.html', etag: false, maxAge: 0 }));
  }

  // Errores: respuesta genérica, sin detalles internos ni datos.
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: 'INTERNAL' });
  });

  return app;
}
