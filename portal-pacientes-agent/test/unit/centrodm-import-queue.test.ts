import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserHost } from '../../src/browser/browser-host.js';
import { BrowserSession, MedicalArchiveError } from '../../src/browser/session.js';
import { AgentImportRunner } from '../../src/jobs/agent-runner.js';
import { ImportJob } from '../../src/jobs/job.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { JobState as S } from '../../src/jobs/states.js';
import { RulesModel } from '../../src/llm/rules.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { createLogger } from '../../src/security/logger.js';
import { testConfig } from '../helpers.js';

test('Centro DM procesa la cola secuencialmente y continúa tras un fallo recuperable', async () => {
  const config = testConfig({ maxDownloadsPerJob: 5 });
  const job = new ImportJob('centrodm', centroDm.name);
  const files = new JobFileStore(config.tmpDir, job.id, config.maxPdfBytes, config.maxMedicalArchiveBytes);
  const ids = ['study-a', 'study-b', 'study-c'];
  const studies = ids.map((id) => ({ id, provider: 'centrodm', sourceKey: id.padEnd(64, 'a') }));
  job.transition(S.OPENING_PROVIDER);
  job.transition(S.WAITING_FOR_USER_LOGIN);
  job.transition(S.AUTHENTICATED);
  job.transition(S.SEARCHING_STUDIES);
  job.setStudies(studies);
  job.transition(S.STUDIES_FOUND, { count: studies.length });
  job.transition(S.WAITING_SELECTION, { studies });
  job.select(ids, config.maxDownloadsPerJob);

  const operations: string[] = [];
  let activeStudy: string | null = null;
  const session = {
    provider: centroDm,
    openPages: () => 1,
    hasStudy: (id: string) => ids.includes(id),
    openStudy: async (id: string) => {
      activeStudy = id;
      operations.push(`open:${id}`);
      if (id === 'study-b') throw new MedicalArchiveError('VIEWER_NOT_RECOGNIZED');
      return true;
    },
    downloadFullDicomStudy: async () => {
      operations.push(`download:${activeStudy}`);
      if (job.state === S.FINDING_DOCUMENT) job.transition(S.DOWNLOADING);
      return { buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), contentType: 'application/zip', via: 'download' as const };
    },
    closeExtraPages: async () => {
      operations.push(`close:${activeStudy}`);
      activeStudy = null;
    },
  };
  const runner = new AgentImportRunner(job, { config, provider: centroDm, files, log: createLogger('silent') }, {
    host: {} as BrowserHost,
    createModel: () => new RulesModel(),
  });
  runner.session = session as unknown as BrowserSession;

  await runner.importSelected(ids);

  assert.deepEqual(operations, [
    'open:study-a', 'download:study-a', 'close:study-a',
    'open:study-b', 'close:study-b',
    'open:study-c', 'download:study-c', 'close:study-c',
  ]);
  assert.equal(job.state, S.COMPLETED);
  assert.deepEqual(job.files.map((file) => file.studyId), ['study-a', 'study-c']);
  assert.deepEqual(job.failures, [{ studyId: 'study-b', code: 'VIEWER_NOT_RECOGNIZED' }]);
  await files.cleanup();
});

test('Centro DM despacha sin documentos genéricos y reporta una referencia de estudio faltante', async () => {
  const config = testConfig({ maxDownloadsPerJob: 5 });
  const job = new ImportJob('centrodm', centroDm.name);
  const files = new JobFileStore(config.tmpDir, job.id, config.maxPdfBytes, config.maxMedicalArchiveBytes);
  const studyId = 'study-without-session-reference';
  const studies = [{ id: studyId, provider: 'centrodm', sourceKey: 'a'.repeat(64) }];
  job.transition(S.OPENING_PROVIDER);
  job.transition(S.WAITING_FOR_USER_LOGIN);
  job.transition(S.AUTHENTICATED);
  job.transition(S.SEARCHING_STUDIES);
  job.setStudies(studies);
  job.transition(S.STUDIES_FOUND, { count: 1 });
  job.transition(S.WAITING_SELECTION, { studies });
  job.select([studyId], config.maxDownloadsPerJob);

  const trace: string[] = [];
  const logLines: string[] = [];
  job.on('event', (event) => {
    if (event.type === 'opening_study') trace.push('state:OPENING_STUDY');
  });
  const session = {
    provider: centroDm,
    openPages: () => 1,
    // Este test reproduce un ref ausente y confirma que tampoco cae en el guard de TargetLocator.
    hasStudy: () => false,
    openStudy: async () => {
      trace.push('openStudy');
      throw new MedicalArchiveError('STUDY_REFERENCE_MISSING');
    },
    closeExtraPages: async () => {},
  };
  const runner = new AgentImportRunner(job, {
    config,
    provider: centroDm,
    files,
    log: createLogger('info', (line) => {
      logLines.push(line);
      trace.push(`log:${line.slice(line.indexOf('] ') + 2).split(' ')[0]}`);
    }),
  }, {
    host: {} as BrowserHost,
    createModel: () => new RulesModel(),
  });
  runner.session = session as unknown as BrowserSession;

  await runner.importSelected([studyId]);

  assert.deepEqual(trace.slice(0, 5), [
    'log:import_dispatch',
    'log:centrodm_import_queue',
    'log:centrodm_study_start',
    'state:OPENING_STUDY',
    'openStudy',
  ]);
  assert.match(logLines[0], /import_dispatch provider=centrodm selectedCount=1$/);
  assert.match(logLines[1], /centrodm_import_queue count=1$/);
  assert.match(logLines[2], /centrodm_study_start index=1 count=1$/);
  assert.equal(job.state, S.AGENT_UNABLE_TO_CONTINUE);
  assert.equal(job.errorCode, 'STUDY_REFERENCE_MISSING');
  assert.deepEqual(job.failures, [{ studyId, code: 'STUDY_REFERENCE_MISSING' }]);
  await files.cleanup();
});
