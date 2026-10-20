import type { Config } from '../config.js';
import type { ProviderConfig } from '../providers/types.js';
import type { Logger } from '../security/logger.js';
import { JobFileStore, type StoredFile } from './file-store.js';
import { ImportJob } from './job.js';
import type { JobRunner, RunnerFactory } from './runner.js';
import { JobState } from './states.js';
import type { StorageProvider } from '../storage/provider.js';
import { CloudError } from '../storage/errors.js';
import type { PendingImports } from '../storage/pending-imports.js';

export class ManagerError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

interface Entry {
  job: ImportJob;
  runner: JobRunner;
  files: JobFileStore;
  delivered: Set<string>;
  portalAcks: Set<string>;
  importFinished: boolean;
  disposing: boolean;
  timers: NodeJS.Timeout[];
  debugDisposeTimer?: NodeJS.Timeout;
  uploading?: Promise<void>;
}

export interface ManagerDeps {
  config: Config;
  providers: Record<string, ProviderConfig>;
  runnerFactory: RunnerFactory;
  log: Logger;
  /** Devuelve un código de error si hoy no se pueden crear jobs (p. ej. falta la API key del modelo). */
  preflight?: () => string | null;
  storage?: StorageProvider;
  pendingImports?: PendingImports;
}

/**
 * Crea, sigue y limpia jobs. Garantías:
 * - TTL por job (JOB_TTL): al vencer, EXPIRED y limpieza completa.
 * - Al terminar se cierra el navegador, salvo retención DEV temporal de un fallo recuperable Pixeon.
 * - Si no terminó en COMPLETED, se borran sus archivos en el acto.
 * - COMPLETED solo se emite tras el acuse del Portal por cada artifact/estudio persistido.
 * - Los temporales se borran tras completar todos los acuses y entregar los bytes, al cancelar,
 *   al fallar la importación o al vencer la retención.
 */
export class JobManager {
  private readonly jobs = new Map<string, Entry>();
  private readonly pendingSweep?: NodeJS.Timeout;

  constructor(private readonly deps: ManagerDeps) {
    if (deps.config.storageProvider === 'google_drive' && deps.storage?.kind !== 'google_drive') throw new Error('STORAGE_NOT_CONFIGURED');
    if (deps.pendingImports) this.pendingSweep = setInterval(() => void deps.pendingImports!.list().catch(() => deps.log.warn(null, 'pending_cleanup_failed')), 60_000).unref();
  }

  async restorePending(): Promise<void> {
    if (!this.deps.pendingImports || this.deps.config.storageProvider !== 'google_drive') return;
    for (const record of await this.deps.pendingImports.list()) {
      const snap = record.snapshot, provider = this.deps.providers[snap.provider];
      if (!provider || this.jobs.has(snap.jobId) || snap.state !== JobState.IMPORTING || !snap.files.length) continue;
      const job = new ImportJob(provider.id, provider.name, record.owner, { id: snap.jobId, createdAt: record.createdAt });
      Object.assign(job, { state: JobState.IMPORTING, storageBackend: 'google_drive', storageError: snap.storageError || 'DRIVE_UPLOAD_FAILED', studies: snap.studies, selection: snap.selection, files: snap.files, failures: snap.failures });
      const files = new JobFileStore(this.deps.pendingImports.root, job.id, this.deps.config.maxPdfBytes, this.deps.config.maxMedicalArchiveBytes);
      try { await files.restore(snap.files); }
      catch { this.deps.log.warn(job.id, 'pending_import_unavailable', { errorCode: 'ARTIFACT_INTEGRITY_FAILED' }); continue; }
      // Storage-only continuation: no institutional credentials or browser are restored.
      const runner: JobRunner = { start: async () => {}, importSelected: async () => { throw new ManagerError('RETRY_NOT_AVAILABLE', 409); }, dispose: async () => {} };
      const entry: Entry = { job, files, runner, delivered: new Set(), portalAcks: new Set(), importFinished: true, disposing: false, timers: [] };
      this.jobs.set(job.id, entry);
      job.once('terminal', state => void this.onTerminal(entry, state));
      this.timer(entry, Math.max(1, record.expiresAt - Date.now()), () => void this.expire(entry));
      this.deps.log.info(job.id, 'storage_job_restored', { provider: provider.id, state: job.state, files: job.files.length });
    }
  }

  create(providerId: string, ownerUserId = 'pilot'): ImportJob {
    const { config, providers, log } = this.deps;
    const provider = providers[providerId];
    if (!provider) throw new ManagerError('UNKNOWN_PROVIDER', 404);
    const blocked = this.deps.preflight?.();
    if (blocked) throw new ManagerError(blocked, 503);
    if (this.activeCount() >= config.maxConcurrentJobs) throw new ManagerError('TOO_MANY_JOBS', 429);

    if (config.authMode === 'google' && ownerUserId === 'pilot') throw new ManagerError('SESSION_EXPIRED', 401);
    const job = new ImportJob(provider.id, provider.name, ownerUserId);
    job.storageBackend = config.storageProvider;
    const files = new JobFileStore(config.tmpDir, job.id, config.maxPdfBytes, config.maxMedicalArchiveBytes);
    const runner = this.deps.runnerFactory(job, { config, provider, files, log });
    const entry: Entry = { job, runner, files, delivered: new Set(), portalAcks: new Set(), importFinished: false, disposing: false, timers: [] };
    this.jobs.set(job.id, entry);
    log.info(job.id, 'job_created', { provider: provider.id });

    job.on('event', (ev: { type: string }) => {
      log.info(job.id, 'job_event', { provider: provider.id, state: job.state, event: ev.type });
      if (ev.type === 'waiting_user_login') log.info(job.id, 'login_ready', { durationMs: Date.now() - job.createdAt });
    });
    job.once('terminal', (state: JobState) => void this.onTerminal(entry, state));
    this.timer(entry, config.jobTtlMs, () => void this.expire(entry));

    void runner.start().catch(() => job.fail(JobState.ERROR, 'INTERNAL'));
    return job;
  }

  get(jobId: string): ImportJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  getForOwner(jobId: string, ownerUserId: string | null): ImportJob | undefined {
    const job = this.get(jobId); return job && ownerUserId && job.ownerUserId === ownerUserId ? job : undefined;
  }

  async resume(jobId: string, beforeResume: () => Promise<void>): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry?.runner.resume) throw new ManagerError('RESUME_NOT_AVAILABLE', 409);
    if (!await entry.runner.resume(beforeResume)) throw new ManagerError('LOGIN_NOT_READY', 409);
  }

  activeCount(): number {
    return this.activeJobs().length;
  }

  activeJobs(): ImportJob[] {
    return [...this.jobs.values()].filter((e) => !e.job.isTerminal || e.disposing || (e.runner.debugViewerRetentionMs || 0) > 0).map(e => e.job);
  }

  select(jobId: string, studyIds: unknown, importedSourceKeys?: unknown): string[] {
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    const ids = e.job.select(studyIds, this.deps.config.maxDownloadsPerJob, importedSourceKeys);
    void e.runner.importSelected(ids)
      .then(() => this.importWorkFinished(e))
      .catch(() => e.job.fail(JobState.ERROR, 'INTERNAL'));
    return ids;
  }

  async retryDiscovery(jobId: string): Promise<ImportJob> {
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    if (e.job.state !== JobState.PROVIDER_PARSER_MISMATCH || !e.runner.retryDiscovery) {
      throw new ManagerError('RETRY_NOT_AVAILABLE', 409);
    }
    await e.runner.retryDiscovery().catch(() => e.job.fail(JobState.ERROR, 'INTERNAL'));
    return e.job;
  }

  file(jobId: string, fileId: string): StoredFile | undefined {
    const e = this.jobs.get(jobId);
    if (!e || e.files.isRemoved) return undefined;
    return e.files.get(fileId);
  }

  /** El navegador del Portal recibió los bytes; esto por sí solo no significa que ya los persistió. */
  async markDelivered(jobId: string, fileId: string): Promise<void> {
    const e = this.jobs.get(jobId);
    if (!e) return;
    e.delivered.add(fileId);
    if (e.job.state === JobState.COMPLETED && e.delivered.size >= e.files.count) await e.files.cleanup();
  }

  /** El Portal confirma un archivo solo después de persistir su Blob y el estudio asociado. */
  async acknowledgePortalImport(jobId: string, fileId: string, studyId: string, persisted: boolean): Promise<ImportJob> {
    if (this.deps.storage?.kind === 'google_drive') throw new ManagerError('SERVER_PERSISTENCE_REQUIRED', 409);
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    const ackKey = `${fileId}:${studyId}`;
    if (e.portalAcks.has(ackKey)) return e.job;
    const record = e.job.files.find((file) => file.id === fileId && file.studyId === studyId);
    if (!record || !e.files.get(fileId)) throw new ManagerError('FILE_NOT_FOUND', 404);
    if (e.job.isTerminal) throw new ManagerError('JOB_TERMINAL', 409);

    if (!persisted) {
      this.deps.log.warn(jobId, 'portal_artifact_import_failed', { provider: e.job.provider, errorCode: 'ARTIFACT_IMPORT_FAILED' });
      e.job.fail(JobState.AGENT_UNABLE_TO_CONTINUE, 'ARTIFACT_IMPORT_FAILED');
      return e.job;
    }

    e.portalAcks.add(ackKey);
    if (e.job.provider === 'centrodm') {
      this.deps.log.info(jobId, 'centrodm_artifact_persisted', { fileIdPresent: true });
      this.deps.log.info(jobId, 'centrodm_study_persisted', { studyPersisted: true });
    } else if (e.job.provider === 'rdcchacabuco') {
      this.deps.log.info(jobId, 'rdc_artifact_persisted', { fileIdPresent: true });
      this.deps.log.info(jobId, 'rdc_study_persisted', { studyPersisted: true });
    }
    this.completeIfPersisted(e);
    return e.job;
  }

  private async importWorkFinished(e: Entry): Promise<void> {
    if (e.job.isTerminal) return;
    if (e.job.files.length === 0) {
      e.job.fail(JobState.AGENT_UNABLE_TO_CONTINUE, e.job.provider === 'centrodm' || e.job.provider === 'rdcchacabuco' ? 'NO_ARTIFACTS_IMPORTED' : 'NO_DOCUMENTS');
      return;
    }
    e.importFinished = true;
    // Un estudio anterior pudo producir un archivo y el último seleccionado fallar antes de
    // descargarlo. Aun así, el Portal necesita confirmar la persistencia del archivo existente.
    if (e.job.state !== JobState.IMPORTING) e.job.transition(JobState.IMPORTING, { files: e.job.files.length });
    if (this.deps.storage?.kind === 'google_drive') await this.persistRemote(e);
    else this.completeIfPersisted(e);
  }

  async retryStorage(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry || entry.job.isTerminal || !entry.importFinished || this.deps.storage?.kind !== 'google_drive') throw new ManagerError('RETRY_NOT_AVAILABLE', 409);
    void this.persistRemote(entry);
  }

  private persistRemote(e: Entry): Promise<void> {
    if (e.uploading) return e.uploading;
    const storage = this.deps.storage;
    if (storage?.kind !== 'google_drive') return Promise.resolve();
    e.uploading = (async () => {
      e.job.storageError = null;
      let storageStage = 'storage_checkpoint';
      try {
        await this.deps.pendingImports?.save(e.job, e.job.files.map(record => {
          const file = e.files.get(record.id); if (!file) throw new CloudError('FILE_MISSING', 404); return file;
        }));
        for (const record of e.job.files) {
          storageStage = 'storage_upload';
          if (e.job.isTerminal) return;
          const ackKey = `${record.id}:${record.studyId}`;
          if (e.portalAcks.has(ackKey)) continue;
          const file = e.files.get(record.id), study = e.job.studies.find(value => value.id === record.studyId);
          if (!file || !study) throw new CloudError('FILE_MISSING', 404);
          e.job.push('storage_uploading', { studyId: study.id, fileId: file.id, bytes: 0, total: file.bytes });
          const saved = await storage.upload({ ownerUserId: e.job.ownerUserId, jobId: e.job.id, file, study, signal: e.job.abort.signal,
            onProgress: (bytes, total) => { if (!e.job.isTerminal) e.job.push('storage_uploading', { studyId: study.id, fileId: file.id, bytes, total }); } });
          if (e.job.isTerminal) return;
          // A verified remote object and committed catalog are required; never trust a browser ack in this mode.
          if (saved.ownerUserId !== e.job.ownerUserId || saved.status !== 'stored' || !saved.remoteFileId || !saved.id || saved.sha256 !== file.sha256 || saved.bytes !== file.bytes || saved.kind !== file.kind || saved.mimeType !== file.mimeType) throw new CloudError('DRIVE_UPLOAD_FAILED');
          record.storedStudyId = saved.id; record.storageBackend = 'google_drive';
          e.portalAcks.add(ackKey); e.delivered.add(file.id);
          e.job.push('storage_stored', { studyId: study.id, fileId: file.id, storedStudyId: saved.id });
        }
        this.completeIfPersisted(e);
      } catch (error) {
        if (!e.job.isTerminal) {
          e.job.storageError = error instanceof CloudError ? error.code : 'DRIVE_UPLOAD_FAILED';
          e.job.push('storage_error', { code: e.job.storageError });
          await this.deps.pendingImports?.update(e.job).catch(() => { this.deps.log.warn(e.job.id, 'pending_checkpoint_failed'); });
          const code = (error as NodeJS.ErrnoException)?.code;
          this.deps.log.warn(e.job.id, 'storage_failed', { errorCode: e.job.storageError, stage: storageStage,
            reason: ['ENOENT', 'EACCES', 'EROFS', 'ENOSPC', 'ERR_SQLITE_ERROR'].includes(code || '') ? code : 'see_drive_upload', transient: error instanceof CloudError ? error.retryable : undefined });
        }
      }
    })().finally(() => { e.uploading = undefined; });
    return e.uploading;
  }

  private completeIfPersisted(e: Entry): void {
    if (!e.importFinished || e.job.isTerminal || e.job.files.length === 0) return;
    const expected = new Set(e.job.files.map((file) => `${file.id}:${file.studyId}`));
    if ([...expected].some((key) => !e.portalAcks.has(key))) return;
    e.job.transition(JobState.COMPLETED, { files: e.job.files.length, failures: e.job.failures.length });
    if (e.job.provider === 'centrodm') this.deps.log.info(e.job.id, 'centrodm_import_complete', { files: e.job.files.length, failures: e.job.failures.length });
    else if (e.job.provider === 'rdcchacabuco') this.deps.log.info(e.job.id, 'rdc_import_complete', { files: e.job.files.length, failures: e.job.failures.length });
    // El endpoint de archivos ya entregó los bytes antes de que el Portal pudiera acusar recibo.
    if (e.delivered.size >= e.files.count) void e.files.cleanup();
  }

  async cancel(jobId: string): Promise<ImportJob> {
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    if (e.debugDisposeTimer) clearTimeout(e.debugDisposeTimer);
    if (!e.job.fail(JobState.CANCELLED, 'CANCELLED_BY_USER')) {
      // Ya había terminado (p. ej. COMPLETED): el frontend avisa que terminó de retirar los archivos.
      await e.files.cleanup();
    }
    await e.runner.dispose();
    e.disposing = false;
    return e.job;
  }

  private timer(e: Entry, ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(fn, ms);
    t.unref();
    e.timers.push(t);
    return t;
  }

  private async onTerminal(e: Entry, state: JobState): Promise<void> {
    e.disposing = true;
    const { config, log } = this.deps;
    const recoverable = ['VIEWER_NOT_RECOGNIZED', 'DOWNLOAD_ACTION_NOT_FOUND', 'DOWNLOAD_ACTION_NOT_CLICKABLE', 'DOWNLOAD_MENU_NOT_FOUND'].includes(e.job.errorCode || '');
    const holdPixeon = recoverable && state === JobState.AGENT_UNABLE_TO_CONTINUE && config.pixeonDebugKeepViewerOpen && e.job.provider === 'centrodm'
      ? Math.min(config.pixeonDebugKeepViewerOpenMs, e.runner.debugViewerRetentionMs || 0) : 0;
    const holdRdc = e.job.errorCode === 'PDF_SOURCE_NOT_FOUND' && state === JobState.AGENT_UNABLE_TO_CONTINUE && config.rdcDebugKeepModalOpen && e.job.provider === 'rdcchacabuco'
      ? Math.min(config.rdcDebugKeepModalOpenMs, e.runner.debugViewerRetentionMs || 0) : 0;
    const hold = Math.max(holdPixeon, holdRdc);
    if (hold > 0) {
      if (holdRdc > 0) log.info(e.job.id, 'rdc_debug_hold', { keepModalOpen: true, reason: 'PDF_SOURCE_NOT_FOUND', ttlMs: holdRdc });
      else {
        log.info(e.job.id, 'pixeon_debug_hold', { viewer: true, reason: e.job.errorCode, ttlMs: hold });
        log.info(e.job.id, 'pixeon_debug_viewer_held', { durationMs: hold, errorCode: e.job.errorCode });
      }
      e.debugDisposeTimer = this.timer(e, hold, () => void e.runner.dispose().catch(() => {}).then(() => {
        e.disposing = false;
        if (holdRdc > 0) log.info(e.job.id, 'rdc_debug_modal_closed');
        else log.info(e.job.id, 'pixeon_debug_viewer_closed');
        log.info(e.job.id, 'job_closed', { provider: e.job.provider, state, errorCode: e.job.errorCode, files: e.job.files.length });
      }));
    } else {
      await e.runner.dispose().catch(() => {});
      e.disposing = false;
    }
    await e.uploading?.catch(() => {});
    if (e.files.dir !== this.deps.pendingImports?.directory(e.job.id)) {
      await this.deps.pendingImports?.remove(e.job.id).catch(() => { log.warn(e.job.id, 'pending_cleanup_failed'); });
    }
    if (state !== JobState.COMPLETED) await e.files.cleanup();
    else this.timer(e, config.fileRetentionMs, () => void e.files.cleanup());
    if (hold === 0) log.info(e.job.id, 'job_closed', { provider: e.job.provider, state, errorCode: e.job.errorCode, files: e.job.files.length, durationMs: Date.now() - e.job.createdAt });
    const keep = state === JobState.COMPLETED ? Math.max(config.jobRetentionMs, config.fileRetentionMs) : config.jobRetentionMs;
    this.timer(e, keep + hold, () => void this.forget(e));
  }

  private async expire(e: Entry): Promise<void> {
    if (e.debugDisposeTimer) clearTimeout(e.debugDisposeTimer);
    if (!e.job.fail(JobState.EXPIRED, 'JOB_TTL')) {
      await e.runner.dispose().catch(() => {});
      await e.files.cleanup();
    }
  }

  private async forget(e: Entry): Promise<void> {
    e.timers.forEach(clearTimeout);
    await e.runner.dispose().catch(() => {});
    await e.uploading?.catch(() => {});
    await e.files.cleanup();
    e.job.removeAllListeners();
    this.jobs.delete(e.job.id);
  }

  async shutdown(): Promise<void> {
    if (this.pendingSweep) clearInterval(this.pendingSweep);
    await Promise.all(
      [...this.jobs.values()].map(async (e) => {
        if (this.deps.pendingImports && e.importFinished && !e.job.isTerminal) {
          e.timers.forEach(clearTimeout);
          e.job.abort.abort();
          await e.runner.dispose().catch(() => {});
          await e.uploading?.catch(() => {});
          // Checkpoint was written before the first remote request. Keep its copies until TTL.
          if (e.files.dir !== this.deps.pendingImports.directory(e.job.id)) await e.files.cleanup();
          e.job.removeAllListeners(); this.jobs.delete(e.job.id); return;
        }
        e.job.fail(JobState.CANCELLED, 'SERVER_SHUTDOWN');
        await e.runner.dispose().catch(() => {});
        await this.forget(e);
      }),
    );
  }
}
