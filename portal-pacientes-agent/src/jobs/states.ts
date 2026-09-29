/** Máquina de estados de un job de importación. */

export const JobState = {
  CREATED: 'CREATED',
  OPENING_PROVIDER: 'OPENING_PROVIDER',
  WAITING_FOR_USER_LOGIN: 'WAITING_FOR_USER_LOGIN',
  AUTHENTICATED: 'AUTHENTICATED',
  AGENT_STARTING: 'AGENT_STARTING',
  AGENT_OBSERVING: 'AGENT_OBSERVING',
  SEARCHING_STUDIES: 'SEARCHING_STUDIES',
  PROVIDER_PARSER_MISMATCH: 'PROVIDER_PARSER_MISMATCH',
  STUDIES_FOUND: 'STUDIES_FOUND',
  WAITING_SELECTION: 'WAITING_SELECTION',
  OPENING_STUDY: 'OPENING_STUDY',
  FINDING_DOCUMENT: 'FINDING_DOCUMENT',
  DOWNLOADING: 'DOWNLOADING',
  IMPORTING: 'IMPORTING',
  COMPLETED: 'COMPLETED',
  HUMAN_ACTION_REQUIRED: 'HUMAN_ACTION_REQUIRED',
  AUTH_TIMEOUT: 'AUTH_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_CHANGED: 'PROVIDER_CHANGED',
  AGENT_UNABLE_TO_CONTINUE: 'AGENT_UNABLE_TO_CONTINUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  ERROR: 'ERROR',
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];
const S = JobState;

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set([
  S.COMPLETED,
  S.AUTH_TIMEOUT,
  S.PROVIDER_UNAVAILABLE,
  S.PROVIDER_CHANGED,
  S.AGENT_UNABLE_TO_CONTINUE,
  S.CANCELLED,
  S.EXPIRED,
  S.ERROR,
]);

/** Estados de falla alcanzables desde cualquier estado no terminal. */
const FAILURES: ReadonlySet<JobState> = new Set([
  S.PROVIDER_UNAVAILABLE,
  S.PROVIDER_CHANGED,
  S.AGENT_UNABLE_TO_CONTINUE,
  S.CANCELLED,
  S.EXPIRED,
  S.ERROR,
]);

const FLOW: Record<JobState, readonly JobState[]> = {
  CREATED: [S.OPENING_PROVIDER],
  OPENING_PROVIDER: [S.WAITING_FOR_USER_LOGIN],
  WAITING_FOR_USER_LOGIN: [S.AUTHENTICATED, S.AUTH_TIMEOUT],
  AUTHENTICATED: [S.AGENT_STARTING, S.SEARCHING_STUDIES],
  AGENT_STARTING: [S.AGENT_OBSERVING, S.SEARCHING_STUDIES, S.HUMAN_ACTION_REQUIRED, S.PROVIDER_PARSER_MISMATCH],
  AGENT_OBSERVING: [S.SEARCHING_STUDIES, S.STUDIES_FOUND, S.HUMAN_ACTION_REQUIRED, S.PROVIDER_PARSER_MISMATCH],
  SEARCHING_STUDIES: [S.AGENT_STARTING, S.AGENT_OBSERVING, S.STUDIES_FOUND, S.HUMAN_ACTION_REQUIRED, S.PROVIDER_PARSER_MISMATCH],
  PROVIDER_PARSER_MISMATCH: [S.AGENT_STARTING],
  STUDIES_FOUND: [S.WAITING_SELECTION],
  WAITING_SELECTION: [S.OPENING_STUDY, S.COMPLETED],
  OPENING_STUDY: [S.FINDING_DOCUMENT, S.DOWNLOADING, S.HUMAN_ACTION_REQUIRED, S.OPENING_STUDY, S.COMPLETED],
  FINDING_DOCUMENT: [S.DOWNLOADING, S.OPENING_STUDY, S.HUMAN_ACTION_REQUIRED, S.COMPLETED],
  DOWNLOADING: [S.IMPORTING, S.FINDING_DOCUMENT, S.OPENING_STUDY, S.HUMAN_ACTION_REQUIRED, S.COMPLETED],
  IMPORTING: [S.OPENING_STUDY, S.COMPLETED],
  HUMAN_ACTION_REQUIRED: [
    S.AGENT_STARTING,
    S.AGENT_OBSERVING,
    S.SEARCHING_STUDIES,
    S.OPENING_STUDY,
    S.FINDING_DOCUMENT,
    S.AUTH_TIMEOUT,
  ],
  COMPLETED: [],
  AUTH_TIMEOUT: [],
  PROVIDER_UNAVAILABLE: [],
  PROVIDER_CHANGED: [],
  AGENT_UNABLE_TO_CONTINUE: [],
  CANCELLED: [],
  EXPIRED: [],
  ERROR: [],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  if (isTerminal(from)) return false;
  if (FAILURES.has(to)) return true;
  return FLOW[from].includes(to);
}

/** Nombre del evento SSE que se emite al entrar en cada estado. */
export const STATE_EVENT: Partial<Record<JobState, string>> = {
  OPENING_PROVIDER: 'provider_opening',
  WAITING_FOR_USER_LOGIN: 'waiting_user_login',
  AUTHENTICATED: 'authenticated',
  AGENT_STARTING: 'agent_started',
  AGENT_OBSERVING: 'agent_observing',
  SEARCHING_STUDIES: 'searching_studies',
  PROVIDER_PARSER_MISMATCH: 'provider_parser_mismatch',
  STUDIES_FOUND: 'studies_found',
  WAITING_SELECTION: 'waiting_selection',
  OPENING_STUDY: 'opening_study',
  FINDING_DOCUMENT: 'finding_document',
  DOWNLOADING: 'downloading',
  IMPORTING: 'importing',
  COMPLETED: 'completed',
  HUMAN_ACTION_REQUIRED: 'human_action_required',
};

/** Todos los tipos de evento que puede recibir el frontend. */
export const EVENT_TYPES = [
  'snapshot',
  'provider_opening',
  'provider_opened',
  'waiting_user_login',
  'authenticated',
  'agent_started',
  'agent_observing',
  'searching_studies',
  'provider_parser_mismatch',
  'studies_found',
  'waiting_selection',
  'opening_study',
  'finding_document',
  'downloading',
  'importing',
  'file_ready',
  'study_failed',
  'human_action_required',
  'completed',
  'error',
] as const;
export type JobEventType = (typeof EVENT_TYPES)[number];
