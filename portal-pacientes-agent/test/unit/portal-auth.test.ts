import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/server/app.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig, testProvider } from '../helpers.js';

test('producción exige acceso privado y no permite captura de secretos', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }, []), /PORTAL_AUTH_PASSWORD/);
  assert.deepEqual(loadConfig({ NODE_ENV: 'production', PORTAL_AUTH_USER: '1234', PORTAL_AUTH_PASSWORD: '1234' }, []).portalAuth, { username: '1234', password: '1234' });
  assert.throws(() => loadConfig({ PORTAL_AUTH_USER: 'invalid:user', PORTAL_AUTH_PASSWORD: '1234' }, []), /dos puntos/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PORTAL_AUTH_PASSWORD: 'synthetic-test-password-123456', PLAYWRIGHT_DEBUG_ARTIFACTS: 'true' }, []), /depuración/);
  assert.equal(loadConfig({}, []).llm.provider, 'rules');
  assert.equal(loadConfig({}, []).maxConcurrentJobs, 1);
});

test('protege portal, API, SSE y archivos; rechaza mutaciones de otro origen', async () => {
  const config = testConfig({ portalAuth: { username: '1234', password: '1234' } });
  const providers = { fake: testProvider() };
  const manager = new JobManager({ config, providers, runnerFactory: fakeRunnerFactory(), log: silentLogger });
  const server = createApp({ config, providers, manager, info: { runner: 'fake', model: 'fake', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    for (const route of ['/api/health', '/api/imports/fake-id/events', '/api/imports/fake-id/files/fake-id', '/remote-assets/core/rfb.js']) {
      const denied = await fetch(base + route);
      assert.equal(denied.status, 401); assert.equal(denied.headers.has('www-authenticate'), false);
    }
    assert.equal((await fetch(`${base}/api/health`, { headers: { Authorization: 'Basic aW52YWxpZA==' } })).status, 401);
    const invalid = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '1234', password: 'incorrecta' }) });
    assert.equal(invalid.status, 401); assert.equal(invalid.headers.has('www-authenticate'), false);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '1234', password: '1234' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=43200/);
    const Cookie = cookie.split(';')[0];
    assert.equal((await fetch(`${base}/api/health`, { headers: { Cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/health`, { headers: { Cookie: 'portal_session=' + '0'.repeat(64) } })).status, 401);
    const remote = await fetch(`${base}/remote/00000000-0000-4000-8000-000000000000`, { redirect: 'manual' });
    assert.equal(remote.status, 303); assert.equal(remote.headers.has('www-authenticate'), false);
    assert.equal((await fetch(`${base}/api/imports/fake`, { method: 'POST', headers: { Cookie, Origin: 'https://untrusted.example' } })).status, 403);
    const created = await fetch(`${base}/api/imports/fake`, { method: 'POST', headers: { Cookie, Origin: base } });
    assert.equal(created.status, 201);
    const { jobId } = await created.json() as { jobId: string };
    const busy = await fetch(`${base}/api/imports/fake`, { method: 'POST', headers: { Cookie } });
    assert.equal(busy.status, 429);
    assert.deepEqual(await busy.json(), { error: 'TOO_MANY_JOBS', activeJobId: jobId });
    assert.equal((await fetch(`${base}/api/imports/${jobId}`, { method: 'DELETE', headers: { Cookie } })).status, 200);
    assert.equal(manager.activeCount(), 0);
    assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/health`, { headers: { Cookie } })).status, 401);
  } finally {
    await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
