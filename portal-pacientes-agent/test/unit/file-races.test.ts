import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JobFileStore } from '../../src/jobs/file-store.js';

test('deduplica escrituras concurrentes y cleanup impide recrear temporales', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'portal-race-'));
  const store = new JobFileStore(root, randomUUID());
  const pdf = Buffer.from('%PDF-1.4\nsynthetic\n%%EOF');
  try {
    const results = await Promise.all([store.save(pdf, 'application/pdf'), store.save(pdf, 'application/pdf')]);
    assert.ok(results.every(result => result.ok));
    assert.equal(store.count, 1);
    const pending = store.save(Buffer.from('%PDF-1.4\nother synthetic\n%%EOF'), 'application/pdf');
    await store.cleanup();
    await pending;
    await assert.rejects(access(store.dir));
    assert.deepEqual(await store.save(pdf, 'application/pdf'), { ok: false, reason: 'STORE_CLOSED' });
    assert.equal(store.count, 0);
  } finally { await store.cleanup(); await rm(root, { recursive: true, force: true }); }
});
