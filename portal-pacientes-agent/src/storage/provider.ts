import type { StoredFile } from '../jobs/file-store.js';
import type { ExternalStudy } from '../jobs/job.js';
import type { StoredStudy } from './database.js';

export interface UploadInput {
  ownerUserId: string; jobId: string; file: StoredFile; study: ExternalStudy; signal: AbortSignal;
  onProgress?: (bytes: number, total: number) => void;
}
export interface CloudStorageProvider {
  kind: 'google_drive';
  upload(input: UploadInput): Promise<StoredStudy>;
  list(ownerUserId: string): StoredStudy[];
  getMetadata(ownerUserId: string, id: string): Promise<StoredStudy>;
  open(ownerUserId: string, id: string): Promise<string>;
  download(ownerUserId: string, id: string): Promise<{ study: StoredStudy; response: Response }>;
  trash(ownerUserId: string, id: string): Promise<void>;
}
/** Local legacy deliberately has no fake server upload: persistence is acknowledged by IndexedDB. */
export const localLegacyStorage = { kind: 'local', persistence: 'browser_ack' } as const;
export type StorageProvider = typeof localLegacyStorage | CloudStorageProvider;
