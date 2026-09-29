import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface BrowserHostOptions {
  headless: boolean;
  /** Optional Playwright browser channel (for example, installed Edge on Windows). */
  channel?: string;
  /** Solo desarrollo y con cuentas de prueba: guarda un trace de Playwright al cerrar cada contexto. */
  debugArtifacts: boolean;
  debugDir: string;
  /** Injectable so channel selection and launch failures can be tested without a real browser. */
  launchBrowser?: (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;
}

export class BrowserNotInstalledError extends Error {
  readonly code = 'BROWSER_NOT_INSTALLED';

  constructor() {
    super('BROWSER_NOT_INSTALLED');
    this.name = 'BrowserNotInstalledError';
  }
}

export function browserLaunchOptions(opts: Pick<BrowserHostOptions, 'headless' | 'channel'>): Parameters<typeof chromium.launch>[0] {
  return {
    headless: opts.headless,
    ...(opts.channel ? { channel: opts.channel } : {}),
    args: ['--disable-features=Translate', '--no-default-browser-check'],
  };
}

/**
 * Un único proceso de Chromium y un BrowserContext AISLADO por job.
 * Los contextos no comparten cookies, localStorage, sessionStorage ni caché.
 * Sin video, sin HAR, sin screenshots y sin trace, salvo que se active la bandera de depuración.
 */
export class BrowserHost {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly contexts = new Set<BrowserContext>();
  private readonly launchBrowser: NonNullable<BrowserHostOptions['launchBrowser']>;

  constructor(private readonly opts: BrowserHostOptions) {
    this.launchBrowser = opts.launchBrowser ?? ((options) => chromium.launch(options));
  }

  get openContexts(): number {
    return this.contexts.size;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = this.launchBrowser(browserLaunchOptions(this.opts))
        .then((b) => {
          this.browser = b;
          b.on('disconnected', () => {
            this.browser = null;
            this.contexts.clear();
          });
          return b;
        })
        .catch(() => {
          this.browser = null;
          throw new BrowserNotInstalledError();
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  async ensureBrowserAvailable(): Promise<void> {
    await this.getBrowser();
  }

  async newContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: { width: 1180, height: 820 },
      serviceWorkers: 'block',
    });
    this.contexts.add(context);
    context.on('close', () => this.contexts.delete(context));
    if (this.opts.debugArtifacts) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      const file = path.join(this.opts.debugDir, randomUUID() + '.zip');
      const close = context.close.bind(context);
      context.close = async (o) => {
        await context.tracing.stop({ path: file }).catch(() => {});
        return close(o);
      };
    }
    return context;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    await Promise.all([...this.contexts].map((c) => c.close().catch(() => {})));
    this.contexts.clear();
    if (b) await b.close().catch(() => {});
  }
}
