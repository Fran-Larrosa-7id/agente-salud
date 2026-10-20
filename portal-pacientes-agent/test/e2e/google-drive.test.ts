import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chromium, type BrowserContext, type Route } from 'playwright';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { createGoogleServices } from '../../src/server/google-services.js';
import { createApp } from '../../src/server/app.js';
import { testBrowserChannel } from '../browser-channel.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';
import { GoogleDriveStorage } from '../../src/storage/google-drive.js';

test('Google + Drive UI: separate consent, server upload, second browser, A/B/A isolation and legacy preservation', { timeout: 90000 }, async () => {
  const config = googleTestConfig(), mock = new MockGoogle(), google = createGoogleServices(config, mock.fetch)!;
  google.drive = new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {});
  const manager = new JobManager({ config, providers: PROVIDERS, storage: google.drive, runnerFactory: fakeRunnerFactory({ loginDelayMs: 300, stepMs: 40 }), log: silentLogger });
  const server = createApp({ config, google, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  config.publicBaseUrl = base; config.google!.redirectUri = base + '/api/auth/google/callback';
  let browser;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, channel: testBrowserChannel });
    async function patient(account: { sub: string }, width: number) {
      const context: BrowserContext = await browser!.newContext({ viewport: { width, height: 900 } });
      await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
      // Emulate Google's consent response without making the browser visit any external account.
      const authorize = async (route: Route) => {
        const response = await route.fetch({ maxRedirects: 0 }); const url = response.headers().location;
        if (!url?.startsWith('https://accounts.google.com/')) return route.fulfill({ response });
        const code = mock.code(url, account.sub);
        return route.fulfill({ response, status: 303, headers: { ...response.headers(), location: base + '/api/auth/google/callback?' + new URLSearchParams(code) }, body: '' });
      };
      await context.route('**/api/auth/google/start**', authorize);
      await context.route('**/api/drive/connect**', authorize);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#/login'); await page.getByRole('link', { name: 'Continuar con Google', exact: true }).click();
      await page.waitForSelector('.home-head', { timeout: 10000 }); return { context, page };
    }
    const identity = { sub: 'account-A' }; const { page, context } = await patient(identity, 1280);
    assert.equal(await page.locator('#dni').count(), 0);
    await page.evaluate(() => localStorage.setItem('portal_pacientes_v1', JSON.stringify({ version: 2, studies: [{ id: 'unassigned-legacy' }] })));
    await page.goto(base + '/#/perfil'); await page.getByRole('link', { name: 'Conectar mi Google Drive' }).click();
    await page.waitForSelector('text=Conectado');
    const artifactRequests: string[] = [];
    page.on('request', req => { if (/\/api\/imports\/[^/]+\/files\//.test(req.url())) artifactRequests.push(req.url()); });
    mock.failTransfers = true;
    await page.goto(base + '/#/traer?inst=pc'); await page.click('[data-action=live-open]');
    await page.waitForSelector('.res-list'); await page.click('.res-list li:first-child .res-row'); await page.click('#res-save');
    await page.waitForSelector('[data-action=live-storage-retry]');
    assert.ok((await page.textContent('.dl-head'))!.includes('Guardado pendiente'));
    assert.ok(!(await page.textContent('.dl-head'))!.includes('En curso'));
    assert.ok((await page.textContent('[role=status]'))!.includes('0 B'));
    assert.equal(await page.evaluate(() => (window as any).P.db.studies.length), 0);
    await page.reload(); await page.waitForSelector('[data-action=live-storage-retry]');
    assert.ok((await page.textContent('.dl-head'))!.includes('Guardado pendiente'));
    mock.failTransfers = false; await page.click('[data-action=live-storage-retry]');
    await page.waitForSelector('.fv-success', { timeout: 20000 });
    assert.equal(mock.uploadStarts, 1);
    assert.ok((await page.textContent('.fv-success'))!.includes('Google Drive')); assert.equal(artifactRequests.length, 0);
    const saved = await page.evaluate(() => (window as any).P.db.studies[0]);
    assert.equal(saved.file.storageBackend, 'google_drive'); assert.ok(saved.file.catalogId);
    assert.equal(google.drive.list(google.db.upsertUser('account-A', 'a@example.test').id).length, 1);
    const second = await patient({ sub: 'account-A' }, 390);
    assert.equal(await second.page.evaluate(() => (window as any).P.db.studies.length), 1);
    const other = await patient({ sub: 'account-B' }, 390);
    assert.equal(await other.page.evaluate(() => (window as any).P.db.studies.length), 0);
    assert.equal((await second.context.request.get(base + '/api/studies/' + saved.file.catalogId)).status(), 200);
    assert.equal((await other.context.request.get(base + '/api/studies/' + saved.file.catalogId)).status(), 404);
    assert.equal((await other.context.request.delete(base + '/api/studies/' + saved.file.catalogId, { headers: { Origin: base }, data: { confirm: true } })).status(), 404);
    assert.equal((await context.request.delete(base + '/api/studies/' + saved.file.catalogId, { headers: { Origin: base }, data: { confirm: false } })).status(), 400);
    identity.sub = 'account-B'; await page.goto(base + '/api/auth/google/start'); await page.waitForSelector('.home-head');
    assert.equal(await page.evaluate(() => (window as any).P.db.studies.length), 0);
    identity.sub = 'account-A'; await page.goto(base + '/api/auth/google/start'); await page.waitForSelector('.home-head');
    assert.equal(await page.evaluate(() => (window as any).P.db.studies.length), 1);
    assert.ok(await page.evaluate(() => localStorage.getItem('portal_pacientes_v1')!.includes('unassigned-legacy')));
    await second.context.close(); await other.context.close(); await context.close();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await manager.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); google.db.close(); }
});
