import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { AGENT_ROOT } from '../../src/config.js';
import { RulesModel } from '../../src/llm/rules.js';
import { createApp } from '../../src/server/app.js';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { silentLogger } from '../../src/security/logger.js';
import { startFakePortal, FAKE_USER } from '../fixtures/fake-portal.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';
import { testBrowserChannel } from '../browser-channel.js';

// Esta prueba requiere los paquetes de la imagen y DISPLAY: npm run test:remote.
test('noVNC detecta login automáticamente, conserva contexto y muestra selección en ambas pestañas', {
  timeout: 60_000, skip: process.env.TEST_REMOTE_DESKTOP !== 'true',
}, async () => {
  const portal = await startFakePortal();
  const config = testConfig({ remoteLogin: true, headless: false, portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), portalAuth: { username: '1234', password: '1234' }, loginTimeoutMs: 30_000 });
  const host = new BrowserHost({ headless: false, debugArtifacts: false, debugDir: '' });
  const desktop = new RemoteDesktop();
  let runner!: AgentImportRunner;
  const providers = { percamb: { ...testProvider(portal.url + '/lwcloud/fake/login'), id: 'percamb' } };
  const manager = new JobManager({ config, providers, log: silentLogger,
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 100 })),
  });
  const server = createApp({ config, manager, providers, desktop, info: { runner: 'agent', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  desktop.attach(server, manager);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    await context.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
    const client = await context.newPage();
    await client.goto(base + '/#/login'); await client.fill('#dni', '1234'); await client.fill('#pass', '1234');
    await client.click('#login-form [type=submit]'); await client.waitForSelector('.home-head');
    const primary = await client.context().newPage();
    let resumeRequests = 0;
    client.context().on('request', req => { if (req.url().endsWith('/resume')) resumeRequests++; });
    await client.addInitScript("window.__desktopPolicyErrors=[];document.addEventListener('securitypolicyviolation',e=>window.__desktopPolicyErrors.push(e.violatedDirective));");
    const job = manager.create('percamb');
    let eventConnections = 0;
    await primary.route('**/api/imports/*/events', async route => {
      eventConnections++;
      // Cortar el primer SSE y duplicar el evento rápido al reconectar.
      if (eventConnections === 1 || job.state === S.WAITING_SELECTION) {
        const snapshot = job.snapshot();
        const duplicate = job.state === S.WAITING_SELECTION ? `id: ${snapshot.lastSeq}\nevent: waiting_selection\ndata: ${JSON.stringify(snapshot)}\n\n`.repeat(2) : '';
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `retry: 100\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n${duplicate}` });
      } else await route.continue();
    });
    await primary.goto(`${base}/#/traer?inst=pc&job=${job.id}`);
    try { await primary.waitForSelector('.fv-wait', { timeout: 5000 }); }
    catch (error) { console.log('QA sintético', await primary.locator('main').innerText(), job.state, eventConnections); throw error; }
    const firstOpen = await client.request.get(`${base}/remote/${job.id}`);
    assert.equal(firstOpen.status(), 200);
    assert.match(firstOpen.headers()['content-type'], /text\/html/);
    assert.match(await firstOpen.text(), /Preparando/);
    await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 15_000);
    const worker = runner.session!.activePage();
    // Fondo del sitio ficticio para forzar tiles de imagen y verificar imagen visible, no solo input VNC.
    await worker.evaluate(() => {
      document.body.style.minHeight = '95vh';
      document.body.style.background = 'linear-gradient(135deg, #ff3355, #3388ff, #22cc88)';
    });
    const originalContext = worker.context();
    await client.goto(`${base}/remote/${job.id}`);
    await client.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Ingresá'), undefined, { timeout: 15_000 });
    const canvas = client.locator('#desktop canvas');
    await client.waitForFunction(() => {
      const canvas = document.querySelector('#desktop canvas') as HTMLCanvasElement | null;
      if (!canvas?.width || !canvas.height) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 1024) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      return colors.size > 20;
    }, undefined, { timeout: 5_000 });
    assert.deepEqual(await client.evaluate<string[]>('window.__desktopPolicyErrors'), []);
    if (process.env.QA_SCREENSHOTS) await client.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, 'remote-desktop.png'), fullPage: true });
    await client.setViewportSize({ width: 390, height: 844 });
    assert.ok(await client.locator('#desktop canvas').isVisible());
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.QA_SCREENSHOTS) await client.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, 'remote-mobile.png'), fullPage: true });
    await client.click('#fullscreen');
    await client.waitForFunction(() => !!document.fullscreenElement);
    await client.waitForFunction(() => (document.querySelector('#desktop canvas')?.getBoundingClientRect().width || 0) >= 1000);
    await client.evaluate(() => document.exitFullscreen());
    await client.setViewportSize({ width: 1400, height: 1100 });
    assert.equal(await client.locator('#resume').count(), 0);
    const cookie = (await client.context().cookies()).find(item => item.name === 'portal_remote')!;
    assert.equal(cookie.httpOnly, true);
    async function upgradeStatus(path: string, origin: string, token?: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const probe = request(base + path, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', Origin: origin, ...(token ? { Cookie: `portal_remote=${token}` } : {}) } });
        probe.on('response', response => { response.resume(); resolve(response.statusCode!); });
        probe.on('upgrade', (_response, socket) => { socket.destroy(); resolve(101); });
        probe.on('error', reject); probe.end();
      });
    }
    assert.equal(await upgradeStatus(`/remote/${job.id}/socket`, base), 403);
    assert.equal(await upgradeStatus(`/remote/${job.id}/socket`, 'https://other.example', cookie.value), 403);
    async function clickRemote(selector: string) {
      const element = await worker.locator(selector).boundingBox();
      assert.ok(element);
      const chrome = await worker.evaluate(() => ({ x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight }));
      const size = await canvas.evaluate(el => ({ width: (el as HTMLCanvasElement).width, height: (el as HTMLCanvasElement).height }));
      const box = await canvas.boundingBox();
      assert.ok(box);
      await canvas.click({ position: { x: (chrome.x + element.x + element.width / 2) * box.width / size.width, y: (chrome.y + element.y + element.height / 2) * box.height / size.height } });
    }
    await clickRemote('input[name=usuario]');
    await client.keyboard.type(FAKE_USER.usuario);
    await clickRemote('input[name=pass]');
    await client.keyboard.type(FAKE_USER.pass);
    await clickRemote('button[type=submit]');
    await worker.waitForURL(/resultados/);
    assert.equal(worker.context(), originalContext);
    await waitFor(() => job.state === S.WAITING_SELECTION, 15_000);
    assert.equal(job.eventsSince(0).filter(event => event.state === S.AUTHENTICATED).length, 1);
    assert.equal(resumeRequests, 0, 'no se llama al endpoint de confirmación');
    assert.equal(worker.context(), originalContext); assert.equal(host.openContexts, 1);
    assert.ok((await originalContext.cookies()).some(cookie => cookie.name === 'sid' && cookie.value === 'ok'));
    assert.equal(await upgradeStatus(`/remote/${job.id}/socket`, base, cookie.value), 403);
    assert.ok(job.studies.length);
    assert.equal((await client.request.post(`${base}/api/imports/${job.id}/desktop`)).status(), 409);
    await client.waitForSelector('.res-list'); await primary.waitForSelector('.res-list');
    assert.ok(eventConnections >= 2, 'la principal recupera el estado tras cortar SSE');
    assert.equal(await client.locator('#desktop').count(), 0);
    assert.equal(await client.locator('.res-list li').count(), 3);
    assert.equal(await client.locator('.res-list input:checked').count(), 0);
    assert.equal(await client.locator('#res-save').isDisabled(), true);
    if (process.env.QA_SCREENSHOTS) await client.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, 'remote-automatic-selection.png'), fullPage: true });
    await manager.cancel(job.id);
    await waitFor(() => host.openContexts === 0);
    const second = manager.create('percamb');
    await waitFor(() => second.state === S.WAITING_FOR_USER_LOGIN, 15_000);
    await client.goto(`${base}/remote/${second.id}`);
    await client.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Ingresá'));
    await client.click('#cancel');
    await waitFor(() => second.state === S.CANCELLED);
    assert.equal((await client.request.post(`${base}/api/imports/${second.id}/desktop`)).status(), 409);
  } finally {
    await desktop.stop(); await manager.shutdown(); await host.close(); await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve())); await portal.close();
  }
});

test('primera apertura preparada; 409 acotado, 503 recuperable y 401/403 sin ciclos', {
  timeout: 40_000, skip: process.env.TEST_REMOTE_DESKTOP !== 'true',
}, async () => {
  const config = testConfig({ remoteLogin: true, portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), loginTimeoutMs: 60_000 });
  const providers = { fake: testProvider() };
  const manager = new JobManager({ config, providers, log: silentLogger, runnerFactory: fakeRunnerFactory({ stepMs: 800, loginDelayMs: 60_000 }) });
  const desktop = new RemoteDesktop();
  const server = createApp({ config, manager, providers, desktop, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const job = manager.create('fake');
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let count = 0, status = 409;
    await page.route('**/api/imports/*/desktop', route => { count++; return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'QA_SYNTHETIC' }) }); });
    await page.goto(`${base}/remote/${job.id}`);
    await page.waitForSelector('#message-panel:visible');
    assert.match(await page.locator('main').innerText(), /Preparando/);
    await waitFor(() => count === 4, 10_000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(count, 4, '409 no reintenta indefinidamente');
    assert.equal(await page.locator('#desktop').isVisible(), false);
    for (const value of [503, 401, 403]) {
      status = value; count = 0;
      await page.goto(`${base}/remote/${job.id}`);
      const expected = value === 503 ? 'No pudimos preparar' : value === 401 ? 'necesita renovarse' : 'autorizar';
      await page.waitForFunction(text => document.querySelector('#message-title')?.textContent?.includes(text), expected);
      await new Promise(resolve => setTimeout(resolve, 700));
      assert.equal(count, 1);
      assert.equal(await page.locator('#retry').isVisible(), value === 503);
      assert.equal(await page.locator('#cancel').isVisible(), true);
    }
    const missing = await page.request.get(`${base}/remote/00000000-0000-4000-8000-000000000000`);
    assert.equal(missing.status(), 404); assert.match(missing.headers()['content-type'], /text\/html/);
    await manager.cancel(job.id);
  } finally { await browser.close(); await manager.shutdown(); await desktop.stop(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
