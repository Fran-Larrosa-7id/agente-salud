import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { chromium } from 'playwright';
import { makeDemoArchive } from '../src/jobs/demo-archive.js';

// Proxy local estable: mismo origen seguro localhost aun al reemplazar el backend de QA.
const proxy = createServer((req, res) => {
  const upstream = request({ hostname: 'portal', port: 8787, path: req.url, method: req.method, headers: req.headers }, reply => {
    res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end(); });
  req.pipe(upstream);
});
await new Promise<void>(resolve => proxy.listen(8787, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:8787';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let jobId = '', fileId = '', acknowledged = false;
page.on('response', async response => {
  if (response.url().endsWith('/api/imports/centrodm') && response.status() === 201) jobId = (await response.json()).jobId;
  if (response.url().endsWith('/ack') && response.ok()) {
    const body = response.request().postDataJSON();
    if (body.persisted) { acknowledged = true; fileId = response.url().split('/files/')[1].split('/')[0]; }
  }
});
const expected = makeDemoArchive();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check: () => Promise<boolean>, limit = 120000) {
  const until = Date.now() + limit;
  while (Date.now() < until) { if (await check()) return; await sleep(500); }
  throw new Error('QA timeout');
}
async function online() { try { return (await page.request.get(base + '/health', { timeout: 2000 })).ok(); } catch { return false; } }
try {
  await page.goto(base + '/#/login');
  await page.fill('#dni', '1234'); await page.fill('#pass', '1234'); await page.click('#login-form [type=submit]');
  await page.waitForSelector('.home-head');
  await page.goto(base + '/#/traer?inst=cdm');
  await page.click('[data-action=live-open]'); await page.waitForSelector('.res-list');
  await page.click('.res-list li:first-child .res-row'); await page.click('#res-save');
  try { await page.waitForSelector('.fv-success'); }
  catch (error) {
    console.log('QA diagnóstico sintético', await page.locator('main').innerText(), await page.evaluate(() => ({ secure: isSecureContext, crypto: !!crypto.subtle, state: (window as any).P.flow.live?.state, phases: (window as any).P.flow.live?.phase })), errors);
    throw error;
  }
  assert.ok(acknowledged, 'confirmación positiva tras transacción IndexedDB');
  const study = await page.evaluate(() => (window as any).P.db.studies.find((item: any) => item.provider === 'centrodm'));
  assert.equal(study.file.sha256, hash(expected)); assert.equal(study.file.bytes, expected.length);
  await eventually(async () => (await page.request.get(`${base}/api/imports/${jobId}/files/${fileId}`)).status() === 404);
  assert.equal((await (await page.request.get(`${base}/api/imports/${jobId}`)).json()).state, 'COMPLETED');
  async function verify(label: string) {
    for (const view of ['estudios', 'documentos', 'historial']) {
      await page.goto(`${base}/#/${view}`);
      await page.waitForFunction(() => (window as any).P?.db.studies.some((item: any) => item.provider === 'centrodm'));
      await page.getByText('Reconstrucción 3D', { exact: false }).first().waitFor();
      assert.match(await page.locator('main').innerText(), /Reconstrucción 3D/);
    }
    await page.goto(`${base}/#/estudios/${study.id}`); await page.waitForSelector('.detail-head');
    assert.equal(await page.locator('[data-action=doc-download]').count(), 1, 'un solo CTA de descarga');
    const download = page.waitForEvent('download'); await page.click('.detail-actions [data-action=doc-download]');
    const artifact = await download; const bytes = await readFile((await artifact.path())!);
    assert.equal(bytes.length, expected.length); assert.equal(hash(bytes), hash(expected));
    await writeFile('/tmp/synthetic-qa.zip', bytes);
    execFileSync('python3', ['-c', "import zipfile; z=zipfile.ZipFile('/tmp/synthetic-qa.zip'); assert z.testzip() is None; assert z.read('synthetic.dcm')[128:132]==b'DICM'"]);
    console.log(`${label}: Estudios/Documentos/Historial, ZIP CRC, tamaño y SHA-256 correctos`);
  }
  await verify('Antes de la espera');
  console.log('ACK confirmado; copia temporal eliminada; espera real de 305 segundos');
  const start = Date.now(); await sleep(305000); assert.ok(Date.now() - start > 300000);
  await verify('Después de más de cinco minutos');
  await writeFile('/tmp/ready-for-restart', 'ready');
  await eventually(async () => !(await online())); await writeFile('/tmp/saw-offline', 'offline');
  await eventually(online);
  // Las sesiones del servidor son efímeras; el archivo persiste en el mismo navegador.
  await page.goto(base + '/#/login'); await page.fill('#dni', '1234'); await page.fill('#pass', '1234');
  await page.click('#login-form [type=submit]'); await page.waitForSelector('.home-head');
  await verify('Después de docker compose down/up, mismo navegador y origen');
  // Una sesión privada nueva no comparte los archivos; borrar datos invalida la disponibilidad.
  const privateContext = await browser.newContext();
  const privatePage = await privateContext.newPage(); await privatePage.goto(base + '/#/login');
  assert.equal(await privatePage.evaluate(() => (window as any).P.db.studies.some((item: any) => item.provider === 'centrodm')), false);
  await privateContext.close();
  await page.evaluate(async (key: string) => { await (window as any).P.files.del(key); }, study.file.key);
  await page.click('.detail-actions [data-action=doc-download]');
  await page.waitForSelector('text=No pudimos recuperar un archivo íntegro');
  assert.deepEqual(errors, []);
  console.log('PASS: durabilidad y límites del almacenamiento local verificados');
} finally { await browser.close(); proxy.closeAllConnections(); proxy.close(); }
