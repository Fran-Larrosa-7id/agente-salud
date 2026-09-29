import type { AgentModel } from '../agent/types.js';
import type { Config } from '../config.js';
import { AnthropicModel } from './anthropic.js';
import { OllamaAgentModel } from './ollama.js';
import { OpenAiCompatibleModel } from './openai.js';
import { RulesModel } from './rules.js';

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('LLM_NOT_CONFIGURED');
  }
}

/** Fábrica del modelo configurado por variables de entorno. */
export function createModel(cfg: Config['llm']): AgentModel {
  switch (cfg.provider) {
    case 'anthropic':
      if (!cfg.apiKey) throw new LlmNotConfiguredError();
      return new AnthropicModel({ apiKey: cfg.apiKey, model: cfg.model, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) });
    case 'openai':
      if (!cfg.apiKey) throw new LlmNotConfiguredError();
      return new OpenAiCompatibleModel({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl || 'https://api.openai.com/v1' });
    case 'ollama':
      // Solo Ollama local. No hay fallback a Anthropic ni a OpenAI.
      return new OllamaAgentModel({
        baseUrl: cfg.baseUrl || 'http://127.0.0.1:11434',
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        numCtx: cfg.ollama.numCtx,
        keepAlive: cfg.ollama.keepAlive,
      });
    case 'rules':
      return new RulesModel();
  }
}

export function isModelConfigured(cfg: Config['llm']): boolean {
  return cfg.provider === 'rules' || cfg.provider === 'ollama' || !!cfg.apiKey;
}
