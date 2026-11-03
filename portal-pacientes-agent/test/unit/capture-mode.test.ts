import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureArguments } from '../../src/server/capture-mode.js';

test('capture modes use a fixed allowlist and retain legacy by default', () => {
  assert.deepEqual(captureArguments(undefined), ['-noxdamage', '-noshm']);
  assert.deepEqual(captureArguments('legacy'), ['-noxdamage', '-noshm']);
  assert.deepEqual(captureArguments('shm'), ['-noxdamage']);
  assert.deepEqual(captureArguments('shm_damage'), []);
  for (const value of ['', 'SHM', 'shm -nopw', '-rfbport 1']) assert.throws(() => captureArguments(value));
});
