import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { JobFileStore } from '../../src/jobs/file-store.js';
import { hasZipMagic, validateMedicalArchive } from '../../src/jobs/medical-archive.js';
import { centroDm } from '../../src/providers/centrodm/centrodm.provider.js';
import { normalizeCentroDmDate } from '../../src/providers/centrodm/study-extractor.js';
import { centroDmSourceKey } from '../../src/providers/centrodm/source-key.js';
import { percamb } from '../../src/providers/percamb/percamb.provider.js';
import { DomainPolicy } from '../../src/security/domain-policy.js';
import { testConfig } from '../helpers.js';

test('Centro DM sourceKey es estable por ID del proveedor o metadata y no publica los valores', () => {
  const byId1 = centroDmSourceKey('08/04/2024', 'Reconstrucción 3D', 'SC', 'study-821');
  const byId2 = centroDmSourceKey('otra fecha', 'Otro título', 'MR', 'study-821');
  const byMetadata1 = centroDmSourceKey('08/04/2024', 'Reconstrucción 3D', 'SC');
  const byMetadata2 = centroDmSourceKey('08/04/2024', '  RECONSTRUCCIÓN   3D ', 'sc');
  assert.equal(byId1, byId2);
  assert.equal(byMetadata1, byMetadata2);
  assert.match(byId1 || '', /^[a-f0-9]{64}$/);
  assert.equal(byId1, createHash('sha256').update('centrodm|study-821').digest('hex'));
  assert.ok(!byId1?.includes('study-821'));
  assert.notEqual(byId1, byMetadata1);
});

test('Centro DM normaliza fechas dd/mm/aa tomando los años de dos dígitos como 2000–2099', () => {
  assert.equal(normalizeCentroDmDate('23/02/26'), '2026-02-23');
  assert.equal(normalizeCentroDmDate('08/04/24'), '2024-04-08');
  assert.equal(normalizeCentroDmDate('11/12/23'), '2023-12-11');
  assert.equal(normalizeCentroDmDate('01/01/99'), '2099-01-01');
  assert.equal(normalizeCentroDmDate('31/02/26'), undefined);
});

test('ZIP médico valida magic bytes y límites, no el nombre del archivo', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  assert.equal(hasZipMagic(zip), true);
  assert.deepEqual(validateMedicalArchive(zip, 'application/zip', 10), { ok: true });
  assert.deepEqual(validateMedicalArchive(Buffer.from('<html>error</html>'), 'application/zip'), { ok: false, reason: 'NOT_ZIP_BYTES' });
  assert.deepEqual(validateMedicalArchive(zip, 'application/zip', 4), { ok: false, reason: 'TOO_LARGE' });
  assert.deepEqual(validateMedicalArchive(Buffer.alloc(0), 'application/zip'), { ok: false, reason: 'EMPTY' });
});

test('almacenamiento conserva y deduplica ZIP DICOM por hash con extensión propia', async () => {
  const cfg = testConfig();
  const store = new JobFileStore(cfg.tmpDir, randomUUID(), 1024, 1024);
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const first = await store.save(bytes, 'application/zip', 'DICOM_ZIP');
  const second = await store.save(bytes, 'application/octet-stream', 'DICOM_ZIP');
  assert.ok(first.ok && second.ok);
  assert.equal(first.file.kind, 'DICOM_ZIP');
  assert.equal(first.file.mimeType, 'application/zip');
  assert.match(first.file.path, /\.zip$/);
  assert.equal(second.duplicate, true);
  await store.cleanup();
});

test('allowlist Centro DM bloquea viewer desconocido y acepta solo su origen HTTPS exacto', () => {
  const closed = new DomainPolicy(['estudios.centrodm.com.ar'], [], [], true);
  assert.equal(closed.isAllowedNavigation('https://estudios.centrodm.com.ar/indexp.php'), true);
  assert.equal(closed.isAllowedNavigation('https://viewer.example/aurora'), false);
  assert.equal(closed.isAllowedNavigation('http://estudios.centrodm.com.ar/indexp.php'), false);
  const configured = new DomainPolicy(centroDm.allowedHosts, centroDm.staticHosts, centroDm.allowedOrigins || [], centroDm.requireHttps);
  assert.equal(configured.isAllowedNavigation('https://curie.centrodm.com.ar:8090/aurora'), true);
  assert.equal(configured.isAllowedNavigation('https://curie.centrodm.com.ar/aurora'), false, 'el puerto 443/default no reemplaza al 8090 confirmado');
  assert.equal(configured.isAllowedNavigation('https://curie.centrodm.com.ar:8091/aurora'), false);
  assert.equal(configured.isAllowedNavigation('http://curie.centrodm.com.ar:8090/aurora'), false);
  assert.equal(configured.isAllowedNavigation('https://evil.example/aurora'), false);

  const percambPolicy = new DomainPolicy(percamb.allowedHosts, percamb.staticHosts, percamb.allowedOrigins || [], percamb.requireHttps);
  assert.equal(percambPolicy.isAllowedNavigation('https://curie.centrodm.com.ar:8090/aurora'), false);
});

test('CENTRODM_ALLOWED_ORIGINS admite orígenes HTTPS explícitos, no rutas ni comodines', () => {
  const config = loadConfig({ LLM_PROVIDER: 'rules', CENTRODM_ALLOWED_ORIGINS: 'https://curie.centrodm.com.ar:8090' }, []);
  assert.deepEqual(config.centroDmAllowedOrigins, ['https://curie.centrodm.com.ar:8090']);
  assert.equal(new URL(config.centroDmAllowedOrigins[0]).port, '8090');
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'rules', CENTRODM_ALLOWED_ORIGINS: 'https://*.example' }, []), /orígenes HTTPS explícitos/);
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'rules', CENTRODM_ALLOWED_ORIGINS: 'https://curie.centrodm.com.ar:8090/path' }, []), /orígenes HTTPS explícitos/);
});
