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
import { silentLogger } from '../../src/security/logger.js';
import { testConfig } from '../helpers.js';
import { testBrowserChannel } from '../browser-channel.js';

test('API, SSE y archivos usan el origen actual aunque exista pp_agent_url antiguo', { timeout: 45_000 }, async () => {
  const config = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), portalAuth: { username: '1234', password: '1234' } });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory({ loginDelayMs: 20, stepMs: 20 }) });
  const server = createApp({ config, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  assert.notEqual(address.port, 8787, 'el test corre en un puerto distinto al default histórico');
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.addInitScript(() => localStorage.setItem('pp_agent_url', 'http://127.0.0.1:1'));
    await page.goto(base + '/#/login');
    await page.click('#login-form [type=submit]');
    await page.waitForSelector('.home-head');
    assert.equal(await page.evaluate(() => localStorage.getItem('pp_agent_url')), null, 'se limpia solo la clave obsoleta');

    await page.goto(base + '/#/traer?inst=cdm');
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/imports/centrodm'));
    await page.click('[data-action=live-open]');
    assert.equal((await created).status(), 201);
    await page.waitForSelector('.res-list', { timeout: 15_000 });
    await page.locator('.res-list li:first-child .res-row').click();
    await page.click('#res-save');
    await page.waitForSelector('.fv-success', { timeout: 20_000 });

    const apiRequests = requests.map(raw => new URL(raw)).filter(url => url.pathname.startsWith('/api/'));
    assert.ok(apiRequests.some(url => url.pathname.endsWith('/events')), 'recibe eventos SSE');
    assert.ok(apiRequests.some(url => /\/files\/[^/]+$/.test(url.pathname)), 'descarga el archivo original');
    assert.ok(apiRequests.some(url => url.pathname.endsWith('/ack')), 'confirma que el archivo quedó guardado');
    assert.ok(apiRequests.every(url => url.origin === base), `todas las solicitudes quedan en ${base}`);
  } finally {
    await browser.close();
    await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('si falla la conexión al backend, no acepta la sesión local y ofrece reintentar', { timeout: 30_000 }, async () => {
  const config = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), portalAuth: { username: '1234', password: '1234' } });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory() });
  const server = createApp({ config, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('portal_pacientes_v1', JSON.stringify({ version: 2, session: { since: 'sesión local vieja' }, studies: [{ id: 'estudio-importado-conservado' }] }));
      localStorage.setItem('pp_agent_url', 'http://127.0.0.1:1');
    });
    let offline = true;
    await page.route('**/api/auth/**', route => offline ? route.abort('failed') : route.continue());
    await page.goto(base + '/#/inicio');
    await page.waitForSelector('[data-action=retry-auth]');
    assert.equal(await page.locator('#login-form').count(), 0, 'sin conocer el modo del servidor no presenta credenciales piloto');
    await page.getByRole('alert').filter({ hasText: 'No pudimos conectar con el Portal' }).waitFor();
    assert.equal(await page.locator('.home-head').count(), 0, 'no entra con la sesión guardada localmente');
    const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('portal_pacientes_v1') || '{}'));
    assert.equal(await page.evaluate(() => (window as any).P.db.session), null);
    assert.equal(cleared.studies[0].id, 'estudio-importado-conservado', 'conserva los estudios importados');

    await page.click('[data-action=retry-auth]');
    await page.getByRole('alert').filter({ hasText: 'No pudimos conectar con el Portal' }).waitFor();
    assert.equal(await page.locator('.home-head').count(), 0, 'un fallo del login tampoco habilita modo demo');

    offline = false;
    await page.getByRole('button', { name: 'Reintentar conexión' }).click();
    await page.waitForFunction(() => !(window as any).P.portalAuthUnavailable);
    await page.fill('#pass', 'incorrecta');
    await page.click('#login-form [type=submit]');
    await page.getByRole('alert').filter({ hasText: 'Usuario o contraseña incorrectos' }).waitFor();
    assert.equal(await page.locator('.home-head').count(), 0);
  } finally {
    await browser.close();
    await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
