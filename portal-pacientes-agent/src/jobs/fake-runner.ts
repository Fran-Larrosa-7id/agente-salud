import { sleep } from '../util.js';
import { percambSourceKey } from '../providers/percamb/source-key.js';
import { centroDmSourceKey } from '../providers/centrodm/source-key.js';
import { rdcChacabucoSourceKey } from '../providers/rdcchacabuco/source-key.js';
import type { ExternalStudy, ImportJob } from './job.js';
import { makeDemoPdf } from './pdf.js';
import type { JobRunner, RunnerDeps, RunnerFactory } from './runner.js';
import { JobState } from './states.js';

const S = JobState;

export type FakeScenario = 'ok' | 'human' | 'timeout' | 'unavailable' | 'empty' | 'partial' | 'parser_mismatch';

export interface FakeOptions {
  scenario?: FakeScenario;
  /** Cuánto "tarda" el paciente en iniciar sesión. */
  loginDelayMs?: number;
  stepMs?: number;
}

export const FAKE_STUDIES: Omit<ExternalStudy, 'provider'>[] = [
  { id: 'st_fake00000001', date: '2026-05-28', protocol: '00012345', deliveryDate: '2026-05-30', status: 'Finalizado' },
  { id: 'st_fake00000002', date: '2026-01-14', protocol: '00009876', deliveryDate: '2026-01-16', status: 'Finalizado' },
];

export const FAKE_CENTRODM_STUDIES: Omit<ExternalStudy, 'provider'>[] = [
  { id: 'st_cdm_fake000001', studyDate: '2024-04-08', title: 'Reconstrucción 3D', modality: 'SC', sourceKey: centroDmSourceKey('2024-04-08', 'Reconstrucción 3D', 'SC') },
  { id: 'st_cdm_fake000002', studyDate: '2024-04-10', title: 'Tomografía de tórax', modality: 'CT', sourceKey: centroDmSourceKey('2024-04-10', 'Tomografía de tórax', 'CT') },
];

export const FAKE_RDC_STUDIES: Omit<ExternalStudy, 'provider'>[] = [
  { id: 'st_rdc_fake000001', date: '2026-01-15', studyDate: '2026-01-15', studyType: 'ULTRASONIDO', title: 'ECOGRAFIA TIROIDES', sourceKey: rdcChacabucoSourceKey('2026-01-15', 'ULTRASONIDO', 'ECOGRAFIA TIROIDES') },
  { id: 'st_rdc_fake000002', date: '2025-05-14', studyDate: '2025-05-14', studyType: 'RADIOGRAFÍA COMPUTADA', title: 'RX TORAX FTE', sourceKey: rdcChacabucoSourceKey('2025-05-14', 'RADIOGRAFÍA COMPUTADA', 'RX TORAX FTE') },
];

function demoStudiesFor(provider: string): Omit<ExternalStudy, 'provider'>[] {
  if (provider === 'centrodm') return FAKE_CENTRODM_STUDIES;
  if (provider === 'rdcchacabuco') return FAKE_RDC_STUDIES;
  return FAKE_STUDIES;
}

/**
 * FakeProviderAgent: recorre la misma máquina de estados y emite los mismos eventos que el runner
 * real, sin navegador, sin laboratorio y sin IA. Para demos sin cuenta y para E2E del frontend.
 */
export class FakeProviderAgent implements JobRunner {
  private readonly scenario: FakeScenario;
  private readonly loginDelay: number;
  private readonly step: number;

  constructor(
    private readonly job: ImportJob,
    private readonly deps: RunnerDeps,
    opts: FakeOptions = {},
  ) {
    this.scenario = opts.scenario ?? 'ok';
    this.loginDelay = opts.loginDelayMs ?? 2500;
    this.step = opts.stepMs ?? 600;
  }

  private async pause(ms = this.step): Promise<void> {
    await sleep(ms, this.job.abort.signal);
    if (this.job.abort.signal.aborted) throw new Error('ABORTED');
  }

  async start(): Promise<void> {
    const { job } = this;
    try {
      job.transition(S.OPENING_PROVIDER);
      await this.pause();
      if (this.scenario === 'unavailable') return void job.fail(S.PROVIDER_UNAVAILABLE, 'PROVIDER_UNAVAILABLE');
      job.push('provider_opened');
      job.transition(S.WAITING_FOR_USER_LOGIN, { timeoutMs: this.deps.config.loginTimeoutMs });
      if (this.scenario === 'timeout') {
        await this.pause(this.loginDelay);
        return void job.fail(S.AUTH_TIMEOUT, 'LOGIN_TIMEOUT');
      }
      await this.pause(this.loginDelay);
      job.transition(S.AUTHENTICATED);
      await this.pause(this.step / 2);
      job.transition(S.AGENT_STARTING);
      await this.pause(this.step / 2);
      job.transition(S.AGENT_OBSERVING);
      await this.pause();
      if (this.scenario === 'human') {
        job.transition(S.HUMAN_ACTION_REQUIRED, { reason: 'mfa' });
        await this.pause(this.loginDelay);
        job.transition(S.AGENT_OBSERVING);
        await this.pause();
      }
      job.transition(S.SEARCHING_STUDIES);
      await this.pause(this.step * 2);
      if (this.scenario === 'parser_mismatch') {
        job.transition(S.PROVIDER_PARSER_MISMATCH, { code: 'PROVIDER_PARSER_MISMATCH' });
        return;
      }
      const demoStudies = demoStudiesFor(job.provider);
      const studies = this.scenario === 'empty' ? [] : demoStudies.map((s) => ({
        ...s,
        ...(job.provider === 'percamb' ? { sourceKey: percambSourceKey(s.date, s.protocol) } : {}),
        provider: job.provider,
      }));
      job.setStudies(studies);
      job.transition(S.STUDIES_FOUND, { count: studies.length });
      job.transition(S.WAITING_SELECTION, { studies });
    } catch {
      if (!job.isTerminal) job.fail(S.ERROR, 'INTERNAL');
    }
  }

  async retryDiscovery(): Promise<void> {
    const { job } = this;
    if (job.state !== S.PROVIDER_PARSER_MISMATCH) throw new Error('RETRY_NOT_AVAILABLE');
    try {
      job.transition(S.AGENT_STARTING);
      await this.pause(this.step / 2);
      job.transition(S.AGENT_OBSERVING);
      job.transition(S.SEARCHING_STUDIES);
      await this.pause(this.step);
      const demoStudies = demoStudiesFor(job.provider);
      const studies = demoStudies.map((s) => ({ ...s, provider: job.provider }));
      job.setStudies(studies);
      job.transition(S.STUDIES_FOUND, { count: studies.length });
      job.transition(S.WAITING_SELECTION, { studies });
    } catch {
      if (!job.isTerminal) job.fail(S.ERROR, 'INTERNAL');
    }
  }

  async importSelected(studyIds: string[]): Promise<void> {
    const { job } = this;
    try {
      for (let i = 0; i < studyIds.length; i++) {
        const studyId = studyIds[i];
        const study = job.studies.find((s) => s.id === studyId)!;
        job.current = { studyId, index: i, total: studyIds.length };
        job.transition(S.OPENING_STUDY, { studyId, index: i, total: studyIds.length });
        await this.pause();
        job.transition(S.FINDING_DOCUMENT, { studyId });
        await this.pause();
        job.transition(S.DOWNLOADING, { studyId });
        await this.pause();
        if (this.scenario === 'partial' && i === studyIds.length - 1 && studyIds.length > 1) {
          job.failures.push({ studyId, code: 'NO_PDF_FOUND' });
          job.push('study_failed', { studyId, code: 'NO_PDF_FOUND' });
          continue;
        }
        job.transition(S.IMPORTING, { studyId });
        if (job.provider === 'centrodm') {
          const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30, 0x40]);
          const saved = await this.deps.files.save(zip, 'application/zip', 'DICOM_ZIP');
          if (!saved.ok) throw new Error(saved.reason);
          const imported = { importedAt: new Date().toISOString(), importedBy: 'agent' as const };
          job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, sha256: saved.file.sha256, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
          job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
          await this.pause(this.step / 2);
          continue;
        }
        const pdf = makeDemoPdf([
          'Documento de prueba - FakeProviderAgent',
          'Este PDF lo genero el modo simulado del Portal de Pacientes.',
          'No proviene de ningun laboratorio y no contiene datos reales.',
          'Fecha del estudio: ' + (study.date ?? '-'),
          'Estudio: ' + (study.title ?? '-'),
          'Tipo: ' + (study.studyType ?? '-'),
          'Protocolo: ' + (study.protocol ?? '-'),
        ]);
        const saved = await this.deps.files.save(pdf, 'application/pdf');
        if (!saved.ok) throw new Error(saved.reason);
        const imported = { importedAt: new Date().toISOString(), importedBy: 'agent' as const };
        job.addFile({ id: saved.file.id, studyId, bytes: saved.file.bytes, sha256: saved.file.sha256, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
        job.push('file_ready', { studyId, fileId: saved.file.id, bytes: saved.file.bytes, kind: saved.file.kind, mimeType: saved.file.mimeType, duplicate: saved.duplicate, ...imported });
        await this.pause(this.step / 2);
      }
      job.current = undefined;
      if (!job.files.length) return void job.fail(S.AGENT_UNABLE_TO_CONTINUE, 'NO_DOCUMENTS');
      // La finalización la emite JobManager después del acuse de persistencia del Portal.
    } catch {
      if (!job.isTerminal) job.fail(S.ERROR, 'INTERNAL');
    }
  }

  async dispose(): Promise<void> {
    /* no hay navegador que cerrar */
  }
}

export function fakeRunnerFactory(opts: FakeOptions = {}): RunnerFactory {
  return (job, deps) => new FakeProviderAgent(job, deps, opts);
}
