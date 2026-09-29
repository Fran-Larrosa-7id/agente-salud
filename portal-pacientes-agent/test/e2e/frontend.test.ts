import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { AGENT_ROOT } from '../../src/config.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { createApp } from '../../src/server/app.js';
import { testBrowserChannel } from '../browser-channel.js';
import { testConfig } from '../helpers.js';

/**
 * E2E del frontend (Portal de Pacientes) con el FakeProviderAgent: recorre el flujo de Pérez Cambet
 * de punta a punta sin laboratorio, sin IA y sin navegador del agente.
 */
test('Portal: Traer mis estudios desde Pérez Cambet con el asistente (simulado)', { timeout: 90_000 }, async () => {
  const cfg = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config: cfg, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ loginDelayMs: 900, stepMs: 120 }), log: silentLogger });
  const app = createApp({ config: cfg, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'fake', modelReady: true } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  const errors: string[] = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${viewport.width}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${viewport.width}: ${e.message}`));
      await page.addInitScript(`try { localStorage.setItem('pp_agent_url', ${JSON.stringify(base)}); } catch (e) {}`);

      await page.goto(base + '/index.html#/login');
      await page.fill('#dni', '32456789');
      await page.fill('#pass', 'demo1234');
      await page.click('#login-form [type=submit]');
      await page.waitForSelector('.home-head');

      await page.goto(base + '/index.html#/traer');
      await page.click('.inst-row[data-id=pc]');
      await page.waitForSelector('text=Vamos a abrir Pérez Cambet');
      await page.click('[data-action=live-open]');
      await page.waitForSelector('.fv-wait');
      await page.waitForSelector('text=Esperando tu inicio de sesión');
      assert.equal(await page.locator('input[type=password]').count(), 0, 'el Portal nunca pide la contraseña del laboratorio');

      await page.waitForSelector('.res-list', { timeout: 20_000 });
      assert.equal(await page.locator('.res-list li').count(), 2);
      assert.ok(await page.isDisabled('#res-save'));
      await page.click('.res-list li:first-child .res-row');
      assert.equal((await page.textContent('#res-save'))?.trim(), 'Traer seleccionado');
      await page.click('#res-save');
      await page.waitForSelector('.fv-download');
      await page.waitForSelector('.fv-success', { timeout: 20_000 });
      assert.equal(await page.locator('.success-list li').count(), 1);

      await page.click('[data-action=see-imported]');
      await page.waitForSelector('.notice');
      await page.goto(base + '/index.html#/estudios/pc-00012345');
      await page.click('.doc-card .btn-row [data-action=doc-view]');
      await page.waitForSelector('iframe.pdf-frame');
      await page.keyboard.press('Escape');

      // Cancelar a mitad de camino cierra el job del lado del agente.
      await page.goto(base + '/index.html#/traer?inst=pc');
      await page.click('[data-action=live-open]');
      await page.waitForSelector('.fv-wait');
      await page.click('.flow-exit');
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/imports/')),
        page.click('.ov [data-confirm]'),
      ]);
      await page.waitForFunction(() => !location.hash.startsWith('#/traer'));
      await ctx.close();
    }
    assert.equal(manager.activeCount(), 0, 'no quedan importaciones abiertas');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
    await manager.shutdown();
  }
});

test('Portal: parser mismatch deja de cargar y reintenta en la misma importación', { timeout: 45_000 }, async () => {
  const cfg = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config: cfg, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ scenario: 'parser_mismatch', loginDelayMs: 10, stepMs: 10 }), log: silentLogger });
  const app = createApp({ config: cfg, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'fake', modelReady: true } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(`try { localStorage.setItem('pp_agent_url', ${JSON.stringify(base)}); } catch (e) {}`);
    await page.goto(base + '/index.html#/login');
    await page.fill('#dni', '32456789');
    await page.fill('#pass', 'demo1234');
    await page.click('#login-form [type=submit]');
    await page.waitForSelector('.home-head');
    await page.goto(base + '/index.html#/traer?inst=pc');
    const startResponse = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/imports\/[^/]+$/.test(r.url()));
    await page.click('[data-action=live-open]');
    const { jobId } = await (await startResponse).json() as { jobId: string };
    await page.waitForSelector('.fv-lparser');
    const mismatchText = await page.locator('.fv-lparser').innerText();
    assert.ok(mismatchText.includes('La sesión del laboratorio sigue abierta'), mismatchText);
    assert.equal(await page.locator('[data-action=live-retry]').count(), 1);
    const retryResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/retry-discovery'));
    await page.click('[data-action=live-retry]');
    const retried = await retryResponse;
    assert.equal(retried.status(), 202);
    const retryBody = await retried.json() as { state: string };
    assert.equal(retryBody.state, 'WAITING_SELECTION');
    await page.waitForSelector('.fv-lresults', { timeout: 5_000 });
    const resultsText = await page.locator('.fv-lresults').innerText();
    const flowDebug = await page.evaluate(() => ({ step: (window as any).P.flow.step, found: (window as any).P.flow.found, studies: (window as any).P.flow.live?.studies, closed: (window as any).P.flow.live?.closed }));
    assert.ok(resultsText.includes('Encontramos'), JSON.stringify({ resultsText, flowDebug }));
    await page.waitForSelector('.res-list', { timeout: 5_000 });
    assert.equal(await page.locator('.res-list li').count(), 2);
    await page.request.delete(`${base}/api/imports/${jobId}`);
    assert.equal(manager.activeCount(), 0);
  } finally {
    await browser.close();
    server.close();
    await manager.shutdown();
  }
});
