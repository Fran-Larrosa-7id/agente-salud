import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildObservation } from '../../src/agent/observation.js';
import { DomainPolicy } from '../../src/security/domain-policy.js';
import { formatLine } from '../../src/security/logger.js';
import { cellShape, maskCell, maskLabel, maskPath, maskText } from '../../src/security/sanitize.js';
import { el, snap, testProvider } from '../helpers.js';

test('maskText oculta DNI, fechas, emails y números de protocolo', () => {
  const out = maskText('DNI 30.111.222 · protocolo 0012345 del 28/05/2026 · juan@mail.com');
  assert.ok(!/30\.111\.222|0012345|28\/05\/2026|juan@mail\.com/.test(out), out);
  assert.match(maskText('Paciente: PÉREZ JUAN CARLOS'), /Paciente: ‹dato›/);
  assert.match(maskText('Bienvenido Juan Pérez'), /Bienvenido ‹dato›/);
});

test('maskLabel conserva la interfaz y oculta nombres propios', () => {
  assert.equal(maskLabel('Ver en PDF'), 'Ver en PDF');
  assert.equal(maskLabel('RESULTADOS ONLINE'), 'RESULTADOS ONLINE');
  assert.equal(maskLabel('JUAN CARLOS PEREZ'), '‹texto›');
  assert.equal(maskLabel('María González'), '‹texto›');
});

test('las celdas de tablas se envían como forma, no como valor', () => {
  assert.equal(cellShape('28/05/2026'), 'fecha');
  assert.equal(cellShape('00012345'), 'número');
  assert.equal(cellShape('Finalizado'), 'interfaz');
  assert.equal(cellShape('Hemoglobina glicosilada elevada'), 'texto');
  assert.equal(maskCell('Juan Pérez'), '‹texto›');
  assert.equal(maskCell('Ver'), 'ver');
});

test('maskPath elimina query e identificadores', () => {
  assert.equal(maskPath('https://www.biodatasa.com.ar/lwcloud/percamb/resultado/123456?dni=30111222'), '/lwcloud/percamb/resultado/‹n›?…');
});

test('la observación que recibe el modelo no contiene datos personales', () => {
  const raw = snap({
    title: 'Resultados de PEREZ JUAN',
    headings: ['RESULTADOS ONLINE', 'Paciente: PEREZ JUAN · DNI 30111222'],
    elements: [el('f0-1', 'Ver', { collection: 'c0-0', row: 0 }), el('f0-2', 'JUAN PEREZ', { tag: 'a', role: 'link', href: 'http://127.0.0.1/perfil?dni=30111222' })],
    collections: [{ id: 'c0-0', frame: 0, kind: 'table', headers: ['Fecha', 'Protocolo', 'Paciente', 'Estado', ''], rows: [['28/05/2026', '00012345', 'PEREZ JUAN', 'Finalizado', 'Ver']], rowCount: 1 }],
  });
  const obs = buildObservation({
    raw,
    goal: { kind: 'DISCOVER_STUDIES' },
    step: 1,
    maxSteps: 30,
    remainingMs: 60_000,
    history: [],
    provider: testProvider(),
    policy: { goal: 'DISCOVER_STUDIES', domains: new DomainPolicy(['127.0.0.1']), targetOpened: false, downloadsUsed: 0, maxDownloads: 10 },
    openPages: 1,
  });
  const json = JSON.stringify(obs);
  for (const secret of ['PEREZ', 'JUAN', '30111222', '00012345', '28/05/2026']) assert.ok(!json.includes(secret), `se filtró ${secret}: ${json}`);
  assert.deepEqual(obs.collections[0].columnShapes.slice(0, 4), ['fecha', 'número', 'texto', 'interfaz']);
});

test('el logger solo acepta campos de la lista blanca y valores con forma de identificador', () => {
  // Campos no permitidos a propósito: el logger tiene que descartarlos en tiempo de ejecución.
  const fields = {
    provider: 'percamb',
    state: 'STUDIES_FOUND',
    count: 2,
    dni: '30111222',
    password: 'secreto',
    errorCode: 'Juan Pérez tiene diabetes',
  } as unknown as Parameters<typeof formatLine>[2];
  const line = formatLine('72abcdef-0000', 'studies_found', fields);
  assert.equal(line, '[72abcdef] studies_found provider=percamb state=STUDIES_FOUND count=2 errorCode=[redacted]');
});

test('los diagnósticos estructurales Centro DM permiten forma, no destino ni query', () => {
  const fields = {
    provider: 'centrodm',
    index: 0,
    tag: 'a',
    hrefPresent: true,
    hrefKind: 'llamadoURL',
    ancestorTr: true,
    url: 'https://estudios.centrodm.com.ar/funcion/llamadoURL.php?studyId=patient-secret',
  } as unknown as Parameters<typeof formatLine>[2];
  const line = formatLine('72abcdef-0000', 'centrodm_action', fields);
  assert.equal(line, '[72abcdef] centrodm_action provider=centrodm index=0 tag=a hrefPresent=true hrefKind=llamadoURL ancestorTr=true');
  assert.ok(!line.includes('patient-secret'));
});

test('allowlist de dominios', () => {
  const p = new DomainPolicy(['biodatasa.com.ar', 'www.biodatasa.com.ar'], ['fonts.gstatic.com']);
  assert.ok(p.isAllowedNavigation('https://www.biodatasa.com.ar/lwcloud/percamb/login'));
  assert.ok(!p.isAllowedNavigation('https://evil.biodatasa.com.ar.attacker.com/'));
  assert.ok(!p.isAllowedNavigation('https://fonts.gstatic.com/x'), 'los hosts estáticos no son navegables');
  assert.ok(p.isAllowedSubresource('https://fonts.gstatic.com/x.woff2'));
  assert.ok(!p.isAllowedSubresource('https://tracker.example.com/pixel.gif'));
  assert.ok(!p.isAllowedNavigation('javascript:alert(1)'));
  assert.ok(p.isAllowedNavigation('about:blank'), 'permite la página vacía transitoria');
  assert.ok(p.isAllowedNavigation('blob:https://www.biodatasa.com.ar/opaque-id'), 'blob originado en el laboratorio');
  assert.ok(!p.isAllowedNavigation('blob:https://otro-dominio.com/opaque-id'));
  assert.ok(!p.isAllowedNavigation('data:application/pdf;base64,JVBERi0='), 'data PDF solo durante una acción explícita');
  assert.ok(!p.isAllowedSubresource('data:application/pdf;base64,JVBERi0='), 'data PDF también queda fuera de la allowlist general');
  assert.ok(!p.isAllowedNavigation('edge://pdf-internals/'), 'no amplía la allowlist a páginas internas');
  assert.ok(DomainPolicy.isBrowserPdfViewer('edge://pdf-internals/'));
});

test('el detalle clínico se reemplaza por acciones sin valores ni filas', () => {
  const raw = snap({
    pageType: 'result_detail',
    title: 'Hemograma de PEREZ JUAN',
    headings: ['Hemoglobina 13,5 g/dL', 'Paciente: PEREZ JUAN'],
    collections: [{ id: 'clinical', frame: 0, kind: 'table', headers: ['Determinación', 'Resultado'], rows: [['Hemoglobina', '13,5 g/dL']], rowCount: 1 }],
    elements: [el('clinical-link', 'Hemoglobina 13,5 g/dL'), el('pdf-action', 'Ver en PDF')],
  });
  const obs = buildObservation({
    raw,
    goal: { kind: 'DOWNLOAD_STUDY', target: { studyId: 'opaque-id' } },
    step: 1,
    maxSteps: 30,
    remainingMs: 10_000,
    history: [],
    provider: testProvider(),
    policy: { goal: 'DOWNLOAD_STUDY', domains: new DomainPolicy(['127.0.0.1']), targetOpened: true, downloadsUsed: 0, maxDownloads: 10 },
    openPages: 1,
  });
  const output = JSON.stringify(obs);
  for (const secret of ['Hemoglobina', '13,5', 'PEREZ', 'Paciente']) assert.ok(!output.includes(secret));
  assert.equal(obs.elements.length, 1);
  assert.equal(obs.elements[0].label, 'Ver en PDF');
  assert.equal(obs.collections.length, 0);
  assert.equal(obs.page.title, 'Documento del estudio');
});
