import { DatabaseSync } from 'node:sqlite';
import { accessSync, chmodSync, constants, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

export interface Patient { id: string; googleSub: string; email: string; displayName: string }
export interface DriveCredentials { accessToken?: string; refreshToken?: string; expiresAt?: number; scope?: string }
export type DriveStatus = 'disconnected' | 'connected' | 'reconnect_required' | 'storage_full' | 'temporary_error';
export interface StoredStudy {
  id: string; ownerUserId: string; providerId: string; sourceStudyKey?: string;
  sha256: string; kind: 'PDF' | 'DICOM_ZIP'; bytes: number; mimeType: string;
  remoteFileId: string; remoteFolderId: string; storageBackend: 'google_drive';
  date: string; title: string; createdAt: string; status: 'stored' | 'remote_missing';
  md5Checksum?: string;
}
export interface OAuthAttempt { purpose: 'login' | 'drive'; nonce: string; verifier: string; ownerId?: string; sessionHash?: string; jobId?: string }
export interface UploadRecord { remoteId: string; session?: string; status: string }

/** AES-GCM binds each ciphertext to its user and purpose, preventing row swapping. */
export class TokenCipher {
  constructor(private readonly key: Buffer) { if (key.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY'); }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }
  open<T>(value: string, context: string): T {
    try {
      const [version, iv, tag, body] = value.split('.');
      if (version !== 'v1' || !iv || !tag || !body) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body, 'base64url')), cipher.final()]).toString('utf8')) as T;
    } catch { throw new Error('CREDENTIALS_UNREADABLE'); }
  }
}

/** Private catalog only: never stores medical document bytes. Node's bundled SQLite needs no native addon. */
export class PortalDatabase {
  readonly sql: DatabaseSync;
  constructor(filename: string, private readonly cipher: TokenCipher) {
    let opened: DatabaseSync | undefined;
    try {
      if (filename !== ':memory:') {
        const directory = path.dirname(filename);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        // SQLite must create WAL/SHM alongside the DB, even when the DB already exists.
        accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK);
      }
      opened = new DatabaseSync(filename);
      if (filename !== ':memory:') chmodSync(filename, 0o600);
    } catch {
      opened?.close();
      throw new Error('DATABASE_STORAGE_UNAVAILABLE: revisar DATABASE_PATH y el volumen persistente; el directorio SQLite, DB, WAL y SHM deben ser escribibles por UID/GID ' +
        (process.getuid?.() ?? 'actual') + '/' + (process.getgid?.() ?? 'actual') + '. No usar tmpfs ni regenerar secretos.');
    }
    this.sql = opened;
    try {
    if (this.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() && Number(this.sql.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0) > 1) {
      throw new Error('DATABASE_SCHEMA_UNSUPPORTED');
    }
    this.sql.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY, binder_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS google_drive_connections(owner_id TEXT PRIMARY KEY REFERENCES users(id), credentials TEXT, status TEXT NOT NULL, folder_id TEXT);
      CREATE TABLE IF NOT EXISTS file_uploads(owner_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, remote_id TEXT NOT NULL,
        session_cipher TEXT, status TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(owner_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS studies(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), sha256 TEXT NOT NULL, remote_id TEXT NOT NULL,
        source_identity TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(owner_id,source_identity,sha256));
      CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);
      CREATE INDEX IF NOT EXISTS studies_owner ON studies(owner_id);
      CREATE INDEX IF NOT EXISTS studies_hash ON studies(owner_id,sha256);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
      COMMIT;`);
    } catch (error) {
      this.sql.close();
      throw error;
    }
  }
  close(): void { this.sql.close(); }
  upsertUser(sub: string, email: string, name = ''): Patient {
    // Stable opaque ID also lets a patient reconstruct their app-created Drive catalog after DB loss.
    const id = createHash('sha256').update('portal-google:' + sub).digest('hex');
    this.sql.prepare('INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,display_name=excluded.display_name').run(id, sub, email, name);
    return { id, googleSub: sub, email, displayName: name };
  }
  user(id: string): Patient | null {
    const row = this.sql.prepare('SELECT * FROM users WHERE id=?').get(id);
    return row ? { id: String(row.id), googleSub: String(row.google_sub), email: String(row.email), displayName: String(row.display_name) } : null;
  }
  createSession(hash: string, userId: string, expiresAt: number): void {
    this.sql.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    this.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash, userId, expiresAt);
  }
  session(hash: string): Patient | null {
    const row = this.sql.prepare('SELECT owner_id FROM sessions WHERE hash=? AND expires_at>?').get(hash, Date.now());
    return row ? this.user(String(row.owner_id)) : null;
  }
  revokeSession(hash: string): void { this.sql.prepare('DELETE FROM sessions WHERE hash=?').run(hash); }
  putOAuth(hash: string, binderHash: string, attempt: OAuthAttempt): void {
    this.sql.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(Date.now());
    this.sql.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').run(hash, binderHash, Date.now() + 600_000, this.cipher.seal(attempt, 'oauth:' + hash));
  }
  takeOAuth(hash: string, binderHash: string): OAuthAttempt | null {
    const row = this.sql.prepare('DELETE FROM oauth_states WHERE hash=? RETURNING *').get(hash);
    if (!row || row.binder_hash !== binderHash || Number(row.expires_at) <= Date.now()) return null;
    return this.cipher.open<OAuthAttempt>(String(row.payload), 'oauth:' + hash);
  }
  connection(userId: string): { status: DriveStatus; folderId?: string } {
    const row = this.sql.prepare('SELECT status,folder_id FROM google_drive_connections WHERE owner_id=?').get(userId);
    return { status: (row?.status as DriveStatus) || 'disconnected', folderId: row?.folder_id ? String(row.folder_id) : undefined };
  }
  credentials(userId: string): DriveCredentials | null {
    const row = this.sql.prepare('SELECT credentials FROM google_drive_connections WHERE owner_id=?').get(userId);
    return row?.credentials ? this.cipher.open<DriveCredentials>(String(row.credentials), 'drive:' + userId) : null;
  }
  saveCredentials(userId: string, credentials: DriveCredentials): void {
    const previous = this.credentials(userId);
    const merged: DriveCredentials = { accessToken: credentials.accessToken || previous?.accessToken, expiresAt: credentials.expiresAt || previous?.expiresAt,
      scope: credentials.scope || previous?.scope, refreshToken: credentials.refreshToken || previous?.refreshToken };
    this.sql.prepare(`INSERT INTO google_drive_connections(owner_id,credentials,status) VALUES(?,?,'connected')
      ON CONFLICT(owner_id) DO UPDATE SET credentials=excluded.credentials,status='connected'`).run(userId, this.cipher.seal(merged, 'drive:' + userId));
  }
  driveStatus(userId: string, status: DriveStatus): void { this.sql.prepare('UPDATE google_drive_connections SET status=? WHERE owner_id=? AND (credentials IS NOT NULL OR ?=\'disconnected\')').run(status, userId, status); }
  folder(userId: string, folderId: string): void { this.sql.prepare('UPDATE google_drive_connections SET folder_id=? WHERE owner_id=?').run(folderId, userId); }
  disconnect(userId: string): void {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.sql.prepare("UPDATE google_drive_connections SET credentials=NULL,status='disconnected' WHERE owner_id=?").run(userId);
      this.sql.prepare('UPDATE file_uploads SET session_cipher=NULL WHERE owner_id=?').run(userId);
      this.sql.exec('COMMIT');
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  upload(userId: string, key: string): UploadRecord | null {
    const row = this.sql.prepare('SELECT * FROM file_uploads WHERE owner_id=? AND idempotency_key=?').get(userId, key);
    return row ? { remoteId: String(row.remote_id), status: String(row.status), session: row.session_cipher ? this.cipher.open<string>(String(row.session_cipher), 'upload:' + userId + ':' + key) : undefined } : null;
  }
  saveUpload(userId: string, key: string, remoteId: string, jobId: string, session?: string): void {
    this.sql.prepare(`INSERT INTO file_uploads VALUES(?,?,?,?,'uploading',?) ON CONFLICT(owner_id,idempotency_key)
      DO UPDATE SET session_cipher=excluded.session_cipher,status='uploading'`).run(userId, key, remoteId, session ? this.cipher.seal(session, 'upload:' + userId + ':' + key) : null, jobId);
  }
  byHash(userId: string, sha256: string): StoredStudy | null {
    const row = this.sql.prepare('SELECT record FROM studies WHERE owner_id=? AND sha256=?').get(userId, sha256);
    return row ? JSON.parse(String(row.record)) as StoredStudy : null;
  }
  study(userId: string, id: string): StoredStudy | null {
    const row = this.sql.prepare('SELECT record FROM studies WHERE owner_id=? AND id=?').get(userId, id);
    return row ? JSON.parse(String(row.record)) as StoredStudy : null;
  }
  list(userId: string): StoredStudy[] {
    return this.sql.prepare('SELECT record FROM studies WHERE owner_id=? ORDER BY rowid DESC').all(userId).map(row => JSON.parse(String(row.record)) as StoredStudy);
  }
  commitStudy(record: Omit<StoredStudy, 'id'> & { id?: string }): StoredStudy {
    const sourceIdentity = createHash('sha256').update(JSON.stringify([record.providerId, record.sourceStudyKey || [record.date, record.title]])).digest('hex');
    const row = this.sql.prepare('SELECT id FROM studies WHERE owner_id=? AND source_identity=? AND sha256=?').get(record.ownerUserId, sourceIdentity, record.sha256);
    const saved: StoredStudy = { ...record, id: row ? String(row.id) : randomUUID() };
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.sql.prepare(`INSERT INTO studies VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,source_identity,sha256)
        DO UPDATE SET remote_id=excluded.remote_id,record=excluded.record`).run(saved.id, saved.ownerUserId, saved.sha256, saved.remoteFileId, sourceIdentity, JSON.stringify(saved));
      this.sql.prepare("UPDATE file_uploads SET status='stored',session_cipher=NULL WHERE owner_id=? AND idempotency_key=?").run(saved.ownerUserId, saved.sha256);
      this.sql.exec('COMMIT'); return saved;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  markMissing(userId: string, id: string): void {
    const value = this.study(userId, id); if (!value) return;
    value.status = 'remote_missing';
    this.sql.prepare('UPDATE studies SET record=? WHERE owner_id=? AND id=?').run(JSON.stringify(value), userId, id);
  }
}
