import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AGENT_ROOT } from '../../src/config.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { fakeRunnerFactory } from '../../src/jobs/fake-runner.js';
import { makeDemoPdf } from '../../src/jobs/pdf.js';
import { PROVIDERS } from '../../src/providers/index.js';
import { createApp } from '../../src/server/app.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig } from '../helpers.js';
import { testBrowserChannel } from '../browser-channel.js';

test('portal sin datos precargados; migración conserva archivo importado y elimina muestras', { timeout: 30_000 }, async () => {
  const config = testConfig({ portalDir: path.resolve(AGENT_ROOT, '../portal-pacientes') });
  const manager = new JobManager({ config, providers: PROVIDERS, log: silentLogger, runnerFactory: fakeRunnerFactory() });
  const server = createApp({ config, manager, providers: PROVIDERS, info: { runner: 'fake', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, ...(testBrowserChannel ? { channel: testBrowserChannel } : {}) });
  const pdf = makeDemoPdf(['QA sintético: archivo importado que debe conservarse']);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(`localStorage.setItem('pp_agent_url', ${JSON.stringify(base)});`);
    await page.goto(base + '/#/login'); await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
    assert.match(await page.locator('h1').innerText(), /Bienvenido/);
    const fresh = await page.evaluate(() => (window as any).P.db);
    for (const collection of ['studies', 'documents', 'allergies', 'conditions', 'meds', 'vaccines', 'authorizations', 'shares', 'activity', 'sessions']) assert.deepEqual(fresh[collection], []);
    if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, 'portal-empty.png'), fullPage: true });
    for (const view of ['estudios', 'documentos', 'historial', 'perfil', 'perfil/seguridad', 'perfil/privacidad', 'salud', 'salud/alergias', 'ayuda']) {
      await page.goto(base + '/#/' + view); await page.waitForSelector('h1');
      assert.doesNotMatch(await page.locator('main').innerText(), /María|González|Penicilina|Losartán|Safari en iPhone|Restablecer datos|0800 000|portal\.ejemplo/);
    }
    const legacy = await page.evaluate(async ({ bytes, hash }) => {
      const P = (window as any).P;
      await P.files.put('qa-original', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const imported = { id: 'pc-qa-imported', name: 'Archivo importado QA', type: 'laboratorio', inst: 'pc', provider: 'percamb', date: '2026-01-01', importedAt: '2026-10-14T10:00:00Z', origin: 'agente', status: 'disponible', file: { key: 'qa-original', bytes: bytes.length, sha256: hash, kind: 'PDF', mimeType: 'application/pdf' } };
      const old = { ...P.db, version: 1, textSize: 'grande', studies: [{ id: 'hemograma-2026', name: 'Ejemplo antiguo', inst: 'lc' }, imported],
        allergies: [{ name: 'Penicilina' }], conditions: [{ name: 'Ejemplo antiguo' }], meds: [{ name: 'Losartán' }], vaccines: [{ name: 'Ejemplo antiguo' }],
        contact: { email: 'mock@ejemplo.com', phone: '5555' }, documents: [{ title: 'Receta de ejemplo' }],
        authorizations: [{ inst: 'hc' }], shares: [{ studyId: 'hemograma-2026' }], sessions: [{ device: 'Safari en iPhone' }], activity: [{ text: 'Actividad precargada' }] };
      localStorage.setItem(P.STORE_KEY, JSON.stringify(old)); return old;
    }, { bytes: [...pdf], hash: sha256 });
    async function verify() {
      await page.goto(base + '/#/inicio'); await page.reload(); await page.waitForSelector('.home-head');
      const migrated = await page.evaluate(() => (window as any).P.db);
      assert.equal(migrated.version, 2); assert.equal(migrated.textSize, 'grande'); assert.equal(migrated.studies.length, 1);
      assert.equal(migrated.studies[0].file.key, 'qa-original'); assert.equal(migrated.studies[0].file.sha256, sha256);
      for (const collection of ['documents', 'allergies', 'conditions', 'meds', 'vaccines', 'authorizations', 'shares', 'sessions']) assert.deepEqual(migrated[collection], []);
      await page.goto(base + '/#/estudios/pc-qa-imported'); await page.waitForSelector('.detail-head');
      const download = page.waitForEvent('download'); await page.click('.detail-actions [data-action=doc-download]');
      assert.deepEqual(await readFile((await (await download).path())!), pdf);
    }
    await verify();
    // Si localStorage no puede escribir la migración, no perder la metadata ni el Blob en memoria.
    await page.evaluate(old => localStorage.setItem('portal_pacientes_v1', JSON.stringify(old)), legacy);
    await page.addInitScript("const originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'portal_pacientes_v1') throw new DOMException('QA quota', 'QuotaExceededError'); return originalSet.call(this, key, value); };");
    await verify(); assert.deepEqual(errors, []);
  } finally { await browser.close(); await manager.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
