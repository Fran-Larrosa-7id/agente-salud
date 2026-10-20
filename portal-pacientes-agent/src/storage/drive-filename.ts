import type { ExternalStudy } from '../jobs/job.js';
import { PROVIDERS } from '../providers/index.js';
import type { StoredFile } from '../jobs/file-store.js';

// Only controlled labels may enter a filename. Never copy a free-form title/protocol.
const TYPES: Record<string, string> = {
  'ultrasonido': 'Ecografía', 'ecografia': 'Ecografía',
  'radiografia computada': 'Radiografía', 'radiografia': 'Radiografía',
  'tomografia computada': 'Tomografía', 'tomografia': 'Tomografía',
  'resonancia magnetica': 'Resonancia magnética', 'resonancia': 'Resonancia magnética',
  'mamografia': 'Mamografía', 'panoramica dental': 'Panorámica dental',
  'reconstruccion 3d': 'Reconstrucción 3D',
};
const key = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();

export function studyFilenameDate(value?: string): string | null {
  if (!value) return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(text);
  const local = /^(\d{2})([/.\-])(\d{2})\2(\d{4})$/.exec(text);
  if (!iso && !local) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(local![4]), Number(local![3]), Number(local![1])];
  if (year < 1000 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function driveFilenameBase(study: ExternalStudy, kind: StoredFile['kind']): { base: string; extension: string } {
  const date = studyFilenameDate(study.studyDate) || studyFilenameDate(study.date) || 'Sin fecha';
  const institution = Object.hasOwn(PROVIDERS, study.provider) ? PROVIDERS[study.provider].name : 'Institución no disponible';
  const type = [study.studyType, study.title].map(value => value && Object.hasOwn(TYPES, key(value)) ? TYPES[key(value)] : undefined).find(Boolean);
  const format = kind === 'DICOM_ZIP' ? 'Imágenes DICOM' : 'Informe';
  const label = type ? `${type} - ${format}` : format;
  let base = `${date} - ${institution} - ${label}`.normalize('NFC')
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  // Keep the full filename below common 255-byte component limits even with a collision suffix.
  while (Buffer.byteLength(base, 'utf8') > 160) base = [...base].slice(0, -1).join('');
  return { base: base.replace(/[. ]+$/g, ''), extension: kind === 'DICOM_ZIP' ? '.zip' : '.pdf' };
}

export function* driveFilenameCandidates(study: ExternalStudy, file: Pick<StoredFile, 'kind' | 'sha256'>): Generator<string> {
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('INVALID_FILENAME_IDENTITY');
  const { base, extension } = driveFilenameBase(study, file.kind);
  yield base + extension;
  for (const length of [8, 12, 16, 64]) yield `${base} - ${file.sha256.slice(0, length)}${extension}`;
  // Last resort if names were occupied manually, even at a full-hash candidate.
  // A bounded failure is safer than silently creating another ambiguous name.
}
