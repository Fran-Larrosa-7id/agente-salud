import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PortalDatabase, TokenCipher } from '../../src/storage/database.js';
import { AGENT_ROOT } from '../../src/config.js';
import { googleTestConfig } from '../google-helpers.js';

test('Offline key rotation re-encrypts every context atomically and a wrong old key leaves the DB intact', async () => {
  const config = googleTestConfig(); const oldKey = config.google!.encryptionKey; const newKey = Buffer.alloc(32, 19).toString('base64');
  const db = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.from(oldKey, 'base64')));
  const user = db.upsertUser('rotation-account', 'rotation@example.test');
  db.saveCredentials(user.id, { refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access' });
  db.putOAuth('state-hash', 'binder-hash', { purpose: 'login', nonce: 'synthetic-nonce', verifier: 'synthetic-verifier' });
  db.saveUpload(user.id, 'file-key', 'remote-id', 'job-id', 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'); db.close();
  const run = promisify(execFile);
  const env = { ...process.env, DATABASE_PATH: config.databasePath, TOKEN_ENCRYPTION_KEY: oldKey, TOKEN_ENCRYPTION_KEY_NEW: newKey };
  const result = await run(process.execPath, ['--import', 'tsx', 'scripts/rotate-token-key.ts'], { cwd: AGENT_ROOT, env });
  assert.match(result.stdout, /KEY_ROTATED records=3/); assert.ok(!result.stdout.includes('synthetic-refresh'));
  const next = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.from(newKey, 'base64')));
  assert.equal(next.credentials(user.id)!.refreshToken, 'synthetic-refresh'); assert.ok(next.upload(user.id, 'file-key')!.session!.includes('upload_id=synthetic'));
  assert.equal(next.takeOAuth('state-hash', 'binder-hash')!.nonce, 'synthetic-nonce'); next.close();
  await assert.rejects(run(process.execPath, ['--import', 'tsx', 'scripts/rotate-token-key.ts'], { cwd: AGENT_ROOT, env }));
  const afterFailure = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.from(newKey, 'base64')));
  assert.equal(afterFailure.credentials(user.id)!.refreshToken, 'synthetic-refresh'); afterFailure.close();
});
