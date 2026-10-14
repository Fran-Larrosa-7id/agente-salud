import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { createApp } from '../../src/server/app.js';
import { requestOrigin } from '../../src/server/portal-auth.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig } from '../helpers.js';

function request(port: number, pathname: string, headers: Record<string, string>, method = 'GET', body?: string) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: pathname, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('proxy HTTPS conserva Secure, origen exacto y CSP WebSocket WSS', async () => {
  assert.equal(requestOrigin({ headers: { host: 'portal.example.com', 'x-forwarded-proto': 'https, http' } }), 'https://portal.example.com');
  const config = testConfig({ portalAuth: { username: '1234', password: '1234' }, remoteLogin: true, headless: false, maxConcurrentJobs: 1 });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory() });
  const desktop = new RemoteDesktop(silentLogger);
  const server = createApp({ config, manager, providers: PROVIDERS, desktop, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const proxyHeaders = { Host: 'portal.example.com', 'X-Forwarded-Proto': 'https', Origin: 'https://portal.example.com' };
  try {
    const login = await request(port, '/api/auth/login', { ...proxyHeaders, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ username: '1234', password: '1234' }));
    assert.equal(login.status, 200);
    const cookie = String(login.headers['set-cookie']?.[0] || '');
    assert.match(cookie, /; Secure(?:;|$)/, 'la cookie de sesión respeta HTTPS terminado por proxy');
    const token = cookie.split(';')[0];

    const remote = await request(port, '/remote/00000000-0000-4000-8000-000000000000', { ...proxyHeaders, Cookie: token });
    assert.equal(remote.status, 404);
    assert.match(String(remote.headers['content-security-policy']), /connect-src 'self' wss:\/\/portal\.example\.com;/);
    assert.doesNotMatch(String(remote.headers['content-security-policy']), /(?:^|\s)ws:\s|wss:\s/);
    const client = await request(port, '/remote-assets/portal-login.js', { ...proxyHeaders, Cookie: token });
    assert.equal(client.status, 200);
    assert.match(client.body, /location\.protocol === 'https:' \? 'wss:\/\/' : 'ws:\/\/'/);
    assert.match(client.body, /location\.host \+ '\/remote\/'/);
    assert.doesNotMatch(client.body, /localhost:8787|127\.0\.0\.1:8787/);

    const wrongScheme = await request(port, '/api/auth/logout', { ...proxyHeaders, Origin: 'http://portal.example.com', Cookie: token }, 'POST');
    assert.equal(wrongScheme.status, 403, 'el proxy mantiene estricto el chequeo de esquema y origen');
    const session = await request(port, '/api/auth/session', { ...proxyHeaders, Cookie: token });
    assert.equal(JSON.parse(session.body).authenticated, true);
  } finally {
    await desktop.stop();
    await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
