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

  app.get('/lwcloud/fake/login', (req, res) => {
    const mode = req.query.mode === 'mismatch' ? '<input type="hidden" name="mode" value="mismatch">' : '';
    res.send(page('Iniciar Sesión | LW Cloud', `<form name="form1" method="post" action="/lwcloud/fake/login">
      <label>USUARIO/DNI: <input type="text" name="usuario"></label>
      <label>CONTRASEÑA: <input type="password" name="pass"></label>${mode}
      <button type="submit">Entrar</button></form>`));
  });
  app.post('/lwcloud/fake/login', (req, res) => {
    const ok = req.body.usuario === FAKE_USER.usuario && req.body.pass === FAKE_USER.pass;
    if (!ok) return void res.status(401).send(page('Error', '<p>Usuario o contraseña incorrectos</p><a href="/lwcloud/fake/login">Volver</a>'));
    res.setHeader('set-cookie', SID + '; Path=/; HttpOnly');
    res.redirect(302, req.body.mode === 'mismatch' ? '/lwcloud/fake/resultados-mismatch' : '/lwcloud/fake/resultados');
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
    res.send(page('Resultados', `<main><h1>RESULTADOS ONLINE</h1><p>La cuenta puede usar un segundo factor cuando corresponda.</p><div class="study-list">${content || '<p class="empty">No se encontraron estudios.</p>'}</div></main>`));
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

  app.get('/lwcloud/fake/resultados', (req, res) => {
    if (!authed(req)) return void res.redirect('/lwcloud/fake/login');
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
    res.send(page('Resultados', `<header><h1>RESULTADOS ONLINE</h1><p>Paciente: PEREZ JUAN · DNI 30111222</p>
      <nav><a href="/lwcloud/fake/cambiar-clave">Cambiar contraseña</a> <a href="https://externo.example.com/">Nuestro sitio</a> <a href="/lwcloud/fake/login">Cerrar sesión</a></nav></header>
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
