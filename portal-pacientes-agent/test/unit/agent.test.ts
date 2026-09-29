import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthPortalAgent, type AgentLimits } from '../../src/agent/health-portal-agent.js';
import { FORBIDDEN_LABEL } from '../../src/agent/policies/action-policy.js';
import { SYSTEM_PROMPT } from '../../src/agent/prompts/health-portal-agent.prompt.js';
import { fingerprintOf, signatureOf } from '../../src/agent/studies.js';
import { FORBIDDEN_CAPABILITIES, TOOL_DEFS } from '../../src/agent/tools/definitions.js';
import { validateHumanActionEvidence } from '../../src/agent/tools/validate.js';
import type { AgentAction, AgentModel, AgentObservation } from '../../src/agent/types.js';
import { makeDemoPdf } from '../../src/jobs/pdf.js';
import { RulesModel } from '../../src/llm/rules.js';
import { DomainPolicy } from '../../src/security/domain-policy.js';
import { silentLogger } from '../../src/security/logger.js';
import type { RawCollection } from '../../src/browser/types.js';
import { el, FakePort, snap, testProvider } from '../helpers.js';

const limits: AgentLimits = { maxSteps: 30, maxDurationMs: 10_000, maxDownloads: 10, modelTimeoutMs: 2_000 };

function agent(model: AgentModel, port: FakePort, over: Partial<AgentLimits> = {}, downloads = { used: 0 }) {
  return new HealthPortalAgent({
    jobId: '00000000-0000-4000-8000-000000000000',
    model,
    port,
    provider: testProvider(),
    domains: new DomainPolicy(['127.0.0.1']),
    limits: { ...limits, ...over },
    log: silentLogger,
    downloads,
  });
}

class Scripted implements AgentModel {
  readonly name = 'scripted';
  seen: AgentObservation[] = [];
  constructor(private readonly next: (obs: AgentObservation) => AgentAction) {}
  async decide(obs: AgentObservation) {
    this.seen.push(obs);
    return this.next(obs);
  }
}

const table: RawCollection = {
  id: 'c0-0', frame: 0, kind: 'table',
  headers: ['Fecha', 'Protocolo', 'Estado', ''],
  rows: [['28/05/2026', '00012345', 'Finalizado', 'Ver'], ['14/01/2026', '00009876', 'Finalizado', 'Ver']],
  rowCount: 2,
};
const listPage = () =>
  snap({
    hintHits: ['RESULTADOS ONLINE'],
    collections: [structuredClone(table)],
    elements: [
      el('f0-1', 'Ver', { collection: 'c0-0', row: 0 }),
      el('f0-2', 'Ver', { collection: 'c0-0', row: 1 }),
      el('f0-3', 'Ver en PDF', { collection: 'c0-0', row: 1 }),
      el('f0-4', 'Cambiar contraseña'),
      el('f0-5', 'Cerrar sesión'),
    ],
  });

test('el agente solo tiene herramientas de lectura y navegación acotada', () => {
  const names = TOOL_DEFS.map((t) => t.name as string);
  for (const forbidden of FORBIDDEN_CAPABILITIES) assert.ok(!names.includes(forbidden), forbidden);
  for (const t of TOOL_DEFS) {
    const props = Object.keys(t.input_schema.properties);
    assert.ok(!props.some((p) => /text|value|url|script|code|password|path|command/i.test(p)), `${t.name} acepta ${props}`);
  }
  assert.match(SYSTEM_PROMPT, /Solo lectura/);
  assert.match(SYSTEM_PROMPT, /No evadís CAPTCHA/);
});

test('las acciones de escritura están bloqueadas por política', () => {
  for (const l of ['Cambiar contraseña', 'Pagar', 'Cancelar turno', 'Enviar', 'Guardar', 'Eliminar', 'Cerrar sesión', 'Aceptar términos', 'Grupo familiar']) {
    assert.ok(FORBIDDEN_LABEL.test(l), l);
  }
  for (const l of ['Ver', 'Ver en PDF', 'Descargar', 'Resultados', 'Imprimir informe']) assert.ok(!FORBIDDEN_LABEL.test(l), l);
});

test('DISCOVER_STUDIES con reglas: encuentra el listado y termina sin descargar', async () => {
  const port = new FakePort(listPage());
  const out = await agent(new RulesModel(), port).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.equal(out.kind, 'discovered');
  if (out.kind === 'discovered') assert.equal(out.collectionId, 'c0-0');
  assert.deepEqual(port.clicks, [], 'no hizo clic en nada');
});

test('no se descarga durante la búsqueda aunque el modelo lo intente', async () => {
  const port = new FakePort(listPage(), { buffer: makeDemoPdf(['x']), contentType: 'application/pdf', via: 'download' });
  const model = new Scripted(() => ({ tool: 'downloadFromElement', args: { elementId: 'f0-3' } }));
  const out = await agent(model, port).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.equal(out.kind, 'unable');
  assert.deepEqual(port.clicks, []);
  assert.equal(model.seen[1].history[0].outcome, 'bloqueado');
});

test('en DOWNLOAD_STUDY solo puede tocar la fila del estudio elegido', async () => {
  const target = { studyId: 'st_a', signature: signatureOf(table), fingerprint: fingerprintOf(table.rows[0]) };
  const port = new FakePort(listPage(), { buffer: makeDemoPdf(['x']), contentType: 'application/pdf', via: 'download' });
  // Intenta descargar el PDF de OTRA fila (la 1): bloqueado.
  const model = new Scripted(() => ({ tool: 'downloadFromElement', args: { elementId: 'f0-3' } }));
  const out = await agent(model, port).run({ kind: 'DOWNLOAD_STUDY', target }, new AbortController().signal);
  assert.equal(out.kind, 'unable');
  assert.deepEqual(port.clicks, []);
  const first = model.seen[0];
  assert.equal(first.elements.find((e) => e.id === 'f0-1')?.target, true);
  assert.equal(first.elements.find((e) => e.id === 'f0-3')?.blocked, 'otro estudio');
  assert.equal(first.elements.find((e) => e.id === 'f0-4')?.blocked, 'acción de escritura o fuera de alcance');
});

test('DOWNLOAD_STUDY: abre el estudio elegido y captura el PDF', async () => {
  const target = { studyId: 'st_a', signature: signatureOf(table), fingerprint: fingerprintOf(table.rows[0]) };
  const page = listPage();
  page.elements.push(el('f0-9', 'Ver en PDF', { collection: 'c0-0', row: 0 }));
  const port = new FakePort(page, { buffer: makeDemoPdf(['x']), contentType: 'application/pdf', via: 'download' });
  const out = await agent(new RulesModel(), port).run({ kind: 'DOWNLOAD_STUDY', target }, new AbortController().signal);
  assert.equal(out.kind, 'downloaded');
  assert.deepEqual(port.clicks, ['f0-9']);
});

test('límites: máximo de pasos, bucles y duración', async () => {
  let n = 0;
  const waits = new Scripted(() => ({ tool: 'wait', args: { seconds: 1 + (n++ % 5) } }));
  const r1 = await agent(waits, new FakePort(listPage()), { maxSteps: 4 }).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.deepEqual(r1, { kind: 'unable', code: 'MAX_STEPS' });

  const same = new Scripted(() => ({ tool: 'scroll', args: { direction: 'down' } }));
  const r2 = await agent(same, new FakePort(listPage())).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.deepEqual(r2, { kind: 'unable', code: 'AGENT_LOOP' });

  const slow = new Scripted(() => ({ tool: 'wait', args: { seconds: Math.ceil(Math.random() * 5) } }));
  const port = new FakePort(listPage());
  port.wait = () => new Promise((r) => setTimeout(r, 30));
  const r3 = await agent(slow, port, { maxDurationMs: 1 }).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.equal(r3.kind, 'unable');

  const bogus = new Scripted(() => ({ tool: 'evaluate' as never, args: { script: 'document.cookie' } }));
  const r4 = await agent(bogus, new FakePort(listPage())).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.deepEqual(r4, { kind: 'unable', code: 'AGENT_STUCK' });
});

test('límite de descargas por job', async () => {
  const target = { studyId: 'st_a', signature: signatureOf(table), fingerprint: fingerprintOf(table.rows[0]) };
  const page = listPage();
  page.elements.push(el('f0-9', 'Ver en PDF', { collection: 'c0-0', row: 0 }));
  const port = new FakePort(page, { buffer: makeDemoPdf(['x']), contentType: 'application/pdf', via: 'download' });
  const out = await agent(new RulesModel(), port, { maxDownloads: 1 }, { used: 1 }).run({ kind: 'DOWNLOAD_STUDY', target }, new AbortController().signal);
  assert.notEqual(out.kind, 'downloaded');
  assert.deepEqual(port.clicks.filter((c) => c === 'f0-9'), []);
});

test('CAPTCHA, código o sesión vencida detienen al agente sin consultar al modelo', async () => {
  for (const [flags, reason] of [[{ captcha: true }, 'captcha'], [{ otp: true }, 'mfa'], [{ hasPasswordField: true }, 'session_expired']] as const) {
    const model = new Scripted(() => ({ tool: 'wait', args: {} }));
    const out = await agent(model, new FakePort(snap(flags))).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
    assert.deepEqual(out, { kind: 'human', reason });
    assert.equal(model.seen.length, 0);
  }
});

test('un pedido de OTP sin evidencia se rechaza y no llega al estado de intervención humana', async () => {
  const model = new Scripted(() => ({ tool: 'requestHumanAction', args: { reason: 'mfa' } }));
  const port = new FakePort(snap());
  const out = await agent(model, port).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.deepEqual(out, { kind: 'unable', code: 'AGENT_STUCK' });
  assert.equal(model.seen.length, 4, 'la decisión se cuenta como inválida/reintentable');
  assert.equal(validateHumanActionEvidence('mfa', port.page), false);
  assert.equal(validateHumanActionEvidence('mfa', snap({ otp: true })), true);
  assert.deepEqual(port.clicks, []);
});

test('un extractor del proveedor devuelve todas las filas con ids opacos y metadata mínima sin consultar al modelo', async () => {
  const port = new FakePort(snap());
  port.providerStudyList = {
    recognized: true,
    listUrl: port.currentUrl(),
    studies: [
      { id: 'b0a9e961-12a8-4cc2-8500-2ab7cf27ad31', date: '2026-05-28', status: 'Finalizado' },
      { id: 'a972d49e-794c-49b0-8644-7cfc60c9b4f5', date: '2026-01-14', deliveryDate: '2026-01-16' },
    ],
  };
  const model = new Scripted(() => { throw new Error('el extractor no debe necesitar una inferencia'); });
  const out = await agent(model, port).run({ kind: 'DISCOVER_STUDIES' }, new AbortController().signal);
  assert.equal(out.kind, 'discovered');
  assert.equal(out.kind === 'discovered' ? out.studies?.length : 0, 2);
  assert.equal(model.seen.length, 0);
  assert.ok(out.kind === 'discovered' && out.studies?.every((s) => !('protocol' in s)));
});

test('cancelar corta el ciclo', async () => {
  const ac = new AbortController();
  ac.abort();
  const out = await agent(new RulesModel(), new FakePort(listPage())).run({ kind: 'DISCOVER_STUDIES' }, ac.signal);
  assert.deepEqual(out, { kind: 'aborted' });
});
