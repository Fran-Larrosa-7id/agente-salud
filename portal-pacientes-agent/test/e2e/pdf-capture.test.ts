import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { BrowserSession, PdfDownloadError, UnexpectedDomainError } from '../../src/browser/session.js';
import { validatePdf } from '../../src/jobs/pdf.js';
import { testBrowserChannel } from '../browser-channel.js';
import { FAKE_USER, startFakePortal } from '../fixtures/fake-portal.js';
import { testConfig, testProvider } from '../helpers.js';

let portal: Awaited<ReturnType<typeof startFakePortal>>;
let host: BrowserHost;
let session: BrowserSession | null = null;

before(async () => {
  portal = await startFakePortal();
  host = new BrowserHost({ headless: true, channel: testBrowserChannel, debugArtifacts: false, debugDir: path.join(tmpdir(), 'pp-pdf-debug') });
});

after(async () => {
  await session?.close();
  await host?.close();
  await portal?.close();
});

async function loginAndExtract(pdfDownloadTimeoutMs?: number) {
  await session?.close();
  const cfg = testConfig(pdfDownloadTimeoutMs ? { pdfDownloadTimeoutMs } : {});
  const current = await BrowserSession.open(host, testProvider(portal.url + '/lwcloud/fake/login'), true, cfg.maxPdfBytes, cfg.providerDebugStructure, cfg.pdfDownloadTimeoutMs);
  session = current;
  await current.gotoLogin();
  const page = current.activePage();
  await page.fill('input[name=usuario]', FAKE_USER.usuario);
  await page.fill('input[name=pass]', FAKE_USER.pass);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/resultados(?:\?|$)/);
  await current.navigate(portal.url + '/lwcloud/fake/resultados?extended=1');
  const result = await current.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 13, 'incluye todas las filas visibles del fixture extendido');
  assert.ok(result.studies.every((s) => !!s.protocol));
  assert.ok(!JSON.stringify(result).includes('PEREZ'));
  assert.ok(!JSON.stringify(result).includes(FAKE_USER.usuario));
  return result.studies;
}

async function importStudy(studyId: string) {
  const current = session;
  assert.ok(current);
  const pdfTrace: string[] = [];
  current.onPdfTrace = (info) => pdfTrace.push([info.stage, info.scheme ?? '', info.host ?? '', info.count ?? '', info.strategy ?? '', info.hrefPresent ?? '', info.sameOrigin ?? '', info.errorCode ?? ''].join(':'));
  assert.equal(await current.openStudy(studyId), true);
  current.activePage().on('pageerror', (error) => pdfTrace.push('pageerror:' + error.name + ':' + error.message.slice(0, 90)));
  let pdf;
  try {
    pdf = await current.downloadCurrentStudyPdf();
  } catch (error) {
    throw new Error(`${String(error)}; etapas=${pdfTrace.join(',')}`);
  }
  assert.ok(pdf, `no se capturó el estudio; etapas=${pdfTrace.join(',')}`);
  assert.ok(validatePdf(pdf.buffer, pdf.contentType).ok);
  await current.closeExtraPages();
  return { pdf, pdfTrace };
}

test('el extractor lista todas las filas y captura PDF tras about:blank y data PDF', { timeout: 90_000 }, async () => {
  const studies = await loginAndExtract();
  const byDate = new Map(studies.map((s) => [s.date, s.id]));
  await importStudy(byDate.get('2025-05-01')!); // about:blank transitorio → PDF del proveedor
  await importStudy(byDate.get('2025-04-01')!); // data:application/pdf solo durante la acción explícita
});

test('prioriza context.request para href directo y redirect interno; fallback captura popup y data PDF', { timeout: 90_000 }, async () => {
  const studies = await loginAndExtract(3_000);
  const byDate = new Map(studies.map((s) => [s.date, s.id]));

  const direct = await importStudy(byDate.get('2026-05-28')!);
  assert.equal(direct.pdf.via, 'fetch');
  assert.ok(direct.pdfTrace.some((line) => line.includes('context_request')));

  const redirect = await importStudy(byDate.get('2025-06-01')!);
  assert.equal(redirect.pdf.via, 'fetch');
  assert.ok(redirect.pdfTrace.some((line) => line.includes('context_request')));

  const mismatchedMime = await importStudy(byDate.get('2025-10-01')!);
  assert.equal(mismatchedMime.pdf.contentType, 'text/html');
  assert.ok(mismatchedMime.pdfTrace.some((line) => line.includes('percamb_pdf_mime_warning')));

  const popup = await importStudy(byDate.get('2025-05-01')!);
  assert.ok(popup.pdfTrace.some((line) => line.includes('popup_response')));
  const download = await importStudy(byDate.get('2025-11-01')!);
  assert.equal(download.pdf.via, 'download');
  assert.ok(download.pdfTrace.some((line) => line.includes('download_event')));
  const data = await importStudy(byDate.get('2025-04-01')!);
  assert.equal(data.pdf.via, 'fetch');
});

test('el orden invertido conserva la asociación opaca entre estudio y PDF', { timeout: 60_000 }, async () => {
  const studies = await loginAndExtract();
  const selectedInReverse = [
    studies.find((study) => study.protocol === '1002')!,
    studies.find((study) => study.protocol === '1001')!,
  ];
  const associations: { studyId: string; protocolFromFixturePdf: string }[] = [];
  for (const study of selectedInReverse) {
    assert.equal(await session!.openStudy(study.id), true);
    const pdf = await session!.downloadCurrentStudyPdf();
    assert.ok(pdf);
    const source = pdf.buffer.toString('latin1');
    associations.push({
      studyId: study.id,
      protocolFromFixturePdf: ['1001', '1002'].find((protocol) => source.includes(`Protocolo ${protocol}`)) || '',
    });
    await session!.closeExtraPages();
  }
  assert.deepEqual(associations.map((association) => association.protocolFromFixturePdf), ['1002', '1001']);
  assert.deepEqual(associations.map((association) => association.studyId), selectedInReverse.map((study) => study.id));
});

test('rechaza redirect externo, HTML anunciado como PDF y reporta un timeout específico', { timeout: 90_000 }, async () => {
  const studies = await loginAndExtract(900);
  const byDate = new Map(studies.map((s) => [s.date, s.id]));
  const current = session;
  assert.ok(current);

  await current.openStudy(byDate.get('2025-08-01')!);
  await assert.rejects(current.downloadCurrentStudyPdf(), (error: unknown) => error instanceof UnexpectedDomainError);

  await current.openStudy(byDate.get('2025-02-01')!);
  await assert.rejects(current.downloadCurrentStudyPdf(), (error: unknown) => error instanceof PdfDownloadError && error.code === 'INVALID_DOCUMENT');

  await current.openStudy(byDate.get('2025-07-01')!);
  await assert.rejects(current.downloadCurrentStudyPdf(), (error: unknown) => error instanceof PdfDownloadError && error.code === 'PDF_DOWNLOAD_TIMEOUT');

  await current.openStudy(byDate.get('2025-09-01')!);
  await assert.rejects(current.downloadCurrentStudyPdf(), (error: unknown) => error instanceof PdfDownloadError && error.code === 'PDF_NOT_FOUND');
});

test('un host externo real se bloquea y un archivo con MIME PDF pero bytes HTML no se acepta', { timeout: 45_000 }, async () => {
  const studies = await loginAndExtract();
  const current = session;
  assert.ok(current);
  let unexpected = false;
  current.onUnexpectedDomain = () => { unexpected = true; };

  const externalId = studies.find((s) => s.date === '2025-03-01')!.id;
  assert.equal(await current.openStudy(externalId), true);
  const externalAction = (await current.snapshot([])).elements.find((e) => /pdf/i.test(e.label));
  assert.ok(externalAction);
  await assert.rejects(current.capturePdfDuring(() => current.click(externalAction), 1000), /UNEXPECTED_DOMAIN/);
  assert.equal(unexpected, true, 'el host externo no se confunde con blob/about:blank');

  unexpected = false;
  const invalidId = studies.find((s) => s.date === '2025-02-01')!.id;
  assert.equal(await current.openStudy(invalidId), true);
  const invalidAction = (await current.snapshot([])).elements.find((e) => /pdf/i.test(e.label));
  assert.ok(invalidAction);
  const invalidPdf = await current.capturePdfDuring(() => current.click(invalidAction), 1000);
  assert.equal(invalidPdf, null, 'contenido no-PDF rechazado aunque Content-Type declare application/pdf');
});
