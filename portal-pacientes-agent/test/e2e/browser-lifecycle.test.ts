import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { silentLogger } from '../../src/security/logger.js';
import { testBrowserChannel } from '../browser-channel.js';
import { testConfig, testProvider, waitFor } from '../helpers.js';

test('cancelar durante launch espera el contexto pendiente y no deja Chromium huérfano', { timeout: 30_000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let browser: Browser | undefined;
  const host = new BrowserHost({
    headless: true, channel: testBrowserChannel, debugArtifacts: false, debugDir: '',
    launchBrowser: async options => { await gate; browser = await chromium.launch(options); return browser; },
  });
  const manager = new JobManager({
    config: testConfig(), providers: { fake: testProvider() }, log: silentLogger,
    runnerFactory: (job, deps) => new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel() }),
  });
  try {
    const job = manager.create('fake');
    const cancelled = manager.cancel(job.id);
    release();
    await cancelled;
    assert.equal(job.state, JobState.CANCELLED);
    assert.equal(host.openContexts, 0);
    await waitFor(() => !!browser && !browser.isConnected());
  } finally { release(); await manager.shutdown(); await host.close(); }
});

test('el último contexto cierra Chromium y el siguiente job recibe un proceso nuevo', { timeout: 30_000 }, async () => {
  const browsers: Browser[] = [];
  const host = new BrowserHost({
    headless: true, channel: testBrowserChannel, debugArtifacts: false, debugDir: '',
    launchBrowser: async options => { const browser = await chromium.launch(options); browsers.push(browser); return browser; },
  });
  try {
    for (let i = 0; i < 2; i++) {
      const context = await host.newContext();
      await context.newPage();
      await context.close();
      await waitFor(() => !browsers[i].isConnected());
      assert.equal(host.openContexts, 0);
    }
    assert.equal(browsers.length, 2);
  } finally { await host.close(); }
});
