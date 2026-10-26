import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { BrowserHost } from '../../src/browser/browser-host.js';
import { CENTRODM_RESPONSIVE_LOGIN_SOURCE } from '../../src/browser/centrodm-login.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { JobManager } from '../../src/jobs/job-manager.js';
import { JobState as S } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { silentLogger } from '../../src/security/logger.js';
import { testConfig, waitFor } from '../helpers.js';
import { testBrowserChannel, testChromiumSandbox } from '../browser-channel.js';

const results = `<style>@media(max-width:600px){.desktop{display:none}.actions a{display:none}}</style>
<h1 class="desktop">Bienvenido a tu portal de estudios</h1><a class="desktop" href="/logout">Salir</a>
<table><thead><tr><th>Fecha del estudio</th><th>Estudio</th><th class="desktop">Modalidad</th><th>Acciones</th></tr></thead>
<tbody><tr><td>01/01/2026</td><td>Estudio sintético</td><td class="desktop">SC</td><td class="actions"><button>▾</button>
<a href="/funcion/llamadoURL.php?studyId=qa">Abrir</a></td></tr></tbody></table>`;
const hostOptions = { headless: true, channel: testBrowserChannel, chromiumSandbox: testChromiumSandbox, debugArtifacts: false, debugDir: '' };
const gridResults = `<style>@media(max-width:600px){.desktop,.actions a{display:none}}</style>
<h1 class="desktop">Bienvenido a tu portal de estudios</h1><a class="desktop" href="/logout">Salir</a>
<div class="ns-table"><div>Fecha del estudio · Estudio · <span class="desktop">Modalidad</span> · Acciones</div>
<div class="study-row"><span class="ns-table__text">01/01/2026</span><span>Estudio sintético</span><span class="desktop">SC</span>
<div class="actions"><button>▾</button><a href="/funcion/llamadoURL.php?studyId=qa">Abrir</a></div></div></div>`;

for (const [variant, list] of [['table', results], ['ns-table', gridResults]]) test(`Centro DM ${variant}: iframe with collapsed mobile actions reaches study selection without PC click`, { timeout: 20000 }, async () => {
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.get('/', (_req, res) => res.send('<style>body{margin:0}iframe{width:100%;height:700px;border:0}</style><iframe src="/patient"></iframe>'));
  app.get('/patient', (req, res) => res.send((req.headers.cookie || '').includes('qa=ok') ? list : '<form method="post" action="/login"><input name="user"><input name="pass" type="password"><button>Ingresar</button></form>'));
  app.post('/login', (_req, res) => { res.cookie('qa', 'ok', { httpOnly: true }); res.redirect('/patient'); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider = { ...centroDm, loginUrl: base + '/', allowedHosts: ['127.0.0.1'], allowedOrigins: [], requireHttps: false };
  const host = new BrowserHost(hostOptions); let runner!: AgentImportRunner;
  const manager = new JobManager({ config: testConfig({ remoteLogin: true, loginTimeoutMs: 12000 }), providers: { centrodm: provider }, log: silentLogger,
    runnerFactory: (job, deps) => (runner = new AgentImportRunner(job, deps, { host, createModel: () => new RulesModel(), loginPollMs: 50 })),
  });
  try {
    const job = manager.create('centrodm', 'pilot', 'mobile'); await waitFor(() => job.state === S.WAITING_FOR_USER_LOGIN);
    const session = runner.session!, page = session.activePage(), context = page.context();
    const original = session.snapshot.bind(session); let mobilePositives = 0;
    session.snapshot = async (hints, candidate) => {
      const snapshot = await original(hints, candidate);
      if (snapshot.centroDmResponsiveStudyList && page.viewportSize()?.width === 390) mobilePositives++;
      return snapshot;
    };
    const frame = page.frameLocator('iframe');
    await frame.locator('[name=user]').fill('qa'); await frame.locator('[name=pass]').fill('qa'); await frame.locator('button').click();
    await waitFor(() => job.state === S.WAITING_SELECTION || job.isTerminal, 10000);
    assert.equal(job.state, S.WAITING_SELECTION); assert.ok(mobilePositives >= 2);
    assert.equal(job.studies.length, 1); assert.equal(page.context(), context);
    assert.equal(page.viewportSize()?.width, 1180, 'Extraction restores its tested desktop geometry automatically');
  } finally { await manager.shutdown(); await host.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Centro mobile evidence requires a visible dated study row and same-origin study action', async () => {
  const host = new BrowserHost(hostOptions);
  try {
    const context = await host.newContext('responsive'), page = await context.newPage();
    await page.route('http://lab.test/**', route => route.fulfill({ contentType: 'text/html', body: '' })); await page.goto('http://lab.test/');
    for (const [html, expected] of [
      [results, true], [results.replace('<table>', '<table style="display:none">'), false],
      [results.replace('01/01/2026', '31/02/2026'), false], [results.replace('Acciones', 'Información'), false],
      [results.replace('/funcion/llamadoURL.php?studyId=qa', 'https://other.test/funcion/llamadoURL.php?studyId=qa'), false],
      [results.replace('/funcion/llamadoURL.php?studyId=qa', '/help'), false],
      [gridResults, true], [gridResults.replace('01/01/2026', '31/02/2026'), false],
      [gridResults.replace('/funcion/llamadoURL.php?studyId=qa', 'https://other.test/funcion/llamadoURL.php?studyId=qa'), false],
      [gridResults.replace('class="ns-table"', 'class="unrelated"'), false],
      [gridResults.replace('href="/funcion/llamadoURL.php?studyId=qa"', 'onclick="window.open(\'/funcion/llamadoURL.php?studyId=qa\')"'), true],
    ] as const) { await page.setContent(html); assert.equal(await page.evaluate(CENTRODM_RESPONSIVE_LOGIN_SOURCE), expected); }
  } finally { await host.close(); }
});
