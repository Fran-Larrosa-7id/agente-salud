import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createGoogleServices } from '../../src/server/google-services.js';
import { GoogleDriveStorage, type DriveDiagnostic } from '../../src/storage/google-drive.js';
import { PendingImports } from '../../src/storage/pending-imports.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';
import { waitFor } from '../helpers.js';

test('pending Drive job survives shutdown/DB restart and resumes original ZIP without institutional redownload or duplicates', async () => {
  const config = googleTestConfig(), mock = new MockGoogle();
  let google = createGoogleServices(config, mock.fetch)!;
  const owner = google.db.upsertUser('account-A', 'a@example.test');
  google.db.saveCredentials(owner.id, { accessToken: 'access-account-A', refreshToken: 'refresh-account-A', expiresAt: Date.now() + 3600000 });
  const pending = new PendingImports(config.databasePath, config.jobTtlMs);
  let downloads = 0;
  const factory = fakeRunnerFactory({ loginDelayMs: 1, stepMs: 1 });
  let manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, storage: new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {}), pendingImports: pending,
    runnerFactory: (...args) => { downloads++; return factory(...args); } });
  try {
    mock.failTransfers = true;
    const job = manager.create('centrodm', owner.id);
    await waitFor(() => job.state === 'WAITING_SELECTION'); manager.select(job.id, [job.studies[0].id]);
    await waitFor(() => !!job.storageError);
    assert.equal(google.db.list(owner.id).length, 0);
    const original = manager.file(job.id, job.files[0].id)!;
    const zip = await readFile(original.path);
    assert.equal((await pending.list()).length, 1);
    const previousSequence = job.snapshot().lastSeq;
    await manager.shutdown(); google.db.close();
    assert.equal((await pending.list())[0].snapshot.storageError, job.storageError);
    assert.equal(existsSync(original.path), false, 'volatile source removed on shutdown');
    google = createGoogleServices(config, mock.fetch)!;
    manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, storage: new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {}), pendingImports: pending,
      runnerFactory: () => { throw new Error('must not reopen institution'); } });
    await manager.restorePending();
    const restored = manager.getForOwner(job.id, owner.id)!;
    assert.equal(restored.state, 'IMPORTING'); assert.ok(restored.snapshot().lastSeq > previousSequence);
    assert.equal(manager.getForOwner(job.id, 'another-account'), undefined);
    assert.deepEqual(await readFile(manager.file(job.id, original.id)!.path), zip);
    mock.failTransfers = false; await manager.retryStorage(job.id);
    await waitFor(() => restored.state === 'COMPLETED');
    assert.equal(downloads, 1); assert.equal(mock.uploadStarts, 1);
    assert.equal(google.db.list(owner.id).length, 1);
    const saved = google.db.list(owner.id)[0]; assert.deepEqual(mock.files.get(saved.remoteFileId)!.content, zip);
    await waitFor(() => !existsSync(pending.directory(job.id)));
    assert.equal((await pending.list()).length, 0);
  } finally { await manager.shutdown(); google.db.close(); }
});

test('pending originals expire by original job TTL, including orphaned partial copies', async () => {
  const config = googleTestConfig(), mock = new MockGoogle(), google = createGoogleServices(config, mock.fetch)!;
  const owner = google.db.upsertUser('account-A', 'a@example.test');
  google.db.saveCredentials(owner.id, { accessToken: 'access-account-A', expiresAt: Date.now() + 3600000 });
  const pending = new PendingImports(config.databasePath, config.jobTtlMs);
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, storage: new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {}), pendingImports: pending, runnerFactory: fakeRunnerFactory({ loginDelayMs: 1, stepMs: 1 }) });
  try {
    mock.failTransfers = true; const job = manager.create('centrodm', owner.id);
    await waitFor(() => job.state === 'WAITING_SELECTION'); manager.select(job.id, [job.studies[0].id]); await waitFor(() => !!job.storageError);
    await manager.shutdown();
    const manifest = path.join(pending.directory(job.id), 'manifest.json');
    const record = JSON.parse(await readFile(manifest, 'utf8')); record.expiresAt = Date.now() - 1;
    await writeFile(manifest, JSON.stringify(record));
    assert.equal((await pending.list()).length, 0); assert.equal(existsSync(pending.directory(job.id)), false);
    const orphan = pending.directory(randomUUID()); await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, 'original.partial'), 'synthetic');
    const old = new Date(Date.now() - config.jobTtlMs - 1000); await utimes(orphan, old, old);
    await pending.list(); assert.equal(existsSync(orphan), false);
  } finally { await manager.shutdown(); google.db.close(); }
});

test('Drive HTTP diagnostics distinguish permission, transient and definitive errors without logging secrets', async () => {
  for (const failure of [403, 400, 503, 429, 401]) {
    const config = googleTestConfig(), mock = new MockGoogle(), google = createGoogleServices(config, mock.fetch)!;
    const owner = google.db.upsertUser('account-A', 'a@example.test');
    google.db.saveCredentials(owner.id, { accessToken: 'access-account-A', refreshToken: 'refresh-account-A', expiresAt: Date.now() + 3600000 });
    const events: DriveDiagnostic[] = []; let calls = 0;
    const transport: typeof fetch = (url, init) => {
      if (new URL(String(url)).pathname.startsWith('/upload/') && init?.method === 'PUT' && ++calls <= (failure === 503 || failure === 429 ? 1 : 10)) {
        return Promise.resolve(Response.json({ error: { message: 'TOKEN-SECRET /private/patient', errors: [{ reason: failure === 403 ? 'insufficientPermissions' : failure === 429 ? 'rateLimitExceeded' : 'untrusted-sensitive-reason' }] } }, { status: failure }));
      }
      return mock.fetch(url, init);
    };
    const drive = new GoogleDriveStorage(google.db, google.oauth, transport, async () => {}, (_job, event) => events.push(event));
    const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, storage: drive, runnerFactory: fakeRunnerFactory({ loginDelayMs: 1, stepMs: 1 }) });
    try {
      const job = manager.create('centrodm', owner.id); await waitFor(() => job.state === 'WAITING_SELECTION'); manager.select(job.id, [job.studies[0].id]);
      await waitFor(() => job.state === 'COMPLETED' || !!job.storageError);
      if (failure === 503 || failure === 429) { assert.equal(job.state, 'COMPLETED'); assert.equal(mock.uploadStarts, 1); }
      else { assert.ok(job.storageError); assert.equal(google.db.list(owner.id).length, 0); if (failure === 400) assert.equal(calls, 1); }
      if (failure === 403) assert.ok(events.some(event => event.status === 403 && event.reason === 'insufficientPermissions' && !event.transient));
      const logged = JSON.stringify(events); assert.ok(!logged.includes('TOKEN-SECRET')); assert.ok(!logged.includes('private/patient')); assert.ok(!logged.includes('untrusted-sensitive-reason')); assert.ok(!logged.includes('access-account-A'));
    } finally { await manager.shutdown(); google.db.close(); }
  }
});
