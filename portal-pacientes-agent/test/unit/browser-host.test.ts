import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { BrowserHost, BrowserNotInstalledError, browserLaunchOptions } from '../../src/browser/browser-host.js';
import { loadConfig } from '../../src/config.js';
import { formatLine } from '../../src/security/logger.js';

const browserStub = () => ({
  isConnected: () => true,
  on: () => undefined,
  close: async () => undefined,
}) as unknown as Browser;

test('configura el canal elegido y mantiene Chromium empaquetado por defecto', () => {
  const config = loadConfig({ LLM_PROVIDER: 'rules', BROWSER_CHANNEL: ' msedge ' }, []);
  assert.equal(config.browserChannel, 'msedge');
  assert.equal(config.pdfDownloadTimeoutMs, 60_000);
  assert.equal(config.rdcPdfSourceTimeoutMs, 30_000);
  assert.deepEqual(browserLaunchOptions({ headless: false, channel: config.browserChannel }), {
    headless: false,
    channel: 'msedge',
    args: ['--disable-features=Translate', '--no-default-browser-check'],
  });

  const defaultConfig = loadConfig({ LLM_PROVIDER: 'rules', BROWSER_CHANNEL: '  ' }, []);
  assert.equal(defaultConfig.browserChannel, undefined);
  assert.equal(loadConfig({ LLM_PROVIDER: 'rules', PDF_DOWNLOAD_TIMEOUT_MS: '12000' }, []).pdfDownloadTimeoutMs, 12_000);
  assert.equal(loadConfig({ LLM_PROVIDER: 'rules', RDC_PDF_SOURCE_TIMEOUT_MS: '9000' }, []).rdcPdfSourceTimeoutMs, 9_000);
  assert.deepEqual(browserLaunchOptions({ headless: true, channel: defaultConfig.browserChannel }), {
    headless: true,
    args: ['--disable-features=Translate', '--no-default-browser-check'],
  });
});

test('BrowserHost launches the configured channel and can warm it up at startup', async () => {
  let launchOptions: Parameters<NonNullable<ConstructorParameters<typeof BrowserHost>[0]['launchBrowser']>>[0] | undefined;
  const host = new BrowserHost({
    headless: false,
    channel: 'msedge',
    debugArtifacts: false,
    debugDir: '',
    launchBrowser: async (options) => {
      launchOptions = options;
      return browserStub();
    },
  });

  await host.ensureBrowserAvailable();
  assert.equal(launchOptions?.channel, 'msedge');
  assert.equal(launchOptions?.headless, false);
  await host.close();
});

test('a requested channel that cannot launch reports BROWSER_NOT_INSTALLED', async () => {
  const host = new BrowserHost({
    headless: true,
    channel: 'missing-channel',
    debugArtifacts: false,
    debugDir: '',
    launchBrowser: async () => { throw new Error('internal launch path'); },
  });

  await assert.rejects(host.ensureBrowserAvailable(), (error: unknown) =>
    error instanceof BrowserNotInstalledError && error.code === 'BROWSER_NOT_INSTALLED' && error.message === 'BROWSER_NOT_INSTALLED');
  await host.close();
});

test('browser_ready logs the requested channel through the safe-field whitelist', () => {
  assert.equal(formatLine(null, 'browser_ready', { channel: 'msedge' }), 'browser_ready channel=msedge');
});
