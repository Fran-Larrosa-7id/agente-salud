import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { extractStudies, inferColumns, parseDate, resolveColumns } from '../../src/agent/studies.js';
import { evaluateLogin } from '../../src/browser/login-detector.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { makeDemoPdf, validatePdf } from '../../src/jobs/pdf.js';
import { el, snap, testConfig, testProvider } from '../helpers.js';

test('validación de PDF por bytes, no por status ni Content-Type', () => {
  const pdf = makeDemoPdf(['hola']);
  assert.deepEqual(validatePdf(pdf, 'application/pdf'), { ok: true });
  assert.deepEqual(validatePdf(pdf, null), { ok: true });
  assert.deepEqual(validatePdf(Buffer.alloc(0), 'application/pdf'), { ok: false, reason: 'EMPTY' });
  assert.deepEqual(validatePdf(Buffer.from('<html>login</html>'), 'application/pdf'), { ok: false, reason: 'NOT_PDF_BYTES' });
  assert.deepEqual(validatePdf(pdf, 'text/html'), { ok: true, mimeMismatch: true });
});

test('archivos: nombres UUID, deduplicación por SHA-256 y limpieza', async () => {
  const cfg = testConfig();
  const jobId = randomUUID();
  const store = new JobFileStore(cfg.tmpDir, jobId);
  const a = await store.save(makeDemoPdf(['A']), 'application/pdf');
  const b = await store.save(makeDemoPdf(['A']), 'application/pdf');
  const c = await store.save(makeDemoPdf(['C']), 'application/pdf');
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(b.duplicate, true);
  assert.equal(b.file.id, a.file.id);
  assert.equal(store.count, 2);
  const names = readdirSync(store.dir);
  assert.ok(names.every((n) => /^[0-9a-f-]{36}\.pdf$/.test(n)), names.join(','));
  const bad = await store.save(Buffer.from('no soy un pdf'), 'application/pdf');
  assert.equal(bad.ok, false);
  await store.cleanup();
  assert.equal(existsSync(store.dir), false);
  assert.equal(store.get(a.file.id), undefined);
  assert.throws(() => new JobFileStore(cfg.tmpDir, '../../etc'), /jobId inválido/);
});

test('detección de login: una sola señal no alcanza', () => {
  const p = testProvider();
  const login = snap({ url: 'http://127.0.0.1/lwcloud/fake/login', hasPasswordField: true, elements: [el('1', 'Entrar', { isSubmit: true, inPasswordForm: true })] });
  assert.equal(evaluateLogin(login, p).authenticated, false);

  // Cambió la URL pero sigue el formulario (p. ej. error de contraseña en otra ruta).
  assert.equal(evaluateLogin({ ...login, url: 'http://127.0.0.1/lwcloud/fake/validar' }, p).authenticated, false);

  // Sin contraseña visible, pero sin ninguna otra señal (página intermedia en blanco).
  assert.equal(evaluateLogin(snap({ url: 'http://127.0.0.1/lwcloud/fake/login' }), p).authenticated, false);

  const inside = snap({
    hintHits: ['RESULTADOS ONLINE'],
    elements: [el('2', 'Cerrar sesión')],
    collections: [{ id: 'c', frame: 0, kind: 'table', headers: ['Fecha'], rows: [['28/05/2026', 'x']], rowCount: 1 }],
  });
  const r = evaluateLogin(inside, p);
  assert.equal(r.authenticated, true);
  assert.equal(r.score, 5);
});

test('fechas y columnas del listado de estudios', () => {
  assert.equal(parseDate('28/05/2026'), '2026-05-28');
  assert.equal(parseDate('14-01-26'), '2026-01-14');
  assert.equal(parseDate('31/02/2026'), undefined);
  const c = {
    id: 'c0-0', frame: 0, kind: 'table' as const,
    headers: ['Fecha', 'N° Protocolo', 'Fecha entrega', 'Estado', 'Paciente', ''],
    rows: [
      ['28/05/2026', '00012345', '30/05/2026', 'Finalizado', 'PEREZ JUAN', 'Ver'],
      ['14/01/2026', '00009876', '16/01/2026', 'Parcial', 'PEREZ JUAN', 'Ver'],
      ['Total: 2', '', '', '', '', ''],
    ],
    rowCount: 3,
  };
  assert.deepEqual(inferColumns(c), { date: 0, protocol: 1, deliveryDate: 2, status: 3 });
  // El modelo propone mal la fecha (columna de nombres): se corrige con la inferencia local.
  const cols = resolveColumns(c, { date: 4, protocol: 1 });
  assert.equal(cols.date, 0);
  const studies = extractStudies('job', 'percamb', c, cols);
  assert.equal(studies.length, 2, 'la fila de totales se descarta');
  assert.deepEqual(studies[0].study, { id: studies[0].study.id, provider: 'percamb', date: '2026-05-28', protocol: '00012345', deliveryDate: '2026-05-30', status: 'Finalizado' });
  assert.ok(!JSON.stringify(studies).includes('PEREZ'), 'no se toman nombres');
  // Si el modelo apunta "estado" a la columna de nombres, no se filtra el nombre.
  const wrong = extractStudies('job', 'percamb', c, { ...cols, status: 4 });
  assert.ok(!JSON.stringify(wrong).includes('PEREZ'));
});
