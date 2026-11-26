import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { validatePdf } from '../../src/jobs/pdf.js';
import { OneUseLogin } from '../../src/jobs/login-credentials.js';
import { RulesModel } from '../../src/llm/rules.js';
import { percamb } from '../../src/providers/percamb/percamb.provider.js';
import { createLogger } from '../../src/security/logger.js';
import { createApp } from '../../src/server/app.js';
import { createGoogleServices } from '../../src/server/google-services.js';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { GoogleDriveStorage } from '../../src/storage/google-drive.js';
import { PendingImports } from '../../src/storage/pending-imports.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';
import { FAKE_USER, startFakePortal } from '../fixtures/fake-portal.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';
import { waitFor } from '../helpers.js';

test('Pérez Cambet: login invisible, PDF en Drive, privacidad y fallback en la misma sesión', { timeout: 60_000 }, async () => {
  const fixture = await startFakePortal();
  const config = googleTestConfig();
  config.headless = true;
  config.remoteLogin = true;
  const mock = new MockGoogle();
  const google = createGoogleServices(config, mock.fetch)!;
  google.drive = new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {});
  const pending = new PendingImports(config.databasePath, config.jobTtlMs);
  const logs: string[] = [];
  const traceDir = path.dirname(config.databasePath);
  const host = new BrowserHost({
    headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: true, debugDir: traceDir,
  });
  const loginUrl = fixture.url + '/lwcloud/percamb/login';
  const provider = { ...percamb, allowedHosts: ['127.0.0.1'], requireHttps: false, loginUrl: loginUrl + '?visible=1&mode=alert' };
  const providers = { percamb: provider };
  const log = createLogger('debug', line => logs.push(line));
  const desktop = new RemoteDesktop(log);
  const manager = new JobManager({
    config, providers, log, storage: google.drive, pendingImports: pending,
    runnerFactory: (job, deps) => new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 60 }),
  });
  const server = createApp({ config, manager, providers, desktop, google, info: { runner: 'agent', model: 'rules', modelReady: true } })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  config.publicBaseUrl = base;
  const sessionFor = (sub: string) => {
    const owner = google.db.upsertUser(sub, sub + '@example.test');
    const cookie = randomBytes(32).toString('hex');
    google.db.createSession(createHmac('sha256', config.google!.sessionSecret).update(cookie).digest('hex'), owner.id, Date.now() + 600_000);
    return { owner, cookie };
  };
  const { owner, cookie } = sessionFor('account-A');
  const other = sessionFor('account-B');
  google.db.saveCredentials(owner.id, {
    accessToken: 'access-account-A', refreshToken: 'refresh-account-A', expiresAt: Date.now() + 600_000,
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: testBrowserChannel });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'portal_session', value: cookie, url: base }]);
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const page = await context.newPage();
    const urls: string[] = [];
    context.on('request', req => { urls.push(req.url()); });
    await page.goto(base + '/#/traer?inst=pc');
    await page.getByLabel('Usuario o DNI').fill(FAKE_USER.usuario);
    await page.getByLabel('Contraseña', { exact: true }).fill('qa-deliberately-invalid');
    const consent = page.getByRole('checkbox', { name: /Autorizo al Portal de Pacientes/ });
    const box = await consent.boundingBox();
    assert.ok(box && box.width >= 18 && box.height >= 18, 'the checkbox is visibly sized');
    assert.equal(await consent.evaluate(input => getComputedStyle(input).opacity), '1');
    await page.getByRole('button', { name: 'Conectar y buscar estudios' }).click();
    assert.equal(manager.activeCount(), 0, 'the form requires explicit consent');
    const start = (credentials: unknown) => context.request.post(base + '/api/imports/percamb', { headers: { Origin: base }, data: { credentials } });
    const missingConsent = await start({ username: FAKE_USER.usuario, password: FAKE_USER.pass });
    assert.equal(missingConsent.status(), 400);
    assert.deepEqual(await missingConsent.json(), { error: 'LAB_LOGIN_CONSENT_REQUIRED' });
    await consent.press('Space');
    assert.equal(await consent.isChecked(), true);
    await page.getByText('Autorizo al Portal de Pacientes', { exact: false }).click();
    assert.equal(await consent.isChecked(), false);
    await consent.click();
    assert.equal(await consent.isChecked(), true);
    await page.getByRole('button', { name: 'Conectar y buscar estudios' }).click();
    await page.getByRole('heading', { name: 'El laboratorio rechazó los datos de acceso' }).waitFor();
    await waitFor(() => manager.activeCount() === 0);
    provider.loginUrl = loginUrl + '?mode=legacy-results';
    await page.getByRole('button', { name: 'Volver a intentar' }).click();
    await page.getByLabel('Usuario o DNI').fill(FAKE_USER.usuario);
    await page.getByLabel('Contraseña', { exact: true }).fill(FAKE_USER.pass);
    await page.getByRole('checkbox').check();
    const started = page.waitForResponse(res => res.url() === base + '/api/imports/percamb' && res.status() === 201);
    await page.getByRole('button', { name: 'Conectar y buscar estudios' }).click();
    const reply = await (await started).text();
    const { jobId } = JSON.parse(reply);
    const job = manager.get(jobId)!;
    const jobUrl = base + '/api/imports/' + jobId;
    const sse = fetch(jobUrl + '/events', { headers: { Cookie: 'portal_session=' + cookie } }).then(res => res.text());
    assert.equal((await fetch(jobUrl, { headers: { Cookie: 'portal_session=' + other.cookie } })).status, 404);
    await page.waitForSelector('.res-list');
    assert.equal(context.pages().length, 1);
    assert.equal(job.selection.length, 0);
    assert.ok(job.eventsSince(0).some(event => event.type === 'signing_in'));
    assert.ok(job.eventsSince(0).every(event => event.type !== 'human_action_required'));

    mock.failTransfers = true;
    await page.click('.res-list li:first-child .res-row');
    await page.click('#res-save');
    await page.waitForSelector('[data-action=live-storage-retry]');
    const manifest = await readFile(path.join(pending.directory(jobId), 'manifest.json'), 'utf8');
    const snapshot = await (await context.request.get(jobUrl)).text();
    mock.failTransfers = false;
    await page.click('[data-action=live-storage-retry]');
    await page.waitForSelector('.fv-success');
    assert.match(await page.locator('.fv-success').innerText(), /Google Drive/);
    const [artifact] = google.db.list(owner.id);
    assert.ok(artifact);
    const original = mock.files.get(artifact.remoteFileId)!.content!;
    assert.equal(validatePdf(original, 'application/pdf').ok, true);
    assert.equal(google.db.list(other.owner.id).length, 0);
    assert.equal(mock.uploadStarts, 1);
    assert.ok(urls.every(url => !new URL(url).pathname.startsWith('/remote/')));
    await waitFor(() => host.openContexts === 0 && !manager.file(jobId, job.files[0].id));
    assert.ok((await readdir(traceDir)).every(name => !name.endsWith('.zip')));
    const db = await readFile(config.databasePath);
    const persisted = [reply, manifest, snapshot, await sse, JSON.stringify(job.eventsSince(0)), db.toString('utf8'),
      ...logs, ...urls, await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))].join('\n');
    for (const secret of [FAKE_USER.usuario, FAKE_USER.pass, 'qa-deliberately-invalid', 'qa-dialog-private-marker']) {
      assert.equal(persisted.includes(secret), false, 'a credential appeared outside the login');
    }

    provider.loginUrl = loginUrl + '?mode=verify&visible=1';
    await page.locator('.fv-success [data-action=flow-restart]').click();
    await page.locator('[data-action=inst-pick][data-id=pc]').click();
    await page.getByLabel('Usuario o DNI').fill(FAKE_USER.usuario);
    await page.getByLabel('Contraseña', { exact: true }).fill(FAKE_USER.pass);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Conectar y buscar estudios' }).click();
    const fallback = page.getByRole('link', { name: 'Abrir navegador seguro' });
    await fallback.waitFor();
    const [challenged] = manager.activeJobs();
    assert.equal(challenged.human, 'mfa');
    assert.equal(context.pages().length, 1);
    assert.equal(await fallback.getAttribute('href'), base + '/remote/' + challenged.id + '?aux=1');
    const worker = manager.remotePage(challenged.id)!;
    const isolated = worker.context();
    assert.ok((await isolated.cookies()).some(cookie => cookie.name === 'challenge'));
    assert.ok(!(await isolated.cookies()).some(cookie => cookie.name === 'sid'), 'no authenticated cookies from the earlier job');
    await worker.locator('[name=code]').fill('654321');
    await worker.getByRole('button', { name: 'Verificar' }).click();
    await page.waitForSelector('.res-list');
    assert.equal(manager.remotePage(challenged.id), worker);
    assert.equal(worker.context(), isolated);
    assert.equal(await fallback.count(), 0);
    assert.equal((await context.request.post(base + '/api/imports/' + challenged.id + '/desktop', {
      headers: { Origin: base },
    })).status(), 409);
  } finally {
    await browser?.close();
    await desktop.stop();
    await manager.shutdown();
    await host.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fixture.close();
    google.db.close();
  }
});

test('cancelar antes de que el runner consuma las credenciales las revoca', async () => {
  const config = googleTestConfig();
  config.authMode = 'pilot';
  config.storageProvider = 'local';
  let login: OneUseLogin | undefined;
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const manager = new JobManager({
    config, providers: { percamb }, log: createLogger('silent'),
    runnerFactory: () => ({
      start: async value => { login = value; await hold; },
      importSelected: async () => {},
      dispose: async () => {},
    }),
  });
  try {
    const job = manager.create('percamb', 'pilot', 'desktop', { username: 'synthetic-user', password: 'synthetic-secret' });
    assert.ok(login);
    await manager.cancel(job.id);
    assert.equal(login.take(), undefined);
    assert.equal(JSON.stringify(login), '{}');
  } finally { finish(); await manager.shutdown(); }
});
