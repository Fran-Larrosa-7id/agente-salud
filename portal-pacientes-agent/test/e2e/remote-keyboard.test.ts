import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { desktopHtml } from '../../src/server/remote-desktop.js';
import { AGENT_ROOT } from '../../src/config.js';
import { testBrowserChannel } from '../browser-channel.js';
import path from 'node:path';

// Browser input/IME and layout regression. Transport is stubbed; this does NOT
// prove a native Android/iOS keyboard or the real VNC transport (test:remote).
for (const engine of ['chromium', 'webkit'] as const) test(`mobile keyboard: ${engine} input, IME, controls, cleanup and viewport`, async t => {
  const executablePath = process.env.TEST_WEBKIT_EXECUTABLE;
  if (engine === 'webkit' && !existsSync(executablePath || webkit.executablePath())) { t.skip('WebKit executable unavailable'); return; }
  const browser = engine === 'chromium' ? await chromium.launch({ channel: testBrowserChannel }) : await webkit.launch({ ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.route('http://keyboard.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      let body: string;
      if (pathname.endsWith('portal-keyboard.js')) body = readFileSync(path.join(AGENT_ROOT, 'src/server/remote-keyboard.js'), 'utf8');
      else if (pathname.endsWith('keysymdef.js')) body = 'export default { lookup: cp => cp };';
      else if (pathname.endsWith('keysym.js')) body = 'export default { XK_BackSpace: 65288, XK_Tab: 65289, XK_Return: 65293, XK_Escape: 65307 };';
      else if (pathname.endsWith('portal-login.js')) body = `import { mobileKeyboard } from '/remote-assets/portal-keyboard.js';
        window.sent=[];window.current={sendKey:key=>window.sent.push(key),focusOnClick:true};
        const el=id=>document.getElementById(id);el('desktop').hidden=false;el('message-panel').hidden=true;el('keyboard-toggle').hidden=false;
        window.bridge=mobileKeyboard({input:el('keyboard-input'),toggle:el('keyboard-toggle'),tools:el('keyboard-tools'),desktop:el('desktop'),connection:()=>window.current});`;
      else { await route.fulfill({ contentType: 'text/html', body: desktopHtml('synthetic', 'test') }); return; }
      await route.fulfill({ contentType: 'text/javascript', body });
    });
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://keyboard.test/remote/synthetic');
    await page.getByRole('button', { name: 'Abrir teclado', exact: true }).click();
    assert.equal(await page.locator('#keyboard-input').evaluate(el => document.activeElement === el), true);
    await page.keyboard.insertText('Ab9@ñé!');
    assert.deepEqual(await page.evaluate(() => (window as any).sent), Array.from('Ab9@ñé!').map(c => c.codePointAt(0)));
    assert.equal(await page.locator('#keyboard-input').inputValue(), '\u200b');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    assert.deepEqual(await page.evaluate(() => (window as any).sent.slice(-3)), [65288, 65293, 65289]);
    await page.locator('#keyboard-input').evaluate((el: HTMLTextAreaElement) => {
      el.dispatchEvent(new CompositionEvent('compositionstart'));
      el.value = '\u200ba'; el.dispatchEvent(new InputEvent('input', { isComposing: true }));
      el.value = '\u200bá'; el.dispatchEvent(new CompositionEvent('compositionend', { data: 'á' }));
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromComposition', data: 'á' }));
    });
    await page.waitForFunction(() => (window as any).sent.at(-1) === 225);
    assert.equal(await page.evaluate(() => (window as any).sent.filter((key: number) => key === 225).length), 1);
    await page.getByRole('button', { name: 'Borrar', exact: true }).click();
    assert.equal(await page.locator('#keyboard-input').evaluate(el => document.activeElement === el), true);
    await page.locator('#keyboard-input').evaluate((el: HTMLTextAreaElement) => { el.dispatchEvent(new CompositionEvent('compositionstart')); el.value = '\u200bó'; });
    await page.getByRole('button', { name: 'Tab', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).sent.slice(-2)), [243, 65289]);
    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 360 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#keyboard-tools').isVisible(), true);
    }
    await page.locator('#desktop').evaluate(el => { const canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.width = 200; canvas.height = 100; el.appendChild(canvas); });
    await page.locator('#desktop canvas').click();
    assert.equal(await page.locator('#keyboard-input').evaluate(el => document.activeElement === el), true);
    // Disconnect/completion must clear composition and prevent stale credentials being sent after reconnect.
    await page.locator('#keyboard-input').evaluate((el: HTMLTextAreaElement) => { el.dispatchEvent(new CompositionEvent('compositionstart')); el.value = 'synthetic-uncommitted'; (window as any).bridge.close(); (window as any).current = null; });
    assert.equal(await page.locator('#keyboard-input').inputValue(), '');
    assert.equal(await page.locator('#keyboard-tools').isVisible(), false);
    await page.evaluate('window.current = { sendKey: key => window.sent.push(key) };');
    await page.getByRole('button', { name: 'Abrir teclado', exact: true }).click();
    await page.keyboard.insertText('Z'); assert.equal(await page.evaluate(() => (window as any).sent.at(-1)), 90);
    await page.locator('#keyboard-tools').getByRole('button', { name: 'Cerrar teclado', exact: true }).click();
    assert.equal(await page.locator('#keyboard-input').inputValue(), ''); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
