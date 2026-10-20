import type { Config } from '../config.js';
import { PortalDatabase, TokenCipher } from '../storage/database.js';
import { GoogleDriveStorage } from '../storage/google-drive.js';
import { GoogleOAuth } from './google-oauth.js';
import { createLogger } from '../security/logger.js';

export interface GoogleServices { db: PortalDatabase; oauth: GoogleOAuth; drive: GoogleDriveStorage }
export function createGoogleServices(config: Config, transport: typeof fetch = fetch): GoogleServices | undefined {
  if (config.authMode !== 'google') return undefined;
  if (!config.google) throw new Error('GOOGLE_NOT_CONFIGURED');
  const db = new PortalDatabase(config.databasePath, new TokenCipher(Buffer.from(config.google.encryptionKey, 'base64')));
  const oauth = new GoogleOAuth(config.google, transport);
  const log = createLogger(config.logLevel);
  return { db, oauth, drive: new GoogleDriveStorage(db, oauth, transport, undefined, (jobId, fields) => log.info(jobId, 'drive_upload', fields)) };
}
