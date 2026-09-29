/**
 * Minimización de datos antes de que algo llegue al modelo de IA.
 *
 * El modelo solo necesita entender la ESTRUCTURA de la página (qué botones hay, qué tabla es la de
 * resultados, qué columna tiene fechas). No necesita nombres, DNI, protocolos ni valores clínicos.
 * Estas funciones reemplazan esos datos por marcadores: ‹fecha›, ‹n›, ‹email›, ‹texto›, ‹dato›.
 *
 * Es una heurística: reduce drásticamente lo que se envía, pero no es un anonimizador perfecto.
 */

export const MASK = {
  date: '‹fecha›',
  num: '‹n›',
  email: '‹email›',
  text: '‹texto›',
  data: '‹dato›',
  id: '‹id›',
} as const;

const DATE_RE = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const NUM_RE = /\d[\d.,\-/]{2,}\d|\d{3,}/g;
const PERSONAL_KEYS =
  /\b(bienvenid[oa]s?|hola|paciente|nombre|apellidos?|dni|documento|usuario|afiliad[oa]|n[°º.]? ?de afiliado|m[eé]dic[oa] solicitante|solicitado por|sexo|edad|fecha de nacimiento|domicilio|tel[eé]fono|e-?mail)\b\s*[:\-]?\s*(.+)$/i;

/** Palabras de interfaz habituales en portales de resultados. Solo estas se envían tal cual en celdas. */
const UI_VOCAB = new Set(
  (
    'ver en pdf descargar descarga imprimir impresion impresión resultado resultados informe informes estudio estudios detalle detalles ' +
    'abrir finalizado finalizada finalizados completo completa completos parcial parciales pendiente pendientes entregado entregada ' +
    'entregados proceso disponible disponibles listo lista validado validada si sí no online protocolo protocolos fecha fechas estado ' +
    'estados orden ordenes órdenes accion acción acciones buscar filtrar volver inicio salir cerrar sesion sesión mis mi de del la el ' +
    'los las y a por pagina página anterior siguiente primera ultima última ingreso entrega recepcion recepción extraccion extracción ' +
    'nro n° nº numero número tipo total parcialmente enviado enviada web consultar mostrar ok aceptar cancelar menu menú home ' +
    'laboratorio análisis analisis practica práctica practicas prácticas determinaciones muestra muestras paciente pacientes sede ' +
    'cargando todos todas nuevo nueva nuevos ultimo último ultimos últimos ir al a la con sin en para año mes dia día'
  ).split(/\s+/),
);

const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim();

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Enmascara fechas, emails y números largos (DNI, protocolos, teléfonos, valores). */
export function maskText(input: string, max = 80): string {
  let s = normalizeWs(input || '');
  if (!s) return '';
  s = s.replace(EMAIL_RE, MASK.email).replace(DATE_RE, MASK.date).replace(NUM_RE, MASK.num);
  const m = s.match(PERSONAL_KEYS);
  if (m) s = s.slice(0, m.index! + m[0].length - m[2].length) + MASK.data;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function isVocabWord(w: string): boolean {
  const lw = w.toLowerCase().replace(/[.:;,()\[\]¿?¡!«»"']/g, '');
  return !lw || UI_VOCAB.has(lw) || UI_VOCAB.has(stripAccents(lw)) || lw.startsWith('‹');
}

/** ¿Parece un nombre propio de persona? (2 a 5 palabras capitalizadas o en mayúsculas, fuera del vocabulario de UI). */
export function looksLikePersonName(s: string): boolean {
  const words = normalizeWs(s).split(' ');
  if (words.length < 2 || words.length > 5) return false;
  const nameish = words.every((w) => /^[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’\-]*,?$/.test(w));
  if (!nameish) return false;
  return words.filter((w) => !isVocabWord(w)).length >= 2;
}

const CAP_WORD = /^[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’\-]*[,.]?$/;

/** Reemplaza secuencias de 2 o más palabras capitalizadas fuera del vocabulario (p. ej. "Resultados de PEREZ JUAN"). */
function maskNameRuns(s: string): string {
  const words = s.split(' ');
  const isName = (w: string) => CAP_WORD.test(w) && !isVocabWord(w);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && isName(words[j])) j++;
    if (j - i >= 2) {
      out.push(MASK.text);
      i = j;
    } else {
      out.push(words[i]);
      i++;
    }
  }
  return out.join(' ');
}

/** Para etiquetas de botones, enlaces y títulos: se conserva el texto de interfaz y se ocultan datos personales. */
export function maskLabel(input: string, max = 60): string {
  let s = maskText(input, 200);
  if (!s) return '';
  if (looksLikePersonName(s)) return MASK.text;
  s = maskNameRuns(s);
  // Frases largas que no son de interfaz (p. ej. observaciones clínicas) se resumen.
  const words = s.split(' ');
  const unknown = words.filter((w) => !isVocabWord(w)).length;
  if (words.length > 6 && unknown / words.length > 0.5) return MASK.text;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export type CellShape = 'vacío' | 'fecha' | 'número' | 'texto' | 'interfaz';

export function cellShape(input: string): CellShape {
  const s = normalizeWs(input || '');
  if (!s) return 'vacío';
  if (new RegExp('^(' + DATE_RE.source + ')(\\s+\\d{1,2}:\\d{2}(:\\d{2})?)?$').test(s)) return 'fecha';
  if (/^[\d\s.,\-/#°º]+$/.test(s) || /^[A-Z]{0,4}[-\s]?\d[\d\-/.]*$/i.test(s)) return 'número';
  const words = s.split(' ');
  if (words.length <= 4 && words.every(isVocabWord)) return 'interfaz';
  return 'texto';
}

/** Representación de una celda para el modelo: la palabra de interfaz, o solo su "forma". */
export function maskCell(input: string): string {
  const shape = cellShape(input);
  if (shape === 'interfaz') return normalizeWs(input).toLowerCase().slice(0, 30);
  if (shape === 'vacío') return '';
  return shape === 'fecha' ? MASK.date : shape === 'número' ? MASK.num : MASK.text;
}

/** Ruta de una URL sin query ni identificadores. */
export function maskPath(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname
      .split('/')
      .filter(Boolean)
      .map((seg) => (/\d{3,}/.test(seg) ? MASK.num : seg.length > 24 || /[A-Za-z0-9_-]{20,}/.test(seg) ? MASK.id : seg.slice(0, 32)));
    return '/' + segs.join('/') + (u.search ? '?…' : '');
  } catch {
    return '';
  }
}
