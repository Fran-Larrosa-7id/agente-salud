import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { rdcChacabuco } from '../../src/providers/rdcchacabuco/rdcchacabuco.provider.js';
import { silentLogger } from '../../src/security/logger.js';
import { evaluateLogin } from '../../src/browser/login-detector.js';
import { testConfig, waitFor } from '../helpers.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';

test('RDC: grilla VisualMedica con Sus estudios realizados y Salir avanza automáticamente', { timeout: 20_000 }, async () => {
  const app = express(); app.use(express.urlencoded({ extended: false }));
  const path = '/patientportal/index.php';
  const login = `<h1>Mi Patient Portal</h1><form method="post" action="${path}"><label>Usuario<input name="user"></label><label>Contraseña<input type="password" name="pass"></label><button>Ingresar</button></form>`;
  app.get(path, (req, res) => res.send((req.headers.cookie || '').includes('qa=ok')
    ? '<!doctype html><html><head><title>Mi Patient Portal</title><style>.fa-file{display:inline-block;width:18px;height:18px}</style></head><body><nav><a href="#/home">Home</a><a href="#/help">Ayuda</a><a href="/logout">Salir</a></nav><h5>Sus estudios realizados</h5><label>Buscar<input name="search"></label><table><thead><tr><th>Tipo de Estudio</th><th>Descripción</th><th>Fecha del Estudio</th><th>Acciones</th></tr></thead><tbody><tr><td>ULTRASONIDO</td><td>ESTUDIO QA SINTÉTICO</td><td>01/01/2026</td><td><span>En línea</span><a href="#"><i class="fa fa-file icon-size" aria-hidden="true"></i></a></td></tr></tbody></table><p>Visualizando 1 de 1 registros encontrados</p></body></html>'
    : login));
  app.post(path, (req, res) => {
    if (req.body.user !== 'qa' || req.body.pass !== 'qa') return void res.status(401).send('<p>Contraseña incorrecta</p>' + login);
    res.cookie('qa', 'ok', { httpOnly: true }); res.redirect(path + '#/grilla');
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider = { ...rdcChacabuco, loginUrl: base + path, allowedHosts: ['127.0.0.1'], requireHttps: false };
  const host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: '' });
  let runner!: AgentImportRunner;
  const manager = new JobManager({ config: testConfig({ remoteLogin: true, loginTimeoutMs: 10000 }), providers: { rdcchacabuco: provider }, log: silentLogger,
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 50 })),
  });
  try {
    const job = manager.create('rdcchacabuco'); await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN);
    const session = runner.session!; const page = session.activePage(); const context = page.context();
    await page.fill('[name=user]', 'qa'); await page.fill('[name=pass]', 'incorrecta'); await page.click('button');
    await page.waitForSelector('text=Contraseña incorrecta'); await new Promise(resolve => setTimeout(resolve, 160));
    assert.equal(job.state, S.WAITING_FOR_USER_LOGIN);
    await page.fill('[name=user]', 'qa'); await page.fill('[name=pass]', 'qa'); await page.click('button');
    await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 8000);
    assert.equal(job.state, S.WAITING_SELECTION); assert.equal(page.url(), base + path + '#/grilla');
    assert.equal(session.activePage().context(), context); assert.equal(job.studies.length, 1); assert.equal(job.selection.length, 0);
    assert.equal(job.eventsSince(0).filter(event => event.state === S.AUTHENTICATED).length, 1);
  } finally { await manager.shutdown(); await host.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Centro DM en URL raíz: login inválido, MFA/CAPTCHA humanos y dos lecturas sin Resume', { timeout: 45_000 }, async () => {
  for (const challenge of ['none', 'mfa', 'captcha', 'iframe', 'popup', 'welcome-icons'] as const) {
    const app = express(); app.use(express.urlencoded({ extended: false }));
    const login = '<form method="post" action="/login"><label>Usuario<input name="user"></label><label>Contraseña<input type="password" name="pass"></label><button>Ingresar</button></form>';
    const results = challenge === 'welcome-icons'
      ? '<header><span>Cuenta QA ficticia</span><a href="/logout"><svg aria-hidden="true"></svg></a></header><h1>Bienvenido a tu portal de estudios</h1><div class="ns-table"><div><span>Fecha del estudio</span><span>Estudio</span><span>Modalidad</span></div><div class="row"><span class="ns-table__text">01/01/2026</span><span>QA sintético</span><span>SC</span><button onclick="window.open(\'/funcion/llamadoURL.php?studyId=qa\')"><img alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22%3E%3C/svg%3E"></button></div></div>'
      : '<h1>Mis estudios</h1><a href="/logout">Cerrar sesión</a><table><thead><tr><th>Fecha</th><th>Estudio</th><th>Modalidad</th><th>Acción</th></tr></thead><tbody><tr><td>01/01/2026</td><td>QA sintético</td><td>SC</td><td><a href="/funcion/llamadoURL.php?studyId=qa">Abrir</a></td></tr></tbody></table>';
    app.get('/', (req, res) => res.send((req.headers.cookie || '').includes('qa=ok') ? challenge === 'iframe' ? '<iframe title="Estudios" src="/list"></iframe>' : results : '<h1>Estudios Centro DM</h1>' + login));
    app.get('/list', (req, res) => res.send((req.headers.cookie || '').includes('qa=ok') ? results : login));
    app.post('/login', (req, res) => {
      if (req.body.user !== 'qa' || req.body.pass !== 'qa') return void res.status(401).send('<p>Contraseña incorrecta</p>' + login);
      res.cookie('qa', challenge === 'mfa' || challenge === 'captcha' ? 'pending' : 'ok', { httpOnly: true });
      if (challenge === 'popup') return void res.send('<p>Continuá en la ventana de estudios</p><script>window.open("/list")</script>');
      res.redirect(challenge === 'mfa' || challenge === 'captcha' ? '/challenge' : '/');
    });
    app.get('/challenge', (_req, res) => res.send('<h1>Verificación de seguridad ficticia</h1><form method="post" action="/challenge">' +
      (challenge === 'mfa' ? '<label>Código de verificación<input name="code" autocomplete="one-time-code"></label>' : '<label>No soy un robot<input type="checkbox" name="code" value="qa" class="g-recaptcha"></label>') + '<button>Completar paso humano</button></form>'));
    app.post('/challenge', (req, res) => { if (req.body.code !== 'qa') return void res.redirect('/challenge'); res.cookie('qa', 'ok', { httpOnly: true }); res.redirect('/'); });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const provider = { ...centroDm, loginUrl: base + '/', allowedHosts: ['127.0.0.1'], allowedOrigins: [], requireHttps: false };
    const host = new BrowserHost({ headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: '' });
    let runner!: AgentImportRunner;
    const manager = new JobManager({ config: testConfig({ remoteLogin: true, loginTimeoutMs: 15000 }), providers: { centrodm: provider }, log: silentLogger,
      runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 50, humanPollMs: 50 })),
    });
    try {
      const job = manager.create('centrodm'); await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN);
      const session = runner.session!; const page = session.activePage(); const context = page.context();
      const original = session.snapshot.bind(session); let positives = 0;
      session.snapshot = async (hints, candidate) => { const value = await original(hints, candidate); if (evaluateLogin(value, provider).authenticated) positives++; return value; };
      await page.fill('[name=user]', 'qa'); await page.fill('[name=pass]', 'incorrecta'); await page.click('button');
      await page.waitForSelector('text=Contraseña incorrecta'); await new Promise(resolve => setTimeout(resolve, 160));
      assert.equal(job.state, S.WAITING_FOR_USER_LOGIN); assert.equal(positives, 0);
      await page.fill('[name=user]', 'qa'); await page.fill('[name=pass]', 'qa'); await page.click('button');
      if (challenge === 'mfa' || challenge === 'captcha') {
        await page.waitForURL(/challenge/); await new Promise(resolve => setTimeout(resolve, 160));
        assert.equal(job.state, S.WAITING_FOR_USER_LOGIN); assert.equal(positives, 0);
        if (challenge === 'mfa') await page.fill('[name=code]', 'qa'); else await page.check('[name=code]');
        await page.click('button');
      }
      await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 10000);
      assert.equal(job.state, S.WAITING_SELECTION, challenge); assert.ok(positives >= 2);
      assert.equal(session.activePage().url(), base + (challenge === 'popup' ? '/list' : '/')); assert.equal(session.activePage().context(), context);
      assert.equal(job.studies.length, 1); assert.equal(job.selection.length, 0);
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
    } finally { await manager.shutdown(); await host.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
