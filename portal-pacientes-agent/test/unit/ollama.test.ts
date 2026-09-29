import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthPortalAgent } from '../../src/agent/health-portal-agent.js';
import { SYSTEM_PROMPT } from '../../src/agent/prompts/health-portal-agent.prompt.js';
import { TOOL_DEFS } from '../../src/agent/tools/definitions.js';
import type { AgentObservation } from '../../src/agent/types.js';
import { loadConfig } from '../../src/config.js';
import { InvalidModelOutputError, ModelUnavailableError } from '../../src/llm/errors.js';
import { createModel } from '../../src/llm/index.js';
import { checkOllama, OllamaAgentModel, parseDecision, warmupOllama } from '../../src/llm/ollama.js';
import { DomainPolicy } from '../../src/security/domain-policy.js';
import { silentLogger } from '../../src/security/logger.js';
import { el, FakePort, snap, testProvider } from '../helpers.js';

type Call = { url: string; init: RequestInit | undefined; body: Record<string, unknown> };

/** fetch falso: registra cada llamada y responde con la función dada. */
function mockFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = { url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const chat = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content, ...extra }, done: true }), {
    headers: { 'content-type': 'application/json' },
  });

function model(fetchImpl: typeof fetch, timeoutMs = 2_000) {
  return new OllamaAgentModel({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b', timeoutMs, numCtx: 8192, keepAlive: '30m', fetchImpl });
}

function observation(): AgentObservation {
  const elements = Array.from({ length: 60 }, (_, i) => ({ id: 'f0-' + i, role: 'button', label: 'Botón ' + i }));
  return {
    promptVersion: 'x',
    goal: { kind: 'DISCOVER_STUDIES', instruction: 'Encontrá el listado de estudios.' },
    step: 1,
    maxSteps: 30,
    remainingSeconds: 100,
    page: {
      title: 'Resultados', path: '/lwcloud/percamb/resultados', headings: [], openPages: 1, isPdfViewer: false, pdfEmbeds: 0,
      modalOpen: false, modalText: '', noResultsText: false, captchaSuspected: false, otpSuspected: false, passwordFieldVisible: false,
    },
    elements,
    elementsOmitted: 5,
    collections: [],
    hints: { expectedPdfLabels: ['Ver en PDF'], resultsHints: [], notes: '' },
    history: Array.from({ length: 10 }, (_, i) => ({ step: i, tool: 'wait', outcome: 'ok' as const })),
  };
}

const signal = () => new AbortController().signal;

test('ollama: request a /api/chat local, sin stream, sin thinking, con esquema y el mismo system prompt', async () => {
  const { impl, calls } = mockFetch(() => chat('{"action":"click","elementId":"f0-3"}'));
  const action = await model(impl).decide(observation(), { signal: signal() });
  assert.deepEqual(action, { tool: 'click', args: { elementId: 'f0-3' } });

  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(init?.method, 'POST');
  assert.equal(body.model, 'qwen3:8b');
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal((body.options as { temperature: number }).temperature, 0);
  const format = body.format as { properties: { action: { enum: string[] } }; required: string[] };
  assert.deepEqual(format.properties.action.enum, TOOL_DEFS.map((t) => t.name));
  assert.deepEqual(format.required, ['action']);
  // Sin encabezados de autenticación: no hay claves en este modo.
  assert.equal(JSON.stringify(init?.headers).toLowerCase().includes('authorization'), false);

  const [system, user] = body.messages as { role: string; content: string }[];
  assert.equal(system.role, 'system');
  assert.ok(system.content.startsWith(SYSTEM_PROMPT), 'reutiliza el system prompt del agente');
  for (const t of TOOL_DEFS) assert.ok(system.content.includes('- ' + t.name), `falta ${t.name} en el catálogo`);
  // Observación compacta: 40 elementos, 6 pasos de historial, sin campos vacíos.
  const obs = JSON.parse(user.content.slice(user.content.indexOf('{')));
  assert.equal(obs.elements.length, 40);
  assert.equal(obs.elementsOmitted, 25);
  assert.equal(obs.moreElementsOffset, 40);
  assert.equal(obs.history.length, 6);
  assert.equal('promptVersion' in obs, false);
  assert.equal('captchaSuspected' in obs.page, false);
});

test('ollama: parsing de acciones y validación contra el esquema de la herramienta', () => {
  assert.deepEqual(parseDecision('{"action":"finishGoal","collectionId":"c0-0","columns":{"date":0,"protocol":1}}'), {
    tool: 'finishGoal',
    args: { collectionId: 'c0-0', columns: { date: 0, protocol: 1 } },
  });
  // Razonamiento y cercos de código se ignoran; argumentos de otras herramientas se descartan.
  assert.deepEqual(parseDecision('<think>el paciente se llama…</think>\n```json\n{"action":"goBack","elementId":"f0-1"}\n```'), { tool: 'goBack', args: {} });
  // También acepta los argumentos anidados en "args".
  assert.deepEqual(parseDecision('{"action":"scroll","args":{"direction":"down"}}'), { tool: 'scroll', args: { direction: 'down' } });
  assert.deepEqual(parseDecision('{"action":"wait","seconds":null}'), { tool: 'wait', args: {} });

  const invalid = [
    'Creo que deberíamos hacer click en el botón',
    '{"action":"typeText","elementId":"f0-1"}',
    '{"action":"click"}',
    '{"action":"click","elementId":12}',
    '{"action":"wait","seconds":60}',
    '{"action":"scroll","direction":"left"}',
    '{"action":"requestHumanAction","reason":"password"}',
    '{"action":"finishGoal","columns":{"date":-1}}',
    '[{"action":"goBack"}]',
    '{"elementId":"f0-1"}',
  ];
  for (const text of invalid) assert.throws(() => parseDecision(text), InvalidModelOutputError, text);
});

test('ollama: JSON inválido no ejecuta nada, cuenta como paso y se reintenta', async () => {
  const answers = ['no sé qué hacer', '{"action":"click"}', '{"action":"click","elementId":"f0-1"}', '{"action":"requestHumanAction","reason":"ambiguous"}'];
  const { impl, calls } = mockFetch(() => chat(answers.shift() ?? '{"action":"wait"}'));
  const port = new FakePort(snap({ elements: [el('f0-1', 'Resultados')], modal: true, modalText: 'Confirme si desea continuar' }));
  const agent = new HealthPortalAgent({
    jobId: '00000000-0000-4000-8000-000000000000',
    model: model(impl),
    port,
    provider: testProvider(),
    domains: new DomainPolicy(['127.0.0.1']),
    limits: { maxSteps: 30, maxDurationMs: 10_000, maxDownloads: 10, modelTimeoutMs: 2_000 },
    log: silentLogger,
    downloads: { used: 0 },
  });
  const out = await agent.run({ kind: 'DISCOVER_STUDIES' }, signal());
  assert.deepEqual(out, { kind: 'human', reason: 'ambiguous' });
  assert.deepEqual(port.clicks, ['f0-1'], 'solo se ejecutó la respuesta válida');
  assert.equal(calls.length, 4);
  // El paso 3 ve en el historial que las dos respuestas anteriores fueron inválidas.
  const userMsg = (calls[2].body.messages as { content: string }[])[1].content;
  const third = JSON.parse(userMsg.slice(userMsg.indexOf('{')));
  assert.equal(third.step, 3);
  assert.equal(third.history.filter((h: { note?: string }) => /respuesta inválida|falta elementId/.test(h.note ?? '')).length, 2);
});

test('ollama: respuestas inválidas seguidas terminan en AGENT_STUCK', async () => {
  const { impl } = mockFetch(() => chat('texto libre'));
  const agent = new HealthPortalAgent({
    jobId: '00000000-0000-4000-8000-000000000000',
    model: model(impl),
    port: new FakePort(snap()),
    provider: testProvider(),
    domains: new DomainPolicy(['127.0.0.1']),
    limits: { maxSteps: 30, maxDurationMs: 10_000, maxDownloads: 10, modelTimeoutMs: 2_000 },
    log: silentLogger,
    downloads: { used: 0 },
  });
  assert.deepEqual(await agent.run({ kind: 'DISCOVER_STUDIES' }, signal()), { kind: 'unable', code: 'AGENT_STUCK' });
});

test('ollama: el razonamiento (thinking) nunca se usa', async () => {
  const { impl } = mockFetch(() => chat('{"action":"goBack"}', { thinking: 'El DNI 30111222 de PEREZ JUAN…' }));
  const action = await model(impl).decide(observation(), { signal: signal() });
  assert.deepEqual(action, { tool: 'goBack', args: {} });
  assert.ok(!JSON.stringify(action).includes('PEREZ'));
});

test('ollama: timeout corta la solicitud HTTP', async () => {
  let aborted = false;
  const { impl } = mockFetch(
    (call) =>
      new Promise<Response>((_, reject) => {
        call.init!.signal!.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'TimeoutError'));
        });
      }),
  );
  await assert.rejects(model(impl, 50).decide(observation(), { signal: signal() }), /MODEL_TIMEOUT/);
  assert.ok(aborted, 'la solicitud se abortó (Ollama deja de generar)');
});

test('ollama apagado: MODEL_UNAVAILABLE, sin reintentos ni fallback', async () => {
  const { impl, calls } = mockFetch(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(model(impl).decide(observation(), { signal: signal() }), (e) => e instanceof ModelUnavailableError && e.reason === 'OFFLINE');

  const agent = new HealthPortalAgent({
    jobId: '00000000-0000-4000-8000-000000000000',
    model: model(impl),
    port: new FakePort(snap()),
    provider: testProvider(),
    domains: new DomainPolicy(['127.0.0.1']),
    limits: { maxSteps: 30, maxDurationMs: 10_000, maxDownloads: 10, modelTimeoutMs: 2_000 },
    log: silentLogger,
    downloads: { used: 0 },
  });
  const before = calls.length;
  assert.deepEqual(await agent.run({ kind: 'DISCOVER_STUDIES' }, signal()), { kind: 'unable', code: 'MODEL_UNAVAILABLE' });
  assert.equal(calls.length - before, 1, 'se detiene en el primer intento');
  assert.equal((await checkOllama('http://127.0.0.1:11434', 'qwen3:8b', impl)).status, 'offline');
});

test('modelo inexistente: MODEL_UNAVAILABLE y el health check lo informa', async () => {
  const { impl } = mockFetch((call) =>
    call.url.endsWith('/api/tags')
      ? new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b', model: 'llama3.2:3b' }] }))
      : new Response(JSON.stringify({ error: "model 'qwen3:8b' not found" }), { status: 404 }),
  );
  await assert.rejects(model(impl).decide(observation(), { signal: signal() }), (e) => e instanceof ModelUnavailableError && e.reason === 'MODEL_NOT_FOUND');
  assert.equal((await checkOllama('http://127.0.0.1:11434', 'qwen3:8b', impl)).status, 'model_not_found');

  const ok = mockFetch((call) =>
    call.url.endsWith('/api/tags') ? new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] })) : new Response(JSON.stringify({ version: '0.34.4' })),
  );
  assert.deepEqual(await checkOllama('http://127.0.0.1:11434', 'qwen3:8b', ok.impl), { status: 'ok', version: '0.34.4' });
});

test('warm-up de Ollama hace una inferencia sintética una sola vez y no contiene datos del paciente', async () => {
  const { impl, calls } = mockFetch(() => new Response(JSON.stringify({ message: { content: '{"ready":true}' } })));
  assert.equal(await warmupOllama('http://127.0.0.1:11434', 'qwen3:8b', impl), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(calls[0].body.model, 'qwen3:8b');
  assert.equal(calls[0].body.stream, false);
  assert.equal(JSON.stringify(calls[0].body).includes('paciente'), false);
  assert.equal(JSON.stringify(calls[0].body).includes('PEREZ'), false);
  const failed = mockFetch(() => new Response('', { status: 503 }));
  assert.equal(await warmupOllama('http://127.0.0.1:11434', 'qwen3:8b', failed.impl), false, 'un fallo no debe bloquear el arranque');
});

test('LLM_PROVIDER=ollama: sin claves, sin fallback a cloud y solo host local', async () => {
  const env = {
    LLM_PROVIDER: 'ollama',
    OLLAMA_MODEL: 'qwen3:8b',
    LLM_MODEL: 'claude-sonnet-5',
    ANTHROPIC_API_KEY: 'sk-ant-no-usar',
    OPENAI_API_KEY: 'sk-no-usar',
  };
  const cfg = loadConfig(env, []);
  assert.equal(cfg.llm.provider, 'ollama');
  assert.equal(cfg.llm.model, 'qwen3:8b');
  assert.equal(cfg.llm.apiKey, undefined);
  assert.equal(cfg.llm.baseUrl, 'http://127.0.0.1:11434');
  assert.ok(createModel(cfg.llm) instanceof OllamaAgentModel);

  // Con Ollama apagado, ninguna solicitud sale de la máquina (se espía el fetch global).
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    seen.push(String(url));
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  try {
    await assert.rejects(createModel(cfg.llm).decide(observation(), { signal: signal() }), ModelUnavailableError);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(seen, ['http://127.0.0.1:11434/api/chat']);
  assert.ok(!seen.some((u) => /anthropic|openai/.test(u)));

  assert.throws(() => loadConfig({ ...env, OLLAMA_BASE_URL: 'https://ollama.example.com' }, []), /no es local/);
  assert.equal(loadConfig({ ...env, OLLAMA_BASE_URL: 'http://10.0.0.5:11434', OLLAMA_ALLOW_REMOTE: 'true' }, []).llm.baseUrl, 'http://10.0.0.5:11434');
});
