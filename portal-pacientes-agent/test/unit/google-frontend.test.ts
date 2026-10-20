import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { AGENT_ROOT } from '../../src/config.js';

async function frontend() {
  const values = new Map<string, string>(); const databases = new Map<string, Map<string, unknown>>();
  values.set('portal_pacientes_v1', JSON.stringify({ version: 2, session: { since: 'legacy' }, studies: [{ id: 'unassigned-legacy' }] }));
  const localStorage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const indexedDB = { open(name: string) {
    const request: any = {};
    queueMicrotask(() => {
      if (!databases.has(name)) databases.set(name, new Map()); const store = databases.get(name)!;
      request.result = { createObjectStore() {}, close() {}, transaction() {
        const tx: any = { objectStore() {
          const complete = (result?: unknown) => { const record = { result }; queueMicrotask(() => tx.oncomplete?.()); return record; };
          return { put(value: unknown, key: string) { store.set(key, value); return complete(); }, get(key: string) { return complete(store.get(key)); }, delete(key: string) { store.delete(key); return complete(); }, clear() { store.clear(); return complete(); } };
        } }; return tx;
      } };
      request.onupgradeneeded?.(); request.onsuccess?.();
    }); return request;
  } };
  const location = { origin: 'https://portal.test', hash: '#/login', reload() {}, replace() {} };
  const context = vm.createContext({ window: {}, localStorage, indexedDB, location, URLSearchParams, AbortSignal, Blob, Response, setTimeout, console,
    fetch: async () => new Response('{}'), document: { title: '' } });
  (context.window as any).indexedDB = indexedDB;
  const run = (file: string) => vm.runInContext(readFileSync(path.join(AGENT_ROOT, '../portal-pacientes/js', file), 'utf8'), context);
  run('data.js'); run('agent.js');
  const P: any = (context.window as any).P;
  Object.assign(P, { icon: () => '', logo: () => '', ui: {}, actions: {}, esc: (value: string) => value, cloudMessage: () => 'Error', syncCloudCatalog: async () => [] });
  run('auth.js');
  return { P, context, values, databases, run };
}

test('Frontend A to B to A isolates localStorage and IndexedDB and preserves unassigned legacy originals', async () => {
  const { P, values } = await frontend();
  P.applyIdentity('google', { id: 'a'.repeat(64) });
  assert.equal(P.db.studies.length, 0); assert.notEqual(P.STORE_KEY, 'portal_pacientes_v1');
  P.db.studies.push({ id: 'A-study' }); P.save(); assert.equal(await P.files.put('same-key', 'A-original'), true);
  P.applyIdentity('google', { id: 'b'.repeat(64) }); assert.equal(P.db.studies.length, 0); assert.equal(await P.files.get('same-key'), undefined);
  P.db.studies.push({ id: 'B-study' }); P.save(); await P.files.put('same-key', 'B-original');
  P.applyIdentity('google', { id: 'a'.repeat(64) }); assert.equal(P.db.studies[0].id, 'A-study'); assert.equal(await P.files.get('same-key'), 'A-original');
  P.applyIdentity('google', null); assert.equal(P.db.studies.length, 0); assert.equal(P.db.session, null); assert.equal(P.STORE_KEY, null);
  assert.ok(values.get('portal_pacientes_v1')!.includes('unassigned-legacy'));
  P.applyIdentity('pilot', null); assert.equal(P.db.studies[0].id, 'unassigned-legacy');
});

test('Frontend Google session and API outage never authenticate via demo or render pilot credentials', async () => {
  const { P, context } = await frontend();
  context.fetch = async () => new Response(JSON.stringify({ mode: 'google', enabled: true, authenticated: true, user: { id: 'a'.repeat(64), email: 'synthetic@example.test' }, storageProvider: 'google_drive', drive: 'disconnected' }));
  assert.equal(await P.prepareAuth(), true); assert.ok(P.db.session);
  assert.ok(P.renderLogin().includes('Continuar con Google')); assert.ok(!P.renderLogin().includes('1234')); assert.ok(!P.renderRecover().includes('1234'));
  context.fetch = async () => { throw new Error('synthetic offline'); };
  assert.equal(await P.prepareAuth(), false); assert.equal(P.portalAuthEnabled, true); assert.equal(P.db.session, null); assert.equal(P.googleUser, null);
  assert.equal(P.portalAuthUnavailable, true); assert.ok(!P.renderLogin().includes('1234'));
});
