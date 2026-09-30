import { createHash } from 'node:crypto';

/** Identidad no reversible, estable entre sesiones y sin datos personales. */
export function percambSourceKey(date?: string, protocol?: string, href?: string): string | undefined {
  const stableHash = (identity: string) => createHash('sha256').update(identity, 'utf8').digest('hex');

  if (href) {
    try {
      const url = new URL(href);
      if (/ver_resultado/i.test(url.pathname)) {
        const pathId = url.pathname.match(/\/ver_resultado\/([^/]+)\/?$/i)?.[1];
        const queryId = [...url.searchParams.entries()].find(([key, value]) =>
          /^(?:id|resultado_id|estudio_id|result_id|study_id|codigo_resultado)$/i.test(key) && /^[a-z0-9._-]{1,128}$/i.test(value),
        )?.[1];
        const providerId = pathId || queryId;
        if (providerId) return stableHash(`percamb|provider-id|${providerId}`);
      }
    } catch {
      // Una referencia no válida no debe impedir usar los metadatos disponibles.
    }
  }

  const normalizedDate = (date || '').trim();
  const normalizedProtocol = (protocol || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalizedDate && normalizedProtocol) return stableHash(`percamb|metadata|${normalizedDate}|${normalizedProtocol}`);
  return undefined;
}
