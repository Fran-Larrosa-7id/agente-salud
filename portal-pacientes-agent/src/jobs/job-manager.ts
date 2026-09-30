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
  timers: NodeJS.Timeout[];
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
 * - Al terminar (cualquier estado terminal) se cierra el navegador del job.
 * - Si no terminó en COMPLETED, se borran sus archivos en el acto.
 * - Si terminó en COMPLETED, los PDF se borran cuando el frontend los retira todos, al cancelar,
 *   o al vencer FILE_RETENTION (lo que ocurra primero).
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
    const files = new JobFileStore(config.tmpDir, job.id, config.maxPdfBytes);
    const runner = this.deps.runnerFactory(job, { config, provider, files, log });
    const entry: Entry = { job, runner, files, delivered: new Set(), timers: [] };
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
    return [...this.jobs.values()].filter((e) => !e.job.isTerminal).length;
  }

  select(jobId: string, studyIds: unknown, importedSourceKeys?: unknown): string[] {
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    const ids = e.job.select(studyIds, this.deps.config.maxDownloadsPerJob, importedSourceKeys);
    void e.runner.importSelected(ids).catch(() => e.job.fail(JobState.ERROR, 'INTERNAL'));
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

  /** El frontend ya guardó el archivo: si están todos entregados y el job terminó, se borran. */
  async markDelivered(jobId: string, fileId: string): Promise<void> {
    const e = this.jobs.get(jobId);
    if (!e) return;
    e.delivered.add(fileId);
    if (e.job.state === JobState.COMPLETED && e.delivered.size >= e.files.count) await e.files.cleanup();
  }

  async cancel(jobId: string): Promise<ImportJob> {
    const e = this.jobs.get(jobId);
    if (!e) throw new ManagerError('JOB_NOT_FOUND', 404);
    if (!e.job.fail(JobState.CANCELLED, 'CANCELLED_BY_USER')) {
      // Ya había terminado (p. ej. COMPLETED): el frontend avisa que terminó de retirar los archivos.
      await e.files.cleanup();
    }
    await e.runner.dispose();
    return e.job;
  }

  private timer(e: Entry, ms: number, fn: () => void): void {
    const t = setTimeout(fn, ms);
    t.unref();
    e.timers.push(t);
  }

  private async onTerminal(e: Entry, state: JobState): Promise<void> {
    const { config, log } = this.deps;
    await e.runner.dispose().catch(() => {});
    if (state !== JobState.COMPLETED) await e.files.cleanup();
    else this.timer(e, config.fileRetentionMs, () => void e.files.cleanup());
    log.info(e.job.id, 'job_closed', { provider: e.job.provider, state, errorCode: e.job.errorCode, files: e.job.files.length });
    const keep = state === JobState.COMPLETED ? Math.max(config.jobRetentionMs, config.fileRetentionMs) : config.jobRetentionMs;
    this.timer(e, keep, () => void this.forget(e));
  }

  private async expire(e: Entry): Promise<void> {
    if (!e.job.fail(JobState.EXPIRED, 'JOB_TTL')) await e.files.cleanup();
  }

  private async forget(e: Entry): Promise<void> {
    e.timers.forEach(clearTimeout);
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
