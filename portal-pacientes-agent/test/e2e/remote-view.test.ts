import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { desktopHtml } from '../../src/server/remote-desktop.js';
import { AGENT_ROOT } from '../../src/config.js';
import { testBrowserChannel } from '../browser-channel.js';

// Actual client/HTML/CSS, synthetic APIs and RFB. Native OS keyboards need physical acceptance.
for (const engine of ['chromium', 'webkit'] as const) for (const touch of [true, false]) test(`immersive UI ${engine} touch=${touch}: phone, keyboard viewport, landscape, tablet and CSS fullscreen`, async t => {
  const executablePath = process.env.TEST_WEBKIT_EXECUTABLE;
  if (engine === 'webkit' && !existsSync(executablePath || webkit.executablePath())) { t.skip('WebKit unavailable'); return; }
  const browser = engine === 'chromium' ? await chromium.launch({ channel: testBrowserChannel }) : await webkit.launch({ ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch });
    await context.addInitScript(`window.EventSource=class extends EventTarget {constructor(){super();setTimeout(()=>this.onopen?.(),0)} close(){}};`);
    let layout = 'mobile', width = 390, height = 732, cancelled = 0;
    const info = () => ({ layout, width, height, origin: 'https://laboratorio.example', fallback: false });
    await context.route('http://viewer.test/**', async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (route.request().method() === 'DELETE') { cancelled++; await route.fulfill({ json: { cancelled: true } }); return; }
        if (pathname.endsWith('/desktop')) { const body = route.request().postDataJSON(); layout = body.layout; width = layout === 'mobile' ? body.width : 1280; height = layout === 'mobile' ? body.height : 1000; await route.fulfill({ json: { ready: true, display: info() } }); return; }
        await route.fulfill({ json: pathname.endsWith('/display') ? info() : { state: 'WAITING_FOR_USER_LOGIN', lastSeq: 1 } }); return;
      }
      let filename = '';
      if (pathname.endsWith('portal-login.js')) filename = 'remote-client.js';
      if (pathname.endsWith('portal-keyboard.js')) filename = 'remote-keyboard.js';
      if (pathname.endsWith('portal-view.css')) filename = 'remote-view.css';
      if (filename) { await route.fulfill({ contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(path.join(AGENT_ROOT, 'src/server', filename), 'utf8') }); return; }
      if (pathname.endsWith('/rfb.js')) { await route.fulfill({ contentType: 'text/javascript', body: `export default class extends EventTarget {constructor(el){super();this.canvas=document.createElement('canvas');this.canvas.width=390;this.canvas.height=732;this.canvas.style.width='100%';this.canvas.style.height='100%';el.appendChild(this.canvas);setTimeout(()=>this.dispatchEvent(new Event('connect')),0)} disconnect(){this.canvas.remove()} sendKey(){} }` }); return; }
      if (pathname.endsWith('/keysymdef.js')) { await route.fulfill({ contentType: 'text/javascript', body: 'export default {lookup:cp=>cp};' }); return; }
      if (pathname.endsWith('/keysym.js')) { await route.fulfill({ contentType: 'text/javascript', body: 'export default {XK_BackSpace:65288,XK_Tab:65289,XK_Return:65293,XK_Escape:65307};' }); return; }
      await route.fulfill({ contentType: 'text/html', body: desktopHtml('synthetic', 'test', 'Laboratorio de prueba') });
    });
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://viewer.test/remote/synthetic'); await page.waitForSelector('body.immersive.connected');
    assert.equal(await page.locator('#remote-controls>button:visible').count(), 4);
    assert.equal(await page.locator('#remote-more').isVisible(), false);
    if (process.env.QA_SCREENSHOTS && touch) {
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, `toolbar-${engine}.png`) });
      await page.click('#more-controls'); await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, `toolbar-options-${engine}.png`) }); await page.click('#more-controls');
    }
    for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 360 }]) {
      await page.setViewportSize(size);
      await page.waitForFunction(() => Math.abs(document.getElementById('remote-controls')!.getBoundingClientRect().bottom - (visualViewport?.height || innerHeight)) < 2);
      assert.equal(await page.locator('h1').isVisible(), false);
      assert.equal(await page.locator('#external-origin').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const surface = await page.locator('#remote-surface').boundingBox(); assert.ok(surface && surface.height >= 190);
    }
    await page.click('#keyboard-toggle'); assert.equal(await page.locator('#keyboard-input').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#keyboard-toggle svg').count(), 1, 'Keyboard state updates preserve its icon');
    await page.keyboard.insertText('ñ!7'); assert.equal(await page.locator('#keyboard-input').inputValue(), '\u200b');
    await page.click('[data-remote-key=close]');
    await page.evaluate('document.documentElement.requestFullscreen=undefined');
    await page.click('#more-controls'); await page.click('#fullscreen'); assert.equal(await page.locator('#external-origin').isVisible(), true);
    await page.setViewportSize({ width: 820, height: 1180 }); await page.reload(); await page.waitForSelector('body.connected');
    assert.equal(await page.locator('body.immersive').count(), 0, 'tablet retains the conventional layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('body.immersive');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForSelector('body:not(.immersive)');
    await page.evaluate('document.documentElement.requestFullscreen=undefined'); await page.click('#more-controls'); await page.click('#fullscreen');
    assert.equal(await page.locator('body.immersive').count(), 1); assert.equal(await page.locator('#external-origin').isVisible(), true);
    await page.click('#more-controls'); await page.click('#fullscreen'); assert.equal(await page.locator('body.immersive').count(), 0);
    await page.click('#exit-remote'); await page.waitForFunction(() => document.querySelector('#message-title')?.textContent === 'Importación cancelada');
    assert.equal(cancelled, 1); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
