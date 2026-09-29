import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from '../src/config.js';
import type { BrowserPort, ProviderStudyList, RawElement, RawPageSnapshot } from '../src/browser/types.js';
import type { CapturedPdf } from '../src/jobs/pdf.js';
import type { ProviderConfig } from '../src/providers/types.js';

export function testConfig(over: Partial<Config> = {}): Config {
  const base = loadConfig({ LOG_LEVEL: 'silent', HEADLESS: 'true', LLM_PROVIDER: 'rules', SERVE_PORTAL: 'false' }, []);
  return { ...base, tmpDir: mkdtempSync(path.join(tmpdir(), 'pp-agent-')), ...over };
}

export const testProvider = (loginUrl = 'http://127.0.0.1:1/lwcloud/fake/login'): ProviderConfig => ({
  id: 'fake',
  name: 'Laboratorio de Prueba',
  loginUrl,
  allowedHosts: ['127.0.0.1'],
  staticHosts: [],
  loginPathPattern: /\/login\/?$/i,
  authenticatedHints: ['RESULTADOS ONLINE'],
  expectedPdfLabels: ['Ver en PDF'],
  resultsHints: ['RESULTADOS ONLINE'],
  agentNotes: 'Portal de prueba.',
  studyExtractor: 'labwin',
});

export function el(id: string, label: string, extra: Partial<RawElement> = {}): RawElement {
  return { id, frame: 0, tag: 'button', role: 'button', label, iconHint: '', href: '', target: '', type: '', disabled: false, inPasswordForm: false, isSubmit: false, ...extra };
}

export function snap(extra: Partial<RawPageSnapshot> = {}): RawPageSnapshot {
  return {
    url: 'http://127.0.0.1/lwcloud/fake/resultados',
    title: 'Resultados',
    headings: [],
    hintHits: [],
    hasPasswordField: false,
    captcha: false,
    otp: false,
    modal: false,
    modalText: '',
    noResultsText: false,
    isPdfViewer: false,
    pdfEmbeds: [],
    elements: [],
    collections: [],
    ...extra,
  };
}

/** BrowserPort falso: devuelve siempre la misma página y registra lo que se hizo. */
export class FakePort implements BrowserPort {
  clicks: string[] = [];
  navigations: string[] = [];
  providerStudyList: ProviderStudyList | null = null;
  constructor(
    public page: RawPageSnapshot,
    public pdfOnClick: CapturedPdf | null = null,
  ) {}
  async snapshot() {
    return structuredClone(this.page);
  }
  async listStudies() {
    return this.providerStudyList;
  }
  async click(e: RawElement) {
    this.clicks.push(e.id);
    return { newPage: false };
  }
  async navigate(url: string) {
    this.navigations.push(url);
  }
  async goBack() {
    return false;
  }
  async switchToNewestPage() {
    return false;
  }
  async scroll() {}
  async wait() {}
  async capturePdfDuring(action: () => Promise<unknown>) {
    await action();
    return this.pdfOnClick;
  }
  async waitForPdf() {
    return null;
  }
  async fetchPdf() {
    return null;
  }
  currentUrl() {
    return this.page.url;
  }
  openPages() {
    return 1;
  }
}

export async function waitFor(cond: () => boolean, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
