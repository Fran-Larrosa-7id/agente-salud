/** Manual, unauthenticated public-login layout check. Never fills or submits forms,
 * uses saved state, or records screenshots, cookies, text or field values. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { contextDisplayOptions, configurePageDisplay } from '../src/browser/display-profile.js';
import { PROVIDERS } from '../src/providers/index.js';
import { DomainPolicy } from '../src/security/domain-policy.js';

const headed = process.env.PROBE_HEADED === 'true';
const browser = await chromium.launch({ headless: !headed, chromiumSandbox: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
try {
  for (const [provider, url] of [
    ['centrodm', 'https://estudios.centrodm.com.ar/'],
    ['percamb', 'https://www.biodatasa.com.ar/lwcloud/percamb/login'],
    ['rdcchacabuco', 'https://rdcchacabuco.from-ar.com/patientportal/index.php'],
  ]) {
    let responsiveGeometry: Array<{ width: number; inputs: Array<{ type: string; x: number; y: number; width: number; height: number; fontSize: string }> }> = [];
    for (const profile of ['desktop', 'responsive', 'mobile-emulation'] as const) {
      const context = await browser.newContext({ ...contextDisplayOptions(profile), locale: 'es-AR', serviceWorkers: 'block' });
      try {
        const config = PROVIDERS[provider];
        const policy = new DomainPolicy(config.allowedHosts, config.staticHosts, config.allowedOrigins, config.requireHttps);
        await context.route('**/*', route => (route.request().isNavigationRequest() ? policy.isAllowedNavigation(route.request().url()) : policy.isAllowedSubresource(route.request().url())) ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage();
        if (profile === 'responsive') await page.setViewportSize({ width: 390, height: 844 });
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 35_000 });
        if (provider === 'centrodm') {
          // Public choice of patient portal; never submit the login form.
          for (const frame of page.frames()) {
            const choice = frame.getByRole('link', { name: 'Portal Paciente', exact: true });
            if (await choice.count() && await choice.isVisible()) {
              await choice.click({ timeout: 5000 });
              await frame.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 10000 });
            }
          }
        }
        // Exercise the production native calibration on the actual public form,
        // including Centro DM's iframe. No credentials or screenshots are used.
        const clip = headed && profile === 'responsive' ? await configurePageDisplay(page, 'mobile', 390, 844) : undefined;
        const geometry = await Promise.all(page.frames().map(frame => frame.evaluate(() => ({
          width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
          visualWidth: visualViewport?.width, visualScale: visualViewport?.scale,
          viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
          inputs: Array.from(document.querySelectorAll('input')).filter(input => {
            const box = input.getBoundingClientRect(); return box.width > 0 && box.height > 0 && !['hidden', 'submit', 'button', 'checkbox'].includes(input.type);
          }).map(input => {
            const box = input.getBoundingClientRect(); const style = getComputedStyle(input);
            return { type: input.type, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), fontSize: style.fontSize };
          }),
        }))));
        assert.ok(response?.ok());
        assert.ok(geometry.some(frame => frame.inputs.some(input => input.type === 'password')), 'Public login form must be present');
        if (profile !== 'desktop') assert.equal(geometry[0].width, 390);
        const formGeometry = geometry.filter(frame => frame.inputs.length);
        if (profile === 'responsive') responsiveGeometry = formGeometry;
        if (profile === 'mobile-emulation') {
          // Linux desktop Chromium reserves a 15px scrollbar gutter; mobile
          // emulation uses overlay scrollbars. Allow that bounded reflow, while
          // rejecting a different form, font size, breakpoint or scaled desktop.
          assert.equal(formGeometry.length, responsiveGeometry.length);
          formGeometry.forEach((frame, i) => {
            const responsive = responsiveGeometry[i];
            assert.equal(frame.width, responsive.width); assert.equal(frame.inputs.length, responsive.inputs.length);
            frame.inputs.forEach((input, j) => {
              const expected = responsive.inputs[j];
              assert.equal(input.type, expected.type); assert.equal(input.fontSize, expected.fontSize);
              for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(input[key] - expected[key]) <= 16, 'Review provider strategy: mobile form geometry changed');
            });
          });
        }
        console.log(JSON.stringify({ provider, profile, status: response?.status(), clip, frames: geometry, passed: true }));
      } catch (error) {
        // Only stable network error codes, never redirect URLs or server responses.
        console.log(JSON.stringify({ provider, profile, error: /net::[A-Z_]+/.exec(String(error))?.[0] ?? 'PUBLIC_PROBE_FAILED' }));
        process.exitCode = 1;
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
