import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMarker, observationSummary, rawMarkerSamples } from './metrics.mjs';

test('redundant marker rejects mixed frames and undecidable colours', () => {
  const colour = (id, offset, x) => ((id & (1 << Math.floor((x - offset) / 6))) ? [255, 255, 255] : [0, 0, 0]);
  const reader = x => x < 88 ? colour(123, 0, x) : x < 176 ? colour(123, 88, x) : colour(123 ^ 4095, 176, x);
  assert.equal(decodeMarker(reader), 123);
  assert.equal(decodeMarker(x => x < 88 ? colour(122, 0, x) : reader(x)), null);
  assert.equal(decodeMarker(() => [128, 128, 128]), null);
  const raw = Buffer.alloc(264 * 12 * 3);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 264; x++) {
    const rgb = reader(x); raw.set(rgb, (y * 264 + x) * 3);
  }
  assert.equal(rawMarkerSamples(raw, 10).id, 123);
});

test('observations handle wrap, partial reads, repeated frames and backwards values', () => {
  const result = observationSummary([
    { at: 0, id: 4094 }, { at: 10, id: 4095 }, { at: 20, id: 0 },
    { at: 30, id: null }, { at: 40, id: 0 }, { at: 50, id: 4095 }, { at: 60, id: 2 },
  ]);
  assert.equal(result.changes, 3); assert.equal(result.invalidMarkers, 1);
  assert.equal(result.backwards, 1); assert.equal(result.duplicates, 1);
  assert.equal(result.unobservedSequenceNumbers, 1); assert.equal(result.changesPerSecond, 50);
  assert.equal(result.intervalMs.p95, 40);
  assert.equal(observationSummary([]).changesPerSecond, null);
});
