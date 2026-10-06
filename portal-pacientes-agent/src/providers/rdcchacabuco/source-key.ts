import { createHash } from 'node:crypto';

function normalize(value: string | undefined): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Hash opaco; nunca devuelve ni registra la referencia original del proveedor. */
export function rdcChacabucoSourceKey(studyDate?: string, studyType?: string, title?: string, stableId?: string, rowIndex?: number): string | undefined {
  const stable = String(stableId || '').trim().slice(0, 180);
  if (stable) return createHash('sha256').update(`rdcchacabuco|${stable}`).digest('hex');
  const normalized = [normalize(studyDate), normalize(studyType), normalize(title)];
  const validRowIndex = Number.isInteger(rowIndex) && (rowIndex as number) >= 0 ? rowIndex : undefined;
  if (normalized.some(Boolean)) {
    return createHash('sha256').update(`rdcchacabuco|${normalized.join('|')}`).digest('hex');
  }
  if (validRowIndex === undefined) return undefined;
  return createHash('sha256').update(`rdcchacabuco|row|${validRowIndex}`).digest('hex');
}
