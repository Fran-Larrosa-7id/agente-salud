// Synthetic geometry only: never navigates an institution or records page content.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, chromiumSandbox: true });
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await context.newPage(); await page.setContent('<meta name="viewport" content="width=device-width"><input aria-label="Synthetic">');
  const cdp = await context.newCDPSession(page);
  for (const size of [{ width: 1180, height: 820 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await page.bringToFront();
    const pointer = await page.evaluateHandle(() => ({ result: new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 800);
      window.addEventListener('pointermove', e => { clearTimeout(timer); resolve({ screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY, windowX: screenX, windowY: screenY }); }, { once: true });
    }) }));
    await page.mouse.move(2, 2); console.log('pointer geometry', await pointer.evaluate(value => value.result)); await pointer.dispose();
    console.log(JSON.stringify({ requested: size, metrics: await page.evaluate(() => ({ x: screenX, y: screenY, outerWidth, outerHeight, innerWidth, innerHeight, dpr: devicePixelRatio, screenWidth: screen.width, screenHeight: screen.height })), window: await cdp.send('Browser.getWindowForTarget') }));
  }
} finally { await browser.close(); }
