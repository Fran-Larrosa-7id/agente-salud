import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImportJob, IllegalTransitionError, SelectionError } from '../../src/jobs/job.js';
import { canTransition, isTerminal, JobState as S, TERMINAL_STATES } from '../../src/jobs/states.js';

test('camino feliz completo de la máquina de estados', () => {
  const path = [
    S.OPENING_PROVIDER, S.WAITING_FOR_USER_LOGIN, S.AUTHENTICATED, S.AGENT_STARTING, S.AGENT_OBSERVING,
    S.SEARCHING_STUDIES, S.STUDIES_FOUND, S.WAITING_SELECTION, S.OPENING_STUDY, S.VIEWER_READY, S.FINDING_DOCUMENT,
    S.DOWNLOADING, S.IMPORTING, S.OPENING_STUDY, S.DOWNLOADING, S.IMPORTING, S.COMPLETED,
  ];
  const job = new ImportJob('percamb', 'Pérez Cambet');
  for (const s of path) job.transition(s);
  assert.equal(job.state, S.COMPLETED);
  assert.ok(job.isTerminal);
  assert.ok(job.abort.signal.aborted, 'al terminar se aborta todo lo pendiente');
});

test('no se puede saltar el login ni volver de un estado terminal', () => {
  assert.equal(canTransition(S.WAITING_FOR_USER_LOGIN, S.SEARCHING_STUDIES), false);
  assert.equal(canTransition(S.CREATED, S.WAITING_SELECTION), false);
  assert.equal(canTransition(S.WAITING_SELECTION, S.DOWNLOADING), false, 'no se descarga sin abrir el estudio');
  for (const t of TERMINAL_STATES) {
    assert.ok(isTerminal(t));
    assert.equal(canTransition(t, S.OPENING_PROVIDER), false);
    assert.equal(canTransition(t, S.CANCELLED), false);
  }
  const job = new ImportJob('percamb', 'Pérez Cambet');
  assert.throws(() => job.transition(S.AUTHENTICATED), IllegalTransitionError);
});

test('cancelar, expirar y fallar son posibles desde cualquier estado activo', () => {
  for (const from of [S.CREATED, S.WAITING_FOR_USER_LOGIN, S.SEARCHING_STUDIES, S.WAITING_SELECTION, S.DOWNLOADING, S.HUMAN_ACTION_REQUIRED]) {
    for (const to of [S.CANCELLED, S.EXPIRED, S.ERROR, S.AGENT_UNABLE_TO_CONTINUE]) assert.ok(canTransition(from, to), `${from} → ${to}`);
  }
  assert.ok(canTransition(S.WAITING_FOR_USER_LOGIN, S.AUTH_TIMEOUT));
  assert.equal(canTransition(S.DOWNLOADING, S.AUTH_TIMEOUT), false);
});

test('parser mismatch es recuperable, emite un estado SSE propio y permite reintentar', () => {
  const job = new ImportJob('percamb', 'Pérez Cambet');
  const events: string[] = [];
  job.on('event', (event: { type: string }) => events.push(event.type));
  for (const state of [S.OPENING_PROVIDER, S.WAITING_FOR_USER_LOGIN, S.AUTHENTICATED, S.AGENT_STARTING, S.AGENT_OBSERVING]) job.transition(state);
  job.transition(S.PROVIDER_PARSER_MISMATCH, { code: 'PROVIDER_PARSER_MISMATCH' });
  assert.equal(job.isTerminal, false);
  assert.equal(job.abort.signal.aborted, false);
  assert.equal(job.errorCode, 'PROVIDER_PARSER_MISMATCH');
  assert.equal(job.snapshot().state, S.PROVIDER_PARSER_MISMATCH);
  assert.ok(events.includes('provider_parser_mismatch'));
  job.transition(S.AGENT_STARTING);
  assert.equal(job.errorCode, undefined);
  assert.equal(job.isTerminal, false);
});

test('fail guarda el código y emite un evento error', () => {
  const job = new ImportJob('percamb', 'Pérez Cambet');
  const events: string[] = [];
  job.on('event', (e: { type: string }) => events.push(e.type));
  job.transition(S.OPENING_PROVIDER);
  assert.equal(job.fail(S.CANCELLED, 'WINDOW_CLOSED'), true);
  assert.equal(job.errorCode, 'WINDOW_CLOSED');
  assert.equal(job.fail(S.ERROR, 'OTRO'), false, 'un job terminado no cambia');
  assert.deepEqual(events, ['provider_opening', 'error']);
});

test('selección: solo estudios conocidos, sin duplicados, con límite y en el estado correcto', () => {
  const job = new ImportJob('percamb', 'Pérez Cambet');
  const importedKey = 'a'.repeat(64);
  job.setStudies([{ id: 'a', provider: 'percamb', sourceKey: importedKey }, { id: 'b', provider: 'percamb' }, { id: 'c', provider: 'percamb' }]);
  assert.throws(() => job.select(['a'], 10), (e: SelectionError) => e.code === 'NOT_WAITING_SELECTION');
  for (const s of [S.OPENING_PROVIDER, S.WAITING_FOR_USER_LOGIN, S.AUTHENTICATED, S.AGENT_STARTING, S.SEARCHING_STUDIES, S.STUDIES_FOUND, S.WAITING_SELECTION]) job.transition(s);
  assert.throws(() => job.select([], 10), (e: SelectionError) => e.code === 'EMPTY_SELECTION');
  assert.throws(() => job.select('a', 10), (e: SelectionError) => e.code === 'EMPTY_SELECTION');
  assert.throws(() => job.select(['zz'], 10), (e: SelectionError) => e.code === 'UNKNOWN_STUDY');
  assert.throws(() => job.select(['a', 'a'], 10), (e: SelectionError) => e.code === 'DUPLICATED_STUDY');
  assert.throws(() => job.select(['a', 'b', 'c'], 2), (e: SelectionError) => e.code === 'TOO_MANY');
  assert.throws(() => job.select(['a'], 10, [importedKey]), (e: SelectionError) => e.code === 'ALREADY_IMPORTED');
  assert.throws(() => job.select(['a'], 10, ['not-a-sha256']), (e: SelectionError) => e.code === 'INVALID_SOURCE_KEYS');
  assert.deepEqual(job.select(['c', 'a'], 10), ['c', 'a']);
});

test('cada archivo importado conserva el studyId explícito, aunque se seleccione en orden inverso', () => {
  const job = new ImportJob('percamb', 'Pérez Cambet');
  job.setStudies([
    { id: 'study-a', date: '2026-05-28', protocol: '3-78308', provider: 'percamb' },
    { id: 'study-b', date: '2026-01-14', protocol: '3-71298', provider: 'percamb' },
  ]);
  for (const state of [S.OPENING_PROVIDER, S.WAITING_FOR_USER_LOGIN, S.AUTHENTICATED, S.AGENT_STARTING, S.AGENT_OBSERVING, S.SEARCHING_STUDIES, S.STUDIES_FOUND, S.WAITING_SELECTION]) job.transition(state);
  job.select(['study-b', 'study-a'], 10);
  job.addFile({ id: 'pdf-b', studyId: 'study-b', bytes: 100, sha256: 'b'.repeat(64), kind: 'PDF', mimeType: 'application/pdf', duplicate: false, importedAt: '2026-09-29T12:00:00.000Z', importedBy: 'agent' });
  job.addFile({ id: 'pdf-a', studyId: 'study-a', bytes: 120, sha256: 'a'.repeat(64), kind: 'PDF', mimeType: 'application/pdf', duplicate: false, importedAt: '2026-09-29T12:00:01.000Z', importedBy: 'agent' });
  assert.deepEqual(job.files.map(({ id, studyId }) => ({ id, studyId })), [
    { id: 'pdf-b', studyId: 'study-b' },
    { id: 'pdf-a', studyId: 'study-a' },
  ]);
  assert.throws(() => job.addFile({ id: 'orphan', studyId: 'other', bytes: 5, sha256: '0'.repeat(64), kind: 'PDF', mimeType: 'application/pdf', duplicate: false, importedAt: '2026-09-29T12:00:02.000Z', importedBy: 'agent' }), /FILE_STUDY_MISMATCH/);
});

test('el snapshot público no expone internos', () => {
  const job = new ImportJob('percamb', 'Pérez Cambet');
  const snap = job.snapshot() as Record<string, unknown>;
  assert.deepEqual(Object.keys(snap).sort(), ['current', 'errorCode', 'failures', 'files', 'human', 'jobId', 'lastSeq', 'provider', 'providerName', 'selection', 'state', 'storageBackend', 'storageError', 'studies'].sort());
  assert.ok(!('ownerUserId' in snap));
});
