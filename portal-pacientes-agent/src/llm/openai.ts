import { renderObservation } from '../agent/observation.js';
import { SYSTEM_PROMPT } from '../agent/prompts/health-portal-agent.prompt.js';
import { TOOL_DEFS, type ToolName } from '../agent/tools/definitions.js';
import type { AgentAction, AgentModel, AgentObservation } from '../agent/types.js';

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Adapter para APIs compatibles con /chat/completions y function calling. */
export class OpenAiCompatibleModel implements AgentModel {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiOptions) {
    this.name = 'openai:' + opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async decide(input: AgentObservation, { signal }: { signal: AbortSignal }): Promise<AgentAction> {
    const res = await this.fetchImpl(this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.opts.apiKey },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: renderObservation(input) },
        ],
        tools: TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: 'required',
        parallel_tool_calls: false,
        max_tokens: 600,
      }),
    });
    if (!res.ok) throw new Error('LLM_HTTP_' + res.status);
    const json = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
    const fn = json.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!fn?.name) throw new Error('LLM_NO_TOOL');
    let args: Record<string, unknown> = {};
    try {
      args = fn.arguments ? (JSON.parse(fn.arguments) as Record<string, unknown>) : {};
    } catch {
      throw new Error('LLM_BAD_ARGS');
    }
    return { tool: fn.name as ToolName, args };
  }
}
