import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const median = values => { const a = values.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
export function summarize(records) {
  const groups = new Map();
  for (const r of records) {
    const key = [r.profile, r.variant, r.transport, r.scale, JSON.stringify(r.framebuffer), JSON.stringify(r.instrumentation || {})].join('|');
    const group = groups.get(key) || []; group.push(r); groups.set(key, group);
  }
  return Array.from(groups.values(), group => ({
    profile: group[0].profile, variant: group[0].variant, transport: group[0].transport, scale: group[0].scale, framebuffer: group[0].framebuffer,
    instrumentation: group[0].instrumentation, runs: group.length, generatedCallbacksPerSecond: median(group.map(r => r.generatedCallbacksPerSecond)),
    observedChangesPerSecond: median(group.map(r => r.client?.changesPerSecond)),
    nativeX11ChangesPerSecond: median(group.map(r => r.nativeX11?.changesPerSecond)),
    observedP95Ms: median(group.map(r => r.client?.intervalMs?.p95)),
    payloadBytesPerSecond: median(group.map(r => r.payloadBytesPerSecond)),
    invalidMarkers: group.map(r => r.client?.invalidMarkers ?? null), backwards: group.map(r => r.client?.backwards ?? null),
    processes: Object.fromEntries([...new Set(group.flatMap(r => Object.keys(r.processes || {})))].map(name => [name, {
      cpuPercent: median(group.map(r => r.processes?.[name]?.meanCpuPercent)),
      rssKiB: median(group.map(r => r.processes?.[name]?.meanRssKiB)),
    }])),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2]; if (!directory) throw Error('Usage: node summarize.mjs OUTPUT_DIRECTORY');
  const records = [], failed = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const r = JSON.parse(await readFile(path.join(directory, entry.name, 'metrics.json'), 'utf8'));
      if (r.schemaVersion !== 1 || !r.variant || !r.profile) throw Error('Unknown schema');
      records.push(r);
    } catch { failed.push(entry.name); }
  }
  if (!records.length) throw Error('No valid results');
  console.log(JSON.stringify({ groups: summarize(records), failedCases: failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}
