import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { APIResponse, BrowserContext, Frame, Page, Response } from 'playwright';
import { MAX_PDF_BYTES, validatePdf, type CapturedPdf } from '../jobs/pdf.js';
import type { ProviderConfig } from '../providers/types.js';
import { LABWIN_EXTRACTOR_SOURCE, type LabwinExtraction, type LabwinRawStudy } from '../providers/percamb/study-extractor.js';
import { parseDate } from '../agent/studies.js';
import { DomainPolicy } from '../security/domain-policy.js';
import { sleep } from '../util.js';
import type { BrowserHost } from './browser-host.js';
import { COLLECTOR_SOURCE } from './collector.js';
import { ProviderParserMismatchError, type BrowserPort, type ProviderStudyList, type ProviderStudyMetadata, type ProviderStructureEvent, type RawElement, type RawPageSnapshot } from './types.js';

export class ProviderUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super('PROVIDER_UNAVAILABLE');
  }
}
export class UnexpectedDomainError extends Error {
  constructor() {
    super('UNEXPECTED_DOMAIN');
  }
}

export type PdfDownloadErrorCode = 'PDF_NOT_FOUND' | 'PDF_DOWNLOAD_TIMEOUT' | 'INVALID_DOCUMENT';
export class PdfDownloadError extends Error {
  constructor(readonly code: PdfDownloadErrorCode) {
    super(code);
  }
}

const RECENT_PDF_WINDOW_MS = 10_000;

/**
 * Sesión de navegador de UN job. La abre el sistema, la usa el paciente para iniciar sesión y
 * después la usa el agente, siempre a través de las operaciones de solo lectura de BrowserPort.
 */
export class BrowserSession implements BrowserPort {
  private page!: Page;
  private mainPage!: Page;
  private waiters: ((pdf: CapturedPdf) => void)[] = [];
  private recent: { pdf: CapturedPdf; at: number } | null = null;
  private closing = false;
  private pdfActionDepth = 0;
  private invalidPdfObservedAt = 0;
  private readonly providerStudies = new Map<string, { protocol: string; date?: string; deliveryDate?: string; status?: string; href: string; rowToken: string; actionToken: string; frame: number; listUrl: string }>();
  private activeStudyId: string | null = null;
  private readonly maxPdfBytes: number;
  private readonly pdfDownloadTimeoutMs: number;
  readonly policy: DomainPolicy;
  /** Se llama si la pestaña principal intenta ir a un dominio fuera de la allowlist. */
  onUnexpectedDomain: (() => void) | null = null;
  onNavigationBlocked: ((info: { scheme: string; host: string }) => void) | null = null;
  onPdfTrace: ((info: {
    stage: string; scheme?: string; host?: string; count?: number; strategy?: string; found?: boolean;
    tag?: string; hrefPresent?: boolean; sameOrigin?: boolean; hasOnclick?: boolean; target?: string;
    status?: number; contentType?: string; bytes?: number; errorCode?: string;
  }) => void) | null = null;
  onProviderStructure: ((info: ProviderStructureEvent) => void) | null = null;
  /** Se llama si el paciente cierra la ventana del laboratorio. */
  onUserClosed: (() => void) | null = null;

  private constructor(
    private readonly context: BrowserContext,
    readonly provider: ProviderConfig,
    private readonly headless: boolean,
    maxPdfBytes = MAX_PDF_BYTES,
    private readonly providerDebugStructure = false,
    pdfDownloadTimeoutMs = 60_000,
  ) {
    this.policy = new DomainPolicy(provider.allowedHosts, provider.staticHosts);
    this.maxPdfBytes = maxPdfBytes;
    this.pdfDownloadTimeoutMs = pdfDownloadTimeoutMs;
  }

  static async open(host: BrowserHost, provider: ProviderConfig, headless: boolean, maxPdfBytes = MAX_PDF_BYTES, providerDebugStructure = false, pdfDownloadTimeoutMs = 60_000): Promise<BrowserSession> {
    const context = await host.newContext();
    const s = new BrowserSession(context, provider, headless, maxPdfBytes, providerDebugStructure, pdfDownloadTimeoutMs);
    try {
      await s.install();
      s.page = s.mainPage = await context.newPage();
    } catch (e) {
      await context.close().catch(() => {});
      throw e;
    }
    return s;
  }

  private async install(): Promise<void> {
    // Allowlist de dominios. No se lee el cuerpo de ninguna solicitud (el login del paciente pasa por acá).
    await this.context.route('**/*', (route) => {
      const req = route.request();
      const url = req.url();
      let isMainNav = false;
      try {
        isMainNav = req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame();
      } catch {
        /* solicitudes sin frame */
      }
      const allowedDataPdf = this.pdfActionDepth > 0 && /^data:application\/pdf(?:;|,)/i.test(url);
      const actionViewer = this.pdfActionDepth > 0 && DomainPolicy.isBrowserPdfViewer(url);
      const allowed = allowedDataPdf || actionViewer || (req.isNavigationRequest() ? this.policy.isAllowedNavigation(url) : this.policy.isAllowedSubresource(url));
      if (allowed) return route.continue();
      if (isMainNav && !DomainPolicy.isTransientBlank(url)) {
        this.onNavigationBlocked?.(this.safeUrlParts(url));
        this.onUnexpectedDomain?.();
      }
      return route.abort('blockedbyclient');
    });
    this.context.on('page', (p) => this.attachPage(p));
    this.context.on('response', (r) => void this.onResponse(r));
  }

  private attachPage(p: Page): void {
    this.onPdfTrace?.({ stage: 'page_opened', ...this.safeUrlParts(p.url()) });
    p.on('download', async (d) => {
      try {
        this.onPdfTrace?.({ stage: 'download_event', ...this.safeUrlParts(d.url()) });
        const safeOrigin = this.policy.isAllowedNavigation(d.url()) || (this.pdfActionDepth > 0 && /^data:application\/pdf(?:;|,)/i.test(d.url()));
        if (!safeOrigin) return void d.cancel();
        const file = await d.path();
        if (!file) return;
        if ((await stat(file)).size > this.maxPdfBytes) {
          await d.cancel().catch(() => {});
          await d.delete().catch(() => {});
          return;
        }
        const buffer = await readFile(file);
        await d.delete().catch(() => {});
        this.offer({ buffer, contentType: null, via: 'download' });
      } catch {
        /* descarga cancelada o contexto cerrado */
      }
    });
    p.on('close', () => {
      if (!this.closing && this.context.pages().length === 0) this.onUserClosed?.();
      if (p === this.page) this.page = this.context.pages().at(-1) ?? this.mainPage;
    });
  }

  private async onResponse(r: Response): Promise<void> {
    const headers = r.headers();
    const ct = headers['content-type'] || '';
    const cd = headers['content-disposition'] || '';
    if (!/pdf/i.test(ct) && !/\.pdf/i.test(cd)) return;
    this.onPdfTrace?.({ stage: 'pdf_response', ...this.safeUrlParts(r.url()) });
    if (r.status() >= 300 || !this.policy.isAllowedNavigation(r.url())) return;
    const announcedSize = Number(headers['content-length']);
    if (Number.isFinite(announcedSize) && announcedSize > this.maxPdfBytes) return;
    try {
      const buffer = await Promise.race([r.body(), sleep(5000).then(() => null)]);
      if (!buffer) return;
      this.onPdfTrace?.({ stage: 'response_body', ...this.safeUrlParts(r.url()) });
      if (validatePdf(buffer, ct || null, this.maxPdfBytes).ok) this.offer({ buffer, contentType: ct || null, via: 'response' });
      else {
        this.invalidPdfObservedAt = Date.now();
        this.onPdfTrace?.({ stage: 'response_invalid', ...this.safeUrlParts(r.url()) });
      }
    } catch {
      /* el cuerpo no siempre está disponible (p. ej. si se convirtió en descarga); lo cubre el evento download */
    }
  }

  private offer(pdf: CapturedPdf): void {
    if (!validatePdf(pdf.buffer, pdf.contentType, this.maxPdfBytes).ok) return;
    this.onPdfTrace?.({ stage: 'pdf_captured', scheme: pdf.via, host: 'none', count: this.waiters.length });
    const w = this.waiters.shift();
    if (w) w(pdf);
    else this.recent = { pdf, at: Date.now() };
  }

  private nextPdf(timeoutMs: number, signal?: AbortSignal): Promise<CapturedPdf | null> {
    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(t);
        this.waiters = this.waiters.filter((w) => w !== waiter);
        signal?.removeEventListener('abort', onAbort);
      };
      const waiter = (pdf: CapturedPdf) => {
        cleanup();
        resolve(pdf);
      };
      const onAbort = () => {
        cleanup();
        resolve(null);
      };
      const t = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      if (signal?.aborted) {
        cleanup();
        resolve(null);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private takeRecentPdf(): CapturedPdf | null {
    if (!this.recent || Date.now() - this.recent.at >= RECENT_PDF_WINDOW_MS) return null;
    const pdf = this.recent.pdf;
    this.recent = null;
    return pdf;
  }

  /* ---------------- Operaciones del sistema (no disponibles para el agente) ---------------- */

  async gotoLogin(): Promise<void> {
    let res: Response | null;
    try {
      res = await this.mainPage.goto(this.provider.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch {
      throw new ProviderUnavailableError(null);
    }
    if (!res || res.status() >= 500) throw new ProviderUnavailableError(res?.status() ?? null);
    if (!this.headless) await this.mainPage.bringToFront().catch(() => {});
  }

  /** Cierra pestañas secundarias (PDF abiertos, etc.) y vuelve a la principal. */
  async closeExtraPages(): Promise<void> {
    for (const p of this.context.pages()) {
      if (p === this.mainPage) continue;
      const closing = p.close({ runBeforeUnload: false }).catch(() => {});
      await Promise.race([closing, sleep(1500)]);
    }
    this.page = this.mainPage;
  }

  /** Página activa (para tests y para que el paciente complete pasos humanos). */
  activePage(): Page {
    return this.page;
  }

  get isClosed(): boolean {
    return this.closing;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.waiters.forEach((w) => w(null as unknown as CapturedPdf));
    this.waiters = [];
    this.recent = null;
    await this.context.close().catch(() => {});
  }

  /* ---------------- BrowserPort (lo que usan el detector de login y el agente) ---------------- */

  async snapshot(hints: string[]): Promise<RawPageSnapshot> {
    const frames = this.page.frames();
    let merged: RawPageSnapshot | null = null;
    for (let i = 0; i < frames.length && i < 8; i++) {
      const f = frames[i];
      if (i > 0 && !this.policy.isAllowedNavigation(f.url())) continue;
      let part: RawPageSnapshot;
      try {
        part = (await f.evaluate(`(${COLLECTOR_SOURCE})(${JSON.stringify({ frame: i, hints })})`)) as RawPageSnapshot;
      } catch {
        if (i === 0) throw new Error('SNAPSHOT_FAILED');
        continue;
      }
      if (!merged) {
        merged = part;
        continue;
      }
      merged.headings.push(...part.headings);
      merged.hintHits = [...new Set([...merged.hintHits, ...part.hintHits])];
      merged.hasPasswordField ||= part.hasPasswordField;
      merged.captcha ||= part.captcha;
      merged.otp ||= part.otp;
      merged.modal ||= part.modal;
      merged.modalText ||= part.modalText;
      merged.noResultsText ||= part.noResultsText;
      merged.isPdfViewer ||= part.isPdfViewer;
      merged.pdfEmbeds.push(...part.pdfEmbeds);
      merged.elements.push(...part.elements);
      merged.collections.push(...part.collections);
    }
    if (!merged) throw new Error('SNAPSHOT_FAILED');
    merged.url = this.page.url();
    if (this.provider.studyExtractor === 'labwin') {
      const resultsHint = merged.hintHits.some((h) => /RESULTADOS ONLINE/i.test(h));
      const pdfAction = merged.elements.some((e) => /pdf|descarg|download|imprim|print|informe/i.test(e.label + ' ' + e.iconHint));
      const resultHeading = merged.headings.some((h) => /RESULTADOS ONLINE/i.test(h));
      const detected = resultsHint ? await this.extractLabwinRows() : null;
      const resultsList = resultsHint && (resultHeading || merged.noResultsText || merged.collections.length > 0 || !!detected?.resultActions);
      merged.pageType = resultsList && !pdfAction ? 'results_list' : pdfAction || merged.isPdfViewer || merged.pdfEmbeds.length ? 'result_detail' : 'unknown';
    }
    return merged;
  }

  private safeUrlParts(url: string): { scheme: string; host: string } {
    try {
      const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0]?.replace(/:$/, '').toLowerCase() || 'unknown';
      const parsed = new URL(/^blob:/i.test(url) ? url.slice(5) : url);
      return { scheme: scheme.slice(0, 20), host: parsed.hostname.toLowerCase().slice(0, 64) || 'none' };
    } catch {
      const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0]?.replace(/:$/, '').slice(0, 20) || 'unknown';
      return { scheme, host: 'none' };
    }
  }

  private async extractLabwinRows(): Promise<{ recognized: boolean; listUrl: string; resultActions: number; resultLinks: number; candidateRows: number; metadataComplete: number; structure: ProviderStructureEvent[]; rows: (LabwinRawStudy & { frame: number })[] }> {
    const frames = this.page.frames();
    let recognized = false;
    let resultActions = 0;
    let resultLinks = 0;
    let candidateRows = 0;
    let metadataComplete = 0;
    const structure: ProviderStructureEvent[] = [];
    const rows: (LabwinRawStudy & { frame: number })[] = [];
    for (let frame = 0; frame < frames.length && frame < 8; frame++) {
      const f = frames[frame];
      if (frame > 0 && !this.policy.isAllowedNavigation(f.url())) continue;
      const prefix = randomUUID();
      const result = await f.evaluate(`(${LABWIN_EXTRACTOR_SOURCE})(${JSON.stringify({ prefix })})`).catch(() => null) as LabwinExtraction | null;
      if (!result?.recognized) continue;
      recognized = true;
      const actionOffset = resultActions;
      resultActions += result.resultActions;
      resultLinks += result.resultLinks;
      candidateRows += result.candidateRows;
      metadataComplete += result.metadataComplete;
      for (const item of result.structure) {
        const { index, depth, tag, links, textNodes, siblings, classType, hrefMatch } = item;
        structure.push({ event: depth === 0 ? 'percamb_action' : 'percamb_ancestor', index: index + actionOffset, depth, tag, links, textNodes, siblings, classType, hrefMatch });
      }
      rows.push(...result.rows.map((row) => ({ ...row, frame })));
    }
    return { recognized, listUrl: this.page.url(), resultActions, resultLinks, candidateRows, metadataComplete, structure, rows };
  }

  private providerStructure(event: ProviderStructureEvent['event'], count?: number, details: Partial<ProviderStructureEvent> = {}): void {
    if (this.providerDebugStructure) this.onProviderStructure?.({ event, ...(count === undefined ? {} : { count }), ...details });
  }

  /** Extrae todas las filas visibles; referencias y protocolo quedan solo en memoria del job. */
  async listStudies(): Promise<ProviderStudyList | null> {
    if (this.provider.studyExtractor !== 'labwin') return null;
    const extraction = await this.extractLabwinRows();
    if (!extraction.recognized) return null;
    this.providerStructure('percamb_page');
    this.providerStructure('percamb_result_links', extraction.resultLinks);
    this.providerStructure('percamb_result_actions', extraction.resultActions);
    this.providerStructure('percamb_candidate_rows', extraction.candidateRows);
    this.providerStructure('percamb_metadata_complete', extraction.metadataComplete);
    for (const item of extraction.structure) this.providerStructure(item.event, undefined, item);
    if (extraction.resultActions > 0 && extraction.rows.length === 0) {
      this.providerStructure('percamb_parsed_studies', 0);
      throw new ProviderParserMismatchError(extraction.resultActions, extraction.candidateRows);
    }
    const studies: ProviderStudyMetadata[] = [];
    for (const row of extraction.rows) {
      const date = parseDate(row.date);
      const deliveryDate = parseDate(row.deliveryDate);
      const protocol = (row.protocol || '').replace(/[^A-Za-z0-9./ -]/g, '').trim().slice(0, 32);
      const href = row.href && this.policy.isAllowedNavigation(row.href) ? row.href : '';
      if (!row.rowToken || !row.actionToken || (!date && !protocol && !href)) continue;
      const id = randomUUID();
      const rawStatus = row.status || '';
      const status = /^(finalizad[oa]s?|complet[oa]s?|parcial(?:es)?|pendientes?|entregad[oa]s?|en proceso|disponibles?|list[oa]s?|validada?|terminad[oa]s?|impres[oa]s?|enviad[oa]s?|en curso)$/i.test(rawStatus) ? rawStatus : '';
      const metadata: ProviderStudyMetadata = { id, ...(date ? { date } : {}), ...(deliveryDate ? { deliveryDate } : {}), ...(status ? { status } : {}) };
      this.providerStudies.set(id, {
        protocol,
        ...(date ? { date } : {}),
        ...(deliveryDate ? { deliveryDate } : {}),
        ...(status ? { status } : {}),
        href,
        rowToken: row.rowToken,
        actionToken: row.actionToken,
        frame: row.frame,
        listUrl: extraction.listUrl,
      });
      studies.push(metadata);
    }
    this.providerStructure('percamb_parsed_studies', studies.length);
    if ((extraction.resultLinks > 0 && studies.length < extraction.resultLinks) || (extraction.resultActions > 0 && studies.length === 0)) {
      throw new ProviderParserMismatchError(extraction.resultActions, extraction.candidateRows, studies.length);
    }
    return { recognized: true, listUrl: extraction.listUrl, studies };
  }

  /** Señales estructurales para el fast path del proveedor; nunca retorna texto del paciente. */
  async isPercambResultsPage(): Promise<boolean> {
    if (this.provider.studyExtractor !== 'labwin') return false;
    let current: URL;
    let login: URL;
    try {
      current = new URL(this.page.url());
      login = new URL(this.provider.loginUrl);
    } catch {
      return false;
    }
    const basePath = login.pathname.replace(/login\/?$/i, '');
    const underProviderPath = current.origin === login.origin && current.pathname.startsWith(basePath) && !this.provider.loginPathPattern.test(current.pathname);
    if (!underProviderPath) return false;
    if (this.provider.id === 'percamb' && !/\/lwcloud\/percamb\/rol/i.test(current.pathname)) return false;
    const snap = await this.snapshot(this.provider.authenticatedHints).catch(() => null);
    if (!snap || snap.hasPasswordField) return false;
    return [...snap.hintHits, ...snap.headings].some((text) => /RESULTADOS ONLINE/i.test(text));
  }

  isStudyOpen(studyId: string): boolean {
    return this.activeStudyId === studyId;
  }

  hasStudy(studyId: string): boolean {
    return this.providerStudies.has(studyId);
  }

  /** Resuelve el id opaco a la acción exacta detectada; no elige por posición de fila. */
  async openStudy(studyId: string): Promise<boolean> {
    const target = this.providerStudies.get(studyId);
    if (!target || this.provider.studyExtractor !== 'labwin') return false;
    if (this.page.url() !== target.listUrl) {
      if (!this.policy.isAllowedNavigation(target.listUrl)) throw new UnexpectedDomainError();
      await this.navigate(target.listUrl);
    }
    if (target.href && /ver_resultado/i.test(new URL(target.href).pathname)) {
      if (!this.policy.isAllowedNavigation(target.href)) throw new UnexpectedDomainError();
      await this.navigate(target.href);
      this.activeStudyId = studyId;
      return true;
    }
    let frameIndex = target.frame;
    let rowToken = target.rowToken;
    let actionToken = target.actionToken;
    let frame = this.page.frames()[frameIndex];
    let action = frame?.locator(`[data-pp-study-row="${rowToken}"] [data-pp-study-action="${actionToken}"]`).first();
    let actionCount = await action?.count().catch(() => 0) ?? 0;
    if (!actionCount && frame) {
      action = frame.locator(`[data-pp-study-action="${actionToken}"]`).first();
      actionCount = await action.count().catch(() => 0);
    }

    // Si la página fue recargada, reidentifica por href o metadata interna y exige una coincidencia única.
    if (!actionCount) {
      const fresh = await this.extractLabwinRows();
      if (!fresh.recognized) return false;
      const matches = fresh.rows.filter((row) => {
        if (target.href) return row.href === target.href;
        const hasIdentity = !!(target.date || target.protocol || target.deliveryDate || target.status);
        if (!hasIdentity) return false;
        return (!target.date || (parseDate(row.date) ?? '') === target.date) &&
          (!target.protocol || (row.protocol || '').replace(/[^A-Za-z0-9./ -]/g, '').trim().slice(0, 32) === target.protocol) &&
          (!target.deliveryDate || (parseDate(row.deliveryDate) ?? '') === target.deliveryDate) &&
          (!target.status || row.status === target.status);
      });
      if (matches.length !== 1) return false;
      const match = matches[0];
      frameIndex = match.frame;
      rowToken = match.rowToken;
      actionToken = match.actionToken;
      target.rowToken = rowToken;
      target.actionToken = actionToken;
      target.frame = frameIndex;
      target.href = match.href && this.policy.isAllowedNavigation(match.href) ? match.href : target.href;
      frame = this.page.frames()[frameIndex];
      action = frame?.locator(`[data-pp-study-row="${rowToken}"] [data-pp-study-action="${actionToken}"]`).first();
      actionCount = await action?.count().catch(() => 0) ?? 0;
      if (!actionCount && frame) {
        action = frame.locator(`[data-pp-study-action="${actionToken}"]`).first();
        actionCount = await action.count().catch(() => 0);
      }
    }
    if (!frame || !action || !actionCount) return false;
    const detail = await action.evaluate((el) => {
      const e = el as HTMLElement;
      const text = 'innerText' in e ? String((e as HTMLElement).innerText || '') : '';
      const label = (e.getAttribute('aria-label') || e.getAttribute('title') || (text.length <= 64 ? text : '')).replace(/\s+/g, ' ').trim();
      const ancestorLink = e.closest('a[href]');
      const href = e instanceof HTMLAnchorElement ? e.href : ancestorLink instanceof HTMLAnchorElement ? ancestorLink.href : '';
      return { label, href, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', target: e.getAttribute('target') || '', type: e.getAttribute('type') || '', disabled: (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true', isSubmit: (e as HTMLButtonElement).type === 'submit', inForm: !!e.closest('form') };
    }).catch(() => null);
    if (!detail || detail.disabled || detail.isSubmit || detail.inForm || /(?:eliminar|borrar|cambiar|cancelar|confirmar|aceptar|enviar|guardar|pagar|cerrar sesi|otro paciente|grupo familiar)/i.test(detail.label)) return false;
    if (detail.href && !this.policy.isAllowedNavigation(detail.href)) {
      this.onNavigationBlocked?.(this.safeUrlParts(detail.href));
      this.onUnexpectedDomain?.();
      throw new UnexpectedDomainError();
    }
    const id = 'study-' + actionToken;
    const item: RawElement = {
      id, frame: frameIndex, tag: detail.tag, role: detail.role || (detail.tag === 'a' ? 'link' : 'button'), label: detail.label,
      iconHint: 'eye', href: detail.href, target: detail.target, type: detail.type, disabled: detail.disabled,
      inPasswordForm: false, isSubmit: detail.isSubmit,
    };
    await this.click(item);
    this.activeStudyId = studyId;
    return true;
  }

  async findPdfAction(): Promise<string | null> {
    if (!this.activeStudyId) return null;
    const snap = await this.snapshot([]).catch(() => null);
    if (!snap || snap.pageType === 'results_list') return null;
    const action = snap.elements.find((el) => /pdf|descarg|download|imprim|print|informe/i.test(el.label + ' ' + el.iconHint) && !/(?:cambiar|eliminar|cancelar|enviar|guardar|pagar)/i.test(el.label));
    return action?.label || (action?.iconHint ? 'Ver documento PDF' : null) || null;
  }

  private contentTypeKind(value: string): string {
    const mime = value.split(';', 1)[0].trim().toLowerCase();
    if (mime === 'application/pdf' || mime.endsWith('/pdf')) return 'application_pdf';
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'text_html';
    if (/octet-stream|binary|force-download|x-download/.test(mime)) return 'application_octet_stream';
    return mime ? 'other' : 'unknown';
  }

  private async inspectPdfAction(action: RawElement): Promise<{ href: string; sameOrigin: boolean; hasOnclick: boolean; target: string; tag: string } | null> {
    const locator = await this.locate(action).catch(() => null);
    if (!locator) return null;
    return locator.evaluate((node) => {
      const element = node as HTMLElement;
      const link = element instanceof HTMLAnchorElement ? element : element.closest('a[href]');
      const rawHref = (link instanceof HTMLAnchorElement ? link.getAttribute('href') : null) ||
        element.getAttribute('data-href') || element.getAttribute('data-url') || '';
      let href = '';
      let sameOrigin = false;
      try {
        const resolved = new URL(rawHref, location.href);
        if (/^https?:$/.test(resolved.protocol)) {
          href = resolved.href;
          sameOrigin = resolved.origin === location.origin;
        }
      } catch { /* enlace no navegable */ }
      const hasOnclick = !!element.getAttribute('onclick') || typeof (element as HTMLElement & { onclick?: unknown }).onclick === 'function' ||
        !!link?.getAttribute('onclick');
      const rawTarget = (link instanceof HTMLAnchorElement ? link.getAttribute('target') : null) || element.getAttribute('target') || '';
      const target = /^_(blank|self|parent|top)$/i.test(rawTarget) ? rawTarget.toLowerCase() : rawTarget ? 'other' : 'none';
      return { href, sameOrigin, hasOnclick, target, tag: element.tagName.toLowerCase().slice(0, 12) };
    }).catch(() => null);
  }

  private notifyBlockedUrl(url: string): void {
    this.onNavigationBlocked?.(this.safeUrlParts(url));
    this.onUnexpectedDomain?.();
  }

  /** GET autenticado, validando manualmente cada redirect antes de seguirlo. */
  private async requestPdfSource(url: string, deadline: number): Promise<{ pdf: CapturedPdf | null; invalid: boolean; notFound?: boolean }> {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      if (!/^https?:/i.test(current) || !this.policy.isAllowedNavigation(current)) {
        this.notifyBlockedUrl(current);
        throw new UnexpectedDomainError();
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT');
      let response: APIResponse;
      try {
        response = await this.context.request.get(current, { timeout: remaining, maxRedirects: 0 });
      } catch (error) {
        if (Date.now() >= deadline || /timeout|timed out/i.test(String(error))) throw new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT');
        return { pdf: null, invalid: false };
      }
      const status = response.status();
      const headers = response.headers();
      const contentType = headers['content-type'] || null;
      this.onPdfTrace?.({ stage: 'percamb_pdf_response', ...this.safeUrlParts(current), status, contentType: this.contentTypeKind(contentType || '') });
      if (status >= 300 && status < 400) {
        const location = headers.location;
        await response.dispose().catch(() => {});
        if (!location || hop === 5) return { pdf: null, invalid: false, notFound: true };
        try { current = new URL(location, current).href; } catch { return { pdf: null, invalid: false, notFound: true }; }
        if (!this.policy.isAllowedNavigation(current)) {
          this.notifyBlockedUrl(current);
          throw new UnexpectedDomainError();
        }
        continue;
      }
      if (!response.ok()) {
        await response.dispose().catch(() => {});
        return { pdf: null, invalid: false, notFound: status === 404 || status === 410 };
      }
      const announcedSize = Number(headers['content-length']);
      if (Number.isFinite(announcedSize) && announcedSize > this.maxPdfBytes) {
        await response.dispose().catch(() => {});
        return { pdf: null, invalid: true };
      }
      const buffer = await response.body();
      const disposition = headers['content-disposition'] || '';
      const claimsPdf = /pdf/i.test(contentType || '') || /\.pdf(?:[;?\s]|$)/i.test(disposition) || /\.pdf$/i.test(new URL(current).pathname);
      await response.dispose().catch(() => {});
      const check = validatePdf(buffer, contentType, this.maxPdfBytes);
      if (check.ok) {
        if (check.mimeMismatch) this.onPdfTrace?.({ stage: 'percamb_pdf_mime_warning', contentType: this.contentTypeKind(contentType || '') });
        const pdf: CapturedPdf = { buffer, contentType, via: 'fetch' };
        this.onPdfTrace?.({ stage: 'percamb_pdf_valid', bytes: buffer.length, strategy: 'context_request' });
        return { pdf, invalid: false };
      }
      if (check.reason === 'TOO_LARGE' || claimsPdf) return { pdf: null, invalid: true };
      return { pdf: null, invalid: false };
    }
    return { pdf: null, invalid: false };
  }

  private async withPdfTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT')), Math.max(1, timeoutMs)); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fetchPdfUntil(url: string, deadline: number): Promise<CapturedPdf | null> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT');
    if (/^https?:/i.test(url)) {
      const result = await this.requestPdfSource(url, deadline);
      if (result.invalid) throw new PdfDownloadError('INVALID_DOCUMENT');
      return result.pdf;
    }
    return this.withPdfTimeout(this.fetchPdf(url, remaining), remaining);
  }

  /** Lee solo los src declarados por visores PDF; no colecta texto ni resultados del detalle. */
  private async currentPdfSources(): Promise<{ isPdf: boolean; embeds: string[] }> {
    return this.page.evaluate(() => {
      const embeds = Array.from(document.querySelectorAll('embed,object,iframe'))
        .map((el) => el.getAttribute('src') || el.getAttribute('data') || '')
        .filter(Boolean)
        .map((src) => { try { return new URL(src, location.href).href; } catch { return ''; } })
        .filter(Boolean);
      return { isPdf: document.contentType === 'application/pdf', embeds };
    }).catch(() => ({ isPdf: false, embeds: [] }));
  }

  async downloadCurrentStudyPdf(): Promise<CapturedPdf | null> {
    if (!this.activeStudyId) throw new PdfDownloadError('PDF_NOT_FOUND');
    const before = await this.snapshot([]).catch(() => null);
    const currentUrl = this.page.url();
    if (before?.isPdfViewer && /^https?:/i.test(currentUrl) && this.policy.isAllowedNavigation(currentUrl)) {
      const deadline = Date.now() + this.pdfDownloadTimeoutMs;
      this.onPdfTrace?.({ stage: 'percamb_pdf_strategy', strategy: 'context_request' });
      this.onPdfTrace?.({ stage: 'pdf_download_started', strategy: 'context_request' });
      const currentPdf = await this.fetchPdfUntil(currentUrl, deadline);
      if (currentPdf) return currentPdf;
    }
    const embeddedDeadline = Date.now() + this.pdfDownloadTimeoutMs;
    for (const src of before?.pdfEmbeds.slice(0, 2) ?? []) {
      this.onPdfTrace?.({ stage: 'percamb_pdf_strategy', strategy: 'embedded_source' });
      this.onPdfTrace?.({ stage: 'pdf_download_started', strategy: 'embedded_source' });
      const embedded = await this.fetchPdfUntil(src, embeddedDeadline);
      if (embedded) return embedded;
    }

    const action = before?.elements.find((el) => /pdf|descarg|download|imprim|print|informe/i.test(el.label + ' ' + el.iconHint) && !/(?:cambiar|eliminar|cancelar|enviar|guardar|pagar)/i.test(el.label));
    if (!action) {
      this.onPdfTrace?.({ stage: 'percamb_pdf_action', found: false });
      throw new PdfDownloadError('PDF_NOT_FOUND');
    }
    const details = await this.inspectPdfAction(action);
    const sameOrigin = details?.sameOrigin ?? false;
    this.onPdfTrace?.({
      stage: 'percamb_pdf_action', found: true, tag: details?.tag || action.tag,
      hrefPresent: !!details?.href, sameOrigin, hasOnclick: details?.hasOnclick ?? false,
      target: details?.target || 'none',
    });

    const deadline = Date.now() + this.pdfDownloadTimeoutMs;
    if (details?.href) {
      if (!this.policy.isAllowedNavigation(details.href)) {
        this.notifyBlockedUrl(details.href);
        throw new UnexpectedDomainError();
      }
      this.onPdfTrace?.({ stage: 'percamb_pdf_strategy', strategy: 'context_request' });
      this.onPdfTrace?.({ stage: 'pdf_download_started', strategy: 'context_request' });
      const direct = await this.requestPdfSource(details.href, deadline);
      if (direct.pdf) return direct.pdf;
      if (direct.invalid) throw new PdfDownloadError('INVALID_DOCUMENT');
      if (direct.notFound) throw new PdfDownloadError('PDF_NOT_FOUND');
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT');
    const invalidBefore = this.invalidPdfObservedAt;
    this.onPdfTrace?.({ stage: 'percamb_pdf_strategy', strategy: 'click_capture' });
    this.onPdfTrace?.({ stage: 'pdf_download_started', strategy: 'click_capture' });
    const pagesBefore = this.context.pages().length;
    const sourceUrl = this.page.url();
    const captured = await this.capturePdfDuring(async () => {
      await this.click(action);
      const activeUrl = this.page.url();
      if (activeUrl !== sourceUrl && /^(?:data:application\/pdf|blob:)/i.test(activeUrl)) {
        const inline = await this.fetchPdfUntil(activeUrl, deadline);
        if (inline) return inline;
      }
      if (activeUrl !== sourceUrl && /^https?:/i.test(activeUrl) && this.policy.isAllowedNavigation(activeUrl)) {
        const fetched = await this.fetchPdfUntil(activeUrl, deadline);
        if (fetched) return fetched;
      }
      const after = await this.currentPdfSources();
      if (after.isPdf && activeUrl !== sourceUrl && this.policy.isAllowedNavigation(activeUrl)) {
        const fetched = await this.fetchPdfUntil(activeUrl, deadline);
        if (fetched) return fetched;
      }
      for (const src of after.embeds.slice(0, 2)) {
        const fetched = await this.fetchPdfUntil(src, deadline);
        if (fetched) return fetched;
      }
      return null;
    }, remaining);
    if (captured) {
      const strategy = captured.via === 'download' ? 'download_event' : this.context.pages().length > pagesBefore ? 'popup_response' : 'response_capture';
      this.onPdfTrace?.({ stage: 'percamb_pdf_strategy', strategy });
      this.onPdfTrace?.({ stage: 'percamb_pdf_valid', bytes: captured.buffer.length, strategy });
      return captured;
    }
    if (this.invalidPdfObservedAt > invalidBefore) throw new PdfDownloadError('INVALID_DOCUMENT');

    const after = await this.currentPdfSources();
    if (after.isPdf && this.policy.isAllowedNavigation(this.page.url())) {
      const fetched = await this.fetchPdf(this.page.url());
      if (fetched) return fetched;
    }
    for (const src of after.embeds.slice(0, 2)) {
      const fetched = await this.fetchPdf(src);
      if (fetched) return fetched;
    }
    if (Date.now() >= deadline) throw new PdfDownloadError('PDF_DOWNLOAD_TIMEOUT');
    throw new PdfDownloadError('PDF_NOT_FOUND');
  }

  private async locate(el: RawElement) {
    const frames: Frame[] = this.page.frames();
    const ordered = [frames[el.frame], ...frames].filter(Boolean) as Frame[];
    for (const f of ordered) {
      const loc = f.locator(`[data-pp-id="${el.id.replace(/[^\w-]/g, '')}"]`).first();
      if ((await loc.count().catch(() => 0)) > 0) return loc;
    }
    throw new Error('ELEMENT_GONE');
  }

  private async settle(): Promise<void> {
    await sleep(350);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await Promise.race([this.page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {}), sleep(4_000)]);
  }

  async click(el: RawElement): Promise<{ newPage: boolean }> {
    const loc = await this.locate(el);
    const before = new Set(this.context.pages());
    try {
      await loc.click({ timeout: 8_000, ...(this.pdfActionDepth > 0 ? { noWaitAfter: true } : {}) });
    } catch (e) {
      // Si el clic provocó una descarga directa, Playwright puede reportarlo como error de navegación.
      if (!/download/i.test(String(e))) throw e;
    }
    if (this.pdfActionDepth > 0) await sleep(250);
    else await this.settle();
    const opened = this.context.pages().filter((p) => !before.has(p));
    if (opened.length) {
      const p = opened.at(-1)!;
      await p.waitForLoadState('domcontentloaded', { timeout: 2_500 }).catch(() => {});
      if (DomainPolicy.isTransientBlank(p.url())) {
        await p.waitForURL((url) => !DomainPolicy.isTransientBlank(url.href), { timeout: 1_500 }).catch(() => {});
      }
      const openedUrl = p.url();
      if (DomainPolicy.isBrowserPdfViewer(openedUrl) && this.pdfActionDepth > 0) {
        // Ignoramos la UI del visor del navegador; la captura se hace desde response/download.
        return { newPage: true };
      }
      if (this.pdfActionDepth > 0 && /^data:application\/pdf(?:;|,)/i.test(openedUrl)) {
        this.page = p;
        return { newPage: true };
      }
      if (DomainPolicy.isTransientBlank(openedUrl)) return { newPage: true };
      if (!this.policy.isAllowedNavigation(openedUrl)) {
        this.onNavigationBlocked?.(this.safeUrlParts(openedUrl));
        this.onUnexpectedDomain?.();
        await p.close().catch(() => {});
        throw new UnexpectedDomainError();
      }
      this.page = p;
      return { newPage: true };
    }
    return { newPage: false };
  }

  async navigate(url: string): Promise<void> {
    if (!/^https?:/i.test(url) || !this.policy.isAllowedNavigation(url)) throw new UnexpectedDomainError();
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch (e) {
      if (!/download/i.test(String(e))) throw e;
    }
    await this.settle();
  }

  async goBack(): Promise<boolean> {
    const res = await this.page.goBack({ timeout: 10_000, waitUntil: 'domcontentloaded' }).catch(() => null);
    await this.settle();
    return res !== null;
  }

  async switchToNewestPage(): Promise<boolean> {
    const newest = this.context.pages().at(-1);
    if (!newest || newest === this.page) return false;
    if (!this.policy.isAllowedNavigation(newest.url())) return false;
    this.page = newest;
    if (!this.headless) await newest.bringToFront().catch(() => {});
    return true;
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.page.mouse.wheel(0, direction === 'down' ? 650 : -650);
    await sleep(300);
  }

  wait(ms: number): Promise<void> {
    return sleep(ms);
  }

  async capturePdfDuring(action: () => Promise<unknown>, timeoutMs: number): Promise<CapturedPdf | null> {
    this.recent = null;
    this.pdfActionDepth++;
    const controller = new AbortController();
    const next = this.nextPdf(timeoutMs, controller.signal);
    let actionError: unknown;
    let actionResult: unknown;
    const actionDone = Promise.resolve().then(action)
      .then((value) => { actionResult = value; return true; })
      .catch((e: unknown) => {
        actionError = e;
        return false;
      })
      .finally(() => { this.pdfActionDepth = Math.max(0, this.pdfActionDepth - 1); });
    try {
      const first = await Promise.race([
        next.then((pdf) => pdf ? ({ kind: 'pdf' as const, pdf }) : ({ kind: 'timeout' as const })),
        actionDone.then(() => ({ kind: 'action' as const })),
      ]);
      if (first.kind === 'pdf') return first.pdf;
      if (first.kind === 'action') {
        const inline = this.asCapturedPdf(actionResult);
        if (inline && validatePdf(inline.buffer, inline.contentType, this.maxPdfBytes).ok) return inline;
        const pdf = await next;
        if (pdf) return pdf;
        const recent = this.takeRecentPdf();
        if (recent) return recent;
        if (actionError !== undefined) throw actionError;
        return null;
      }
      // No se espera indefinidamente una navegación/página que quedó abierta sin response.
      const inline = this.asCapturedPdf(actionResult);
      if (inline && validatePdf(inline.buffer, inline.contentType, this.maxPdfBytes).ok) return inline;
      const recent = this.takeRecentPdf();
      if (recent) return recent;
      return null;
    } finally {
      controller.abort();
    }
  }

  private asCapturedPdf(value: unknown): CapturedPdf | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<CapturedPdf>;
    return Buffer.isBuffer(candidate.buffer) && (candidate.via === 'download' || candidate.via === 'response' || candidate.via === 'fetch')
      ? candidate as CapturedPdf
      : null;
  }

  async waitForPdf(timeoutMs: number): Promise<CapturedPdf | null> {
    if (this.recent && Date.now() - this.recent.at < RECENT_PDF_WINDOW_MS) {
      const pdf = this.recent.pdf;
      this.recent = null;
      return pdf;
    }
    return this.nextPdf(timeoutMs);
  }

  async fetchPdf(url: string, timeoutMs = this.pdfDownloadTimeoutMs): Promise<CapturedPdf | null> {
    if (DomainPolicy.isBrowserPdfViewer(url)) return null;
    if (/^data:/i.test(url)) {
      if (this.pdfActionDepth <= 0 || !/^data:application\/pdf(?:;|,)/i.test(url)) return null;
      try {
        const comma = url.indexOf(',');
        if (comma < 0 || url.length > this.maxPdfBytes * 1.5 + 4096) return null;
        const meta = url.slice(0, comma);
        const encoded = url.slice(comma + 1);
        const buffer = /;base64/i.test(meta) ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'latin1');
        const pdf: CapturedPdf = { buffer, contentType: 'application/pdf', via: 'fetch' };
        return validatePdf(buffer, pdf.contentType, this.maxPdfBytes).ok ? pdf : null;
      } catch {
        return null;
      }
    }
    if (/^blob:/i.test(url)) {
      if (!this.policy.isAllowedNavigation(url)) return null;
      const blobOrigin = (() => { try { return new URL(url.slice(5)).origin; } catch { return null; } })();
      if (!blobOrigin) return null;
      const originFrames = this.context.pages().flatMap((page) => page.frames());
      for (const frame of originFrames) {
        let frameOrigin = '';
        try { frameOrigin = new URL(frame.url()).origin; } catch { continue; }
        if (frameOrigin !== blobOrigin || !this.policy.isAllowedNavigation(frame.url())) continue;
        const result = await this.withPdfTimeout(frame.evaluate(async ({ source, maxBytes }) => {
          try {
            const response = await fetch(source);
            if (!response.ok) return null;
            const blob = await response.blob();
            if (blob.size <= 0 || blob.size > maxBytes) return null;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { data: btoa(binary), contentType: blob.type || 'application/pdf' };
          } catch { return null; }
        }, { source: url, maxBytes: this.maxPdfBytes }).catch(() => null), timeoutMs);
        if (!result) continue;
        const buffer = Buffer.from(result.data, 'base64');
        const pdf: CapturedPdf = { buffer, contentType: result.contentType, via: 'fetch' };
        if (validatePdf(buffer, pdf.contentType, this.maxPdfBytes).ok) return pdf;
      }
      return null;
    }
    const result = await this.requestPdfSource(url, Date.now() + timeoutMs);
    return result.pdf;
  }

  currentUrl(): string {
    return this.page.url();
  }

  openPages(): number {
    return this.context.pages().length;
  }
}
