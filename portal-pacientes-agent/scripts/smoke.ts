import assert from 'node:assert/strict';
import { BrowserHost } from '../src/browser/browser-host.js';
import { PROVIDERS } from '../src/providers/index.js';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787';
const auth: Record<string, string> = {};
if (process.env.PORTAL_AUTH_PASSWORD) {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.PORTAL_AUTH_USER || '1234', password: process.env.PORTAL_AUTH_PASSWORD }), signal: AbortSignal.timeout(5000) });
  assert.equal(login.status, 200);
  auth.Cookie = login.headers.get('set-cookie')!.split(';')[0];
}
const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });
const api = await fetch(`${base}/api/health`, { headers: auth, signal: AbortSignal.timeout(5000) });
assert.equal(api.status, 200);
console.log(JSON.stringify({ check: 'health', ok: true }));
const host = new BrowserHost({ headless: true, chromiumSandbox: true, debugArtifacts: false, debugDir: '' });
let failed = false;
try {
  for (const target of [{ id: 'example', loginUrl: 'https://example.com' }, ...Object.values(PROVIDERS)]) {
    const context = await host.newContext();
    try {
      // Solo la página pública: nunca formularios, capturas, cookies ni contenido de la página.
      const page = await context.newPage();
      const response = await page.goto(target.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = response?.status() ?? 0;
      const ok = status >= 200 && status < 400;
      if (!ok) failed = true;
      console.log(JSON.stringify({ check: 'public_navigation', provider: target.id, status, ok }));
    } catch {
      failed = true;
      console.log(JSON.stringify({ check: 'public_navigation', provider: target.id, ok: false, errorCode: 'PUBLIC_NAVIGATION_FAILED' }));
    } finally { await context.close(); }
  }
} finally {
  await host.close();
  assert.equal(host.openContexts, 0);
  console.log(JSON.stringify({ check: 'browser_closed', ok: true }));
}
if (failed) process.exitCode = 1;
