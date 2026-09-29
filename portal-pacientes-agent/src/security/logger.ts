/**
 * Logger con lista blanca de campos.
 *
 * Solo se pueden registrar metadatos operativos (jobId, provider, state, duración, paso del agente,
 * código de error, contadores). Cualquier otro campo se descarta, y cualquier valor de texto que no
 * tenga forma de identificador se reemplaza por [redacted]. Así, aunque alguien pase por error un
 * nombre, un DNI, una cookie o un fragmento de HTML, no llega a los logs.
 */

export type LogFields = Partial<Record<AllowedField, string | number | boolean | undefined>>;

const ALLOWED_FIELDS = [
  'provider',
  'state',
  'event',
  'step',
  'tool',
  'outcome',
  'durationMs',
  'errorCode',
  'count',
  'resultActions',
  'candidateRows',
  'parsedStudies',
  'index',
  'depth',
  'tag',
  'links',
  'textNodes',
  'siblings',
  'classType',
  'hrefMatch',
  'type',
  'files',
  'bytes',
  'model',
  'runner',
  'port',
  'headless',
  'channel',
  'scheme',
  'host',
  'strategy',
  'found',
  'hrefPresent',
  'sameOrigin',
  'hasOnclick',
  'target',
  'status',
  'contentType',
] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];
const ALLOWED = new Set<string>(ALLOWED_FIELDS);

const SAFE_VALUE = /^[A-Za-z0-9_.:\-]{1,64}$/;

export interface Logger {
  info(jobId: string | null, message: string, fields?: LogFields): void;
  debug(jobId: string | null, message: string, fields?: LogFields): void;
  warn(jobId: string | null, message: string, fields?: LogFields): void;
}

export function formatLine(jobId: string | null, message: string, fields: LogFields = {}): string {
  const parts: string[] = [];
  if (jobId) parts.push('[' + jobId.slice(0, 8) + ']');
  if (!/^[a-z_]{1,40}$/.test(message)) message = 'event';
  parts.push(message);
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k) || v === undefined) continue;
    const value = typeof v === 'number' || typeof v === 'boolean' ? String(v) : SAFE_VALUE.test(v) ? v : '[redacted]';
    parts.push(k + '=' + value);
  }
  return parts.join(' ');
}

export function createLogger(level: 'silent' | 'info' | 'debug' = 'info', sink: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (min: 'info' | 'debug', prefix: string) => (jobId: string | null, message: string, fields?: LogFields) => {
    if (level === 'silent') return;
    if (min === 'debug' && level !== 'debug') return;
    sink(prefix + formatLine(jobId, message, fields));
  };
  return { info: emit('info', ''), debug: emit('debug', 'debug '), warn: emit('info', 'warn ') };
}

export const silentLogger: Logger = createLogger('silent');
