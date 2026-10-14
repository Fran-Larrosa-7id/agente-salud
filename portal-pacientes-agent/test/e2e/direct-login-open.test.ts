import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { AGENT_ROOT } from '../../src/config.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { createApp } from '../../src/server/app.js';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig, waitFor } from '../helpers.js';
import { testBrowserChannel } from '../browser-channel.js';

test('Abrir institución llega al login en un clic; bloqueo de popup y error de inicio se recuperan', { timeout: 45_000 }, async () => {
  const config = testConfig({ remoteLogin: true, portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory({ loginDelayMs: 15000, stepMs: 30 }) });
  const desktop = new RemoteDesktop();
  const server = createApp({ config, manager, providers: PROVIDERS, desktop, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    for (const institution of ['pc', 'cdm', 'rdc', 'blocked', 'busy']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
      if (institution === 'blocked') await context.addInitScript('window.open = () => null;');
      // Solo se prueba apertura/sincronización; el escritorio real está cubierto por test:remote.
      await context.route('**/api/imports/*/desktop', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA_SYNTHETIC"}' }));
      let starts = 0;
      await context.route('**/api/imports/centrodm', async route => { starts++; await new Promise(resolve => setTimeout(resolve, 200)); await route.continue(); });
      const page = await context.newPage();
      await page.goto(base + '/#/login'); await page.fill('#dni', '32456789'); await page.fill('#pass', 'demo');
      await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
      if (institution === 'busy') manager.create('rdcchacabuco');
      await page.goto(`${base}/#/traer?inst=${['blocked', 'busy'].includes(institution) ? 'cdm' : institution}`);
      const popupEvent = institution === 'blocked' ? null : page.waitForEvent('popup');
      await page.click('[data-action=live-open]');
      if (institution === 'busy') {
        const placeholder = await popupEvent!;
        await page.waitForSelector('text=Ya hay una importación en curso');
        await waitFor(() => placeholder.isClosed());
        assert.equal(context.pages().length, 1); assert.equal(manager.activeCount(), 1);
      } else {
        const target = institution === 'blocked' ? page : await popupEvent!;
        await target.waitForURL(institution === 'blocked' ? /\/remote\/[0-9a-f-]{36}$/ : /\/remote\/[0-9a-f-]{36}\?aux=1$/);
        await target.waitForSelector('#message-panel');
        assert.equal(await target.locator('#resume').count(), 0);
        const job = manager.activeJobs()[0]; assert.ok(job);
        assert.equal(new URL(target.url()).pathname, '/remote/' + job.id);
        if (institution !== 'blocked') {
          assert.equal(await target.evaluate(() => window.opener === null), true);
          assert.equal(await target.evaluate(() => JSON.parse(document.querySelector('#remote-config')!.textContent!).auxiliary), true);
          await page.waitForSelector('text=Volver a abrir el navegador');
          assert.equal(await page.locator('.fv-wait .btn-accent').count(), 0, 'no hay segundo botón principal de abrir');
        }
        if (['blocked', 'cdm'].includes(institution)) assert.equal(starts, 1);
      }
      for (const job of manager.activeJobs()) await manager.cancel(job.id);
      await context.close();
    }
  } finally { await browser.close(); await desktop.stop(); await manager.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('La pestaña auxiliar se cierra al detectar el ingreso y el Portal original continúa una sola importación', { timeout: 20_000 }, async () => {
  const config = testConfig({ remoteLogin: true, portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), loginTimeoutMs: 30_000 });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory({ loginDelayMs: 450, stepMs: 40 }) });
  const desktop = new RemoteDesktop();
  const server = createApp({ config, manager, providers: PROVIDERS, desktop, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
    await context.route('**/api/imports/*/desktop', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA_SYNTHETIC"}' }));
    const page = await context.newPage();
    await page.goto(base + '/#/login'); await page.fill('#dni', '32456789'); await page.fill('#pass', 'demo');
    await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
    await page.goto(base + '/#/traer?inst=cdm');
    const popupEvent = page.waitForEvent('popup');
    await page.click('[data-action=live-open]');
    const auxiliary = await popupEvent;
    await auxiliary.waitForURL(/\/remote\/[0-9a-f-]{36}\?aux=1$/);
    await page.waitForSelector('.fv-lresults', { timeout: 10_000 });
    await waitFor(() => auxiliary.isClosed(), 5_000);
    assert.equal(context.pages().length, 1, 'solo queda abierta la pestaña original del Portal');
    assert.match(page.url(), /#\/traer\?inst=cdm&job=[0-9a-f-]{36}$/);
    assert.equal(manager.activeJobs()[0]?.state, 'WAITING_SELECTION');
  } finally {
    for (const job of manager.activeJobs()) await manager.cancel(job.id);
    await context.close(); await browser.close(); await desktop.stop(); await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
