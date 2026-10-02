import { createHash } from 'node:crypto';

function normalize(value: string | undefined): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Clave opaca estable basada solo en metadatos administrativos no identificatorios. */
export function centroDmSourceKey(date?: string, title?: string, modality?: string, stableId?: string): string | undefined {
  const stable = String(stableId || '').trim().slice(0, 180);
  if (stable) return createHash('sha256').update(`centrodm|${stable}`).digest('hex');
  const normalized = [normalize(date), normalize(title), normalize(modality)];
  if (!normalized.some(Boolean)) return undefined;
  return createHash('sha256').update(`centrodm|metadata|${normalized.join('|')}`).digest('hex');
}
