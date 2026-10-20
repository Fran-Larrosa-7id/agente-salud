import { createHash, createPublicKey, verify, type KeyObject, type JsonWebKey } from 'node:crypto';
import type { Config } from '../config.js';
import { CloudError } from '../storage/errors.js';
import type { DriveCredentials } from '../storage/database.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export type GoogleConfig = NonNullable<Config['google']>;
export interface GoogleIdentity { sub: string; email: string; name: string }
export interface GoogleTokens extends DriveCredentials { idToken?: string }
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Server-only code flow and OIDC validation. All network destinations are fixed Google endpoints. */
export class GoogleOAuth {
  private keys = new Map<string, KeyObject>();
  private keysUntil = 0;
  constructor(readonly config: GoogleConfig, private readonly transport: typeof fetch = fetch) {}
  authorization(attempt: { state: string; nonce: string; verifier: string; drive: boolean; loginHint?: string }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params: Record<string, string> = {
      client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code',
      scope: 'openid email profile' + (attempt.drive ? ' ' + DRIVE_SCOPE : ''),
      state: attempt.state, nonce: attempt.nonce,
      code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'), code_challenge_method: 'S256',
      include_granted_scopes: attempt.drive ? 'true' : 'false',
    };
    if (attempt.drive) { params.access_type = 'offline'; params.prompt = 'consent'; }
    else params.prompt = 'select_account';
    if (attempt.loginHint) params.login_hint = attempt.loginHint;
    url.search = new URLSearchParams(params).toString(); return url.href;
  }
  private async tokens(body: Record<string, string>, refresh = false): Promise<GoogleTokens> {
    let response: Response;
    try { response = await this.transport(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ ...body, client_id: this.config.clientId, client_secret: this.config.clientSecret }), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new CloudError(refresh ? 'DRIVE_UPLOAD_FAILED' : 'GOOGLE_ACCESS_DENIED'); }
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new CloudError(refresh && data.error === 'invalid_grant' ? 'DRIVE_TOKEN_EXPIRED' : refresh ? 'DRIVE_UPLOAD_FAILED' : 'GOOGLE_ACCESS_DENIED', refresh && data.error === 'invalid_grant' ? 401 : 503);
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in <= 0 || data.token_type !== 'Bearer') throw new CloudError('GOOGLE_ACCESS_DENIED', 401);
    return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      idToken: typeof data.id_token === 'string' ? data.id_token : undefined, scope: typeof data.scope === 'string' ? data.scope : undefined,
      expiresAt: Date.now() + data.expires_in * 1000 };
  }
  exchange(code: string, verifier: string): Promise<GoogleTokens> {
    return this.tokens({ code, code_verifier: verifier, redirect_uri: this.config.redirectUri, grant_type: 'authorization_code' });
  }
  refresh(refreshToken: string): Promise<GoogleTokens> { return this.tokens({ refresh_token: refreshToken, grant_type: 'refresh_token' }, true); }
  async revoke(token: string): Promise<void> {
    const response = await this.transport('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CloudError('DRIVE_UPLOAD_FAILED');
  }
  async verifyIdentity(token: string | undefined, nonce: string): Promise<GoogleIdentity> {
    try {
      if (!token || token.length > 32768) throw new Error();
      const parts = token.split('.'); if (parts.length !== 3) throw new Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
      if (header.alg !== 'RS256' || !header.kid || header.kid.length > 256) throw new Error();
      if (Date.now() > this.keysUntil || !this.keys.has(header.kid)) {
        const response = await this.transport(JWKS_URL, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error();
        const jwks = await response.json() as { keys?: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] };
        const keys = new Map<string, KeyObject>();
        for (const jwk of jwks.keys || []) {
          if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' || !jwk.kid) continue;
          const key = createPublicKey({ key: jwk, format: 'jwk' });
          if ((key.asymmetricKeyDetails?.modulusLength || 0) >= 2048) keys.set(jwk.kid, key);
        }
        this.keys = keys; this.keysUntil = Date.now() + 600_000;
      }
      const key = this.keys.get(header.kid);
      if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
      const now = Math.floor(Date.now() / 1000);
      const audience = claims.aud === this.config.clientId || (Array.isArray(claims.aud) && claims.aud.includes(this.config.clientId) && claims.azp === this.config.clientId);
      if (!audience || (claims.azp && claims.azp !== this.config.clientId) || !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
        typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 60 || claims.iat >= claims.exp ||
        claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
        typeof claims.email !== 'string' || claims.email.length > 320 || claims.email_verified !== true) throw new Error();
      if ((this.config.allowedEmails.length && !this.config.allowedEmails.includes(claims.email.toLowerCase())) ||
        (this.config.allowedSubs.length && !this.config.allowedSubs.includes(claims.sub))) throw new Error();
      return { sub: claims.sub, email: claims.email, name: typeof claims.name === 'string' ? claims.name.slice(0, 160) : '' };
    } catch { throw new CloudError('GOOGLE_ACCESS_DENIED', 401); }
  }
}
