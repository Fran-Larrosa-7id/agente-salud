import type { AddressInfo } from 'node:net';
import express from 'express';
import { makeDemoPdf } from '../../src/jobs/pdf.js';

/**
 * Portal de laboratorio FALSO (estilo LabWin) para tests. Nunca se prueba contra el portal real en CI.
 * Tres estudios, cada uno entrega el PDF de una forma distinta:
 *  1001 → descarga (Content-Disposition: attachment)
 *  1002 → pestaña nueva con el PDF inline
 *  1003 → visor con <embed> del PDF
 */
export const FAKE_USER = { usuario: '30111222', pass: 'S3cret-pass' };

export async function startFakePortal() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const extendedPdf = makeDemoPdf(['Informe de prueba', 'PDF fixture adicional']);
  const extendedPdfBase64 = extendedPdf.toString('base64');
  const SID = 'sid=ok';
  const authed = (req: express.Request) => (req.headers.cookie || '').includes(SID);
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

  const loginPaths = ['/lwcloud/fake/login', '/lwcloud/percamb/login'];
  app.get(loginPaths, (req, res) => {
    const mode = ['mismatch', 'verify', 'legacy-results', 'alert'].includes(String(req.query.mode)) ? `<input type="hidden" name="mode" value="${req.query.mode}">` : '';
    const passwordType = req.query.visible === '1' ? 'text' : 'password';
    res.send(page('Iniciar Sesión | LW Cloud', `<form name="form1" method="post" action="${req.path}">
      <input type="hidden" value="1" name="enviar">${mode}
      <label for="usuario">USUARIO/DNI:</label><input type="text" name="usuario" class="col-lg-12 custom-form-control">
      <label for="pass">CONTRASEÑA:</label><input id="password" type="${passwordType}" name="pass" class="col-lg-10 custom-form-control">
      <button type="submit">Entrar</button></form>`));
  });
  app.post(loginPaths, (req, res) => {
    if (req.body.enviar !== '1') return void res.sendStatus(400);
    const ok = req.body.usuario === FAKE_USER.usuario && req.body.pass === FAKE_USER.pass;
    if (!ok && req.body.mode === 'alert') {
      return void res.send(page('Error', '<script>alert("Usuario y/o Password incorrectos. qa-dialog-private-marker")</script>'));
    }
    if (!ok) return void res.status(401).send(page('Error', '<p>Usuario o contraseña incorrectos</p><a href="/lwcloud/fake/login">Volver</a>'));
    if (req.body.mode === 'verify') {
      res.cookie('challenge', 'pending', { httpOnly: true });
      return void res.redirect('/lwcloud/percamb/verificar');
    }
    res.setHeader('set-cookie', SID + '; Path=/; HttpOnly');
    res.redirect(302, req.path === loginPaths[1] ? '/lwcloud/percamb/rol' + (req.body.mode === 'legacy-results' ? '?legacy=1' : '')
      : req.body.mode === 'mismatch' ? '/lwcloud/fake/resultados-mismatch' : '/lwcloud/fake/resultados');
  });
  app.get('/lwcloud/percamb/verificar', (_req, res) => res.send(page('Verificación', `<h1>Verificación de seguridad</h1>
    <form method="post"><label>Código de verificación <input name="code" autocomplete="one-time-code"></label>
    <button type="submit">Verificar</button></form>`)));
  app.post('/lwcloud/percamb/verificar', (req, res) => {
    if (!req.headers.cookie?.includes('challenge=pending') || req.body.code !== '654321') return void res.sendStatus(403);
    res.setHeader('set-cookie', SID + '; Path=/; HttpOnly');
    res.redirect('/lwcloud/percamb/rol');
  });

  app.get('/lwcloud/fake/resultados-div', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    const count = Math.max(0, Math.min(2, Number(req.query.count ?? 2)));
    const rows = [
      ['28/05/2026', '2001', '30/05/2026', 'Finalizado'],
      ['14/01/2026', '2002', '16/01/2026', 'Finalizado'],
    ].slice(0, count);
    const content = rows.map(([date, protocol, delivery, status]) => `<div class="study-row" data-protocol="${protocol}">
      <span data-label="Fecha">${date}</span><span data-label="Protocolo">${protocol}</span>
      <span data-label="Fecha entrega">${delivery}</span><span data-label="Estado">${status}</span>
      <span data-label="Fecha de nacimiento">01/01/1980</span>
      <span class="patient-name">PEREZ JUAN</span><span class="patient-document">30111222</span>
      <span class="doctor">Dra. Ejemplo</span><span class="clinical-values">Hemoglobina 13,5 g/dL</span>
      <button type="button" class="row-action" aria-label="Ver estudio" onclick="window.__studyOpens=(window.__studyOpens||0)+1;sessionStorage.setItem('studyOpens',window.__studyOpens);location.href='/lwcloud/fake/protocolo/${protocol}'">
        <svg class="icon-eye" aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path></svg>
      </button></div>`).join('');
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1><p>La cuenta puede usar un segundo factor cuando corresponda.</p>
      <form class="search-filters"><label>Fecha: <input type="text" name="fechaDesde" placeholder="Desde/Fecha exacta"></label>
      <label>Protocolo: <input type="text" name="codigo" placeholder="Protocolo"></label>
      <label>Paciente: <input type="text" name="paciente" placeholder="Nombre"></label>
      <label>Documento: <input type="text" name="documento" placeholder="Documento"></label></form>
      <div class="study-list">${content || '<p class="empty">No se encontraron estudios.</p>'}</div></main>`));
  });

  app.get('/lwcloud/fake/resultados-links', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    const count = Math.max(0, Math.min(2, Number(req.query.count ?? 2)));
    const rows = [
      `<div class="result-tile"><span data-label="Fecha">28/05/2026</span><span data-label="Entrega">30/05/2026</span><span data-label="Estado">Finalizado</span><a href="/lwcloud/fake/ver_resultado/4001">Abrir resultado</a></div>`,
      `<div class="result-tile"><a href="/lwcloud/fake/ver_resultado/4002" aria-label=""><svg class="unrecognized-control" viewBox="0 0 24 24"></svg></a></div>`,
    ].slice(0, count);
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1><div class="results-grid">${rows.join('')}</div></main>`));
  });

  app.get('/lwcloud/fake/ver_resultado/:id', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    res.send(page('Resultado', `<main><h1>Resultado ${req.params.id}</h1><p>Detalle de demostración</p></main>`));
  });

  app.get('/lwcloud/fake/resultados-columnas', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    const headers = ['Fecha', 'Hora recepción', 'Protocolo', 'Médico', 'Apellido y nombre', 'Documento', 'Entrega', 'Diagnóstico', 'Estado'];
    const results = [
      ['07/04/2025', '08/04/2025<br>09:30', '8-70001', 'Profesional de prueba', 'Paciente de prueba', '11122333', '12/04/2025', '', 'Completo'],
      ['23/06/2025', '24/06/2025<br>10:45', '8-70002', 'Profesional de prueba', 'Paciente de prueba', '11122333', '26/06/2025', '', 'Completo'],
    ];
    const openResult = (i: number) => `<div><div><a href="/lwcloud/fake/ver_resultado/${5001 + i}" aria-label="Ver resultado"><svg class="icon-eye" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5"/></svg></a></div></div>`;
    if (req.query.layout === 'bootstrap') {
      const widths = [1, 1, 1, 2, 2, 1, 1, 1, 2];
      const mobileWidths = [4, 4, 4, 3, 4, 3, 3, 3, 5];
      const heading = headers.map((label, i) => `<div class="col-lg-${widths[i]}"><p>${label}</p></div>`).join('');
      const rows = results.map((result, rowIndex) => {
        const cells = result.map((value, i) => {
          const responsive = [0, 5, 6, 7].includes(i) ? ' hidden-xs hidden-sm' : '';
          const action = i === 8 ? `<div class="pull-right">${openResult(rowIndex)}</div>` : '';
          return `<div class="col-lg-${widths[i]} col-xs-${mobileWidths[i]} word-break${responsive} ng-binding">${value}${action}</div>`;
        }).join('');
        return `<div class="col-lg-12 col-xs-12 custom-form-control no-padding ng-scope" ng-repeat="derivacion in getDerivaciones() | orderBy:orden">
          <div class="col-lg-12 no-padding">${cells}</div><!-- ngIf -->
        </div>`;
      }).join('');
      res.send(page('Resultados', `<style>@media (max-width: 767px) { .hidden-xs { display: none } }</style><main><h1>RESULTADOS ONLINE</h1><section>
        <div class="col-lg-12 table-header hidden-xs hidden-sm hidden-md no-padding">${heading}</div>
        <p class="pull-right"><label><input type="checkbox"> No leídos</label></p>
        ${rows}</section></main>`));
      return;
    }
    const head = `<thead><tr><th colspan="10">Resultados</th></tr><tr>${headers.map((value) => `<th>${value}</th>`).join('')}</tr>
      <tr><td colspan="10"><label><input type="checkbox"> No leídos</label></td></tr></thead>`;
    const body = `<tbody>${results.map((result, i) => `<tr>${result.map((value) => `<td>${value}</td>`).join('')}<td>${openResult(i)}</td></tr>`).join('')}</tbody>`;
    const grid = req.query.layout === 'div'
      ? `<div class="results-grid" style="display:grid;gap:4px">
          <div><div class="row" style="display:flex;gap:4px">${headers.map((value) => `<div>${value}</div>`).join('')}</div></div>
          <div><label><input type="checkbox"> No leídos</label></div>
          <div>${results.map((result, i) => `<div class="row" style="display:flex;gap:4px">${result.map((value) => `<div>${value}</div>`).join('')}<div>${openResult(i)}</div></div>`).join('')}</div>
        </div>`
      : req.query.layout === 'split-table'
        ? `<section><div><table>${head}</table></div><div><table>${body}</table></div></section>`
        : `<table>${head}${body}</table>`;
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1>${grid}</main>`));
  });

  app.get('/lwcloud/fake/resultados-mismatch', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    const rows = [0, 1].map((i) => `<div class="study-row"><span>Disponible</span>
      <button type="button" class="row-action" aria-label="Ver estudio" onclick="window.__studyOpens=(window.__studyOpens||0)+1">
        <svg class="icon-eye" aria-hidden="true" viewBox="0 0 24 24"></svg>
      </button></div>`).join('');
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1><div class="study-list">${rows}</div></main>`));
  });

  app.get('/lwcloud/fake/resultados-reference-mismatch', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1><div class="study-list">
      <div class="study-row"><span data-label="Fecha">28/05/2026</span><span data-label="Protocolo">9991</span>
      <button type="button" class="row-action" aria-label="Ver estudio" onclick="location.href='/lwcloud/fake/protocolo/9992'"><svg class="icon-eye"></svg></button></div>
    </div></main>`));
  });

  app.get('/lwcloud/fake/otp', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    res.send(page('Verificación', `<main><h1>Verificación de seguridad</h1><p>Ingresá el código de verificación enviado a tu teléfono.</p>
      <label>Código de verificación <input type="text" autocomplete="one-time-code" name="verification"></label></main>`));
  });

  app.get(['/lwcloud/fake/resultados', '/lwcloud/percamb/rol'], (req, res) => {
    if (!authed(req)) return void res.redirect(req.path === '/lwcloud/percamb/rol' ? loginPaths[1] : loginPaths[0]);
    const rows = [
      ['28/05/2026', '1001', '30/05/2026', 'Finalizado'],
      ['14/01/2026', '1002', '16/01/2026', 'Finalizado'],
      ['03/11/2025', '1003', '05/11/2025', 'Finalizado'],
    ];
    if (req.query.extended === '1') rows.push(
      ['01/05/2025', '1005', '02/05/2025', 'Finalizado'],
      ['01/04/2025', '1006', '02/04/2025', 'Finalizado'],
      ['01/03/2025', '1007', '02/03/2025', 'Finalizado'],
      ['01/02/2025', '1008', '02/02/2025', 'Finalizado'],
      ['01/06/2025', '1009', '02/06/2025', 'Finalizado'],
      ['01/07/2025', '1010', '02/07/2025', 'Finalizado'],
      ['01/08/2025', '1011', '02/08/2025', 'Finalizado'],
      ['01/09/2025', '1012', '02/09/2025', 'Finalizado'],
      ['01/10/2025', '1013', '02/10/2025', 'Finalizado'],
      ['01/11/2025', '1014', '02/11/2025', 'Finalizado'],
    );
    res.send(page('Resultados', `<header>${req.query.legacy === '1' ? '' : '<h1>RESULTADOS ONLINE</h1>'}<p>Paciente: PEREZ JUAN · DNI 30111222</p>
      <nav><a href="/lwcloud/fake/cambiar-clave">Cambiar contraseña</a> <a href="https://externo.example.com/">Nuestro sitio</a> <a href="/lwcloud/fake/login">Cerrar sesión</a></nav></header>
      ${req.query.legacy === '1' ? '<form><input name="codigo" placeholder="Protocolo" autocomplete="one-time-code"><input name="paciente" placeholder="Nombre" autocomplete="one-time-code"><input name="documento" placeholder="Documento" autocomplete="one-time-code"></form>' : ''}
      <table><thead><tr><th>Fecha</th><th>Protocolo</th><th>Fecha entrega</th><th>Estado</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}<td><a href="/lwcloud/fake/protocolo/${r[1]}">Ver</a></td></tr>`).join('')}
      </tbody></table>`));
  });

  app.get('/lwcloud/fake/protocolo/:id', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    const id = req.params.id;
    const dates: Record<string, string> = {
      '1001': '28/05/2026', '1002': '14/01/2026', '1003': '03/11/2025',
      '1005': '01/05/2025', '1006': '01/04/2025', '1007': '01/03/2025', '1008': '01/02/2025',
      '1009': '01/06/2025', '1010': '01/07/2025', '1011': '01/08/2025', '1012': '01/09/2025',
      '1013': '01/10/2025', '1014': '01/11/2025', '2001': '28/05/2026', '2002': '14/01/2026', '9992': '28/05/2026',
    };
    const action =
      id === '1001'
        ? `<a href="/lwcloud/fake/pdf/${id}?dl=1">Ver en PDF</a>`
        : id === '1002'
          ? `<a href="/lwcloud/fake/pdf/${id}" target="_blank">Ver en PDF</a>`
          : id === '1005'
              ? `<button type="button" onclick="const p=window.open('about:blank');setTimeout(()=>p.location.href='/lwcloud/fake/pdf/${id}',100)">Ver en PDF</button>`
              : id === '1006'
                ? `<button type="button" onclick="const f=document.createElement('iframe');f.src='data:application/pdf;base64,${extendedPdfBase64}';f.title='PDF';document.body.appendChild(f)">Ver en PDF</button>`
                : id === '1007'
                  ? `<button type="button" onclick="window.open('https://outside.example.com/file.pdf')">Ver en PDF</button>`
                  : id === '1008'
                    ? `<a href="/lwcloud/fake/pdf-bad" target="_blank">Ver en PDF</a>`
                    : id === '1009'
                      ? `<a href="/lwcloud/fake/pdf-redirect/${id}">Ver en PDF</a>`
                      : id === '1010'
                        ? `<button type="button">Ver en PDF</button>`
                        : id === '1011'
                          ? `<a href="/lwcloud/fake/pdf-redirect-external" target="_blank">Ver en PDF</a>`
                          : id === '1012'
                            ? ''
                            : id === '1013'
                              ? `<a href="/lwcloud/fake/pdf-mime-mismatch">Ver en PDF</a>`
                              : id === '1014'
                                ? `<button type="button" onclick="location.href='/lwcloud/fake/pdf/${id}?dl=1'">Ver en PDF</button>`
          : `<button type="button" onclick="location.href='/lwcloud/fake/visor/${id}'">Ver en PDF</button>`;
    res.send(page('Protocolo', `<h1>Protocolo ${id}</h1><dl><dt>Fecha</dt><dd>${dates[id] || ''}</dd><dt>Protocolo</dt><dd>${id}</dd></dl>
      <p>Paciente: PEREZ JUAN</p><p>Hemoglobina 13,5 g/dL</p>${action} <a href="/lwcloud/fake/resultados">Volver</a>`));
  });

  app.get('/lwcloud/fake/visor/:id', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
    res.send(page('Visor', `<h1>Informe</h1><embed src="/lwcloud/fake/pdf/${req.params.id}" type="application/pdf" width="600" height="800">`));
  });

  app.get('/lwcloud/fake/pdf/:id', (req, res) => {
    if (!authed(req)) return void res.status(403).send('no');
    res.setHeader('content-type', 'application/pdf');
    if (req.query.dl) res.setHeader('content-disposition', `attachment; filename="protocolo.pdf"`);
    res.send(makeDemoPdf(['Informe de prueba', 'Protocolo ' + req.params.id]));
  });

  app.get('/lwcloud/fake/pdf-redirect/:id', (req, res) => {
    if (!authed(req)) return void res.status(403).send('no');
    res.redirect(302, `/lwcloud/fake/pdf/${req.params.id}`);
  });

  app.get('/lwcloud/fake/pdf-redirect-external', (req, res) => {
    if (!authed(req)) return void res.status(403).send('no');
    res.redirect(302, 'https://outside.example.com/file.pdf');
  });

  app.get('/lwcloud/fake/pdf-mime-mismatch', (req, res) => {
    if (!authed(req)) return void res.status(403).send('no');
    res.setHeader('content-type', 'text/html');
    res.send(makeDemoPdf(['PDF válido con MIME inesperado']));
  });

  app.get('/lwcloud/fake/pdf-bad', (req, res) => {
    if (!authed(req)) return void res.status(403).send('no');
    res.setHeader('content-type', 'application/pdf');
    res.send('<html>not a pdf</html>');
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}
