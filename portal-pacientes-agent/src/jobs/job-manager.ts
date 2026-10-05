import type { Config } from '../config.js';
import type { ProviderConfig } from '../providers/types.js';
import type { Logger } from '../security/logger.js';
import { JobFileStore, type StoredFile } from './file-store.js';
import { ImportJob } from './job.js';
import type { JobRunner, RunnerFactory } from './runner.js';
import { JobState } from './states.js';

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
  timers: NodeJS.Timeout[];
  debugDisposeTimer?: NodeJS.Timeout;
}

export interface ManagerDeps {
  config: Config;
  providers: Record<string, ProviderConfig>;
  runnerFactory: RunnerFactory;
  log: Logger;
  /** Devuelve un código de error si hoy no se pueden crear jobs (p. ej. falta la API key del modelo). */
  preflight?: () => string | null;
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

  constructor(private readonly deps: ManagerDeps) {}

  create(providerId: string): ImportJob {
    const { config, providers, log } = this.deps;
    const provider = providers[providerId];
    if (!provider) throw new ManagerError('UNKNOWN_PROVIDER', 404);
    const blocked = this.deps.preflight?.();
    if (blocked) throw new ManagerError(blocked, 503);
    if (this.activeCount() >= config.maxConcurrentJobs) throw new ManagerError('TOO_MANY_JOBS', 429);

    const job = new ImportJob(provider.id, provider.name);
    const files = new JobFileStore(config.tmpDir, job.id, config.maxPdfBytes, config.maxMedicalArchiveBytes);
    const runner = this.deps.runnerFactory(job, { config, provider, files, log });
    const entry: Entry = { job, runner, files, delivered: new Set(), portalAcks: new Set(), importFinished: false, timers: [] };
    this.jobs.set(job.id, entry);

    job.on('event', (ev: { type: string }) => log.info(job.id, 'job_event', { provider: provider.id, state: job.state, event: ev.type }));
    job.once('terminal', (state: JobState) => void this.onTerminal(entry, state));
    this.timer(entry, config.jobTtlMs, () => void this.expire(entry));

    void runner.start().catch(() => job.fail(JobState.ERROR, 'INTERNAL'));
    return job;
  }

  get(jobId: string): ImportJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  activeCount(): number {
    return [...this.jobs.values()].filter((e) => !e.job.isTerminal || (e.runner.debugViewerRetentionMs || 0) > 0).length;
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
    }
    this.completeIfPersisted(e);
    return e.job;
  }

  private importWorkFinished(e: Entry): void {
    if (e.job.isTerminal) return;
    if (e.job.files.length === 0) {
      e.job.fail(JobState.AGENT_UNABLE_TO_CONTINUE, e.job.provider === 'centrodm' ? 'NO_ARTIFACTS_IMPORTED' : 'NO_DOCUMENTS');
      return;
    }
    e.importFinished = true;
    // Un estudio anterior pudo producir un archivo y el último seleccionado fallar antes de
    // descargarlo. Aun así, el Portal necesita confirmar la persistencia del archivo existente.
    if (e.job.state !== JobState.IMPORTING) e.job.transition(JobState.IMPORTING, { files: e.job.files.length });
    this.completeIfPersisted(e);
  }

  private completeIfPersisted(e: Entry): void {
    if (!e.importFinished || e.job.isTerminal || e.job.files.length === 0) return;
    const expected = new Set(e.job.files.map((file) => `${file.id}:${file.studyId}`));
    if ([...expected].some((key) => !e.portalAcks.has(key))) return;
    e.job.transition(JobState.COMPLETED, { files: e.job.files.length, failures: e.job.failures.length });
    if (e.job.provider === 'centrodm') this.deps.log.info(e.job.id, 'centrodm_import_complete', { files: e.job.files.length, failures: e.job.failures.length });
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
    return e.job;
  }

  private timer(e: Entry, ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(fn, ms);
    t.unref();
    e.timers.push(t);
    return t;
  }

  private async onTerminal(e: Entry, state: JobState): Promise<void> {
    const { config, log } = this.deps;
    const recoverable = ['VIEWER_NOT_RECOGNIZED', 'DOWNLOAD_ACTION_NOT_FOUND', 'DOWNLOAD_ACTION_NOT_CLICKABLE', 'DOWNLOAD_MENU_NOT_FOUND'].includes(e.job.errorCode || '');
    const hold = recoverable && state === JobState.AGENT_UNABLE_TO_CONTINUE && config.pixeonDebugKeepViewerOpen && e.job.provider === 'centrodm'
      ? Math.min(config.pixeonDebugKeepViewerOpenMs, e.runner.debugViewerRetentionMs || 0) : 0;
    if (hold > 0) {
      log.info(e.job.id, 'pixeon_debug_hold', { viewer: true, reason: e.job.errorCode, ttlMs: hold });
      log.info(e.job.id, 'pixeon_debug_viewer_held', { durationMs: hold, errorCode: e.job.errorCode });
      e.debugDisposeTimer = this.timer(e, hold, () => void e.runner.dispose().catch(() => {}).then(() => {
        log.info(e.job.id, 'pixeon_debug_viewer_closed');
        log.info(e.job.id, 'job_closed', { provider: e.job.provider, state, errorCode: e.job.errorCode, files: e.job.files.length });
      }));
    } else await e.runner.dispose().catch(() => {});
    if (state !== JobState.COMPLETED) await e.files.cleanup();
    else this.timer(e, config.fileRetentionMs, () => void e.files.cleanup());
    if (hold === 0) log.info(e.job.id, 'job_closed', { provider: e.job.provider, state, errorCode: e.job.errorCode, files: e.job.files.length });
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
    await e.files.cleanup();
    e.job.removeAllListeners();
    this.jobs.delete(e.job.id);
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.jobs.values()].map(async (e) => {
        e.job.fail(JobState.CANCELLED, 'SERVER_SHUTDOWN');
        await e.runner.dispose().catch(() => {});
        await this.forget(e);
      }),
    );
  }
}
