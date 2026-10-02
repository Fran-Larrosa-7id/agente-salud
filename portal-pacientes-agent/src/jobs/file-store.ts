import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

  constructor(root: string, jobId: string, private readonly maxPdfBytes = MAX_PDF_BYTES, private readonly maxMedicalArchiveBytes = MAX_MEDICAL_ARCHIVE_BYTES) {
    if (!isUuid(jobId)) throw new Error('jobId inválido');
    this.dir = path.join(root, jobId);
  }

  async save(buffer: Buffer, contentType: string | null, kind: StoredFile['kind'] = 'PDF'): Promise<SaveResult> {
    if (this.removed) return { ok: false, reason: 'STORE_CLOSED' };
    const check = kind === 'PDF'
      ? validatePdf(buffer, contentType, this.maxPdfBytes)
      : validateMedicalArchive(buffer, contentType, this.maxMedicalArchiveBytes);
    if (!check.ok) return { ok: false, reason: check.reason };
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = this.byHash.get(sha256);
    if (existing) return { ok: true, file: existing, duplicate: true };
    await mkdir(this.dir, { recursive: true });
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

  get count(): number {
    return this.byId.size;
  }

  get isRemoved(): boolean {
    return this.removed;
  }

  /** Borra la carpeta del job y olvida los archivos. Idempotente. */
  async cleanup(): Promise<void> {
    this.removed = true;
    this.byHash.clear();
    this.byId.clear();
    await rm(this.dir, { recursive: true, force: true });
  }
}
