import { renderObservation } from '../agent/observation.js';
import { SYSTEM_PROMPT } from '../agent/prompts/health-portal-agent.prompt.js';
import { TOOL_DEFS, type ToolName } from '../agent/tools/definitions.js';
import type { AgentAction, AgentModel, AgentObservation } from '../agent/types.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Adapter para la Messages API de Anthropic (por HTTP, sin SDK).
 * Cada decisión es una llamada sin estado: system prompt + herramientas + observación actual
 * (que ya incluye un historial corto). No se envía nada más.
 */
export class AnthropicModel implements AgentModel {
  readonly name: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: AnthropicOptions) {
    this.name = 'anthropic:' + opts.model;
    this.url = (opts.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async decide(input: AgentObservation, { signal }: { signal: AbortSignal }): Promise<AgentAction> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: 600,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOL_DEFS,
        tool_choice: { type: 'any', disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: renderObservation(input) }],
      }),
    });
    // El cuerpo de error puede repetir la solicitud: no se lee ni se registra.
    if (!res.ok) throw new Error('LLM_HTTP_' + res.status);
    const json = (await res.json()) as { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
    const call = json.content?.find((b) => b.type === 'tool_use');
    if (!call?.name) throw new Error('LLM_NO_TOOL');
    return { tool: call.name as ToolName, args: call.input ?? {} };
  }
}
