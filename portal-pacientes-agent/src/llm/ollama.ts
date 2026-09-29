import { renderCompactObservation } from '../agent/observation.js';
import { SYSTEM_PROMPT } from '../agent/prompts/health-portal-agent.prompt.js';
import { TOOL_DEFS } from '../agent/tools/definitions.js';
import { validateAction } from '../agent/tools/validate.js';
import type { AgentAction, AgentModel, AgentObservation } from '../agent/types.js';
import { InvalidModelOutputError, ModelUnavailableError } from './errors.js';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  /** Tiempo máximo por decisión. Al vencer se corta la solicitud HTTP (Ollama deja de generar). */
  timeoutMs: number;
  numCtx: number;
  keepAlive: string;
  fetchImpl?: typeof fetch;
}

type PropSchema = { type?: string; enum?: readonly string[]; properties?: Record<string, PropSchema>; additionalProperties?: boolean };

/**
 * Esquema de la respuesta: `action` (nombre de la herramienta) + los argumentos en el mismo nivel,
 * por ejemplo {"action":"click","elementId":"f0-12"}. Se arma a partir de TOOL_DEFS, así que no
 * hay una segunda definición de herramientas. Ollama lo aplica como gramática (structured output);
 * los límites de cada herramienta (mínimos, máximos, requeridos) se validan después con validateAction.
 */
function responseSchema() {
  const properties: Record<string, PropSchema> = {
    action: { type: 'string', enum: TOOL_DEFS.map((t) => t.name) },
  };
  for (const tool of TOOL_DEFS) {
    for (const [name, raw] of Object.entries(tool.input_schema.properties as Record<string, PropSchema>)) {
      if (properties[name]) continue;
      const prop: PropSchema = { type: raw.type };
      if (raw.enum) prop.enum = raw.enum;
      if (raw.properties) {
        prop.properties = Object.fromEntries(Object.entries(raw.properties).map(([k, v]) => [k, { type: v.type }]));
        prop.additionalProperties = false;
      }
      properties[name] = prop;
    }
  }
  return { type: 'object', properties, required: ['action'], additionalProperties: false };
}

/** Catálogo compacto de herramientas (el mismo contenido que reciben Anthropic/OpenAI como tools nativas). */
function toolCatalog(): string {
  return TOOL_DEFS.map((t) => {
    const props = Object.keys(t.input_schema.properties);
    const required = new Set<string>(('required' in t.input_schema ? t.input_schema.required : []) as readonly string[]);
    const args = props.map((p) => (required.has(p) ? p : p + '?')).join(', ');
    return `- ${t.name}${args ? ' {' + args + '}' : ''}: ${t.description}`;
  }).join('\n');
}

/** Mismo system prompt del agente + formato de respuesta. Es fijo, así Ollama reutiliza la caché del prefijo. */
export const OLLAMA_SYSTEM_PROMPT =
  SYSTEM_PROMPT +
  '\n\n# Formato de respuesta\n' +
  'Respondé SOLO con un objeto JSON, sin texto adicional: {"action": "<herramienta>", ...argumentos}.\n' +
  'Ejemplos: {"action":"click","elementId":"f0-12"} · {"action":"finishGoal","collectionId":"c0-0","columns":{"date":0,"protocol":1}} · {"action":"requestHumanAction","reason":"ambiguous"}\n' +
  'Usá solo ids de elementos y listados que aparezcan en la observación.\n\n' +
  '# Herramientas (los argumentos con ? son opcionales)\n' +
  toolCatalog();

const SCHEMA = responseSchema();
const ARG_NAMES = new Map<string, string[]>(TOOL_DEFS.map((t) => [t.name, Object.keys(t.input_schema.properties)]));

/** Extrae la decisión del texto del modelo. Ignora el razonamiento (<think>) y cercos de código. */
export function parseDecision(content: string): AgentAction {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new InvalidModelOutputError('no es JSON');
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new InvalidModelOutputError('no es un objeto');
  const { action, args: nested, ...flat } = obj as Record<string, unknown>;
  if (typeof action !== 'string') throw new InvalidModelOutputError('falta action');
  // Se toman solo los argumentos de esa herramienta; si el modelo los anidó en "args", también se aceptan.
  const source = nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : flat;
  const names = ARG_NAMES.get(action) ?? [];
  const args = Object.fromEntries(names.filter((n) => source[n] !== undefined).map((n) => [n, source[n]]));
  const valid = validateAction({ tool: action, args });
  if (!valid.ok) throw new InvalidModelOutputError(valid.reason);
  return valid.action;
}

/**
 * Adapter para Ollama local (POST /api/chat). Solo reemplaza la capa de inferencia:
 * mismo system prompt, mismas herramientas, mismas políticas y el mismo ciclo del agente.
 * Nunca llama a otro servicio: si Ollama no responde, lanza ModelUnavailableError.
 */
export class OllamaAgentModel implements AgentModel {
  readonly name: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.name = 'ollama:' + opts.model;
    this.url = opts.baseUrl.replace(/\/$/, '') + '/api/chat';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async decide(input: AgentObservation, { signal }: { signal: AbortSignal }): Promise<AgentAction> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        signal: AbortSignal.any([signal, timeout]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.opts.model,
          stream: false,
          // Qwen3: sin razonamiento visible. Menos latencia y nada que filtrar.
          think: false,
          format: SCHEMA,
          keep_alive: this.opts.keepAlive,
          options: { temperature: 0, num_ctx: this.opts.numCtx, num_predict: 256 },
          messages: [
            { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
            { role: 'user', content: renderCompactObservation(input, { maxElements: 40, maxHistory: 6 }) },
          ],
        }),
      });
    } catch (e) {
      if (signal.aborted) throw e;
      if (timeout.aborted) throw new Error('MODEL_TIMEOUT');
      throw new ModelUnavailableError('OFFLINE');
    }
    // El cuerpo de error no se lee ni se registra.
    if (res.status === 404) throw new ModelUnavailableError('MODEL_NOT_FOUND');
    if (!res.ok) throw new Error('LLM_HTTP_' + res.status);
    let json: { message?: { content?: unknown } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      if (signal.aborted) throw new Error('ABORTED');
      if (timeout.aborted) throw new Error('MODEL_TIMEOUT');
      throw new InvalidModelOutputError('respuesta ilegible');
    }
    // `message.thinking` (si la versión de Ollama lo devuelve) se ignora: no se usa, no se guarda, no se registra.
    const content = json.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new InvalidModelOutputError('respuesta vacía');
    return parseDecision(content);
  }
}

export type OllamaStatus = { status: 'ok'; version: string } | { status: 'offline' } | { status: 'model_not_found' };

/** Comprueba que Ollama responda y que el modelo esté descargado. No genera tokens. */
export async function checkOllama(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<OllamaStatus> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const tags = await fetchImpl(base + '/api/tags', { signal: AbortSignal.timeout(timeoutMs) });
    if (!tags.ok) return { status: 'offline' };
    const { models = [] } = (await tags.json()) as { models?: { name?: string; model?: string }[] };
    const wanted = model.includes(':') ? [model] : [model, model + ':latest'];
    if (!models.some((m) => wanted.includes(m.name ?? '') || wanted.includes(m.model ?? ''))) return { status: 'model_not_found' };
    const ver = await fetchImpl(base + '/api/version', { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json() as Promise<{ version?: string }>).catch(() => ({ version: undefined }));
    return { status: 'ok', version: ver.version ?? '?' };
  } catch {
    return { status: 'offline' };
  }
}

/** Una única inferencia sintética al arrancar: carga el modelo sin usar página ni datos del paciente. */
export async function warmupOllama(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000,
  keepAlive = '30m',
): Promise<boolean> {
  const url = baseUrl.replace(/\/$/, '') + '/api/chat';
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: keepAlive,
        options: { temperature: 0, num_ctx: 128, num_predict: 8 },
        messages: [
          { role: 'system', content: 'Respondé únicamente con JSON válido.' },
          { role: 'user', content: 'Respond with exactly: {"ready":true}' },
        ],
      }),
    });
    if (!response.ok) return false;
    // Consumir la respuesta termina la inferencia; no conservar ni registrar su contenido.
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Solo se acepta Ollama en esta máquina, salvo que se habilite explícitamente otro host. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}
