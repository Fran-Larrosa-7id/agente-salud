import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { GoogleOAuth, DRIVE_SCOPE } from '../../src/server/google-oauth.js';
import { createGoogleServices } from '../../src/server/google-services.js';
import { createApp } from '../../src/server/app.js';
import { requestOrigin, isSecureRequest } from '../../src/server/portal-auth.js';
import { RemoteDesktop } from '../../src/server/remote-desktop.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { loadConfig } from '../../src/config.js';
import { waitFor } from '../helpers.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';

async function fixture(proxyPort?: number, configuredOrigin?: string) {
  const config = googleTestConfig(); config.remoteLogin = true;
  if (configuredOrigin) { config.publicBaseUrl = configuredOrigin; config.google!.redirectUri = configuredOrigin + '/api/auth/google/callback'; }
  const mock = new MockGoogle(), google = createGoogleServices(config, mock.fetch)!;
  const manager = new JobManager({ config, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ stepMs: 1, loginDelayMs: 60000 }), log: silentLogger, storage: google.drive });
  const desktop = new RemoteDesktop(silentLogger, proxyPort);
  const app = createApp({ config, manager, providers: PROVIDERS, google, desktop, info: { model: 'rules', modelReady: true, runner: 'fake' } });
  const server = app.listen(0, '127.0.0.1'); desktop.attach(server, manager); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const api = (path: string, cookie = '', method = 'GET', body?: unknown) => fetch(base + path, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: config.publicBaseUrl!, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  async function begin(path: string, sub = 'account-A', session = '') {
    const response = await api(path, session); const url = response.headers.get('location')!;
    const oauthCookie = response.headers.getSetCookie().find(item => item.startsWith('portal_oauth='))!.split(';')[0];
    const code = mock.code(url, sub);
    return { url, oauthCookie, callback: '/api/auth/google/callback?' + new URLSearchParams(code) };
  }
  async function login(sub: string) {
    const start = await begin('/api/auth/google/start', sub);
    assert.equal(new URL(start.url).searchParams.get('scope'), 'openid email profile');
    assert.equal(new URL(start.url).searchParams.get('code_challenge_method'), 'S256');
    const response = await api(start.callback, start.oauthCookie);
    assert.equal(response.headers.get('location'), '/#/inicio');
    const full = response.headers.getSetCookie().find(item => item.startsWith('portal_session='))!;
    assert.match(full, /HttpOnly/); assert.equal(/; Secure(?:;|$)/.test(full), config.publicBaseUrl!.startsWith('https:')); assert.match(full, /SameSite=Lax/);
    const cookie = full.split(';')[0];
    const session = await (await api('/api/auth/session', cookie)).json() as { user: { id: string }; drive: string };
    assert.equal(session.drive, 'disconnected');
    return { cookie, id: session.user.id };
  }
  async function connect(sub: string, cookie: string) {
    const start = await begin('/api/drive/connect', sub, cookie);
    assert.equal(new URL(start.url).searchParams.get('scope'), 'openid email profile ' + DRIVE_SCOPE);
    assert.equal(new URL(start.url).searchParams.get('access_type'), 'offline');
    return api(start.callback, cookie + '; ' + start.oauthCookie);
  }
  return { config, mock, google, manager, desktop, server, base, api, begin, login, connect,
    async close() { await desktop.stop(); await manager.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); google.db.close(); } };
}

test('localhost:8888 code flow works without Secure cookies only in development, never with remote HTTP or production HTTP', async () => {
  const env = { NODE_ENV: 'development', AUTH_MODE: 'google', STORAGE_PROVIDER: 'google_drive',
    PUBLIC_BASE_URL: 'http://localhost:8888', GOOGLE_REDIRECT_URI: 'http://localhost:8888/api/auth/google/callback',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', SESSION_SECRET: 's'.repeat(48),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), DATABASE_PATH: process.cwd() + '/private/test.sqlite', LLM_PROVIDER: 'rules' };
  const config = loadConfig(env, []);
  assert.equal(config.publicBaseUrl, 'http://localhost:8888');
  assert.equal(config.google!.redirectUri, env.GOOGLE_REDIRECT_URI);
  assert.equal(config.portalAuth, null);
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production' }, []), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, PUBLIC_BASE_URL: 'http://ubuntu.example:8888' }, []), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, GOOGLE_REDIRECT_URI: 'http://localhost:8787/api/auth/google/callback' }, []), /GOOGLE_REDIRECT_URI/);
  const f = await fixture(undefined, env.PUBLIC_BASE_URL);
  try {
    const attempt = await f.begin('/api/auth/google/start');
    assert.equal(new URL(attempt.url).searchParams.get('redirect_uri'), env.GOOGLE_REDIRECT_URI);
    const user = await f.login('local-account');
    assert.equal((await f.api('/api/auth/session', user.cookie)).status, 200);
    assert.equal((await f.connect('local-account', user.cookie)).headers.get('location'), '/#/perfil?drive=connected');
    const forged = { headers: { host: 'attacker.test', 'x-forwarded-proto': 'https' } };
    assert.equal(isSecureRequest(forged, f.config), false);
    assert.equal(requestOrigin(forged, f.config), env.PUBLIC_BASE_URL);
  } finally { await f.close(); }
});

test('OIDC verifies RSA signature, audience, issuer, expiry, nonce, verified email, sub and server allowlists', async () => {
  const config = googleTestConfig(), mock = new MockGoogle(), oauth = new GoogleOAuth(config.google!, mock.fetch);
  const claims = mock.claims('nonce');
  assert.equal((await oauth.verifyIdentity(mock.jwt(claims), 'nonce')).sub, 'account-A');
  for (const extra of [{ aud: 'another-client' }, { iss: 'https://attacker.test' }, { exp: 0 }, { iat: Math.floor(Date.now() / 1000) + 300 }, { nonce: 'wrong' }, { email_verified: false }, { sub: '' }, { azp: 'wrong' }]) {
    await assert.rejects(oauth.verifyIdentity(mock.jwt({ ...claims, ...extra }), 'nonce'), /GOOGLE_ACCESS_DENIED/);
  }
  const jwt = mock.jwt(claims).split('.'); jwt[2] = (jwt[2][0] === 'A' ? 'B' : 'A') + jwt[2].slice(1);
  await assert.rejects(oauth.verifyIdentity(jwt.join('.'), 'nonce'), /GOOGLE_ACCESS_DENIED/);
  await assert.rejects(new GoogleOAuth({ ...config.google!, allowedEmails: ['not-authorized@example.test'] }, mock.fetch).verifyIdentity(mock.jwt(claims), 'nonce'), /GOOGLE_ACCESS_DENIED/);
  await assert.rejects(new GoogleOAuth({ ...config.google!, allowedSubs: ['another-sub'] }, mock.fetch).verifyIdentity(mock.jwt(claims), 'nonce'), /GOOGLE_ACCESS_DENIED/);
});

test('Google mode fails closed, ignores forged proxy headers and never enables pilot login', async () => {
  assert.throws(() => loadConfig({ AUTH_MODE: 'google' }, []));
  assert.throws(() => loadConfig({ GOOGLE_CLIENT_ID: 'configured-without-mode' }, []), /AUTH_MODE explicito/);
  assert.throws(() => loadConfig({ AUTH_MODE: 'google', MAX_CONCURRENT_JOBS: '2' }, []), /MAX_CONCURRENT_JOBS=1/);
  assert.throws(() => loadConfig({ STORAGE_PROVIDER: 'google_drive' }, []), /AUTH_MODE/);
  const f = await fixture();
  try {
    const forged = { headers: { host: 'attacker.test', 'x-forwarded-proto': 'http' } };
    assert.equal(requestOrigin(forged, f.config), 'https://portal.test'); assert.equal(isSecureRequest(forged, f.config), true);
    assert.equal((await f.api('/api/auth/login', '', 'POST', { username: '1234', password: '1234' })).status, 404);
    assert.equal((await f.api('/api/health')).status, 401);
    const denied = await fetch(f.base + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://attacker.test', 'x-forwarded-host': 'portal.test' } }); assert.equal(denied.status, 403);
    const user = await f.login('account-A');
    const data = await (await f.api('/api/auth/session', user.cookie)).text();
    assert.ok(!/refreshToken|accessToken|googleSub|synthetic-client-secret/.test(data));
    assert.deepEqual(Object.keys(JSON.parse(data).user).sort(), ['displayName', 'email', 'id']);
    assert.equal((await f.api('/api/imports/percamb', user.cookie, 'POST')).status, 409);
    const wrongAccount = await f.connect('account-B', user.cookie); assert.match(wrongAccount.headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
    assert.equal(f.google.db.connection(user.id).status, 'disconnected');
    await f.connect('account-A', user.cookie); assert.equal(f.google.db.connection(user.id).status, 'connected');
  } finally { await f.close(); }
});

test('OAuth state is cookie-bound, short-lived, one-use and cancellation creates no session', async () => {
  const f = await fixture();
  try {
    const start = await f.begin('/api/auth/google/start?returnTo=https://attacker.test');
    assert.equal(new URL(start.url).searchParams.get('redirect_uri'), f.config.google!.redirectUri);
    const wrong = await f.api(start.callback, 'portal_oauth=' + '0'.repeat(64)); assert.match(wrong.headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
    const replay = await f.api(start.callback, start.oauthCookie); assert.match(replay.headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
    const expired = await f.begin('/api/auth/google/start'); f.google.db.sql.exec('UPDATE oauth_states SET expires_at=1');
    assert.match((await f.api(expired.callback, expired.oauthCookie)).headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
    const cancelled = await f.begin('/api/auth/google/start');
    assert.match((await f.api(cancelled.callback.replace(/code=[^&]+/, 'error=access_denied'), cancelled.oauthCookie)).headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
    assert.equal(f.google.db.sql.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 0);
    const valid = await f.begin('/api/auth/google/start'); const callback = await f.api(valid.callback, valid.oauthCookie); assert.equal(callback.headers.get('location'), '/#/inicio');
    assert.match((await f.api(valid.callback, valid.oauthCookie)).headers.get('location')!, /GOOGLE_ACCESS_DENIED/);
  } finally { await f.close(); }
});

test('Disconnect discards unreadable credentials and truthfully reports that Google revocation was not confirmed', async () => {
  const f = await fixture();
  try {
    const user = await f.login('account-A'); await f.connect('account-A', user.cookie);
    f.google.db.sql.prepare('UPDATE google_drive_connections SET credentials=? WHERE owner_id=?').run('unreadable-ciphertext', user.id);
    const response = await f.api('/api/drive/disconnect', user.cookie, 'POST');
    assert.deepEqual(await response.json(), { status: 'disconnected', revocationConfirmed: false });
    assert.equal(f.google.db.credentials(user.id), null);
  } finally { await f.close(); }
});

test('A/B isolation covers every job API, SSE, desktop HTML, busy response and logout ownership', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const a = await f.login('account-A'), b = await f.login('account-B'); await f.connect('account-A', a.cookie); await f.connect('account-B', b.cookie);
    const created = await (await f.api('/api/imports/percamb', a.cookie, 'POST')).json() as { jobId: string }; const id = created.jobId;
    await waitFor(() => f.manager.get(id)?.state === 'WAITING_FOR_USER_LOGIN');
    for (const route of [`/api/imports/${id}`, `/api/imports/${id}/events`, `/api/imports/${id}/studies`, `/api/imports/${id}/files/${randomUUID()}`, `/remote/${id}`]) assert.equal((await f.api(route, b.cookie)).status, 404, route);
    for (const route of ['import', 'desktop', 'resume', 'retry-discovery', 'retry-storage', 'files/' + randomUUID() + '/ack']) assert.equal((await f.api(`/api/imports/${id}/${route}`, b.cookie, 'POST', { studyIds: [], persisted: true })).status, 404, route);
    assert.equal((await f.api(`/api/imports/${id}`, b.cookie, 'DELETE')).status, 404);
    const busy = await f.api('/api/imports/percamb', b.cookie, 'POST'); assert.equal(busy.status, 429); assert.deepEqual(await busy.json(), { error: 'IMPORT_BUSY' });
    await f.api(`/api/imports/${id}`, a.cookie, 'DELETE'); await waitFor(() => f.manager.activeCount() === 0);
    const next = await (await f.api('/api/imports/percamb', b.cookie, 'POST')).json() as { jobId: string };
    await f.api('/api/auth/logout', a.cookie, 'POST'); assert.equal(f.manager.get(next.jobId)!.isTerminal, false);
    assert.equal((await f.api('/api/imports/' + next.jobId, a.cookie)).status, 401);
    assert.equal((await f.api('/api/imports/' + next.jobId, b.cookie)).status, 200);
    assert.deepEqual((await (await f.api('/api/studies', b.cookie)).json() as { studies: unknown[] }).studies, []);
  } finally { await f.close(); }
});

test('Logout during Drive consent cannot resurrect credentials; expired sessions stop SSE before the next event', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const a = await f.login('account-A'); const pending = await f.begin('/api/drive/connect', 'account-A', a.cookie);
    await f.api('/api/auth/logout', a.cookie, 'POST');
    assert.match((await f.api(pending.callback, a.cookie + '; ' + pending.oauthCookie)).headers.get('location')!, /SESSION_EXPIRED/);
    assert.equal(f.google.db.credentials(a.id), null);
    const again = await f.login('account-A'); const job = f.manager.create('percamb', again.id);
    await waitFor(() => job.state === 'WAITING_FOR_USER_LOGIN');
    const response = await fetch(f.base + '/api/imports/' + job.id + '/events', { headers: { Cookie: again.cookie }, signal: AbortSignal.timeout(5000) });
    const reader = response.body!.getReader(); await reader.read();
    f.google.db.sql.exec('UPDATE sessions SET expires_at=1'); job.push('provider_opened', { marker: 'must-not-arrive' });
    let text = '';
    while (true) { const data = await reader.read(); if (data.done) break; text += Buffer.from(data.value).toString(); }
    assert.ok(!text.includes('must-not-arrive'));
  } finally { await f.close(); }
});

test('noVNC rejects a stolen desktop cookie from B and closes an upgraded socket after A session revocation', { timeout: 15000 }, async () => {
  const upstream = createServer(); const upstreamSockets = new Set<Duplex>();
  upstream.on('upgrade', (_req, socket) => { upstreamSockets.add(socket); socket.on('error', () => {}); socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); socket.on('data', () => {}); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const f = await fixture((upstream.address() as AddressInfo).port);
  try {
    const a = await f.login('account-A'), b = await f.login('account-B');
    const job = f.manager.create('percamb', a.id); await waitFor(() => job.state === 'WAITING_FOR_USER_LOGIN');
    const token = randomBytes(32).toString('hex');
    (f.desktop as unknown as { active: unknown }).active = { job, token, children: [], sockets: new Set(), listener: () => {} };
    const socketRequest = (cookie: string) => request(f.base + '/remote/' + job.id + '/socket', { headers: { Cookie: cookie + '; portal_remote=' + token, Origin: f.config.publicBaseUrl!, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' } });
    const denied = socketRequest(b.cookie); denied.end(); const [response] = await once(denied, 'response'); assert.equal(response.statusCode, 403); response.resume();
    const accepted = socketRequest(a.cookie); accepted.end(); const [, socket] = await once(accepted, 'upgrade') as [unknown, Duplex, Buffer];
    socket.on('error', () => {}); socket.resume();
    const closed = once(socket, 'close');
    const raw = a.cookie.split('=')[1]; f.google.db.revokeSession(createHmac('sha256', f.config.google!.sessionSecret).update(raw).digest('hex'));
    await closed; assert.equal(socket.destroyed, true);
  } finally { await f.close(); for (const socket of upstreamSockets) socket.destroy(); await new Promise<void>(resolve => upstream.close(() => resolve())); }
});
