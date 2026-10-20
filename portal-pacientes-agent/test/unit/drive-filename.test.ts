import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveFilenameBase, driveFilenameCandidates, studyFilenameDate } from '../../src/storage/drive-filename.js';

test('Drive filenames use the real study date, strict calendar validation and explicit missing-date fallback', () => {
  for (const date of ['2024-02-29', '29/02/2024', '29-02-2024', '29.02.2024', '2024-02-29T23:00:00.000-03:00']) assert.equal(studyFilenameDate(date), '2024-02-29');
  for (const date of ['2025-02-29', '31/04/2026', '2026-00-02', '2026-01-00', '20/10/26', '2026-10-20 DNI 1234', '2026-10-20T99:30:00Z']) assert.equal(studyFilenameDate(date), null);
  assert.equal(driveFilenameBase({ id: 'x', provider: 'centrodm', studyDate: '2026-10-20', date: '2026-10-21' }, 'PDF').base, '2026-10-20 - Centro DM - Informe');
  assert.equal(driveFilenameBase({ id: 'x', provider: 'percamb', studyDate: 'invalid', date: '20/10/2026' }, 'PDF').base, '2026-10-20 - Pérez Cambet - Informe');
  assert.equal(driveFilenameBase({ id: 'x', provider: 'rdcchacabuco' }, 'DICOM_ZIP').base, 'Sin fecha - RDC Chacabuco - Imágenes DICOM');
});

test('Drive filenames share PDF/ZIP rules across all three institutions and only use controlled study labels', () => {
  for (const [provider, institution] of [['centrodm', 'Centro DM'], ['percamb', 'Pérez Cambet'], ['rdcchacabuco', 'RDC Chacabuco']]) {
    assert.deepEqual(driveFilenameBase({ id: 'x', provider, date: '2026-10-20' }, 'PDF'), { base: '2026-10-20 - ' + institution + ' - Informe', extension: '.pdf' });
    assert.deepEqual(driveFilenameBase({ id: 'x', provider, date: '2026-10-20' }, 'DICOM_ZIP'), { base: '2026-10-20 - ' + institution + ' - Imágenes DICOM', extension: '.zip' });
  }
  assert.equal(driveFilenameBase({ id: 'x', provider: 'rdcchacabuco', studyType: 'ULTRASONIDO', title: 'ECOGRAFIA TIROIDES - PACIENTE XYZ' }, 'PDF').base, 'Sin fecha - RDC Chacabuco - Ecografía - Informe');
  assert.equal(driveFilenameBase({ id: 'x', provider: 'centrodm', title: 'Panorámica dental' }, 'DICOM_ZIP').base, 'Sin fecha - Centro DM - Panorámica dental - Imágenes DICOM');
  assert.equal(driveFilenameBase({ id: 'x', provider: 'centrodm', modality: 'SC' }, 'DICOM_ZIP').base, 'Sin fecha - Centro DM - Imágenes DICOM', 'do not infer a clinical type from an ambiguous modality');
});

test('Drive filenames never copy patient names/protocols, unsafe text, prototype keys or path/platform characters', () => {
  const study = { id: 'patient-id', provider: '__proto__', date: 'DNI-12345678', title: '../CON:<Juan Pérez>\u202e.pdf', studyType: 'constructor', protocol: '12345678' };
  const names = [...driveFilenameCandidates(study, { kind: 'PDF', sha256: 'a'.repeat(64) })];
  assert.equal(names[0], 'Sin fecha - Institución no disponible - Informe.pdf');
  for (const name of names) {
    assert.doesNotMatch(name, /12345678|Juan|patient-id|constructor|\.\.|[<>:"/\\|?*\p{Cc}\p{Cf}]/u);
    assert.ok(Buffer.byteLength(name, 'utf8') < 255); assert.equal(name, name.normalize('NFC'));
  }
});

test('collision candidates preserve extension and deterministically extend the short SHA suffix', () => {
  const study = { id: 'x', provider: 'centrodm', date: '2026-10-20' }, file = { kind: 'DICOM_ZIP' as const, sha256: 'abcdef01' + '2'.repeat(56) };
  const names = [...driveFilenameCandidates(study, file)];
  assert.equal(names[0], '2026-10-20 - Centro DM - Imágenes DICOM.zip');
  assert.equal(names[1], '2026-10-20 - Centro DM - Imágenes DICOM - abcdef01.zip');
  assert.match(names[2], /abcdef012222\.zip$/); assert.equal(new Set(names).size, 5);
  assert.deepEqual([...driveFilenameCandidates(study, file)], names);
});
