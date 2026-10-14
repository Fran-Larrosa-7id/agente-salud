import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { AGENT_ROOT } from '../../src/config.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { JobState } from '../../src/jobs/states.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { createApp } from '../../src/server/app.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig } from '../helpers.js';
import { testBrowserChannel } from '../browser-channel.js';

test('tras recargar, el aviso de importación activa permite cancelarla y abrir otra institución', { timeout: 30_000 }, async () => {
  const config = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ loginDelayMs: 20, stepMs: 20 }), log: silentLogger });
  const previous = manager.create('rdcchacabuco');
  const server = createApp({ config, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'fake', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  try {
    const page = await browser.newPage();
    await page.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
    await page.goto(base + '/#/login');
    await page.fill('#dni', '32456789'); await page.fill('#pass', 'demo');
    await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
    await page.goto(base + '/#/traer?inst=cdm');
    // La página nueva no tiene el job anterior en memoria, como después de Ctrl+F5.
    await page.click('[data-action=live-open]');
    const cancel = page.getByRole('button', { name: 'Cancelar importación en curso' });
    await cancel.waitFor();
    await cancel.click();
    await page.waitForSelector('#live-open-error .error-card', { state: 'detached' });
    assert.equal(previous.state, JobState.CANCELLED);
    assert.equal(manager.activeCount(), 0);
    await page.click('[data-action=live-open]');
    await page.waitForSelector('.res-list');
    assert.equal(manager.activeJobs()[0]?.provider, 'centrodm');
  } finally {
    await browser.close(); await manager.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('recargar el enlace de regreso recupera el mismo job sin cancelarlo', { timeout: 30_000 }, async () => {
  const config = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config, providers: PROVIDERS, runnerFactory: fakeRunnerFactory({ loginDelayMs: 20, stepMs: 20 }), log: silentLogger });
  const server = createApp({ config, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
    await page.goto(base + '/#/login'); await page.fill('#dni', '32456789'); await page.fill('#pass', 'demo');
    await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
    await page.goto(base + '/#/traer?inst=cdm'); await page.click('[data-action=live-open]'); await page.waitForSelector('.res-list');
    const job = manager.activeJobs()[0]; assert.ok(job);
    assert.match(page.url(), new RegExp(job.id));
    await page.reload(); await page.waitForSelector('.res-list');
    assert.equal(manager.activeCount(), 1); assert.equal(manager.activeJobs()[0].id, job.id);
    await page.evaluate(() => { const P = (window as any).P; P.startFlow(new URLSearchParams(location.hash.split('?')[1])); P.mountFlow(); });
    await page.waitForSelector('.res-list'); assert.equal(job.state, JobState.WAITING_SELECTION);
    await page.click('.flow-exit'); await page.click('.ov [data-confirm]');
    await page.waitForFunction(() => !location.hash.startsWith('#/traer'));
    assert.equal(job.state, JobState.CANCELLED);
  } finally { await browser.close(); await manager.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
