export interface CapturedMedicalArchive {
  buffer: Buffer;
  contentType: string | null;
  via: 'download';
}

export type MedicalArchiveCheck = { ok: true; mimeMismatch?: boolean } | { ok: false; reason: 'EMPTY' | 'NOT_ZIP_BYTES' | 'TOO_LARGE' };

export const MAX_MEDICAL_ARCHIVE_BYTES = 512 * 1024 * 1024;

export function hasZipMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const a = buffer.readUInt32LE(0);
  // Local file, empty archive, or spanning marker; do not infer validity from extension alone.
  return a === 0x04034b50 || a === 0x06054b50 || a === 0x08074b50;
}

export function validateMedicalArchive(buffer: Buffer, contentType: string | null, maxBytes = MAX_MEDICAL_ARCHIVE_BYTES): MedicalArchiveCheck {
  if (!buffer || buffer.length === 0) return { ok: false, reason: 'EMPTY' };
  if (buffer.length > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (!hasZipMagic(buffer)) return { ok: false, reason: 'NOT_ZIP_BYTES' };
  const mimeMismatch = !!contentType && !/application\/(?:zip|x-zip-compressed|octet-stream)|binary|force-download|x-download/i.test(contentType);
  return mimeMismatch ? { ok: true, mimeMismatch: true } : { ok: true };
}
