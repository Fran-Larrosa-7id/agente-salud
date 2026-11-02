import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { PortalDatabase, TokenCipher } from '../../src/storage/database.js';
import { GoogleDriveStorage } from '../../src/storage/google-drive.js';
import { GoogleOAuth } from '../../src/server/google-oauth.js';
import { DRIVE_APP, FOLDER_MIME, INSTITUTION_FOLDERS, isAppFolder, MOVE_CONFIRMATION } from '../../src/storage/drive-organization.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { makeDemoPdf } from '../../src/jobs/pdf.js';
import { googleTestConfig, MockGoogle } from '../google-helpers.js';

function setup() {
  const config = googleTestConfig(), mock = new MockGoogle(), cipher = new TokenCipher(Buffer.alloc(32, 7));
  const db = new PortalDatabase(config.databasePath, cipher), oauth = new GoogleOAuth(config.google!, mock.fetch);
  const a = db.upsertUser('account-A', 'a@example.test'), b = db.upsertUser('account-B', 'b@example.test');
  for (const user of [a, b]) db.saveCredentials(user.id, { accessToken: 'access-' + user.googleSub, expiresAt: Date.now() + 3600_000 });
  const drive = new GoogleDriveStorage(db, oauth, mock.fetch, async () => {});
  return { config, mock, cipher, db, oauth, drive, a, b };
}
type Fixture = ReturnType<typeof setup>;
function legacy(f: Fixture, count = 3) {
  const root = 'legacy-root';
  f.mock.files.set(root, { id: root, name: 'Portal Pacientes', account: 'account-A', mimeType: FOLDER_MIME,
    parents: ['my-drive'], appProperties: { pp_app: DRIVE_APP, pp_owner: f.a.id } });
  f.db.folder(f.a.id, root);
  for (let i = 1; i <= count; i++) {
    const content = Buffer.from('PK\x03\x04 synthetic zip ' + i), sha = createHash('sha256').update(content).digest('hex');
    const md5 = createHash('md5').update(content).digest('hex'), id = 'legacy-zip-' + i;
    f.mock.files.set(id, { id, name: '2026-10-20 - Centro DM - Imágenes DICOM' + (i > 1 ? ' - ' + sha.slice(0, 8) : '') + '.zip',
      account: 'account-A', mimeType: 'application/zip', parents: [root], size: String(content.length), md5Checksum: md5, content,
      appProperties: { pp_app: DRIVE_APP, pp_owner: f.a.id, pp_provider: 'centrodm', pp_kind: 'DICOM_ZIP', pp_sha256: sha, pp_md5: md5, pp_source: String(i).repeat(64) } });
    f.db.commitStudy({ ownerUserId: f.a.id, providerId: 'centrodm', sourceStudyKey: String(i).repeat(64), sha256: sha,
      kind: 'DICOM_ZIP', bytes: content.length, mimeType: 'application/zip', md5Checksum: md5, remoteFileId: id,
      remoteFolderId: root, storageBackend: 'google_drive', date: '2026-10-20', title: 'Synthetic study', createdAt: '', status: 'stored' });
  }
  return root;
}
async function input(f: Fixture, provider = 'centrodm', text: string = randomUUID(), kind: 'PDF' | 'DICOM_ZIP' = 'PDF') {
  const files = new JobFileStore(f.config.tmpDir, randomUUID());
  const result = await files.save(kind === 'PDF' ? makeDemoPdf([text]) : Buffer.from('PK\x03\x04' + text), kind === 'PDF' ? 'application/pdf' : 'application/zip', kind);
  assert.ok(result.ok);
  return { files, value: { ownerUserId: f.a.id, jobId: randomUUID(), file: result.file,
    study: { id: randomUUID(), provider, date: '2026-10-20', sourceKey: createHash('sha256').update(text).digest('hex') }, signal: new AbortController().signal } };
}
const folders = (mock: MockGoogle) => [...mock.files.values()].filter(file => file.mimeType === FOLDER_MIME);
const moves = (mock: MockGoogle) => mock.calls.filter(call => new URL(call.url).searchParams.has('addParents'));

test('folder policy distinguishes legacy root, institution, real owner and actual parent', () => {
  const root = { id: 'root', name: 'Portal Pacientes', mimeType: FOLDER_MIME, ownedByMe: true, appProperties: { pp_app: DRIVE_APP, pp_owner: 'A' } };
  assert.equal(isAppFolder(root, 'A'), true);
  assert.equal(isAppFolder({ ...root, ownedByMe: false }, 'A'), false);
  assert.equal(isAppFolder(root, 'B'), false);
  const child = { ...root, id: 'child', parents: ['root'], appProperties: { ...root.appProperties, pp_role: 'institution', pp_provider: 'centrodm', pp_parent: 'root' } };
  assert.equal(isAppFolder(child, 'A'), false);
  assert.equal(isAppFolder(child, 'A', 'centrodm', 'root'), true);
  assert.equal(isAppFolder({ ...child, parents: ['elsewhere'] }, 'A', 'centrodm', 'root'), false);
  assert.equal(isAppFolder({ ...child, trashed: true }, 'A', 'centrodm', 'root'), false);
});

test('new PDF/ZIP uploads lazily reuse fixed institution names and retain readable filenames', async () => {
  const f = setup(), sources: Awaited<ReturnType<typeof input>>[] = [];
  try {
    assert.equal(folders(f.mock).length, 0);
    for (const [provider, label] of Object.entries(INSTITUTION_FOLDERS)) for (const kind of ['PDF', 'DICOM_ZIP'] as const) {
      const source = await input(f, provider, provider + kind, kind); sources.push(source);
      const saved = await f.drive.upload(source.value), remote = f.mock.files.get(saved.remoteFileId)!;
      const folder = f.mock.files.get(saved.remoteFolderId)!;
      assert.equal(folder.name, label); assert.equal(folder.appProperties?.pp_provider, provider);
      assert.equal(folder.appProperties?.pp_role, 'institution');
      assert.deepEqual(folder.parents, [f.db.connection(f.a.id).folderId]);
      assert.equal(folder.appProperties?.pp_parent, folder.parents![0]);
      assert.equal(remote.name, `2026-10-20 - ${label} - ${kind === 'PDF' ? 'Informe.pdf' : 'Imágenes DICOM.zip'}`);
      assert.deepEqual(remote.parents, [folder.id]);
    }
    assert.equal(folders(f.mock).length, 4);
    const invalid = await input(f, '__proto__'); sources.push(invalid);
    await assert.rejects(f.drive.upload(invalid.value), /DRIVE_PROVIDER_INVALID/);
    assert.equal(folders(f.mock).length, 4);
  } finally { await Promise.all(sources.map(s => s.files.cleanup())); f.db.close(); }
});

test('parallel workers sharing SQLite reserve one root and one provider folder across separate connections', async () => {
  const f = setup(), second = new PortalDatabase(f.config.databasePath, f.cipher);
  const other = new GoogleDriveStorage(second, f.oauth, f.mock.fetch, async () => {});
  const sources = await Promise.all(Array.from({ length: 6 }, (_, i) => input(f, 'percamb', 'parallel-' + i)));
  try {
    const saved = await Promise.all(sources.map((s, i) => (i % 2 ? other : f.drive).upload(s.value)));
    assert.equal(new Set(saved.map(file => file.remoteFolderId)).size, 1);
    assert.equal(folders(f.mock).length, 2);
    assert.equal(new Set(folders(f.mock).map(file => file.id)).size, 2);
    assert.equal(f.mock.uploadStarts, 6);
  } finally { await Promise.all(sources.map(s => s.files.cleanup())); second.close(); f.db.close(); }
});

for (const role of ['root', 'institution']) test('folder creation response loss persists reserved ID across restart: ' + role, async () => {
  const f = setup(), source = await input(f); let failedId = '';
  const transport: typeof fetch = async (url, init) => {
    if (new URL(String(url)).pathname === '/drive/v3/files' && init?.method === 'POST') {
      const metadata = JSON.parse(String(init.body));
      if (metadata.appProperties.pp_role === role) {
        failedId = metadata.id; await f.mock.fetch(url, init); throw new Error('synthetic lost folder response');
      }
    }
    return f.mock.fetch(url, init);
  };
  const unreliable = new GoogleDriveStorage(f.db, f.oauth, transport, async () => {});
  try {
    await assert.rejects(unreliable.upload(source.value)); assert.ok(failedId);
    f.db.close();
    const reopened = new PortalDatabase(f.config.databasePath, f.cipher);
    try {
      const delayed: typeof fetch = (url, init) => new URL(String(url)).searchParams.get('q')?.includes("mimeType='application/vnd.google-apps.folder'")
        ? Promise.resolve(Response.json({ files: [] })) : f.mock.fetch(url, init);
      const drive = new GoogleDriveStorage(reopened, f.oauth, delayed, async () => {});
      const saved = await drive.upload(source.value);
      assert.equal(folders(f.mock).length, 2); assert.ok(folders(f.mock).some(folder => folder.id === failedId));
      assert.equal(saved.remoteFolderId, folders(f.mock).find(folder => folder.appProperties?.pp_role === 'institution')!.id);
    } finally { reopened.close(); }
  } finally { await source.files.cleanup(); }
});

test('legacy root without role is retained even with a wrong cached institution and a subfolder first in search', async () => {
  const f = setup(); const root = legacy(f, 0), props = { pp_app: DRIVE_APP, pp_owner: f.a.id };
  f.mock.files.set('aaa-child', { id: 'aaa-child', name: 'Portal Pacientes', account: 'account-A', mimeType: FOLDER_MIME, parents: [root],
    appProperties: { ...props, pp_role: 'institution', pp_provider: 'centrodm', pp_parent: root } });
  f.db.folder(f.a.id, 'aaa-child');
  const source = await input(f);
  try {
    const saved = await f.drive.upload(source.value);
    assert.equal(saved.remoteFolderId, 'aaa-child'); assert.equal(f.db.connection(f.a.id).folderId, root);
    assert.equal(f.mock.files.get(root)!.appProperties?.pp_role, undefined);
    assert.equal(folders(f.mock).length, 2);
  } finally { await source.files.cleanup(); f.db.close(); }
});

test('legacy deduplication never creates folders or moves/renames an existing original', async () => {
  const f = setup(), source = await input(f, 'centrodm', 'identical');
  try {
    const saved = await f.drive.upload(source.value), root = f.db.connection(f.a.id).folderId!;
    f.mock.files.get(saved.remoteFileId)!.parents = [root]; f.db.updateRemoteFolder(f.a.id, saved.remoteFileId, root);
    f.mock.files.get(saved.remoteFileId)!.name = 'legacy.zip';
    f.mock.calls.length = 0;
    const reused = await f.drive.upload(source.value);
    assert.equal(reused.remoteFileId, saved.remoteFileId); assert.equal(reused.remoteFolderId, root);
    assert.equal(f.mock.files.get(saved.remoteFileId)!.name, 'legacy.zip');
    assert.ok(f.mock.calls.every(call => call.method === 'GET')); assert.equal(f.mock.uploadStarts, 1);
  } finally { await source.files.cleanup(); f.db.close(); }
});

test('dry-run creates no remote folders/moves and excludes foreign, invalid, trashed and already-organized files', async () => {
  const f = setup(); const root = legacy(f);
  const prototype = f.mock.files.get('legacy-zip-1')!;
  const variants = [
    { id: 'foreign-app', appProperties: { ...prototype.appProperties!, pp_app: 'different' } },
    { id: 'foreign-owner', appProperties: { ...prototype.appProperties!, pp_owner: f.b.id } },
    { id: 'not-owned', ownedByMe: false }, { id: 'shared', shared: true }, { id: 'trash', trashed: true },
    { id: 'unknown-provider', appProperties: { ...prototype.appProperties!, pp_provider: 'HTML lab name' } },
    { id: 'modified-md5', md5Checksum: 'f'.repeat(32) }, { id: 'elsewhere', parents: ['outside'] },
  ];
  for (const variant of variants) f.mock.files.set(variant.id, { ...prototype, ...variant });
  try {
    const preview = await f.drive.organizationDryRun(f.a.id);
    assert.equal(preview.files.length, 3); assert.equal(preview.rootId, root);
    assert.ok(preview.files.every(file => file.destination === 'Portal Pacientes/Centro DM'));
    assert.ok(f.mock.calls.every(call => call.method === 'GET')); assert.equal(folders(f.mock).length, 1);
    assert.equal(f.mock.calls.some(call => call.url.includes('alt=media')), false);
    await assert.rejects(f.drive.executeOrganization(f.a.id, preview.planId, ''), /CONFIRMATION_REQUIRED/);
    await assert.rejects(f.drive.executeOrganization(f.b.id, preview.planId, MOVE_CONFIRMATION), /DRIVE_MOVE_PLAN_INVALID/);
    assert.equal(moves(f.mock).length, 0);
  } finally { f.db.close(); }
});

test('three legacy ZIPs migrate once without byte transfers; aliases, checkpoints, IDs, names and hashes survive', async () => {
  const f = setup(); legacy(f);
  const one = f.db.list(f.a.id).find(file => file.remoteFileId === 'legacy-zip-1')!;
  const alias = f.db.commitStudy({ ...one, sourceStudyKey: 'd'.repeat(64) }); f.db.setHidden(f.a.id, alias.id, true);
  f.db.saveUpload(f.a.id, one.sha256, one.remoteFileId, randomUUID(), 'https://www.googleapis.com/upload/drive/v3/files?upload_id=pending');
  const originals = [...f.mock.files.values()].filter(file => file.size).map(file => ({ id: file.id, name: file.name, props: JSON.stringify(file.appProperties), bytes: Buffer.from(file.content!) }));
  try {
    const plan = await f.drive.organizationDryRun(f.a.id);
    const result = await f.drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
    assert.deepEqual(result.results.map(item => item.status), ['moved', 'moved', 'moved']);
    const target = folders(f.mock).find(file => file.appProperties?.pp_provider === 'centrodm')!.id;
    assert.ok(f.db.list(f.a.id).every(file => file.remoteFolderId === target));
    assert.equal(f.db.study(f.a.id, alias.id)!.hidden, true); assert.ok(f.db.upload(f.a.id, one.sha256)!.session);
    for (const original of originals) {
      const file = f.mock.files.get(original.id)!;
      assert.equal(file.name, original.name); assert.equal(JSON.stringify(file.appProperties), original.props);
      assert.deepEqual(file.content, original.bytes); assert.deepEqual(file.parents, [target]);
    }
    assert.ok((await f.drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION)).results.every(item => item.status === 'already_organized'));
    assert.equal(moves(f.mock).length, 3); assert.equal(f.mock.uploadStarts, 0);
    assert.ok(f.mock.calls.every(call => !call.url.includes('alt=media') && !new URL(call.url).pathname.startsWith('/upload/')));
    assert.equal((await f.drive.organizationDryRun(f.a.id)).files.length, 0);
    await f.drive.reconcile(f.a.id); assert.equal(f.db.list(f.a.id).length, 4);
    assert.equal(f.db.list(f.b.id).length, 0);
  } finally { f.db.close(); }
});

test('partial migration retries the reviewed plan after SQLite restart and never repeats successful moves', async () => {
  const f = setup(); legacy(f);
  const plan = await f.drive.organizationDryRun(f.a.id);
  const transport: typeof fetch = (url, init) => init?.method === 'PATCH' && new URL(String(url)).pathname.endsWith('/legacy-zip-2')
    ? Promise.resolve(Response.json({}, { status: 503 })) : f.mock.fetch(url, init);
  const failing = new GoogleDriveStorage(f.db, f.oauth, transport, async () => {});
  const result = await failing.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
  assert.deepEqual(result.results.map(item => item.status), ['moved', 'error', 'moved']);
  f.db.close(); const reopened = new PortalDatabase(f.config.databasePath, f.cipher);
  try {
    const drive = new GoogleDriveStorage(reopened, f.oauth, f.mock.fetch, async () => {});
    const retry = await drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
    assert.deepEqual(retry.results.map(item => item.status), ['already_organized', 'moved', 'already_organized']);
    assert.equal(moves(f.mock).length, 3); assert.equal(folders(f.mock).length, 2);
    assert.ok(reopened.list(f.a.id).every(file => file.remoteFolderId !== 'legacy-root'));
  } finally { reopened.close(); }
});

for (const failure of ['response', 'catalog']) test('migration recovers applied move after lost ' + failure, async () => {
  const f = setup(); legacy(f, 1); const plan = await f.drive.organizationDryRun(f.a.id);
  let once = true;
  const transport: typeof fetch = async (url, init) => {
    const response = await f.mock.fetch(url, init);
    if (failure === 'response' && init?.method === 'PATCH' && once) { once = false; throw new Error('lost response'); }
    return response;
  };
  const originalUpdate = f.db.updateRemoteFolder.bind(f.db);
  f.db.updateRemoteFolder = (...args) => { if (failure === 'catalog' && once) { once = false; throw new Error('SQLite failure'); } originalUpdate(...args); };
  const drive = new GoogleDriveStorage(f.db, f.oauth, transport, async () => {});
  try {
    const first = await drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
    assert.equal(first.results[0].status, failure === 'response' ? 'moved' : 'error');
    const retry = await drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
    assert.equal(retry.results[0].status, 'already_organized'); assert.equal(moves(f.mock).length, 1);
    assert.notEqual(f.db.list(f.a.id)[0].remoteFolderId, 'legacy-root');
  } finally { f.db.close(); }
});

test('changed provider, ownership, hash, trash or manual relocation after preview prevents movement', async () => {
  for (const change of ['provider', 'owner', 'sha', 'trash', 'parent', 'deleted', 'shared']) {
    const f = setup(); legacy(f, 1); const plan = await f.drive.organizationDryRun(f.a.id);
    const file = f.mock.files.get('legacy-zip-1')!;
    if (change === 'provider') file.appProperties!.pp_provider = 'percamb';
    if (change === 'owner') file.ownedByMe = false;
    if (change === 'sha') file.appProperties!.pp_sha256 = 'f'.repeat(64);
    if (change === 'trash') file.trashed = true;
    if (change === 'parent') file.parents = ['manual-folder'];
    if (change === 'deleted') f.mock.files.delete(file.id);
    if (change === 'shared') file.shared = true;
    try {
      const result = await f.drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION);
      assert.equal(result.results[0].status, 'skipped', change); assert.equal(moves(f.mock).length, 0, change);
      assert.equal(folders(f.mock).length, 1, change);
    } finally { f.db.close(); }
  }
});

test('reconciliation supports mixed legacy/subfolders, fresh SQLite, actual deletion and account separation without moving', async () => {
  const f = setup(); legacy(f, 1); const source = await input(f, 'percamb');
  const fresh = new PortalDatabase(':memory:', f.cipher);
  try {
    const saved = await f.drive.upload(source.value);
    const user = fresh.upsertUser(f.a.googleSub, f.a.email), other = fresh.upsertUser(f.b.googleSub, f.b.email);
    fresh.saveCredentials(user.id, f.db.credentials(f.a.id)!); fresh.saveCredentials(other.id, f.db.credentials(f.b.id)!);
    const recovered = new GoogleDriveStorage(fresh, f.oauth, f.mock.fetch, async () => {});
    f.mock.calls.length = 0; await recovered.reconcile(user.id); await recovered.reconcile(other.id);
    assert.equal(fresh.list(user.id).length, 2); assert.equal(fresh.list(other.id).length, 0);
    assert.equal(fresh.list(user.id).find(file => file.remoteFileId === saved.remoteFileId)!.remoteFolderId, saved.remoteFolderId);
    assert.equal(fresh.list(user.id).find(file => file.remoteFileId === 'legacy-zip-1')!.remoteFolderId, 'legacy-root');
    assert.ok(f.mock.calls.every(call => call.method === 'GET'));
    // Manual move changes the local parent reference, never causes a re-upload.
    f.mock.files.get('legacy-zip-1')!.parents = [saved.remoteFolderId];
    await recovered.reconcile(user.id);
    assert.equal(fresh.list(user.id).find(file => file.remoteFileId === 'legacy-zip-1')!.remoteFolderId, saved.remoteFolderId);
    f.mock.files.delete(saved.remoteFileId); await recovered.reconcile(user.id);
    assert.equal(fresh.list(user.id).find(file => file.remoteFileId === saved.remoteFileId)!.status, 'remote_missing');
    assert.equal(moves(f.mock).length, 0);
  } finally { await source.files.cleanup(); fresh.close(); f.db.close(); }
});

test('fresh SQLite recovers and reuses the existing root and provider folder after synchronization', async () => {
  const f = setup(), first = await input(f, 'rdcchacabuco', 'first'), next = await input(f, 'rdcchacabuco', 'second');
  const fresh = new PortalDatabase(':memory:', f.cipher);
  try {
    const initial = await f.drive.upload(first.value);
    const user = fresh.upsertUser(f.a.googleSub, f.a.email); fresh.saveCredentials(user.id, f.db.credentials(f.a.id)!);
    const recovered = new GoogleDriveStorage(fresh, f.oauth, f.mock.fetch, async () => {});
    await recovered.reconcile(user.id);
    const second = await recovered.upload(next.value);
    assert.equal(second.remoteFolderId, initial.remoteFolderId);
    assert.equal(folders(f.mock).length, 2); assert.equal(fresh.list(user.id).length, 2);
  } finally { await first.files.cleanup(); await next.files.cleanup(); fresh.close(); f.db.close(); }
});

test('folder discovery follows all pages and never selects the institution as root', async () => {
  const f = setup(), root = legacy(f, 0), childId = 'aaa-child';
  f.mock.files.set(childId, { id: childId, name: 'Centro DM', account: 'account-A', mimeType: FOLDER_MIME, parents: [root],
    appProperties: { pp_app: DRIVE_APP, pp_owner: f.a.id, pp_role: 'institution', pp_provider: 'centrodm', pp_parent: root } });
  f.db.folder(f.a.id, childId);
  const source = await input(f);
  let pageCount = 0;
  const transport: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get('q')?.includes("mimeType='application/vnd.google-apps.folder'")) {
      pageCount++;
      const id = parsed.searchParams.has('pageToken') ? root : childId;
      const { account: _account, ...file } = f.mock.files.get(id)!;
      return Response.json({ files: [{ ...file, ownedByMe: true }], ...(id === childId ? { nextPageToken: 'second' } : {}) });
    }
    return f.mock.fetch(url, init);
  };
  try {
    const drive = new GoogleDriveStorage(f.db, f.oauth, transport, async () => {});
    const saved = await drive.upload(source.value);
    assert.equal(f.db.connection(f.a.id).folderId, root); assert.equal(saved.remoteFolderId, childId);
    assert.ok(pageCount >= 2); assert.equal(folders(f.mock).length, 2);
  } finally { await source.files.cleanup(); f.db.close(); }
});

test('pre-upgrade resumable session completes in the legacy root without starting a new upload', async () => {
  const f = setup(); legacy(f, 0); const source = await input(f);
  try {
    f.mock.failTransfers = true;
    await assert.rejects(f.drive.upload(source.value));
    const checkpoint = f.db.upload(f.a.id, source.value.file.sha256)!;
    const session = f.mock.sessions.get(checkpoint.session!)!;
    session.metadata.parents = ['legacy-root'];
    f.db.sql.prepare('DELETE FROM upload_folders WHERE owner_id=?').run(f.a.id); // Synthetic old-release checkpoint.
    f.mock.failTransfers = false;
    const saved = await f.drive.upload(source.value);
    assert.equal(saved.remoteFolderId, 'legacy-root'); assert.equal(saved.remoteFileId, checkpoint.remoteId);
    assert.equal(f.mock.uploadStarts, 1); assert.equal(moves(f.mock).length, 0);
  } finally { await source.files.cleanup(); f.db.close(); }
});

test('expired plans and a missing root cannot trigger moves or silently create a replacement root', async () => {
  const f = setup();
  try {
    const empty = await f.drive.organizationDryRun(f.a.id);
    assert.equal(empty.rootId, null); assert.deepEqual(empty.files, []); assert.equal(folders(f.mock).length, 0);
    assert.deepEqual((await f.drive.executeOrganization(f.a.id, empty.planId, MOVE_CONFIRMATION)).results, []);
    legacy(f, 1); const plan = await f.drive.organizationDryRun(f.a.id);
    f.db.sql.prepare('UPDATE drive_move_plans SET expires_at=0 WHERE id=?').run(plan.planId);
    await assert.rejects(f.drive.executeOrganization(f.a.id, plan.planId, MOVE_CONFIRMATION), /DRIVE_MOVE_PLAN_INVALID/);
    const next = await f.drive.organizationDryRun(f.a.id); f.mock.files.get('legacy-root')!.trashed = true;
    await assert.rejects(f.drive.executeOrganization(f.a.id, next.planId, MOVE_CONFIRMATION), /DRIVE_FOLDER_INVALID/);
    assert.equal(moves(f.mock).length, 0); assert.equal(folders(f.mock).length, 1);
  } finally { f.db.close(); }
});
