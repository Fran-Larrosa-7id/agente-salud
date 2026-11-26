import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { AGENT_ROOT } from '../../src/config.js';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { rdcChacabuco } from '../../src/providers/rdcchacabuco/rdcchacabuco.provider.js';
import { silentLogger } from '../../src/security/logger.js';
import { createApp } from '../../src/server/app.js';
import { evaluateLogin } from '../../src/browser/login-detector.js';
import { testConfig, waitFor } from '../helpers.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';

test('RDC: consentimiento, formulario VisualMedica, error de credenciales, MFA y descubrimiento en #/grilla', { timeout: 35_000 }, async () => {
  const app = express(); app.use(express.urlencoded({ extended: false }));
  const path = '/patientportal/index.php';
  const action = path + '/usuarios/control';
  const posts: { terms: boolean; untouched: boolean; ingresó: boolean }[] = [];
  const login = `<h1>Mi Patient Portal</h1>
    <form id="login" method="POST" action="${action}">
      <input id="email" type="mail" required placeholder="E-mail o DNI">
      <input id="passL" type="txt" required placeholder="Contraseña o NUMERO DE ACCESO">
      <input id="emailL" type="mail" name="emailL" style="display:none">
      <input id="passwordEncrypt" type="password" name="passL" style="display:none">
      <label><input id="accept_terms_conditions" type="checkbox" name="accept_terms_conditions"> Acepto los términos</label>
      <p id="error" style="display:none">Debes aceptar los Términos y Condiciones para ingresar al sistema</p>
      <input type="hidden" name="untouched">
      <input type="submit" name="entered" value="Ingresar">
      <button type="button" onclick="location.href='/registro'">Registro</button>
    </form>
    <script>document.querySelector('#login').addEventListener('submit', function (event) {
      if (!this.querySelector('#accept_terms_conditions').checked) {
        event.preventDefault(); this.querySelector('#error').style.display = 'block'; return;
      }
      const email = this.querySelector('#emailL'), password = this.querySelector('#passwordEncrypt');
      this.elements.untouched.value = !email.value && !password.value ? '1' : '0';
      email.value = this.querySelector('#email').value;
      password.value = 'qa-processed:' + this.querySelector('#passL').value;
    });</script>`;
  let registrations = 0;
  app.get('/registro', (_req, res) => { registrations++; res.sendStatus(400); });
  app.get(path, (req, res) => res.send((req.headers.cookie || '').includes('qa=ok')
    ? '<!doctype html><html><head><title>Mi Patient Portal</title><style>.fa-file{display:inline-block;width:18px;height:18px}</style></head><body><nav><a href="#/home">Home</a><a href="#/help">Ayuda</a><a href="/logout">Salir</a></nav><h5>Sus estudios realizados</h5><label>Buscar<input name="search"></label><table><thead><tr><th>Tipo de Estudio</th><th>Descripción</th><th>Fecha del Estudio</th><th>Acciones</th></tr></thead><tbody><tr><td>ULTRASONIDO</td><td>ESTUDIO QA SINTÉTICO</td><td>01/01/2026</td><td><span>En línea</span><a href="#"><i class="fa fa-file icon-size" aria-hidden="true"></i></a></td></tr></tbody></table><p>Visualizando 1 de 1 registros encontrados</p></body></html>'
    : login));
  app.post(action, (req, res) => {
    posts.push({ terms: req.body.accept_terms_conditions === 'on', untouched: req.body.untouched === '1', ingresó: req.body.entered === 'Ingresar' });
    if (req.body.emailL !== 'qa@example.test' || !['qa-processed:synthetic', 'qa-processed:synthetic-mfa'].includes(req.body.passL)) {
      return void res.send('<p>Contraseña incorrecta</p>' + login);
    }
    if (req.body.passL === 'qa-processed:synthetic-mfa') return void res.redirect('/challenge');
    res.cookie('qa', 'ok', { httpOnly: true }); res.redirect(path + '#/grilla');
  });
  app.get('/challenge', (_req, res) => res.send('<form method="post"><label>Código de verificación<input name="code" autocomplete="one-time-code"></label><button>Verificar</button></form>'));
  app.post('/challenge', (req, res) => {
    if (req.body.code !== 'qa') return void res.sendStatus(403);
    res.cookie('qa', 'ok', { httpOnly: true }); res.redirect(path + '#/grilla');
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider = { ...rdcChacabuco, loginUrl: base + path, allowedHosts: ['127.0.0.1'], requireHttps: false };
  const host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: '' });
  const config = testConfig({
    portalDir: resolve(AGENT_ROOT, '../portal-pacientes'), portalAuth: { username: '1234', password: '1234' },
    remoteLogin: true, loginTimeoutMs: 12_000,
  });
  const providers = { rdcchacabuco: provider };
  const manager = new JobManager({ config, providers, log: silentLogger,
    runnerFactory: (job, deps) => new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 50 }),
  });
  const portal = createApp({ config, manager, providers, info: { runner: 'agent', model: 'rules', modelReady: true } }).listen(0, '127.0.0.1');
  await new Promise(resolve => portal.once('listening', resolve));
  const portalUrl = 'http://127.0.0.1:' + (portal.address() as AddressInfo).port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: testBrowserChannel });
    const client = await browser.newPage();
    await client.goto(portalUrl + '/#/login');
    await client.click('#login-form [type=submit]');
    await client.waitForSelector('.home-head');
    await client.goto(portalUrl + '/#/traer?inst=rdc');
    const connect = client.getByRole('button', { name: 'Conectar y buscar estudios' });
    const credentials = { username: 'qa@example.test', password: 'synthetic', consent: true };
    const fill = async (password: string) => {
      await client.getByLabel('E-mail o DNI').fill(credentials.username);
      await client.getByLabel('Contraseña o número de acceso').fill(password);
      await client.locator('#lab-consent').check();
    };
    await fill('incorrecta');
    const terms = client.locator('#lab-terms');
    assert.equal(await terms.isChecked(), false);
    assert.equal(await client.getByRole('link', { name: 'términos y condiciones' }).getAttribute('href'), provider.loginForm!.termsUrl);
    await connect.click();
    assert.equal(manager.activeCount(), 0);
    const start = (providerTermsAccepted: unknown, password = credentials.password) => client.request.post(portalUrl + '/api/imports/rdcchacabuco', {
      headers: { Origin: portalUrl }, data: { credentials: { ...credentials, password, providerTermsAccepted } },
    });
    for (const consent of [undefined, false, 'true']) {
      const denied = await start(consent);
      assert.equal(denied.status(), 400);
      assert.deepEqual(await denied.json(), { error: 'LAB_TERMS_REQUIRED' });
    }
    assert.equal(posts.length, 0);
    await terms.check();
    await connect.click();
    await client.getByRole('heading', { name: 'El laboratorio rechazó los datos de acceso' }).waitFor();
    await waitFor(() => manager.activeCount() === 0);
    assert.equal(posts.length, 1);
    await client.getByRole('button', { name: 'Volver a intentar' }).click();
    await fill(credentials.password);
    assert.equal(await terms.isChecked(), false);
    await terms.check();
    await connect.click();
    await client.waitForSelector('.res-list');
    const [job] = manager.activeJobs();
    const worker = manager.remotePage(job.id)!;
    assert.equal(job.state, S.WAITING_SELECTION);
    assert.equal(worker.url(), base + path + '#/grilla');
    assert.equal(client.context().pages().length, 1);
    assert.equal(job.studies.length, 1);
    assert.equal(job.selection.length, 0);
    assert.ok(job.eventsSince(0).every(event => event.type !== 'human_action_required'));
    await manager.cancel(job.id);
    await waitFor(() => manager.activeCount() === 0);

    const started = await start(true, 'synthetic-mfa');
    assert.equal(started.status(), 201);
    const { jobId } = await started.json();
    const challenged = manager.get(jobId)!;
    await waitFor(() => challenged.state === S.HUMAN_ACTION_REQUIRED || challenged.isTerminal);
    assert.equal(challenged.state, S.HUMAN_ACTION_REQUIRED);
    assert.equal(challenged.human, 'mfa');
    const challengedPage = manager.remotePage(jobId)!;
    const context = challengedPage.context();
    await client.goto(portalUrl + '/?qa=mfa#/traer?inst=rdc&job=' + jobId);
    await client.getByRole('link', { name: 'Abrir navegador seguro' }).waitFor();
    await challengedPage.getByLabel('Código de verificación').fill('qa');
    await challengedPage.getByRole('button', { name: 'Verificar' }).click();
    await client.waitForSelector('.res-list');
    assert.equal(manager.remotePage(jobId)?.context(), context);
    assert.equal(challenged.studies.length, 1);
    assert.equal(registrations, 0);
    assert.deepEqual(posts, Array.from({ length: 3 }, () => ({ terms: true, untouched: true, ingresó: true })));
  } finally {
    await browser?.close(); await manager.shutdown(); await host.close();
    await Promise.all([portal, server].map(instance => new Promise<void>(resolve => instance.close(() => resolve()))));
  }
});

test('Centro DM: menú, formulario directo o en iframe, rechazo y fallback antes del descubrimiento', { timeout: 60_000 }, async () => {
  for (const challenge of ['menu', 'menu-iframe', 'direct', 'login-iframe', 'invalid', 'missing', 'mfa', 'captcha', 'iframe', 'popup', 'welcome-icons'] as const) {
    const app = express(); app.use(express.urlencoded({ extended: false }));
    const username = '00042', password = 'qa-synthetic-password';
    const login = '<form method="POST" action="indexp.php" class="ns-login-box"><h1 class="ns-login-box__title">Acceso pacientes</h1>' +
      '<input type="number" placeholder="Nº Documento" name="username" class="ns-login-box__input">' +
      '<input type="password" placeholder="Contraseña" name="password" class="ns-login-box__input"><input type="submit" value="Ingresar"></form>';
    const menu = '<a href="indexp.php" class="ns-main-menu__button">Portal Paciente</a>' +
      '<a href="indexm.php" class="ns-main-menu__button">Portal Médico</a>' +
      '<a href="indexe.php" class="ns-main-menu__button">Portal Empresa</a>';
    const startsAtMenu = challenge === 'menu' || challenge === 'menu-iframe';
    let patientVisits = 0, submissions = 0, otherPortalVisits = 0;
    let releaseForm!: () => void;
    const formReady = new Promise<void>(resolve => { releaseForm = resolve; });
    const results = challenge === 'welcome-icons'
      ? '<header><span>Cuenta QA ficticia</span><a href="/logout"><svg aria-hidden="true"></svg></a></header><h1>Bienvenido a tu portal de estudios</h1><div class="ns-table"><div><span>Fecha del estudio</span><span>Estudio</span><span>Modalidad</span></div><div class="row"><span class="ns-table__text">01/01/2026</span><span>QA sintético</span><span>SC</span><button onclick="window.open(\'/funcion/llamadoURL.php?studyId=qa\')"><img alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22%3E%3C/svg%3E"></button></div></div>'
      : '<h1>Mis estudios</h1><a href="/logout">Cerrar sesión</a><table><thead><tr><th>Fecha</th><th>Estudio</th><th>Modalidad</th><th>Acción</th></tr></thead><tbody><tr><td>01/01/2026</td><td>QA sintético</td><td>SC</td><td><a href="/funcion/llamadoURL.php?studyId=qa">Abrir</a></td></tr></tbody></table>';
    app.get('/', (req, res) => {
      if (req.headers.cookie?.includes('qa=ok')) return res.send(challenge === 'iframe' ? '<iframe title="Estudios" src="/list"></iframe>' : results);
      if (challenge === 'menu') return res.cookie('menu', 'initialized').send(menu);
      if (challenge === 'menu-iframe') return res.send('<iframe title="Menú" src="/index.php"></iframe>');
      if (challenge === 'login-iframe') return res.send('<iframe title="Acceso pacientes" src="/indexp.php"></iframe>');
      if (challenge === 'missing') return res.send('<a href="indexp.php">Portal Médico</a>');
      return res.send(login);
    });
    app.get('/index.php', (_req, res) => res.cookie('menu', 'initialized').send(menu));
    app.get(['/indexm.php', '/indexe.php'], (_req, res) => { otherPortalVisits++; res.sendStatus(404); });
    app.get('/indexp.php', async (req, res) => {
      patientVisits++;
      if (startsAtMenu && !req.headers.cookie?.includes('menu=initialized')) return res.sendStatus(403);
      if (challenge === 'menu-iframe') await formReady;
      return res.send(login);
    });
    app.get('/list', (req, res) => res.send((req.headers.cookie || '').includes('qa=ok') ? results : login));
    app.post('/indexp.php', (req, res) => {
      submissions++;
      if (req.body.username !== username || req.body.password !== password) return void res.send('<p role="alert">Contraseña incorrecta</p>' + login);
      res.cookie('qa', challenge === 'mfa' || challenge === 'captcha' ? 'pending' : 'ok', { httpOnly: true });
      if (challenge === 'popup') return void res.send('<p>Continuá en la ventana de estudios</p><script>window.open("/list")</script>');
      res.redirect(challenge === 'mfa' || challenge === 'captcha' ? '/challenge' : '/');
    });
    app.get('/challenge', (_req, res) => res.send('<h1>Verificación de seguridad ficticia</h1><form method="post" action="/challenge">' +
      (challenge === 'mfa' ? '<label>Código de verificación<input name="code" autocomplete="one-time-code"></label>' : '<label>No soy un robot<input type="checkbox" name="code" value="qa" class="g-recaptcha"></label>') + '<button>Completar paso humano</button></form>'));
    app.post('/challenge', (req, res) => { if (req.body.code !== 'qa') return void res.redirect('/challenge'); res.cookie('qa', 'ok', { httpOnly: true }); res.redirect('/'); });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const provider = {
      ...centroDm, loginUrl: base + (challenge === 'direct' ? '/indexp.php' : '/'), allowedHosts: ['127.0.0.1'], allowedOrigins: [], requireHttps: false,
      ...(challenge === 'missing' ? { loginForm: { ...centroDm.loginForm!, readyTimeoutMs: 600 } } : {}),
    };
    const host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: '' });
    let runner!: AgentImportRunner;
    const manager = new JobManager({ config: testConfig({ remoteLogin: true, loginTimeoutMs: 15000 }), providers: { centrodm: provider }, log: silentLogger,
      runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 50, humanPollMs: 50 })),
    });
    try {
      const job = manager.create('centrodm', 'pilot', 'desktop', { username, password: challenge === 'invalid' ? 'incorrect-synthetic-password' : password });
      await waitFor(() => !!runner.session);
      const session = runner.session!; const page = session.activePage(); const context = page.context();
      const original = session.snapshot.bind(session); let positives = 0;
      session.snapshot = async (hints, candidate) => { const value = await original(hints, candidate); if (evaluateLogin(value, provider).authenticated) positives++; return value; };
      if (challenge === 'menu-iframe') {
        await waitFor(() => patientVisits === 1);
        assert.equal(job.state, S.SIGNING_IN);
        releaseForm();
      }
      if (challenge === 'missing') {
        await waitFor(() => job.state === S.HUMAN_ACTION_REQUIRED);
        assert.equal(patientVisits, 0, 'the label must identify the patient entry');
        assert.equal(submissions, 0);
        assert.equal(session.activePage().context(), context);
        continue;
      }
      if (challenge === 'invalid') {
        await waitFor(() => job.isTerminal);
        assert.equal(job.errorCode, 'INVALID_LAB_CREDENTIALS');
        assert.equal(submissions, 1);
        assert.ok(job.eventsSince(0).every(event => event.type !== 'human_action_required'));
        await waitFor(() => manager.activeCount() === 0);
        const retry = manager.create('centrodm', 'pilot', 'desktop', { username, password });
        await waitFor(() => retry.state === S.WAITING_SELECTION);
        assert.equal(retry.studies.length, 1);
        continue;
      }
      if (challenge === 'mfa' || challenge === 'captcha') {
        await page.waitForURL(/challenge/);
        await waitFor(() => job.state === S.HUMAN_ACTION_REQUIRED || job.isTerminal);
        assert.equal(job.state, S.HUMAN_ACTION_REQUIRED); assert.equal(job.human, challenge); assert.equal(positives, 0);
        if (challenge === 'mfa') await page.fill('[name=code]', 'qa'); else await page.check('[name=code]');
        await page.click('button');
      }
      await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 10000);
      assert.equal(job.state, S.WAITING_SELECTION, challenge); assert.ok(positives >= 2);
      assert.equal(session.activePage().url(), base + (challenge === 'popup' ? '/list' : '/')); assert.equal(session.activePage().context(), context);
      assert.equal(job.studies.length, 1); assert.equal(job.selection.length, 0);
      assert.equal(submissions, 1, challenge);
      assert.equal(otherPortalVisits, 0, challenge);
      assert.equal(patientVisits, startsAtMenu || challenge === 'direct' || challenge === 'login-iframe' ? 1 : 0, challenge);
      if (challenge !== 'mfa' && challenge !== 'captcha') assert.ok(job.eventsSince(0).every(event => event.type !== 'human_action_required'), challenge);
      if (challenge === 'mfa' || challenge === 'captcha') {
        // Misma rutina usada para desafíos que aparecen cuando el agente ya trabaja.
        job.transition(S.OPENING_STUDY, { studyId: job.studies[0].id });
        await page.goto(base + '/challenge');
        const cleared = (runner as any).handleHuman(session, challenge, null) as Promise<boolean>;
        await waitFor(() => job.state === S.HUMAN_ACTION_REQUIRED);
        await new Promise(resolve => setTimeout(resolve, 160)); assert.equal(job.state, S.HUMAN_ACTION_REQUIRED);
        if (challenge === 'mfa') await page.fill('[name=code]', 'qa'); else await page.check('[name=code]');
        await page.click('button'); assert.equal(await cleared, true);
        await (runner as any).discover(session); assert.equal(job.state, S.WAITING_SELECTION);
      }
    } finally { releaseForm(); await manager.shutdown(); await host.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
