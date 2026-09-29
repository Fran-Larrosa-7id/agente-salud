import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { loadConfig } from '../../src/config.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { createModel } from '../../src/llm/index.js';
import { checkOllama } from '../../src/llm/ollama.js';
import { createLogger } from '../../src/security/logger.js';
import { FAKE_USER, startFakePortal } from '../fixtures/fake-portal.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';

/**
 * Manual (no corre en CI): el flujo completo contra el portal falso, decidido por el modelo
 * REAL de Ollama. Uso: OLLAMA_E2E=true npm run test:ollama
 */
const enabled = process.env.OLLAMA_E2E === 'true';
let portal: Awaited<ReturnType<typeof startFakePortal>>;
let host: BrowserHost;

before(async () => {
  if (!enabled) return;
  portal = await startFakePortal();
  host = new BrowserHost({ headless: process.env.HEADLESS !== 'false', debugArtifacts: false, debugDir: path.join(tmpdir(), 'pp-debug') });
});
after(async () => {
  if (!enabled) return;
  await host.close();
  await portal.close();
});

test('Ollama real: descubre los estudios y trae los PDF del portal falso', { skip: !enabled && 'definí OLLAMA_E2E=true', timeout: 1_500_000 }, async () => {
  const llm = loadConfig({ ...process.env, LLM_PROVIDER: 'ollama' }, []).llm;
  const status = await checkOllama(llm.baseUrl!, llm.model);
  assert.equal(status.status, 'ok', `Ollama no está listo (${status.status})`);

  const logs: string[] = [];
  const manager = new JobManager({
    config: testConfig({ llm, loginTimeoutMs: 60_000, maxAgentDurationMs: 600_000, jobTtlMs: 1_500_000 }),
    providers: { fake: testProvider(portal.url + '/lwcloud/fake/login') },
    log: createLogger('debug', (l) => { logs.push(l); console.log(l); }),
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => createModel(llm), loginPollMs: 300 })),
  });
  let runner: AgentImportRunner | null = null;
  const job = manager.create('fake');
  const t0 = Date.now();
  await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 30_000);
  const page = runner!.session!.activePage();
  await page.fill('input[name=usuario]', FAKE_USER.usuario);
  await page.fill('input[name=pass]', FAKE_USER.pass);
  await page.click('button[type=submit]');

  await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 600_000, 200);
  assert.equal(job.state, S.WAITING_SELECTION, `estado ${job.state} ${job.errorCode}`);
  console.log(`descubrimiento: ${job.studies.length} estudios en ${Math.round((Date.now() - t0) / 1000)} s`);
  assert.deepEqual(job.studies.map((s) => s.protocol), ['1001', '1002', '1003']);

  const t1 = Date.now();
  manager.select(job.id, job.studies.map((s) => s.id));
  await waitFor(() => job.isTerminal, 900_000, 200);
  console.log(`descarga: ${job.files.length} PDF, fallas ${JSON.stringify(job.failures)}, ${Math.round((Date.now() - t1) / 1000)} s`);
  assert.equal(job.state, S.COMPLETED, `estado ${job.state} ${job.errorCode}`);
  assert.ok(job.files.length >= 1);
  assert.ok(!logs.join('\n').includes(FAKE_USER.pass));
  await manager.shutdown();
});
