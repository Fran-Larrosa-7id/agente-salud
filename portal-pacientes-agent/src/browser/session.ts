import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { APIResponse, BrowserContext, Frame, Page, Response, Route } from 'playwright';
import { MAX_PDF_BYTES, hasPdfMagic, validatePdf, type CapturedPdf } from '../jobs/pdf.js';
import { MAX_MEDICAL_ARCHIVE_BYTES, validateMedicalArchive, type CapturedMedicalArchive } from '../jobs/medical-archive.js';
import type { ProviderConfig } from '../providers/types.js';
import { LABWIN_EXTRACTOR_SOURCE, type LabwinExtraction, type LabwinRawStudy } from '../providers/percamb/study-extractor.js';
import { percambSourceKey } from '../providers/percamb/source-key.js';
import { CENTRODM_EXTRACTOR_SOURCE, normalizeCentroDmDate, type CentroDmExtraction, type CentroDmRawAction } from '../providers/centrodm/study-extractor.js';
import { centroDmSourceKey } from '../providers/centrodm/source-key.js';
import { RDC_EXTRACTOR_SOURCE, normalizeRdcDate, type RdcExtraction } from '../providers/rdcchacabuco/study-extractor.js';
import { rdcChacabucoSourceKey } from '../providers/rdcchacabuco/source-key.js';
import { parseDate } from '../agent/studies.js';
import { DomainPolicy } from '../security/domain-policy.js';
import { sleep } from '../util.js';
import type { BrowserHost } from './browser-host.js';
import { probePixeonDownload, handlePixeonCookieConsent, clickPixeonControl } from './pixeon-download.js';
import { COLLECTOR_SOURCE } from './collector.js';
import { ProviderParserMismatchError, type BrowserPort, type CentroDmStudyReference, type RdcChacabucoStudyReference, type ProviderStudyList, type ProviderStudyMetadata, type ProviderStructureEvent, type RawElement, type RawPageSnapshot } from './types.js';

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

export class StudyReferenceMismatchError extends Error {
  readonly code = 'STUDY_REFERENCE_MISMATCH';
  constructor() {
    super('STUDY_REFERENCE_MISMATCH');
  }
}

export type PdfDownloadErrorCode = 'PDF_NOT_FOUND' | 'PDF_DOWNLOAD_TIMEOUT' | 'INVALID_DOCUMENT';
export class PdfDownloadError extends Error {
  constructor(readonly code: PdfDownloadErrorCode) {
    super(code);
  }
}
export type RdcChacabucoErrorCode = 'STUDY_REFERENCE_MISSING' | 'STUDY_ACTION_NOT_FOUND' | 'STUDY_MODAL_NOT_OPENED' | 'PDF_SOURCE_NOT_FOUND' | 'PDF_RANGE_REASSEMBLY_FAILED' | 'PDF_FULL_FETCH_FAILED' | 'INVALID_PDF';
export class RdcChacabucoError extends Error {
  constructor(readonly code: RdcChacabucoErrorCode) { super(code); }
}
export type MedicalArchiveErrorCode = 'STUDY_REFERENCE_MISSING' | 'VIEWER_NOT_READY' | 'VIEWER_OPEN_TIMEOUT' | 'VIEWER_NOT_RECOGNIZED' | 'DOWNLOAD_ACTION_NOT_FOUND' | 'DOWNLOAD_ACTION_NOT_CLICKABLE' | 'DOWNLOAD_MENU_NOT_FOUND' | 'DICOM_DOWNLOAD_TIMEOUT' | 'INVALID_MEDICAL_ARCHIVE';
export class MedicalArchiveError extends Error {
  constructor(readonly code: MedicalArchiveErrorCode) { super(code); }
}

const RECENT_PDF_WINDOW_MS = 10_000;
const PIXEON_CONTROL_SELECTOR = 'button,[role="button"],[role="menuitem"],a,input[type="button"],input[type="submit"],[aria-label],[title],[onclick],[ng-click],[tabindex],[data-action],[style*="cursor" i],div,span';

interface PixeonControlCandidate {
  index: number;
  tag: string;
  role: string;
  textMatch: boolean;
  visible: boolean;
  score?: number;
}

interface PixeonUiProbe {
  branding: boolean;
  downloadCandidates: PixeonControlCandidate[];
  toolbarCandidates: number;
}

type RdcDomStrategy = 'iframe' | 'embed' | 'object' | 'data' | 'blob';
interface RdcDomSource {
  url: string;
  strategy: RdcDomStrategy;
  frame: Frame;
  attr: 'src' | 'data' | 'href' | 'data-src' | 'data-pdf' | 'data-url';
  depth: number;
  typePdf: boolean;
}
interface RdcBrowserFetchResult {
  kind: 'pdf' | 'html' | 'failed' | 'invalid';
  status: number;
  contentType: string;
  bodyBytes: number;
  magic: string;
  data?: string;
  reason?: string;
  nested?: { url: string; strategy: RdcDomStrategy; attr: RdcDomSource['attr']; typePdf: boolean }[];
}
interface RdcModalSnapshot {
  modal: boolean;
  sources: RdcDomSource[];
  pdfDocuments: string[];
  frameCount: number;
  iframes: number;
  embeds: number;
  objects: number;
  blobSources: number;
  dataPdfSources: number;
  sameOriginSources: number;
}

function normalizeProtocol(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isHtmlPayload(buffer: Buffer): boolean {
  const prefix = buffer.subarray(0, 256).toString('latin1').replace(/^\uFEFF/, '').trimStart();
  return /^<(?:!doctype\s+html|html\b)/i.test(prefix);
}

/**
 * Sesión de navegador de UN job. La abre el sistema, la usa el paciente para iniciar sesión y
 * después la usa el agente, siempre a través de las operaciones de solo lectura de BrowserPort.
 */
export class BrowserSession implements BrowserPort {
  private page!: Page;
  private mainPage!: Page;
  private waiters: ((pdf: CapturedPdf) => void)[] = [];
  private archiveWaiters: ((archive: CapturedMedicalArchive | null) => void)[] = [];
  private recent: { pdf: CapturedPdf; at: number } | null = null;
  private closing = false;
  private readonly retainedViewers = new Map<Page, number>();

  get debugViewerRetentionMs(): number {
    return Math.max(0, ...[...this.retainedViewers.values()].map(until => until - Date.now()));
  }

  /** Solo lo activa el runner en desarrollo. El manager cierra el contexto al vencer. */
  retainPixeonViewerForDebug(durationMs = 120_000): void {
    if (this.provider.studyExtractor === 'centrodm' && this.page !== this.mainPage && !this.page.isClosed()) {
      this.retainedViewers.set(this.page, Date.now() + durationMs);
    }
  }

  /** Mantiene el contexto RDC abierto temporalmente para inspección manual en desarrollo. */
  retainRdcModalForDebug(durationMs = 120_000): void {
    if (this.provider.studyExtractor === 'rdcchacabuco' && this.rdcModalObserved && !this.mainPage.isClosed()) {
      this.retainedViewers.set(this.mainPage, Date.now() + Math.max(1, durationMs));
    }
  }

  private pdfActionDepth = 0;
  private archiveActionDepth = 0;
  private invalidArchiveObserved = false;
  private invalidPdfObservedAt = 0;
  private rdcInvalidPdfObservedAt = 0;
  private rdcDocumentSignalAt = 0;
  private readonly rdcDocumentSourceWaiters = new Set<() => void>();
  private readonly rdcPdfCandidateUrls = new Set<string>();
  private readonly rdcLoggedDomCandidateUrls = new Set<string>();
  private readonly rdcLoggedEmbedCandidateUrls = new Set<string>();
  private lastRdcProbeSignature = '';
  private rdcModalObserved = false;
  private readonly providerStudies = new Map<string, { protocol: string; date?: string; deliveryDate?: string; status?: string; href: string; rowToken: string; actionToken: string; frame: number; listUrl: string }>();
  private readonly centroDmStudies = new Map<string, CentroDmStudyReference>();
  private readonly rdcChacabucoStudies = new Map<string, RdcChacabucoStudyReference>();
  private readonly rdcDocumentToken = randomUUID().replace(/-/g, '');
  private activeRdcFrameIndex: number | null = null;
  private readonly guardedCentroDmViewerPages = new WeakSet<Page>();
  private readonly acceptedPixeonConsentPages = new WeakSet<Page>();
  private readonly centroDmRedirectCounts = new WeakMap<Page, number>();
  private pendingCentroDmViewer: { page: Page | null; blockedExternalNavigation: boolean; viewerOriginLogged: boolean } | null = null;
  private activeStudyId: string | null = null;
  private viewerFrame: Frame | null = null;
  private lastPixeonSignalCount = 0;
  private lastPixeonSignals = { brand: false, download: false, imageToolbar: false };
  private readonly maxPdfBytes: number;
  private readonly pdfDownloadTimeoutMs: number;
  private readonly maxMedicalArchiveBytes: number;
  readonly policy: DomainPolicy;
  /** Se llama si la pestaña principal intenta ir a un dominio fuera de la allowlist. */
  onUnexpectedDomain: (() => void) | null = null;
  onNavigationBlocked: ((info: { scheme: string; host: string; port: string }) => void) | null = null;
  onCentroDmViewerOriginAllowed: ((info: { host: string; port: string }) => void) | null = null;
  onCentroDmViewerOpened: ((info: { popup: boolean }) => void) | null = null;
  onCentroDmViewerReady: ((info: { host: string; port: string }) => void) | null = null;
  onCentroDmDownloadStarting: (() => void) | null = null;
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
    maxMedicalArchiveBytes = MAX_MEDICAL_ARCHIVE_BYTES,
    extraAllowedOrigins: string[] = [],
    private readonly pixeonViewerReadyTimeoutMs = 30_000,
    private readonly pixeonToolbarTimeoutMs = 30_000,
  ) {
    this.policy = new DomainPolicy(provider.allowedHosts, provider.staticHosts, [...(provider.allowedOrigins || []), ...extraAllowedOrigins], provider.requireHttps);
    this.maxPdfBytes = maxPdfBytes;
    this.pdfDownloadTimeoutMs = pdfDownloadTimeoutMs;
    this.maxMedicalArchiveBytes = maxMedicalArchiveBytes;
  }

  static async open(host: BrowserHost, provider: ProviderConfig, headless: boolean, maxPdfBytes = MAX_PDF_BYTES, providerDebugStructure = false, pdfDownloadTimeoutMs = 60_000, maxMedicalArchiveBytes = MAX_MEDICAL_ARCHIVE_BYTES, extraAllowedOrigins: string[] = [], pixeonViewerReadyTimeoutMs = 30_000, pixeonToolbarTimeoutMs = 30_000): Promise<BrowserSession> {
    const context = await host.newContext();
    const s = new BrowserSession(context, provider, headless, maxPdfBytes, providerDebugStructure, pdfDownloadTimeoutMs, maxMedicalArchiveBytes, extraAllowedOrigins, pixeonViewerReadyTimeoutMs, pixeonToolbarTimeoutMs);
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
    await this.context.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      let isMainNav = false;
      let requestPage: Page | null = null;
      try {
        requestPage = req.frame().page();
        isMainNav = req.isNavigationRequest() && req.frame() === requestPage.mainFrame();
      } catch {
        /* solicitudes sin frame */
      }
      const pendingCentroDmViewer = this.provider.id === 'centrodm' ? this.pendingCentroDmViewer : null;
      const guardedCentroDmPage = this.provider.id === 'centrodm' && !!requestPage &&
        (pendingCentroDmViewer?.page === requestPage || this.guardedCentroDmViewerPages.has(requestPage));
      if (guardedCentroDmPage && req.isNavigationRequest()) {
        return this.routeCentroDmViewerNavigation(route, url, requestPage!, pendingCentroDmViewer?.page === requestPage ? pendingCentroDmViewer : null);
      }
      const allowedDataPdf = this.pdfActionDepth > 0 && /^data:application\/pdf(?:;|,)/i.test(url);
      const actionViewer = this.pdfActionDepth > 0 && DomainPolicy.isBrowserPdfViewer(url);
      const centroDmViewer = this.provider.id === 'centrodm' && requestPage ? this.isCentroDmViewerUrlAllowed(url) : false;
      const allowed = allowedDataPdf || actionViewer || centroDmViewer || (req.isNavigationRequest() ? this.policy.isAllowedNavigation(url) : this.policy.isAllowedSubresource(url));
      if (allowed) return route.continue();
      if (!DomainPolicy.isTransientBlank(url)) {
        if (this.provider.id === 'rdcchacabuco' && /^https?:/i.test(url)) {
          this.providerStructure('rdc_external_origin', undefined, { host: this.safeUrlParts(url).host });
        }
        this.onNavigationBlocked?.(this.safeUrlParts(url));
        // Un host rechazado dentro del popup seleccionado es un fallo de ese estudio, no de toda
        // la sesión. Una navegación inesperada desde la pestaña autenticada sigue siendo fatal.
        if (isMainNav && (requestPage === this.mainPage || this.provider.id !== 'centrodm')) this.onUnexpectedDomain?.();
      }
      return route.abort('blockedbyclient');
    });
    this.context.on('page', (p) => this.attachPage(p));
    this.context.on('response', (r) => void this.onResponse(r));
  }

  private originOf(url: string): string {
    try { return new URL(url).origin.toLowerCase(); } catch { return ''; }
  }

  /** CentroDM acepta solo los hosts del portal y sus origins HTTPS exactos configurados. */
  private isCentroDmViewerUrlAllowed(url: string): boolean {
    return this.provider.id === 'centrodm' && this.policy.isAllowedNavigation(url);
  }

  private isConfiguredCentroDmViewerOrigin(url: string): boolean {
    const origin = this.originOf(url);
    if (this.provider.id !== 'centrodm' || !origin) return false;
    return (this.provider.allowedOrigins || []).some((candidate) => {
      try { return new URL(candidate).origin.toLowerCase() === origin; } catch { return false; }
    });
  }

  /** Inspecciona cada salto HTTP antes de que Chromium lo siga hacia un origin externo. */
  private async routeCentroDmViewerNavigation(route: Route, url: string, page: Page, pending: NonNullable<BrowserSession['pendingCentroDmViewer']> | null): Promise<void> {
    if (!this.policy.isAllowedNavigation(url)) {
      if (pending) pending.blockedExternalNavigation = true;
      this.onNavigationBlocked?.(this.safeUrlParts(url));
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }

    try {
      const response = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
      const headers = response.headers();
      const location = headers.location;
      const isRedirect = [300, 301, 302, 303, 307, 308].includes(response.status()) && !!location;
      if (!isRedirect) {
        this.centroDmRedirectCounts.set(page, 0);
        await route.fulfill({ response });
        return;
      }

      let destination: string;
      try { destination = new URL(location!, url).href; }
      catch {
        if (pending) pending.blockedExternalNavigation = true;
        this.onNavigationBlocked?.({ scheme: 'unknown', host: 'none', port: 'none' });
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }
      if (!this.policy.isAllowedNavigation(destination)) {
        if (pending) pending.blockedExternalNavigation = true;
        this.onNavigationBlocked?.(this.safeUrlParts(destination));
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }

      if ([307, 308].includes(response.status()) && !['GET', 'HEAD'].includes(route.request().method().toUpperCase())) {
        if (pending) pending.blockedExternalNavigation = true;
        this.onNavigationBlocked?.(this.safeUrlParts(destination));
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }

      if (pending && !pending.viewerOriginLogged && this.isConfiguredCentroDmViewerOrigin(destination)) {
        pending.viewerOriginLogged = true;
        const { host, port } = this.safeUrlParts(destination);
        this.onCentroDmViewerOriginAllowed?.({ host, port });
      }
      const redirectCount = (this.centroDmRedirectCounts.get(page) || 0) + 1;
      this.centroDmRedirectCounts.set(page, redirectCount);
      if (redirectCount > 10) {
        if (pending) pending.blockedExternalNavigation = true;
        this.onNavigationBlocked?.(this.safeUrlParts(destination));
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }

      // Turn the validated Location into a fresh browser navigation so the next hop is
      // intercepted and checked independently. The URL remains in memory only.
      const destinationLiteral = JSON.stringify(destination).replace(/</g, '\\u003c');
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
        body: `<!doctype html><meta name="referrer" content="no-referrer"><script>location.replace(${destinationLiteral})</script>`,
      });
    } catch {
      await route.abort('failed').catch(() => {});
    }
  }

  private attachPage(p: Page): void {
    this.onPdfTrace?.({ stage: 'page_opened', ...this.safeUrlParts(p.url()) });
    if (this.provider.studyExtractor === 'rdcchacabuco') p.on('framenavigated', (frame) => {
      if (!this.activeStudyId) return;
      const url = frame.url();
      this.providerStructure('rdc_frame_navigation', undefined, {
        host: this.safeUrlParts(url).host,
        found: this.policy.isAllowedNavigation(url),
      });
    });
    p.on('download', async (d) => {
      if (this.archiveActionDepth > 0) {
        try {
          const safeOrigin = this.provider.id === 'centrodm'
            ? this.isCentroDmViewerUrlAllowed(d.url())
            : this.policy.isAllowedNavigation(d.url());
          if (!safeOrigin) return void d.cancel();
          const file = await d.path();
          if (!file) return;
          if ((await stat(file)).size > this.maxMedicalArchiveBytes) {
            this.invalidArchiveObserved = true;
            await d.cancel().catch(() => {});
            await d.delete().catch(() => {});
            return;
          }
          const buffer = await readFile(file);
          await d.delete().catch(() => {});
          const check = validateMedicalArchive(buffer, d.suggestedFilename().toLowerCase().endsWith('.zip') ? 'application/zip' : null, this.maxMedicalArchiveBytes);
          if (!check.ok) { this.invalidArchiveObserved = true; return; }
          const waiter = this.archiveWaiters.shift();
          waiter?.({ buffer, contentType: 'application/zip', via: 'download' });
        } catch {
          /* descarga cancelada o contexto cerrado */
        }
        return;
      }
      try {
        this.onPdfTrace?.({ stage: 'download_event', ...this.safeUrlParts(d.url()) });
        const safeOrigin = this.policy.isAllowedNavigation(d.url()) || (this.pdfActionDepth > 0 && /^data:application\/pdf(?:;|,)/i.test(d.url()));
        if (!safeOrigin) return void d.cancel();
        if (this.provider.id === 'rdcchacabuco' && this.activeStudyId) this.signalRdcDocumentSource();
        const file = await d.path();
        if (!file) return;
        if ((await stat(file)).size > this.maxPdfBytes) {
          if (this.provider.id === 'rdcchacabuco' && this.activeStudyId) this.markRdcPdfInvalid();
          await d.cancel().catch(() => {});
          await d.delete().catch(() => {});
          return;
        }
        const buffer = await readFile(file);
        await d.delete().catch(() => {});
        const pdfCheck = validatePdf(buffer, null, this.maxPdfBytes);
        if (pdfCheck.ok) this.offer({ buffer, contentType: null, via: 'download' });
        else if (this.provider.id === 'rdcchacabuco' && this.activeStudyId && isHtmlPayload(buffer)) {
          this.logRdcPdfCandidate(200, {}, buffer, true, true, 'html_payload');
        }
        else {
          this.invalidPdfObservedAt = Date.now();
          if (this.provider.id === 'rdcchacabuco' && this.activeStudyId) this.markRdcPdfInvalid();
          this.onPdfTrace?.({ stage: 'response_invalid', ...this.safeUrlParts(d.url()) });
        }
      } catch {
        /* descarga cancelada o contexto cerrado */
      }
    });
    p.on('close', () => {
      this.retainedViewers.delete(p);
      if (this.pendingCentroDmViewer?.page === p) this.pendingCentroDmViewer = null;
      if (!this.closing && (p === this.mainPage || this.context.pages().length === 0)) this.onUserClosed?.();
      if (p === this.page) this.page = this.context.pages().at(-1) ?? this.mainPage;
    });
  }

  private async onResponse(r: Response): Promise<void> {
    const headers = r.headers();
    const ct = headers['content-type'] || '';
    const cd = headers['content-disposition'] || '';
    const status = r.status();
    if (!/pdf/i.test(ct) && !/\.pdf/i.test(cd) && !/\.pdf(?:[?#]|$)/i.test(r.url())) return;
    if (this.provider.id === 'rdcchacabuco') this.providerStructure('rdc_pdf_response', undefined, { found: true, host: this.safeUrlParts(r.url()).host });
    this.onPdfTrace?.({ stage: 'pdf_response', ...this.safeUrlParts(r.url()) });
    if (status >= 300 || !this.policy.isAllowedNavigation(r.url())) return;
    const isActiveRdcStudy = this.provider.id === 'rdcchacabuco' && !!this.activeStudyId;
    const contentRange = headers['content-range'] || '';
    const isRangeResponse = status === 206 || !!contentRange;
    if (isActiveRdcStudy) this.signalRdcDocumentSource();
    const announcedSize = Number(headers['content-length']);
    if (Number.isFinite(announcedSize) && announcedSize > this.maxPdfBytes) {
      if (isActiveRdcStudy) {
        this.logRdcPdfCandidate(status, headers, null, true, true, isRangeResponse ? 'range_fragment' : 'oversized');
        if (!isRangeResponse) this.markRdcPdfInvalid();
      }
      return;
    }
    try {
      const buffer = await Promise.race([r.body(), sleep(5000).then(() => null)]);
      if (!buffer) {
        if (isActiveRdcStudy) this.logRdcPdfCandidate(status, headers, null, isRangeResponse, isRangeResponse, isRangeResponse ? 'range_fragment' : 'body_unavailable');
        return;
      }
      if (isActiveRdcStudy && isRangeResponse) {
        this.logRdcPdfCandidate(status, headers, buffer, true, true, 'range_fragment');
        if (this.rdcPdfCandidateUrls.size < 8) this.rdcPdfCandidateUrls.add(r.url());
        return;
      }
      if (isActiveRdcStudy && isHtmlPayload(buffer)) {
        this.logRdcPdfCandidate(status, headers, buffer, true, true, 'html_payload');
        return;
      }
      this.onPdfTrace?.({ stage: 'response_body', ...this.safeUrlParts(r.url()) });
      if (isActiveRdcStudy ? this.isRdcPdfPayload(buffer, ct || null) : validatePdf(buffer, ct || null, this.maxPdfBytes).ok) {
        if (isActiveRdcStudy) this.logRdcPdfCandidate(status, headers, buffer, false);
        if (isActiveRdcStudy && this.rdcPdfCandidateUrls.size < 8) this.rdcPdfCandidateUrls.add(r.url());
        this.offer({ buffer, contentType: ct || null, via: 'response' });
      }
      else {
        if (isActiveRdcStudy && !/pdf/i.test(ct) && !/\.pdf/i.test(cd)) {
          this.logRdcPdfCandidate(status, headers, buffer, true, true, 'not_pdf_payload');
          return;
        }
        if (isActiveRdcStudy) {
          this.logRdcPdfCandidate(status, headers, buffer, true, true, 'not_pdf_payload');
          if (this.rdcPdfCandidateUrls.size < 8) this.rdcPdfCandidateUrls.add(r.url());
        }
        this.invalidPdfObservedAt = Date.now();
        if (isActiveRdcStudy) this.markRdcPdfInvalid();
        this.onPdfTrace?.({ stage: 'response_invalid', ...this.safeUrlParts(r.url()) });
      }
    } catch {
      /* el cuerpo no siempre está disponible (p. ej. si se convirtió en descarga); lo cubre el evento download */
    }
  }

  private logRdcPdfCandidate(
    status: number,
    headers: Record<string, string>,
    buffer: Buffer | null,
    rejected: boolean,
    includeRejection = false,
    reason?: string,
  ): void {
    this.providerStructure('rdc_pdf_candidate', undefined, {
      status,
      contentType: this.contentTypeKind(headers['content-type'] || ''),
      contentLengthPresent: headers['content-length'] !== undefined,
      contentRangePresent: headers['content-range'] !== undefined,
      acceptRangesPresent: headers['accept-ranges'] !== undefined,
      bodyBytes: buffer?.length ?? 0,
      magic: buffer?.subarray(0, 8).toString('hex') || 'none',
      rejected,
      ...(includeRejection && reason ? { reason } : {}),
    });
  }

  private signalRdcDocumentSource(): void {
    this.rdcDocumentSignalAt = Date.now();
    for (const resolve of this.rdcDocumentSourceWaiters) resolve();
    this.rdcDocumentSourceWaiters.clear();
  }

  private markRdcPdfInvalid(): void {
    this.rdcInvalidPdfObservedAt = Date.now();
  }

  private waitForRdcDocumentSource(signal?: AbortSignal): Promise<void> {
    if (this.rdcDocumentSignalAt > 0 || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const cleanup = () => {
        this.rdcDocumentSourceWaiters.delete(onSource);
        signal?.removeEventListener('abort', onAbort);
      };
      const onSource = () => { cleanup(); resolve(); };
      const onAbort = () => { cleanup(); resolve(); };
      this.rdcDocumentSourceWaiters.add(onSource);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private async waitForRdcDocumentSurface(timeoutMs: number): Promise<Awaited<ReturnType<BrowserSession['rdcModalState']>> | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.mainPage.isClosed() && Date.now() < deadline) {
      const state = await this.rdcModalState();
      if (state.modal || state.sources.length || state.pdfDocuments.length) return state;
      await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    return null;
  }

  private offer(pdf: CapturedPdf): void {
    if (!validatePdf(pdf.buffer, pdf.contentType, this.maxPdfBytes).ok) return;
    if (this.provider.id === 'rdcchacabuco' && this.activeStudyId && !this.isRdcPdfPayload(pdf.buffer, pdf.contentType)) {
      this.markRdcPdfInvalid();
      return;
    }
    this.onPdfTrace?.({ stage: 'pdf_captured', scheme: pdf.via, host: 'none', count: this.waiters.length });
    const w = this.waiters.shift();
    if (w) w(pdf);
    else this.recent = { pdf, at: Date.now() };
  }

  private isRdcPdfPayload(buffer: Buffer, contentType: string | null): boolean {
    return buffer.length > 0 && buffer.length <= this.maxPdfBytes &&
      buffer.subarray(0, 4).toString('latin1') === '%PDF' && validatePdf(buffer, contentType, this.maxPdfBytes).ok;
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
      if (p === this.mainPage || (this.retainedViewers.get(p) || 0) > Date.now()) continue;
      const closing = p.close({ runBeforeUnload: false }).catch(() => {});
      await Promise.race([closing, sleep(1500)]);
    }
    this.pendingCentroDmViewer = null;
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
    this.retainedViewers.clear();
    this.waiters.forEach((w) => w(null as unknown as CapturedPdf));
    this.waiters = [];
    this.archiveWaiters.forEach((w) => w(null));
    this.archiveWaiters = [];
    this.recent = null;
    this.centroDmStudies.clear();
    this.pendingCentroDmViewer = null;
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

  private safeUrlParts(url: string): { scheme: string; host: string; port: string } {
    try {
      const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0]?.replace(/:$/, '').toLowerCase() || 'unknown';
      const parsed = new URL(/^blob:/i.test(url) ? url.slice(5) : url);
      const defaultPort = parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : 'none';
      return {
        scheme: scheme.slice(0, 20),
        host: parsed.hostname.toLowerCase().slice(0, 64) || 'none',
        port: parsed.port || defaultPort,
      };
    } catch {
      const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0]?.replace(/:$/, '').slice(0, 20) || 'unknown';
      return { scheme, host: 'none', port: 'none' };
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
    const alwaysLog = new Set<ProviderStructureEvent['event']>([
      'centrodm_metadata_dates_found', 'centrodm_studies_with_date', 'centrodm_study_metadata',
      'pixeon_download_probe_start', 'pixeon_download_probe_end', 'pixeon_download_probe', 'pixeon_frames',
      'pixeon_frame', 'pixeon_text_exact', 'pixeon_text_partial', 'pixeon_attr_candidates', 'pixeon_dom_candidate',
      'pixeon_clickable_ancestor', 'pixeon_download_text_matches', 'pixeon_download_role_matches',
      'pixeon_download_attr_matches', 'pixeon_download_candidate', 'pixeon_download_button',
      'pixeon_download_menu', 'pixeon_download_menu_options', 'pixeon_download_choice',
      'pixeon_structural_fallback', 'pixeon_toolbar_candidates', 'toolbar_candidate', 'pixeon_toolbar_detected', 'pixeon_download_structural_candidate',
      'pixeon_download_fastpath', 'pixeon_download_click', 'pixeon_download_options',
      'centrodm_find_document_enter', 'find_document_dispatch',
      'rdc_page', 'rdc_rows', 'rdc_file_icons', 'rdc_file_icons_fallback', 'rdc_file_icons_class_fallback', 'rdc_file_icons_global', 'rdc_result_actions', 'rdc_candidate_rows', 'rdc_parsed_studies', 'rdc_studies_found', 'rdc_action_build', 'rdc_study_action', 'rdc_study_build', 'rdc_study_reference_saved', 'rdc_provider_refs', 'rdc_open_study', 'rdc_document_listeners_ready', 'rdc_study_action_click', 'rdc_modal_opened',
      'rdc_frame_navigation', 'rdc_frames', 'rdc_frame', 'rdc_modal_probe', 'rdc_pdf_sources_scan', 'rdc_pdf_dom_candidate', 'rdc_embed_candidates', 'rdc_embed_candidate', 'rdc_embed_fetch', 'rdc_nested_source_scan', 'rdc_pdf_response', 'rdc_pdf_candidate', 'rdc_pdf_source', 'rdc_pdf_full', 'rdc_pdf_valid', 'rdc_external_origin', 'rdc_import_complete',
    ]);
    if (this.providerDebugStructure || alwaysLog.has(event)) this.onProviderStructure?.({ event, ...(count === undefined ? {} : { count }), ...details });
  }

  /** Extrae todas las filas visibles; referencias y protocolo quedan solo en memoria del job. */
  async listStudies(): Promise<ProviderStudyList | null> {
    if (this.provider.studyExtractor === 'rdcchacabuco') {
      const frames = await this.extractRdcFrames();
      const recognized = frames.some(({ extraction }) => extraction.recognized);
      if (!recognized) return null;
      this.providerStructure('rdc_page', undefined, { type: 'results_list' });
      const candidateRows = frames.reduce((total, item) => total + item.extraction.candidateRows, 0);
      const resultActions = frames.reduce((total, item) => total + item.extraction.resultActions, 0);
      this.providerStructure('rdc_rows', candidateRows);
      this.providerStructure('rdc_file_icons', frames.reduce((total, item) => total + item.extraction.primaryFileIcons, 0), { selector: 'i.fa.fa-file.icon-size' });
      this.providerStructure('rdc_file_icons_fallback', frames.reduce((total, item) => total + item.extraction.fallbackFileIcons, 0), { selector: 'i.fa-file' });
      this.providerStructure('rdc_file_icons_class_fallback', frames.reduce((total, item) => total + item.extraction.fallbackClassFileIcons, 0), { selector: '.fa-file.icon-size' });
      if (frames.every(({ extraction }) => extraction.primaryFileIcons === 0 && extraction.fallbackFileIcons === 0)) {
        this.providerStructure('rdc_file_icons_global', frames.reduce((total, item) => total + item.extraction.broadFileIcons, 0), { selector: '.fa-file' });
      }
      this.providerStructure('rdc_result_actions', resultActions);
      this.providerStructure('rdc_candidate_rows', candidateRows);
      const studies: ProviderStudyMetadata[] = [];
      this.rdcChacabucoStudies.clear();
      let rowOffset = 0;
      let actionOrdinal = 0;
      for (const { frame, extraction } of frames) {
        const canEnrichByRowIndex = extraction.candidateRowMetadata.length === extraction.actions.length;
        for (let localActionIndex = 0; localActionIndex < extraction.actions.length; localActionIndex++) {
          const action = extraction.actions[localActionIndex];
          const buildIndex = actionOrdinal++;
          const indexedMetadata = canEnrichByRowIndex ? extraction.candidateRowMetadata[localActionIndex] : undefined;
          const rawTitle = String(action.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
          const rawStudyType = String(action.studyType || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          const rawStudyDate = String(action.studyDate || '').replace(/\s+/g, ' ').trim();
          const title = rawTitle || String(indexedMetadata?.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
          const studyType = rawStudyType || String(indexedMetadata?.studyType || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          const studyDate = normalizeRdcDate(rawStudyDate) || normalizeRdcDate(indexedMetadata?.studyDate);
          const metadataEnriched = !!(title || studyType || studyDate);
          const actionIndex = localActionIndex;
          const localRowIndex = Number.isInteger(action.rowIndex) && action.rowIndex >= 0 ? action.rowIndex : localActionIndex;
          const rowIndex = rowOffset + localRowIndex;
          const sourceKey = rdcChacabucoSourceKey(studyDate, studyType, title, action.stableId, rowIndex)!;
          const id = randomUUID();
          const study: ProviderStudyMetadata = {
            id,
            sourceKey,
            ...(studyDate ? { date: studyDate, studyDate } : {}),
            title: title || 'Estudio disponible',
            studyType: studyType || 'Imágenes',
          };
          this.rdcChacabucoStudies.set(id, {
            studyId: id,
            frame,
            actionIndex,
            rowIndex,
            actionCount: extraction.actions.length,
            documentToken: this.rdcDocumentToken,
            iconToken: action.iconToken,
            sourceKey,
          });
          studies.push(study);
          this.providerStructure('rdc_action_build', undefined, {
            index: buildIndex,
            studyCreated: true,
            refCreated: true,
            metadataEnriched,
          });
          this.providerStructure('rdc_study_build', undefined, {
            index: buildIndex,
            studyCreated: true,
            refCreated: true,
            hasActionIndex: true,
          });
          this.providerStructure('rdc_study_action', undefined, { index: studies.length, found: true, hasDate: !!studyDate });
          this.providerStructure('rdc_study_reference_saved', undefined, {
            index: studies.length,
            actionIndex,
            hasActionIndex: true,
            hasStableSelector: false,
          });
        }
        rowOffset += Math.max(extraction.candidateRows, extraction.actions.length);
      }
      this.providerStructure('rdc_parsed_studies', studies.length);
      this.providerStructure('rdc_studies_found', studies.length);
      this.providerStructure('rdc_provider_refs', this.rdcChacabucoStudies.size);
      if (resultActions > 0 && studies.length === 0) throw new ProviderParserMismatchError(resultActions, candidateRows, studies.length);
      return { recognized: true, listUrl: this.page.url(), studies };
    }
    if (this.provider.studyExtractor === 'centrodm') {
      const extraction = await this.extractCentroDmRows();
      if (!extraction.recognized) return null;
      this.providerStructure('centrodm_page', undefined, { type: 'results_list' });
      this.providerStructure('centrodm_tables', extraction.tableCount);
      this.providerStructure('centrodm_rows', extraction.candidateRows);
      this.providerStructure('centrodm_result_actions', extraction.resultActions);
      this.providerStructure('centrodm_rows_with_action', extraction.rowsWithAction);
      this.providerStructure('centrodm_metadata_dates_found', extraction.metadataDatesFound);
      for (const { action } of extraction.actions) {
        this.providerStructure('centrodm_action', undefined, {
          index: action.index,
          tag: action.tag,
          hrefPresent: action.hrefPresent,
          hrefKind: action.hrefKind,
          ancestorTr: action.ancestorTr,
        });
      }
      this.providerStructure('centrodm_study_action', extraction.resultActions, { found: extraction.resultActions > 0 });
      const listUrl = this.page.url();
      const studies: ProviderStudyMetadata[] = [];
      let metadataEnriched = 0;
      let studiesWithDate = 0;
      for (const { action, frame } of extraction.actions) {
        const date = parseDate(action.date);
        const studyDate = normalizeCentroDmDate(action.studyDate);
        const extractedTitle = action.title.replace(/\s+/g, ' ').trim().slice(0, 120);
        const modality = action.modality.replace(/\s+/g, ' ').trim().slice(0, 24);
        const sourceKey = centroDmSourceKey(date, extractedTitle, modality, action.stableId);
        if (!action.href || !sourceKey || !this.policy.isAllowedNavigation(action.href)) continue;
        const id = randomUUID();
        const title = extractedTitle || 'Estudio de imágenes';
        const metadata: ProviderStudyMetadata = { id, sourceKey, title, ...(date ? { date } : {}), ...(studyDate ? { studyDate } : {}), ...(modality ? { modality } : {}) };
        this.centroDmStudies.set(id, {
          listUrl,
          openHref: action.href,
          sourceKey,
          actionToken: action.actionToken,
          targetBlank: action.targetBlank,
          frame,
          ...(date ? { date } : {}),
          ...(extractedTitle ? { title: extractedTitle } : {}),
          ...(modality ? { modality } : {}),
        });
        studies.push(metadata);
        if (studyDate) studiesWithDate++;
        this.providerStructure('centrodm_study_metadata', undefined, { index: studies.length, hasDate: !!studyDate });
        if (date && extractedTitle && modality) metadataEnriched++;
      }
      this.providerStructure('centrodm_studies_with_date', studiesWithDate);
      this.providerStructure('centrodm_minimal_studies', studies.length);
      this.providerStructure('centrodm_metadata_enriched', metadataEnriched);
      this.providerStructure('centrodm_metadata_partial', studies.length - metadataEnriched);
      this.providerStructure('centrodm_parsed_studies', studies.length);
      if (extraction.resultActions > 0 && studies.length === 0) {
        throw new ProviderParserMismatchError(extraction.resultActions, extraction.candidateRows, studies.length);
      }
      return { recognized: true, listUrl, studies };
    }
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
      const sourceKey = percambSourceKey(date, protocol, href);
      const metadata: ProviderStudyMetadata = { id, ...(sourceKey ? { sourceKey } : {}), ...(date ? { date } : {}), ...(protocol ? { protocol } : {}), ...(deliveryDate ? { deliveryDate } : {}), ...(status ? { status } : {}) };
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

  private async extractRdcFrames(): Promise<{ frame: number; extraction: RdcExtraction }[]> {
    const found: { frame: number; extraction: RdcExtraction }[] = [];
    const prefix = randomUUID().replace(/-/g, '');
    const frames = this.page.frames();
    for (let index = 0; index < frames.length && index < 8; index++) {
      const frame = frames[index];
      if (index > 0 && !this.policy.isAllowedNavigation(frame.url())) continue;
      try {
        const extraction = await frame.evaluate(`(${RDC_EXTRACTOR_SOURCE})(${JSON.stringify({ prefix: `${prefix}-${index}`, documentToken: this.rdcDocumentToken })})`).catch(() => null) as RdcExtraction | null;
        if (!extraction) {
          if (index === 0) throw new Error('RDC_EXTRACTION_FAILED');
          continue;
        }
        found.push({ frame: index, extraction });
      } catch {
        if (index === 0) throw new Error('RDC_EXTRACTION_FAILED');
      }
    }
    return found;
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

  async isCentroDmResultsPage(): Promise<boolean> {
    if (this.provider.studyExtractor !== 'centrodm') return false;
    const portalHosts = new Set(this.provider.allowedHosts.map((host) => host.toLowerCase()));
    const hasPortalFrame = this.page.frames().some((frame) => {
      const host = DomainPolicy.hostOf(frame.url());
      return !!host && portalHosts.has(host);
    });
    if (!hasPortalFrame) return false;
    return (await this.extractCentroDmRows()).recognized;
  }

  async isRdcChacabucoResultsPage(): Promise<boolean> {
    if (this.provider.studyExtractor !== 'rdcchacabuco') return false;
    for (const frame of this.page.frames()) {
      const host = DomainPolicy.hostOf(frame.url());
      if (!host || !this.provider.allowedHosts.includes(host)) continue;
      const isAuthenticatedDocument = await frame.evaluate(() => !document.querySelector('input[type="password"]')).catch(() => false);
      if (isAuthenticatedDocument) return true;
    }
    return false;
  }

  private async extractCentroDmRows(): Promise<{
    recognized: boolean;
    emptyResults: boolean;
    tableCount: number;
    resultActions: number;
    candidateRows: number;
    rowsWithAction: number;
    metadataDatesFound: number;
    actions: { action: CentroDmRawAction; frame: number }[];
  }> {
    const frames = this.page.frames();
    const actions: { action: CentroDmRawAction; frame: number }[] = [];
    let recognized = false;
    let emptyResults = true;
    let tableCount = 0;
    let resultActions = 0;
    let candidateRows = 0;
    let rowsWithAction = 0;
    let metadataDatesFound = 0;
    for (let frame = 0; frame < frames.length && frame < 8; frame++) {
      const f = frames[frame];
      if (!this.policy.isAllowedNavigation(f.url())) continue;
      const extraction = await f.evaluate(`(${CENTRODM_EXTRACTOR_SOURCE})(${JSON.stringify({ prefix: randomUUID() })})`).catch(() => null) as CentroDmExtraction | null;
      if (!extraction?.recognized) continue;
      recognized = true;
      emptyResults = emptyResults && extraction.emptyResults;
      tableCount += extraction.tableCount;
      candidateRows += extraction.candidateRows;
      rowsWithAction += extraction.rowsWithAction;
      metadataDatesFound += extraction.metadataDatesFound;
      resultActions += extraction.resultActions;
      actions.push(...extraction.actions.map((action) => ({ action: { ...action, index: actions.length + action.index }, frame })));
    }
    return { recognized, emptyResults: recognized && emptyResults, tableCount, resultActions, candidateRows, rowsWithAction, metadataDatesFound, actions };
  }

  isStudyOpen(studyId: string): boolean {
    return this.activeStudyId === studyId;
  }

  /** Confirma solo fecha/protocolo administrativos cuando el detalle los etiqueta explícitamente. */
  private async assertStudyReferenceMatches(studyId: string): Promise<void> {
    const target = this.providerStudies.get(studyId);
    if (!target) return;
    const detail = await this.page.evaluate(() => {
      const norm = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
      const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return !!el.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none';
      };
      let date = '';
      let protocol = '';
      const nodes = Array.from(document.querySelectorAll('dt,th,[data-label],[data-field]')).slice(0, 300);
      for (const node of nodes) {
        if (!visible(node)) continue;
        const explicitLabel = node.getAttribute('data-label') || node.getAttribute('data-field');
        const label = fold(norm(explicitLabel || node.textContent));
        const sibling = node.tagName === 'DT' || node.tagName === 'TH' ? node.nextElementSibling : null;
        const value = norm(explicitLabel ? node.textContent : sibling?.textContent);
        if (!value) continue;
        if (!date && /^(FECHA|FECHA DEL ESTUDIO|FECHA DE REALIZACION|REALIZACION)$/.test(label) &&
            (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value))) date = value;
        if (!protocol && /^(PROTOCOLO|NRO\.?|N[°º]\.?|NUMERO DE PROTOCOLO|ORDEN|PEDIDO)$/.test(label) &&
            /^[A-Z]{0,5}[-\s]?\d[\d\s./-]{2,31}$/i.test(value)) protocol = value;
      }
      return { date, protocol };
    }).catch(() => ({ date: '', protocol: '' }));
    const detailDate = parseDate(detail.date);
    if (target.date && detailDate && target.date !== detailDate) throw new StudyReferenceMismatchError();
    const headingProtocols = await this.page.locator('h1,h2').evaluateAll((headings) => headings.slice(0, 8).flatMap((heading) => {
      const style = getComputedStyle(heading);
      if (!heading.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') return [];
      const value = String(heading.textContent || '').replace(/\s+/g, ' ').trim();
      const match = value.match(/^PROTOCOLO\s*[:#º°-]?\s*([A-Z]{0,5}[-\s]?\d[\d\s./-]{2,31})$/i);
      return match ? [match[1]] : [];
    })).catch(() => []);
    const headingProtocol = headingProtocols[0];
    const detailProtocol = detail.protocol || headingProtocol || '';
    if (target.protocol && detailProtocol && normalizeProtocol(target.protocol) !== normalizeProtocol(detailProtocol)) {
      throw new StudyReferenceMismatchError();
    }
  }

  hasStudy(studyId: string): boolean {
    return this.providerStudies.has(studyId) || this.centroDmStudies.has(studyId) || this.rdcChacabucoStudies.has(studyId);
  }

  /** Resuelve el id opaco a la acción exacta detectada; no elige por posición de fila. */
  async openStudy(studyId: string): Promise<boolean> {
    if (this.provider.studyExtractor === 'rdcchacabuco') return this.openRdcChacabucoStudy(studyId);
    if (this.provider.studyExtractor === 'centrodm') return this.openCentroDmStudy(studyId);
    const target = this.providerStudies.get(studyId);
    if (!target || this.provider.studyExtractor !== 'labwin') return false;
    this.activeStudyId = null;
    if (this.page.url() !== target.listUrl) {
      if (!this.policy.isAllowedNavigation(target.listUrl)) throw new UnexpectedDomainError();
      await this.navigate(target.listUrl);
    }
    if (target.href && /ver_resultado/i.test(new URL(target.href).pathname)) {
      if (!this.policy.isAllowedNavigation(target.href)) throw new UnexpectedDomainError();
      await this.navigate(target.href);
      await this.assertStudyReferenceMatches(studyId);
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
    await this.assertStudyReferenceMatches(studyId);
    this.activeStudyId = studyId;
    return true;
  }

  private async openRdcChacabucoStudy(studyId: string): Promise<boolean> {
    const target = this.rdcChacabucoStudies.get(studyId);
    const studyRefFound = !!target && target.studyId === studyId;
    this.providerStructure('rdc_open_study', undefined, { studyRefFound });
    if (!studyRefFound || !target) throw new RdcChacabucoError('STUDY_REFERENCE_MISSING');
    if (this.mainPage.isClosed()) throw new RdcChacabucoError('STUDY_ACTION_NOT_FOUND');
    this.activeStudyId = null;
    this.recent = null;
    this.invalidPdfObservedAt = 0;
    this.rdcInvalidPdfObservedAt = 0;
    this.rdcDocumentSignalAt = 0;
    this.rdcPdfCandidateUrls.clear();
    this.rdcLoggedDomCandidateUrls.clear();
    this.rdcLoggedEmbedCandidateUrls.clear();
    this.lastRdcProbeSignature = '';
    this.rdcModalObserved = false;
    this.page = this.mainPage;
    const frameIndex = target.frame;
    const frame = this.mainPage.frames()[frameIndex];
    if (!frame) throw new RdcChacabucoError('STUDY_ACTION_NOT_FOUND');

    // El token de documento demuestra que seguimos en el mismo listado, sin guardar su URL/query.
    const iconOpenToken = `rdc-open-icon-${randomUUID().replace(/-/g, '')}`;
    const clickToken = `rdc-click-${randomUUID().replace(/-/g, '')}`;
    const resolution = await frame.evaluate(`(() => {
      const expectedDocument = ${JSON.stringify(target.documentToken)};
      const iconToken = ${JSON.stringify(target.iconToken)};
      const actionIndex = ${target.actionIndex};
      const actionCount = ${target.actionCount};
      const iconOpenToken = ${JSON.stringify(iconOpenToken)};
      const currentDocument = document.documentElement?.getAttribute('data-pp-rdc-document') || '';
      const visible = (el) => { const style = getComputedStyle(el); return !!el.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none'; };
      const primary = Array.from(document.querySelectorAll('i.fa.fa-file.icon-size')).filter(visible);
      const fallback = Array.from(new Set([...document.querySelectorAll('i.fa-file'), ...document.querySelectorAll('.fa-file.icon-size')])).filter(visible);
      const broad = Array.from(document.querySelectorAll('.fa-file')).filter(visible);
      const specific = Array.from(new Set([...primary, ...fallback]));
      const icons = specific.length ? specific : broad;
      const result = { sameDocument: currentDocument === expectedDocument, locatorCount: icons.length, iconFound: false };
      if (!result.sameDocument) return result;
      const stored = icons.find((icon) => icon.getAttribute('data-pp-rdc-icon') === iconToken);
      const indexed = icons[actionIndex];
      const selected = stored || (icons.length === actionCount ? indexed : null);
      if (!selected) return result;
      selected.setAttribute('data-pp-rdc-open-icon', iconOpenToken);
      result.iconFound = true;
      return result;
    })()`).catch(() => null) as { sameDocument: boolean; locatorCount: number; iconFound: boolean } | null;
    this.providerStructure('rdc_open_study', undefined, {
      studyRefFound: true,
      actionIndex: target.actionIndex,
      ...(resolution ? { locatorCount: resolution.locatorCount, iconFound: resolution.iconFound } : { locatorCount: 0, iconFound: false }),
      found: !!resolution?.sameDocument,
    });
    if (!resolution?.sameDocument || !resolution.iconFound) throw new RdcChacabucoError('STUDY_ACTION_NOT_FOUND');

    const clickTargets = await frame.evaluate(`(() => {
      const iconOpenToken = ${JSON.stringify(iconOpenToken)};
      const clickToken = ${JSON.stringify(clickToken)};
      const icon = document.querySelector('[data-pp-rdc-open-icon="' + iconOpenToken + '"]');
      if (!icon) return { count: 0, clickableCount: 0 };
      const explicit = [];
      const wrappers = [];
      const selector = 'a,button,[role="button"],[onclick]';
      let parent = icon.parentElement;
      for (let depth = 0; parent && parent !== document.body && depth < 6; depth++, parent = parent.parentElement) {
        if (parent.matches(selector)) explicit.push(parent);
        else wrappers.push(parent);
      }
      const candidates = [icon, ...explicit, ...wrappers].filter((candidate, index, all) => all.indexOf(candidate) === index);
      candidates.forEach((candidate, index) => candidate.setAttribute('data-pp-rdc-click-target', clickToken + '-' + index));
      return { count: candidates.length, clickableCount: explicit.length };
    })()`).catch(() => ({ count: 0, clickableCount: 0 })) as { count: number; clickableCount: number };
    if (clickTargets.count === 0) throw new RdcChacabucoError('STUDY_ACTION_NOT_FOUND');

    const pagesBefore = new Set(this.context.pages());
    this.activeRdcFrameIndex = frameIndex;
    this.activeStudyId = studyId;
    this.pdfActionDepth++;
    let opened = false;
    let modalOpened = false;
    let documentSourceFound = false;
    const sourceController = new AbortController();
    const sourceSignal = this.waitForRdcDocumentSource(sourceController.signal).then(() => ({ kind: 'source' as const }));
    this.providerStructure('rdc_document_listeners_ready', undefined, { found: true });
    try {
      for (let index = 0; index < clickTargets.count; index++) {
        const candidate = frame.locator(`[data-pp-rdc-click-target="${clickToken}-${index}"]`).first();
        const safe = await candidate.evaluate((node) => {
          const el = node as HTMLElement;
          const button = el as HTMLButtonElement;
          const disabled = (el.tagName === 'BUTTON' && button.disabled) || el.getAttribute('aria-disabled') === 'true';
          const isSubmit = el.tagName === 'BUTTON' && (button.type || 'submit').toLowerCase() === 'submit';
          const inPasswordForm = !!el.closest('form')?.querySelector('input[type="password"]');
          const hasFileIcon = el.matches('.fa-file') || !!el.querySelector('.fa-file');
          return !!el.getClientRects().length && !disabled && !isSubmit && !inPasswordForm && hasFileIcon;
        }).catch(() => false);
        if (!safe) continue;
        const strategy = index === 0 ? 'icon' : index <= clickTargets.clickableCount ? 'clickable_ancestor' : 'ancestor_wrapper';
        this.providerStructure('rdc_study_action_click', undefined, { actionIndex: target.actionIndex, strategy });
        await candidate.click({ timeout: 3_000, noWaitAfter: true }).catch(() => {});
        const observation = await Promise.race([
          sourceSignal,
          this.waitForRdcDocumentSurface(1_200).then((state) => state
            ? { kind: 'surface' as const, state }
            : { kind: 'timeout' as const }),
        ]);
        if (observation.kind === 'source') {
          documentSourceFound = true;
          opened = true;
          break;
        }
        if (observation.kind === 'surface') {
          opened = true;
          modalOpened = observation.state.modal;
          documentSourceFound = observation.state.sources.length > 0 || observation.state.pdfDocuments.length > 0;
          break;
        }
        const popupPdf = this.context.pages().some((page) => !pagesBefore.has(page) && DomainPolicy.isBrowserPdfViewer(page.url()));
        if (popupPdf) {
          opened = true;
          documentSourceFound = true;
          break;
        }
      }
    } finally {
      sourceController.abort();
      this.pdfActionDepth = Math.max(0, this.pdfActionDepth - 1);
      await frame.locator('[data-pp-rdc-click-target]').evaluateAll((nodes) => {
        for (const node of nodes) node.removeAttribute('data-pp-rdc-click-target');
      }).catch(() => {});
      await frame.locator(`[data-pp-rdc-open-icon="${iconOpenToken}"]`).evaluate((node) => node.removeAttribute('data-pp-rdc-open-icon')).catch(() => {});
    }
    const popupPdf = this.context.pages().some((page) => !pagesBefore.has(page) && DomainPolicy.isBrowserPdfViewer(page.url()));
    if (!opened && (this.rdcDocumentSignalAt > 0 || popupPdf)) {
      opened = true;
      documentSourceFound = true;
    }
    if (!opened) {
      const finalSurface = await this.rdcModalState();
      if (finalSurface.modal || finalSurface.sources.length || finalSurface.pdfDocuments.length) {
        opened = true;
        modalOpened = finalSurface.modal;
        documentSourceFound = finalSurface.sources.length > 0 || finalSurface.pdfDocuments.length > 0;
      }
    }
    this.page = this.mainPage;
    if (!opened) {
      this.activeStudyId = null;
      throw new RdcChacabucoError('PDF_SOURCE_NOT_FOUND');
    }
    if (modalOpened) this.providerStructure('rdc_modal_opened', undefined, { opened: true });
    if (documentSourceFound && !this.rdcDocumentSignalAt) this.signalRdcDocumentSource();
    return true;
  }

  private async rdcModalState(): Promise<RdcModalSnapshot> {
    const result: RdcModalSnapshot = {
      modal: false, sources: [], pdfDocuments: [], frameCount: 0,
      iframes: 0, embeds: 0, objects: 0, blobSources: 0, dataPdfSources: 0, sameOriginSources: 0,
    };
    if (this.mainPage.isClosed()) return result;
    const pages = this.context.pages();
    const frames = pages.flatMap((page) => page.frames().map((frame) => ({ page, frame })));
    result.frameCount = frames.length;
    const modalSelector = '[role="dialog"],[aria-modal="true"],.modal.show,.modal.in,[class*="modal"][class*="open" i],[class*="modal"][class*="visible" i]';
    const seenSources = new Set<string>();
    const scannedFrames = frames.slice(0, 12);

    for (let frameIndex = 0; frameIndex < scannedFrames.length; frameIndex++) {
      const { frame } = scannedFrames[frameIndex];
      const frameUrl = frame.url();
      let depth = 0;
      for (let parent = frame.parentFrame(); parent; parent = parent.parentFrame()) depth++;
      const frameOrigin = this.originOf(frameUrl) || (() => {
        try { return new URL(frameUrl.slice(5)).origin; } catch { return ''; }
      })();
      const ownerFrame = /^(?:blob|data):/i.test(frameUrl) ? frame.parentFrame() : frame;
      const ownerAllowed = !!ownerFrame && this.policy.isAllowedNavigation(ownerFrame.url());
      const frameAllowed = this.policy.isAllowedNavigation(frameUrl) || (/^(?:blob|data):/i.test(frameUrl) && ownerAllowed);
      if (!frameAllowed) continue;

      if (/^https?:/i.test(frameUrl) && /\.pdf(?:[?#]|$)/i.test(frameUrl)) result.pdfDocuments.push(frameUrl);
      else if (/^blob:/i.test(frameUrl) && frameOrigin) {
        if (!seenSources.has(frameUrl)) {
          seenSources.add(frameUrl);
          result.sources.push({ url: frameUrl, strategy: 'blob', frame, attr: 'src', depth, typePdf: true });
          result.blobSources++;
        }
      } else if (/^data:application\/pdf(?:;|,)/i.test(frameUrl)) {
        if (!seenSources.has(frameUrl)) {
          seenSources.add(frameUrl);
          result.sources.push({ url: frameUrl, strategy: 'data', frame, attr: 'src', depth, typePdf: true });
          result.dataPdfSources++;
        }
      }
      if (!/^https?:/i.test(frameUrl)) continue;

      const modalLocators = frame.locator(modalSelector);
      const modalCount = await modalLocators.count().catch(() => 0);
      let modalVisible = false;
      let modalLocator = modalLocators.first();
      for (let index = 0; index < Math.min(modalCount, 8); index++) {
        const candidate = modalLocators.nth(index);
        if (await candidate.isVisible().catch(() => false)) { modalVisible = true; modalLocator = candidate; break; }
      }
      const root = modalVisible ? modalLocator : frame.locator('body');
      const inspected: { modal: boolean; iframes: number; embeds: number; objects: number; sources: { tag: string; attr: string; raw: string; base: string; typePdf: boolean }[] } = {
        modal: modalVisible,
        iframes: await root.locator('iframe').count().catch(() => 0),
        embeds: await root.locator('embed').count().catch(() => 0),
        objects: await root.locator('object').count().catch(() => 0),
        sources: [],
      };
      const nodes = root.locator('iframe,embed,object,[data-src],[data-pdf],[data-url],a[href]');
      const nodeCount = await nodes.count().catch(() => 0);
      for (let nodeIndex = 0; nodeIndex < Math.min(nodeCount, 60); nodeIndex++) {
        const node = nodes.nth(nodeIndex);
        if (!await node.isVisible().catch(() => false)) continue;
        const tag = await node.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        for (const attr of ['src', 'data', 'href', 'data-src', 'data-pdf', 'data-url'] as const) {
          if (!['iframe', 'embed', 'object'].includes(tag) && !['data-src', 'data-pdf', 'data-url', 'href'].includes(attr)) continue;
          const details = await node.evaluate((el, attribute) => ({
            raw: el.getAttribute(attribute),
            base: document.baseURI,
            typePdf: /pdf/i.test(el.getAttribute('type') || ''),
          }), attr).catch(() => null);
          const raw = details?.raw;
          if (!raw || (attr === 'href' && !/\.pdf(?:[?#]|$)/i.test(raw))) continue;
          inspected.sources.push({ tag, attr, raw, base: details?.base || frameUrl, typePdf: details?.typePdf || false });
        }
      }

      result.modal ||= inspected.modal;
      result.iframes += inspected.iframes;
      result.embeds += inspected.embeds;
      result.objects += inspected.objects;
      for (const candidate of inspected.sources) {
        if (result.sources.length >= 32) break;
        try {
          const url = new URL(candidate.raw, candidate.base).href;
          let strategy: RdcDomStrategy = candidate.tag === 'object' ? 'object' : candidate.tag === 'embed' ? 'embed' : 'iframe';
          if (/^data:/i.test(url)) {
            if (!/^data:application\/pdf(?:;|,)/i.test(url)) continue;
            strategy = 'data';
            result.dataPdfSources++;
          } else if (/^blob:/i.test(url)) {
            const blobOrigin = (() => { try { return new URL(url.slice(5)).origin; } catch { return ''; } })();
            if (!blobOrigin || blobOrigin !== frameOrigin) continue;
            strategy = 'blob';
            result.blobSources++;
          } else {
            if (!/^https?:/i.test(url)) continue;
            if (!this.policy.isAllowedNavigation(url)) {
              if (!seenSources.has(url)) {
                seenSources.add(url);
                result.sources.push({ url, strategy, frame, attr: candidate.attr as RdcDomSource['attr'], depth, typePdf: candidate.typePdf });
                this.providerStructure('rdc_external_origin', undefined, { host: this.safeUrlParts(url).host });
                this.providerStructure('rdc_pdf_dom_candidate', undefined, { attr: candidate.attr as RdcDomSource['attr'], sameOrigin: false });
                if (strategy === 'embed' && !this.rdcLoggedEmbedCandidateUrls.has(url)) {
                  this.rdcLoggedEmbedCandidateUrls.add(url);
                  this.providerStructure('rdc_embed_candidate', undefined, { found: true, sameOrigin: false, typePdf: candidate.typePdf, depth });
                }
              }
              continue;
            }
            if (this.originOf(url) !== frameOrigin) continue;
            result.sameOriginSources++;
          }
          if (seenSources.has(url)) continue;
          seenSources.add(url);
          const attr = candidate.attr as RdcDomSource['attr'];
          const typePdf = candidate.typePdf || /\.pdf(?:[?#]|$)/i.test(url) || /^data:application\/pdf(?:;|,)/i.test(url);
          result.sources.push({ url, strategy, frame, attr, depth, typePdf });
          if (strategy === 'embed' && !this.rdcLoggedEmbedCandidateUrls.has(url)) {
            this.rdcLoggedEmbedCandidateUrls.add(url);
            this.providerStructure('rdc_embed_candidate', undefined, { found: true, sameOrigin: true, typePdf, depth });
          }
          if (!this.rdcLoggedDomCandidateUrls.has(url)) {
            this.rdcLoggedDomCandidateUrls.add(url);
            this.providerStructure('rdc_pdf_dom_candidate', undefined, { attr, sameOrigin: true });
          }
        } catch { /* Descarta atributos malformados; su contenido nunca se registra. */ }
      }
    }

    if (result.modal) this.rdcModalObserved = true;
    const probeSignature = [result.frameCount, result.modal, result.iframes, result.embeds, result.objects, result.blobSources, result.dataPdfSources, result.sameOriginSources].join(':');
    if (probeSignature !== this.lastRdcProbeSignature) {
      this.lastRdcProbeSignature = probeSignature;
      this.providerStructure('rdc_frames', result.frameCount);
      scannedFrames.forEach(({ page, frame }, index) => this.providerStructure('rdc_frame', undefined, { index, isMain: frame === page.mainFrame() }));
      this.providerStructure('rdc_modal_probe', undefined, {
        frames: result.frameCount, iframes: result.iframes, embeds: result.embeds, objects: result.objects,
        blobSources: result.blobSources, dataPdfSources: result.dataPdfSources, sameOriginSources: result.sameOriginSources,
      });
      this.providerStructure('rdc_pdf_sources_scan', undefined, { frames: scannedFrames.length, count: result.sources.length + result.pdfDocuments.length });
      this.providerStructure('rdc_embed_candidates', result.sources.filter((source) => source.strategy === 'embed').length);
    }
    return result;
  }

  async closeRdcChacabucoModal(): Promise<void> {
    if (this.provider.studyExtractor !== 'rdcchacabuco' || this.mainPage.isClosed()) return;
    if ((this.retainedViewers.get(this.mainPage) || 0) > Date.now()) return;
    const frame = this.mainPage.frames()[this.activeRdcFrameIndex ?? 0] || this.mainPage.mainFrame();
    const modal = frame.locator('[role="dialog"],[aria-modal="true"],.modal.show,.modal.in,[class*="modal"][class*="open" i],[class*="modal"][class*="visible" i]').first();
    if (!await modal.count().catch(() => 0)) return;
    const close = modal.locator('button[aria-label*="close" i],button[aria-label*="cerrar" i],[data-dismiss],[data-bs-dismiss],button.close,[role="button"][aria-label*="close" i]').first();
    if (await close.count().catch(() => 0)) await close.click({ timeout: 2_000 }).catch(() => {});
    else await frame.locator('body').press('Escape', { timeout: 1_000 }).catch(() => {});
  }

  private async openCentroDmStudy(studyId: string): Promise<boolean> {
    const target = this.centroDmStudies.get(studyId);
    if (!target || !target.openHref || !target.sourceKey || !target.listUrl) {
      throw new MedicalArchiveError('STUDY_REFERENCE_MISSING');
    }
    if (this.mainPage.isClosed()) throw new MedicalArchiveError('VIEWER_OPEN_TIMEOUT');
    this.activeStudyId = null;
    this.viewerFrame = null;
    this.page = this.mainPage;
    if (this.mainPage.url() !== target.listUrl) {
      if (!this.policy.isAllowedNavigation(target.listUrl)) throw new UnexpectedDomainError();
      await this.navigate(target.listUrl);
    }
    const href = target.openHref;
    if (!href || !this.policy.isAllowedNavigation(href)) {
      if (href) this.onNavigationBlocked?.(this.safeUrlParts(href));
      this.onUnexpectedDomain?.();
      throw new UnexpectedDomainError();
    }

    const pending = { page: null as Page | null, blockedExternalNavigation: false, viewerOriginLogged: false };
    this.pendingCentroDmViewer = pending;
    const viewerPage = await this.context.newPage().catch(() => null);
    if (!viewerPage) {
      this.pendingCentroDmViewer = null;
      throw new MedicalArchiveError('VIEWER_OPEN_TIMEOUT');
    }
    pending.page = viewerPage;
    this.page = viewerPage;
    const openedPopup = target.targetBlank;
    this.onCentroDmViewerOpened?.({ popup: openedPopup });
    this.providerStructure('centrodm_study_action', 1, { found: true });
    this.providerStructure('centrodm_viewer_opened', undefined, { found: true, popup: openedPopup });
    this.providerStructure('viewer_opened', undefined, { found: true, popup: openedPopup });
    try {
      await viewerPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch (error) {
      if (pending.blockedExternalNavigation || /ERR_BLOCKED_BY_CLIENT/i.test(String(error))) {
        this.pendingCentroDmViewer = null;
        throw new UnexpectedDomainError();
      }
      if (viewerPage.isClosed() || DomainPolicy.isTransientBlank(viewerPage.url())) {
        this.pendingCentroDmViewer = null;
        throw new MedicalArchiveError('VIEWER_OPEN_TIMEOUT');
      }
    }

    if (!pending.viewerOriginLogged && this.isConfiguredCentroDmViewerOrigin(viewerPage.url())) {
      pending.viewerOriginLogged = true;
      const { host, port } = this.safeUrlParts(viewerPage.url());
      this.onCentroDmViewerOriginAllowed?.({ host, port });
    }

    if (viewerPage.isClosed()) {
      this.pendingCentroDmViewer = null;
      throw new MedicalArchiveError('VIEWER_OPEN_TIMEOUT');
    }
    if (pending.blockedExternalNavigation) {
      this.pendingCentroDmViewer = null;
      throw new UnexpectedDomainError();
    }
    const deadline = Date.now() + this.pixeonViewerReadyTimeoutMs;
    let detectionReported = false;
    while (Date.now() < deadline && !this.closing) {
      if (pending.blockedExternalNavigation) {
        this.pendingCentroDmViewer = null;
        throw new UnexpectedDomainError();
      }
      const candidate = await this.findPixeonFrame(viewerPage);
      if (candidate) {
        const viewerOrigin = this.originOf(candidate.url());
        if (!viewerOrigin || !this.isCentroDmViewerUrlAllowed(candidate.url())) {
          await sleep(250);
          continue;
        }
        this.guardedCentroDmViewerPages.add(viewerPage);
        this.pendingCentroDmViewer = null;
        this.viewerFrame = candidate;
        await this.assertCentroDmStudyReference(studyId, candidate);
        this.activeStudyId = studyId;
        const safeViewer = this.safeUrlParts(candidate.url());
        this.onCentroDmViewerReady?.({ host: safeViewer.host, port: safeViewer.port });
        this.providerStructure('centrodm_viewer_detected', undefined, { found: true, host: safeViewer.host, port: safeViewer.port });
        this.providerStructure('viewer_detected', undefined, { found: true, host: safeViewer.host, port: safeViewer.port });
        return true;
      }
      if (!detectionReported) {
        detectionReported = true;
        const safeViewer = this.safeUrlParts(this.page.url());
        this.providerStructure('viewer_detection_signals', this.lastPixeonSignalCount, {
          host: safeViewer.host,
          port: safeViewer.port,
          found: false,
          ...this.lastPixeonSignals,
        });
      }
      await sleep(750);
    }
    const failedUrl = viewerPage.url();
    this.pendingCentroDmViewer = null;
    this.providerStructure('centrodm_viewer_detected', undefined, { found: false, host: this.safeUrlParts(failedUrl).host });
    throw new MedicalArchiveError(DomainPolicy.isTransientBlank(failedUrl) ? 'VIEWER_OPEN_TIMEOUT' : 'VIEWER_NOT_RECOGNIZED');
  }

  private async findPixeonFrame(page: Page): Promise<Frame | null> {
    for (const frame of page.frames()) {
      if (!this.isCentroDmViewerUrlAllowed(frame.url())) continue;
      if (await this.acceptPixeonCookieConsent(page, frame)) return null;
      const probe = await this.inspectPixeonUi(frame);
      const configuredOrigin = this.isConfiguredCentroDmViewerOrigin(frame.url());
      const imageToolbar = probe.toolbarCandidates >= 3;
      const readyScore = (configuredOrigin ? 2 : 0) + (probe.branding ? 2 : 0) + (probe.downloadCandidates.length ? 3 : 0) + (imageToolbar ? 2 : 0);
      this.lastPixeonSignalCount = readyScore;
      this.lastPixeonSignals = { brand: probe.branding, download: probe.downloadCandidates.length > 0, imageToolbar };
      this.providerStructure('pixeon_probe', undefined, {
        brand: probe.branding,
        downloadCandidates: probe.downloadCandidates.length,
        toolbarCandidates: probe.toolbarCandidates,
        readyScore,
        found: readyScore >= 4,
      });
      if (readyScore >= 4) return frame;
    }
    return null;
  }

  /** La evidencia inspeccionada es únicamente marca y controles visibles, nunca texto clínico. */
  private async inspectPixeonUi(frame: Frame): Promise<PixeonUiProbe> {
    const inspect = (selector: string) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const actionSelector = 'button,a,[role="button"],[role="menuitem"],[onclick],[ng-click],[tabindex],[aria-label],[title],[data-action],[style*="cursor" i]';
      const owners = new Map<number, { node: Element; label: string }>();
      for (const node of nodes) {
        const nodeStyle = getComputedStyle(node);
        const nodeRect = node.getBoundingClientRect();
        if (!node.getClientRects().length || nodeRect.width <= 0 || nodeRect.height <= 0 || nodeStyle.visibility === 'hidden' || nodeStyle.display === 'none' || Number(nodeStyle.opacity || 1) <= 0.02) continue;
        const owner = node.closest(actionSelector) || node;
        if (!owner.matches(actionSelector)) continue;
        const ownerStyle = getComputedStyle(owner);
        const ownerRect = owner.getBoundingClientRect();
        if (!owner.getClientRects().length || ownerRect.width <= 0 || ownerRect.height <= 0 || ownerStyle.visibility === 'hidden' || ownerStyle.display === 'none' || Number(ownerStyle.opacity || 1) <= 0.02) continue;
        let index = -1;
        for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex++) {
          if (nodes[candidateIndex] === owner) { index = candidateIndex; break; }
        }
        if (index < 0) continue;
        const ownerInput = owner as HTMLInputElement;
        const nodeInput = node as HTMLInputElement;
        const label = [owner.getAttribute('aria-label'), owner.getAttribute('title'), owner.textContent, ownerInput.value, owner.querySelector('img[alt]')?.getAttribute('alt'), node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent, nodeInput.value, node.querySelector('img[alt]')?.getAttribute('alt')]
          .filter(Boolean).join(' ').slice(0, 480);
        const prior = owners.get(index);
        owners.set(index, { node: owner, label: [prior?.label, label].filter(Boolean).join(' ').slice(0, 480) });
      }
      const downloadCandidates: { index: number; tag: string; role: string; textMatch: boolean; visible: boolean }[] = [];
      for (const [index, candidate] of owners.entries()) {
        const normalizedLabel = candidate.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!/\bdescargar\b/i.test(normalizedLabel)) continue;
        const candidateStyle = getComputedStyle(candidate.node);
        const candidateRect = candidate.node.getBoundingClientRect();
        downloadCandidates.push({
          index,
          tag: candidate.node.tagName.toLowerCase(),
          role: candidate.node.getAttribute('role') || (candidate.node.tagName === 'BUTTON' ? 'button' : candidate.node.tagName === 'A' ? 'link' : 'none'),
          textMatch: true,
          visible: !!candidate.node.getClientRects().length && candidateRect.width > 0 && candidateRect.height > 0 && candidateStyle.visibility !== 'hidden' && candidateStyle.display !== 'none' && Number(candidateStyle.opacity || 1) > 0.02,
        });
      }
      const toolbarAction = /\b(layout|desplazamiento|zoom|ventana|cambio rapido|player|presets?|paleta|anotacion|girar|rotar|mpr|sincronizacion|restaurar|ajustar al panel|pantalla llena|lista de anotaciones|configuraciones?)\b/i;
      const toolbarIndices = new Set<number>();
      for (const [index, candidate] of owners) {
        const normalizedLabel = candidate.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (toolbarAction.test(normalizedLabel)) toolbarIndices.add(index);
      }
      const headings = document.querySelectorAll('h1,h2,h3,[role="heading"],.navbar-brand,[class*="logo" i]');
      let brandingText = document.title;
      let visibleHeadings = 0;
      for (const heading of headings) {
        const headingStyle = getComputedStyle(heading);
        const headingRect = heading.getBoundingClientRect();
        if (!heading.getClientRects().length || headingRect.width <= 0 || headingRect.height <= 0 || headingStyle.visibility === 'hidden' || headingStyle.display === 'none' || Number(headingStyle.opacity || 1) <= 0.02 || visibleHeadings >= 80) continue;
        visibleHeadings++;
        brandingText += ' ' + (heading.textContent || '') + ' ' + (heading.getAttribute('aria-label') || '') + ' ' + (heading.getAttribute('title') || '');
      }
      return {
        branding: /pixeon|aurora/i.test(brandingText),
        downloadCandidates,
        toolbarCandidates: toolbarIndices.size,
      };
    };
    return frame.evaluate(inspect, PIXEON_CONTROL_SELECTOR).catch(() => ({ branding: false, downloadCandidates: [], toolbarCandidates: 0 }));
  }

  private async acceptPixeonCookieConsent(page: Page, frame: Frame): Promise<boolean> {
    if (this.acceptedPixeonConsentPages.has(page)) return false;
    const index = await frame.locator(PIXEON_CONTROL_SELECTOR).evaluateAll((nodes) => {
      for (let index = 0; index < nodes.length; index++) {
        const element = nodes[index];
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!element.getClientRects().length || rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) <= 0.02) continue;
        const input = element as HTMLInputElement;
        const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent, input.value]
          .filter(Boolean).join(' ').slice(0, 160).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!/^aceptar(?: cookies)?$/.test(label)) continue;
        let ancestor: Element | null = element;
        for (let depth = 0; ancestor && ancestor !== document.body && depth < 7; depth++, ancestor = ancestor.parentElement) {
          const modal = ancestor.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"],[class*="modal" i],[id*="modal" i],[class*="cookie" i],[id*="cookie" i]');
          const context = ((ancestor as HTMLElement).innerText || ancestor.textContent || '').slice(0, 1600).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (modal || context.length > label.length + 10) {
            if (/cookie|consent|privacidad|privacy|al hacer clic en aceptar/.test(context)) return index;
          }
        }
      }
      return -1;
    }).catch(() => -1);
    if (index < 0) return false;
    let accepted = false;
    try {
      await frame.locator(PIXEON_CONTROL_SELECTOR).nth(index).click({ timeout: 3_000 });
      accepted = true;
      this.acceptedPixeonConsentPages.add(page);
      await sleep(200);
    } catch { /* si la interfaz cambió, readiness sigue esperando sin forzar otra acción */ }
    this.providerStructure('pixeon_cookie_consent', undefined, { detected: true, accepted });
    return accepted;
  }

  private async assertCentroDmStudyReference(studyId: string, frame: Frame): Promise<void> {
    const expected = this.centroDmStudies.get(studyId);
    if (!expected) throw new StudyReferenceMismatchError();
    const labeledValue = async (pattern: RegExp): Promise<string> => {
      const nodes = frame.locator('dt,th,[data-label],[data-field]');
      const total = Math.min(await nodes.count().catch(() => 0), 300);
      for (let index = 0; index < total; index++) {
        const node = nodes.nth(index);
        if (!(await node.isVisible().catch(() => false))) continue;
        const label = (await node.getAttribute('data-label').catch(() => null)) ||
          (await node.getAttribute('data-field').catch(() => null)) ||
          (await node.innerText().catch(() => ''));
        const normalizeLabel = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
        if (!pattern.test(normalizeLabel)) continue;
        return node.evaluate((el) => {
          const sibling = el.tagName === 'DT' || el.tagName === 'TH' ? el.nextElementSibling : null;
          return String(sibling?.textContent || ((el.hasAttribute('data-label') || el.hasAttribute('data-field')) ? el.textContent : '') || '').replace(/\s+/g, ' ').trim();
        }).catch(() => '');
      }
      return '';
    };
    const displayed = {
      date: await labeledValue(/^(?:fecha|fecha del estudio|fecha de realizacion|study date)$/i),
      title: await labeledValue(/^(?:estudio|examen|procedimiento|study|exam)$/i),
      modality: await labeledValue(/^(?:modalidad|modality)$/i),
    };
    const shownDate = parseDate(displayed.date);
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
    const shownModality = displayed.modality.toUpperCase().replace('MRI', 'MR');
    const expectedModality = String(expected.modality || '').toUpperCase().replace('MRI', 'MR');
    const mismatched = (expected.date && shownDate && expected.date !== shownDate) ||
        (expected.title && displayed.title && normalize(expected.title) !== normalize(displayed.title)) ||
        (expectedModality && shownModality && expectedModality !== shownModality);
    const checked = Number(!!(expected.date && shownDate)) + Number(!!(expected.title && displayed.title)) + Number(!!(expectedModality && shownModality));
    this.providerStructure('viewer_reference_check', checked, { found: !!mismatched });
    if (mismatched) throw new StudyReferenceMismatchError();
  }

  async downloadFullDicomStudy(timeoutMs: number): Promise<CapturedMedicalArchive> {
    this.providerStructure('centrodm_find_document_enter');
    if (this.provider.studyExtractor !== 'centrodm' || !this.activeStudyId) throw new MedicalArchiveError('VIEWER_NOT_READY');
    let frame = this.viewerFrame;
    if (!frame || !(await this.findPixeonFrame(this.page))) throw new MedicalArchiveError('VIEWER_NOT_READY');
    const visibleViewer = await this.findPixeonFrame(this.page);
    if (visibleViewer) frame = this.viewerFrame = visibleViewer;
    if (!frame) throw new MedicalArchiveError('VIEWER_NOT_READY');
    const trace = (event: ProviderStructureEvent) => this.providerStructure(event.event, event.count, event);
    this.providerStructure('pixeon_download_probe_start');
    const canInteract = (candidate: Frame): boolean => {
      let owner: Frame | null = candidate;
      while (owner && /^about:(blank|srcdoc)$/.test(owner.url())) owner = owner.parentFrame();
      return !!owner && this.policy.isAllowedNavigation(owner.url());
    };
    await handlePixeonCookieConsent(this.page, trace, canInteract);
    const probe = await probePixeonDownload(this.page, 'download', trace, frame, canInteract, this.pixeonToolbarTimeoutMs);
    this.providerStructure('viewer_download_button', undefined, { found: !!probe.control });
    this.providerStructure('centrodm_download_button', undefined, { found: !!probe.control });
    if (!probe.control) {
      this.providerStructure('pixeon_download_probe_end', undefined, { found: false });
      throw new MedicalArchiveError(probe.textMatches || probe.domMatches ? 'DOWNLOAD_ACTION_NOT_CLICKABLE' : 'DOWNLOAD_ACTION_NOT_FOUND');
    }
    this.providerStructure('pixeon_download_probe_end', undefined, { found: true });
    try { await clickPixeonControl(probe.control, this.page, trace, canInteract); }
    catch { throw new MedicalArchiveError('DOWNLOAD_ACTION_NOT_CLICKABLE'); }
    const menuDeadline = Date.now() + 5_000;
    let menu = await probePixeonDownload(this.page, 'menu', trace, probe.control.frame, canInteract);
    while (Date.now() < menuDeadline && !menu.control) {
      await sleep(250);
      menu = await probePixeonDownload(this.page, 'menu', trace, probe.control.frame, canInteract);
    }
    this.providerStructure('pixeon_download_menu', undefined, { opened: menu.menuOptions > 0 });
    this.providerStructure('pixeon_download_options', menu.menuOptions);
    this.providerStructure('viewer_download_options', menu.menuOptions);
    this.providerStructure('centrodm_download_options', menu.menuOptions);
    if (!menu.menuOptions) throw new MedicalArchiveError('DOWNLOAD_MENU_NOT_FOUND');
    if (!menu.control) throw new MedicalArchiveError('DOWNLOAD_ACTION_NOT_FOUND');
    const option = menu.control;
    this.providerStructure('pixeon_download_choice', undefined, { found: true, strategy: 'full_dicom_zip', kind: 'full_dicom_zip' });
    this.providerStructure('viewer_download_strategy', undefined, { found: true });
    this.providerStructure('centrodm_download_choice', undefined, { found: true, strategy: 'full_dicom_zip' });
    this.onCentroDmDownloadStarting?.();
    this.invalidArchiveObserved = false;
    const archivePromise = this.nextMedicalArchive(timeoutMs);
    this.archiveActionDepth++;
    try {
      await clickPixeonControl(option, this.page, trace, canInteract);
      const archive = await archivePromise;
      if (!archive) throw new MedicalArchiveError(this.invalidArchiveObserved ? 'INVALID_MEDICAL_ARCHIVE' : 'DICOM_DOWNLOAD_TIMEOUT');
      this.providerStructure('medical_archive_downloaded', archive.buffer.length);
      this.providerStructure('centrodm_archive_valid', archive.buffer.length, { found: true });
      return archive;
    } catch (error) {
      if (error instanceof MedicalArchiveError || error instanceof UnexpectedDomainError) throw error;
      if (this.invalidArchiveObserved) throw new MedicalArchiveError('INVALID_MEDICAL_ARCHIVE');
      if (this.closing) throw error;
      throw new MedicalArchiveError('DICOM_DOWNLOAD_TIMEOUT');
    } finally {
      this.archiveActionDepth = Math.max(0, this.archiveActionDepth - 1);
    }
  }

  private nextMedicalArchive(timeoutMs: number): Promise<CapturedMedicalArchive | null> {
    return new Promise((resolve) => {
      const waiter = (archive: CapturedMedicalArchive | null) => {
        clearTimeout(timer);
        this.archiveWaiters = this.archiveWaiters.filter((candidate) => candidate !== waiter);
        resolve(archive);
      };
      const timer = setTimeout(() => waiter(null), timeoutMs);
      this.archiveWaiters.push(waiter);
    });
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

  private async requestRdcApiResponse(url: string, deadline: number, range?: string, referer?: string): Promise<{ response: APIResponse; url: string }> {
    const expectedOrigin = this.originOf(url);
    if (!expectedOrigin || !this.policy.isAllowedNavigation(url)) {
      this.notifyBlockedUrl(url);
      throw new UnexpectedDomainError();
    }
    const safeReferer = referer && this.originOf(referer) === expectedOrigin ? referer : undefined;
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      if (this.originOf(current) !== expectedOrigin || !this.policy.isAllowedNavigation(current)) {
        this.notifyBlockedUrl(current);
        throw new UnexpectedDomainError();
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED');
      let response: APIResponse;
      try {
        response = await this.context.request.get(current, {
          timeout: remaining,
          maxRedirects: 0,
          headers: { Accept: 'application/pdf', ...(range ? { Range: range } : {}), ...(safeReferer ? { Referer: safeReferer } : {}) },
        });
      } catch {
        throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED');
      }
      const status = response.status();
      if (status < 300 || status >= 400) return { response, url: current };
      const location = response.headers().location;
      await response.dispose().catch(() => {});
      if (!location || hop === 5) throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED');
      try { current = new URL(location, current).href; }
      catch { throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED'); }
      if (this.originOf(current) !== expectedOrigin || !this.policy.isAllowedNavigation(current)) {
        this.notifyBlockedUrl(current);
        throw new UnexpectedDomainError();
      }
    }
    throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED');
  }

  private parseRdcContentRange(value: string): { start: number; end: number; total: number } | null {
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total) && start <= end && end < total
      ? { start, end, total }
      : null;
  }

  private makeRdcPdf(buffer: Buffer, contentType: string | null, strategy: NonNullable<ProviderStructureEvent['strategy']>): CapturedPdf {
    this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy });
    this.providerStructure('rdc_pdf_full', buffer.length, { found: true, strategy });
    this.providerStructure('rdc_pdf_valid', buffer.length, { found: true, strategy });
    return { buffer, contentType, via: 'fetch' };
  }

  /** Obtiene un PDF completo con la cookie jar de la sesión; los 206 se reensamblan por rango. */
  private async fetchRdcPdfFull(
    url: string,
    deadline: number,
    fallbackStrategy: 'response_full' | 'iframe_fetch' | 'embed_fetch' | 'object_fetch' | 'context_request',
    referer?: string,
  ): Promise<CapturedPdf | null> {
    const { response, url: finalUrl } = await this.requestRdcApiResponse(url, deadline, undefined, referer);
    const status = response.status();
    const headers = response.headers();
    const contentType = headers['content-type'] || null;
    const contentRangeValue = headers['content-range'] || '';
    const range = this.parseRdcContentRange(contentRangeValue);
    const isRangeResponse = status === 206 || !!contentRangeValue;
    const announcedSize = Number(headers['content-length']);
    if (!isRangeResponse && Number.isFinite(announcedSize) && announcedSize > this.maxPdfBytes) {
      this.logRdcPdfCandidate(status, headers, null, true, true, 'oversized');
      await response.dispose().catch(() => {});
      this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy: fallbackStrategy });
      throw new RdcChacabucoError('INVALID_PDF');
    }
    if (!response.ok() && !isRangeResponse) {
      await response.dispose().catch(() => {});
      if (status === 404 || status === 410) return null;
      throw new RdcChacabucoError('PDF_FULL_FETCH_FAILED');
    }
    if (isRangeResponse && (!range || range.total > this.maxPdfBytes)) {
      this.logRdcPdfCandidate(status, headers, null, true, true, 'range_metadata_invalid');
      await response.dispose().catch(() => {});
      throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
    }
    let body: Buffer;
    try { body = await response.body(); }
    catch {
      await response.dispose().catch(() => {});
      throw new RdcChacabucoError(isRangeResponse ? 'PDF_RANGE_REASSEMBLY_FAILED' : 'PDF_FULL_FETCH_FAILED');
    }
    await response.dispose().catch(() => {});
    const claimsPdf = /pdf/i.test(contentType || '') || /\.pdf/i.test(headers['content-disposition'] || '');
    if (isHtmlPayload(body)) {
      this.logRdcPdfCandidate(status, headers, body, true, true, 'html_payload');
      return null;
    }
    if (!isRangeResponse) {
      const valid = hasPdfMagic(body) && body.subarray(0, 4).toString('latin1') === '%PDF' && validatePdf(body, contentType, this.maxPdfBytes).ok;
      this.logRdcPdfCandidate(status, headers, body, !valid, !valid, valid ? undefined : 'not_pdf_payload');
      if (!valid) {
        if (claimsPdf) throw new RdcChacabucoError('INVALID_PDF');
        return null;
      }
      return this.makeRdcPdf(body, contentType, fallbackStrategy);
    }

    this.logRdcPdfCandidate(status, headers, body, true, true, 'range_fragment');
    if (!range || body.length !== range.end - range.start + 1) throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
    if (range.start === 0 && range.end === range.total - 1 && body.length === range.total) {
      if (!hasPdfMagic(body) || body.subarray(0, 4).toString('latin1') !== '%PDF' || !validatePdf(body, contentType, this.maxPdfBytes).ok) {
        throw new RdcChacabucoError('INVALID_PDF');
      }
      return this.makeRdcPdf(body, contentType, 'range_reassembly');
    }

    const chunks: Buffer[] = [];
    let nextByte = 0;
    if (range.start === 0) {
      chunks.push(body);
      nextByte = range.end + 1;
    }
    const chunkSize = Math.min(1024 * 1024, this.maxPdfBytes);
    while (nextByte < range.total) {
      const requestedEnd = Math.min(range.total - 1, nextByte + chunkSize - 1);
      const part = await this.requestRdcApiResponse(finalUrl, deadline, `bytes=${nextByte}-${requestedEnd}`, referer);
      const partStatus = part.response.status();
      const partHeaders = part.response.headers();
      const partContentType = partHeaders['content-type'] || contentType;
      const partRange = this.parseRdcContentRange(partHeaders['content-range'] || '');
      let bytes: Buffer;
      try { bytes = await part.response.body(); }
      catch {
        await part.response.dispose().catch(() => {});
        throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
      }
      await part.response.dispose().catch(() => {});
      if (partStatus === 200) {
        this.logRdcPdfCandidate(partStatus, partHeaders, bytes, false);
        if (bytes.length === range.total && hasPdfMagic(bytes) && bytes.subarray(0, 4).toString('latin1') === '%PDF' && validatePdf(bytes, partContentType, this.maxPdfBytes).ok) {
          return this.makeRdcPdf(bytes, partContentType, 'response_full');
        }
        throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
      }
      this.logRdcPdfCandidate(partStatus, partHeaders, bytes, true, true, 'range_fragment');
      if (partStatus !== 206 || !partRange || partRange.start !== nextByte || partRange.total !== range.total ||
          partRange.end > requestedEnd || bytes.length !== partRange.end - partRange.start + 1) {
        throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
      }
      chunks.push(bytes);
      nextByte = partRange.end + 1;
    }
    const assembled = Buffer.concat(chunks, range.total);
    if (assembled.length !== range.total) throw new RdcChacabucoError('PDF_RANGE_REASSEMBLY_FAILED');
    if (!hasPdfMagic(assembled) || assembled.subarray(0, 4).toString('latin1') !== '%PDF' || !validatePdf(assembled, contentType, this.maxPdfBytes).ok) {
      throw new RdcChacabucoError('INVALID_PDF');
    }
    return this.makeRdcPdf(assembled, contentType, 'range_reassembly');
  }

  /** Recupera la fuente desde el frame que la declara: el fetch conserva cookies, origin y referrer del navegador. */
  private async fetchRdcBrowserSource(source: RdcDomSource, deadline: number): Promise<RdcBrowserFetchResult> {
    const frameUrl = source.frame.url();
    const sourceOrigin = this.originOf(source.url);
    const frameOrigin = this.originOf(frameUrl);
    if (!/^https?:/i.test(source.url) || !sourceOrigin || sourceOrigin !== frameOrigin || !this.policy.isAllowedNavigation(source.url)) {
      return { kind: 'failed', status: 0, contentType: '', bodyBytes: 0, magic: 'none', reason: 'origin_mismatch' };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0 || source.frame.isDetached()) {
      return { kind: 'failed', status: 0, contentType: '', bodyBytes: 0, magic: 'none', reason: remaining <= 0 ? 'timeout' : 'frame_unavailable' };
    }

    this.providerStructure('rdc_embed_fetch', undefined, { started: true, depth: source.depth });
    let result: RdcBrowserFetchResult;
    try {
      result = await this.withPdfTimeout(source.frame.evaluate(async ({ url, maxBytes, depth }) => {
        try {
          const requestUrl = new URL(url, location.href);
          if (requestUrl.origin !== location.origin || !/^https?:$/.test(requestUrl.protocol)) {
            return { kind: 'failed', status: 0, contentType: '', bodyBytes: 0, magic: 'none', reason: 'origin_mismatch' };
          }
          const response = await fetch(requestUrl.href, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
          const contentType = response.headers.get('content-type') || '';
          let responseUrl: URL;
          try { responseUrl = new URL(response.url || requestUrl.href); }
          catch { return { kind: 'failed', status: response.status, contentType, bodyBytes: 0, magic: 'none', reason: 'invalid_response_url' }; }
          if (responseUrl.origin !== location.origin || !response.ok) {
            return { kind: 'failed', status: response.status, contentType, bodyBytes: 0, magic: 'none', reason: response.ok ? 'origin_mismatch' : 'http_status' };
          }
          const announced = Number(response.headers.get('content-length'));
          if (Number.isFinite(announced) && announced > maxBytes) return { kind: 'invalid', status: response.status, contentType, bodyBytes: announced, magic: 'none', reason: 'oversized' };
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.length || bytes.length > maxBytes) return { kind: 'invalid', status: response.status, contentType, bodyBytes: bytes.length, magic: 'none', reason: bytes.length > maxBytes ? 'oversized' : 'empty_body' };
          const magic = Array.from(bytes.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('') || 'none';
          const pdfMagic = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
          if (pdfMagic) {
            let binary = '';
            for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
            return { kind: 'pdf', status: response.status, contentType, bodyBytes: bytes.length, magic, data: btoa(binary) };
          }

          const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).replace(/^\uFEFF/, '').trimStart();
          const htmlPayload = /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(prefix) || /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType);
          if (!htmlPayload) return { kind: 'invalid', status: response.status, contentType, bodyBytes: bytes.length, magic, reason: 'not_pdf_payload' };

          const nested: NonNullable<RdcBrowserFetchResult['nested']> = [];
          if (depth < 3 && bytes.length <= 2 * 1024 * 1024) {
            const markup = new TextDecoder().decode(bytes);
            const documentNode = new DOMParser().parseFromString(markup, 'text/html');
            const baseNode = documentNode.querySelector('base[href]');
            let baseUrl = responseUrl.href;
            if (baseNode) {
              try {
                const candidateBase = new URL(baseNode.getAttribute('href') || '', responseUrl.href);
                if (candidateBase.origin === location.origin) baseUrl = candidateBase.href;
              } catch { /* base inválida: conserva la URL del documento */ }
            }
            const seen = new Set<string>();
            for (const node of Array.from(documentNode.querySelectorAll('iframe,embed,object,source,[data-src],[data-pdf],[data-url],a[href]')).slice(0, 80)) {
              const tag = node.tagName.toLowerCase();
              const attrs = tag === 'object' ? ['data', 'src', 'data-src', 'data-pdf', 'data-url']
                : tag === 'a' ? ['href']
                  : ['src', 'data', 'data-src', 'data-pdf', 'data-url', 'href'];
              for (const attribute of attrs) {
                const raw = node.getAttribute(attribute);
                if (!raw || (attribute === 'href' && tag === 'a' && !/\.pdf(?:[?#]|$)/i.test(raw))) continue;
                let candidate: URL;
                try { candidate = new URL(raw, baseUrl); } catch { continue; }
                const isDataPdf = /^data:application\/pdf(?:;|,)/i.test(candidate.href);
                const isBlobSameOrigin = /^blob:/i.test(candidate.protocol) && candidate.href.slice(5).startsWith(location.origin + '/');
                if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
                  if (candidate.origin !== location.origin) continue;
                } else if (!isDataPdf && !isBlobSameOrigin) continue;
                const normalized = candidate.href;
                if (seen.has(normalized)) continue;
                seen.add(normalized);
                const strategy = tag === 'embed' ? 'embed' : tag === 'object' ? 'object' : isDataPdf ? 'data' : isBlobSameOrigin ? 'blob' : 'iframe';
                nested.push({
                  url: normalized,
                  strategy,
                  attr: attribute === 'data' ? 'data' : attribute === 'href' ? 'href' : attribute === 'data-src' ? 'data-src' : attribute === 'data-pdf' ? 'data-pdf' : attribute === 'data-url' ? 'data-url' : 'src',
                  typePdf: /pdf/i.test(node.getAttribute('type') || '') || /\.pdf(?:[?#]|$)/i.test(normalized) || isDataPdf,
                });
                break;
              }
              if (nested.length >= 32) break;
            }
          }
          return { kind: 'html', status: response.status, contentType, bodyBytes: bytes.length, magic, nested };
        } catch {
          return { kind: 'failed', status: 0, contentType: '', bodyBytes: 0, magic: 'none', reason: 'browser_fetch_failed' };
        }
      }, { url: source.url, maxBytes: this.maxPdfBytes, depth: source.depth }), remaining);
    } catch (error) {
      result = { kind: 'failed', status: 0, contentType: '', bodyBytes: 0, magic: 'none', reason: error instanceof PdfDownloadError ? 'timeout' : 'browser_evaluate_error' };
    }

    const safeContentType = this.contentTypeKind(result.contentType);
    this.providerStructure('rdc_embed_fetch', undefined, {
      depth: source.depth, status: result.status, contentType: safeContentType, magic: result.magic,
      bodyBytes: result.bodyBytes, found: result.kind === 'pdf', rejected: result.kind === 'invalid',
      ...(result.reason ? { reason: result.reason } : {}),
    });
    if (result.kind === 'html') {
      this.logRdcPdfCandidate(result.status, { 'content-type': result.contentType, 'content-length': String(result.bodyBytes) }, null, true, true, 'html_payload');
      const nested = result.nested || [];
      this.providerStructure('rdc_nested_source_scan', nested.length, { depth: source.depth + 1, found: nested.length > 0 });
      for (const item of nested) {
        if (item.strategy === 'embed' && !this.rdcLoggedEmbedCandidateUrls.has(item.url)) {
          this.rdcLoggedEmbedCandidateUrls.add(item.url);
          this.providerStructure('rdc_embed_candidate', undefined, { found: true, sameOrigin: true, typePdf: item.typePdf, depth: source.depth + 1 });
        }
      }
      return result;
    }
    if (result.kind === 'pdf') {
      const buffer = Buffer.from(result.data || '', 'base64');
      const valid = buffer.subarray(0, 4).toString('latin1') === '%PDF' && validatePdf(buffer, result.contentType, this.maxPdfBytes).ok;
      this.logRdcPdfCandidate(result.status, { 'content-type': result.contentType, 'content-length': String(result.bodyBytes) }, buffer, !valid, !valid, valid ? undefined : 'not_pdf_payload');
      if (!valid) return { ...result, kind: 'invalid', reason: 'not_pdf_payload' };
      return result;
    }
    if (result.kind === 'invalid') {
      this.logRdcPdfCandidate(result.status, { 'content-type': result.contentType, 'content-length': String(result.bodyBytes) }, null, true, true, result.reason || 'not_pdf_payload');
    }
    return result;
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

  async downloadRdcChacabucoStudyPdf(): Promise<CapturedPdf | null> {
    if (this.provider.studyExtractor !== 'rdcchacabuco' || !this.activeStudyId) throw new RdcChacabucoError('PDF_SOURCE_NOT_FOUND');
    const invalidBefore = this.invalidPdfObservedAt;
    const deadline = Date.now() + this.pdfDownloadTimeoutMs;
    const alreadyCaptured = this.takeRecentPdf();
    if (alreadyCaptured) {
      if (!this.isRdcPdfPayload(alreadyCaptured.buffer, alreadyCaptured.contentType)) throw new RdcChacabucoError('INVALID_PDF');
      const strategy = alreadyCaptured.via === 'download' ? 'download' : 'response_full';
      this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy });
      this.providerStructure('rdc_pdf_full', alreadyCaptured.buffer.length, { found: true, strategy });
      this.providerStructure('rdc_pdf_valid', alreadyCaptured.buffer.length, { found: true, strategy });
      return alreadyCaptured;
    }

    let invalidFullPayload = false;
    let recoveryFailure: 'PDF_RANGE_REASSEMBLY_FAILED' | 'PDF_FULL_FETCH_FAILED' | null = null;
    const processedUrls = new Set<string>();
    const maxNestedDepth = 3;
    const maxCandidates = 48;
    this.pdfActionDepth++;
    try {
      while (Date.now() < deadline) {
        const captured = this.takeRecentPdf();
        if (captured) {
          if (!this.isRdcPdfPayload(captured.buffer, captured.contentType)) {
            invalidFullPayload = true;
          } else {
            const strategy = captured.via === 'download' ? 'download' : 'response_full';
            this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy });
            this.providerStructure('rdc_pdf_full', captured.buffer.length, { found: true, strategy });
            this.providerStructure('rdc_pdf_valid', captured.buffer.length, { found: true, strategy });
            return captured;
          }
        }

        const state = await this.rdcModalState();
        const capturedAfterScan = this.takeRecentPdf();
        if (capturedAfterScan) {
          if (!this.isRdcPdfPayload(capturedAfterScan.buffer, capturedAfterScan.contentType)) {
            invalidFullPayload = true;
          } else {
            const strategy = capturedAfterScan.via === 'download' ? 'download' : 'response_full';
            this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy });
            this.providerStructure('rdc_pdf_full', capturedAfterScan.buffer.length, { found: true, strategy });
            this.providerStructure('rdc_pdf_valid', capturedAfterScan.buffer.length, { found: true, strategy });
            return capturedAfterScan;
          }
        }
        const candidates: { url: string; strategy: string; depth: number; source?: RdcDomSource }[] = [
          ...[...this.rdcPdfCandidateUrls].map((url) => ({ url, strategy: 'response_candidate', depth: 0 })),
          ...state.sources.map((source) => ({ url: source.url, strategy: source.strategy, depth: source.depth, source })),
          ...state.pdfDocuments.map((url) => ({ url, strategy: 'context_request', depth: 0 })),
        ];
        this.rdcPdfCandidateUrls.clear();
        let processedAny = false;
        for (let candidateIndex = 0; candidateIndex < candidates.length && candidateIndex < maxCandidates; candidateIndex++) {
          const candidate = candidates[candidateIndex];
          if (processedUrls.has(candidate.url)) continue;
          processedUrls.add(candidate.url);
          processedAny = true;
          if (/^https?:/i.test(candidate.url) && !this.policy.isAllowedNavigation(candidate.url)) {
            const host = this.safeUrlParts(candidate.url).host;
            this.providerStructure('rdc_external_origin', undefined, { host });
            this.notifyBlockedUrl(candidate.url);
            throw new UnexpectedDomainError();
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          try {
            if (/^https?:/i.test(candidate.url)) {
              const candidateDeadline = Math.min(deadline, Date.now() + Math.min(8_000, remaining));
              if (candidate.source && candidate.depth <= maxNestedDepth) {
                const browserResult = await this.fetchRdcBrowserSource(candidate.source, candidateDeadline);
                if (browserResult.kind === 'pdf') {
                  const buffer = Buffer.from(browserResult.data || '', 'base64');
                  const strategy: NonNullable<ProviderStructureEvent['strategy']> = candidate.source.strategy === 'embed'
                    ? candidate.depth > 0 ? 'nested_embed_browser_fetch' : 'embed_browser_fetch'
                    : candidate.source.strategy === 'object' ? 'object_browser_fetch' : 'iframe_browser_fetch';
                  return this.makeRdcPdf(buffer, browserResult.contentType || null, strategy);
                }
                if (browserResult.kind === 'html') {
                  for (const nested of browserResult.nested || []) {
                    const nestedDepth = candidate.depth + 1;
                    if (nestedDepth > maxNestedDepth || candidates.length >= maxCandidates) continue;
                    candidates.push({
                      url: nested.url,
                      strategy: nested.strategy,
                      depth: nestedDepth,
                      source: { ...nested, frame: candidate.source.frame, depth: nestedDepth },
                    });
                  }
                  continue;
                }
                if (browserResult.kind === 'invalid') invalidFullPayload = true;
              }
              const fallbackStrategy = candidate.strategy === 'response_candidate' ? 'response_full'
                : candidate.strategy === 'embed' ? 'embed_fetch'
                  : candidate.strategy === 'object' ? 'object_fetch'
                    : candidate.strategy === 'context_request' ? 'context_request' : 'iframe_fetch';
              const referer = candidate.source?.frame.url();
              const pdf = await this.fetchRdcPdfFull(candidate.url, candidateDeadline, fallbackStrategy, referer);
              if (pdf) return pdf;
              continue;
            }
            const pdf = await this.withPdfTimeout(this.fetchPdf(candidate.url, Math.min(remaining, 8_000)), Math.min(remaining, 8_000));
            if (!pdf) continue;
            if (!hasPdfMagic(pdf.buffer) || pdf.buffer.subarray(0, 4).toString('latin1') !== '%PDF' || !validatePdf(pdf.buffer, pdf.contentType, this.maxPdfBytes).ok) {
              invalidFullPayload = true;
              this.logRdcPdfCandidate(200, { 'content-type': pdf.contentType || '' }, pdf.buffer, true, true, 'not_pdf_payload');
              continue;
            }
            const strategy = /^blob:/i.test(candidate.url) ? 'blob_fetch'
              : /^data:/i.test(candidate.url) ? 'data_url'
                : candidate.strategy === 'embed' ? 'embed_fetch'
                  : candidate.strategy === 'object' ? 'object_fetch'
                    : candidate.strategy === 'context_request' ? 'context_request' : 'iframe_fetch';
            return this.makeRdcPdf(pdf.buffer, pdf.contentType, strategy);
          } catch (error) {
            if (error instanceof UnexpectedDomainError) throw error;
            if (error instanceof RdcChacabucoError) {
              if (error.code === 'INVALID_PDF') invalidFullPayload = true;
              else if (error.code === 'PDF_RANGE_REASSEMBLY_FAILED') recoveryFailure ||= error.code;
              else if (error.code !== 'PDF_FULL_FETCH_FAILED') throw error;
              continue;
            }
            if (error instanceof PdfDownloadError && (error.code === 'INVALID_DOCUMENT' || error.code === 'PDF_DOWNLOAD_TIMEOUT')) {
              if (error.code === 'INVALID_DOCUMENT') invalidFullPayload = true;
              continue;
            }
            throw error;
          }
        }

        const lateCapture = this.takeRecentPdf();
        if (lateCapture && this.isRdcPdfPayload(lateCapture.buffer, lateCapture.contentType)) {
          const strategy = lateCapture.via === 'download' ? 'download' : 'response_full';
          this.providerStructure('rdc_pdf_source', undefined, { found: true, strategy });
          this.providerStructure('rdc_pdf_full', lateCapture.buffer.length, { found: true, strategy });
          this.providerStructure('rdc_pdf_valid', lateCapture.buffer.length, { found: true, strategy });
          return lateCapture;
        }
        if (!processedAny) await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
      }

      if (recoveryFailure) throw new RdcChacabucoError(recoveryFailure);
      if (invalidFullPayload || this.rdcInvalidPdfObservedAt > 0 || this.invalidPdfObservedAt > invalidBefore) throw new RdcChacabucoError('INVALID_PDF');
      throw new RdcChacabucoError('PDF_SOURCE_NOT_FOUND');
    } finally {
      this.pdfActionDepth = Math.max(0, this.pdfActionDepth - 1);
    }
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
