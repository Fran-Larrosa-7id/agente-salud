import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { BrowserSession, MedicalArchiveError, StudyReferenceMismatchError, UnexpectedDomainError } from '../../src/browser/session.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';

let server: Server;
let viewerServer: Server;
let origin = '';
let viewerOrigin = '';
let host: BrowserHost;
const sessions: BrowserSession[] = [];
const archiveRequests: string[] = [];
const externalArchiveRequests: string[] = [];
const archiveZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30, 0x40]);

function send(res: import('node:http').ServerResponse, type: string, body: string | Buffer) {
  res.writeHead(200, { 'content-type': type });
  res.end(body);
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
    if (url.pathname === '/external-list') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><table><tbody>
        <tr><td>13/04/24</td><td>Ecografía abdominal</td><td>US</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=external-study"><img alt="icono"></a></td></tr>
      </tbody></table></body></html>`);
    }
    if (url.pathname === '/external-delayed-list' || url.pathname === '/external-cookie-list') {
      const studyId = url.pathname === '/external-delayed-list' ? 'delayed-study' : 'cookie-study';
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><table><tbody>
        <tr><td>13/04/24</td><td>Ecografía abdominal</td><td>US</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=${studyId}"><img alt="icono"></a></td></tr>
      </tbody></table></body></html>`);
    }
    if (url.pathname === '/external-evil-list') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><table><tbody>
        <tr><td>13/04/24</td><td>Ecografía abdominal</td><td>US</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=evil-study"><img alt="icono"></a></td></tr>
      </tbody></table></body></html>`);
    }
    if (url.pathname === '/external-evil-chain-list') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><table><tbody>
        <tr><td>13/04/24</td><td>Ecografía abdominal</td><td>US</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=evil-chain-study"><img alt="icono"></a></td></tr>
      </tbody></table></body></html>`);
    }
    if (url.pathname === '/minimal') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><table><tbody>
        <tr><td>05/05/24</td><td><a href="/funcion/llamadoURL.php?id=only-study"><img alt="icono"></a></td>
        <td><a href="/funcion/compartir.php?patient=must-not-log">Compartir</a></td></tr>
      </tbody></table></body></html>`);
    }
    if (url.pathname === '/no-rows') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><main><h1>Mis estudios</h1>
        <a target="_blank" href="../funcion/llamadoURL.php?accessionnPHP=opaque-1"><i class="fas fa-image"></i></a>
        <a target="_blank" href="../funcion/llamadoURL.php?accessionnPHP=opaque-2"><i class="fas fa-image"></i></a>
        <a target="_blank" href="../funcion/llamadoURL.php?accessionnPHP=opaque-3"><i class="fas fa-image"></i></a>
      </main></body></html>`);
    }
    if (url.pathname === '/parallel-dates') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><div class="ns-table">
        <span class="ns-table__text">23/02/26</span><a target="_blank" href="/funcion/llamadoURL.php?studyId=date-1"><img alt="abrir"></a>
        <span class="ns-table__text">08/04/24</span><a target="_blank" href="/funcion/llamadoURL.php?studyId=date-2"><img alt="abrir"></a>
        <span class="ns-table__text">11/12/23</span><a target="_blank" href="/funcion/llamadoURL.php?studyId=date-3"><img alt="abrir"></a>
      </div></body></html>`);
    }
    if (url.pathname === '/partial-parallel-dates') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1><div class="ns-table">
        <span class="ns-table__text">23/02/26</span><a target="_blank" href="/funcion/llamadoURL.php?studyId=partial-1"><img alt="abrir"></a>
        <span class="ns-table__text">08/04/24</span><a target="_blank" href="/funcion/llamadoURL.php?studyId=partial-2"><img alt="abrir"></a>
        <a target="_blank" href="/funcion/llamadoURL.php?studyId=partial-3"><img alt="abrir"></a>
      </div></body></html>`);
    }
    if (url.pathname === '/onclick') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1>
        <div class="list"><div class="entry"><span>07/05/24</span><span>Ecografía abdominal</span><span>US</span>
          <div onclick="window.open('/funcion/llamadoURL.php?studyId=onclick-study')"><img alt="icono"></div>
          <a href="/funcion/compartir.php?patient=must-not-log">Compartir</a>
        </div><div class="entry"><span>08/05/24</span><span>Tomografía de abdomen</span><span>CT</span>
          <div data-open-viewer="funcion/llamadoURL.php?studyId=data-study"><img alt="icono"></div>
        </div></div></body></html>`);
    }
    if (url.pathname === '/mismatch') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1>
        <table><thead><tr><th>Fecha del estudio</th><th>Estudio</th><th>Modalidad</th><th>Compartir</th></tr></thead>
        <tbody><tr><td>06/05/24</td><td>RM de control</td><td>MR</td><td><a href="/funcion/compartir.php">Compartir</a></td></tr></tbody></table>
      </body></html>`);
    }
    if (url.pathname === '/empty') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><body><h1>Mis estudios</h1>
        <p>No hay estudios para mostrar</p><table><tbody><tr><td colspan="4">Sin estudios</td></tr></tbody></table>
      </body></html>`);
    }
    if (url.pathname === '/archive.zip') {
      archiveRequests.push(url.search);
      res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="original.zip"', 'content-length': String(archiveZip.length) });
      return void res.end(archiveZip);
    }
    if (url.pathname === '/funcion/llamadoURL.php') {
      const studyId = url.searchParams.get('studyId');
      if (studyId === 'external-study') {
        res.writeHead(302, { location: viewerOrigin + '/pixeon' });
        return void res.end();
      }
      if (studyId === 'delayed-study') {
        res.writeHead(302, { location: viewerOrigin + '/pixeon-delayed' });
        return void res.end();
      }
      if (studyId === 'cookie-study') {
        res.writeHead(302, { location: viewerOrigin + '/pixeon-cookie' });
        return void res.end();
      }
      if (studyId === 'evil-study') {
        res.writeHead(302, { location: 'https://evil.example/pixeon?token=must-not-log' });
        return void res.end();
      }
      if (studyId === 'evil-chain-study') {
        res.writeHead(302, { location: viewerOrigin + '/redirect-to-evil' });
        return void res.end();
      }
      const date = studyId === 'stable-2' ? '11/04/2024' : studyId === 'stable-3' ? '12/04/2024' : '08/04/2024';
      const title = studyId === 'stable-2' ? 'Tomografía de tórax' : studyId === 'stable-3' ? 'Radiografía de tórax' : 'Reconstrucción 3D';
      const modality = studyId === 'stable-2' ? 'CT' : studyId === 'stable-3' ? 'DX' : 'SC';
      const viewer = `<!doctype html><html><head><title>Pixeon Aurora</title><script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script></head><body>
        <h1>Pixeon Aurora</h1><div role="toolbar"><button aria-label="Zoom in">+</button><button aria-label="Rotar imagen">↻</button></div>
        <dl><dt>Fecha del estudio</dt><dd>${date}</dd><dt>Estudio</dt><dd>${title}</dd><dt>Modalidad</dt><dd>${modality}</dd></dl>
        <canvas aria-label="Visor de imágenes médicas"></canvas><button class="downloadToolsItem" id="download" aria-label="Descargar">Descargar</button><div id="menu"></div>
        <script>
          document.getElementById('download').onclick = () => { document.getElementById('menu').innerHTML =
            '<button role="menuitem">Descargar Serie Actual - PNG</button>' +
            '<button role="menuitem">Descargar Serie Actual - ZIP DCM</button>' +
            '<button role="menuitem">Descargar todas las Series - PNG</button>' +
            '<button role="menuitem" id="full">Descargar todas las Series - ZIP DCM</button>' +
            '<button role="menuitem">Descargar todas las Series con Viewer - ZIP DCM</button>';
            document.getElementById('full').onclick = () => { const a = document.createElement('a'); a.href='/archive.zip?scope=all-dicom'; a.download='original.zip'; document.body.appendChild(a); a.click(); a.remove(); };
          };
        </script></body></html>`;
      return void send(res, 'text/html; charset=utf-8', viewer);
    }
    const login = `<!doctype html><html><head><title>Acceso pacientes</title></head><body><main>
      <h1>Acceso pacientes</h1><input type="password" aria-label="Contraseña"><button id="enter">Ingresar</button>
      <script>document.getElementById('enter').onclick=()=>{document.querySelector('main').innerHTML=${JSON.stringify(`
        <h1>Mis estudios disponibles</h1><p>Paciente Privado de Prueba</p><table><thead><tr><th>Nacimiento</th><th>Fecha del estudio</th><th>Estudio</th><th>Médico solicitante</th><th>Modalidad</th><th>Estudio</th><th>Compartir</th></tr></thead><tbody>
        <tr data-study-id="stable-1"><td>1980-03-04</td><td><span class="ns-table__text">08/04/2024</span></td><td data-label="Estudio">Reconstrucción 3D</td><td>Dra. Privada</td><td data-label="Modalidad">SC</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=stable-1"><img alt="icono"></a></td><td><a href="/funcion/compartir.php?patient=must-not-log">Compartir</a></td></tr>
        <tr data-study-id="stable-2"><td>1980-03-04</td><td><span class="ns-table__text">10/04/2024</span></td><td data-label="Estudio">Tomografía de tórax</td><td>Dr. Privado</td><td data-label="Modalidad">CT</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=stable-2"><img alt="icono"></a></td><td><a href="/funcion/compartir.php?patient=must-not-log">Compartir</a></td></tr>
        <tr data-study-id="stable-3"><td>1980-03-04</td><td><span class="ns-table__text">12/04/2024</span></td><td data-label="Estudio">Radiografía de tórax</td><td>Dr. Reservado</td><td data-label="Modalidad">DX</td><td><a target="_blank" href="/funcion/llamadoURL.php?studyId=stable-3"><img alt="icono"></a></td><td><a href="/funcion/compartir.php?patient=must-not-log">Compartir</a></td></tr>
        </tbody></table>`)};};</script></main></body></html>`;
    send(res, 'text/html; charset=utf-8', login);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('FIXTURE_SERVER_FAILED');
  origin = `http://127.0.0.1:${address.port}`;
  viewerServer = createServer((req, res) => {
    const url = new URL(req.url || '/', viewerOrigin || 'http://localhost');
    if (url.pathname === '/redirect-to-evil') {
      res.writeHead(302, { location: 'https://evil.example/pixeon?token=must-not-log' });
      return void res.end();
    }
    if (url.pathname === '/archive.zip') {
      externalArchiveRequests.push(url.search);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="original.zip"', 'content-length': String(archiveZip.length) });
      return void res.end(archiveZip);
    }
    if (url.pathname === '/pixeon-delayed') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><head><title>Visor</title></head><body><main id="app"></main>
        <script>setTimeout(() => { document.querySelector('#app').innerHTML = '<h1>Pixeon Aurora</h1><div role="toolbar"><button aria-label="Zoom">Zoom</button><button aria-label="Girar">Girar</button><button aria-label="Layout">Layout</button></div><dl><dt>Fecha del estudio</dt><dd>2024-04-13</dd><dt>Estudio</dt><dd>Ecografía abdominal</dd><dt>Modalidad</dt><dd>US</dd></dl><canvas aria-label="Visor de imágenes"></canvas><button aria-label="Descargar">Descargar</button>'; }, 1200);</script>
      </body></html>`);
    }
    if (url.pathname === '/pixeon-cookie') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><head><title>Visor</title></head><body>
        <div role="dialog" aria-modal="true" id="consent"><p>Al hacer clic en Aceptar, continuás al visor.</p><button id="accept">Aceptar</button></div><main id="app"></main>
        <script>document.querySelector('#accept').onclick = () => { document.querySelector('#consent').remove(); document.querySelector('#app').innerHTML = '<h1>Pixeon Aurora</h1><div role="toolbar"><button aria-label="Zoom">Zoom</button><button aria-label="Girar">Girar</button><button aria-label="Layout">Layout</button></div><dl><dt>Fecha del estudio</dt><dd>2024-04-13</dd><dt>Estudio</dt><dd>Ecografía abdominal</dd><dt>Modalidad</dt><dd>US</dd></dl><canvas aria-label="Visor de imágenes"></canvas><button aria-label="Descargar">Descargar</button>'; };</script>
      </body></html>`);
    }
    if (url.pathname === '/pixeon') {
      return void send(res, 'text/html; charset=utf-8', `<!doctype html><html><head><title>Pixeon Aurora</title><script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script></head><body>
        <h1>Pixeon Aurora</h1><div role="toolbar"><button aria-label="Zoom in">+</button><button aria-label="Rotar imagen">↻</button></div>
        <dl><dt>Fecha del estudio</dt><dd>2024-04-13</dd><dt>Estudio</dt><dd>Ecografía abdominal</dd><dt>Modalidad</dt><dd>US</dd></dl>
        <canvas aria-label="Visor de imágenes médicas"></canvas><button class="downloadToolsItem" aria-label="Descargar">Descargar</button><div id="menu"></div>
        <script>
          document.querySelector('button[aria-label="Descargar"]').onclick = () => { document.getElementById('menu').innerHTML =
            '<button role="menuitem">Descargar Serie Actual - ZIP DCM</button>' +
            '<button role="menuitem" id="full">Descargar todas las Series - ZIP DCM</button>';
            document.getElementById('full').onclick = () => { const a = document.createElement('a'); a.href='/archive.zip?scope=all-dicom'; a.download='original.zip'; document.body.appendChild(a); a.click(); a.remove(); };
          };
        </script></body></html>`);
    }
    send(res, 'text/html; charset=utf-8', '<!doctype html><html><body><h1>Sin visor de imágenes</h1><button>Continuar</button></body></html>');
  });
  await new Promise<void>((resolve) => viewerServer.listen(0, '0.0.0.0', resolve));
  const viewerAddress = viewerServer.address();
  if (!viewerAddress || typeof viewerAddress === 'string') throw new Error('VIEWER_FIXTURE_SERVER_FAILED');
  viewerOrigin = `http://localhost:${viewerAddress.port}`;
  host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: path.join(tmpdir(), 'pp-centrodm-debug') });
});

test('Centro DM rechaza un visor cuyo metadata explícito no coincide con el estudio elegido', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  await session.activePage().fill('input[type=password]', 'manual-test-entry');
  await session.activePage().click('#enter');
  await session.activePage().waitForSelector('table tbody tr');
  const result = await session.listStudies();
  assert.ok(result);
  const checks: { event: string; count?: number; found?: boolean }[] = [];
  session.onProviderStructure = (event) => checks.push(event);
  let mismatch: unknown;
  try { await session.openStudy(result.studies[1].id); } catch (error) { mismatch = error; }
  assert.ok(mismatch instanceof StudyReferenceMismatchError, 'el viewer no coincidió: ' + JSON.stringify(checks));
  assert.ok(checks.some((event) => event.event === 'viewer_reference_check' && event.count === 3 && event.found), JSON.stringify(checks));
});

after(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  await host.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => viewerServer.close(() => resolve()));
});

test('Centro DM reconoce estudios, mantiene sourceKey entre jobs, detecta popup Pixeon y descarga ZIP DICOM completo', { timeout: 90_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  await session.activePage().fill('input[type=password]', 'manual-test-entry');
  await session.activePage().click('#enter');
  await session.activePage().waitForSelector('table tbody tr');

  assert.equal(await session.isCentroDmResultsPage(), true);
  const structure: { event: string; host?: string; port?: string; popup?: boolean; count?: number; index?: number; hasDate?: boolean; tag?: string; role?: string; hrefPresent?: boolean; hrefKind?: string; ancestorTr?: boolean; found?: boolean; brand?: boolean; downloadCandidates?: number; toolbarCandidates?: number; readyScore?: number; textMatch?: boolean; visible?: boolean; opened?: boolean; strategy?: string; selector?: string; elapsedMs?: number }[] = [];
  session.onProviderStructure = (event) => structure.push(event);
  const blockedRequests: { scheme: string; host: string; port: string }[] = [];
  let fatalDomainCallback = 0;
  session.onNavigationBlocked = (info) => blockedRequests.push(info);
  session.onUnexpectedDomain = () => fatalDomainCallback++;
  const first = await session.listStudies();
  assert.ok(first);
  assert.equal(first.studies.length, 3);
  assert.ok(first.studies.every((study) => session.hasStudy(study.id)), 'el fast path CentroDM debe reconocer sus propias referencias');
  await assert.rejects(
    session.openStudy('missing-centrodm-reference'),
    (error: unknown) => error instanceof MedicalArchiveError && error.code === 'STUDY_REFERENCE_MISSING',
  );
  assert.deepEqual(first.studies.map((study) => [study.date, study.studyDate, study.title, study.modality]), [
    ['2024-04-08', '2024-04-08', 'Reconstrucción 3D', 'SC'],
    ['2024-04-10', '2024-04-10', 'Tomografía de tórax', 'CT'],
    ['2024-04-12', '2024-04-12', 'Radiografía de tórax', 'DX'],
  ]);
  assert.ok(first.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')));
  assert.ok(!JSON.stringify(first).includes('Paciente Privado'));
  assert.ok(!JSON.stringify(first).includes('Dra. Privada'));
  assert.ok(!JSON.stringify(first).includes('1980-03-04'), 'no confunde fecha de nacimiento con fecha del estudio');
  assert.ok(!JSON.stringify(first).includes('stable-1'), 'no expone el identificador de la query');
  assert.ok(structure.some((event) => event.event === 'centrodm_result_actions' && event.count === 3));
  assert.ok(structure.some((event) => event.event === 'centrodm_rows_with_action' && event.count === 3));
  assert.ok(structure.some((event) => event.event === 'centrodm_metadata_dates_found' && event.count === 3));
  assert.ok(structure.some((event) => event.event === 'centrodm_studies_with_date' && event.count === 3));
  assert.deepEqual(structure.filter((event) => event.event === 'centrodm_study_metadata').map(({ index, hasDate }) => [index, hasDate]), [[1, true], [2, true], [3, true]]);
  assert.ok(structure.some((event) => event.event === 'centrodm_parsed_studies' && event.count === 3));
  assert.equal(structure.filter((event) => event.event === 'centrodm_action').length, 3);
  assert.ok(structure.filter((event) => event.event === 'centrodm_action').every((event) => event.tag === 'a' && event.hrefPresent && event.hrefKind === 'llamadoURL' && event.ancestorTr));
  assert.ok(!JSON.stringify(structure).includes('stable-1'));
  assert.ok(!JSON.stringify(structure).includes('must-not-log'));
  assert.ok(!JSON.stringify(structure).includes('Paciente Privado'));
  assert.ok(!JSON.stringify(structure).includes('Dra. Privada'));
  assert.ok(!JSON.stringify(structure).includes('08/04/2024'), 'los logs no incluyen fechas reales');
  assert.ok(!JSON.stringify(structure).includes('llamadoURL.php?'));
  const repeated = await session.listStudies();
  assert.deepEqual(repeated?.studies.map((study) => study.sourceKey), first.studies.map((study) => study.sourceKey));

  assert.equal(await session.openStudy(first.studies[0].id), true);
  assert.ok(structure.some((event) => event.event === 'viewer_detected' && event.host === '127.0.0.1'), JSON.stringify(structure));
  assert.ok(structure.some((event) => event.event === 'viewer_opened' && event.popup === true), JSON.stringify(structure));
  const archive = await session.downloadFullDicomStudy(5_000);
  assert.deepEqual(archive.buffer, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30, 0x40]));
  assert.deepEqual(archiveRequests, ['?scope=all-dicom'], 'eligió ZIP DCM de todas las series, no serie actual ni PNG/viewer');
  assert.ok(structure.some((event) => event.event === 'viewer_download_strategy'));
  assert.ok(structure.some((event) => event.event === 'viewer_download_options' && event.count === 5));
  assert.ok(structure.some((event) => event.event === 'medical_archive_downloaded' && event.count === archive.buffer.length));
  assert.ok(structure.some((event) => event.event === 'pixeon_probe' && event.brand && (event.downloadCandidates || 0) > 0 && (event.readyScore || 0) >= 4));
  assert.ok(structure.some((event) => event.event === 'pixeon_download_fastpath' && event.selector === 'downloadToolsItem' && event.count === 1 && event.visible));
  assert.ok(structure.some((event) => event.event === 'pixeon_download_button' && event.found && event.strategy === 'class_fastpath'));
  assert.ok(structure.some((event) => event.event === 'pixeon_download_menu' && event.opened));
  assert.ok(structure.some((event) => event.event === 'pixeon_download_choice' && event.strategy === 'full_dicom_zip'));
  for (let attempt = 0; attempt < 10 && !blockedRequests.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(blockedRequests.some((request) => request.host === 'www.googletagmanager.com'), 'GTM sigue bloqueado como subrecurso');
  assert.equal(fatalDomainCallback, 0, 'bloquear GTM no invalida el viewer ni la sesión');
});

test('Centro DM espera el render tardío de la toolbar Pixeon hasta el timeout configurado', { timeout: 20_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/external-delayed-list',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/external-delayed-list$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true, undefined, undefined, [], 5_000);
  sessions.push(session);
  await session.gotoLogin();
  const events: { event: string; brand?: boolean; downloadCandidates?: number; toolbarCandidates?: number; readyScore?: number; found?: boolean }[] = [];
  session.onProviderStructure = (event) => events.push(event);
  const result = await session.listStudies();
  assert.equal(result?.studies.length, 1);
  assert.equal(await session.openStudy(result!.studies[0].id), true);
  const probes = events.filter((event) => event.event === 'pixeon_probe');
  assert.ok(probes.length >= 2, 'hizo varios probes mientras la SPA terminaba de renderizar');
  assert.ok(probes.some((event) => event.found === false && !event.brand && !(event.downloadCandidates || 0)));
  assert.ok(probes.some((event) => event.found === true && (event.downloadCandidates || 0) > 0));
  await session.closeExtraPages();
});

test('Centro DM acepta un modal de consentimiento Pixeon y reintenta readiness', { timeout: 20_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/external-cookie-list',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/external-cookie-list$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true, undefined, undefined, [], 5_000);
  sessions.push(session);
  await session.gotoLogin();
  const events: { event: string; detected?: boolean; accepted?: boolean; found?: boolean; downloadCandidates?: number }[] = [];
  session.onProviderStructure = (event) => events.push(event);
  const result = await session.listStudies();
  assert.equal(result?.studies.length, 1);
  assert.equal(await session.openStudy(result!.studies[0].id), true);
  assert.ok(events.some((event) => event.event === 'pixeon_cookie_consent' && event.detected && event.accepted));
  assert.ok(events.some((event) => event.event === 'pixeon_probe' && event.found && (event.downloadCandidates || 0) > 0));
  await session.closeExtraPages();
});

test('Centro DM permite solo el origin Pixeon configurado y conserva la pestaña autenticada', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/external-list',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/external-list$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const mainPage = session.activePage();
  const events: { event: string; host?: string; count?: number; found?: boolean; popup?: boolean }[] = [];
  const allowedViewerOrigins: { host: string; port: string }[] = [];
  session.onProviderStructure = (event) => events.push(event);
  session.onCentroDmViewerOriginAllowed = (info) => allowedViewerOrigins.push(info);
  let openedPopup: boolean | null = null;
  session.onCentroDmViewerOpened = (info) => { openedPopup = info.popup; };
  let fatalDomainCallback = 0;
  session.onUnexpectedDomain = () => fatalDomainCallback++;

  const result = await session.listStudies();
  assert.equal(result?.studies.length, 1);
  const study = result!.studies[0];
  assert.equal(await session.openStudy(study.id), true);
  assert.equal(session.openPages(), 2);
  assert.equal(mainPage.isClosed(), false);
  assert.match(mainPage.url(), /\/external-list$/);
  assert.equal(new URL(session.activePage().url()).hostname, 'localhost');
  assert.equal(session.policy.isAllowedNavigation(viewerOrigin), true, 'el origin está permitido explícitamente para este provider');
  assert.equal(session.policy.isAllowedNavigation('http://untrusted.invalid/leave-viewer'), false);
  assert.deepEqual(allowedViewerOrigins, [{ host: 'localhost', port: new URL(viewerOrigin).port }]);
  assert.equal(openedPopup, true);
  assert.ok(events.some((event) => event.event === 'centrodm_viewer_detected' && event.host === 'localhost' && event.found));

  const archive = await session.downloadFullDicomStudy(5_000).catch((error: unknown) =>
    assert.fail(`${String(error)} externalRequests=${JSON.stringify(externalArchiveRequests)} events=${JSON.stringify(events)}`));
  assert.ok(events.some((event) => event.event === 'centrodm_find_document_enter'), 'finder Centro DM ejecutado');
  assert.ok(events.some((event) => event.event === 'pixeon_download_probe_start'), 'finder Pixeon ejecutó el probe');
  assert.ok(events.some((event) => event.event === 'pixeon_download_probe_end' && event.found), 'el probe informa el resultado');
  assert.ok(events.some((event) => event.event === 'pixeon_frames' && event.count === 1));
  assert.deepEqual(archive.buffer, archiveZip);
  assert.deepEqual(externalArchiveRequests, ['?scope=all-dicom']);

  const untrustedProbe = await mainPage.context().newPage();
  await untrustedProbe.goto('http://untrusted.invalid/leave-viewer').catch(() => {});
  assert.notEqual(new URL(untrustedProbe.url()).hostname, 'untrusted.invalid');
  assert.equal(fatalDomainCallback, 0, 'un destino bloqueado dentro del popup no cancela la sesión principal');
  assert.equal(mainPage.isClosed(), false);
  await untrustedProbe.close();

  await session.closeExtraPages();
  assert.equal(session.activePage(), mainPage);
  assert.match(mainPage.url(), /\/external-list$/);
  assert.equal(mainPage.isClosed(), false);
});

test('Pixeon: errores distinguibles y keep-open preserva visor y principal hasta dispose', async () => {
  const provider = { ...centroDm, loginUrl: origin + '/external-list', allowedHosts: ['127.0.0.1'], staticHosts: [], allowedOrigins: [viewerOrigin], requireHttps: false, loginPathPattern: /\/external-list$/ };
  const session = await BrowserSession.open(host, provider, true, undefined, true, undefined, undefined, [], undefined, 0);
  sessions.push(session);
  await session.gotoLogin();
  const main = session.activePage();
  const list = await session.listStudies();
  assert.equal(await session.openStudy(list!.studies[0].id), true);
  const viewer = session.activePage();
  await viewer.setContent('<h1>Pixeon Aurora</h1><span>Descargar</span>');
  await assert.rejects(session.downloadFullDicomStudy(100), (e: unknown) => e instanceof MedicalArchiveError && e.code === 'DOWNLOAD_ACTION_NOT_CLICKABLE');
  await viewer.setContent('<h1>Pixeon Aurora</h1><button>Layout</button><button>Zoom</button><button>Presets</button>');
  await assert.rejects(session.downloadFullDicomStudy(100), (e: unknown) => e instanceof MedicalArchiveError && e.code === 'DOWNLOAD_ACTION_NOT_FOUND');
  await viewer.setContent('<h1>Pixeon Aurora</h1><button>Descargar</button>');
  await assert.rejects(session.downloadFullDicomStudy(100), (e: unknown) => e instanceof MedicalArchiveError && e.code === 'DOWNLOAD_MENU_NOT_FOUND');
  session.retainPixeonViewerForDebug();
  await session.closeExtraPages();
  assert.equal(viewer.isClosed(), false);
  assert.equal(main.isClosed(), false);
  assert.ok(session.debugViewerRetentionMs > 60_000);
  await session.close();
  assert.equal(viewer.isClosed(), true);
  assert.equal(main.isClosed(), true);
  assert.equal(session.debugViewerRetentionMs, 0);
});

test('Centro DM bloquea redirects a origins no confirmados y no registra path ni query', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/external-evil-list',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/external-evil-list$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const mainPage = session.activePage();
  const blocked: { scheme: string; host: string; port: string }[] = [];
  const navigations: string[] = [];
  mainPage.context().on('page', (page) => page.on('request', (request) => {
    if (request.isNavigationRequest()) navigations.push(new URL(request.url()).hostname);
  }));
  let fatalDomainCallback = 0;
  session.onNavigationBlocked = (info) => blocked.push(info);
  session.onUnexpectedDomain = () => fatalDomainCallback++;

  const result = await session.listStudies();
  assert.equal(result?.studies.length, 1);
  let openingError: unknown;
  try { await session.openStudy(result!.studies[0].id); } catch (error) { openingError = error; }
  assert.ok(openingError instanceof UnexpectedDomainError, `${String(openingError)} blocked=${JSON.stringify(blocked)} navigations=${JSON.stringify(navigations)}`);
  assert.deepEqual(blocked, [{ scheme: 'https', host: 'evil.example', port: '443' }]);
  assert.ok(!navigations.includes('evil.example'), 'Chromium no debe emitir el request al destino bloqueado');
  assert.ok(!JSON.stringify(blocked).includes('must-not-log'));
  assert.equal(fatalDomainCallback, 0, 'un redirect del viewer se limita a este estudio y no cierra la sesión principal');
  assert.equal(mainPage.isClosed(), false);
  assert.match(mainPage.url(), /\/external-evil-list$/);
  await session.closeExtraPages();
});

test('Centro DM valida cada salto y bloquea un redirect externo desde el origin Pixeon permitido', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/external-evil-chain-list',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [viewerOrigin],
    requireHttps: false,
    loginPathPattern: /\/external-evil-chain-list$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const mainPage = session.activePage();
  const blocked: { scheme: string; host: string; port: string }[] = [];
  const navigations: string[] = [];
  const allowedViewerOrigins: { host: string; port: string }[] = [];
  mainPage.context().on('page', (page) => page.on('request', (request) => {
    if (request.isNavigationRequest()) navigations.push(new URL(request.url()).hostname);
  }));
  session.onNavigationBlocked = (info) => blocked.push(info);
  session.onCentroDmViewerOriginAllowed = (info) => allowedViewerOrigins.push(info);

  const result = await session.listStudies();
  assert.equal(result?.studies.length, 1);
  await assert.rejects(session.openStudy(result!.studies[0].id), UnexpectedDomainError);
  assert.deepEqual(allowedViewerOrigins, [{ host: 'localhost', port: new URL(viewerOrigin).port }]);
  assert.deepEqual(blocked, [{ scheme: 'https', host: 'evil.example', port: '443' }]);
  assert.ok(navigations.includes('localhost'), 'el salto permitido llegó al origin Pixeon configurado');
  assert.ok(!navigations.includes('evil.example'), 'el navegador no emitió la navegación al origin externo');
  assert.ok(!JSON.stringify(blocked).includes('must-not-log'));
  assert.equal(mainPage.isClosed(), false);
  assert.match(mainPage.url(), /\/external-evil-chain-list$/);
  await session.closeExtraPages();
});

test('Centro DM detecta el ancla llamadoURL con imagen, ignora Compartir y acepta metadata mínima', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/minimal',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/minimal$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  assert.equal(await session.isCentroDmResultsPage(), true);
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 1);
  assert.equal(result.studies[0].date, '2024-05-05');
  assert.equal(result.studies[0].title, 'Estudio de imágenes');
  assert.equal(result.studies[0].modality, undefined);
  assert.match(result.studies[0].sourceKey || '', /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('only-study'));
  const repeated = await session.listStudies();
  assert.equal(repeated?.studies[0].sourceKey, result.studies[0].sourceKey, 'el identificador de la query produce la misma clave entre extracciones');
});

test('Centro DM no informa parser mismatch cuando un listado reconocible no contiene acciones', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/mismatch',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/mismatch$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  assert.equal(await session.isCentroDmResultsPage(), true);
  const result = await session.listStudies();
  assert.deepEqual(result?.studies, []);
});

test('Centro DM detecta llamadoURL en onclick/data-* y asocia acciones a filas div', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/onclick',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/onclick$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 2);
  assert.deepEqual([result.studies[0].date, result.studies[0].title, result.studies[0].modality], ['2024-05-07', 'Ecografía abdominal', 'US']);
  assert.deepEqual([result.studies[1].date, result.studies[1].title, result.studies[1].modality], ['2024-05-08', 'Tomografía de abdomen', 'CT']);
  assert.ok(!JSON.stringify(result).includes('onclick-study'));
});

test('Centro DM no confunde una fila de listado vacío con un parser mismatch', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/empty',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/empty$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const result = await session.listStudies();
  assert.ok(result);
  assert.deepEqual(result.studies, []);
});

test('Centro DM asigna studyDate por orden solo si coinciden la cantidad de actions y fechas', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/parallel-dates',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/parallel-dates$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const result = await session.listStudies();
  assert.deepEqual(result?.studies.map((study) => study.studyDate), ['2026-02-23', '2024-04-08', '2023-12-11']);
  assert.ok(result?.studies.every((study) => !study.date), 'el fallback de fechas no modifica la metadata previa ni la sourceKey');
  const sourceKeys = result?.studies.map((study) => study.sourceKey);
  await session.activePage().locator('.ns-table__text').first().evaluate((node) => { node.textContent = '01/01/99'; });
  const repeated = await session.listStudies();
  assert.deepEqual(repeated?.studies.map((study) => study.sourceKey), sourceKeys);
  assert.equal(repeated?.studies[0].studyDate, '2099-01-01');
});

test('Centro DM deja studyDate indefinida si no puede asociar fechas por fila ni por conteos', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/partial-parallel-dates',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/partial-parallel-dates$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const result = await session.listStudies();
  assert.equal(result?.studies.length, 3);
  assert.ok(result?.studies.every((study) => study.studyDate === undefined));
  assert.ok(result?.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')));
});

test('Centro DM crea tres estudios mínimos por href aunque no pueda asociarlos a filas', { timeout: 60_000 }, async () => {
  const provider = {
    ...centroDm,
    loginUrl: origin + '/no-rows',
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    requireHttps: false,
    loginPathPattern: /\/no-rows$/,
  };
  const session = await BrowserSession.open(host, provider, true, undefined, true);
  sessions.push(session);
  await session.gotoLogin();
  const events: { event: string; count?: number }[] = [];
  session.onProviderStructure = (event) => events.push(event);
  const result = await session.listStudies();
  assert.ok(result);
  assert.equal(result.studies.length, 3);
  assert.ok(result.studies.every((study) => study.title === 'Estudio de imágenes' && !study.date));
  assert.ok(result.studies.every((study) => /^[a-f0-9]{64}$/.test(study.sourceKey || '')));
  assert.ok(events.some((event) => event.event === 'centrodm_result_actions' && event.count === 3));
  assert.ok(events.some((event) => event.event === 'centrodm_minimal_studies' && event.count === 3));
  assert.ok(events.some((event) => event.event === 'centrodm_metadata_enriched' && event.count === 0));
  assert.ok(events.some((event) => event.event === 'centrodm_metadata_partial' && event.count === 3));

  type InternalReference = { openHref: string; sourceKey: string; targetBlank: boolean };
  const references = (session as unknown as { centroDmStudies: Map<string, InternalReference> }).centroDmStudies;
  for (const [index, study] of result.studies.entries()) {
    const ref = references.get(study.id);
    assert.ok(ref);
    assert.ok(ref.openHref.includes(`accessionnPHP=opaque-${index + 1}`));
    assert.equal(ref.sourceKey, study.sourceKey);
    assert.equal(ref.targetBlank, true);
  }
  const diagnostics = JSON.stringify(events);
  assert.ok(!diagnostics.includes('opaque-'));
  assert.ok(!diagnostics.includes('llamadoURL.php'));
});
