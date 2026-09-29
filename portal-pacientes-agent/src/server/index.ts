import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { BrowserHost } from '../browser/browser-host.js';
import { AGENT_ROOT, loadConfig, loadDotEnv } from '../config.js';
import { agentRunnerFactory } from '../jobs/agent-runner.js';
import { fakeRunnerFactory, type FakeScenario } from '../jobs/fake-runner.js';
import { JobManager } from '../jobs/job-manager.js';
import { createModel, isModelConfigured } from '../llm/index.js';
import { checkOllama, type OllamaStatus, warmupOllama } from '../llm/ollama.js';
import { PROVIDERS } from '../providers/index.js';
import { createLogger } from '../security/logger.js';
import { createApp } from './app.js';

loadDotEnv();
const config = loadConfig();
const log = createLogger(config.logLevel);

// Restos de una ejecución anterior (p. ej. si el proceso se cortó): se borran al iniciar.
await rm(config.tmpDir, { recursive: true, force: true });
await mkdir(config.tmpDir, { recursive: true });

const host = new BrowserHost({
  headless: config.headless,
  channel: config.browserChannel,
  debugArtifacts: config.debugArtifacts,
  debugDir: path.join(AGENT_ROOT, 'debug-artifacts'),
});

const fake = config.runner === 'fake';
const useOllama = !fake && config.llm.provider === 'ollama';
const ollamaUrl = config.llm.baseUrl || 'http://127.0.0.1:11434';

// Ollama: se comprueba al iniciar y cada 15 s. Si no está, los jobs nuevos se rechazan con
// MODEL_UNAVAILABLE antes de abrir el laboratorio. Nunca se cae a un modelo cloud.
let ollamaStatus: OllamaStatus | null = useOllama ? await checkOllama(ollamaUrl, config.llm.model) : null;
let ollamaWarmed = false;
let ollamaWarmupAttempted = false;
async function warmupLocalModel(): Promise<void> {
  if (!useOllama || ollamaStatus?.status !== 'ok' || ollamaWarmupAttempted) return;
  ollamaWarmupAttempted = true;
  const started = Date.now();
  log.info(null, 'ollama_warming_up', { model: config.llm.model });
  ollamaWarmed = await warmupOllama(ollamaUrl, config.llm.model, fetch, Math.max(config.llm.timeoutMs, 120_000), config.llm.ollama.keepAlive);
  if (ollamaWarmed) log.info(null, 'ollama_ready', { model: config.llm.model, durationMs: Date.now() - started });
  else log.warn(null, 'ollama_warmup_failed', { model: config.llm.model, errorCode: 'MODEL_UNAVAILABLE' });
}
// El server no queda esperando una primera inferencia de Qwen tras el login. Si el warm-up falla,
// se conserva el comportamiento normal de disponibilidad y el proceso igualmente arranca.
if (useOllama && ollamaStatus?.status === 'ok') await warmupLocalModel();
const ollamaOk = () => ollamaStatus?.status === 'ok';
function describeOllama(s: OllamaStatus): string {
  if (s.status === 'ok') return 'disponible';
  if (s.status === 'model_not_found') return `falta el modelo. Ejecutá: ollama pull ${config.llm.model}`;
  return 'no responde';
}
async function refreshOllama() {
  const prev = ollamaStatus?.status;
  ollamaStatus = await checkOllama(ollamaUrl, config.llm.model);
  info.modelReady = ollamaOk();
  if (ollamaStatus.status === 'ok' && !ollamaWarmed) await warmupLocalModel();
  if (prev === ollamaStatus.status) return;
  if (ollamaOk()) log.info(null, 'ollama_connected', { model: config.llm.model });
  else log.warn(null, 'ollama_unavailable', { model: config.llm.model, errorCode: 'MODEL_UNAVAILABLE' });
}
if (useOllama) setInterval(() => void refreshOllama(), 15_000).unref();

const modelReady = fake || (useOllama ? ollamaOk() : isModelConfigured(config.llm));
const runnerFactory = fake
  ? fakeRunnerFactory({ scenario: (process.env.FAKE_SCENARIO as FakeScenario) || 'ok' })
  : agentRunnerFactory({ host, createModel: () => createModel(config.llm) });

const manager = new JobManager({
  config,
  providers: PROVIDERS,
  runnerFactory,
  log,
  preflight: () => {
    if (useOllama) {
      if (ollamaOk()) return null;
      void refreshOllama(); // por si Ollama se inició recién: el próximo intento ya lo ve
      return 'MODEL_UNAVAILABLE';
    }
    return modelReady ? null : 'LLM_NOT_CONFIGURED';
  },
});

const info = {
  runner: config.runner,
  model: fake ? 'fake' : config.llm.provider + ':' + config.llm.model,
  modelReady,
  browserReady: null as boolean | null,
  browserChannel: config.browserChannel,
};
const app = createApp({ config, manager, providers: PROVIDERS, info });

const server = app.listen(config.port, config.host, async () => {
  log.info(null, 'server_started', { port: config.port, runner: config.runner, headless: config.headless, model: fake ? 'fake' : config.llm.provider });
  if (useOllama && ollamaStatus) {
    if (ollamaOk()) log.info(null, 'ollama_connected', { model: config.llm.model });
    console.log(`Ollama: ${ollamaUrl}\nModelo: ${config.llm.model}\nEstado: ${describeOllama(ollamaStatus)}`);
    if (!ollamaOk()) {
      console.log(ollamaStatus.status === 'offline'
        ? 'El modelo local Ollama no está disponible.\nEjecutá Ollama antes de iniciar el agente.'
        : `El modelo ${config.llm.model} no está descargado en Ollama. Ejecutá: ollama pull ${config.llm.model}`);
    }
  }
  if (config.browserChannel) {
    try {
      await host.ensureBrowserAvailable();
      info.browserReady = true;
      log.info(null, 'browser_ready', { channel: config.browserChannel });
    } catch {
      info.browserReady = false;
      log.warn(null, 'browser_not_installed', { errorCode: 'BROWSER_NOT_INSTALLED', channel: config.browserChannel });
    }
  }
  console.log(`Agente listo en http://${config.host}:${config.port}`);
  if (config.portalDir) console.log(`Portal de Pacientes en http://${config.host}:${config.port}/#/traer?inst=pc`);
  if (!modelReady && !useOllama) console.log('Falta configurar el modelo de IA (ANTHROPIC_API_KEY u OPENAI_API_KEY en .env). Para probar sin IA: LLM_PROVIDER=rules o npm run start:fake.');
  if (config.debugArtifacts) console.log('ATENCIÓN: PLAYWRIGHT_DEBUG_ARTIFACTS está activo. Usalo solo con cuentas de prueba.');
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await manager.shutdown();
  await host.close();
  await rm(config.tmpDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
