import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackUrl } from './llm/ollama.js';

export type LlmProviderName = 'anthropic' | 'openai' | 'ollama' | 'rules';
export type RunnerMode = 'agent' | 'fake';

export interface Config {
  authMode: 'pilot' | 'google';
  storageProvider: 'local' | 'google_drive';
  publicBaseUrl: string | null;
  databasePath: string;
  google: { clientId: string; clientSecret: string; redirectUri: string; sessionSecret: string; encryptionKey: string; allowedEmails: string[]; allowedSubs: string[] } | null;
  port: number;
  host: string;
  allowedOrigins: string[];
  /** Carpeta del frontend a servir en "/" (null = no servir). */
  portalDir: string | null;
  headless: boolean;
  browserChannel: string | undefined;
  chromiumSandbox: boolean;
  remoteLogin: boolean;
  portalAuth: { username: string; password: string } | null;
  loginTimeoutMs: number;
  jobTtlMs: number;
  /** Cuánto se conservan los PDF de un job completado si el frontend no los retira. */
  fileRetentionMs: number;
  /** Cuánto queda en memoria un job terminado (para que el frontend lea el estado final). */
  jobRetentionMs: number;
  maxAgentSteps: number;
  maxAgentDurationMs: number;
  maxDownloadsPerJob: number;
  maxPdfBytes: number;
  pdfDownloadTimeoutMs: number;
  rdcPdfSourceTimeoutMs: number;
  maxMedicalArchiveBytes: number;
  medicalArchiveDownloadTimeoutMs: number;
  pixeonViewerReadyTimeoutMs: number;
  pixeonToolbarTimeoutMs: number;
  pixeonDebugKeepViewerOpen: boolean;
  pixeonDebugKeepViewerOpenMs: number;
  rdcDebugKeepModalOpen: boolean;
  rdcDebugKeepModalOpenMs: number;
  centroDmAllowedOrigins: string[];
  providerDebugStructure: boolean;
  maxConcurrentJobs: number;
  tmpDir: string;
  runner: RunnerMode;
  llm: {
    provider: LlmProviderName;
    model: string;
    apiKey: string | undefined;
    baseUrl: string | undefined;
    timeoutMs: number;
    /** Solo LLM_PROVIDER=ollama. */
    ollama: { numCtx: number; keepAlive: string };
  };
  /** Screenshots, video, trace y HAR de Playwright. Apagado por defecto: pueden contener datos médicos. */
  debugArtifacts: boolean;
  logLevel: 'silent' | 'info' | 'debug';
}

export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Variable ${key} inválida: debe ser un número positivo.`);
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|si|sí)$/i.test(raw.trim());
}

function httpsOrigins(env: Env, key: string): string[] {
  return (env[key] || '').split(',').map((raw) => raw.trim()).filter(Boolean).map((raw) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error(`Variable ${key} inválida: se esperan orígenes HTTPS explícitos.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw.includes('*')) {
      throw new Error(`Variable ${key} inválida: se esperan orígenes HTTPS explícitos, sin rutas ni comodines.`);
    }
    return url.origin;
  });
}

/** Carga .env (si existe) sin dependencias externas. Las variables ya definidas tienen prioridad. */
export function loadDotEnv(file = path.join(AGENT_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: Env = process.env, argv: string[] = process.argv): Config {
  const provider = (env.LLM_PROVIDER || 'rules').toLowerCase() as LlmProviderName;
  if (!['anthropic', 'openai', 'ollama', 'rules'].includes(provider)) throw new Error(`LLM_PROVIDER desconocido: ${provider}`);
  const ollama = provider === 'ollama';
  const ollamaUrl = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  // Privacidad: con Ollama la inferencia es local. Otro host solo si se habilita a propósito.
  if (ollama && !isLoopbackUrl(ollamaUrl) && !bool(env, 'OLLAMA_ALLOW_REMOTE', false)) {
    throw new Error('OLLAMA_BASE_URL no es local. Usá http://127.0.0.1:11434 o definí OLLAMA_ALLOW_REMOTE=true.');
  }
  const runner: RunnerMode = argv.includes('--fake') ? 'fake' : env.IMPORT_RUNNER === 'fake' ? 'fake' : 'agent';
  const defaultModel = provider === 'openai' ? 'gpt-4.1-mini' : provider === 'anthropic' ? 'claude-sonnet-5' : 'rules';
  const servePortal = bool(env, 'SERVE_PORTAL', true);
  const password = env.PORTAL_AUTH_PASSWORD || '';
  const username = env.PORTAL_AUTH_USER || '1234';
  const authMode = env.AUTH_MODE || 'pilot';
  if (!env.AUTH_MODE && (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET)) throw new Error('Credenciales Google requieren AUTH_MODE explicito; no se habilita el piloto implicitamente.');
  const storageProvider = env.STORAGE_PROVIDER || 'local';
  if (!['pilot', 'google'].includes(authMode) || !['local', 'google_drive'].includes(storageProvider)) throw new Error('AUTH_MODE o STORAGE_PROVIDER invalido.');
  if (storageProvider === 'google_drive' && authMode !== 'google') throw new Error('google_drive requiere AUTH_MODE=google.');
  let publicBaseUrl: string | null = null;
  let google: Config['google'] = null;
  const databasePath = path.resolve(AGENT_ROOT, env.DATABASE_PATH || 'private/portal.sqlite');
  if (authMode === 'google') {
    if (int(env, 'MAX_CONCURRENT_JOBS', 1) !== 1) throw new Error('Google alpha requiere MAX_CONCURRENT_JOBS=1.');
    const base = new URL(env.PUBLIC_BASE_URL || 'invalid:');
    const localHttp = env.NODE_ENV !== 'production' && base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
    if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.pathname !== '/' || base.search || base.hash || env.PUBLIC_BASE_URL !== base.origin) throw new Error('PUBLIC_BASE_URL requiere un origen HTTPS exacto, sin slash final.');
    publicBaseUrl = base.origin;
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.');
    if (env.GOOGLE_REDIRECT_URI !== base.origin + '/api/auth/google/callback') throw new Error('GOOGLE_REDIRECT_URI no coincide con PUBLIC_BASE_URL.');
    if (!env.SESSION_SECRET || Buffer.byteLength(env.SESSION_SECRET) < 32) throw new Error('SESSION_SECRET requiere al menos 32 bytes aleatorios.');
    if (!env.TOKEN_ENCRYPTION_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.TOKEN_ENCRYPTION_KEY) || Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY requiere 32 bytes en base64.');
    if (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH)) throw new Error('DATABASE_PATH requiere una ruta absoluta privada y persistente.');
    if (env.NODE_ENV === 'production' && !databasePath.startsWith('/var/lib/portal-data/')) throw new Error('DATABASE_PATH en produccion debe usar el volumen /var/lib/portal-data.');
    const temporary = path.resolve(AGENT_ROOT, env.TMP_DIR || 'tmp/import-jobs');
    if (databasePath === temporary || databasePath.startsWith(temporary + path.sep)) throw new Error('DATABASE_PATH debe estar fuera de los temporales.');
    if (provider !== 'rules' || bool(env, 'PLAYWRIGHT_DEBUG_ARTIFACTS', false) || bool(env, 'AGENT_DEBUG_ERRORS', false)) throw new Error('Google requiere LLM_PROVIDER=rules y depuracion desactivada.');
    if (env.NODE_ENV === 'production' && storageProvider !== 'google_drive') throw new Error('Google en produccion requiere STORAGE_PROVIDER=google_drive.');
    google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI, sessionSecret: env.SESSION_SECRET,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY, allowedEmails: (env.GOOGLE_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean), allowedSubs: (env.GOOGLE_ALLOWED_SUBS || '').split(',').map(s => s.trim()).filter(Boolean) };
  }
  if (username.includes(':')) throw new Error('PORTAL_AUTH_USER no puede contener dos puntos.');
  if (authMode === 'pilot' && env.NODE_ENV === 'production' && !password) throw new Error('Producción requiere PORTAL_AUTH_PASSWORD.');
  if (bool(env, 'REMOTE_LOGIN', false) && ((authMode === 'pilot' && !password) || bool(env, 'HEADLESS', false) || int(env, 'MAX_CONCURRENT_JOBS', 1) !== 1)) throw new Error('REMOTE_LOGIN requiere autenticación, navegador visible y un único job.');
  if (env.NODE_ENV === 'production' && (bool(env, 'PLAYWRIGHT_DEBUG_ARTIFACTS', false) || bool(env, 'AGENT_DEBUG_ERRORS', false))) throw new Error('Producción no permite artefactos ni errores de depuración.');

  return {
    authMode: authMode as Config['authMode'], storageProvider: storageProvider as Config['storageProvider'], publicBaseUrl, databasePath, google,
    port: int(env, 'PORT', 8787),
    host: env.HOST || '127.0.0.1',
    allowedOrigins: (env.ALLOWED_ORIGINS ||
      'http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8765,http://localhost:8765')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    portalDir: servePortal ? path.resolve(AGENT_ROOT, env.PORTAL_DIR || '../portal-pacientes') : null,
    headless: bool(env, 'HEADLESS', false),
    browserChannel: env.BROWSER_CHANNEL?.trim() || undefined,
    chromiumSandbox: bool(env, 'CHROMIUM_SANDBOX', true),
    remoteLogin: bool(env, 'REMOTE_LOGIN', false),
    portalAuth: authMode === 'pilot' && password ? { username, password } : null,
    loginTimeoutMs: int(env, 'LOGIN_TIMEOUT_MINUTES', 10) * 60_000,
    jobTtlMs: int(env, 'JOB_TTL_MINUTES', 20) * 60_000,
    fileRetentionMs: int(env, 'FILE_RETENTION_MINUTES', 5) * 60_000,
    jobRetentionMs: int(env, 'JOB_RETENTION_MINUTES', 2) * 60_000,
    maxAgentSteps: int(env, 'MAX_AGENT_STEPS', 30),
    // Un modelo local por CPU es más lento: más tiempo por objetivo, salvo que se configure otro valor.
    maxAgentDurationMs: int(env, 'MAX_AGENT_DURATION_MS', ollama ? 600_000 : 180_000),
    maxDownloadsPerJob: int(env, 'MAX_DOWNLOADS_PER_JOB', 10),
    maxPdfBytes: int(env, 'MAX_PDF_BYTES', 40 * 1024 * 1024),
    pdfDownloadTimeoutMs: int(env, 'PDF_DOWNLOAD_TIMEOUT_MS', 60_000),
    rdcPdfSourceTimeoutMs: int(env, 'RDC_PDF_SOURCE_TIMEOUT_MS', 30_000),
    maxMedicalArchiveBytes: int(env, 'MAX_MEDICAL_ARCHIVE_BYTES', 512 * 1024 * 1024),
    medicalArchiveDownloadTimeoutMs: int(env, 'MEDICAL_ARCHIVE_DOWNLOAD_TIMEOUT_MS', 120_000),
    pixeonViewerReadyTimeoutMs: int(env, 'PIXEON_VIEWER_READY_TIMEOUT_MS', 30_000),
    pixeonToolbarTimeoutMs: int(env, 'PIXEON_TOOLBAR_TIMEOUT_MS', 30_000),
    pixeonDebugKeepViewerOpen: env.NODE_ENV !== 'production' && bool(env, 'PIXEON_DEBUG_KEEP_VIEWER_OPEN', false),
    pixeonDebugKeepViewerOpenMs: env.NODE_ENV !== 'production' ? Math.min(120_000, int(env, 'PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS', 120_000)) : 0,
    rdcDebugKeepModalOpen: env.NODE_ENV !== 'production' && bool(env, 'RDC_DEBUG_KEEP_MODAL_OPEN', false),
    rdcDebugKeepModalOpenMs: env.NODE_ENV !== 'production' ? Math.min(120_000, int(env, 'RDC_DEBUG_KEEP_MODAL_OPEN_MS', 120_000)) : 0,
    centroDmAllowedOrigins: httpsOrigins(env, 'CENTRODM_ALLOWED_ORIGINS'),
    providerDebugStructure: bool(env, 'PROVIDER_DEBUG_STRUCTURE', false),
    maxConcurrentJobs: int(env, 'MAX_CONCURRENT_JOBS', 1),
    tmpDir: path.resolve(AGENT_ROOT, env.TMP_DIR || 'tmp/import-jobs'),
    runner,
    llm: {
      provider,
      // Con Ollama se usa OLLAMA_MODEL (LLM_MODEL puede seguir apuntando a un modelo cloud).
      model: ollama ? env.OLLAMA_MODEL || 'qwen3:8b' : env.LLM_MODEL || defaultModel,
      // Ollama no usa claves: nunca se leen las de Anthropic/OpenAI en ese modo.
      apiKey: provider === 'openai' ? env.OPENAI_API_KEY : provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined,
      baseUrl: ollama ? ollamaUrl : provider === 'openai' ? env.OPENAI_BASE_URL || 'https://api.openai.com/v1' : env.ANTHROPIC_BASE_URL,
      timeoutMs: ollama ? int(env, 'OLLAMA_TIMEOUT_MS', 120_000) : int(env, 'LLM_TIMEOUT_MS', 30_000),
      ollama: { numCtx: int(env, 'OLLAMA_NUM_CTX', 8192), keepAlive: env.OLLAMA_KEEP_ALIVE || '30m' },
    },
    debugArtifacts: bool(env, 'PLAYWRIGHT_DEBUG_ARTIFACTS', false),
    logLevel: (['silent', 'info', 'debug'].includes(env.LOG_LEVEL || '') ? env.LOG_LEVEL : 'info') as Config['logLevel'],
  };
}
