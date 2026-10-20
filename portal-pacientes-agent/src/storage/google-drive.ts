import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { GoogleOAuth } from '../server/google-oauth.js';
import { PortalDatabase, type StoredStudy } from './database.js';
import { CloudError } from './errors.js';
import type { CloudStorageProvider, UploadInput } from './provider.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const APP = 'portal-pacientes-v1';
const FIELDS = 'id,size,mimeType,appProperties,trashed,parents,shared,md5Checksum,createdTime';
const CHUNK = 8 * 1024 * 1024; // Multiple of Drive's 256 KiB requirement, bounded memory.
interface RemoteFile { id: string; size?: string; mimeType: string; appProperties?: Record<string, string>; trashed?: boolean; shared?: boolean; parents?: string[]; md5Checksum?: string; createdTime?: string }
export interface DriveDiagnostic { stage: string; status?: number; reason: string; bytes: number; totalBytes: number; retryCount: number; sessionState: string; transient: boolean }
const SAFE_REASONS = new Set(['storageQuotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'insufficientPermissions', 'authError', 'forbidden', 'notFound', 'fileNotFound', 'backendError', 'internalError', 'invalid', 'badRequest', 'appNotAuthorizedToFile', 'accessNotConfigured', 'domainPolicy']);
const SAFE_NETWORK_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']);

export class GoogleDriveStorage implements CloudStorageProvider {
  readonly kind = 'google_drive' as const;
  private readonly refreshes = new Map<string, Promise<string>>();
  private readonly epochs = new Map<string, number>();
  private readonly uploads = new Map<string, Promise<StoredStudy>>();
  private readonly context = new AsyncLocalStorage<{ jobId: string; stage: string; bytes: number; totalBytes: number; retryCount: number; sessionState: string; lastTransient?: boolean }>();
  constructor(readonly db: PortalDatabase, readonly oauth: GoogleOAuth, private readonly transport: typeof fetch = fetch,
    private readonly pause: (ms: number, signal?: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
    private readonly diagnostic: (jobId: string | null, fields: DriveDiagnostic) => void = () => {}) {}

  private stage(stage: string): void { const ctx = this.context.getStore(); if (ctx) ctx.stage = stage; }
  private report(reason: string, transient = false, status?: number): void {
    const ctx = this.context.getStore();
    if (ctx && reason !== 'response') ctx.lastTransient = transient;
    this.diagnostic(ctx?.jobId || null, { stage: ctx?.stage || 'drive_request', bytes: ctx?.bytes || 0, totalBytes: ctx?.totalBytes || 0,
      retryCount: ctx?.retryCount || 0, sessionState: ctx?.sessionState || 'none', reason, transient, ...(status === undefined ? {} : { status }) });
  }

  forgetAuthorization(owner: string): void { this.epochs.set(owner, (this.epochs.get(owner) || 0) + 1); }
  private async accessToken(owner: string, force = false): Promise<string> {
    const status = this.db.connection(owner).status;
    if (status === 'disconnected') throw new CloudError('DRIVE_NOT_CONNECTED', 409);
    if (status === 'reconnect_required') throw new CloudError('DRIVE_TOKEN_EXPIRED', 409);
    let credentials;
    try { credentials = this.db.credentials(owner); } catch { this.db.driveStatus(owner, 'reconnect_required'); throw new CloudError('DRIVE_TOKEN_EXPIRED', 409); }
    if (!credentials) throw new CloudError('DRIVE_NOT_CONNECTED', 409);
    if (!force && credentials.accessToken && (credentials.expiresAt || 0) > Date.now() + 60_000) return credentials.accessToken;
    const pending = this.refreshes.get(owner); if (pending) return pending;
    if (!credentials.refreshToken) { this.db.driveStatus(owner, 'reconnect_required'); throw new CloudError('DRIVE_TOKEN_EXPIRED', 409); }
    const epoch = this.epochs.get(owner) || 0;
    const refreshed = this.oauth.refresh(credentials.refreshToken).then(tokens => {
      if (epoch !== (this.epochs.get(owner) || 0) || this.db.connection(owner).status === 'disconnected') throw new CloudError('DRIVE_NOT_CONNECTED', 409);
      this.db.saveCredentials(owner, tokens); return tokens.accessToken!;
    }).catch(error => {
      if (error instanceof CloudError && error.code === 'DRIVE_TOKEN_EXPIRED') this.db.driveStatus(owner, 'reconnect_required');
      throw error;
    }).finally(() => this.refreshes.delete(owner));
    this.refreshes.set(owner, refreshed); return refreshed;
  }
  private async request(owner: string, url: string, init: RequestInit = {}, options: { signal?: AbortSignal; retry?: boolean; accepted?: number[] } = {}): Promise<Response> {
    const target = new URL(url);
    if (target.origin !== 'https://www.googleapis.com' || target.username || target.password || !/^\/(?:upload\/)?drive\/v3\/files(?:\/|$)/.test(target.pathname)) throw new CloudError('DRIVE_UPLOAD_FAILED');
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      const token = await this.accessToken(owner, refreshed);
      let response: Response;
      try {
        // Undici rejects HTTP 308 in redirect:error BEFORE accepted statuses can be checked.
        // Drive uses 308 Resume Incomplete, not a navigation. Never follow Location headers.
        response = await this.transport(url, { ...init, redirect: 'manual', headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: 'Bearer ' + token },
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
      } catch (error) {
        options.signal?.throwIfAborted();
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : code && SAFE_NETWORK_CODES.has(code) ? code : 'network_error';
        this.report(reason, true);
        if (options.retry !== false && attempt < 3) { const ctx = this.context.getStore(); if (ctx) ctx.retryCount++; await this.pause(500 * 2 ** attempt, options.signal); continue; }
        throw new CloudError('DRIVE_UPLOAD_FAILED', 503, true);
      }
      if (response.ok || options.accepted?.includes(response.status)) { this.report('response', false, response.status); return response; }
      if (response.status === 401 && !refreshed) { const ctx = this.context.getStore(); if (ctx) ctx.retryCount++; this.report('access_token_refresh', true, 401); refreshed = true; attempt--; continue; }
      const body = await response.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } };
      const reasons = body.error?.errors?.map(item => item.reason) || [];
      const reason = reasons.find(value => SAFE_REASONS.has(value || '')) || 'other';
      this.report(reason, response.status === 429 || response.status >= 500 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason), response.status);
      if (reasons.includes('storageQuotaExceeded')) { this.db.driveStatus(owner, 'storage_full'); throw new CloudError('DRIVE_STORAGE_FULL', 409); }
      const limited = response.status === 429 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason || ''));
      if ((limited || response.status >= 500) && options.retry !== false && attempt < 3) {
        const ctx = this.context.getStore(); if (ctx) ctx.retryCount++;
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.pause(Math.min(10_000, retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt), options.signal); continue;
      }
      if (response.status === 404 || response.status === 410) throw new CloudError('FILE_MISSING', 404);
      if (response.status === 401 || response.status === 403 && !limited) { this.db.driveStatus(owner, 'reconnect_required'); throw new CloudError('DRIVE_TOKEN_EXPIRED', 409); }
      throw new CloudError(limited ? 'DRIVE_RATE_LIMIT' : 'DRIVE_UPLOAD_FAILED', 503, limited || response.status >= 500);
    }
  }
  private async remote(owner: string, id: string, signal?: AbortSignal): Promise<RemoteFile> {
    return await (await this.request(owner, API + '/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(FIELDS), {}, { signal })).json() as RemoteFile;
  }
  private async generateId(owner: string, signal?: AbortSignal): Promise<string> {
    const result = await (await this.request(owner, API + '/generateIds?count=1&space=drive&type=files', {}, { signal })).json() as { ids?: string[] };
    if (!result.ids?.[0] || !/^[\w-]{1,200}$/.test(result.ids[0])) throw new CloudError('DRIVE_UPLOAD_FAILED');
    return result.ids[0];
  }
  private async folder(owner: string, signal?: AbortSignal): Promise<string> {
    const previous = this.db.connection(owner).folderId;
    if (previous) {
      const value = await this.remote(owner, previous, signal).catch(error => { if (error instanceof CloudError && error.code === 'FILE_MISSING') return null; throw error; });
      if (value && !value.trashed && !value.shared && value.mimeType === 'application/vnd.google-apps.folder' && value.appProperties?.pp_owner === owner && value.appProperties?.pp_app === APP) return value.id;
    }
    const query = `trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='pp_app' and value='${APP}' } and appProperties has { key='pp_owner' and value='${owner}' }`;
    const found = await (await this.request(owner, API + '?' + new URLSearchParams({ q: query, spaces: 'drive', fields: 'files(' + FIELDS + ')', pageSize: '100' }), {}, { signal })).json() as { files?: RemoteFile[] };
    let folder = found.files?.find(item => !item.shared && !item.trashed);
    if (!folder) {
      const id = await this.generateId(owner, signal);
      folder = await (await this.request(owner, API + '?fields=' + encodeURIComponent(FIELDS), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name: 'Portal Pacientes', mimeType: 'application/vnd.google-apps.folder', appProperties: { pp_app: APP, pp_owner: owner } }) }, { signal, retry: false })).json() as RemoteFile;
    }
    if (!folder.id || folder.shared || folder.trashed) throw new CloudError('DRIVE_UPLOAD_FAILED');
    this.db.folder(owner, folder.id); return folder.id;
  }
  private verifyRemote(value: RemoteFile, input: UploadInput, md5: string): void {
    const { file, ownerUserId } = input;
    if (!value.id || value.trashed || value.shared || Number(value.size) !== file.bytes || value.mimeType !== file.mimeType ||
      value.appProperties?.pp_app !== APP || value.appProperties?.pp_owner !== ownerUserId || value.appProperties?.pp_sha256 !== file.sha256 ||
      value.md5Checksum && value.md5Checksum !== md5) throw new CloudError('DRIVE_UPLOAD_FAILED');
  }
  upload(input: UploadInput): Promise<StoredStudy> {
    const key = input.ownerUserId + ':' + input.file.sha256;
    const pending = this.uploads.get(key); if (pending) return pending;
    const promise = this.context.run({ jobId: input.jobId, stage: 'local_verify', bytes: 0, totalBytes: input.file.bytes, retryCount: 0, sessionState: 'none' }, async () => {
      try { return await this.uploadOne(input); } catch (error) {
      this.report(error instanceof CloudError ? error.code : 'local_or_catalog_error', error instanceof CloudError ? !!this.context.getStore()?.lastTransient : false);
      if (error instanceof CloudError && !['FILE_MISSING', 'DRIVE_TOKEN_EXPIRED', 'DRIVE_NOT_CONNECTED', 'DRIVE_STORAGE_FULL'].includes(error.code)) this.db.driveStatus(input.ownerUserId, 'temporary_error');
      throw error;
      }
    }).finally(() => this.uploads.delete(key));
    this.uploads.set(key, promise); return promise;
  }
  private async uploadOne(input: UploadInput): Promise<StoredStudy> {
    const { ownerUserId: owner, file, signal } = input;
    const existing = this.db.byHash(owner, file.sha256);
    if (existing) {
      if (existing.status === 'remote_missing') throw new CloudError('FILE_MISSING', 404);
      this.stage('remote_verify');
      const verified = await this.getMetadata(owner, existing.id);
      if (verified.kind !== file.kind || verified.mimeType !== file.mimeType || verified.bytes !== file.bytes) throw new CloudError('ARTIFACT_INTEGRITY_FAILED', 409);
      const ctx = this.context.getStore()!; ctx.bytes = file.bytes; ctx.sessionState = 'complete';
      this.stage('catalog_commit');
      const saved = this.db.commitStudy({ ...verified, providerId: input.study.provider, sourceStudyKey: input.study.sourceKey,
        date: input.study.studyDate || input.study.date || '', title: input.study.title || '' });
      this.db.driveStatus(owner, 'connected'); this.report('stored'); return saved;
    }
    if ((await stat(file.path)).size !== file.bytes) throw new CloudError('ARTIFACT_INTEGRITY_FAILED', 409);
    const sha = createHash('sha256'), md = createHash('md5');
    for await (const chunk of createReadStream(file.path, { signal })) { sha.update(chunk); md.update(chunk); }
    if (sha.digest('hex') !== file.sha256) throw new CloudError('ARTIFACT_INTEGRITY_FAILED', 409);
    const md5 = md.digest('hex');
    let record = this.db.upload(owner, file.sha256);
    if (!record) {
      this.stage('reserve_id');
      const id = await this.generateId(owner, signal);
      this.db.saveUpload(owner, file.sha256, id, input.jobId); record = this.db.upload(owner, file.sha256)!;
    }
    this.stage('remote_lookup');
    let remote = await this.remote(owner, record.remoteId, signal).catch(error => { if (error instanceof CloudError && error.code === 'FILE_MISSING') return null; throw error; });
    this.stage('folder_lookup');
    const folderId = await this.folder(owner, signal);
    if (!remote) {
      const handle = await open(file.path, 'r');
      try {
        let complete = false;
        for (let sessionAttempt = 0; sessionAttempt < 2 && !complete; sessionAttempt++) {
          let session = record.session;
          if (!session) {
            this.stage('session_create');
            this.context.getStore()!.sessionState = 'creating';
            const response = await this.request(owner, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', { method: 'POST', headers: {
              'content-type': 'application/json', 'x-upload-content-type': file.mimeType, 'x-upload-content-length': String(file.bytes),
            }, body: JSON.stringify({ id: record.remoteId, name: 'estudio-' + record.remoteId + (file.kind === 'PDF' ? '.pdf' : '.zip'), mimeType: file.mimeType, parents: [folderId],
              appProperties: { pp_app: APP, pp_owner: owner, pp_sha256: file.sha256, pp_md5: md5, pp_kind: file.kind, pp_provider: input.study.provider,
                ...(input.study.sourceKey ? { pp_source: input.study.sourceKey } : {}) } }) }, { signal, retry: false, accepted: [409] });
            if (response.status === 409) { remote = await this.remote(owner, record.remoteId, signal); complete = true; break; }
            session = response.headers.get('location') || undefined;
            if (!session) throw new CloudError('DRIVE_UPLOAD_FAILED');
            this.db.saveUpload(owner, file.sha256, record.remoteId, input.jobId, session);
          }
          let offset = 0, failures = 0;
          const ctx = this.context.getStore()!; ctx.sessionState = record.session ? 'resuming' : 'active';
          let probe = true;
          while (!complete) {
            signal.throwIfAborted();
            let response: Response;
            try {
              this.stage(probe ? 'session_probe' : 'chunk_transfer');
              if (probe) response = await this.request(owner, session, { method: 'PUT', headers: { 'content-length': '0', 'content-range': 'bytes */' + file.bytes } }, { signal, retry: false, accepted: [308, 404, 410] });
              else {
                const buffer = Buffer.alloc(Math.min(CHUNK, file.bytes - offset));
                let read = 0;
                while (read < buffer.length) { const part = await handle.read(buffer, read, buffer.length - read, offset + read); if (!part.bytesRead) throw new CloudError('ARTIFACT_INTEGRITY_FAILED', 409); read += part.bytesRead; }
                response = await this.request(owner, session, { method: 'PUT', headers: { 'content-type': file.mimeType, 'content-length': String(buffer.length),
                  'content-range': `bytes ${offset}-${offset + buffer.length - 1}/${file.bytes}` }, body: buffer as unknown as BodyInit }, { signal, retry: false, accepted: [308, 404, 410] });
              }
            } catch (error) {
              if (signal.aborted || !(error instanceof CloudError) || error.retryable === false || !['DRIVE_UPLOAD_FAILED', 'DRIVE_RATE_LIMIT'].includes(error.code) || ++failures > 4) throw error;
              ctx.retryCount++; this.report('retry_scheduled', true);
              await this.pause(Math.min(8000, 500 * 2 ** failures), signal); probe = true; continue;
            }
            if ([404, 410].includes(response.status)) { ctx.sessionState = 'expired'; this.report('session_expired', true, response.status); this.db.saveUpload(owner, file.sha256, record.remoteId, input.jobId); record = this.db.upload(owner, file.sha256)!; break; }
            if (response.status === 200 || response.status === 201) { complete = true; ctx.bytes = file.bytes; ctx.sessionState = 'complete'; this.report('transfer_complete', false, response.status); input.onProgress?.(file.bytes, file.bytes); break; }
            if (response.status !== 308) throw new CloudError('DRIVE_UPLOAD_FAILED');
            const rawRange = response.headers.get('range');
            const range = /^bytes=0-(\d+)$/.exec(rawRange || '');
            if (rawRange && !range) throw new CloudError('DRIVE_UPLOAD_FAILED');
            const received = range ? Number(range[1]) + 1 : 0;
            if (!Number.isSafeInteger(received) || received < 0 || received >= file.bytes || (!probe && received <= offset && ++failures > 4)) throw new CloudError('DRIVE_UPLOAD_FAILED');
            offset = received; ctx.bytes = offset; ctx.sessionState = 'active'; this.report('confirmed', false, 308); input.onProgress?.(offset, file.bytes); probe = false;
          }
        }
        if (!complete) throw new CloudError('DRIVE_UPLOAD_FAILED');
      } finally { await handle.close(); }
      this.stage('remote_verify'); remote = await this.remote(owner, record.remoteId, signal);
    }
    signal.throwIfAborted();
    this.stage('remote_verify'); this.verifyRemote(remote, input, md5);
    if (remote.id !== record.remoteId || !remote.parents?.includes(folderId)) throw new CloudError('DRIVE_UPLOAD_FAILED');
    this.stage('catalog_commit');
    const saved = this.db.commitStudy({ ownerUserId: owner, providerId: input.study.provider, sourceStudyKey: input.study.sourceKey,
      sha256: file.sha256, kind: file.kind, bytes: file.bytes, mimeType: file.mimeType, remoteFileId: remote.id, remoteFolderId: folderId,
      storageBackend: 'google_drive', date: input.study.studyDate || input.study.date || '', title: input.study.title || '',
      createdAt: new Date().toISOString(), status: 'stored', md5Checksum: md5 });
    this.db.driveStatus(owner, 'connected'); this.report('stored'); return saved;
  }
  list(owner: string): StoredStudy[] { return this.db.list(owner); }
  async getMetadata(owner: string, id: string): Promise<StoredStudy> {
    const stored = this.db.study(owner, id); if (!stored) throw new CloudError('FILE_MISSING', 404);
    let remote: RemoteFile;
    try { remote = await this.remote(owner, stored.remoteFileId); }
    catch (error) { if (error instanceof CloudError && error.code === 'FILE_MISSING') this.db.markMissing(owner, id); throw error; }
    if (remote.trashed || remote.id !== stored.remoteFileId || remote.appProperties?.pp_owner !== owner || remote.appProperties?.pp_sha256 !== stored.sha256 || remote.appProperties?.pp_app !== APP || Number(remote.size) !== stored.bytes || remote.mimeType !== stored.mimeType ||
      stored.md5Checksum && remote.md5Checksum && stored.md5Checksum !== remote.md5Checksum) {
      this.db.markMissing(owner, id); throw new CloudError('FILE_MISSING', 404);
    }
    return stored;
  }
  async open(owner: string, id: string): Promise<string> { const file = await this.getMetadata(owner, id); return 'https://drive.google.com/file/d/' + encodeURIComponent(file.remoteFileId) + '/view'; }
  async download(owner: string, id: string): Promise<{ study: StoredStudy; response: Response }> {
    const study = await this.getMetadata(owner, id);
    const response = await this.request(owner, API + '/' + encodeURIComponent(study.remoteFileId) + '?alt=media');
    return { study, response };
  }
  async trash(owner: string, id: string): Promise<void> {
    const file = await this.getMetadata(owner, id);
    await this.request(owner, API + '/' + encodeURIComponent(file.remoteFileId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    this.db.markMissing(owner, id);
  }
  /** Only files created by this app and account; never enumerates the rest of the patient's Drive. */
  async reconcile(owner: string): Promise<void> {
    let pageToken = ''; const seen = new Set<string>(); const collected: RemoteFile[] = [];
    do {
      const query = `trashed=false and appProperties has { key='pp_app' and value='${APP}' } and appProperties has { key='pp_owner' and value='${owner}' }`;
      const data = await (await this.request(owner, API + '?' + new URLSearchParams({ q: query, spaces: 'drive', pageSize: '100', fields: 'nextPageToken,files(' + FIELDS + ')', ...(pageToken ? { pageToken } : {}) }))).json() as { files?: RemoteFile[]; nextPageToken?: string };
      collected.push(...(data.files || []));
      if (data.nextPageToken && seen.has(data.nextPageToken)) throw new CloudError('DRIVE_UPLOAD_FAILED');
      pageToken = data.nextPageToken || ''; if (pageToken) seen.add(pageToken);
    } while (pageToken);
    const remoteIds = new Set<string>();
    for (const file of collected) {
      const props = file.appProperties || {};
      if (file.trashed || props.pp_app !== APP || props.pp_owner !== owner || !/^[a-f0-9]{64}$/.test(props.pp_sha256 || '') || !['percamb', 'centrodm', 'rdcchacabuco'].includes(props.pp_provider) ||
        !['PDF', 'DICOM_ZIP'].includes(props.pp_kind) || file.mimeType !== (props.pp_kind === 'PDF' ? 'application/pdf' : 'application/zip') || !(Number(file.size) > 0)) continue;
      remoteIds.add(file.id);
      const aliases = this.db.list(owner).filter(value => value.remoteFileId === file.id);
      if (props.pp_md5 && file.md5Checksum && props.pp_md5 !== file.md5Checksum) { for (const alias of aliases) this.db.markMissing(owner, alias.id); continue; }
      if (aliases.length) {
        for (const alias of aliases) this.db.commitStudy({ ...alias, status: 'stored' });
        continue;
      }
      const previous = this.db.byHash(owner, props.pp_sha256);
      this.db.commitStudy({ ...previous, ownerUserId: owner, sha256: props.pp_sha256, kind: props.pp_kind as StoredStudy['kind'], mimeType: file.mimeType, bytes: Number(file.size),
        remoteFileId: file.id, remoteFolderId: file.parents?.[0] || '', storageBackend: 'google_drive', providerId: props.pp_provider,
        sourceStudyKey: /^[a-f0-9]{64}$/.test(props.pp_source || '') ? props.pp_source : previous?.sourceStudyKey,
        date: previous?.date || '', title: previous?.title || '', createdAt: previous?.createdAt || file.createdTime || new Date().toISOString(), status: 'stored',
        md5Checksum: /^[a-f0-9]{32}$/.test(props.pp_md5 || '') ? props.pp_md5 : previous?.md5Checksum });
    }
    // Only mark missing after every page succeeded. An outage must not erase the catalog.
    for (const file of this.db.list(owner)) if (!remoteIds.has(file.remoteFileId)) {
      // Search indexing may lag a completed upload: direct lookup distinguishes lag from deletion.
      try { const value = await this.remote(owner, file.remoteFileId); if (value.trashed) this.db.markMissing(owner, file.id); }
      catch (error) { if (error instanceof CloudError && error.code === 'FILE_MISSING') this.db.markMissing(owner, file.id); else throw error; }
    }
    this.db.driveStatus(owner, 'connected');
  }
}
