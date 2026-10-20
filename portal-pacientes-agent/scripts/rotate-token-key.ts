import { existsSync } from 'node:fs';
import { PortalDatabase, TokenCipher } from '../src/storage/database.js';

// Offline only. Secrets are read from the environment and never printed.
const filename = process.env.DATABASE_PATH;
const decode = (key: string | undefined) => {
  if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('INVALID_ENCRYPTION_KEY');
  return Buffer.from(key, 'base64');
};
if (!filename || !existsSync(filename)) throw new Error('DATABASE_NOT_FOUND');
const oldCipher = new TokenCipher(decode(process.env.TOKEN_ENCRYPTION_KEY));
const newCipher = new TokenCipher(decode(process.env.TOKEN_ENCRYPTION_KEY_NEW));
process.umask(0o077);
const db = new PortalDatabase(filename, oldCipher);
let count = 0;
try {
  db.sql.exec('BEGIN IMMEDIATE');
  for (const row of db.sql.prepare('SELECT owner_id,credentials FROM google_drive_connections WHERE credentials IS NOT NULL').all()) {
    const context = 'drive:' + row.owner_id;
    db.sql.prepare('UPDATE google_drive_connections SET credentials=? WHERE owner_id=?').run(newCipher.seal(oldCipher.open(String(row.credentials), context), context), row.owner_id!); count++;
  }
  for (const row of db.sql.prepare('SELECT hash,payload FROM oauth_states').all()) {
    const context = 'oauth:' + row.hash;
    db.sql.prepare('UPDATE oauth_states SET payload=? WHERE hash=?').run(newCipher.seal(oldCipher.open(String(row.payload), context), context), row.hash!); count++;
  }
  for (const row of db.sql.prepare('SELECT owner_id,idempotency_key,session_cipher FROM file_uploads WHERE session_cipher IS NOT NULL').all()) {
    const context = 'upload:' + row.owner_id + ':' + row.idempotency_key;
    db.sql.prepare('UPDATE file_uploads SET session_cipher=? WHERE owner_id=? AND idempotency_key=?').run(newCipher.seal(oldCipher.open(String(row.session_cipher), context), context), row.owner_id!, row.idempotency_key!); count++;
  }
  db.sql.exec('COMMIT'); console.log('KEY_ROTATED records=' + count);
} catch { db.sql.exec('ROLLBACK'); throw new Error('KEY_ROTATION_FAILED_NO_CHANGES'); }
finally { db.close(); }
