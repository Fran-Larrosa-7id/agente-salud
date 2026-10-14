import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { BrowserSession, RdcChacabucoError, UnexpectedDomainError } from '../../src/browser/session.js';
import { makeDemoPdf } from '../../src/jobs/pdf.js';
import { rdcChacabuco } from '../../src/providers/rdcchacabuco/rdcchacabuco.provider.js';
import { rdcChacabucoSourceKey } from '../../src/providers/rdcchacabuco/source-key.js';
import { testBrowserChannel } from '../browser-channel.js';

let server: Server;
let origin = '';
let host: BrowserHost;
const sessions: BrowserSession[] = [];
const pdf = makeDemoPdf(['Documento original de prueba RDC']);
const invalidPdf = Buffer.from('no-es-un-pdf');

function send(res: import('node:http').ServerResponse, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(200, { 'content-type': type, ...headers });
  res.end(body);
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
    if (url.pathname === '/list') {
      const metadataMissing = url.searchParams.get('metadata') === 'missing';
      const partialMetadata = url.searchParams.get('metadata') === 'partial';
      const wrappedLayout = url.searchParams.get('layout') === 'wrapped';
      const fallbackLayout = url.searchParams.get('layout') === 'selector-fallback';
      const globalFallbackLayout = url.searchParams.get('layout') === 'global-fallback';
      const studyRows = metadataMissing
        ? `<tr><td></td><td></td><td></td><td><button type="button" data-mode="${url.searchParams.get('mode') || 'iframe'}"><i class="fa fa-file icon-size" aria-hidden="true"></i></button></td></tr>
          <tr><td></td><td></td><td></td><td><button type="button" data-mode="${url.searchParams.get('mode2') || 'embed'}"><span><i class="fa fa-file icon-size" aria-hidden="true"></i></span></button></td></tr>`
        : partialMetadata
          ? `<tr data-study-id="rdc-private-id-1"><td>ULTRASONIDO</td><td>ECOGRAFIA TIROIDES</td><td>15/01/2026</td><td><a href="#" data-study-id="rdc-private-id-1" data-mode="${url.searchParams.get('mode') || 'iframe'}"><i class="fa fa-file icon-size" aria-hidden="true"></i></a></td></tr>
          <tr><td></td><td></td><td></td><td><button type="button" data-mode="${url.searchParams.get('mode2') || 'embed'}"><span><i class="fa fa-file icon-size" aria-hidden="true"></i></span></button></td></tr>`
        : `<tr data-study-id="rdc-private-id-1"><td>ULTRASONIDO</td><td>ECOGRAFIA TIROIDES</td><td>15/01/2026</td><td><a href="#" data-study-id="rdc-private-id-1" data-mode="${url.searchParams.get('mode') || 'iframe'}"><i class="fa fa-file icon-size" aria-hidden="true"></i></a></td></tr>
          <tr data-study-id="rdc-private-id-2"><td>RADIOGRAFÍA COMPUTADA</td><td>RX TORAX FTE</td><td>14/05/2025</td><td><button type="button" data-study-id="rdc-private-id-2" data-mode="${url.searchParams.get('mode2') || 'iframe'}"><span><i class="fa fa-file icon-size" aria-hidden="true"></i></span></button></td></tr>`;
      const resultMarkup = wrappedLayout
        ? `<div class="study-row" data-study-id="rdc-private-id-wrapped" data-mode="iframe"><div>ULTRASONIDO</div><div>ECOGRAFIA TIROIDES</div><div>15/01/2026</div><div class="actions"><span class="some-wrapper"><i class="fa fa-file icon-size" aria-hidden="true"></i></span><i class="fa fa-envelope"></i><i class="fa fa-whatsapp"></i><i class="fa fa-link"></i></div></div>`
        : fallbackLayout
          ? `<div class="study-row" data-study-id="rdc-private-id-fallback-1" data-mode="iframe"><div>ULTRASONIDO</div><div>ECOGRAFIA TIROIDES</div><div>15/01/2026</div><div class="actions"><span class="some-wrapper"><i class="fa-file" aria-hidden="true"></i></span></div></div>
          <div class="study-row" data-study-id="rdc-private-id-fallback-2" data-mode="embed"><div>RADIOGRAFÍA COMPUTADA</div><div>RX TORAX FTE</div><div>14/05/2025</div><div class="actions"><span class="some-wrapper"><span class="fa-file icon-size" aria-hidden="true"></span></span></div></div>`
          : globalFallbackLayout
            ? `<div class="study-row" data-study-id="rdc-private-id-global-fallback" data-mode="iframe"><div>ULTRASONIDO</div><div>ECOGRAFIA TIROIDES</div><div>15/01/2026</div><div class="actions"><span class="some-wrapper"><span class="fa-file" aria-hidden="true"></span></span></div></div>`
          : `<table><thead><tr><th>Tipo de Estudio</th><th>Descripción</th><th>Fecha del Estudio</th><th>Acciones</th></tr></thead><tbody>${studyRows}</tbody></table>`;
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><head><style>.fa-file{display:inline-block;width:18px;height:18px}</style></head><body>
        <h1>Mis estudios disponibles</h1>
        ${resultMarkup}
        <div id="modal-root"></div>
        <script>
          for (const action of document.querySelectorAll('[data-mode]')) action.addEventListener('click', (event) => {
            event.preventDefault();
            const id = action.getAttribute('data-study-id');
            const mode = action.getAttribute('data-mode');
            if (mode === 'response-only') { void fetch('/study.pdf?id=' + id); return; }
            if (mode === 'response-invalid-only') { void fetch('/invalid.pdf'); return; }
            if (mode === 'response-range') { void fetch('/range.pdf'); return; }
            if (mode === 'response-range-offset') { void fetch('/range.pdf', { headers: { Range: 'bytes=192-287' } }); return; }
            if (mode === 'response-html-then-valid') { void fetch('/fake.pdf'); setTimeout(() => { void fetch('/study.pdf?id=' + id); }, 50); return; }
            if (mode === 'response-html-nested') {
              void fetch('/fake.pdf');
              const root = document.querySelector('#modal-root');
              root.innerHTML = '<section class="modal show" role="dialog" aria-modal="true"><div class="modal-body"><iframe title="Documento" src="/wrapper.html?id=' + id + '"></iframe></div></section>';
              return;
            }
            if (mode === 'no-document') return;
            const root = document.querySelector('#modal-root');
            root.innerHTML = '<section id="rdc-modal" data-study-id="' + id + '" class="modal show" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Cerrar">×</button><div class="modal-body"></div></section>';
            document.querySelector('.close').addEventListener('click', () => { root.innerHTML = ''; });
            const body = document.querySelector('.modal-body');
            if (mode === 'modal-no-source') {
              body.innerHTML = '<div class="viewer-placeholder"></div>';
            } else if (mode === 'blob') {
              const bytes = Uint8Array.from(atob(${JSON.stringify(pdf.toString('base64'))}), c => c.charCodeAt(0));
              const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
              body.innerHTML = '<iframe title="Documento original"></iframe>';
              body.querySelector('iframe').src = objectUrl;
            } else if (mode === 'data') {
              body.innerHTML = '<iframe title="Documento original" src="data:application/pdf;base64,${pdf.toString('base64')}"></iframe>';
            } else if (mode === 'embed-browser') {
              body.innerHTML = '<embed type="application/pdf" src="/document?id=' + id + '">';
            } else if (mode === 'embed-wrapper-nested') {
              body.innerHTML = '<embed type="application/pdf" src="/masked-wrapper?id=' + id + '">';
            } else if (mode === 'multiple-browser-candidates') {
              body.innerHTML = '<embed type="application/pdf" src="/fake.pdf?candidate=first"><embed type="application/pdf" src="/document?id=' + id + '">';
            } else if (mode === 'browser-fetch-timeout') {
              body.innerHTML = '<embed type="application/pdf" src="/slow-document?id=' + id + '">';
            } else if (mode === 'embed' || mode === 'object') {
              body.innerHTML = mode === 'embed' ? '<embed type="application/pdf" src="/study.pdf?id=' + id + '">' : '<object type="application/pdf" data="/study.pdf?id=' + id + '"></object>';
            } else if (mode === 'nested') {
              body.innerHTML = '<iframe title="Visor" src="/wrapper.html?id=' + id + '"></iframe>';
            } else if (mode === 'invalid') {
              body.innerHTML = '<iframe src="/invalid.pdf"></iframe>';
            } else if (mode === 'external') {
              body.innerHTML = '<iframe src="https://outside.invalid/private.pdf"></iframe>';
            } else if (mode === 'download') {
              const link = document.createElement('a'); link.href = '/download.pdf'; link.download = 'original.pdf'; link.click();
            } else {
              body.innerHTML = '<iframe title="Documento original" src="/study.pdf?id=' + id + '"></iframe>';
            }
          });
        </script>
      </body></html>`);
    }
    if (url.pathname === '/study.pdf' || url.pathname === '/download.pdf') {
      return void send(res, 'application/pdf', pdf, url.pathname === '/download.pdf' ? { 'content-disposition': 'attachment; filename="original.pdf"' } : {});
    }
    if (url.pathname === '/range.pdf') {
      const rangeHeader = req.headers.range || '';
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      const start = match ? Number(match[1]) : 0;
      const requestedEnd = match ? Number(match[2]) : 95;
      const end = Math.min(pdf.length - 1, requestedEnd, start + 95);
      if (start < 0 || start >= pdf.length || end < start) {
        res.writeHead(416, { 'content-range': `bytes */${pdf.length}` });
        return void res.end();
      }
      const bytes = pdf.subarray(start, end + 1);
      res.writeHead(206, {
        'content-type': 'application/pdf',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${pdf.length}`,
        'content-length': String(bytes.length),
      });
      return void res.end(bytes);
    }
    if (url.pathname === '/invalid.pdf') return void send(res, 'application/pdf', invalidPdf);
    if (url.pathname === '/fake.pdf') return void send(res, 'application/pdf', '<!doctype html><title>viewer shell</title>');
    if (url.pathname === '/masked-wrapper') return void send(res, 'application/pdf', `<!doctype html><iframe title="Documento interno" src="/embed-page?id=${url.searchParams.get('id') || ''}"></iframe>`);
    if (url.pathname === '/embed-page') return void send(res, 'text/html; charset=utf-8', `<!doctype html><embed type="application/pdf" src="/document?id=${url.searchParams.get('id') || ''}">`);
    if (url.pathname === '/slow-document') {
      setTimeout(() => { if (!res.destroyed) send(res, 'application/octet-stream', pdf); }, 3_000);
      return;
    }
    if (url.pathname === '/wrapper.html') return void send(res, 'text/html; charset=utf-8', `<!doctype html><iframe title="Documento interno" src="/inner.html?id=${url.searchParams.get('id') || ''}"></iframe>`);
    if (url.pathname === '/inner.html') return void send(res, 'text/html; charset=utf-8', `<!doctype html><iframe title="PDF real" src="/document?id=${url.searchParams.get('id') || ''}"></iframe>`);
    if (url.pathname === '/document') return void send(res, 'text/plain; charset=utf-8', pdf);
    send(res, 'text/plain; charset=utf-8', 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('FIXTURE_SERVER_FAILED');
  origin = `http://127.0.0.1:${address.port}`;
  host = new BrowserHost({ headless: true, channel: testBrowserChannel, debugArtifacts: false, debugDir: '' });
});

after(async () => {
  await Promise.all(sessions.map((session) => session.close().catch(() => {})));
  await host.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function openSession(query = '') {
  const provider = {
    ...rdcChacabuco,
    loginUrl: `${origin}/list${query}`,
    allowedHosts: ['127.0.0.1'],
    requireHttps: false,
    loginPathPattern: /\/never-login$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true, 2_000);
  sessions.push(session);
  await session.gotoLogin();
  return session;
}

test('RDC descubre iconos fa-file y mapea metadata aunque el icono no sea un ancestor interactivo', { timeout: 60_000 }, async () => {
  const session = await openSession();
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 2);
  assert.deepEqual(result.studies.map(({ studyType, title, studyDate }) => ({ studyType, title, studyDate })), [
    { studyType: 'ULTRASONIDO', title: 'ECOGRAFIA TIROIDES', studyDate: '2026-01-15' },
    { studyType: 'RADIOGRAFÍA COMPUTADA', title: 'RX TORAX FTE', studyDate: '2025-05-14' },
  ]);
  assert.ok(result.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')));
  assert.ok(result.studies.every((study) => !JSON.stringify(study).includes('rdc-private-id')));
  const references = (session as unknown as { rdcChacabucoStudies: Map<string, { iconToken: string }> }).rdcChacabucoStudies;
  assert.equal(references.size, 2);
  assert.ok([...references.values()].every((ref) => ref.iconToken));
  const structure = diagnostics as { event: string; count?: number; index?: number; studyCreated?: boolean; refCreated?: boolean; metadataEnriched?: boolean }[];
  assert.equal(structure.find((item) => item.event === 'rdc_result_actions')?.count, 2);
  assert.equal(structure.find((item) => item.event === 'rdc_candidate_rows')?.count, 2);
  assert.equal(structure.find((item) => item.event === 'rdc_parsed_studies')?.count, 2);
  assert.deepEqual(structure.filter((item) => item.event === 'rdc_action_build').map(({ index, studyCreated, refCreated, metadataEnriched }) => ({ index, studyCreated, refCreated, metadataEnriched })), [
    { index: 0, studyCreated: true, refCreated: true, metadataEnriched: true },
    { index: 1, studyCreated: true, refCreated: true, metadataEnriched: true },
  ]);
  assert.deepEqual(structure.filter((item) => item.event === 'rdc_study_build').map(({ studyCreated, refCreated }) => ({ studyCreated, refCreated })), [
    { studyCreated: true, refCreated: true },
    { studyCreated: true, refCreated: true },
  ]);
  assert.equal(structure.find((item) => item.event === 'rdc_provider_refs')?.count, 2);
  const safeDiagnostics = JSON.stringify(diagnostics);
  assert.ok(!safeDiagnostics.includes('ECOGRAFIA'));
  assert.ok(!safeDiagnostics.includes('rdc-private-id'));
  assert.ok(!safeDiagnostics.includes('/study.pdf'));
});

test('RDC descubre un fa-file dentro de wrappers sin onclick/role y lo abre al seleccionar el estudio', { timeout: 60_000 }, async () => {
  const session = await openSession('?layout=wrapped');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 1);
  assert.deepEqual({ title: result.studies[0].title, studyType: result.studies[0].studyType, studyDate: result.studies[0].studyDate }, {
    title: 'ECOGRAFIA TIROIDES', studyType: 'ULTRASONIDO', studyDate: '2026-01-15',
  });
  const events = diagnostics as { event: string; count?: number; selector?: string }[];
  assert.equal(events.find((item) => item.event === 'rdc_file_icons')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_file_icons_fallback')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_result_actions')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_parsed_studies')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_provider_refs')?.count, 1);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  assert.equal(await session.activePage().locator('#rdc-modal').getAttribute('data-study-id'), 'rdc-private-id-wrapped');
  await session.closeRdcChacabucoModal();
});

test('RDC usa los selectores fallback i.fa-file y .fa-file.icon-size cuando falla el selector principal', { timeout: 60_000 }, async () => {
  const session = await openSession('?layout=selector-fallback');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 2);
  const events = diagnostics as { event: string; count?: number; selector?: string }[];
  assert.equal(events.find((item) => item.event === 'rdc_file_icons')?.count, 0);
  assert.equal(events.find((item) => item.event === 'rdc_file_icons_fallback')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_file_icons_class_fallback')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_result_actions')?.count, 2);
  assert.equal(events.find((item) => item.event === 'rdc_provider_refs')?.count, 2);
  assert.equal(await session.openStudy(result.studies[1].id), true);
  assert.equal(await session.activePage().locator('#rdc-modal embed').count(), 1);
  assert.equal(await session.activePage().locator('#rdc-modal').getAttribute('data-study-id'), 'rdc-private-id-fallback-2');
  await session.closeRdcChacabucoModal();
});

test('RDC inspecciona .fa-file y conserva el estudio cuando fallan los selectores específicos', { timeout: 60_000 }, async () => {
  const session = await openSession('?layout=global-fallback');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 1);
  const events = diagnostics as { event: string; count?: number; selector?: string }[];
  assert.equal(events.find((item) => item.event === 'rdc_file_icons')?.count, 0);
  assert.equal(events.find((item) => item.event === 'rdc_file_icons_fallback')?.count, 0);
  assert.equal(events.find((item) => item.event === 'rdc_file_icons_global')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_result_actions')?.count, 1);
  assert.equal(events.find((item) => item.event === 'rdc_provider_refs')?.count, 1);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  assert.equal(await session.activePage().locator('#rdc-modal').getAttribute('data-study-id'), 'rdc-private-id-global-fallback');
  await session.closeRdcChacabucoModal();
});

test('RDC conserva dos estudios y referencias mínimas cuando falta toda la metadata y no hay href ni data-id', { timeout: 60_000 }, async () => {
  const session = await openSession('?metadata=missing&mode2=embed');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 2);
  assert.deepEqual(result.studies.map(({ title, studyType, studyDate }) => ({ title, studyType, studyDate })), [
    { title: 'Estudio disponible', studyType: 'Imágenes', studyDate: undefined },
    { title: 'Estudio disponible', studyType: 'Imágenes', studyDate: undefined },
  ]);
  assert.ok(result.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')));
  assert.notEqual(result.studies[0].sourceKey, result.studies[1].sourceKey, 'rowIndex distingue acciones sin metadata');

  const references = (session as unknown as { rdcChacabucoStudies: Map<string, { studyId: string; actionIndex: number; rowIndex: number; iconToken: string }> }).rdcChacabucoStudies;
  assert.equal(references.size, 2);
  assert.deepEqual(result.studies.map((study) => {
    const ref = references.get(study.id);
    return ref && { studyId: ref.studyId, actionIndex: ref.actionIndex, rowIndex: ref.rowIndex, hasIconToken: !!ref.iconToken };
  }), [
    { studyId: result.studies[0].id, actionIndex: 0, rowIndex: 0, hasIconToken: true },
    { studyId: result.studies[1].id, actionIndex: 1, rowIndex: 1, hasIconToken: true },
  ]);

  assert.equal(await session.openStudy(result.studies[1].id), true);
  assert.equal(await session.activePage().locator('#rdc-modal embed').count(), 1, 'el índice 1 abre la segunda action');
  const safeDiagnostics = JSON.stringify(diagnostics);
  assert.ok(!safeDiagnostics.includes('rdc-private-id'));
  assert.ok(!safeDiagnostics.includes('data-mode'));
  await session.closeRdcChacabucoModal();
});

test('RDC conserva la acción cuya fila no tiene metadata y enriquece por índice cuando ambos conteos coinciden', { timeout: 60_000 }, async () => {
  const session = await openSession('?metadata=partial');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result?.recognized);
  assert.equal(result.studies.length, 2);
  assert.deepEqual(result.studies.map(({ title, studyType, studyDate }) => ({ title, studyType, studyDate })), [
    { title: 'ECOGRAFIA TIROIDES', studyType: 'ULTRASONIDO', studyDate: '2026-01-15' },
    { title: 'Estudio disponible', studyType: 'Imágenes', studyDate: undefined },
  ]);
  const actionBuilds = (diagnostics as { event: string; index?: number; metadataEnriched?: boolean }[]).filter((item) => item.event === 'rdc_action_build');
  assert.deepEqual(actionBuilds.map(({ index, metadataEnriched }) => ({ index, metadataEnriched })), [
    { index: 0, metadataEnriched: true },
    { index: 1, metadataEnriched: false },
  ]);
  assert.equal((diagnostics as { event: string; count?: number }[]).find((item) => item.event === 'rdc_provider_refs')?.count, 2);
});

test('RDC reutiliza la referencia del segundo estudio, tolera la pérdida del icon token y distingue referencias faltantes', { timeout: 60_000 }, async () => {
  const session = await openSession();
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  const selected = result.studies[1];
  const references = (session as unknown as { rdcChacabucoStudies: Map<string, { actionIndex: number; actionCount: number; documentToken: string }> }).rdcChacabucoStudies;
  const reference = references.get(selected.id);
  assert.ok(reference);
  assert.deepEqual({ actionIndex: reference.actionIndex, actionCount: reference.actionCount }, { actionIndex: 1, actionCount: 2 });
  assert.ok(reference.documentToken);

  await assert.rejects(session.openStudy('study-id-inventado'), (error: unknown) =>
    error instanceof RdcChacabucoError && error.code === 'STUDY_REFERENCE_MISSING');

  await session.activePage().locator('[data-pp-rdc-icon]').evaluateAll((icons) => {
    for (const icon of icons) icon.removeAttribute('data-pp-rdc-icon');
  });
  assert.equal(await session.openStudy(selected.id), true);
  assert.equal(await session.activePage().locator('#rdc-modal').getAttribute('data-study-id'), 'rdc-private-id-2');

  const safeDiagnostics = JSON.stringify(diagnostics);
  assert.match(safeDiagnostics, /rdc_study_reference_saved/);
  assert.match(safeDiagnostics, /rdc_open_study/);
  assert.match(safeDiagnostics, /rdc_study_action_click/);
  assert.ok(!safeDiagnostics.includes('rdc-private-id'));
  assert.ok(!safeDiagnostics.includes('ECOGRAFIA'));
  await session.closeRdcChacabucoModal();
});

test('RDC devuelve STUDY_ACTION_NOT_FOUND si la referencia existe pero su acción desapareció del listado', { timeout: 60_000 }, async () => {
  const session = await openSession();
  const result = await session.listStudies();
  assert.ok(result);
  await session.activePage().locator('i.fa.fa-file.icon-size').nth(1).evaluate((icon) => icon.remove());
  await assert.rejects(session.openStudy(result.studies[1].id), (error: unknown) =>
    error instanceof RdcChacabucoError && error.code === 'STUDY_ACTION_NOT_FOUND');
});

test('RDC abre un único modal, captura la respuesta PDF original y lo cierra sin cerrar la pestaña', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode2=embed');
  const result = await session.listStudies();
  assert.ok(result);
  const selected = result.studies[0];
  try { assert.equal(await session.openStudy(selected.id), true); }
  catch (error) {
    assert.fail(`open failed: ${String(error)}`);
  }
  assert.equal(await session.activePage().locator('[role="dialog"]').count(), 1);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.equal(captured.buffer.toString('latin1', 0, 5), '%PDF-');
  // Chromium headless puede entregar el PDF del iframe como un download válido.
  assert.ok(['response', 'fetch', 'download'].includes(captured.via));
  await session.closeRdcChacabucoModal();
  assert.equal(await session.activePage().locator('[role="dialog"]').count(), 0);
  assert.equal(await session.openStudy(result.studies[1].id), true, 'el segundo estudio abre después de cerrar el modal anterior');
  const secondPdf = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(secondPdf);
  assert.equal(secondPdf.buffer.toString('latin1', 0, 5), '%PDF-');
  await session.closeRdcChacabucoModal();
  assert.equal(session.openPages(), 1);
});

for (const mode of ['embed', 'object', 'blob', 'data', 'download']) {
  test(`RDC captura PDF desde ${mode}`, { timeout: 60_000 }, async () => {
    const session = await openSession(`?mode=${mode}`);
    const result = await session.listStudies();
    assert.ok(result);
    assert.equal(await session.openStudy(result.studies[0].id), true);
    const captured = await session.downloadRdcChacabucoStudyPdf();
    assert.ok(captured, 'el PDF debe capturarse sin pulsar un control del visor');
    assert.equal(captured.buffer.toString('latin1', 0, 5), '%PDF-');
    await session.closeRdcChacabucoModal();
  });
}

test('RDC recupera el PDF real de un embed same-origin dentro del frame', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=embed-browser');
  const diagnostics: { event: string; strategy?: string; sameOrigin?: boolean; typePdf?: boolean; depth?: number }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.deepEqual(captured.buffer, pdf);
  assert.ok(diagnostics.some((item) => item.event === 'rdc_embed_candidate' && item.sameOrigin && item.typePdf));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_embed_fetch' && item.depth === 0));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && item.strategy === 'embed_browser_fetch'), JSON.stringify(diagnostics));
  assert.ok(!JSON.stringify(diagnostics).includes('/document'));
});

test('RDC sigue un embed HTML con iframe y embed anidados sin guardar el wrapper', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=embed-wrapper-nested');
  const diagnostics: { event: string; strategy?: string; reason?: string; depth?: number; count?: number; sameOrigin?: boolean; typePdf?: boolean }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  const captured = await session.downloadRdcChacabucoStudyPdf().catch((error: unknown) => {
    throw new Error(`${String(error)} ${JSON.stringify(diagnostics)}`);
  });
  assert.ok(captured, JSON.stringify(diagnostics));
  assert.deepEqual(captured.buffer, pdf);
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_candidate' && item.reason === 'html_payload'));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_nested_source_scan' && item.depth === 1 && item.count === 1));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_nested_source_scan' && item.depth === 2 && item.count === 1));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && item.strategy === 'nested_embed_browser_fetch'));
  assert.ok(!JSON.stringify(diagnostics).includes('/masked-wrapper'));
  assert.ok(!JSON.stringify(diagnostics).includes('/embed-page'));
});

test('RDC ignora un primer embed HTML y continúa con el siguiente candidato PDF', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=multiple-browser-candidates');
  const diagnostics: { event: string; strategy?: string; reason?: string; sameOrigin?: boolean; typePdf?: boolean }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.deepEqual(captured.buffer, pdf);
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_candidate' && item.reason === 'html_payload'));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && item.strategy === 'embed_browser_fetch'));
  assert.ok(!JSON.stringify(diagnostics).includes('/fake.pdf'));
  assert.ok(!JSON.stringify(diagnostics).includes('/document'));
});

test('RDC limita por timeout un fetch del embed y conserva un diagnóstico seguro', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=browser-fetch-timeout');
  const diagnostics: { event: string; reason?: string; started?: boolean; depth?: number }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  await assert.rejects(session.downloadRdcChacabucoStudyPdf(), (error: unknown) =>
    error instanceof RdcChacabucoError && error.code === 'PDF_SOURCE_NOT_FOUND');
  assert.ok(diagnostics.some((item) => item.event === 'rdc_embed_fetch' && item.started && item.depth === 0));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_embed_fetch' && item.reason === 'timeout'));
  assert.ok(!JSON.stringify(diagnostics).includes('/slow-document'));
});

test('RDC rechaza un body application/pdf que no contiene magic PDF', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=invalid');
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  await assert.rejects(session.downloadRdcChacabucoStudyPdf(), (error: unknown) => error instanceof RdcChacabucoError && error.code === 'INVALID_PDF');
  await session.closeRdcChacabucoModal();
});

test('RDC acepta la respuesta PDF sin modal y corta los clicks ancestros', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=response-only');
  const diagnostics: { event: string; strategy?: string; found?: boolean }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  assert.equal(await session.activePage().locator('[role="dialog"]').count(), 0);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.equal(captured.via, 'response', JSON.stringify(diagnostics));
  assert.equal(captured.buffer.toString('latin1', 0, 5), '%PDF-');
  const clickEvents = diagnostics.filter((item) => item.event === 'rdc_study_action_click');
  assert.deepEqual(clickEvents.map(({ strategy }) => strategy), ['icon']);
  const listenerReady = diagnostics.findIndex((item) => item.event === 'rdc_document_listeners_ready' && item.found);
  const firstClick = diagnostics.findIndex((item) => item.event === 'rdc_study_action_click');
  assert.ok(listenerReady >= 0 && listenerReady < firstClick, 'listeners are ready before the icon click');
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_response' && item.found));
});

for (const mode of ['response-range', 'response-range-offset']) {
  test(`RDC reensambla el PDF completo cuando el visor responde con 206 (${mode})`, { timeout: 60_000 }, async () => {
    const session = await openSession(`?mode=${mode}`);
    const diagnostics: { event: string; status?: number; strategy?: string; count?: number; contentRangePresent?: boolean; bodyBytes?: number; magic?: string }[] = [];
    session.onProviderStructure = (event) => diagnostics.push(event);
    const result = await session.listStudies();
    assert.ok(result);
    assert.equal(await session.openStudy(result.studies[0].id), true);
    const captured = await session.downloadRdcChacabucoStudyPdf();
    assert.ok(captured);
    assert.deepEqual(captured.buffer, pdf);
    assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_candidate' && item.status === 206 && item.contentRangePresent && (item.bodyBytes || 0) > 0 && item.magic));
    assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && item.strategy === 'range_reassembly'));
    assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_full' && item.count === pdf.length));
    assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_valid' && item.count === pdf.length));
    assert.ok(!JSON.stringify(diagnostics).includes('/range.pdf'));
  });
}

test('RDC descarta un viewer shell HTML y sigue esperando el PDF real', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=response-html-then-valid');
  const diagnostics: { event: string; rejected?: boolean; reason?: string; strategy?: string }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.equal(captured.buffer.toString('latin1', 0, 5), '%PDF-');
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_candidate' && item.rejected && item.reason === 'html_payload'));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && item.strategy === 'response_full'));
});

test('RDC encuentra el PDF real tras una respuesta application/pdf que contiene HTML e iframes anidados', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=response-html-nested');
  const diagnostics: { event: string; status?: number; rejected?: boolean; reason?: string; strategy?: string; frames?: number; attr?: string }[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  const captured = await session.downloadRdcChacabucoStudyPdf();
  assert.ok(captured);
  assert.deepEqual(captured.buffer, pdf);
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_candidate' && item.status === 200 && item.rejected && item.reason === 'html_payload'));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_dom_candidate' && item.attr === 'src'), JSON.stringify(diagnostics));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_modal_probe' && (item.frames || 0) >= 3));
  assert.ok(diagnostics.some((item) => item.event === 'rdc_pdf_source' && ['iframe_fetch', 'iframe_browser_fetch'].includes(item.strategy || '')));
  assert.ok(!JSON.stringify(diagnostics).includes('/wrapper.html'));
});

test('RDC debug retiene el modal abierto solo tras observar un modal', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=modal-no-source');
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  await assert.rejects(session.downloadRdcChacabucoStudyPdf(), (error: unknown) => error instanceof RdcChacabucoError && error.code === 'PDF_SOURCE_NOT_FOUND');
  session.retainRdcModalForDebug(120_000);
  await session.closeRdcChacabucoModal();
  assert.ok(session.debugViewerRetentionMs > 60_000);
  assert.equal(await session.activePage().locator('[role="dialog"]').count(), 1);
});

test('RDC rechaza una respuesta PDF inválida aunque no haya modal', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=response-invalid-only');
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(await session.openStudy(result.studies[0].id), true);
  assert.equal(await session.activePage().locator('[role="dialog"]').count(), 0);
  await assert.rejects(session.downloadRdcChacabucoStudyPdf(), (error: unknown) => error instanceof RdcChacabucoError && error.code === 'INVALID_PDF');
});

test('RDC devuelve PDF_SOURCE_NOT_FOUND si vence el timeout sin modal ni fuente de documento', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=no-document');
  const result = await session.listStudies();
  assert.ok(result);
  await assert.rejects(session.openStudy(result.studies[0].id), (error: unknown) => error instanceof RdcChacabucoError && error.code === 'PDF_SOURCE_NOT_FOUND');
});

test('RDC bloquea PDF desde un origin no permitido', { timeout: 60_000 }, async () => {
  const session = await openSession('?mode=external');
  const diagnostics: unknown[] = [];
  session.onProviderStructure = (event) => diagnostics.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  await session.openStudy(result.studies[0].id);
  await assert.rejects(session.downloadRdcChacabucoStudyPdf(), UnexpectedDomainError, JSON.stringify(diagnostics));
  await session.closeRdcChacabucoModal();
});

test('RDC sourceKey es estable, opaca y distingue IDs de proveedor de la metadata', () => {
  const byId = rdcChacabucoSourceKey('2026-01-15', 'ULTRASONIDO', 'ECOGRAFIA TIROIDES', 'private-id');
  assert.equal(byId, rdcChacabucoSourceKey('2025-01-01', 'Otro tipo', 'Otra descripción', 'private-id'));
  assert.notEqual(byId, 'private-id');
  assert.equal(byId?.length, 64);
  assert.equal(rdcChacabucoSourceKey('2026-01-15', 'ULTRASONIDO', 'ECOGRAFIA TIROIDES'), rdcChacabucoSourceKey('2026-01-15', 'ULTRASONIDO', 'ECOGRAFIA TIROIDES'));
  const rowZero = rdcChacabucoSourceKey(undefined, undefined, undefined, undefined, 0);
  const rowOne = rdcChacabucoSourceKey(undefined, undefined, undefined, undefined, 1);
  assert.ok(rowZero && rowOne);
  assert.equal(rowZero, rdcChacabucoSourceKey(undefined, undefined, undefined, undefined, 0));
  assert.notEqual(rowZero, rowOne);
  assert.equal(rdcChacabucoSourceKey(), undefined);
});
