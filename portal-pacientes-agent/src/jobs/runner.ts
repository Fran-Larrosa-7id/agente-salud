import type { Config } from '../config.js';
import type { ProviderConfig } from '../providers/types.js';
import type { Logger } from '../security/logger.js';
import type { JobFileStore } from './file-store.js';
import type { ImportJob } from './job.js';

/** Ejecuta un job de importación. El gestor de jobs no sabe si detrás hay un navegador real o un simulador. */
export interface JobRunner {
  /** Abre el portal, espera el login del paciente y descubre estudios (hasta WAITING_SELECTION). */
  start(): Promise<void>;
  /** Reintenta el discovery manteniendo navegador y sesiÃ³n autenticada cuando sea posible. */
  retryDiscovery?(): Promise<void>;
  resume?(beforeResume: () => Promise<void>): Promise<boolean>;
  /** Descarga SOLO los estudios elegidos por el paciente. */
  importSelected(studyIds: string[]): Promise<void>;
  /** Cierra navegador, pestañas y handles. Idempotente. */
  dispose(): Promise<void>;
  /** Retención temporal DEV solicitada por un fallo recuperable de Pixeon. */
  readonly debugViewerRetentionMs?: number;
}

export interface RunnerDeps {
  config: Config;
  provider: ProviderConfig;
  files: JobFileStore;
  log: Logger;
}

export type RunnerFactory = (job: ImportJob, deps: RunnerDeps) => JobRunner;
