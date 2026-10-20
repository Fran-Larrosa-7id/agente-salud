import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createGoogleServices } from '../src/server/google-services.js';
import { GoogleDriveStorage } from '../src/storage/google-drive.js';
import { PendingImports } from '../src/storage/pending-imports.js';
import { JobManager } from '../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../src/jobs/fake-runner.js';
import { PROVIDERS } from '../src/providers/index.js';
import { silentLogger } from '../src/security/logger.js';
import { googleTestConfig, MockGoogle } from '../test/google-helpers.js';
import { waitFor } from '../test/helpers.js';

// Only launched by test-sqlite-docker.mjs on its new, exclusively synthetic volume.
const phase = process.argv[2]; assert.ok(['write', 'startup', 'read'].includes(phase));
assert.equal(process.getuid?.(), 1000); assert.equal(process.getgid?.(), 1000); process.umask(0o077);
const config = googleTestConfig();
config.databasePath = '/var/lib/portal-data/drive-recovery-fixture.sqlite';
config.tmpDir = '/var/lib/portal/import-jobs/recovery-fixture';
const mock = new MockGoogle(), google = createGoogleServices(config, mock.fetch)!;
const owner = google.db.upsertUser('account-A', 'fixture@example.test');
if (phase === 'write') google.db.saveCredentials(owner.id, { accessToken: 'access-account-A', refreshToken: 'refresh-account-A', expiresAt: Date.now() + 3600000 });
else {
  const remote = JSON.parse(await readFile('/var/lib/portal-data/synthetic-remote.json', 'utf8'));
  for (const [key, value] of remote.files) mock.files.set(key, value);
  for (const [key, value] of remote.sessions) mock.sessions.set(key, value);
  mock.uploadStarts = remote.uploadStarts;
}
const pending = new PendingImports(config.databasePath, config.jobTtlMs);
const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger,
  storage: new GoogleDriveStorage(google.db, google.oauth, mock.fetch, async () => {}), pendingImports: pending,
  runnerFactory: phase === 'write' ? fakeRunnerFactory({ stepMs: 1, loginDelayMs: 1 }) : () => { throw new Error('institutional redownload forbidden'); } });
try {
  if (phase === 'write') {
    mock.failTransfers = true;
    const job = manager.create('centrodm', owner.id); await waitFor(() => job.state === 'WAITING_SELECTION');
    manager.select(job.id, [job.studies[0].id]); await waitFor(() => !!job.storageError);
    assert.equal(google.db.list(owner.id).length, 0); assert.equal((await pending.list()).length, 1);
    await manager.shutdown();
    // Simulated remote state is retained only so the next isolated test process can emulate Google.
    await writeFile('/var/lib/portal-data/synthetic-remote.json', JSON.stringify({ files: [...mock.files], sessions: [...mock.sessions], uploadStarts: mock.uploadStarts }), { mode: 0o600 });
  } else if (phase === 'startup') {
    // Exercise the actual index.ts restoration path, not only a manually wired manager.
    let output = '';
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts', '--fake'], { env: { ...process.env,
      NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '18791', AUTH_MODE: 'google', STORAGE_PROVIDER: 'google_drive',
      PUBLIC_BASE_URL: 'http://localhost:18791', GOOGLE_REDIRECT_URI: 'http://localhost:18791/api/auth/google/callback',
      GOOGLE_CLIENT_ID: config.google!.clientId, GOOGLE_CLIENT_SECRET: config.google!.clientSecret,
      SESSION_SECRET: config.google!.sessionSecret, TOKEN_ENCRYPTION_KEY: config.google!.encryptionKey,
      DATABASE_PATH: config.databasePath, TMP_DIR: config.tmpDir, LLM_PROVIDER: 'rules', REMOTE_LOGIN: 'false', HEADLESS: 'true', LOG_LEVEL: 'info',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', () => {});
    const exited = once(child, 'exit');
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { ready = (await fetch('http://127.0.0.1:18791/health')).ok; } catch {}
        if (ready) break; await delay(50);
      }
      assert.equal(ready, true); assert.ok(output.includes('storage_job_restored'));
      const session = await (await fetch('http://127.0.0.1:18791/api/auth/session')).json() as { mode: string; authenticated: boolean };
      assert.equal(session.mode, 'google'); assert.equal(session.authenticated, false);
    } finally { child.kill('SIGTERM'); await exited; }
    assert.equal((await pending.list()).length, 1, 'graceful application shutdown retains the pending ZIP');
  } else {
    const saved = (await pending.list())[0]; assert.ok(saved);
    await manager.restorePending();
    const job = manager.getForOwner(saved.snapshot.jobId, owner.id)!; assert.ok(job);
    assert.equal(manager.getForOwner(job.id, 'another-account'), undefined);
    await manager.retryStorage(job.id); await waitFor(() => job.state === 'COMPLETED');
    assert.equal(mock.uploadStarts, 1); assert.equal(google.db.list(owner.id).length, 1);
    const study = google.db.list(owner.id)[0], remote = mock.files.get(study.remoteFileId)!;
    assert.equal(study.kind, 'DICOM_ZIP');
    assert.equal(createHash('sha256').update(remote.content!).digest('hex'), study.sha256);
    await manager.shutdown();
    assert.equal((await pending.list()).length, 0);
  }
  console.log('DRIVE_RECOVERY_CONTAINER_OK: ' + phase + '; synthetic ZIP, durable pending job, account isolation, resumable session and no institutional redownload.');
} finally { await manager.shutdown(); google.db.close(); }
