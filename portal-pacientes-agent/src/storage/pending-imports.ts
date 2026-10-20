import { copyFile, mkdir, readFile, readdir, rename, rm, stat, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUuid, type StoredFile } from '../jobs/file-store.js';
import type { ImportJob } from '../jobs/job.js';

type Snapshot = ReturnType<ImportJob['snapshot']>;
export interface PendingImport { version: 1; owner: string; createdAt: number; expiresAt: number; snapshot: Snapshot }

/** Bounded retry spool, NOT a permanent clinical archive. No OAuth/session secrets here. */
export class PendingImports {
  readonly root: string;
  constructor(databasePath: string, readonly ttlMs: number) { this.root = path.join(path.dirname(databasePath), 'pending-imports'); }
  directory(jobId: string): string {
    if (!isUuid(jobId)) throw new Error('INVALID_PENDING_JOB');
    const directory = path.resolve(this.root, jobId);
    if (path.dirname(directory) !== path.resolve(this.root)) throw new Error('INVALID_PENDING_JOB');
    return directory;
  }
  async save(job: ImportJob, files: StoredFile[]): Promise<void> {
    const directory = this.directory(job.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of files) {
      if (!isUuid(file.id)) throw new Error('INVALID_PENDING_FILE');
      const target = path.join(directory, file.id + (file.kind === 'PDF' ? '.pdf' : '.zip'));
      if (path.resolve(file.path) !== target) {
        // Atomic copy: a crash can never publish a manifest pointing at a partial ZIP.
        await copyFile(file.path, target + '.partial');
        await chmod(target + '.partial', 0o600);
        await rename(target + '.partial', target);
      }
    }
    await this.writeManifest(job);
  }
  async update(job: ImportJob): Promise<void> {
    try { await stat(path.join(this.directory(job.id), 'manifest.json')); }
    catch { return; } // Never publish metadata if the original checkpoint did not complete.
    await this.writeManifest(job);
  }
  private async writeManifest(job: ImportJob): Promise<void> {
    const directory = this.directory(job.id);
    const snapshot = job.snapshot(); snapshot.studies = snapshot.studies.filter(study => job.selection.includes(study.id));
    const record: PendingImport = { version: 1, owner: job.ownerUserId, createdAt: job.createdAt, expiresAt: job.createdAt + this.ttlMs, snapshot };
    await writeFile(path.join(directory, 'manifest.partial'), JSON.stringify(record), { mode: 0o600 });
    await rename(path.join(directory, 'manifest.partial'), path.join(directory, 'manifest.json'));
  }
  async list(): Promise<PendingImport[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const records: PendingImport[] = [];
    for (const name of await readdir(this.root)) {
      if (!isUuid(name)) continue;
      const directory = this.directory(name);
      let record: PendingImport;
      try { record = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as PendingImport; }
      catch {
        if ((await stat(directory)).mtimeMs + this.ttlMs <= Date.now()) await this.remove(name);
        continue;
      }
      if (!record || typeof record !== 'object' || record.version !== 1 || record.snapshot?.jobId !== name || !/^[a-f0-9]{64}$/.test(record.owner) || !Number.isFinite(record.expiresAt) || !Number.isFinite(record.createdAt) ||
        !Array.isArray(record.snapshot.files) || !Array.isArray(record.snapshot.studies) || !Array.isArray(record.snapshot.selection) || !Array.isArray(record.snapshot.failures)) {
        if ((await stat(directory)).mtimeMs + this.ttlMs <= Date.now()) await this.remove(name);
        continue;
      }
      record.expiresAt = Math.min(record.expiresAt, record.createdAt + this.ttlMs);
      if (record.expiresAt <= Date.now()) { await this.remove(name); continue; }
      records.push(record);
    }
    return records;
  }
  async remove(jobId: string): Promise<void> { await rm(this.directory(jobId), { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
}
