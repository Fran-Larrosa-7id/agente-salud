import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_PDF_BYTES, validatePdf } from './pdf.js';
import { MAX_MEDICAL_ARCHIVE_BYTES, validateMedicalArchive } from './medical-archive.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export interface StoredFile {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  kind: 'PDF' | 'DICOM_ZIP';
  mimeType: 'application/pdf' | 'application/zip';
}

export type SaveResult =
  | { ok: true; file: StoredFile; duplicate: boolean }
  | { ok: false; reason: string };

/**
 * Archivos temporales de un job: tmp/import-jobs/<jobId>/<fileId>.pdf
 * Los nombres son UUID: nunca DNI, nombre, apellido ni protocolo.
 * Deduplica por SHA-256 dentro del job.
 */
export class JobFileStore {
  readonly dir: string;
  private readonly byHash = new Map<string, StoredFile>();
  private readonly byId = new Map<string, StoredFile>();
  private removed = false;
  private writes: Promise<void> = Promise.resolve();
  private cleanupWork?: Promise<void>;

  constructor(root: string, jobId: string, private readonly maxPdfBytes = MAX_PDF_BYTES, private readonly maxMedicalArchiveBytes = MAX_MEDICAL_ARCHIVE_BYTES) {
    if (!isUuid(jobId)) throw new Error('jobId inválido');
    this.dir = path.join(root, jobId);
  }

  save(buffer: Buffer, contentType: string | null, kind: StoredFile['kind'] = 'PDF'): Promise<SaveResult> {
    const pending = this.writes.then(() => this.saveOne(buffer, contentType, kind));
    this.writes = pending.then(() => {}, () => {});
    return pending;
  }

  private async saveOne(buffer: Buffer, contentType: string | null, kind: StoredFile['kind']): Promise<SaveResult> {
    if (this.removed) return { ok: false, reason: 'STORE_CLOSED' };
    const check = kind === 'PDF'
      ? validatePdf(buffer, contentType, this.maxPdfBytes)
      : validateMedicalArchive(buffer, contentType, this.maxMedicalArchiveBytes);
    if (!check.ok) return { ok: false, reason: check.reason };
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = this.byHash.get(sha256);
    if (existing) return { ok: true, file: existing, duplicate: true };
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const extension = kind === 'PDF' ? '.pdf' : '.zip';
    const mimeType = kind === 'PDF' ? 'application/pdf' : 'application/zip';
    const file: StoredFile = { id, path: path.join(this.dir, id + extension), sha256, bytes: buffer.length, kind, mimeType };
    await writeFile(file.path, buffer, { mode: 0o600 });
    this.byHash.set(sha256, file);
    this.byId.set(id, file);
    return { ok: true, file, duplicate: false };
  }

  get(fileId: string): StoredFile | undefined {
    return isUuid(fileId) ? this.byId.get(fileId) : undefined;
  }

  async restore(records: Omit<StoredFile, 'path'>[]): Promise<void> {
    for (const record of records) {
      if (!isUuid(record.id) || !/^[a-f0-9]{64}$/.test(record.sha256) || !['PDF', 'DICOM_ZIP'].includes(record.kind) ||
        record.mimeType !== (record.kind === 'PDF' ? 'application/pdf' : 'application/zip') || record.bytes <= 0 ||
        record.bytes > (record.kind === 'PDF' ? this.maxPdfBytes : this.maxMedicalArchiveBytes)) throw new Error('INVALID_PENDING_FILE');
      const file = { ...record, path: path.join(this.dir, record.id + (record.kind === 'PDF' ? '.pdf' : '.zip')) };
      if ((await stat(file.path)).size !== record.bytes) throw new Error('INVALID_PENDING_FILE');
      this.byId.set(file.id, file); this.byHash.set(file.sha256, file);
    }
  }

  get count(): number {
    return this.byId.size;
  }

  get isRemoved(): boolean {
    return this.removed;
  }

  /** Borra la carpeta del job y olvida los archivos. Idempotente. */
  cleanup(): Promise<void> {
    if (!this.cleanupWork) {
      this.removed = true;
      this.cleanupWork = (async () => {
        await this.writes;
        this.byHash.clear(); this.byId.clear();
        await rm(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
      })();
    }
    return this.cleanupWork;
  }
}
