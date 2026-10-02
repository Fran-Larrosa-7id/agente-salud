import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fakeRunnerFactory, type FakeOptions } from '../../src/jobs/fake-runner.js';
import { JobManager, ManagerError } from '../../src/jobs/job-manager.js';
import type { JobRunner } from '../../src/jobs/runner.js';
import { JobState as S } from '../../src/jobs/states.js';
import { silentLogger } from '../../src/security/logger.js';
import { createApp } from '../../src/server/app.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';
import type { Config } from '../../src/config.js';

const FAST: FakeOptions = { loginDelayMs: 30, stepMs: 10 };
const providers = { fake: testProvider() };

for (const cancel of [false, true]) {
  test(`Pixeon debug: retención temporal y cierre por ${cancel ? 'cancelación' : 'timeout'}`, async () => {
    let disposed = false;
    const m = new JobManager({
      config: testConfig({ pixeonDebugKeepViewerOpen: true }),
      providers: { centrodm: { ...testProvider(), id: 'centrodm' } },
      log: silentLogger,
      runnerFactory: job => ({
        debugViewerRetentionMs: 150,
        start: async () => { job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'DOWNLOAD_ACTION_NOT_FOUND'); },
        importSelected: async () => {},
        dispose: async () => { disposed = true; },
      }),
    });
    try {
      const job = m.create('centrodm');
      assert.equal(disposed, false, 'terminal no cierra inmediatamente');
      if (cancel) await m.cancel(job.id);
      else await waitFor(() => disposed, 2000);
      assert.equal(disposed, true);
    } finally { await m.shutdown(); }
  });
}

test('Pixeon debug: no registra job_closed antes del TTL y lo registra al terminar', async () => {
  let disposed = false;
  const logs: string[] = [];
  const m = new JobManager({
    config: testConfig({ pixeonDebugKeepViewerOpen: true, pixeonDebugKeepViewerOpenMs: 120 }),
    providers: { centrodm: { ...testProvider(), id: 'centrodm' } },
    log: { info: (_id, message, fields) => logs.push(`${message} ${JSON.stringify(fields || {})}`), debug: () => {}, warn: () => {} },
    runnerFactory: job => ({
      debugViewerRetentionMs: 120,
      start: async () => { job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'DOWNLOAD_ACTION_NOT_FOUND'); },
      importSelected: async () => {},
      dispose: async () => { disposed = true; },
    }),
  });
  try {
    m.create('centrodm');
    assert.equal(disposed, false);
    assert.ok(logs.some(line => line.startsWith('pixeon_debug_hold') && line.includes('ttlMs')));
    assert.ok(!logs.some(line => line.startsWith('job_closed')));
    await waitFor(() => disposed && logs.some(line => line.startsWith('job_closed')), 2_000);
  } finally { await m.shutdown(); }
});

function manager(cfg: Config, opts: FakeOptions = FAST) {
  return new JobManager({ config: cfg, providers, runnerFactory: fakeRunnerFactory(opts), log: silentLogger });
}

for (const [enabled, code] of [[false, 'DOWNLOAD_ACTION_NOT_FOUND'], [true, 'INVALID_MEDICAL_ARCHIVE']] as const) {
  test(`Pixeon: cleanup inmediato con debug=${enabled} y error=${code}`, async () => {
    let disposed = false;
    const m = new JobManager({
      config: testConfig({ pixeonDebugKeepViewerOpen: enabled }),
      providers: { centrodm: { ...testProvider(), id: 'centrodm' } },
      log: silentLogger,
      runnerFactory: job => ({
        debugViewerRetentionMs: 90_000,
        start: async () => { job.fail(S.AGENT_UNABLE_TO_CONTINUE, code); },
        importSelected: async () => {},
        dispose: async () => { disposed = true; },
      }),
    });
    try { m.create('centrodm'); assert.equal(disposed, true); }
    finally { await m.shutdown(); }
  });
}

test('flujo completo con FakeProviderAgent: selección, archivos y limpieza al entregar', async () => {
  const cfg = testConfig();
  const m = manager(cfg);
  const job = m.create('fake');
  await waitFor(() => job.state === S.WAITING_SELECTION);
  assert.equal(job.studies.length, 2);
  m.select(job.id, [job.studies[0].id]);
  await waitFor(() => job.state === S.COMPLETED);
  assert.equal(job.files.length, 1, 'solo el estudio elegido');
  const f = m.file(job.id, job.files[0].id)!;
  assert.ok(existsSync(f.path));
  assert.equal(path.basename(path.dirname(f.path)), job.id);
  await m.markDelivered(job.id, f.id);
  assert.equal(existsSync(path.join(cfg.tmpDir, job.id)), false, 'entregados todos, se borran');
  await m.shutdown();
});

test('TTL: el job vence, se cierra el runner y se borran archivos', async () => {
  const cfg = testConfig({ jobTtlMs: 80 });
  let disposed = 0;
  const m = new JobManager({
    config: cfg,
    providers,
    log: silentLogger,
    runnerFactory: (job, deps) => {
      const inner = fakeRunnerFactory({ loginDelayMs: 10_000, stepMs: 5 })(job, deps);
      const r: JobRunner = { start: () => inner.start(), importSelected: (ids) => inner.importSelected(ids), dispose: async () => { disposed++; } };
      return r;
    },
  });
  const job = m.create('fake');
  await waitFor(() => job.state === S.EXPIRED, 2000);
  assert.equal(job.errorCode, 'JOB_TTL');
  await waitFor(() => disposed === 1);
  await m.shutdown();
});

test('cancelar: CANCELLED, runner cerrado y sin archivos', async () => {
  const cfg = testConfig();
  const m = manager(cfg, { loginDelayMs: 10_000, stepMs: 5 });
  const job = m.create('fake');
  await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN);
  await m.cancel(job.id);
  assert.equal(job.state, S.CANCELLED);
  assert.equal(job.errorCode, 'CANCELLED_BY_USER');
  assert.equal(existsSync(path.join(cfg.tmpDir, job.id)), false);
  await m.shutdown();
});

test('límite de jobs simultáneos y proveedor desconocido', async () => {
  const cfg = testConfig({ maxConcurrentJobs: 1 });
  const m = manager(cfg, { loginDelayMs: 10_000, stepMs: 5 });
  m.create('fake');
  assert.throws(() => m.create('fake'), (e: ManagerError) => e.code === 'TOO_MANY_JOBS' && e.status === 429);
  assert.throws(() => m.create('otro'), (e: ManagerError) => e.code === 'UNKNOWN_PROVIDER');
  await m.shutdown();
});

test('escenarios de error del FakeProviderAgent', async () => {
  for (const [scenario, state] of [['timeout', S.AUTH_TIMEOUT], ['unavailable', S.PROVIDER_UNAVAILABLE]] as const) {
    const m = manager(testConfig(), { ...FAST, scenario });
    const job = m.create('fake');
    await waitFor(() => job.state === state);
    await m.shutdown();
  }
});

test('API + SSE: eventos en orden, importación y descarga del PDF', async () => {
  const cfg = testConfig();
  const m = manager(cfg);
  const app = createApp({ config: cfg, manager: m, providers, info: { runner: 'fake', model: 'fake', modelReady: true } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const created = await fetch(base + '/api/imports/fake', { method: 'POST' });
    assert.equal(created.status, 201);
    const { jobId } = (await created.json()) as { jobId: string };

    const events: string[] = [];
    const res = await fetch(`${base}/api/imports/${jobId}/events`);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let imported = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Lo anterior a la conexión llega dentro del snapshot (según cuánto tardó en conectarse).
      if (buf.includes('"state":"WAITING_SELECTION"') && !events.includes('waiting_selection')) events.push('waiting_selection');
      for (const m of buf.matchAll(/event: (\w+)/g)) if (!events.includes(m[1]) || m[1].startsWith('file')) events.push(m[1]);
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      if (!imported && events.includes('waiting_selection')) {
        imported = true;
        const studies = (await (await fetch(`${base}/api/imports/${jobId}/studies`)).json()) as { studies: { id: string }[] };
        const guardedJob = m.get(jobId)!;
        const sourceKey = 'b'.repeat(64);
        guardedJob.studies[0].sourceKey = sourceKey;
        const duplicate = await fetch(`${base}/api/imports/${jobId}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studyIds: [studies.studies[0].id], importedSourceKeys: [sourceKey] }) });
        assert.equal(duplicate.status, 409);
        assert.deepEqual(await duplicate.json(), { error: 'ALREADY_IMPORTED' });
        assert.equal(guardedJob.selection.length, 0, 'una selección repetida no arranca el runner');
        const bad = await fetch(`${base}/api/imports/${jobId}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studyIds: ['nope'] }) });
        assert.equal(bad.status, 400);
        const ok = await fetch(`${base}/api/imports/${jobId}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studyIds: studies.studies.map((s) => s.id) }) });
        assert.equal(ok.status, 202);
      }
    }
    // Los eventos previos pueden llegar resumidos en el snapshot; los de la importación ocurren siempre con el cliente conectado.
    assert.equal(events[0], 'snapshot');
    const expected = ['waiting_selection', 'opening_study', 'finding_document', 'downloading', 'importing', 'file_ready'];
    for (const e of expected) assert.ok(events.includes(e), `falta ${e} en ${events}`);
    assert.ok(events.indexOf('opening_study') < events.indexOf('file_ready'));
    assert.equal(events.at(-1), 'completed');

    const snap = (await (await fetch(`${base}/api/imports/${jobId}`)).json()) as { files: { id: string }[] };
    assert.equal(snap.files.length, 2);
    const pdf = await fetch(`${base}/api/imports/${jobId}/files/${snap.files[0].id}`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-');

    const del = await fetch(`${base}/api/imports/${jobId}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(existsSync(path.join(cfg.tmpDir, jobId)), false, 'DELETE borra los archivos');
    assert.equal((await fetch(`${base}/api/imports/not-a-uuid`)).status, 404);
  } finally {
    server.close();
    await m.shutdown();
  }
});
