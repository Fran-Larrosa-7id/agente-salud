import { HealthPortalAgent } from '../agent/health-portal-agent.js';
import { extractStudies, resolveColumns, signatureOf } from '../agent/studies.js';
import type { AgentModel, GoalOutcome, TargetLocator } from '../agent/types.js';
import { BrowserNotInstalledError, type BrowserHost } from '../browser/browser-host.js';
import { evaluateLogin, waitForLogin } from '../browser/login-detector.js';
import { BrowserSession, MedicalArchiveError, PdfDownloadError, ProviderUnavailableError, StudyReferenceMismatchError, UnexpectedDomainError } from '../browser/session.js';
import { ProviderParserMismatchError, type RawPageSnapshot } from '../browser/types.js';
import { sleep } from '../util.js';
import type { HumanReason, ImportJob } from './job.js';
import type { JobRunner, RunnerDeps, RunnerFactory } from './runner.js';
import { JobState } from './states.js';

const S = JobState;
const importMetadata = () => ({ importedAt: new Date().toISOString(), importedBy: 'agent' as const });
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
      const session = await BrowserSession.open(
        this.opts.host, provider, config.headless, config.maxPdfBytes, config.providerDebugStructure,
        config.pdfDownloadTimeoutMs, config.maxMedicalArchiveBytes,
        provider.id === 'centrodm' ? config.centroDmAllowedOrigins : [],
        provider.id === 'centrodm' ? config.pixeonViewerReadyTimeoutMs : undefined,
        provider.id === 'centrodm' ? config.pixeonToolbarTimeoutMs : undefined,
      );
      this.session = session;
      if (this.signal.aborted) return void (await this.dispose());
      // Durante el login, el paciente navega: un enlace externo se bloquea en silencio.
      // Con el agente trabajando, un dominio inesperado detiene todo.
      session.onUnexpectedDomain = () => {
        if (WORKING.has(job.state)) job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'UNEXPECTED_DOMAIN');
      };
      session.onNavigationBlocked = ({ scheme, host, port }) => provider.id === 'centrodm'
        ? log.warn(job.id, 'navigation_guard', { provider: provider.id, originAllowed: false, scheme, host, port })
        : log.warn(job.id, 'navigation_blocked', { scheme, host, port });
      session.onCentroDmViewerOriginAllowed = ({ host, port }) => log.info(job.id, 'centrodm_viewer_origin', {
        provider: provider.id, allowed: true, host, port,
      });
      session.onCentroDmViewerOpened = ({ popup }) => log.info(job.id, 'centrodm_viewer_opened', {
        provider: provider.id, popup,
      });
      session.onCentroDmViewerReady = ({ host, port }) => log.info(job.id, 'centrodm_viewer_detected', {
        provider: provider.id, host, port,
      });
      session.onCentroDmDownloadStarting = () => {
        if (job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING, { studyId: job.current?.studyId });
      };
      session.onPdfTrace = ({ stage, ...fields }) => {
        log.debug(job.id, stage, fields);
        if (stage === 'pdf_download_started' && job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING, { studyId: job.current?.studyId });
      };
      const ALWAYS_LOG_PIXEON = new Set(['pixeon_download_probe_start', 'pixeon_download_probe_end', 'pixeon_download_probe', 'pixeon_download_fastpath', 'pixeon_download_click', 'pixeon_download_options', 'pixeon_frames', 'pixeon_frame', 'pixeon_text_exact', 'pixeon_text_partial', 'pixeon_attr_candidates', 'pixeon_dom_candidate', 'pixeon_clickable_ancestor', 'pixeon_structural_fallback', 'pixeon_toolbar_candidates', 'toolbar_candidate', 'pixeon_toolbar_detected', 'pixeon_download_structural_candidate', 'pixeon_download_text_matches', 'pixeon_download_role_matches', 'pixeon_download_attr_matches', 'pixeon_download_candidate', 'pixeon_download_button', 'pixeon_download_menu', 'pixeon_download_menu_options', 'pixeon_download_choice', 'centrodm_find_document_enter', 'find_document_dispatch']);
      session.onProviderStructure = ({ event, ...fields }) => event === 'percamb_page'
        ? log.debug(job.id, event, { provider: provider.id, type: 'results_list' })
        : ALWAYS_LOG_PIXEON.has(event)
          ? log.info(job.id, event, { provider: provider.id, ...fields })
        : log.debug(job.id, event, { provider: provider.id, ...fields });
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
    if (session.provider.studyExtractor === 'centrodm') {
      if (job.state !== S.SEARCHING_STUDIES) job.transition(S.SEARCHING_STUDIES);
      try {
        const result = await session.listStudies();
        if (!result) {
          if (await session.isCentroDmResultsPage?.()) throw new ProviderParserMismatchError(0, 0);
          job.fail(S.PROVIDER_CHANGED, 'PROVIDER_CHANGED');
          return;
        }
        const studies = result.studies.map((study) => ({ ...study, provider: this.deps.provider.id }));
        job.setStudies(studies);
        this.deps.log.info(job.id, 'studies_found', { provider: this.deps.provider.id, count: studies.length });
        job.transition(S.STUDIES_FOUND, { count: studies.length });
        job.transition(S.WAITING_SELECTION, { studies });
        return;
      } catch (error) {
        if (error instanceof ProviderParserMismatchError) {
          this.deps.log.warn(job.id, 'centrodm_parser_mismatch', { provider: this.deps.provider.id, resultActions: error.resultActions, candidateRows: error.candidateRows, parsedStudies: error.parsedStudies });
          job.transition(S.PROVIDER_PARSER_MISMATCH, { code: 'PROVIDER_PARSER_MISMATCH' });
          return;
        }
        throw error;
      }
    }
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
    const isCentroDm = session.provider.studyExtractor === 'centrodm';
    if (isCentroDm) {
      this.deps.log.info(job.id, 'import_dispatch', { provider: this.deps.provider.id, selectedCount: studyIds.length });
      this.deps.log.info(job.id, 'centrodm_import_queue', { count: studyIds.length });
      this.deps.log.info(job.id, 'centrodm_import_start', { count: studyIds.length });
    }
    try {
      for (let i = 0; i < studyIds.length; i++) {
        const studyId = studyIds[i];
        // CentroDM resuelve sus referencias dentro de BrowserSession y no crea TargetLocators
        // genéricos. El despacho del proveedor debe ocurrir antes de validar esos locators.
        const providerOwned = isCentroDm || session.hasStudy?.(studyId) === true;
        const target = isCentroDm ? { studyId } : this.locators.get(studyId) ?? (providerOwned ? { studyId } : undefined);
        if (!target) {
          job.failures.push({ studyId, code: 'UNKNOWN_STUDY' });
          continue;
        }
        job.current = { studyId, index: i, total: studyIds.length };
        if (isCentroDm) this.deps.log.info(job.id, 'centrodm_study_start', { index: i + 1, count: studyIds.length });
        job.transition(S.OPENING_STUDY, { studyId, index: i, total: studyIds.length });
        if (providerOwned) {
          this.deps.log.debug(job.id, 'provider_study_opening', { step: i + 1, count: session.openPages() });
          let opened = false;
          let openingFailure: string | null = null;
          try {
            opened = await session.openStudy?.(studyId) ?? false;
          } catch (error) {
            if (job.isTerminal) return;
            if (error instanceof StudyReferenceMismatchError) openingFailure = error.code;
            else if (isCentroDm && error instanceof MedicalArchiveError) openingFailure = error.code;
            else if (isCentroDm && error instanceof UnexpectedDomainError) openingFailure = 'UNEXPECTED_DOMAIN';
            else throw error;
          }
          if (openingFailure) {
            this.retainFailedViewer(session, openingFailure);
            job.failures.push({ studyId, code: openingFailure });
            job.push('study_failed', { studyId, code: openingFailure });
            if (isCentroDm) this.deps.log.warn(job.id, 'centrodm_study_failed', { index: i + 1, errorCode: openingFailure });
            await session.closeExtraPages();
            continue;
          }
          this.deps.log.debug(job.id, 'provider_study_opened', { step: i + 1, outcome: !!opened, count: session.openPages() });
          if (!opened) {
            const code = isCentroDm ? 'VIEWER_OPEN_TIMEOUT' : 'STUDY_NOT_FOUND';
            job.failures.push({ studyId, code });
            job.push('study_failed', { studyId, code });
            if (isCentroDm) this.deps.log.warn(job.id, 'centrodm_study_failed', { index: i + 1, errorCode: code });
            await session.closeExtraPages();
            continue;
          }
          if (job.state === S.OPENING_STUDY) {
            if (isCentroDm) {
              job.transition(S.VIEWER_READY, { studyId });
              job.transition(S.FINDING_DOCUMENT, { studyId });
            } else {
              job.transition(S.FINDING_DOCUMENT, { studyId });
            }
          }
        } else {
          await this.returnToList(session, target);
        }

        let done = false;
        if (providerOwned && session.provider.studyExtractor === 'centrodm') {
          try {
            session.onProviderStructure?.({ event: 'find_document_dispatch', strategy: 'pixeon' });
            if (this.downloads.used >= this.deps.config.maxDownloadsPerJob) throw new MedicalArchiveError('DICOM_DOWNLOAD_TIMEOUT');
            this.downloads.used++;
            job.transition(S.DOWNLOADING, { studyId });
            const archive = await session.downloadFullDicomStudy?.(this.deps.config.medicalArchiveDownloadTimeoutMs);
            if (!archive) throw new MedicalArchiveError('DICOM_DOWNLOAD_TIMEOUT');
            this.deps.log.info(job.id, 'centrodm_download_complete', { bytes: archive.buffer.length });
            job.transition(S.IMPORTING, { studyId });
            const saved = await this.deps.files.save(archive.buffer, archive.contentType, 'DICOM_ZIP');
            if (saved.ok) {
              this.deps.log.info(job.id, 'centrodm_artifact_valid', { kind: 'DICOM_ZIP', bytes: saved.file.bytes, sha256Present: !!saved.file.sha256 });
              const imported = importMetadata();
              job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, sha256: saved.file.sha256, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
              job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
            } else {
              job.failures.push({ studyId, code: 'INVALID_MEDICAL_ARCHIVE' });
              job.push('study_failed', { studyId, code: 'INVALID_MEDICAL_ARCHIVE' });
            }
          } catch (error) {
            if (job.isTerminal) return;
            const code = error instanceof MedicalArchiveError ? error.code : error instanceof UnexpectedDomainError ? 'UNEXPECTED_DOMAIN' : 'DICOM_DOWNLOAD_TIMEOUT';
            this.retainFailedViewer(session, code);
            job.failures.push({ studyId, code });
            job.push('study_failed', { studyId, code });
            this.deps.log.warn(job.id, 'centrodm_study_failed', { index: i + 1, errorCode: code });
          }
          done = true;
        } else if (providerOwned && session.provider.studyExtractor === 'labwin') {
          try {
            if (this.downloads.used >= this.deps.config.maxDownloadsPerJob) throw new PdfDownloadError('PDF_NOT_FOUND');
            this.downloads.used++;
            const pdf = await session.downloadCurrentStudyPdf?.();
            if (!pdf) throw new PdfDownloadError('PDF_NOT_FOUND');
            if (job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING, { studyId });
            job.transition(S.IMPORTING, { studyId });
            const saved = await this.deps.files.save(pdf.buffer, pdf.contentType);
            if (saved.ok) {
              const imported = importMetadata();
              job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, sha256: saved.file.sha256, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
              job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
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
              const imported = importMetadata();
              job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, sha256: saved.file.sha256, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
              job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
            } else {
              job.failures.push({ studyId, code: 'INVALID_PDF' });
              job.push('study_failed', { studyId, code: 'INVALID_PDF' });
            }
            done = true;
          } else if (outcome.kind === 'human') {
            if (!(await this.handleHuman(session, outcome.reason, studyId))) return;
            job.transition(S.OPENING_STUDY, { studyId, index: i, total: studyIds.length });
            if (providerOwned) {
              let reopened = false;
              try {
                reopened = await session.openStudy?.(studyId) ?? false;
              } catch (error) {
                if (!(error instanceof StudyReferenceMismatchError)) throw error;
                job.failures.push({ studyId, code: error.code });
                job.push('study_failed', { studyId, code: error.code });
                done = true;
              }
              if (!reopened) {
                if (!done) {
                  job.failures.push({ studyId, code: 'STUDY_NOT_FOUND' });
                  job.push('study_failed', { studyId, code: 'STUDY_NOT_FOUND' });
                }
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
        const specificFailure = job.failures.find((failure) => ['PDF_NOT_FOUND', 'PDF_DOWNLOAD_TIMEOUT', 'INVALID_DOCUMENT', 'UNEXPECTED_DOMAIN', 'STUDY_REFERENCE_MISMATCH', 'STUDY_NOT_FOUND', 'STUDY_REFERENCE_MISSING', 'VIEWER_NOT_READY', 'VIEWER_OPEN_TIMEOUT', 'VIEWER_NOT_RECOGNIZED', 'DOWNLOAD_ACTION_NOT_FOUND', 'DOWNLOAD_ACTION_NOT_CLICKABLE', 'DOWNLOAD_MENU_NOT_FOUND', 'DICOM_DOWNLOAD_TIMEOUT', 'INVALID_MEDICAL_ARCHIVE'].includes(failure.code));
        return void job.fail(S.AGENT_UNABLE_TO_CONTINUE, specificFailure?.code ?? (isCentroDm ? 'NO_ARTIFACTS_IMPORTED' : 'NO_DOCUMENTS'));
      }
      // El JobManager mantiene IMPORTING hasta que el Portal confirme el Blob y la ficha persistida.
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

  get debugViewerRetentionMs(): number { return this.session?.debugViewerRetentionMs || 0; }

  private retainFailedViewer(session: BrowserSession, code: string): void {
    if (this.deps.config.pixeonDebugKeepViewerOpen && ['VIEWER_NOT_RECOGNIZED', 'DOWNLOAD_ACTION_NOT_FOUND', 'DOWNLOAD_ACTION_NOT_CLICKABLE', 'DOWNLOAD_MENU_NOT_FOUND'].includes(code)) {
      session.retainPixeonViewerForDebug(this.deps.config.pixeonDebugKeepViewerOpenMs);
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
