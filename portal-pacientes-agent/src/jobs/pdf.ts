/** Validación de PDF: no alcanza con un 200 ni con el Content-Type; se revisan los bytes. */

export interface CapturedPdf {
  buffer: Buffer;
  contentType: string | null;
  via: 'download' | 'response' | 'fetch';
}

export type PdfCheck = { ok: true; mimeMismatch?: boolean } | { ok: false; reason: 'EMPTY' | 'NOT_PDF_BYTES' | 'TOO_LARGE' };

export const MAX_PDF_BYTES = 40 * 1024 * 1024;

export function hasPdfMagic(buf: Buffer): boolean {
  // La especificación permite basura antes del encabezado; los lectores buscan "%PDF-" en los primeros 1024 bytes.
  const head = buf.subarray(0, 1024).toString('latin1');
  return head.includes('%PDF-');
}

export function validatePdf(buffer: Buffer, contentType: string | null, maxBytes = MAX_PDF_BYTES): PdfCheck {
  if (!buffer || buffer.length === 0) return { ok: false, reason: 'EMPTY' };
  if (buffer.length > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (!hasPdfMagic(buffer)) return { ok: false, reason: 'NOT_PDF_BYTES' };
  const mimeMismatch = !!contentType && !/pdf|octet-stream|binary|force-download|x-download/i.test(contentType);
  return mimeMismatch ? { ok: true, mimeMismatch: true } : { ok: true };
}

/** PDF mínimo y válido (para el FakeProviderAgent y los tests). Solo ASCII. */
export function makeDemoPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${760 - i * 24} Td (${esc(l)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
