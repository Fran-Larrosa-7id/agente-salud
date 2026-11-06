import assert from 'node:assert/strict';

// Checks actual client canvas against the source's synthetic, settled viewport.
// Does not capture or read any institution, account or patient screen.
export async function functionalChecks({ source, client, sourceContext, framebuffer, geometry, kasm, mobile }) {
  const checks = [];
  await source.evaluate(() => { window.synthetic.animate = false; window.synthetic.scroll = false; scrollTo(0, 0); });
  const selector = `canvas[width="${framebuffer.width}"][height="${framebuffer.height}"]`;
  const surface = client.locator(selector).filter({ visible: true }).first();
  async function settled(label) {
    const png = (await source.screenshot({ type: 'png', animations: 'disabled' })).toString('base64');
    const points = await client.evaluate(async ({ png }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); const points = [];
      for (let y = 40; y < image.height - 8; y += 44) for (let x = 16; x < image.width - 8; x += 44) {
        const p = ctx.getImageData(x, y, 1, 1).data; points.push({ x, y, rgb: Array.from(p).slice(0, 3) });
      } return points;
    }, { png });
    await client.waitForFunction(({ selector, points, geometry }) => {
      const c = Array.from(document.querySelectorAll(selector)).find(c => c.getBoundingClientRect().width > 0);
      const ctx = c?.getContext('2d'); if (!ctx) return false;
      let different = 0;
      for (const p of points) {
        const rgb = ctx.getImageData(geometry.x + p.x, geometry.y + p.y, 1, 1).data;
        if (p.rgb.some((v, i) => Math.abs(v - rgb[i]) > 55)) different++;
      }
      window.__pocPixelMismatch = { different, total: points.length };
      return different <= Math.floor(points.length * .02);
    }, { selector, points, geometry }, { timeout: 15000 });
    checks.push({ label, sampledPixels: points.length, mismatch: await client.evaluate(() => window.__pocPixelMismatch) });
  }
  async function location(selector) {
    const target = await source.locator(selector).boundingBox(), canvas = await surface.boundingBox();
    assert.ok(target && canvas, 'Synthetic element and visible framebuffer must exist');
    return { x: canvas.x + (geometry.x + target.x + target.width / 2) * canvas.width / framebuffer.width,
      y: canvas.y + (geometry.y + target.y + target.height / 2) * canvas.height / framebuffer.height };
  }
  async function click(selector) {
    const point = await location(selector);
    if (mobile) await client.touchscreen.tap(point.x, point.y); else await client.mouse.click(point.x, point.y);
  }
  await settled('initial');
  await source.evaluate(() => { window.addEventListener('pointermove', event => { window.__syntheticPointer = { x: event.clientX, y: event.clientY }; }); });
  const pointerBox = await surface.boundingBox(); assert.ok(pointerBox);
  await client.mouse.move(pointerBox.x + (geometry.x + 80) * pointerBox.width / framebuffer.width,
    pointerBox.y + (geometry.y + 260) * pointerBox.height / framebuffer.height);
  await source.waitForFunction(() => window.__syntheticPointer && Math.abs(window.__syntheticPointer.x - 80) < 3 && Math.abs(window.__syntheticPointer.y - 260) < 3);
  checks.push({ label: 'pointer_coordinates', toleranceCssPixels: 3 });
  // Rapid wheel updates for 30 seconds through the real client input transport.
  const box = await surface.boundingBox(); assert.ok(box);
  await client.mouse.move(box.x + box.width * .7, box.y + box.height * .7);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const phase = Math.floor((Date.now() - started) / 4000);
    await client.mouse.wheel(0, phase % 2 ? -100 : 100); await client.waitForTimeout(50);
  }
  await source.waitForFunction(() => scrollY > 0);
  await client.waitForTimeout(300); await settled('after_30s_scroll');
  await source.evaluate(() => scrollTo(0, 0)); await settled('scroll_restored');
  await click('#text');
  if (mobile) {
    if (kasm) {
      await client.locator('#noVNC_keyboardinput').evaluate(el => el.focus());
      assert.equal(await client.locator('#noVNC_keyboardinput').evaluate(el => document.activeElement === el), true);
    } else await client.evaluate(() => window.__openKeyboard());
  }
  await client.keyboard.insertText('Prueba ñé @123!');
  await source.waitForFunction(() => document.querySelector('#text').value === 'Prueba ñé @123!');
  await settled('text_and_mobile_input');
  // Separate touch gestures so noVNC does not interpret nearby taps as double-taps.
  if (mobile) await client.waitForTimeout(1100);
  await click('#toggle'); await source.waitForSelector('#menu:not([hidden])'); await settled('menu_open');
  if (mobile) await client.waitForTimeout(1100);
  await click('#choose'); await source.waitForSelector('#menu[hidden]', { state: 'attached' }); await settled('menu_restored');
  if (mobile) await client.waitForTimeout(1100);
  await click('#open'); await source.waitForSelector('dialog[open]'); await settled('dialog_overlap');
  if (mobile) await client.waitForTimeout(1100);
  await click('#close'); await source.waitForSelector('dialog:not([open])', { state: 'attached' }); await settled('dialog_restored');
  await source.locator('#partial').evaluate(el => { el.style.background = '#0000ff'; }); await settled('partial_update');
  // A real second Chromium X11 window, not just an HTML dialog.
  const popupPromise = source.waitForEvent('popup');
  await source.evaluate(() => window.open('/scene', 'synthetic-popup', 'width=300,height=240,left=40,top=180'));
  const popup = await popupPromise;
  try {
    await popup.setContent('<style>html,body{margin:0;background:#0000ff;height:100%}</style><p>Synthetic X11 overlap</p>');
    await popup.bringToFront();
    const metrics = await popup.evaluate(() => ({ x: screenX + 40, y: screenY + outerHeight - innerHeight + 60 }));
    assert.ok(metrics.x < framebuffer.width && metrics.y < framebuffer.height);
    await client.waitForFunction(({ selector, metrics }) => {
      const c = Array.from(document.querySelectorAll(selector)).find(c => c.getBoundingClientRect().width > 0);
      const p = c?.getContext('2d')?.getImageData(metrics.x, metrics.y, 1, 1).data;
      return p && p[2] > 180 && p[0] < 60 && p[1] < 60;
    }, { selector, metrics }, { timeout: 15000 });
    checks.push({ label: 'native_window_overlap', verifiedBluePixel: metrics });
  } finally { await popup.close(); }
  await source.bringToFront(); await settled('native_window_restored');
  const text = await source.locator('#text').inputValue();
  await client.reload(); await client.waitForSelector(selector); await settled('reconnected');
  assert.equal(await source.locator('#text').inputValue(), text);
  assert.equal(source.context(), sourceContext);
  return { checks, limitations: ['Synthetic wheel scroll, not physical touch inertia.', 'Pixel grid and thresholds can miss small artifacts.', 'Native phone keyboards/Safari and the production authentication adapter remain untested.'] };
}
