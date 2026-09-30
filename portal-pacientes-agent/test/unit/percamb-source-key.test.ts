import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percambSourceKey } from '../../src/providers/percamb/source-key.js';

test('la clave de Percamb se mantiene estable al normalizar el protocolo', () => {
  const a = percambSourceKey('2026-05-28', 'PC-78308');
  const b = percambSourceKey('2026-05-28', 'pc 78308');
  assert.equal(a, b);
  assert.match(a || '', /^[a-f0-9]{64}$/);
});

test('un identificador estable en la referencia del resultado prevalece sobre metadatos cambiantes', () => {
  const a = percambSourceKey('2026-05-28', 'PC-78308', 'https://provider.invalid/ver_resultado/abc-123?session=old');
  const b = percambSourceKey('2027-01-01', 'OTRO', 'https://provider.invalid/ver_resultado/abc-123?session=new');
  assert.equal(a, b);
});

test('no crea una clave débil si faltan tanto la referencia estable como metadatos suficientes', () => {
  assert.equal(percambSourceKey('2026-05-28'), undefined);
  assert.equal(percambSourceKey(undefined, undefined, 'https://provider.invalid/ver_resultado?session=changing'), undefined);
});
