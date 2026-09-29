import type { BrowserPort, RawElement, RawPageSnapshot } from '../../browser/types.js';
import type { HumanReason } from '../../jobs/job.js';
import type { CapturedPdf } from '../../jobs/pdf.js';
import type { ProviderConfig } from '../../providers/types.js';
import { maskLabel, maskPath } from '../../security/sanitize.js';
import { collectionObs, elementsPage } from '../observation.js';
import { downloadBlockReason, elementBlockReason, type PolicyContext } from '../policies/action-policy.js';
import type { AgentAction, ColumnMapping, HistoryItem } from '../types.js';

export interface FinishArgs {
  collectionId?: string;
  columns?: ColumnMapping;
  noStudies?: boolean;
}

export interface ExecResult {
  outcome: HistoryItem['outcome'];
  note: string;
  element?: string;
  /** Resultado de una herramienta de lectura; se muestra al modelo en el turno siguiente. */
  data?: string;
  finish?: FinishArgs;
  human?: HumanReason;
  pdf?: CapturedPdf;
  unexpectedDomain?: boolean;
  openedTarget?: boolean;
}

export interface ExecContext {
  port: BrowserPort;
  raw: RawPageSnapshot;
  policy: PolicyContext;
  provider: ProviderConfig;
  targetStudyId?: string;
  /** Se llama justo antes de intentar una descarga (para el límite por job). */
  onDownloadAttempt: () => void;
}

const HUMAN_REASONS = new Set(['captcha', 'mfa', 'session_expired', 'unknown_modal', 'ambiguous', 'security_check', 'portal_changed']);
const PDF_ACTION = /pdf|descarg|download|imprim|print|informe|resultado/i;

function findElement(ctx: ExecContext, args: Record<string, unknown>): RawElement | undefined {
  const id = typeof args.elementId === 'string' ? args.elementId : '';
  return ctx.raw.elements.find((e) => e.id === id);
}

const err = (note: string, element?: string): ExecResult => ({ outcome: 'error', note, ...(element ? { element } : {}) });
const blocked = (note: string, element?: string): ExecResult => ({ outcome: 'bloqueado', note, ...(element ? { element } : {}) });

function isUnexpectedDomain(e: unknown): boolean {
  return String(e).includes('UNEXPECTED_DOMAIN');
}

/** Si la página actual ya muestra un PDF (visor o embebido), lo obtiene con la sesión del navegador. */
async function pdfFromCurrentPage(ctx: ExecContext): Promise<CapturedPdf | null> {
  const snap = await ctx.port.snapshot([]).catch(() => null);
  if (!snap) return null;
  if (snap.isPdfViewer) return ctx.port.fetchPdf(ctx.port.currentUrl());
  for (const src of snap.pdfEmbeds.slice(0, 2)) {
    const pdf = await ctx.port.fetchPdf(src);
    if (pdf) return pdf;
  }
  return null;
}

/** Ejecuta UNA herramienta. Todas las verificaciones de política ocurren acá, no en el modelo. */
export async function executeTool(action: AgentAction, ctx: ExecContext): Promise<ExecResult> {
  const { port, policy } = ctx;
  const args = action.args ?? {};
  switch (action.tool) {
    case 'listStudies': {
      const result = await port.listStudies?.();
      if (!result) return { outcome: 'sin_efecto', note: 'el extractor del proveedor no reconoce esta página' };
      return { outcome: 'ok', note: 'listado extraído', data: JSON.stringify({ studyCount: result.studies.length, studies: result.studies }) };
    }
    case 'openStudy': {
      if (policy.goal !== 'DOWNLOAD_STUDY' || !ctx.targetStudyId) return blocked('no hay un estudio seleccionado');
      if (policy.targetOpened) return { outcome: 'sin_efecto', note: 'el estudio seleccionado ya está abierto' };
      if (!port.openStudy) return err('el proveedor no ofrece apertura por id opaco');
      const opened = await port.openStudy(ctx.targetStudyId);
      return opened ? { outcome: 'ok', note: 'estudio seleccionado abierto', openedTarget: true } : err('no se encontró el estudio seleccionado');
    }
    case 'findPdfAction': {
      if (policy.goal !== 'DOWNLOAD_STUDY' || !policy.targetOpened) return blocked('primero abrí el estudio seleccionado');
      const label = (await port.findPdfAction?.()) ?? ctx.raw.elements.find((el) => PDF_ACTION.test(el.label + ' ' + el.iconHint))?.label ?? null;
      return label
        ? { outcome: 'ok', note: 'acción PDF localizada', data: JSON.stringify({ available: true, label: maskLabel(label) }) }
        : { outcome: 'sin_efecto', note: 'no se encontró una acción PDF visible', data: JSON.stringify({ available: false }) };
    }
    case 'downloadCurrentStudyPdf': {
      if (policy.goal !== 'DOWNLOAD_STUDY') return blocked('no se descarga nada durante la búsqueda');
      if (!policy.targetOpened) return blocked('primero abrí el estudio seleccionado');
      if (policy.downloadsUsed >= policy.maxDownloads) return blocked('límite de descargas alcanzado');
      ctx.onDownloadAttempt();
      try {
        let pdf = await port.downloadCurrentStudyPdf?.();
        if (!port.downloadCurrentStudyPdf) {
          const candidate = ctx.raw.elements.find((el) => PDF_ACTION.test(el.label + ' ' + el.iconHint) && !downloadBlockReason(el, policy));
          if (candidate) pdf = await port.capturePdfDuring(() => port.click(candidate), 20_000);
        }
        return pdf ? { outcome: 'ok', note: 'PDF capturado', pdf } : { outcome: 'sin_efecto', note: 'no se obtuvo un PDF válido' };
      } catch (e) {
        if (isUnexpectedDomain(e)) return { ...err('dominio no permitido'), unexpectedDomain: true };
        return err('no se pudo obtener un PDF válido');
      }
    }
    case 'getPageSummary': {
      const r = ctx.raw;
      return {
        outcome: 'ok',
        note: 'resumen',
        data: JSON.stringify({
          title: r.pageType === 'result_detail' ? 'Documento del estudio' : maskLabel(r.title),
          path: maskPath(r.url),
          headings: r.pageType === 'result_detail' ? [] : r.headings.map((h) => maskLabel(h)),
          collections: r.pageType === 'result_detail' ? 0 : r.collections.length,
          elements: r.pageType === 'result_detail' ? r.elements.filter((e) => /pdf|descarg|download|imprim|print|informe|volver|regresar/i.test(e.label + ' ' + e.iconHint)).length : r.elements.length,
          modal: r.pageType === 'result_detail' ? false : r.modal,
          noResultsText: r.noResultsText,
        }),
      };
    }
    case 'getInteractiveElements': {
      const offset = Number.isInteger(args.offset) ? Math.max(0, args.offset as number) : 0;
      return { outcome: 'ok', note: 'elementos desde ' + offset, data: JSON.stringify(elementsPage(ctx.raw, policy, offset)) };
    }
    case 'getTables': {
      if (ctx.raw.pageType === 'result_detail') return blocked('se oculta el contenido clínico del detalle');
      const c = ctx.raw.collections.find((x) => x.id === args.collectionId);
      if (!c) return err('listado inexistente');
      return { outcome: 'ok', note: 'estructura de ' + c.id, data: JSON.stringify(collectionObs(c, 10, c.id === policy.targetCollection ? policy.targetRow : undefined)) };
    }
    case 'click': {
      const el = findElement(ctx, args);
      if (!el) return err('elemento inexistente');
      const label = maskLabel(el.label);
      const reason = elementBlockReason(el, policy);
      if (reason) return blocked(reason, label);
      const opensTarget = policy.goal === 'DOWNLOAD_STUDY' && el.collection === policy.targetCollection && el.row === policy.targetRow && policy.targetRow !== undefined;
      try {
        const { newPage } = await port.click(el);
        const res: ExecResult = { outcome: 'ok', note: newPage ? 'se abrió una pestaña nueva y quedó activa' : 'clic realizado', element: label };
        if (opensTarget) res.openedTarget = true;
        if (policy.goal === 'DOWNLOAD_STUDY' && (policy.targetOpened || opensTarget)) {
          const pdf = await port.waitForPdf(1500);
          if (pdf) res.pdf = pdf;
        }
        return res;
      } catch (e) {
        if (isUnexpectedDomain(e)) return { ...err('dominio no permitido', label), unexpectedDomain: true };
        return err(String(e).includes('ELEMENT_GONE') ? 'el elemento ya no está en la página' : 'no se pudo hacer clic', label);
      }
    }
    case 'openLink': {
      const el = findElement(ctx, args);
      if (!el) return err('elemento inexistente');
      const label = maskLabel(el.label);
      const reason = elementBlockReason(el, policy);
      if (reason) return blocked(reason, label);
      if (!/^https?:/i.test(el.href)) return err('no es un enlace navegable; usá click', label);
      if (!policy.domains.isAllowedNavigation(el.href)) return { ...blocked('dominio no permitido', label), unexpectedDomain: false };
      try {
        await port.navigate(el.href);
        const res: ExecResult = { outcome: 'ok', note: 'enlace abierto', element: label };
        if (policy.goal === 'DOWNLOAD_STUDY' && el.collection === policy.targetCollection && el.row === policy.targetRow && policy.targetRow !== undefined) {
          res.openedTarget = true;
        }
        return res;
      } catch (e) {
        if (isUnexpectedDomain(e)) return { ...err('dominio no permitido', label), unexpectedDomain: true };
        return err('no se pudo abrir el enlace', label);
      }
    }
    case 'goBack':
      return (await port.goBack()) ? { outcome: 'ok', note: 'volvió a la página anterior' } : { outcome: 'sin_efecto', note: 'no hay página anterior' };
    case 'wait': {
      const s = Number.isInteger(args.seconds) ? Math.min(5, Math.max(1, args.seconds as number)) : 2;
      await port.wait(s * 1000);
      return { outcome: 'ok', note: `esperó ${s} s` };
    }
    case 'scroll':
      await port.scroll(args.direction === 'up' ? 'up' : 'down');
      return { outcome: 'ok', note: 'desplazó la página' };
    case 'inspectCurrentUrl':
      return { outcome: 'ok', note: 'ruta actual', data: maskPath(port.currentUrl()) };
    case 'inspectNewPage':
      return (await port.switchToNewestPage())
        ? { outcome: 'ok', note: 'ahora está activa la pestaña más reciente' }
        : { outcome: 'sin_efecto', note: 'no hay otra pestaña permitida' };
    case 'findDownloadActions': {
      const list = ctx.raw.elements
        .filter((e) => PDF_ACTION.test(e.label + ' ' + e.iconHint) || ctx.provider.expectedPdfLabels.some((l) => e.label.toLowerCase().includes(l.toLowerCase())))
        .slice(0, 20)
        .map((e) => ({ id: e.id, label: maskLabel(e.label), icon: e.iconHint || undefined, row: e.row, blocked: downloadBlockReason(e, policy) }));
      return { outcome: list.length ? 'ok' : 'sin_efecto', note: list.length + ' acciones de documento', data: JSON.stringify(list) };
    }
    case 'downloadFromElement': {
      const el = findElement(ctx, args);
      if (!el) return err('elemento inexistente');
      const label = maskLabel(el.label);
      const reason = downloadBlockReason(el, policy);
      if (reason) return blocked(reason, label);
      ctx.onDownloadAttempt();
      try {
        let pdf = await port.capturePdfDuring(() => port.click(el), 20_000);
        if (!pdf) pdf = await pdfFromCurrentPage(ctx);
        return pdf ? { outcome: 'ok', note: 'PDF capturado', element: label, pdf } : { outcome: 'sin_efecto', note: 'no se obtuvo un PDF', element: label };
      } catch (e) {
        if (isUnexpectedDomain(e)) return { ...err('dominio no permitido', label), unexpectedDomain: true };
        return err('no se pudo usar la acción', label);
      }
    }
    case 'detectPdfResponse': {
      if (policy.goal !== 'DOWNLOAD_STUDY') return blocked('no se descarga nada durante la búsqueda');
      if (!policy.targetOpened) return blocked('primero abrí el estudio seleccionado');
      const s = Number.isInteger(args.seconds) ? Math.min(15, Math.max(1, args.seconds as number)) : 5;
      const pdf = (await port.waitForPdf(s * 1000)) ?? (await pdfFromCurrentPage(ctx));
      return pdf ? { outcome: 'ok', note: 'PDF capturado', pdf } : { outcome: 'sin_efecto', note: 'no hay un PDF en la página' };
    }
    case 'finishGoal': {
      const cols = (args.columns && typeof args.columns === 'object' ? args.columns : {}) as ColumnMapping;
      return {
        outcome: 'ok',
        note: 'fin de objetivo',
        finish: {
          ...(typeof args.collectionId === 'string' ? { collectionId: args.collectionId } : {}),
          columns: cols,
          noStudies: args.noStudies === true,
        },
      };
    }
    case 'requestHumanAction': {
      const reason = (HUMAN_REASONS.has(String(args.reason)) ? args.reason : 'ambiguous') as HumanReason;
      return { outcome: 'ok', note: 'pide intervención humana', human: reason };
    }
    default:
      return err('herramienta desconocida');
  }
}
