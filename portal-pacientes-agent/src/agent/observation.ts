import type { RawCollection, RawElement, RawPageSnapshot } from '../browser/types.js';
import type { ProviderConfig } from '../providers/types.js';
import { cellShape, maskCell, maskLabel, maskPath, maskText } from '../security/sanitize.js';
import { elementBlockReason, type PolicyContext } from './policies/action-policy.js';
import { PROMPT_VERSION, goalInstruction } from './prompts/health-portal-agent.prompt.js';
import { columnCount, fingerprintOf, signatureOf } from './studies.js';
import type { AgentGoal, AgentObservation, CollectionObs, ElementObs, HistoryItem } from './types.js';

export const ELEMENT_PAGE = 70;
const ROWS_WITH_ELEMENTS = 6;

/** Ubica la fila del estudio seleccionado en la página actual (por firma de tabla + huella de fila). */
export function locateTarget(raw: RawPageSnapshot, goal: AgentGoal): { collection?: string; row?: number } {
  const t = goal.target;
  if (!t?.signature || !t.fingerprint) return {};
  for (const c of raw.collections) {
    if (signatureOf(c) !== t.signature) continue;
    const row = c.rows.findIndex((r) => fingerprintOf(r) === t.fingerprint);
    return row >= 0 ? { collection: c.id, row } : { collection: c.id };
  }
  return {};
}

function elementObs(el: RawElement, policy: PolicyContext, providerHosts: (url: string) => boolean): ElementObs {
  const o: ElementObs = { id: el.id, role: el.role, label: maskLabel(el.label) || '(sin texto)' };
  if (el.iconHint) o.icon = el.iconHint;
  if (el.href && /^https?:/i.test(el.href)) o.href = providerHosts(el.href) ? maskPath(el.href) : '(sitio externo)';
  else if (el.href && /^javascript:/i.test(el.href)) o.href = '(acción de la página)';
  if (el.target === '_blank') o.opensNewTab = true;
  if (el.collection) {
    o.collection = el.collection;
    o.row = el.row;
  }
  if (policy.targetCollection && el.collection === policy.targetCollection && el.row === policy.targetRow) o.target = true;
  if (el.disabled) o.disabled = true;
  const blocked = elementBlockReason(el, policy);
  if (blocked) o.blocked = blocked;
  return o;
}

/** Orden de prioridad: fila objetivo, filas de listados (primeras), resto de la página. */
export function orderElements(raw: RawPageSnapshot, policy: PolicyContext): RawElement[] {
  const rank = (e: RawElement) =>
    policy.targetCollection && e.collection === policy.targetCollection && e.row === policy.targetRow
      ? 0
      : e.collection !== undefined && (e.row ?? 99) < ROWS_WITH_ELEMENTS
        ? 1
        : e.collection !== undefined
          ? 3
          : 2;
  return raw.elements
    .map((e, i) => ({ e, i, r: rank(e) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

export function collectionObs(c: RawCollection, sampleRows: number, targetRow?: number): CollectionObs {
  const cols = columnCount(c);
  const columnShapes: string[] = [];
  for (let i = 0; i < cols; i++) {
    const counts = new Map<string, number>();
    for (const r of c.rows) {
      const s = cellShape(r[i] ?? '');
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    const best = [...counts.entries()].filter(([s]) => s !== 'vacío').sort((a, b) => b[1] - a[1])[0];
    columnShapes.push(best ? best[0] : 'vacío');
  }
  return {
    id: c.id,
    kind: c.kind,
    headers: c.headers.map((h) => maskLabel(h, 30)),
    rowCount: c.rowCount,
    columnShapes,
    sampleRows: c.rows.slice(0, sampleRows).map((r) => r.map(maskCell)),
    ...(targetRow !== undefined ? { targetRow } : {}),
  };
}

export interface ObservationInput {
  raw: RawPageSnapshot;
  goal: AgentGoal;
  step: number;
  maxSteps: number;
  remainingMs: number;
  history: HistoryItem[];
  lastToolResult?: string;
  provider: ProviderConfig;
  policy: PolicyContext;
  openPages: number;
}

/**
 * Construye lo ÚNICO que ve el modelo: estructura de la página con datos enmascarados.
 * Sin HTML, sin screenshots, sin valores de campos, sin nombres ni números del paciente.
 */
export function buildObservation(input: ObservationInput): AgentObservation {
  const { raw, goal, policy, provider } = input;
  const allowed = (u: string) => policy.domains.isAllowedNavigation(u);
  const detail = raw.pageType === 'result_detail';
  const ordered = orderElements(raw, policy).filter((e) => !detail || /pdf|descarg|download|imprim|print|informe|volver|regresar/i.test(e.label + ' ' + e.iconHint));
  const elements = ordered.slice(0, ELEMENT_PAGE).map((e) => elementObs(e, policy, allowed));
  const collections = (detail ? [] : raw.collections).map((c) =>
    collectionObs(c, 3, c.id === policy.targetCollection ? policy.targetRow : undefined),
  );
  const obs: AgentObservation = {
    promptVersion: PROMPT_VERSION,
    goal: { kind: goal.kind, instruction: goalInstruction(goal.kind) },
    step: input.step,
    maxSteps: input.maxSteps,
    remainingSeconds: Math.max(0, Math.round(input.remainingMs / 1000)),
    page: {
      title: detail ? 'Documento del estudio' : maskLabel(raw.title, 60),
      path: maskPath(raw.url),
      headings: detail ? [] : raw.headings.slice(0, 10).map((h) => maskLabel(h)).filter(Boolean),
      openPages: input.openPages,
      isPdfViewer: raw.isPdfViewer,
      pdfEmbeds: raw.pdfEmbeds.length,
      modalOpen: raw.modal,
      modalText: raw.modal && !detail ? maskText(raw.modalText, 120) : '',
      noResultsText: raw.noResultsText,
      captchaSuspected: raw.captcha,
      otpSuspected: raw.otp,
      passwordFieldVisible: raw.hasPasswordField,
    },
    elements,
    elementsOmitted: Math.max(0, ordered.length - elements.length),
    collections,
    hints: { expectedPdfLabels: provider.expectedPdfLabels, resultsHints: provider.resultsHints, notes: provider.agentNotes },
    history: input.history.slice(-10),
  };
  if (goal.kind === 'DOWNLOAD_STUDY') {
    obs.target = {
      ...(policy.targetCollection ? { collection: policy.targetCollection } : {}),
      ...(policy.targetRow !== undefined ? { row: policy.targetRow } : {}),
      visibleOnPage: policy.targetRow !== undefined,
      alreadyOpened: policy.targetOpened,
    };
  }
  if (input.lastToolResult) obs.lastToolResult = input.lastToolResult.slice(0, 4000);
  return obs;
}

/** Texto que se envía al modelo como mensaje de usuario. */
export function renderObservation(obs: AgentObservation): string {
  return 'Observación actual (JSON). Elegí UNA herramienta.\n' + JSON.stringify(obs);
}

/** Elementos a partir de un offset (herramienta getInteractiveElements). */
export function elementsPage(raw: RawPageSnapshot, policy: PolicyContext, offset: number): ElementObs[] {
  const allowed = (u: string) => policy.domains.isAllowedNavigation(u);
  return orderElements(raw, policy)
    .filter((e) => raw.pageType !== 'result_detail' || /pdf|descarg|download|imprim|print|informe|volver|regresar/i.test(e.label + ' ' + e.iconHint))
    .slice(offset, offset + ELEMENT_PAGE)
    .map((e) => elementObs(e, policy, allowed));
}

export interface CompactOptions {
  maxElements: number;
  maxHistory: number;
}

/** Quita valores vacíos o en false para no gastar contexto en ellos. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === false || v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      out[k] = prune(v);
    }
    return out;
  }
  return value;
}

/**
 * Misma observación, en versión reducida para modelos locales chicos: menos elementos
 * (el resto sigue disponible con getInteractiveElements), historial corto y sin campos vacíos.
 * No agrega información: solo recorta.
 */
export function renderCompactObservation(obs: AgentObservation, opts: CompactOptions): string {
  const { promptVersion: _version, ...rest } = obs;
  const elements = obs.elements.slice(0, opts.maxElements);
  const compact = {
    ...rest,
    elements,
    elementsOmitted: obs.elementsOmitted + (obs.elements.length - elements.length),
    ...(obs.elementsOmitted + obs.elements.length > elements.length ? { moreElementsOffset: elements.length } : {}),
    history: obs.history.slice(-opts.maxHistory),
  };
  return 'Observación actual (JSON). Elegí UNA herramienta.\n' + JSON.stringify(prune(compact));
}
