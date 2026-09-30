import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { BrowserSession, StudyReferenceMismatchError } from '../../src/browser/session.js';
import { ProviderParserMismatchError } from '../../src/browser/types.js';
import { validateHumanActionEvidence } from '../../src/agent/tools/validate.js';
import { testBrowserChannel } from '../browser-channel.js';
import { FAKE_USER, startFakePortal } from '../fixtures/fake-portal.js';
import { testConfig, testProvider } from '../helpers.js';

let portal: Awaited<ReturnType<typeof startFakePortal>>;
let host: BrowserHost;
const sessions: BrowserSession[] = [];

before(async () => {
  portal = await startFakePortal();
  host = new BrowserHost({ headless: true, channel: testBrowserChannel, debugArtifacts: false, debugDir: path.join(tmpdir(), 'pp-percamb-debug') });
});

after(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  await host.close();
  await portal.close();
});

async function openResults(pathname: string) {
  const cfg = testConfig({ providerDebugStructure: true });
  const session = await BrowserSession.open(host, testProvider(portal.url + '/lwcloud/fake/login'), true, cfg.maxPdfBytes, cfg.providerDebugStructure);
  sessions.push(session);
  await session.gotoLogin();
  const page = session.activePage();
  await page.fill('input[name=usuario]', FAKE_USER.usuario);
  await page.fill('input[name=pass]', FAKE_USER.pass);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/resultados(?:$|\?)/);
  await session.navigate(portal.url + pathname);
  return session;
}

test('extrae metadata administrativa de filas DIV sin leer contenido clínico y abre el ID elegido', { timeout: 60_000 }, async () => {
  const session = await openResults('/lwcloud/fake/resultados-div?count=2');
  const listUrl = session.currentUrl();
  const traces: string[] = [];
  session.onProviderStructure = ({ event, count }) => { if (count !== undefined) traces.push(`${event}:${count}`); };
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 2);
  assert.deepEqual(result.studies.map((study) => study.date), ['2026-05-28', '2026-01-14']);
  assert.deepEqual(result.studies.map((study) => study.protocol), ['2001', '2002']);
  assert.deepEqual(result.studies.map((study) => study.deliveryDate), ['2026-05-30', '2026-01-16']);
  assert.deepEqual(result.studies.map((study) => study.status), ['Finalizado', 'Finalizado']);
  assert.ok(result.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')), 'cada estudio publicable tiene una clave de origen irreversible');
  assert.equal(session.currentUrl(), listUrl, 'la detección no navega ni hace clic en los ojos');
  assert.equal(await session.activePage().evaluate(() => (window as any).__studyOpens || 0), 0);
  const publicData = JSON.stringify(result);
  for (const privateValue of ['PEREZ', FAKE_USER.usuario, 'Dra. Ejemplo', 'Hemoglobina', '13,5', '1980', 'href']) {
    assert.ok(!publicData.includes(privateValue), `metadata pública filtró ${privateValue}`);
  }
  assert.deepEqual(traces, [
    'percamb_result_links:0',
    'percamb_result_actions:2',
    'percamb_candidate_rows:2',
    'percamb_metadata_complete:2',
    'percamb_parsed_studies:2',
  ]);

  assert.equal(await session.openStudy(result.studies[1].id), true);
  assert.match(session.currentUrl(), /\/lwcloud\/fake\/protocolo\/2002$/);
  assert.equal(await session.activePage().evaluate(() => sessionStorage.getItem('studyOpens')), '1');
});

test('prioriza links ver_resultado y conserva estudios aunque falte metadata', { timeout: 60_000 }, async () => {
  const session = await openResults('/lwcloud/fake/resultados-links?count=2');
  const listUrl = session.currentUrl();
  const traces: string[] = [];
  session.onProviderStructure = ({ event, count }) => { if (count !== undefined) traces.push(`${event}:${count}`); };
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 2);
  assert.equal(result.studies[0].date, '2026-05-28');
  assert.equal(result.studies[1].date, undefined, 'el segundo link se conserva como estudio mínimo');
  assert.equal(result.studies[0].protocol, undefined);
  assert.equal(result.studies[1].protocol, undefined);
  assert.equal(result.studies[1].deliveryDate, undefined);
  assert.equal(result.studies[1].status, undefined);
  assert.ok(result.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')), 'los href estables generan clave aunque falte metadata');
  assert.deepEqual(traces, [
    'percamb_result_links:2', 'percamb_result_actions:2', 'percamb_candidate_rows:2',
    'percamb_metadata_complete:0', 'percamb_parsed_studies:2',
  ]);
  traces.length = 0;
  const repeated = await session.listStudies();
  assert.deepEqual(repeated?.studies.map((study) => study.sourceKey), result.studies.map((study) => study.sourceKey), 'la clave no depende del UUID temporal del job');
  assert.equal(session.currentUrl(), listUrl);
  assert.equal(await session.openStudy(result.studies[1].id), true);
  assert.match(session.currentUrl(), /\/lwcloud\/fake\/ver_resultado\/4002$/);
  assert.ok(!JSON.stringify(result).includes('ver_resultado'), 'el href interno no se publica');
});

test('rechaza abrir un detalle cuyo protocolo contradice al de la fila original', { timeout: 60_000 }, async () => {
  const session = await openResults('/lwcloud/fake/resultados-reference-mismatch');
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies[0].protocol, '9991');
  let mismatch: unknown;
  try { await session.openStudy(result.studies[0].id); } catch (error) { mismatch = error; }
  assert.match(session.currentUrl(), /\/lwcloud\/fake\/protocolo\/9992$/);
  assert.deepEqual(await session.activePage().locator('dt,dd').allTextContents(), ['Fecha', '28/05/2026', 'Protocolo', '9992']);
  assert.ok(mismatch instanceof StudyReferenceMismatchError && mismatch.code === 'STUDY_REFERENCE_MISMATCH', 'no validó el detalle: ' + String(mismatch));
  assert.equal(session.isStudyOpen(result.studies[0].id), false, 'no habilita la descarga luego del mismatch');
});

test('detecta uno o ningún link ver_resultado sin depender del icono', { timeout: 60_000 }, async () => {
  const one = await openResults('/lwcloud/fake/resultados-links?count=1');
  assert.equal((await one.listStudies())?.studies.length, 1);
  const none = await openResults('/lwcloud/fake/resultados-links?count=0');
  assert.equal((await none.listStudies())?.studies.length, 0);
});

test('devuelve una fila o lista vacía solo cuando no hay ojos', { timeout: 60_000 }, async () => {
  const one = await openResults('/lwcloud/fake/resultados-div?count=1');
  assert.equal((await one.listStudies())?.studies.length, 1);

  const empty = await openResults('/lwcloud/fake/resultados-div?count=0');
  const result = await empty.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 0);
});

test('dos acciones visibles sin filas parseables devuelven mismatch en vez de lista vacía', { timeout: 60_000 }, async () => {
  const session = await openResults('/lwcloud/fake/resultados-mismatch');
  const url = session.currentUrl();
  await assert.rejects(session.listStudies(), (error: unknown) => {
    assert.ok(error instanceof ProviderParserMismatchError);
    assert.equal(error.resultActions, 2);
    assert.equal(error.candidateRows, 2);
    return true;
  });
  assert.equal(session.currentUrl(), url);
  assert.equal(await session.activePage().evaluate(() => (window as any).__studyOpens || 0), 0);
});

test('no confunde resultados con OTP, pero reconoce un campo de verificación visible', { timeout: 60_000 }, async () => {
  const results = await openResults('/lwcloud/fake/resultados-div?count=1');
  const resultsSnapshot = await results.snapshot(['RESULTADOS ONLINE']);
  assert.equal(resultsSnapshot.otp, false);
  assert.equal(validateHumanActionEvidence('mfa', resultsSnapshot), false);

  const challenge = await openResults('/lwcloud/fake/otp');
  const challengeSnapshot = await challenge.snapshot([]);
  assert.equal(challengeSnapshot.otp, true);
  assert.equal(validateHumanActionEvidence('mfa', challengeSnapshot), true);
});
