import { HealthPortalAgent } from '../agent/health-portal-agent.js';
import { extractStudies, resolveColumns, signatureOf } from '../agent/studies.js';
import type { AgentModel, GoalOutcome, TargetLocator } from '../agent/types.js';
import { BrowserNotInstalledError, type BrowserHost } from '../browser/browser-host.js';
import { evaluateLogin, waitForLogin } from '../browser/login-detector.js';
import { BrowserSession, PdfDownloadError, ProviderUnavailableError, UnexpectedDomainError } from '../browser/session.js';
import { ProviderParserMismatchError, type RawPageSnapshot } from '../browser/types.js';
import { sleep } from '../util.js';
import type { HumanReason, ImportJob } from './job.js';
import type { JobRunner, RunnerDeps, RunnerFactory } from './runner.js';
import { JobState } from './states.js';

const S = JobState;
const WORKING: ReadonlySet<JobState> = new Set([
  S.AGENT_STARTING,
  S.AGENT_OBSERVING,
  S.SEARCHING_STUDIES,
  S.PROVIDER_PARSER_MISMATCH,
  S.OPENING_STUDY,
  S.FINDING_DOCUMENT,
  S.DOWNLOADING,
  S.IMPORTING,
]);

export interface AgentRunnerOptions {
  host: BrowserHost;
  createModel: () => AgentModel;
  humanPollMs?: number;
  loginPollMs?: number;
}

/**
 * Runner real: navegador visible + detección de login + agente de IA.
 * La contraseña la escribe el paciente en la ventana del laboratorio; este runner nunca la ve.
 */
export class AgentImportRunner implements JobRunner {
  session: BrowserSession | null = null;
  private agent: HealthPortalAgent | null = null;
  private readonly locators = new Map<string, TargetLocator>();
  private readonly downloads = { used: 0 };
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly job: ImportJob,
    private readonly deps: RunnerDeps,
    private readonly opts: AgentRunnerOptions,
  ) {}

  private get signal() {
    return this.job.abort.signal;
  }

  private getAgent(session: BrowserSession): HealthPortalAgent {
    if (!this.agent) {
      const { config, provider, log } = this.deps;
      this.agent = new HealthPortalAgent({
        jobId: this.job.id,
        model: this.opts.createModel(),
        port: session,
        provider,
        domains: session.policy,
        limits: {
          maxSteps: config.maxAgentSteps,
          maxDurationMs: config.maxAgentDurationMs,
          maxDownloads: config.maxDownloadsPerJob,
          modelTimeoutMs: config.llm.timeoutMs,
        },
        log,
        downloads: this.downloads,
      });
    }
    return this.agent;
  }

  async start(): Promise<void> {
    const { job } = this;
    const { provider, config, log } = this.deps;
    try {
      job.transition(S.OPENING_PROVIDER);
      const session = await BrowserSession.open(this.opts.host, provider, config.headless, config.maxPdfBytes, config.providerDebugStructure, config.pdfDownloadTimeoutMs);
      this.session = session;
      if (this.signal.aborted) return void (await this.dispose());
      // Durante el login, el paciente navega: un enlace externo se bloquea en silencio.
      // Con el agente trabajando, un dominio inesperado detiene todo.
      session.onUnexpectedDomain = () => {
        if (WORKING.has(job.state)) job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'UNEXPECTED_DOMAIN');
      };
      session.onNavigationBlocked = ({ scheme, host }) => log.warn(job.id, 'navigation_blocked', { scheme, host });
      session.onPdfTrace = ({ stage, ...fields }) => {
        log.debug(job.id, stage, fields);
        if (stage === 'pdf_download_started' && job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING, { studyId: job.current?.studyId });
      };
      session.onProviderStructure = ({ event, count, index, depth, tag, links, textNodes, siblings, classType, hrefMatch }) => event === 'percamb_page'
        ? log.debug(job.id, event, { provider: provider.id, type: 'results_list' })
        : log.debug(job.id, event, { provider: provider.id, count, index, depth, tag, links, textNodes, siblings, classType, hrefMatch });
      session.onUserClosed = () => job.fail(S.CANCELLED, 'WINDOW_CLOSED');
      await session.gotoLogin();
      job.push('provider_opened');
      job.transition(S.WAITING_FOR_USER_LOGIN, { timeoutMs: config.loginTimeoutMs });

      const login = await waitForLogin(session, provider, {
        timeoutMs: config.loginTimeoutMs,
        signal: this.signal,
        ...(this.opts.loginPollMs ? { pollMs: this.opts.loginPollMs } : {}),
      });
      if (login === 'aborted') return;
      if (login === 'timeout') return void job.fail(S.AUTH_TIMEOUT, 'LOGIN_TIMEOUT');
      job.transition(S.AUTHENTICATED);
      await this.discover(session);
    } catch (e) {
      this.handleError(e);
    }
  }

  private async discover(session: BrowserSession): Promise<void> {
    const { job } = this;
    if (await session.isPercambResultsPage()) {
      if (job.state !== S.SEARCHING_STUDIES) job.transition(S.SEARCHING_STUDIES);
      try {
        const result = await session.listStudies();
        if (result) {
          const studies = result.studies.map((study) => ({ ...study, provider: this.deps.provider.id }));
          job.setStudies(studies);
          this.deps.log.info(job.id, 'studies_found', { provider: this.deps.provider.id, count: studies.length });
          job.transition(S.STUDIES_FOUND, { count: studies.length });
          job.transition(S.WAITING_SELECTION, { studies });
          return;
        }
      } catch (error) {
        if (error instanceof ProviderParserMismatchError) {
          this.deps.log.warn(job.id, 'percamb_parser_mismatch', {
            provider: this.deps.provider.id,
            resultActions: error.resultActions,
            candidateRows: error.candidateRows,
            parsedStudies: error.parsedStudies,
          });
          job.transition(S.PROVIDER_PARSER_MISMATCH, { code: 'PROVIDER_PARSER_MISMATCH' });
          return;
        }
        throw error;
      }
      // Si la pantalla no es reconocible por el extractor, el agente general queda como fallback.
    }
    const agent = this.getAgent(session);
    for (let round = 0; round < 3; round++) {
      job.transition(S.AGENT_STARTING);
      const outcome = await agent.run({ kind: 'DISCOVER_STUDIES' }, this.signal, {
        onObserve: () => job.transition(S.AGENT_OBSERVING),
        onAction: () => {
          if (job.state === S.AGENT_OBSERVING) job.transition(S.SEARCHING_STUDIES);
        },
      });
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'discovered') return this.onDiscovered(outcome);
      if (outcome.kind === 'human') {
        if (!(await this.handleHuman(session, outcome.reason, null))) return;
        continue;
      }
      if (outcome.kind === 'unable') {
        if (outcome.code === 'PROVIDER_PARSER_MISMATCH') {
          if (job.state === S.AGENT_OBSERVING || job.state === S.AGENT_STARTING || job.state === S.SEARCHING_STUDIES) {
            job.transition(S.PROVIDER_PARSER_MISMATCH, { code: 'PROVIDER_PARSER_MISMATCH' });
          }
          return;
        }
        return void this.failFromCode(outcome.code);
      }
    }
    job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'TOO_MANY_INTERRUPTIONS');
  }

  async retryDiscovery(): Promise<void> {
    const { job } = this;
    const session = this.session;
    if (job.state !== S.PROVIDER_PARSER_MISMATCH || !session || session.isClosed) throw new Error('RETRY_UNAVAILABLE');
    job.transition(S.AGENT_STARTING);
    try {
      await this.discover(session);
    } catch (e) {
      this.handleError(e);
    }
  }

  private onDiscovered(outcome: Extract<GoalOutcome, { kind: 'discovered' }>): void {
    const { job } = this;
    const { provider, log } = this.deps;
    const c = outcome.collectionId ? outcome.snapshot.collections.find((x) => x.id === outcome.collectionId) : undefined;
    const found = outcome.studies
      ? outcome.studies.map((study) => ({ study, fingerprint: '' }))
      : c
        ? extractStudies(job.id, provider.id, c, resolveColumns(c, outcome.columns))
        : [];
    if (c) {
      const signature = signatureOf(c);
      for (const f of found) this.locators.set(f.study.id, { studyId: f.study.id, signature, fingerprint: f.fingerprint, listUrl: outcome.listUrl });
    } else if (outcome.studies) {
      for (const study of outcome.studies) this.locators.set(study.id, { studyId: study.id, listUrl: outcome.listUrl });
    }
    const studies = found.map((f) => f.study);
    job.setStudies(studies);
    log.info(job.id, 'studies_found', { provider: provider.id, count: studies.length });
    job.transition(S.STUDIES_FOUND, { count: studies.length });
    job.transition(S.WAITING_SELECTION, { studies });
  }

  async importSelected(studyIds: string[]): Promise<void> {
    const { job } = this;
    const session = this.session;
    if (!session) return void job.fail(S.ERROR, 'NO_SESSION');
    try {
      for (let i = 0; i < studyIds.length; i++) {
        const studyId = studyIds[i];
        const providerOwned = session.hasStudy?.(studyId) === true;
        const target = this.locators.get(studyId) ?? (providerOwned ? { studyId } : undefined);
        if (!target) {
          job.failures.push({ studyId, code: 'UNKNOWN_STUDY' });
          continue;
        }
        job.current = { studyId, index: i, total: studyIds.length };
        job.transition(S.OPENING_STUDY, { studyId, index: i, total: studyIds.length });
        if (providerOwned) {
          this.deps.log.debug(job.id, 'provider_study_opening', { step: i + 1, count: session.openPages() });
          const opened = await session.openStudy?.(studyId).catch(() => false);
          this.deps.log.debug(job.id, 'provider_study_opened', { step: i + 1, outcome: !!opened, count: session.openPages() });
          if (!opened) {
            job.failures.push({ studyId, code: 'STUDY_NOT_FOUND' });
            job.push('study_failed', { studyId, code: 'STUDY_NOT_FOUND' });
            continue;
          }
          if (job.state === S.OPENING_STUDY) job.transition(S.FINDING_DOCUMENT, { studyId });
        } else {
          await this.returnToList(session, target);
        }

        let done = false;
        if (providerOwned && session.provider.studyExtractor === 'labwin') {
          try {
            if (this.downloads.used >= this.deps.config.maxDownloadsPerJob) throw new PdfDownloadError('PDF_NOT_FOUND');
            this.downloads.used++;
            const pdf = await session.downloadCurrentStudyPdf?.();
            if (!pdf) throw new PdfDownloadError('PDF_NOT_FOUND');
            if (job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING, { studyId });
            job.transition(S.IMPORTING, { studyId });
            const saved = await this.deps.files.save(pdf.buffer, pdf.contentType);
            if (saved.ok) {
              job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, duplicate: saved.duplicate });
              job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, duplicate: saved.duplicate });
            } else {
              job.failures.push({ studyId, code: 'INVALID_DOCUMENT' });
              job.push('study_failed', { studyId, code: 'INVALID_DOCUMENT' });
            }
          } catch (error) {
            if (job.isTerminal) return;
            const code = error instanceof PdfDownloadError ? error.code : error instanceof UnexpectedDomainError ? 'UNEXPECTED_DOMAIN' : 'PDF_NOT_FOUND';
            job.failures.push({ studyId, code });
            job.push('study_failed', { studyId, code });
          }
          done = true;
        }
        for (let round = 0; round < 3 && !done; round++) {
          const agent = this.getAgent(session);
          const outcome = await agent.run({ kind: 'DOWNLOAD_STUDY', target }, this.signal, {
            onAction: (tool, info) => {
              if (info.openedTarget && job.state === S.OPENING_STUDY) job.transition(S.FINDING_DOCUMENT, { studyId });
              if ((tool === 'downloadFromElement' || tool === 'detectPdfResponse') && job.state !== S.DOWNLOADING) {
                job.transition(S.DOWNLOADING, { studyId });
              }
            },
          });
          if (outcome.kind === 'aborted') return;
          if (outcome.kind === 'downloaded') {
            if (job.state !== S.DOWNLOADING) job.transition(S.DOWNLOADING, { studyId });
            job.transition(S.IMPORTING, { studyId });
            const saved = await this.deps.files.save(outcome.pdf.buffer, outcome.pdf.contentType);
            if (saved.ok) {
              job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, duplicate: saved.duplicate });
              job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, duplicate: saved.duplicate });
            } else {
              job.failures.push({ studyId, code: 'INVALID_PDF' });
              job.push('study_failed', { studyId, code: 'INVALID_PDF' });
            }
            done = true;
          } else if (outcome.kind === 'human') {
            if (!(await this.handleHuman(session, outcome.reason, studyId))) return;
            job.transition(S.OPENING_STUDY, { studyId, index: i, total: studyIds.length });
            if (providerOwned) {
              const reopened = await session.openStudy?.(studyId).catch(() => false);
              if (!reopened) {
                job.failures.push({ studyId, code: 'STUDY_NOT_FOUND' });
                job.push('study_failed', { studyId, code: 'STUDY_NOT_FOUND' });
                done = true;
              }
            } else {
              await this.returnToList(session, target);
            }
          } else if (outcome.kind === 'unable') {
            if (outcome.code === 'UNEXPECTED_DOMAIN' || outcome.code === 'MODEL_ERROR' || outcome.code === 'MODEL_UNAVAILABLE') return void this.failFromCode(outcome.code);
            job.failures.push({ studyId, code: outcome.code });
            job.push('study_failed', { studyId, code: outcome.code });
            done = true;
          } else {
            job.failures.push({ studyId, code: 'AGENT_UNEXPECTED_OUTCOME' });
            job.push('study_failed', { studyId, code: 'AGENT_UNEXPECTED_OUTCOME' });
            done = true;
          }
        }
        if (!done) {
          job.failures.push({ studyId, code: 'TOO_MANY_INTERRUPTIONS' });
          job.push('study_failed', { studyId, code: 'TOO_MANY_INTERRUPTIONS' });
        }
        this.deps.log.debug(job.id, 'study_pages_cleanup', { count: session.openPages() });
        await session.closeExtraPages();
      }
      job.current = undefined;
      if (job.files.length === 0) {
        const specificPdfFailure = job.failures.find((failure) => ['PDF_NOT_FOUND', 'PDF_DOWNLOAD_TIMEOUT', 'INVALID_DOCUMENT', 'UNEXPECTED_DOMAIN'].includes(failure.code));
        return void job.fail(S.AGENT_UNABLE_TO_CONTINUE, specificPdfFailure?.code ?? 'NO_DOCUMENTS');
      }
      job.transition(S.COMPLETED, { files: job.files.length, failures: job.failures.length });
    } catch (e) {
      this.handleError(e);
    }
  }

  /** Vuelve al listado de resultados antes de cada estudio (sin guardar su contenido). */
  private async returnToList(session: BrowserSession, target: TargetLocator): Promise<void> {
    await session.closeExtraPages();
    if (!target.signature) {
      if (target.listUrl && session.policy.isAllowedNavigation(target.listUrl)) await session.navigate(target.listUrl).catch(() => {});
      return;
    }
    const hasList = (snap: RawPageSnapshot | null) => !!snap?.collections.some((c) => signatureOf(c) === target.signature);
    if (hasList(await session.snapshot([]).catch(() => null))) return;
    await session.goBack();
    if (hasList(await session.snapshot([]).catch(() => null))) return;
    if (target.listUrl && session.policy.isAllowedNavigation(target.listUrl)) await session.navigate(target.listUrl).catch(() => {});
  }

  /**
   * Pausa al agente hasta que el paciente resuelva el paso en la ventana del laboratorio.
   * No intenta resolver CAPTCHA, códigos ni otros controles de seguridad.
   */
  private async handleHuman(session: BrowserSession, reason: HumanReason, studyId: string | null): Promise<boolean> {
    const { job } = this;
    const { provider, config } = this.deps;
    if (reason === 'portal_changed') {
      job.fail(S.PROVIDER_CHANGED, 'PROVIDER_CHANGED');
      return false;
    }
    job.transition(S.HUMAN_ACTION_REQUIRED, { reason, ...(studyId ? { studyId } : {}) });
    const before = await session.snapshot([]).catch(() => null);
    const keyOf = (s: RawPageSnapshot) => s.url + '|' + s.modal + '|' + s.collections.map(signatureOf).join(',');
    const initialKey = before ? keyOf(before) : '';
    const deadline = Date.now() + config.loginTimeoutMs;
    let streak = 0;
    while (!this.signal.aborted && Date.now() < deadline) {
      await sleep(this.opts.humanPollMs ?? 1500, this.signal);
      const snap = await session.snapshot(provider.authenticatedHints).catch(() => null);
      if (!snap) continue;
      const noChallenge = !snap.captcha && !snap.otp && !snap.hasPasswordField && !snap.modal;
      const cleared =
        reason === 'session_expired'
          ? evaluateLogin(snap, provider).authenticated
          : reason === 'captcha' || reason === 'mfa' || reason === 'security_check'
            ? noChallenge
            : noChallenge && keyOf(snap) !== initialKey;
      streak = cleared ? streak + 1 : 0;
      if (streak >= 2) return true;
    }
    if (!this.signal.aborted) job.fail(S.AUTH_TIMEOUT, 'HUMAN_ACTION_TIMEOUT');
    return false;
  }

  private failFromCode(code: string): void {
    if (code === 'MODEL_ERROR' || code === 'MODEL_UNAVAILABLE') this.job.fail(S.ERROR, code);
    else this.job.fail(S.AGENT_UNABLE_TO_CONTINUE, code);
  }

  private handleError(e: unknown): void {
    if (this.job.isTerminal) return;
    if (e instanceof ProviderUnavailableError) {
      this.job.fail(S.PROVIDER_UNAVAILABLE, 'PROVIDER_UNAVAILABLE');
    } else if (String(e).includes('LLM_NOT_CONFIGURED')) {
      this.job.fail(S.ERROR, 'LLM_NOT_CONFIGURED');
    } else if (e instanceof BrowserNotInstalledError || /Executable doesn't exist|playwright install/i.test(String(e))) {
      this.deps.log.warn(this.job.id, 'runner_error', { state: this.job.state, errorCode: 'BROWSER_NOT_INSTALLED' });
      this.job.fail(S.ERROR, 'BROWSER_NOT_INSTALLED');
    } else {
      // Solo para desarrollo: el error puede contener datos de la página, por eso no va al log normal.
      if (process.env.AGENT_DEBUG_ERRORS === 'true') console.error(e);
      this.deps.log.warn(this.job.id, 'runner_error', { state: this.job.state, errorCode: 'INTERNAL' });
      this.job.fail(S.ERROR, 'INTERNAL');
    }
  }

  dispose(): Promise<void> {
    if (!this.disposePromise) {
      const s = this.session;
      this.session = null;
      this.agent = null;
      this.locators.clear();
      this.disposePromise = s ? s.close() : Promise.resolve();
    }
    return this.disposePromise;
  }
}

export function agentRunnerFactory(opts: AgentRunnerOptions): RunnerFactory {
  return (job, deps) => new AgentImportRunner(job, deps, opts);
}
