import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { PortalDatabase, TokenCipher } from '../../src/storage/database.js';
import { GoogleOAuth } from '../../src/server/google-oauth.js';
import { GoogleDriveStorage } from '../../src/storage/google-drive.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { makeDemoPdf } from '../../src/jobs/pdf.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { silentLogger } from '../../src/security/logger.js';
import { waitFor } from '../helpers.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';

function setup() {
  const config = googleTestConfig(), mock = new MockGoogle();
  const cipher = new TokenCipher(Buffer.from(config.google!.encryptionKey, 'base64'));
  const db = new PortalDatabase(config.databasePath, cipher);
  const oauth = new GoogleOAuth(config.google!, mock.fetch);
  const drive = new GoogleDriveStorage(db, oauth, mock.fetch, async () => {});
  const a = db.upsertUser('account-A', 'a@example.test'), b = db.upsertUser('account-B', 'b@example.test');
  for (const user of [a, b]) db.saveCredentials(user.id, { accessToken: 'access-' + user.googleSub, refreshToken: 'refresh-' + user.googleSub, expiresAt: Date.now() + 3600000 });
  return { config, mock, db, drive, oauth, cipher, a, b };
}
const study = { id: 'opaque-study', provider: 'percamb', date: '2026-01-01', sourceKey: 'a'.repeat(64), title: 'Synthetic title not for appProperties' };
async function source(config: ReturnType<typeof googleTestConfig>, bytes = makeDemoPdf(['Synthetic only']), kind: 'PDF' | 'DICOM_ZIP' = 'PDF') {
  const files = new JobFileStore(config.tmpDir, randomUUID()); const saved = await files.save(bytes, kind === 'PDF' ? 'application/pdf' : 'application/zip', kind);
  assert.ok(saved.ok); return { files, file: saved.file };
}
test('Drive: verified private PDF, per-patient deduplication, ownership and original download', async () => {
  const { config, mock, db, drive, a, b } = setup(); const { files, file } = await source(config);
  try {
    const input = { ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal };
    const [one, same] = await Promise.all([drive.upload(input), drive.upload(input)]);
    assert.equal(one.id, same.id); assert.equal(mock.uploadStarts, 1);
    db.driveStatus(a.id, 'temporary_error');
    assert.equal((await drive.upload(input)).remoteFileId, one.remoteFileId);
    assert.equal(db.connection(a.id).status, 'connected');
    const other = await drive.upload({ ...input, ownerUserId: b.id }); assert.notEqual(one.remoteFileId, other.remoteFileId);
    assert.equal(drive.list(a.id).length, 1); assert.equal(drive.list(b.id).length, 1);
    await assert.rejects(drive.getMetadata(b.id, one.id), /FILE_MISSING/);
    const downloaded = await drive.download(a.id, one.id);
    assert.equal(createHash('sha256').update(Buffer.from(await downloaded.response.arrayBuffer())).digest('hex'), file.sha256);
    const remote = mock.files.get(one.remoteFileId)!;
    assert.equal(remote.shared, false); assert.equal(remote.name, '2026-01-01 - Pérez Cambet - Informe.pdf');
    assert.ok(!JSON.stringify(remote.appProperties).includes(study.title)); assert.ok(mock.calls.every(call => !/permissions/.test(call.url)));
    assert.equal(await drive.open(a.id, one.id), 'https://drive.google.com/file/d/' + one.remoteFileId + '/view');
  } finally { await files.cleanup(); db.close(); }
});
test('Drive: bounded original ZIP chunks recover a lost response without resending accepted bytes', async () => {
  const { config, mock, db, drive, a } = setup(); const zip = Buffer.alloc(9 * 1024 * 1024, 23); zip.writeUInt32LE(0x04034b50);
  const { files, file } = await source(config, zip, 'DICOM_ZIP');
  try {
    mock.loseResponseOnce = true;
    const saved = await drive.upload({ ownerUserId: a.id, jobId: randomUUID(), file, study: { ...study, provider: 'centrodm' }, signal: new AbortController().signal });
    assert.equal(saved.kind, 'DICOM_ZIP'); assert.equal(mock.maxChunk, 8 * 1024 * 1024);
    assert.equal(mock.calls.filter(call => call.chunkBytes > 0).length, 2);
    assert.deepEqual(mock.files.get(saved.remoteFileId)!.content, zip); assert.equal(saved.sha256, file.sha256);
  } finally { await files.cleanup(); db.close(); }
});

test('readable Drive names disambiguate different originals, preserve retry identity and never rename legacy files', async () => {
  const { config, mock, db, drive, a } = setup();
  const first = await source(config, makeDemoPdf(['first synthetic original']));
  const second = await source(config, makeDemoPdf(['second synthetic original']));
  const input = { ownerUserId: a.id, jobId: randomUUID(), file: first.file, study, signal: new AbortController().signal };
  let closed = false;
  try {
    const one = await drive.upload(input);
    const two = await drive.upload({ ...input, file: second.file, study: { ...study, sourceKey: 'b'.repeat(64) } });
    assert.equal(mock.files.get(one.remoteFileId)!.name, '2026-01-01 - Pérez Cambet - Informe.pdf');
    assert.equal(mock.files.get(two.remoteFileId)!.name, `2026-01-01 - Pérez Cambet - Informe - ${second.file.sha256.slice(0, 8)}.pdf`);
    assert.notEqual(one.remoteFileId, two.remoteFileId); assert.equal(mock.uploadStarts, 2);
    const originalId = one.id;
    mock.files.get(one.remoteFileId)!.name = 'estudio-legacy-opaque.pdf';
    const retry = await drive.upload({ ...input, study: { ...study, title: 'Panorámica dental' } });
    assert.equal(retry.id, originalId); assert.equal(retry.remoteFileId, one.remoteFileId);
    assert.equal(mock.files.get(one.remoteFileId)!.name, 'estudio-legacy-opaque.pdf');
    assert.equal(mock.uploadStarts, 2); assert.equal(mock.calls.filter(call => call.method === 'PATCH').length, 0);
    db.close(); closed = true;
    const restarted = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.alloc(32, 7)));
    try { assert.equal(restarted.byHash(a.id, first.file.sha256)!.remoteFileId, one.remoteFileId); }
    finally { restarted.close(); }
  } finally { await first.files.cleanup(); await second.files.cleanup(); if (!closed) db.close(); }
});

test('parallel originals reserve names per account, short-suffix collisions extend safely, and sync uses IDs', async () => {
  const { config, mock, db, oauth, a, b } = setup();
  mock.files.set('shared-private-folder', { id: 'shared-private-folder', account: 'account-A', mimeType: 'application/vnd.google-apps.folder',
    shared: false, appProperties: { pp_app: 'portal-pacientes-v1', pp_owner: a.id }, name: 'Portal Pacientes' });
  db.folder(a.id, 'shared-private-folder');
  let namingQueries = 0, release!: () => void;
  const firstQuery = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async (url, init) => {
    if ((new URL(String(url)).searchParams.get('q') || '').includes('name=')) {
      if (++namingQueries === 1) await firstQuery;
      else release();
    }
    return mock.fetch(url, init);
  };
  const drive = new GoogleDriveStorage(db, oauth, transport, async () => {});
  const sources = await Promise.all([source(config, makeDemoPdf(['one'])), source(config, makeDemoPdf(['two'])), source(config, makeDemoPdf(['three']))]);
  const input = { ownerUserId: a.id, jobId: randomUUID(), study, signal: new AbortController().signal };
  try {
    const [one, two] = await Promise.all(sources.slice(0, 2).map((value, index) => drive.upload({ ...input, file: value.file, study: { ...study, sourceKey: String(index).repeat(64) } })));
    assert.notEqual(mock.files.get(one.remoteFileId)!.name, mock.files.get(two.remoteFileId)!.name);
    const folder = mock.files.get(one.remoteFileId)!.parents![0];
    mock.files.set('occupied-short-suffix', { id: 'occupied-short-suffix', account: 'account-A', mimeType: 'application/pdf', parents: [folder], name: `2026-01-01 - Pérez Cambet - Informe - ${sources[2].file.sha256.slice(0, 8)}.pdf` });
    const three = await drive.upload({ ...input, file: sources[2].file, study: { ...study, sourceKey: 'c'.repeat(64) } });
    assert.equal(mock.files.get(three.remoteFileId)!.name, `2026-01-01 - Pérez Cambet - Informe - ${sources[2].file.sha256.slice(0, 12)}.pdf`);
    const other = await drive.upload({ ...input, ownerUserId: b.id, file: sources[2].file });
    assert.equal(mock.files.get(other.remoteFileId)!.name, '2026-01-01 - Pérez Cambet - Informe.pdf');
    await drive.reconcile(a.id);
    assert.equal(drive.list(a.id).length, 3); assert.equal(drive.list(b.id).length, 1);
    assert.equal(drive.list(a.id).find(item => item.id === three.id)!.sha256, sources[2].file.sha256);
  } finally { await Promise.all(sources.map(value => value.files.cleanup())); db.close(); }
});

test('filename collisions remain safe after restart when Drive search has not indexed the first original', async () => {
  const { config, mock, db, drive, oauth, a } = setup();
  const first = await source(config, makeDemoPdf(['before restart'])), second = await source(config, makeDemoPdf(['after restart']));
  const input = { ownerUserId: a.id, jobId: randomUUID(), study, signal: new AbortController().signal };
  let closed = false;
  try {
    const one = await drive.upload({ ...input, file: first.file, study: { ...study, studyDate: 'unrecognized', date: '2026-01-01' } });
    db.close(); closed = true;
    const restarted = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.alloc(32, 7)));
    try {
      const delayedSearch: typeof fetch = (url, init) => (new URL(String(url)).searchParams.get('q') || '').includes('name=')
        ? Promise.resolve(Response.json({ files: [] })) : mock.fetch(url, init);
      const again = new GoogleDriveStorage(restarted, oauth, delayedSearch, async () => {});
      const two = await again.upload({ ...input, file: second.file, study: { ...study, sourceKey: 'f'.repeat(64) } });
      assert.notEqual(mock.files.get(one.remoteFileId)!.name, mock.files.get(two.remoteFileId)!.name);
      assert.match(mock.files.get(two.remoteFileId)!.name!, new RegExp(second.file.sha256.slice(0, 8) + '\\.pdf$'));
      assert.equal(again.list(a.id).length, 2);
    } finally { restarted.close(); }
  } finally { await first.files.cleanup(); await second.files.cleanup(); if (!closed) db.close(); }
});
test('Drive: encrypted interrupted resumable session is reused on controlled retry', async () => {
  const { config, mock, db, drive, a } = setup(); const { files, file } = await source(config);
  const input = { ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal };
  try {
    mock.failTransfers = true; await assert.rejects(drive.upload(input), /DRIVE_UPLOAD_FAILED/);
    assert.equal(db.list(a.id).length, 0); assert.equal(existsSync(file.path), true);
    const row = db.sql.prepare('SELECT session_cipher FROM file_uploads WHERE owner_id=?').get(a.id)!;
    assert.ok(!String(row.session_cipher).includes('googleapis'));
    mock.failTransfers = false; await drive.upload(input); assert.equal(mock.uploadStarts, 1); assert.equal(db.list(a.id).length, 1);
  } finally { await files.cleanup(); db.close(); }
});
test('Drive: quota, remote verification and changed local hash never create a stored entry', async () => {
  for (const failure of ['quota', 'metadata', 'local']) {
    const { config, mock, db, drive, a } = setup(); const { files, file } = await source(config);
    try {
      if (failure === 'quota') mock.quota = true;
      if (failure === 'metadata') mock.metadataMismatch = true;
      if (failure === 'local') await writeFile(file.path, Buffer.alloc(file.bytes));
      await assert.rejects(drive.upload({ ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal }), failure === 'quota' ? /DRIVE_STORAGE_FULL/ : failure === 'local' ? /ARTIFACT_INTEGRITY_FAILED/ : /DRIVE_UPLOAD_FAILED/);
      assert.equal(db.list(a.id).length, 0); assert.equal(existsSync(file.path), true);
    } finally { await files.cleanup(); db.close(); }
  }
});
test('Drive: refresh retains the old refresh token; invalid_grant stops retries; disconnect preserves originals', async () => {
  const { config, mock, db, drive, a } = setup(); const { files, file } = await source(config);
  try {
    const saved = await drive.upload({ ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal });
    db.saveCredentials(a.id, { expiresAt: 1 }); await drive.getMetadata(a.id, saved.id);
    assert.equal(db.credentials(a.id)!.refreshToken, 'refresh-account-A'); assert.equal(mock.refreshCount, 1);
    db.saveCredentials(a.id, { expiresAt: 1 }); mock.invalidGrant = true;
    await assert.rejects(drive.getMetadata(a.id, saved.id), /DRIVE_TOKEN_EXPIRED/);
    assert.equal(db.connection(a.id).status, 'reconnect_required'); assert.equal(mock.refreshCount, 2);
    await assert.rejects(drive.getMetadata(a.id, saved.id), /DRIVE_TOKEN_EXPIRED/); assert.equal(mock.refreshCount, 2);
    drive.forgetAuthorization(a.id); db.disconnect(a.id);
    assert.equal(db.credentials(a.id), null); assert.equal(mock.files.get(saved.remoteFileId)!.trashed, undefined); assert.equal(db.list(a.id).length, 1);
  } finally { await files.cleanup(); db.close(); }
});
test('Drive: catalog reconstruction, missing-file handling and SQLite restart preserve ownership and sessions', async () => {
  const { config, mock, db, drive, a, cipher, oauth } = setup(); const { files, file } = await source(config);
  let closed = false;
  try {
    const saved = await drive.upload({ ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal });
    db.createSession('synthetic-session-hash', a.id, Date.now() + 50000);
    const recovered = new PortalDatabase(':memory:', cipher); const user = recovered.upsertUser(a.googleSub, a.email);
    recovered.saveCredentials(user.id, { accessToken: 'access-account-A', expiresAt: Date.now() + 3600000 });
    const storage = new GoogleDriveStorage(recovered, oauth, mock.fetch, async () => {});
    await storage.reconcile(user.id); assert.equal(recovered.list(user.id).length, 1); assert.equal(user.id, a.id); assert.equal(recovered.list(user.id)[0].title, ''); recovered.close();
    await drive.trash(a.id, saved.id); await drive.reconcile(a.id); assert.equal(db.list(a.id)[0].status, 'remote_missing');
    db.setHidden(a.id, saved.id, true);
    db.close(); closed = true;
    const restarted = new PortalDatabase(config.databasePath, cipher);
    assert.equal(restarted.session('synthetic-session-hash')!.id, a.id); assert.equal(restarted.list(a.id)[0].status, 'remote_missing');
    assert.equal(restarted.list(a.id)[0].hidden, true); restarted.close();
  } finally { await files.cleanup(); if (!closed) db.close(); }
});

test('Drive lifecycle: hidden preferences survive sync, restore, safe reimport and retries without crossing accounts', async () => {
  const { config, mock, db, drive, a, b, oauth } = setup(); const { files, file } = await source(config);
  try {
    const input = { ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal };
    const saved = await drive.upload(input);
    assert.equal(db.setHidden(b.id, saved.id, true), null);
    assert.equal(db.setHidden(a.id, saved.id, true)!.hidden, true);
    await drive.reconcile(a.id); assert.equal(db.study(a.id, saved.id)!.hidden, true);
    await drive.trash(a.id, saved.id);
    mock.files.get(saved.remoteFileId)!.trashed = false;
    const delayedIndex = new GoogleDriveStorage(db, oauth, async (url, init) => {
      if (new URL(String(url)).pathname === '/drive/v3/files') return new Response(JSON.stringify({ files: [] }), { status: 200 });
      return mock.fetch(url, init);
    }, async () => {});
    await delayedIndex.reconcile(a.id);
    assert.equal(db.study(a.id, saved.id)!.status, 'stored');
    assert.equal(db.study(a.id, saved.id)!.hidden, true);
    assert.equal((await drive.upload(input)).remoteFileId, saved.remoteFileId);
    assert.equal(mock.uploadStarts, 1);
    await drive.trash(a.id, saved.id);
    const offline = new GoogleDriveStorage(db, oauth, async () => new Response('{}', { status: 503 }), async () => {});
    await assert.rejects(offline.upload(input)); assert.equal(mock.uploadStarts, 1);
    mock.failTransfers = true;
    await assert.rejects(drive.upload(input));
    const newId = db.upload(a.id, file.sha256)!.remoteId;
    assert.notEqual(newId, saved.remoteFileId);
    mock.failTransfers = false;
    const [replacement, duplicate] = await Promise.all([drive.upload(input), drive.upload(input)]);
    assert.equal(replacement.id, saved.id); assert.equal(replacement.remoteFileId, newId);
    assert.equal(duplicate.remoteFileId, newId); assert.equal(replacement.sha256, saved.sha256);
    assert.equal(replacement.hidden, true); assert.equal(mock.uploadStarts, 2);
    assert.equal(db.wasReplaced(a.id, saved.remoteFileId), true);
    assert.equal(db.wasReplaced(b.id, saved.remoteFileId), false);
    // A later restoration of the older generation never replaces the current original.
    mock.files.get(saved.remoteFileId)!.trashed = false;
    await drive.reconcile(a.id); assert.equal(db.study(a.id, saved.id)!.remoteFileId, newId);
    assert.equal(db.list(a.id).length, 1); assert.equal(db.list(b.id).length, 0);
    assert.equal(db.setHidden(a.id, saved.id, false)!.hidden, false);
    await assert.rejects(offline.reconcile(a.id)); assert.equal(db.study(a.id, saved.id)!.status, 'stored');
  } finally { await files.cleanup(); db.close(); }
});
test('AES-GCM rejects another patient context or wrong key and never stores a plaintext token', () => {
  const cipher = new TokenCipher(Buffer.alloc(32, 4)); const encrypted = cipher.seal({ refreshToken: 'never-plaintext' }, 'drive:A');
  assert.ok(!encrypted.includes('never-plaintext')); assert.throws(() => cipher.open(encrypted, 'drive:B'), /CREDENTIALS_UNREADABLE/);
  assert.throws(() => new TokenCipher(Buffer.alloc(32, 5)).open(encrypted, 'drive:A'), /CREDENTIALS_UNREADABLE/);
});

test('SQLite additive preference extension opens an existing v1 catalog without changing credentials or originals', () => {
  const { config, db, cipher, a } = setup();
  const original = db.commitStudy({ ownerUserId: a.id, providerId: 'percamb', sha256: 'a'.repeat(64), kind: 'PDF', bytes: 40, mimeType: 'application/pdf',
    remoteFileId: 'synthetic-original', remoteFolderId: 'synthetic-folder', storageBackend: 'google_drive', date: '', title: '', createdAt: '', status: 'stored' });
  const encrypted = db.sql.prepare('SELECT credentials FROM google_drive_connections WHERE owner_id=?').get(a.id)!.credentials;
  // Synthetic old schema: the previous release has neither additive table.
  db.sql.exec('DROP TABLE study_preferences; DROP TABLE study_originals;'); db.close();
  const reopened = new PortalDatabase(config.databasePath, cipher);
  try {
    assert.equal(reopened.study(a.id, original.id)!.remoteFileId, original.remoteFileId);
    assert.equal(reopened.sql.prepare('SELECT credentials FROM google_drive_connections WHERE owner_id=?').get(a.id)!.credentials, encrypted);
    assert.equal(reopened.setHidden(a.id, original.id, true)!.hidden, true);
    assert.equal(reopened.sql.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v, 1);
  } finally { reopened.close(); }
});

test('Drive: identical originals keep distinct study references; modified remote bytes become unavailable', async () => {
  const { config, mock, db, drive, a } = setup(); const { files, file } = await source(config);
  try {
    const input = { ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal };
    const first = await drive.upload(input);
    const second = await drive.upload({ ...input, study: { ...study, sourceKey: 'b'.repeat(64), date: '2026-02-01' } });
    assert.notEqual(first.id, second.id); assert.equal(first.remoteFileId, second.remoteFileId); assert.equal(mock.uploadStarts, 1); assert.equal(db.list(a.id).length, 2);
    mock.files.get(first.remoteFileId)!.md5Checksum = '0'.repeat(32);
    await assert.rejects(drive.getMetadata(a.id, first.id), /FILE_MISSING/);
    await drive.reconcile(a.id); assert.ok(db.list(a.id).every(value => value.status === 'remote_missing'));
  } finally { await files.cleanup(); db.close(); }
});

test('Drive: expired upload sessions restart with the reserved ID, while 429/5xx and empty paginated listings recover', async () => {
  const { config, mock, db, drive, oauth, a } = setup(); const { files, file } = await source(config);
  try {
    const input = { ownerUserId: a.id, jobId: randomUUID(), file, study, signal: new AbortController().signal };
    mock.failTransfers = true; await assert.rejects(drive.upload(input));
    const reserved = db.upload(a.id, file.sha256)!.remoteId; mock.sessions.clear(); mock.failTransfers = false;
    const saved = await drive.upload(input); assert.equal(saved.remoteFileId, reserved); assert.equal(mock.uploadStarts, 2);
    let calls = 0; const pauses: number[] = [];
    const transport: typeof fetch = async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/drive/v3/files' && target.searchParams.has('q')) {
        assert.ok(target.searchParams.get('q')!.includes('appProperties'));
        calls++;
        if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
        if (calls === 2) return new Response('{}', { status: 503 });
        if (!target.searchParams.has('pageToken')) return Response.json({ files: [], nextPageToken: 'second-page' });
        const { content: _bytes, account: _account, ...record } = mock.files.get(saved.remoteFileId)!;
        return Response.json({ files: [record] });
      }
      return mock.fetch(url, init);
    };
    const retrying = new GoogleDriveStorage(db, oauth, transport, async ms => { pauses.push(ms); });
    await retrying.reconcile(a.id); assert.equal(calls, 4); assert.equal(pauses.length, 2); assert.equal(db.list(a.id)[0].status, 'stored');
  } finally { await files.cleanup(); db.close(); }
});
test('Cloud jobs only complete after verified upload and catalog commit; retry does not duplicate PDF or ZIP', async () => {
  const { config, mock, db, drive, a } = setup();
  const manager = new JobManager({ config, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ stepMs: 1, loginDelayMs: 1 }), log: silentLogger, storage: drive });
  const commit = db.commitStudy.bind(db); let rejectCommit = true;
  db.commitStudy = record => { if (rejectCommit) throw new Error('synthetic catalog failure'); return commit(record); };
  try {
    for (const provider of ['percamb', 'centrodm']) {
      const job = manager.create(provider, a.id); await waitFor(() => job.state === 'WAITING_SELECTION'); manager.select(job.id, [job.studies[0].id]);
      if (rejectCommit) {
        await waitFor(() => !!job.storageError); assert.equal(job.state, 'IMPORTING'); assert.ok(manager.file(job.id, job.files[0].id));
        await assert.rejects(manager.acknowledgePortalImport(job.id, job.files[0].id, job.files[0].studyId, true), /SERVER_PERSISTENCE_REQUIRED/);
        rejectCommit = false; await manager.retryStorage(job.id);
      }
      await waitFor(() => job.state === 'COMPLETED'); assert.ok(job.files[0].storedStudyId); assert.equal(job.files[0].storageBackend, 'google_drive');
      const types = job.eventsSince(0).map(event => event.type); assert.ok(types.indexOf('storage_stored') < types.indexOf('completed'));
      await waitFor(() => manager.activeCount() === 0);
    }
    assert.equal(mock.uploadStarts, 2); assert.equal(db.list(a.id).length, 2); assert.ok(db.list(a.id).some(file => file.kind === 'DICOM_ZIP'));
  } finally { await manager.shutdown(); db.close(); }
});
