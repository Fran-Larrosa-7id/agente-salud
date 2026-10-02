import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../../src/config.js';

test('retener Pixeon es opt-in DEV y nunca se habilita en producción', () => {
  assert.equal(loadConfig({}, []).pixeonDebugKeepViewerOpen, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', PIXEON_DEBUG_KEEP_VIEWER_OPEN: 'true' }, []).pixeonDebugKeepViewerOpen, true);
  assert.equal(loadConfig({ NODE_ENV: 'production', PIXEON_DEBUG_KEEP_VIEWER_OPEN: 'true' }, []).pixeonDebugKeepViewerOpen, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', PIXEON_DEBUG_KEEP_VIEWER_OPEN: 'true', PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS: '90000' }, []).pixeonDebugKeepViewerOpenMs, 90_000);
  assert.equal(loadConfig({ NODE_ENV: 'development', PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS: '240000' }, []).pixeonDebugKeepViewerOpenMs, 120_000);
  assert.equal(loadConfig({ NODE_ENV: 'production', PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS: '90000' }, []).pixeonDebugKeepViewerOpenMs, 0);
});

test('timeout de toolbar Pixeon es configurable y usa 30 s por defecto', () => {
  assert.equal(loadConfig({}, []).pixeonToolbarTimeoutMs, 30_000);
  assert.equal(loadConfig({ PIXEON_TOOLBAR_TIMEOUT_MS: '12000' }, []).pixeonToolbarTimeoutMs, 12_000);
});
