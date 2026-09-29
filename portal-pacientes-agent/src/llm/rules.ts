import type { AgentAction, AgentModel, AgentObservation, ElementObs } from '../agent/types.js';

/**
 * Modelo DETERMINISTA, sin IA. Usa la misma observación enmascarada y las mismas herramientas
 * que el modelo real. Sirve para tests en CI y como respaldo explícito (LLM_PROVIDER=rules).
 * No reemplaza al agente de IA en la demo.
 */
export class RulesModel implements AgentModel {
  readonly name = 'rules';
  /** Observaciones recibidas (solo en memoria, para verificar en tests qué ve el modelo). */
  readonly seen: AgentObservation[] = [];

  constructor(private readonly record = false) {}

  async decide(obs: AgentObservation): Promise<AgentAction> {
    if (this.record) this.seen.push(obs);
    if (obs.page.captchaSuspected) return { tool: 'requestHumanAction', args: { reason: 'captcha' } };
    if (obs.page.otpSuspected) return { tool: 'requestHumanAction', args: { reason: 'mfa' } };
    if (obs.page.modalOpen) return { tool: 'requestHumanAction', args: { reason: 'unknown_modal' } };
    return obs.goal.kind === 'DISCOVER_STUDIES' ? this.discover(obs) : this.download(obs);
  }

  private usable = (e: ElementObs) => !e.blocked && !e.disabled;

  private clickedBefore(obs: AgentObservation, e: ElementObs): boolean {
    return obs.history.some((h) => (h.tool === 'click' || h.tool === 'openLink') && h.element === e.label);
  }

  private discover(obs: AgentObservation): AgentAction {
    const list = obs.collections.find((c) => c.columnShapes.includes('fecha') && c.rowCount > 0);
    if (list) {
      const columns: Record<string, number> = {};
      list.headers.forEach((h, i) => {
        const n = h.toLowerCase();
        if (columns.deliveryDate === undefined && /entrega/.test(n)) columns.deliveryDate = i;
        else if (columns.protocol === undefined && /protocolo|n[°º]|orden/.test(n)) columns.protocol = i;
        else if (columns.status === undefined && /estado/.test(n)) columns.status = i;
        else if (columns.date === undefined && /fecha/.test(n)) columns.date = i;
      });
      if (columns.date === undefined) {
        const i = list.columnShapes.indexOf('fecha');
        if (i >= 0 && i !== columns.deliveryDate) columns.date = i;
      }
      return { tool: 'finishGoal', args: { collectionId: list.id, columns } };
    }
    if (obs.page.noResultsText) return { tool: 'finishGoal', args: { noStudies: true } };
    const nav = obs.elements.find((e) => this.usable(e) && /resultado|estudio|protocolo|informe/i.test(e.label) && !this.clickedBefore(obs, e));
    if (nav) return { tool: 'click', args: { elementId: nav.id } };
    if (!obs.history.some((h) => h.tool === 'wait')) return { tool: 'wait', args: { seconds: 2 } };
    return { tool: 'requestHumanAction', args: { reason: 'portal_changed' } };
  }

  private download(obs: AgentObservation): AgentAction {
    const t = obs.target;
    if (t?.alreadyOpened && (obs.page.isPdfViewer || obs.page.pdfEmbeds > 0)) return { tool: 'detectPdfResponse', args: { seconds: 5 } };
    const pdfLike = (e: ElementObs) => /pdf|descargar|informe|imprimir/i.test(e.label + ' ' + (e.icon ?? ''));
    const inTargetOrPage = (e: ElementObs) => e.target || (t?.alreadyOpened && e.collection === undefined);
    const dl = obs.elements.find((e) => this.usable(e) && pdfLike(e) && inTargetOrPage(e));
    if (dl && t?.alreadyOpened) return { tool: 'downloadCurrentStudyPdf', args: {} };
    if (dl && dl.target) return { tool: 'downloadFromElement', args: { elementId: dl.id } };
    if (!t?.alreadyOpened) {
      const open = obs.elements.find((e) => this.usable(e) && e.target && /ver|detalle|abrir|resultado/i.test(e.label))
        ?? obs.elements.find((e) => this.usable(e) && e.target);
      if (open) return { tool: 'click', args: { elementId: open.id } };
      if (!t?.visibleOnPage && !obs.history.some((h) => h.tool === 'goBack')) return { tool: 'goBack', args: {} };
    }
    if (obs.page.openPages > 1 && !obs.history.some((h) => h.tool === 'inspectNewPage')) return { tool: 'inspectNewPage', args: {} };
    return { tool: 'requestHumanAction', args: { reason: 'ambiguous' } };
  }
}
