import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { canTransition, isTerminal, JobState, STATE_EVENT, type JobEventType } from './states.js';

/** Metadata mínima de un estudio externo. Sin nombre, DNI ni diagnósticos. */
export interface ExternalStudy {
  id: string;
  sourceKey?: string;
  date?: string;
  protocol?: string;
  deliveryDate?: string;
  status?: string;
  provider: string;
}

export interface JobFileInfo {
  id: string;
  studyId: string;
  bytes: number;
  duplicate: boolean;
  importedAt: string;
  importedBy: 'agent';
}

export type HumanReason =
  | 'captcha'
  | 'mfa'
  | 'session_expired'
  | 'unknown_modal'
  | 'ambiguous'
  | 'security_check'
  | 'portal_changed';

export interface JobEvent {
  seq: number;
  type: JobEventType;
  state: JobState;
  at: number;
  data?: Record<string, unknown>;
}

export class IllegalTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Transición inválida ${from} → ${to}`);
  }
}

export class SelectionError extends Error {
  constructor(readonly code: 'NOT_WAITING_SELECTION' | 'EMPTY_SELECTION' | 'UNKNOWN_STUDY' | 'DUPLICATED_STUDY' | 'TOO_MANY' | 'ALREADY_IMPORTED' | 'INVALID_SOURCE_KEYS') {
    super(code);
  }
}

export class ImportJob extends EventEmitter {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  updatedAt = this.createdAt;
  state: JobState = JobState.CREATED;
  errorCode: string | undefined;
  studies: ExternalStudy[] = [];
  selection: string[] = [];
  files: JobFileInfo[] = [];
  failures: { studyId: string; code: string }[] = [];
  current: { studyId: string; index: number; total: number } | undefined;
  human: HumanReason | undefined;
  /** Se aborta al llegar a un estado terminal: corta esperas, al agente y al navegador. */
  readonly abort = new AbortController();
  private seq = 0;
  private readonly history: JobEvent[] = [];

  constructor(
    readonly provider: string,
    readonly providerName: string,
  ) {
    super();
    this.setMaxListeners(50);
  }

  get isTerminal(): boolean {
    return isTerminal(this.state);
  }

  transition(to: JobState, data?: Record<string, unknown>): void {
    if (this.state === to) return;
    if (!canTransition(this.state, to)) throw new IllegalTransitionError(this.state, to);
    this.state = to;
    this.updatedAt = Date.now();
    this.human = to === JobState.HUMAN_ACTION_REQUIRED ? ((data?.reason as HumanReason) ?? 'ambiguous') : undefined;
    if (to === JobState.PROVIDER_PARSER_MISMATCH) this.errorCode = 'PROVIDER_PARSER_MISMATCH';
    else if (to === JobState.AGENT_STARTING && this.errorCode === 'PROVIDER_PARSER_MISMATCH') this.errorCode = undefined;
    if (isTerminal(to) && to !== JobState.COMPLETED) this.errorCode = (data?.code as string) || to;
    this.push((STATE_EVENT[to] ?? 'error') as JobEventType, data);
    if (isTerminal(to)) {
      this.abort.abort();
      this.emit('terminal', to);
    }
  }

  /** Lleva el job a un estado de falla. No hace nada si ya terminó. */
  fail(to: JobState, code?: string): boolean {
    if (this.isTerminal) return false;
    this.transition(to, { code: code || to });
    return true;
  }

  push(type: JobEventType, data?: Record<string, unknown>): JobEvent {
    const ev: JobEvent = { seq: ++this.seq, type, state: this.state, at: Date.now(), ...(data ? { data } : {}) };
    this.history.push(ev);
    if (this.history.length > 100) this.history.shift();
    this.emit('event', ev);
    return ev;
  }

  eventsSince(seq: number): JobEvent[] {
    return this.history.filter((e) => e.seq > seq);
  }

  setStudies(studies: ExternalStudy[]): void {
    this.studies = studies;
  }

  select(ids: unknown, max: number, importedSourceKeys?: unknown): string[] {
    if (this.state !== JobState.WAITING_SELECTION) throw new SelectionError('NOT_WAITING_SELECTION');
    if (!Array.isArray(ids) || ids.length === 0) throw new SelectionError('EMPTY_SELECTION');
    if (ids.some((id) => typeof id !== 'string')) throw new SelectionError('UNKNOWN_STUDY');
    if (new Set(ids).size !== ids.length) throw new SelectionError('DUPLICATED_STUDY');
    if (ids.length > max) throw new SelectionError('TOO_MANY');
    const known = new Set(this.studies.map((s) => s.id));
    if (!ids.every((id) => known.has(id))) throw new SelectionError('UNKNOWN_STUDY');
    if (importedSourceKeys !== undefined) {
      if (!Array.isArray(importedSourceKeys) || importedSourceKeys.length > 2000 || importedSourceKeys.some((key) => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
        throw new SelectionError('INVALID_SOURCE_KEYS');
      }
      const imported = new Set(importedSourceKeys as string[]);
      if ((ids as string[]).some((id) => {
        const sourceKey = this.studies.find((study) => study.id === id)?.sourceKey;
        return !!sourceKey && imported.has(sourceKey);
      })) throw new SelectionError('ALREADY_IMPORTED');
    }
    this.selection = ids as string[];
    return this.selection;
  }

  addFile(info: JobFileInfo): void {
    if (!this.selection.includes(info.studyId)) throw new Error('FILE_STUDY_MISMATCH');
    this.files.push(info);
  }

  /** Vista pública del job (lo único que ve el frontend). */
  snapshot() {
    return {
      jobId: this.id,
      provider: this.provider,
      providerName: this.providerName,
      state: this.state,
      errorCode: this.errorCode ?? null,
      human: this.human ?? null,
      studies: this.studies,
      selection: this.selection,
      current: this.current ?? null,
      files: this.files,
      failures: this.failures,
      lastSeq: this.seq,
    };
  }
}
