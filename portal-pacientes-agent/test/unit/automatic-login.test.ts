import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateLogin, waitForLogin } from '../../src/browser/login-detector.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { percamb } from '../../src/providers/percamb/percamb.provider.js';
import { rdcChacabuco } from '../../src/providers/rdcchacabuco/rdcchacabuco.provider.js';
import { FakePort, snap, el, testProvider } from '../helpers.js';

const table = { id: 'c', frame: 0, kind: 'table' as const, headers: ['Fecha del estudio', 'Estudio', 'Modalidad'], rows: [['01/01/2026', 'QA sintético', 'SC']], rowCount: 1 };
const inside = snap({ url: centroDm.loginUrl, hintHits: ['MIS ESTUDIOS'], collections: [table] });
test('RDC reconoce Sus estudios realizados en index.php#/grilla sin depender del cambio de ruta', () => {
  const grid = snap({ url: rdcChacabuco.loginUrl + '#/grilla', hintHits: ['SUS ESTUDIOS REALIZADOS'], elements: [el('out', 'Salir')],
    collections: [{ ...table, headers: ['Tipo de Estudio', 'Descripción', 'Fecha del Estudio', 'Acciones'] }] });
  const result = evaluateLogin(grid, rdcChacabuco);
  assert.equal(result.authenticated, true); assert.equal(result.signals.leftLoginUrl, false);
  assert.equal(evaluateLogin({ ...grid, hintHits: [], collections: [] }, rdcChacabuco).authenticated, false);
  for (const flag of ['hasPasswordField', 'captcha', 'otp', 'modal']) assert.equal(evaluateLogin({ ...grid, [flag]: true }, rdcChacabuco).authenticated, false);
});
test('Pérez Cambet reconoce el ingreso en /rol con RESULTADOS ONLINE y descarta rutas o desafíos ajenos', async () => {
  const results = snap({
    url: 'https://www.biodatasa.com.ar/lwcloud/percamb/rol',
    headings: ['RESULTADOS ONLINE'],
  });
  assert.equal(evaluateLogin(results, percamb).authenticated, true);
  assert.equal(await waitForLogin(new FakePort(results), percamb, { timeoutMs: 1000, pollMs: 1, signal: new AbortController().signal }), 'authenticated');
  assert.equal(evaluateLogin({ ...results, url: 'https://example.test/lwcloud/percamb/rol' }, percamb).authenticated, false);
  assert.equal(evaluateLogin({ ...results, url: percamb.loginUrl }, percamb).authenticated, false);
  for (const flag of ['hasPasswordField', 'captcha', 'otp', 'modal']) {
    assert.equal(evaluateLogin({ ...results, [flag]: true }, percamb).authenticated, false);
  }
});
test('Centro DM reconoce bienvenida con acciones verificadas aunque el logout sea un ícono', () => {
  const welcome = snap({ url: centroDm.loginUrl, hintHits: ['ESTUDIOS', 'BIENVENIDO A TU PORTAL DE ESTUDIOS'], centroDmStudyList: true });
  assert.equal(evaluateLogin(welcome, centroDm).authenticated, true);
  assert.equal(evaluateLogin({ ...welcome, centroDmStudyList: false }, centroDm).authenticated, false);
  assert.equal(evaluateLogin({ ...welcome, hintHits: ['ESTUDIOS'] }, centroDm).authenticated, false);
  for (const flag of ['hasPasswordField', 'captcha', 'otp', 'modal']) assert.equal(evaluateLogin({ ...welcome, [flag]: true }, centroDm).authenticated, false);
});
test('Centro DM admite dos señales del listado en la misma URL; un logo o página vacía no alcanza', () => {
  assert.equal(evaluateLogin(inside, centroDm).authenticated, true);
  for (const value of [snap({ url: centroDm.loginUrl, hintHits: ['ESTUDIOS'] }), snap({ url: centroDm.loginUrl, hintHits: ['ESTUDIOS'], collections: [table] }), snap({ url: centroDm.loginUrl, hintHits: ['PERFIL'] })]) {
    assert.equal(evaluateLogin(value, centroDm).authenticated, false);
  }
  assert.equal(evaluateLogin(snap({ url: centroDm.loginUrl, hintHits: ['CERRAR SESIÓN'], noResultsText: true, elements: [el('out', 'Cerrar sesión')] }), centroDm).authenticated, true);
});
test('ningún desafío incompleto o formulario visible autentica aunque aparezcan resultados', () => {
  for (const flag of ['captcha', 'otp', 'hasPasswordField', 'modal']) {
    assert.equal(evaluateLogin({ ...inside, [flag]: true }, centroDm).authenticated, false);
  }
  assert.equal(evaluateLogin(snap({ hintHits: ['ESTUDIOS'] }), testProvider()).authenticated, false);
});
test('el detector exige lecturas consecutivas, reinicia ante error y no acepta una señal aislada', async () => {
  const values = [inside, null, inside, snap(), inside, inside]; let reads = 0;
  const port = new FakePort(inside);
  port.snapshot = async () => { const value = values[reads++]; if (!value) throw new Error('QA'); return value; };
  assert.equal(await waitForLogin(port, centroDm, { timeoutMs: 1000, pollMs: 1, signal: new AbortController().signal }), 'authenticated');
  assert.equal(reads, 6);
});
test('ambigüedad vence y cancelación aborta sin confirmar login', async () => {
  const port = new FakePort(snap({ url: centroDm.loginUrl, hintHits: ['ESTUDIOS'] }));
  assert.equal(await waitForLogin(port, centroDm, { timeoutMs: 5, pollMs: 1, signal: new AbortController().signal }), 'timeout');
  const abort = new AbortController(); abort.abort();
  assert.equal(await waitForLogin(port, centroDm, { timeoutMs: 1000, signal: abort.signal }), 'aborted');
});
