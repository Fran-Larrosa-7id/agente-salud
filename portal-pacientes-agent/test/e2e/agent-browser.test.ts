import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { validatePdf } from '../../src/jobs/pdf.js';
import { JobState as S } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { createLogger } from '../../src/security/logger.js';
import { FAKE_USER, startFakePortal } from '../fixtures/fake-portal.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';
import { readFile } from 'node:fs/promises';

/**
 * Integración con navegador REAL (Playwright, headless) contra el portal falso, usando el modelo
 * determinista. Verifica detección de login, descubrimiento, las 3 formas de entregar el PDF,
 * privacidad (qué ve el modelo, qué queda en logs) y cierre del navegador.
 */
let portal: Awaited<ReturnType<typeof startFakePortal>>;
let host: BrowserHost;

before(async () => {
  portal = await startFakePortal();
  host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: path.join(tmpdir(), 'pp-debug') });
});
after(async () => {
  await host.close();
  await portal.close();
});

function setup() {
  const provider = testProvider(portal.url + '/lwcloud/fake/login');
  const model = new RulesModel(true);
  const logs: string[] = [];
  let runner: AgentImportRunner | null = null;
  const manager = new JobManager({
    config: testConfig({ loginTimeoutMs: 30_000, maxAgentDurationMs: 60_000 }),
    providers: { fake: provider },
    log: createLogger('debug', (l) => logs.push(l)),
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => model, loginPollMs: 200, humanPollMs: 200 })),
  });
  return { manager, model, logs, runner: () => runner! };
}

test('el paciente inicia sesión, el agente descubre y trae los 3 PDF', { timeout: 120_000 }, async () => {
  const { manager, model, logs, runner } = setup();
  const job = manager.create('fake');
  const events: unknown[] = [];
  job.on('event', (e) => events.push(e));

  await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 20_000);
  // Simula al PACIENTE escribiendo en la ventana del laboratorio. El sistema no toca estos campos.
  const page = runner().session!.activePage();
  await page.fill('input[name=usuario]', FAKE_USER.usuario);
  await page.fill('input[name=pass]', FAKE_USER.pass);
  await page.click('button[type=submit]');

  await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 30_000);
  assert.equal(job.state, S.WAITING_SELECTION, `estado ${job.state} ${job.errorCode}`);
  assert.ok(job.studies.every((s) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s.id)), 'ids opacos UUID');
  assert.ok(job.studies.every((s) => !!s.protocol), 'el protocolo administrativo se expone para la UI');
  assert.equal(job.studies.length, 3, 'el extractor devuelve todas las filas visibles sin abrir ninguna');
  assert.deepEqual(job.studies.map((s) => s.date), ['2026-05-28', '2026-01-14', '2025-11-03']);

  manager.select(job.id, job.studies.map((s) => s.id));
  await waitFor(() => job.state === S.IMPORTING, 40_000).catch(() => {
    throw new Error(`el runner no terminó la descarga: ${job.state} ${job.errorCode} páginas ${runner().session?.openPages()} logs ${logs.join('\n')}`);
  });
  for (const file of job.files) await manager.acknowledgePortalImport(job.id, file.id, file.studyId, true); // acuse simulado tras validar los archivos almacenados.
  await waitFor(() => job.isTerminal, 5_000);
  assert.equal(job.state, S.COMPLETED, `estado ${job.state} ${job.errorCode} fallas ${JSON.stringify(job.failures)} logs ${logs.join('\n')}`);
  assert.equal(job.files.length, 3);
  assert.ok(job.files.every((file) => file.importedBy === 'agent' && /^\d{4}-\d{2}-\d{2}T/.test(file.importedAt)));
  assert.ok(job.files.every((file) => job.studies.some((study) => study.id === file.studyId)), 'cada PDF refiere a un studyId conocido');
  assert.equal(model.seen.length, 0, 'Percamb resuelve descubrimiento y descarga sin pasos LLM');
  assert.ok(events.some((event) => JSON.stringify(event).includes('searching_studies')));
  for (const f of job.files) {
    const stored = manager.file(job.id, f.id)!;
    assert.ok(validatePdf(await readFile(stored.path), 'application/pdf').ok);
  }
  await waitFor(() => host.openContexts === 0, 5_000);

  // Privacidad: la contraseña no aparece en ningún lado; nombre y DNI no llegan al modelo ni a los logs.
  const toModel = JSON.stringify(model.seen);
  const everything = toModel + logs.join('\n') + JSON.stringify(events) + JSON.stringify(job.snapshot());
  assert.ok(!everything.includes(FAKE_USER.pass), 'la contraseña pasó por la aplicación');
  for (const s of ['PEREZ', 'JUAN', '30111222', 'Hemoglobina', '13,5']) {
    assert.ok(!toModel.includes(s), `el modelo recibió ${s}`);
    assert.ok(!logs.join('\n').includes(s), `los logs contienen ${s}`);
  }
  // El agente nunca tocó acciones de escritura ni el enlace externo.
  assert.ok(!model.seen.some((o) => o.history.some((h) => /contraseña|Nuestro sitio|Cerrar sesión/.test(h.element ?? ''))));
  await manager.shutdown();
});

test('cancelar mientras espera el login cierra el navegador de inmediato', { timeout: 60_000 }, async () => {
  const { manager } = setup();
  const job = manager.create('fake');
  await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 20_000);
  assert.equal(host.openContexts, 1);
  await manager.cancel(job.id);
  assert.equal(job.state, S.CANCELLED);
  assert.equal(host.openContexts, 0);
  await manager.shutdown();
});

test('si el paciente cierra la ventana, el job se cancela', { timeout: 60_000 }, async () => {
  const { manager, runner } = setup();
  const job = manager.create('fake');
  await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 20_000);
  await runner().session!.activePage().close();
  await waitFor(() => job.isTerminal, 10_000);
  assert.equal(job.errorCode, 'WINDOW_CLOSED');
  await waitFor(() => host.openContexts === 0, 5_000);
  await manager.shutdown();
});

test('sin login a tiempo: AUTH_TIMEOUT y cierre', { timeout: 60_000 }, async () => {
  const provider = testProvider(portal.url + '/lwcloud/fake/login');
  const manager = new JobManager({
    config: testConfig({ loginTimeoutMs: 1_500 }),
    providers: { fake: provider },
    log: createLogger('silent'),
    runnerFactory: (job, deps) => new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 200 }),
  });
  const job = manager.create('fake');
  await waitFor(() => job.isTerminal, 20_000);
  assert.equal(job.state, S.AUTH_TIMEOUT);
  await waitFor(() => host.openContexts === 0, 5_000);
  await manager.shutdown();
});

test('parser mismatch conserva Edge abierto y nunca pide una intervención humana inventada', { timeout: 60_000 }, async () => {
  const provider = testProvider(portal.url + '/lwcloud/fake/login?mode=mismatch');
  const model = new RulesModel(true);
  const logs: string[] = [];
  let runner: AgentImportRunner | null = null;
  const manager = new JobManager({
    config: testConfig({ loginTimeoutMs: 30_000, jobTtlMs: 20_000, maxAgentDurationMs: 60_000, providerDebugStructure: true }),
    providers: { fake: provider },
    log: createLogger('debug', (line) => logs.push(line)),
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => model, loginPollMs: 200, humanPollMs: 200 })),
  });
  const job = manager.create('fake');
  const events: unknown[] = [];
  job.on('event', (event) => events.push(event));
  try {
    await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 20_000);
    const page = runner!.session!.activePage();
    await page.fill('input[name=usuario]', FAKE_USER.usuario);
    await page.fill('input[name=pass]', FAKE_USER.pass);
    await page.click('button[type=submit]');

    await waitFor(() => logs.some((line) => line.includes('percamb_parser_mismatch')), 20_000);
    assert.equal(job.state, S.PROVIDER_PARSER_MISMATCH);
    assert.equal(job.errorCode, 'PROVIDER_PARSER_MISMATCH');
    assert.equal(job.studies.length, 0);
    assert.equal(host.openContexts, 1, 'la sesión queda disponible para diagnóstico');
    assert.equal(model.seen.length, 0, 'el parser conocido no delega la lista al LLM');
    assert.ok(logs.some((line) => line.includes('percamb_page') && line.includes('type=results_list')));
    assert.ok(logs.some((line) => line.includes('percamb_result_actions') && line.includes('count=2')));
    assert.ok(logs.some((line) => line.includes('percamb_result_links') && line.includes('count=0')));
    assert.ok(logs.some((line) => line.includes('percamb_candidate_rows') && line.includes('count=2')));
    assert.ok(logs.some((line) => line.includes('resultActions=2') && line.includes('candidateRows=2') && line.includes('parsedStudies=0')));
    assert.ok(events.some((event) => JSON.stringify(event).includes('provider_parser_mismatch')));
    assert.ok(!events.some((event) => JSON.stringify(event).includes('human_action_required')));
    for (const privateValue of ['PEREZ', FAKE_USER.usuario, 'Hemoglobina']) assert.ok(!logs.join('\n').includes(privateValue));

    const session = runner!.session!;
    await session.navigate(portal.url + '/lwcloud/fake/resultados-links?count=2');
    await manager.retryDiscovery(job.id);
    assert.equal(job.state, S.WAITING_SELECTION);
    assert.equal(job.studies.length, 2);
    assert.equal(host.openContexts, 1, 'el retry reutiliza el mismo contexto autenticado');
    assert.equal(model.seen.length, 0, 'el retry vuelve a usar el extractor directo sin LLM');
    assert.ok(logs.some((line) => line.includes('percamb_result_links') && line.includes('count=2')));
  } finally {
    await manager.cancel(job.id).catch(() => {});
    await manager.shutdown();
  }
  await waitFor(() => host.openContexts === 0, 5_000);
});
