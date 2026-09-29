import { ProviderParserMismatchError, type BrowserPort } from '../browser/types.js';
import type { ProviderConfig } from '../providers/types.js';
import type { DomainPolicy } from '../security/domain-policy.js';
import type { Logger } from '../security/logger.js';
import { maskPath } from '../security/sanitize.js';
import { withTimeout } from '../util.js';
import { buildObservation, locateTarget } from './observation.js';
import type { PolicyContext } from './policies/action-policy.js';
import { InvalidModelOutputError, ModelUnavailableError } from '../llm/errors.js';
import { executeTool } from './tools/executor.js';
import { validateAction } from './tools/validate.js';
import type { AgentAction, AgentGoal, AgentModel, GoalOutcome, HistoryItem } from './types.js';
import { validateHumanActionEvidence } from './tools/validate.js';

export interface AgentLimits {
  maxSteps: number;
  maxDurationMs: number;
  maxDownloads: number;
  modelTimeoutMs: number;
}

export interface AgentDeps {
  jobId: string;
  model: AgentModel;
  port: BrowserPort;
  provider: ProviderConfig;
  domains: DomainPolicy;
  limits: AgentLimits;
  log: Logger;
  /** Descargas ya usadas en el job (el límite es por job, no por objetivo). */
  downloads: { used: number };
}

export interface RunHooks {
  /** Primera observación del objetivo. */
  onObserve?: (step: number) => void;
  /** Se ejecutó una herramienta (para reflejar fases resumidas en la UI). */
  onAction?: (tool: AgentAction['tool'], info: { step: number; openedTarget: boolean }) => void;
}

const MAX_INVALID_STREAK = 4;
const MAX_REPEAT = 3;

/**
 * Agente de IA: OBSERVAR → DECIDIR → ACTUAR → OBSERVAR, hasta cumplir UN objetivo.
 * El modelo solo elige herramientas; la política y la ejecución quedan en el backend.
 */
export class HealthPortalAgent {
  constructor(private readonly deps: AgentDeps) {}

  async run(goal: AgentGoal, signal: AbortSignal, hooks: RunHooks = {}): Promise<GoalOutcome> {
    const { port, model, provider, limits, log, jobId } = this.deps;
    const started = Date.now();
    const history: HistoryItem[] = [];
    const repeats = new Map<string, number>();
    let lastToolResult: string | undefined;
    let invalidStreak = 0;
    let modelErrors = 0;
    let targetOpened = !!goal.target && (port.isStudyOpen?.(goal.target.studyId) ?? false);

    for (let step = 1; step <= limits.maxSteps; step++) {
      if (signal.aborted) return { kind: 'aborted' };
      const elapsed = Date.now() - started;
      if (elapsed > limits.maxDurationMs) return this.unable('MAX_DURATION', step);

      const raw = await port.snapshot(provider.authenticatedHints).catch(() => null);
      if (!raw) {
        log.debug(jobId, 'agent_snapshot_unavailable', { step });
        history.push({ step, tool: 'observe', outcome: 'error', note: 'la página todavía no está lista' });
        await port.wait(1000);
        continue;
      }
      log.debug(jobId, 'agent_observed', { step, outcome: raw.pageType ?? 'unknown', count: raw.elements.length });

      // Barreras de seguridad: se evalúan antes que el modelo y no dependen de él.
      if (step === 1) hooks.onObserve?.(step);
      if (raw.hasPasswordField) return { kind: 'human', reason: 'session_expired' };
      if (raw.captcha) return { kind: 'human', reason: 'captcha' };
      if (raw.otp) return { kind: 'human', reason: 'mfa' };

      // El extractor específico reconoce resultados sin pedirle a un modelo chico que reconstruya la tabla.
      if (goal.kind === 'DISCOVER_STUDIES' && port.listStudies) {
        let listed;
        try {
          listed = await port.listStudies();
        } catch (error) {
          if (error instanceof ProviderParserMismatchError) {
            log.warn(jobId, 'percamb_parser_mismatch', {
              provider: provider.id,
              errorCode: error.code,
              resultActions: error.resultActions,
              candidateRows: error.candidateRows,
              parsedStudies: error.parsedStudies,
            });
            return this.unable('PROVIDER_PARSER_MISMATCH', step);
          }
          listed = null;
        }
        if (listed) {
          hooks.onAction?.('listStudies', { step, openedTarget: false });
          return {
            kind: 'discovered',
            collectionId: null,
            columns: {},
            snapshot: raw,
            listUrl: listed.listUrl,
            studies: listed.studies.map((study) => ({ ...study, provider: provider.id })),
          };
        }
      }

      const where = locateTarget(raw, goal);
      const policy: PolicyContext = {
        goal: goal.kind,
        domains: this.deps.domains,
        ...(where.collection ? { targetCollection: where.collection } : {}),
        ...(where.row !== undefined ? { targetRow: where.row } : {}),
        targetOpened,
        downloadsUsed: this.deps.downloads.used,
        maxDownloads: limits.maxDownloads,
      };
      const obs = buildObservation({
        raw,
        goal,
        step,
        maxSteps: limits.maxSteps,
        remainingMs: limits.maxDurationMs - elapsed,
        history,
        ...(lastToolResult ? { lastToolResult } : {}),
        provider,
        policy,
        openPages: port.openPages(),
      });
      lastToolResult = undefined;

      let decided: unknown;
      try {
        decided = await withTimeout(model.decide(obs, { signal }), limits.modelTimeoutMs, 'MODEL_TIMEOUT');
        modelErrors = 0;
      } catch (e) {
        if (signal.aborted) return { kind: 'aborted' };
        // Sin fallback a otro modelo: si el configurado no está, el agente se detiene.
        if (e instanceof ModelUnavailableError) return this.unable('MODEL_UNAVAILABLE', step);
        if (e instanceof InvalidModelOutputError) {
          // Respuesta que no es una decisión: no se ejecuta nada, cuenta como paso y se reintenta.
          modelErrors = 0;
          log.debug(jobId, 'model_invalid_output', { step, model: model.name });
          history.push({ step, tool: '?', outcome: 'error', note: 'respuesta inválida: ' + e.reason.slice(0, 80) });
          if (history.length > 12) history.shift();
          if (++invalidStreak >= MAX_INVALID_STREAK) return this.unable('AGENT_STUCK', step);
          continue;
        }
        log.warn(jobId, 'model_error', { step, model: model.name });
        if (++modelErrors >= 2) return this.unable('MODEL_ERROR', step);
        continue;
      }

      // Toda decisión se valida contra el esquema de su herramienta antes de ejecutarse.
      const valid = validateAction(decided);
      if (!valid.ok) {
        const tool = String((decided as { tool?: unknown } | null)?.tool ?? '?').slice(0, 30);
        history.push({ step, tool, outcome: 'error', note: valid.reason.slice(0, 80) });
        if (history.length > 12) history.shift();
        if (++invalidStreak >= MAX_INVALID_STREAK) return this.unable('AGENT_STUCK', step);
        continue;
      }
      const action: AgentAction = valid.action;

      if (action.tool === 'requestHumanAction') {
        const reason = action.args.reason as import('../jobs/job.js').HumanReason;
        if (!validateHumanActionEvidence(reason, raw)) {
          history.push({ step, tool: action.tool, outcome: 'error', note: 'solicitud sin evidencia observable en la página' });
          if (history.length > 12) history.shift();
          if (++invalidStreak >= MAX_INVALID_STREAK) return this.unable('AGENT_STUCK', step);
          continue;
        }
      }

      const key = action.tool + JSON.stringify(action.args) + maskPath(raw.url);
      const n = (repeats.get(key) ?? 0) + 1;
      repeats.set(key, n);
      if (n > MAX_REPEAT) return this.unable('AGENT_LOOP', step);

      const res = await executeTool(action, {
        port,
        raw,
        policy,
        provider,
        ...(goal.target ? { targetStudyId: goal.target.studyId } : {}),
        onDownloadAttempt: () => {
          this.deps.downloads.used++;
        },
      });
      if (res.openedTarget) targetOpened = true;
      log.debug(jobId, 'agent_step', { step, tool: action.tool, outcome: res.outcome });
      hooks.onAction?.(action.tool, { step, openedTarget: targetOpened });

      history.push({ step, tool: action.tool, outcome: res.outcome, note: res.note, ...(res.element ? { element: res.element } : {}) });
      if (history.length > 12) history.shift();
      if (res.data) lastToolResult = res.data;

      if (res.unexpectedDomain) return this.unable('UNEXPECTED_DOMAIN', step);
      if (res.human) return { kind: 'human', reason: res.human };
      if (res.pdf) {
        if (goal.kind === 'DOWNLOAD_STUDY') return { kind: 'downloaded', pdf: res.pdf };
        // Un PDF que llegue durante la búsqueda se descarta: no se guarda nada sin selección.
      }
      let bad = res.outcome === 'bloqueado' || res.outcome === 'error';
      if (res.finish) {
        bad = true;
        if (goal.kind === 'DISCOVER_STUDIES') {
          if (res.finish.noStudies && !res.finish.collectionId) {
            return { kind: 'discovered', collectionId: null, columns: {}, snapshot: raw, listUrl: port.currentUrl() };
          }
          const c = raw.collections.find((x) => x.id === res.finish!.collectionId);
          if (c) return { kind: 'discovered', collectionId: c.id, columns: res.finish.columns ?? {}, snapshot: raw, listUrl: port.currentUrl() };
          history[history.length - 1] = { ...history[history.length - 1], outcome: 'error', note: 'ese listado no existe en esta página' };
        } else {
          history[history.length - 1] = { ...history[history.length - 1], outcome: 'error', note: 'este objetivo termina al capturar el PDF' };
        }
      }

      invalidStreak = bad ? invalidStreak + 1 : 0;
      if (invalidStreak >= MAX_INVALID_STREAK) return this.unable('AGENT_STUCK', step);
    }
    return this.unable('MAX_STEPS', limits.maxSteps);
  }

  private unable(code: string, step: number): GoalOutcome {
    this.deps.log.info(this.deps.jobId, 'agent_stopped', { errorCode: code, step });
    return { kind: 'unable', code };
  }
}
