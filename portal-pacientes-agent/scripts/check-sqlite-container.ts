import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { PortalDatabase, TokenCipher } from '../src/storage/database.js';

// Synthetic fixture only. Never opens the app's real DB or reads its environment secrets.
const phase = process.argv[2];
assert.ok(phase === 'write' || phase === 'read');
assert.equal(process.getuid?.(), 1000);
assert.equal(process.getgid?.(), 1000);
process.umask(0o077);
const status = readFileSync('/proc/self/status', 'utf8');
assert.match(status, /^NoNewPrivs:\s+1$/m);
assert.match(status, /^Seccomp:\s+2$/m);
assert.match(status, /^CapEff:\s+0+$/m);
assert.throws(() => writeFileSync('/app/sqlite-must-be-read-only', 'test'), { code: 'EROFS' });
const filename = '/var/lib/portal-data/container-regression.sqlite';
if (phase === 'read') assert.ok(existsSync(filename), 'DB must survive container removal/recreation');
const directory = statSync('/var/lib/portal-data');
assert.equal(directory.uid, 1000);
assert.equal(directory.gid, 1000);
assert.equal(directory.mode & 0o777, 0o700);
const db = new PortalDatabase(filename, new TokenCipher(Buffer.alloc(32, 23)));
try {
  if (phase === 'write') {
    const user = db.upsertUser('container-regression', 'fixture@example.test', 'Synthetic fixture');
    db.saveCredentials(user.id, { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
    db.createSession('synthetic-session', user.id, Date.now() + 3600_000);
  }
  assert.equal(db.sql.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.ok(existsSync(filename + '-wal'), 'SQLite must create WAL on the persistent volume');
  assert.ok(existsSync(filename + '-shm'), 'SQLite must create SHM on the persistent volume');
  for (const file of [filename, filename + '-wal', filename + '-shm']) {
    const stat = statSync(file);
    assert.equal(stat.uid, 1000);
    assert.equal(stat.gid, 1000);
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const user = db.session('synthetic-session');
  assert.equal(user?.email, 'fixture@example.test');
  assert.equal(db.credentials(user!.id)?.refreshToken, 'synthetic-refresh');
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM users').get()?.n, 1);
  assert.ok(!readFileSync(filename + '-wal').includes(Buffer.from('synthetic-refresh')));
  console.log('SQLITE_CONTAINER_OK: ' + phase + '; UID/GID 1000, read-only root, seccomp, no capabilities, WAL/SHM and encrypted fixture verified.');
} finally { db.close(); }
