import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configurePageDisplay } from '../../src/browser/display-profile.js';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { AGENT_ROOT } from '../../src/config.js';
import { RulesModel } from '../../src/llm/rules.js';
import { createApp } from '../../src/server/app.js';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { silentLogger } from '../../src/security/logger.js';
import { startFakePortal, FAKE_USER } from '../fixtures/fake-portal.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';

test('immersive Linux: real cropped framebuffer, touch coordinates, zoom, rotate, keyboard, fallback and authenticated continuity', {
  timeout: 90000, skip: process.env.TEST_REMOTE_DESKTOP !== 'true',
}, async () => {
  const portal = await startFakePortal();
  const config = testConfig({ remoteLogin: true, headless: false, portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes'), loginTimeoutMs: 75000 });
  const host = new BrowserHost({ headless: false, debugArtifacts: false, debugDir: '' }), desktop = new RemoteDesktop();
  let runner!: AgentImportRunner;
  const providers = { percamb: { ...testProvider(portal.url + '/lwcloud/fake/login'), id: 'percamb' } };
  const manager = new JobManager({ config, providers, log: silentLogger, runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 100 })) });
  const server = createApp({ config, manager, providers, desktop, info: { runner: 'agent', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  desktop.attach(server, manager); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const client = await context.newPage(); const errors: string[] = []; client.on('pageerror', error => errors.push(error.message));
    await client.route('**/remote-assets/portal-login.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('rfb = current;', 'window.__qaRfb = current; rfb = current;') });
    });
    const job = manager.create('percamb', 'pilot', 'mobile');
    await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN, 15000);
    const worker = runner.session!.activePage(), originalContext = worker.context();
    assert.equal(await worker.evaluate(() => innerWidth), 390, 'Institution login is responsive before opening the VNC viewer');
    await worker.evaluate(`document.addEventListener('pointerdown',e=>{window.__qaPointer={x:e.clientX,y:e.clientY,count:(window.__qaPointer?.count||0)+1}})`);
    await client.goto(`${base}/remote/${job.id}`);
    await client.waitForSelector('body.immersive.connected');
    await client.waitForFunction(() => (document.querySelector('#desktop canvas') as HTMLCanvasElement)?.width === 390);
    assert.equal(await worker.evaluate(() => innerWidth), 390);
    assert.equal(await worker.evaluate(() => navigator.maxTouchPoints > 0), true);
    assert.equal(await worker.evaluate(() => /Mobile/.test(navigator.userAgent)), false);
    assert.equal(await client.locator('#external-origin').innerText(), portal.url);
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await client.evaluate('window.__qaRfb._supportsSetDesktopSize'), true, 'This x11vnc advertises ExtendedDesktopSize; renderer sizing remains server-coordinated');
    // Real finger swipe must scroll the remote page, not select/drag its content.
    await worker.evaluate(() => {
      const spacer = document.createElement('div'); spacer.id = 'qa-scroll'; spacer.style.height = '1800px'; document.body.appendChild(spacer);
    });
    await client.waitForSelector('body:not(.display-changing)');
    const touch = await context.newCDPSession(client);
    const surface = await client.locator('#desktop canvas').boundingBox(); assert.ok(surface);
    const x = surface.x + surface.width / 2, y = surface.y + Math.min(surface.height - 40, 420);
    const pointerBeforeSwipe = await worker.evaluate(() => (window as any).__qaPointer?.count || 0);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 30 }] });
      await client.waitForTimeout(30);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await worker.waitForFunction(() => scrollY > 0);
    assert.equal(await worker.evaluate(() => (window as any).__qaPointer?.count || 0), pointerBeforeSwipe, 'Swipe must not press/drag the remote mouse');
    await worker.evaluate(() => { document.getElementById('qa-scroll')!.remove(); scrollTo(0, 0); });
    // Keep the CDP input session alive until context teardown: detaching resets
    // Chromium's touch emulation and would turn this synthetic phone into a mouse.
    if (process.env.QA_SCREENSHOTS) await client.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, 'immersive-synthetic-blank.png') });
    let lastTap = 0;
    async function touchField(selector: string) {
      // Two nearby taps inside noVNC's 1 s window are one double-tap gesture,
      // anchored at the first tap. Test distinct single taps, not that gesture.
      const remaining = 1100 - (Date.now() - lastTap); if (remaining > 0) await client.waitForTimeout(remaining);
      await client.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await client.waitForSelector('body:not(.display-changing)');
      const field = await worker.locator(selector).boundingBox(); assert.ok(field);
      const canvas = client.locator('#desktop canvas'); const box = await canvas.boundingBox(); assert.ok(box);
      const size = await canvas.evaluate(el => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
      const previous = await worker.evaluate(() => (window as any).__qaPointer?.count || 0);
      await client.touchscreen.tap(box.x + (field.x + field.width / 2) * box.width / size.w, box.y + (field.y + field.height / 2) * box.height / size.h);
      lastTap = Date.now();
      await worker.waitForFunction(count => ((window as any).__qaPointer?.count || 0) > count, previous);
      const pointer = await worker.evaluate<{ x: number; y: number }>('window.__qaPointer');
      const geometry = await client.evaluate(() => ({ scale: (window as any).__qaRfb._display.scale, box: document.querySelector('#desktop canvas')?.getBoundingClientRect().toJSON(), scroll: [document.getElementById('remote-surface')!.scrollLeft, document.getElementById('remote-surface')!.scrollTop] }));
      assert.ok(Math.abs(pointer.x - (field.x + field.width / 2)) <= 1.5 && Math.abs(pointer.y - (field.y + field.height / 2)) <= 1.5,
        `Coordinate mismatch: pointer=${JSON.stringify(pointer)} expected=${JSON.stringify({ x: field.x + field.width / 2, y: field.y + field.height / 2 })} geometry=${JSON.stringify(geometry)}`);
    }
    // Fictitious human challenge controls remain on the institution's remote page.
    await worker.evaluate(() => {
      const challenge = document.createElement('div'); challenge.id = 'qa-human';
      challenge.innerHTML = '<label>Código de prueba <input id="qa-otp" autocomplete="one-time-code"></label><label>Verificación de prueba <input id="qa-captcha" type="checkbox"></label>';
      document.body.appendChild(challenge);
    });
    await touchField('#qa-otp'); await client.click('#keyboard-toggle'); await client.keyboard.insertText('123456');
    await worker.waitForFunction(() => (document.querySelector('#qa-otp') as HTMLInputElement).value.length === 6);
    await client.click('[data-remote-key=close]'); await touchField('#qa-captcha');
    assert.equal(await worker.locator('#qa-captcha').isChecked(), true);
    assert.equal(job.state, S.WAITING_FOR_USER_LOGIN);
    await worker.locator('#qa-human').evaluate(el => el.remove());
    await touchField('input[name=usuario]'); await client.click('#keyboard-toggle');
    await client.keyboard.insertText('ñ@7');
    await worker.waitForFunction(() => (document.querySelector('input[name=usuario]') as HTMLInputElement).value === 'ñ@7');
    await client.click('[data-remote-key=close]');
    await client.click('#more-controls'); await client.click('#zoom-in'); await client.click('#more-controls');
    await client.waitForFunction(() => (window as any).__qaRfb._display.scale > 1.1);
    await client.locator('#remote-surface').evaluate(el => { el.scrollLeft = 32; });
    await touchField('input[name=pass]'); await client.click('#keyboard-toggle'); await client.keyboard.insertText('A!é');
    await worker.waitForFunction(() => (document.querySelector('input[name=pass]') as HTMLInputElement).value === 'A!é');
    await client.click('[data-remote-key=close]'); await client.click('#more-controls'); await client.click('#zoom-fit'); await client.click('#more-controls');
    await client.click('#more-controls'); await client.click('#display-layout');
    await client.waitForFunction(() => (document.querySelector('#desktop canvas') as HTMLCanvasElement)?.width === 1280);
    assert.equal(await worker.locator('input[name=usuario]').inputValue(), 'ñ@7'); assert.equal(worker.context(), originalContext);
    await client.click('#more-controls'); await client.click('#display-layout');
    await client.waitForFunction(() => (document.querySelector('#desktop canvas') as HTMLCanvasElement)?.width === 390);
    await client.setViewportSize({ width: 844, height: 390 });
    await client.waitForFunction(() => (document.querySelector('#desktop canvas') as HTMLCanvasElement)?.width === 844);
    await touchField('input[name=usuario]');
    await client.setViewportSize({ width: 390, height: 844 });
    await client.waitForFunction(() => (document.querySelector('#desktop canvas') as HTMLCanvasElement)?.width === 390);
    assert.equal(worker.context(), originalContext); assert.equal(host.openContexts, 1);
    // A new viewer reconnects to the same remote page and retains unsent form state.
    await client.reload(); await client.waitForSelector('body.immersive.connected');
    assert.equal(await worker.locator('input[name=usuario]').inputValue(), 'ñ@7');
    await worker.locator('input[name=usuario]').fill(''); await worker.locator('input[name=pass]').fill('');
    await touchField('input[name=usuario]'); await client.click('#keyboard-toggle'); await client.keyboard.insertText(FAKE_USER.usuario);
    await client.click('[data-remote-key=tab]'); await client.keyboard.insertText(FAKE_USER.pass); await client.click('[data-remote-key=enter]');
    await waitFor(() => job.state === S.WAITING_SELECTION, 15000);
    assert.equal(worker.context(), originalContext); assert.deepEqual(worker.viewportSize(), { width: 1180, height: 820 });
    assert.ok(job.studies.length); assert.deepEqual(errors, []);
    // Probe the server's advertised resize capability in a separate, blank session.
    await manager.cancel(job.id); await waitFor(() => host.openContexts === 0);
    const probe = manager.create('percamb', 'pilot', 'mobile');
    await waitFor(() => probe.state === S.WAITING_FOR_USER_LOGIN, 15000);
    await client.goto(`${base}/remote/${probe.id}`); await client.waitForSelector('body.immersive.connected');
    await client.waitForFunction(() => (window as any).__qaRfb._supportsSetDesktopSize);
    await client.evaluate(`(() => {
      const rfb=window.__qaRfb, previous=rfb._handleExtendedDesktopSize.bind(rfb);
      rfb._handleExtendedDesktopSize=()=>{ const reason=rfb._FBU.x,status=rfb._FBU.y;const done=previous();if(done&&reason===1)window.__resizeResult={reason,status};return done; };
      rfb.resizeSession=true;document.getElementById('desktop').style.width='360px';document.getElementById('desktop').style.height='400px';
    })()`);
    await client.waitForFunction(() => (window as any).__resizeResult, undefined, { timeout: 8000 });
    const resizeResult = await client.evaluate<{ reason: number; status: number }>('window.__resizeResult');
    console.log('Synthetic ExtendedDesktopSize result', resizeResult);
    assert.equal(resizeResult.status, 1, 'Advertised resize is administratively prohibited by this server');
    assert.equal(runner.session!.activePage().viewportSize()!.width, 390, 'VNC resize never configures Playwright viewport');
  } finally {
    await desktop.stop(); await manager.shutdown(); await host.close(); await browser.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); await portal.close();
  }
});

test('Linux native geometry includes full-page and offset iframe login surfaces', { timeout: 20000, skip: process.env.TEST_REMOTE_DESKTOP !== 'true' }, async () => {
  const host = new BrowserHost({ headless: false, debugArtifacts: false, debugDir: '' });
  try {
    const context = await host.newContext('responsive'), page = await context.newPage();
    for (const [left, top, border] of [[0, 0, 0], [7, 11, 3]]) {
      await page.setContent(`<style>body{margin:0}iframe{position:fixed;left:${left}px;top:${top}px;width:100%;height:100%;border:${border}px solid black}</style><iframe srcdoc="<style>body{margin:0}</style><button>Prueba geométrica</button>"></iframe>`);
      const frame = page.frames().find(frame => frame !== page.mainFrame())!;
      await frame.waitForSelector('button');
      const geometry = await configurePageDisplay(page, 'mobile', 390, 732);
      assert.equal(geometry.width, 390); assert.equal(await frame.evaluate(() => innerWidth), 390);
      const pointer = await frame.evaluateHandle(() => ({ result: new Promise<{ x: number; y: number }>(resolve => window.addEventListener('pointermove', e => resolve({ x: e.clientX, y: e.clientY }), { once: true })) }));
      const x = geometry.x + left + border + 90, y = geometry.y + top + border + 90;
      await promisify(execFile)('xdotool', ['mousemove', String(x + 1), String(y + 1), 'mousemove', '--sync', String(x), String(y)]);
      const received = await pointer.evaluate(value => value.result); await pointer.dispose();
      assert.ok(Math.abs(received.x - 90) <= 1 && Math.abs(received.y - 90) <= 1);
    }
  } finally { await host.close(); }
});
