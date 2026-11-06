import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summarize.mjs';

test('summary keeps scale/path distinct and does not turn missing metrics into zero', () => {
  const base = { profile: 'desktop', variant: 'kasm_h264', transport: 'direct', scale: 'native', framebuffer: { width: 1280, height: 1000 } };
  const groups = summarize([
    { ...base, client: { changesPerSecond: 10, intervalMs: { p95: 80 } } },
    { ...base, client: { changesPerSecond: 30, intervalMs: { p95: 40 } } },
    { ...base, client: { changesPerSecond: 20, intervalMs: { p95: 50 } } },
    { ...base, scale: 'half', client: { changesPerSecond: 60 } },
  ]);
  assert.equal(groups.length, 2); assert.equal(groups[0].observedChangesPerSecond, 20);
  assert.equal(groups[0].observedP95Ms, 50); assert.equal(groups[0].generatedCallbacksPerSecond, null);
  assert.equal(groups[0].runs, 3); assert.equal(groups[1].observedChangesPerSecond, 60);
});
