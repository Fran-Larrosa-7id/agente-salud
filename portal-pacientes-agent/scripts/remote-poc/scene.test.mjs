import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { chromium } from 'playwright';

test('synthetic scene has valid JavaScript', async () => {
  const html = await readFile(new URL('./scene.html', import.meta.url), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script); assert.doesNotThrow(() => new Script(script));
});

test('synthetic scene animates, pauses, accepts text and opens/closes menus and dialog', async t => {
  if (!existsSync(chromium.executablePath())) { t.skip('Bundled Chromium unavailable; run in the PoC Docker image'); return; }
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(await readFile(new URL('./scene.html', import.meta.url), 'utf8'));
    await page.waitForFunction(() => window.synthetic.frames > 2);
    await page.click('#pause'); const frames = await page.evaluate(() => window.synthetic.frames);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.synthetic.frames), frames);
    await page.fill('#text', 'Prueba ñé @123!'); assert.equal(await page.inputValue('#text'), 'Prueba ñé @123!');
    await page.click('#toggle'); assert.equal(await page.locator('#menu').isVisible(), true);
    await page.click('#choose'); assert.equal(await page.locator('#menu').isVisible(), false);
    await page.click('#open'); assert.equal(await page.locator('dialog').isVisible(), true);
    await page.click('#close'); assert.equal(await page.locator('dialog').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
