import { devices, type BrowserContextOptions, type Page } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export const DESKTOP_VIEWPORT = { width: 1180, height: 820 };
export type DisplayLayout = 'mobile' | 'desktop';
// Public login comparison (2026-10-26): at 390px these providers render the
// same responsive forms with or without mobile UA/isMobile. Retain the proven
// UA for login/extraction compatibility; real CSS layout is mobile from launch.
export const DISPLAY_COMPATIBILITY: Record<string, { responsive: boolean; mobileUA: boolean }> = {
  centrodm: { responsive: true, mobileUA: false }, percamb: { responsive: true, mobileUA: false }, rdcchacabuco: { responsive: true, mobileUA: false },
};
export function contextDisplayOptions(profile: 'desktop' | 'responsive' | 'mobile-emulation' = 'desktop'): BrowserContextOptions {
  if (profile === 'mobile-emulation') return { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent };
  // Native decoration calibration temporarily widens this SAME page before
  // connecting VNC. The institution's first navigation already uses 390px.
  return profile === 'responsive'
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 }
    : { viewport: DESKTOP_VIEWPORT };
}
export function displaySize(layout: DisplayLayout, width?: number, height?: number) {
  if (layout === 'desktop') return DESKTOP_VIEWPORT;
  return { width: Math.max(320, Math.min(960, Math.round(width || 390))), height: Math.max(240, Math.min(844, Math.round(height || 720))) };
}
export interface DisplayGeometry { width: number; height: number; x: number; y: number }
const decorations = new WeakMap<Page, { x: number; y: number }>();
/** Geometry only; never reads DOM text, form values, cookies or storage. */
export async function configurePageDisplay(page: Page, layout: DisplayLayout, width?: number, height?: number): Promise<DisplayGeometry> {
  let inset = decorations.get(page);
  if (!inset) {
    const original = page.viewportSize();
    await page.setViewportSize(DESKTOP_VIEWPORT);
    // Window size differences include Chrome's minimum width and platform padding,
    // not just decorations. Calibrate the rendered origin using a pointer MOVE,
    // never a click, key, form value or screenshot. The listener is transient.
    await page.bringToFront();
    const nativeFrame = await page.evaluate(() => ({ x: screenX, y: screenY, chromeHeight: outerHeight - innerHeight }));
    if (!process.env.DISPLAY || nativeFrame.chromeHeight === 0) {
      // Headless fixture tests have no X11 window; production VNC requires DISPLAY.
      await page.setViewportSize(displaySize(layout, width, height));
      return { ...displaySize(layout, width, height), x: 0, y: 0 };
    }
    // Centro DM renders its login in an iframe: pointer events do not bubble
    // into the parent document. Calibrate every current frame, accounting for
    // its physical content origin, without reading the login form.
    const measured = [];
    let metrics: { x: number; y: number } | null = null;
    try {
      for (const frame of page.frames()) {
        let offset = { x: 0, y: 0 };
        if (frame !== page.mainFrame()) {
          const element = await frame.frameElement();
          try {
            const box = await element.boundingBox();
            if (!box) continue;
            const border = await element.evaluate(el => ({ x: (el as HTMLElement).clientLeft, y: (el as HTMLElement).clientTop }));
            offset = { x: box.x + border.x, y: box.y + border.y };
          } finally { await element.dispose(); }
        }
        measured.push(await frame.evaluateHandle(offset => ({ result: new Promise<{ x: number; y: number } | null>(resolve => {
          const abort = new AbortController();
          const timeout = setTimeout(() => { abort.abort(); resolve(null); }, 1800);
          window.addEventListener('pointermove', event => { clearTimeout(timeout); resolve({ x: event.screenX - event.clientX - screenX - offset.x, y: event.screenY - event.clientY - screenY - offset.y }); }, { capture: true, once: true, passive: true, signal: abort.signal });
        }) }), offset));
      }
      // CDP synthesizes screenX/Y relative to the emulated viewport. A real XTEST
      // move is required to measure physical X11 -> CSS coordinates accurately.
      const x = Math.round(nativeFrame.x + 32), y = Math.round(nativeFrame.y + nativeFrame.chromeHeight + 32);
      if (x < 0 || y < 0 || x >= 1280 || y >= 1000) throw new Error('DISPLAY_GEOMETRY_UNAVAILABLE');
      await execute('xdotool', ['mousemove', String(Math.min(1279, x + 1)), String(Math.min(999, y + 1)), 'mousemove', '--sync', String(x), String(y)], { timeout: 1500, maxBuffer: 1024 });
      metrics = await Promise.any(measured.map(async handle => {
        const value = await handle.evaluate(value => value.result);
        if (!value) throw new Error('DISPLAY_GEOMETRY_UNAVAILABLE');
        return value;
      }));
    }
    finally { await Promise.all(measured.map(handle => handle.dispose())); }
    if (!metrics || metrics.x < 0 || metrics.x > 32 || metrics.y < 0 || metrics.y > 180) throw new Error('DISPLAY_GEOMETRY_UNAVAILABLE');
    inset = metrics; decorations.set(page, inset);
    if (original) await page.setViewportSize(original);
  }
  const size = displaySize(layout, width, height);
  await page.setViewportSize(size); await page.bringToFront();
  const position = await page.evaluate(() => ({ x: screenX, y: screenY, dpr: devicePixelRatio }));
  const geometry = { ...size, x: Math.round(position.x + inset.x), y: Math.round(position.y + inset.y) };
  if (position.dpr !== 1 || geometry.x < 0 || geometry.y < 0 || geometry.x + size.width > 1280 || geometry.y + size.height > 1000) throw new Error('DISPLAY_GEOMETRY_UNAVAILABLE');
  return geometry;
}
