import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { GoogleDriveStorage, type DriveDiagnostic } from '../../src/storage/google-drive.js';
import { GoogleOAuth } from '../../src/server/google-oauth.js';
import { PortalDatabase, TokenCipher } from '../../src/storage/database.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';

test('real fetch: redirect:error rejects Drive 308; manual exposes it without following Location', async () => {
  let hits = 0;
  let location = false;
  const server = createServer((_req, res) => { hits++; res.writeHead(308, location ? { location: '/must-not-follow' } : {}).end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    for (location of [false, true]) {
      await assert.rejects(fetch(url, { redirect: 'error' }), error => error instanceof TypeError && (error.cause as Error)?.message === 'unexpected redirect');
      const response = await fetch(url, { redirect: 'manual' }); assert.equal(response.status, 308);
    }
    assert.equal(hits, 4);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const finalStatus of [200, 201]) test('real HTTP/Undici: ZIP, 308 probe/chunks and final ' + finalStatus + ', retry never duplicates accepted bytes', async () => {
  const config = googleTestConfig(), mock = new MockGoogle();
  const db = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.alloc(32, 7)));
  const owner = db.upsertUser('account-A', 'a@example.test');
  db.saveCredentials(owner.id, { accessToken: 'access-account-A', refreshToken: 'refresh-account-A', expiresAt: Date.now() + 3600000 });
  const bytes = Buffer.alloc(finalStatus === 200 ? 4500000 : 9 * 1024 * 1024, 17); bytes.writeUInt32LE(0x04034b50);
  const files = new JobFileStore(config.tmpDir, randomUUID()); const result = await files.save(bytes, 'application/zip', 'DICOM_ZIP'); assert.ok(result.ok);
  let redirected = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/must-not-follow') { redirected = true; return void res.writeHead(500).end(); }
      const body: Buffer[] = []; for await (const part of req) body.push(Buffer.from(part));
      const buffer = Buffer.concat(body), headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, String(value));
      if (headers.has('content-length')) assert.equal(Number(headers.get('content-length')), buffer.length);
      if (req.method === 'PUT' && buffer.length) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('content-range') || ''); assert.ok(range);
        assert.equal(Number(range[2]) - Number(range[1]) + 1, buffer.length); assert.equal(Number(range[3]), bytes.length);
        if (Number(range[2]) < bytes.length - 1) assert.equal(buffer.length % (256 * 1024), 0);
      }
      const response = await mock.fetch('https://www.googleapis.com' + req.url, { method: req.method, headers, ...(buffer.length ? { body: buffer } : {}) });
      const status = req.url!.startsWith('/upload/') && req.method === 'PUT' && response.status === 200 ? finalStatus : response.status;
      const outgoing = Object.fromEntries(response.headers);
      if (status === 308) outgoing.location = '/must-not-follow';
      res.writeHead(status, outgoing).end(Buffer.from(await response.arrayBuffer()));
    } catch { req.socket.destroy(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  // Real Node fetch, real HTTP framing and 308 handling; synthetic server, no Google traffic.
  const transport: typeof fetch = (url, init) => fetch(base + new URL(String(url)).pathname + new URL(String(url)).search, init);
  const diagnostics: DriveDiagnostic[] = [];
  const drive = new GoogleDriveStorage(db, new GoogleOAuth(config.google!, mock.fetch), transport, async () => {}, (_job, event) => diagnostics.push(event));
  if (finalStatus === 201) mock.loseResponseOnce = true;
  const progress: number[] = [];
  try {
    const saved = await drive.upload({ ownerUserId: owner.id, jobId: randomUUID(), study: { id: 'synthetic', provider: 'centrodm', sourceKey: 'a'.repeat(64) }, file: result.file, signal: new AbortController().signal, onProgress: value => progress.push(value) });
    assert.deepEqual(mock.files.get(saved.remoteFileId)!.content, bytes);
    assert.equal(mock.uploadStarts, 1); assert.equal(redirected, false);
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), bytes.length);
    assert.equal(mock.calls.filter(call => call.method === 'PUT' && call.chunkBytes > 0).length, finalStatus === 200 ? 1 : 2);
    assert.ok(diagnostics.some(event => event.stage === 'session_probe' && event.status === 308));
    assert.ok(diagnostics.some(event => event.status === finalStatus));
    if (finalStatus === 201) assert.ok(progress.includes(8 * 1024 * 1024));
    assert.ok(!JSON.stringify(diagnostics).includes('access-account-A'));
    assert.ok(!JSON.stringify(diagnostics).includes('upload_id'));
    assert.ok(!JSON.stringify(diagnostics).includes(owner.id));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await files.cleanup(); db.close(); }
});
