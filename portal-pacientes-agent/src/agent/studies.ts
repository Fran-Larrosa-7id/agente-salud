import { createHash } from 'node:crypto';
import type { RawCollection } from '../browser/types.js';
import type { ExternalStudy } from '../jobs/job.js';
import { cellShape, stripAccents } from '../security/sanitize.js';
import type { ColumnMapping } from './types.js';

const norm = (s: string) => stripAccents(String(s || '')).replace(/\s+/g, ' ').trim().toLowerCase();

/** Convierte fechas argentinas (dd/mm/aaaa, dd-mm-aa) o ISO a AAAA-MM-DD. */
export function parseDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.trim();
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!m) return undefined;
  let y = +m[3];
  if (y < 100) y += y > 70 ? 1900 : 2000;
  return valid(y, +m[2], +m[1]);
}

function valid(y: number, mo: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function columnCount(c: RawCollection): number {
  return Math.max(c.headers.length, ...c.rows.map((r) => r.length), 0);
}

/** Firma estable de un listado: tipo + encabezados normalizados + cantidad de columnas. */
export function signatureOf(c: RawCollection): string {
  return c.kind + ':' + c.headers.map(norm).join('|') + '#' + columnCount(c);
}

/** Huella de una fila (para volver a encontrarla) sin conservar su contenido. */
export function fingerprintOf(cells: string[]): string {
  return createHash('sha256').update(cells.map(norm).join('␟')).digest('hex').slice(0, 20);
}

const HEADER_RULES: [keyof ColumnMapping, RegExp][] = [
  ['deliveryDate', /entrega|informad|disponible desde|fecha de informe|f\.? ?entr/],
  ['protocol', /protocolo|^nro|n[°º]|numero|orden|pedido|^prot/],
  ['status', /estado|situacion|condicion/],
  ['date', /fecha|ingreso|recepcion|extraccion|atencion|^f\.? ?ing/],
];

/** Propuesta de columnas a partir de encabezados y formas (se usa si el modelo no indica alguna). */
export function inferColumns(c: RawCollection): ColumnMapping {
  const out: ColumnMapping = {};
  c.headers.forEach((h, i) => {
    const n = norm(h);
    for (const [key, re] of HEADER_RULES) {
      if (out[key] === undefined && re.test(n)) {
        out[key] = i;
        break;
      }
    }
  });
  if (out.date === undefined) {
    const cols = columnCount(c);
    for (let i = 0; i < cols; i++) {
      if (i !== out.deliveryDate && dateRatio(c, i) >= 0.5) {
        out.date = i;
        break;
      }
    }
  }
  return out;
}

function dateRatio(c: RawCollection, col: number): number {
  if (!c.rows.length) return 0;
  return c.rows.filter((r) => parseDate(r[col])).length / c.rows.length;
}

/** Valida los índices propuestos por el modelo y completa lo que falte con la inferencia local. */
export function resolveColumns(c: RawCollection, proposed: ColumnMapping | undefined): ColumnMapping {
  const cols = columnCount(c);
  const inferred = inferColumns(c);
  const ok = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < cols;
  const out: ColumnMapping = {};
  for (const key of ['date', 'protocol', 'deliveryDate', 'status'] as const) {
    const p = proposed?.[key];
    out[key] = ok(p) ? p : inferred[key];
  }
  if (out.date !== undefined && dateRatio(c, out.date) < 0.5) out.date = inferred.date;
  if (out.deliveryDate !== undefined && dateRatio(c, out.deliveryDate) < 0.3) out.deliveryDate = undefined;
  return out;
}

/** Solo se conservan estados reconocibles; así una columna mal elegida no filtra nombres. */
const STATUS_RE = /finaliz|complet|parcial|pendiente|entregad|proceso|disponible|listo|validad|terminad|impres|enviad|en curso/i;

export interface ExtractedStudy {
  study: ExternalStudy;
  fingerprint: string;
}

/** Extrae la metadata mínima de cada fila. Nombres, DNI y diagnósticos no se toman. */
export function extractStudies(jobId: string, provider: string, c: RawCollection, map: ColumnMapping, max = 50): ExtractedStudy[] {
  const out: ExtractedStudy[] = [];
  const seen = new Set<string>();
  for (const row of c.rows) {
    if (out.length >= max) break;
    const date = map.date !== undefined ? parseDate(row[map.date]) : undefined;
    const protocolRaw = map.protocol !== undefined ? row[map.protocol] : undefined;
    const protocol = protocolRaw && cellShape(protocolRaw) === 'número' ? protocolRaw.replace(/[^\w\-/.]/g, '').slice(0, 32) : undefined;
    if (!date && !protocol) continue;
    const fingerprint = fingerprintOf(row);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const statusRaw = map.status !== undefined ? row[map.status]?.trim() : undefined;
    const status = statusRaw && statusRaw.length <= 24 && STATUS_RE.test(statusRaw) ? statusRaw : undefined;
    const deliveryDate = map.deliveryDate !== undefined ? parseDate(row[map.deliveryDate]) : undefined;
    const id = 'st_' + createHash('sha256').update(jobId + ':' + fingerprint).digest('hex').slice(0, 12);
    out.push({
      study: { id, provider, ...(date && { date }), ...(protocol && { protocol }), ...(deliveryDate && { deliveryDate }), ...(status && { status }) },
      fingerprint,
    });
  }
  return out;
}
