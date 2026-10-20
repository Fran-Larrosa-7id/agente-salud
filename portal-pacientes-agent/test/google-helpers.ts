import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { DRIVE_SCOPE } from '../src/server/google-oauth.js';

export function googleTestConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-google-'));
  return loadConfig({ AUTH_MODE: 'google', STORAGE_PROVIDER: 'google_drive', PUBLIC_BASE_URL: 'https://portal.test', GOOGLE_CLIENT_ID: 'synthetic-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-client-secret', GOOGLE_REDIRECT_URI: 'https://portal.test/api/auth/google/callback', SESSION_SECRET: 'synthetic-session-secret-at-least-32-bytes',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), DATABASE_PATH: path.join(dir, 'private', 'portal.sqlite'), TMP_DIR: path.join(dir, 'jobs'), LOG_LEVEL: 'silent' }, []);
}
interface MockFile { id: string; account: string; mimeType: string; size?: string; appProperties?: Record<string, string>; parents?: string[]; trashed?: boolean; shared?: boolean; md5Checksum?: string; createdTime?: string; content?: Buffer; name?: string }
interface Upload { metadata: MockFile; total: number; received: number; chunks: Buffer[] }
export class MockGoogle {
  private readonly pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly files = new Map<string, MockFile>();
  readonly sessions = new Map<string, Upload>();
  readonly codes = new Map<string, Record<string, unknown>>();
  readonly calls: { method: string; url: string; chunkBytes: number }[] = [];
  refreshCount = 0; invalidGrant = false; quota = false; failTransfers = false; loseResponseOnce = false; metadataMismatch = false;
  maxChunk = 0; uploadStarts = 0; private sequence = 0;
  claims(nonce: string, sub = 'account-A', extra: Record<string, unknown> = {}) {
    return { iss: 'https://accounts.google.com', aud: 'synthetic-client', sub, email: sub + '@example.test', email_verified: true,
      nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, name: 'Synthetic Account', ...extra };
  }
  jwt(claims: Record<string, unknown>) {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return head + '.' + payload + '.' + sign('RSA-SHA256', Buffer.from(head + '.' + payload), this.pair.privateKey).toString('base64url');
  }
  code(authorization: string, sub = 'account-A') {
    const url = new URL(authorization); const code = randomUUID();
    this.codes.set(code, { ...this.claims(url.searchParams.get('nonce')!, sub), challenge: url.searchParams.get('code_challenge'), drive: url.searchParams.get('scope')!.includes(DRIVE_SCOPE) });
    return { code, state: url.searchParams.get('state')! };
  }
  private json(data: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } }); }
  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); const method = init.method || 'GET';
    const headers = new Headers(init.headers);
    const token = headers.get('authorization')?.replace('Bearer access-', '') || '';
    const chunkBytes = Buffer.isBuffer(init.body) ? init.body.length : 0;
    this.calls.push({ method, url: url.href, chunkBytes }); this.maxChunk = Math.max(this.maxChunk, chunkBytes);
    if (url.pathname.endsWith('/certs')) return this.json({ keys: [{ ...this.pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    if (url.pathname === '/revoke') return this.json({});
    if (url.pathname === '/token') {
      const params = new URLSearchParams(String(init.body));
      if (params.get('grant_type') === 'refresh_token') {
        this.refreshCount++;
        if (this.invalidGrant) return this.json({ error: 'invalid_grant' }, 400);
        return this.json({ access_token: 'access-' + params.get('refresh_token')!.replace('refresh-', ''), expires_in: 3600, token_type: 'Bearer' });
      }
      const claims = this.codes.get(params.get('code')!);
      if (!claims || createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') !== claims.challenge) return this.json({ error: 'invalid_grant' }, 400);
      this.codes.delete(params.get('code')!);
      return this.json({ access_token: 'access-' + claims.sub, refresh_token: claims.drive ? 'refresh-' + claims.sub : undefined,
        id_token: this.jwt(claims), scope: 'openid email profile' + (claims.drive ? ' ' + DRIVE_SCOPE : ''), expires_in: 3600, token_type: 'Bearer' });
    }
    if (!token) return this.json({}, 401);
    if (url.pathname.endsWith('/generateIds')) return this.json({ ids: ['remote-' + (++this.sequence)] });
    if (url.pathname.startsWith('/upload/')) {
      if (this.quota) return this.json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403);
      if (method === 'POST') {
        const metadata = JSON.parse(String(init.body)) as MockFile; metadata.account = token;
        if (this.files.has(metadata.id)) return this.json({}, 409);
        const location = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + (++this.uploadStarts);
        this.sessions.set(location, { metadata, total: Number(headers.get('x-upload-content-length')), received: 0, chunks: [] });
        return this.json({}, 200, { location });
      }
      const upload = this.sessions.get(url.href); if (!upload) return this.json({}, 404);
      if (this.failTransfers) return this.json({}, 503);
      const range = headers.get('content-range') || '';
      if (/^bytes \*\//.test(range)) {
        if (upload.received === upload.total) return this.json({ id: upload.metadata.id });
        return new Response(null, { status: 308, headers: upload.received ? { range: 'bytes=0-' + (upload.received - 1) } : {} });
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
      if (!match || Number(match[1]) !== upload.received) return this.json({}, 400);
      const chunk = Buffer.from(init.body as Uint8Array);
      upload.chunks.push(chunk); upload.received += chunk.length;
      if (upload.received === upload.total) {
        const content = Buffer.concat(upload.chunks);
        this.files.set(upload.metadata.id, { ...upload.metadata, content, size: String(content.length), md5Checksum: createHash('md5').update(content).digest('hex'), shared: false, createdTime: new Date().toISOString() });
      }
      if (this.loseResponseOnce) { this.loseResponseOnce = false; throw new Error('synthetic network interruption'); }
      return upload.received === upload.total ? this.json({ id: upload.metadata.id }) : new Response(null, { status: 308, headers: { range: 'bytes=0-' + (upload.received - 1) } });
    }
    const id = url.pathname.split('/files/')[1];
    if (id) {
      const file = this.files.get(decodeURIComponent(id)); if (!file || file.account !== token) return this.json({}, 404);
      if (method === 'PATCH') { Object.assign(file, JSON.parse(String(init.body))); return this.json({ id: file.id }); }
      if (url.searchParams.get('alt') === 'media') return new Response(file.content as unknown as BodyInit, { headers: { 'content-type': file.mimeType } });
      const { content: _bytes, account: _account, ...metadata } = file;
      return this.json({ ...metadata, ...(this.metadataMismatch && file.size ? { size: String(Number(file.size) + 1) } : {}) });
    }
    if (method === 'POST') {
      const file = JSON.parse(String(init.body)) as MockFile; file.account = token; this.files.set(file.id, file);
      const { account: _account, ...metadata } = file; return this.json(metadata);
    }
    const query = url.searchParams.get('q') || '';
    const nameMatch = /(?:^| and )name='((?:\\.|[^'])*)'/.exec(query);
    const parentMatch = /'((?:\\.|[^'])*)' in parents/.exec(query);
    const unquote = (value: string) => value.replace(/\\(['\\])/g, '$1');
    const all = [...this.files.values()].filter(file => file.account === token && !file.trashed &&
      (!query.includes("mimeType='application/vnd.google-apps.folder'") || file.mimeType === 'application/vnd.google-apps.folder') &&
      (!nameMatch || file.name === unquote(nameMatch[1])) && (!parentMatch || file.parents?.includes(unquote(parentMatch[1]))));
    return this.json({ files: all.map(({ content: _bytes, account: _account, ...file }) => file) });
  };
}
