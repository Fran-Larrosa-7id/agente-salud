import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

export function processMonitor(sourceDirectory, clientDirectory) {
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const previous = new Map(), groups = {};
  let timer, busy = false;
  async function sample() {
    if (busy) return; busy = true;
    try {
      const now = performance.now(), rows = new Map();
      for (const pid of (await readdir('/proc')).filter(name => /^\d+$/.test(name))) {
        try {
          const [stat, cmdline, status] = await Promise.all(['stat', 'cmdline', 'status'].map(file => readFile(`/proc/${pid}/${file}`, 'utf8')));
          const end = stat.lastIndexOf(')'), fields = stat.slice(end + 2).split(' ');
          rows.set(pid, { pid, ppid: fields[1], name: stat.slice(stat.indexOf('(') + 1, end),
            ticks: Number(fields[11]) + Number(fields[12]), start: fields[19], cmdline,
            rssKiB: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] || 0) });
        } catch { /* A process may exit between enumeration and read. */ }
      }
      function group(row, seen = new Set()) {
        if (seen.has(row.pid)) return null; seen.add(row.pid);
        if (row.cmdline.includes(`--user-data-dir=${sourceDirectory}`)) return 'chromium_source';
        if (row.cmdline.includes(`--user-data-dir=${clientDirectory}`)) return 'chromium_viewer';
        const parent = rows.get(row.ppid), inherited = parent && group(parent, seen);
        if (inherited?.startsWith('chromium_')) return inherited;
        if (['Xvfb', 'Xkasmvnc', 'x11vnc', 'ffmpeg', 'websockify'].includes(row.name)) return row.name;
        if (/websockify/.test(row.cmdline)) return 'websockify';
        return null;
      }
      const totals = {};
      for (const row of rows.values()) {
        const name = group(row); if (!name) continue;
        const bucket = totals[name] ||= { cpu: 0, rss: 0, matched: 0 };
        const old = previous.get(row.pid);
        if (old && old.start === row.start && now > old.at) {
          bucket.cpu += (row.ticks - old.ticks) / ticksPerSecond / ((now - old.at) / 1000) * 100; bucket.matched++;
        }
        bucket.rss += row.rssKiB;
        previous.set(row.pid, { start: row.start, ticks: row.ticks, at: now });
      }
      for (const [name, total] of Object.entries(totals)) {
        const result = groups[name] ||= { cpuSamples: [], rssKiBSamples: [] };
        if (total.matched) result.cpuSamples.push(total.cpu);
        result.rssKiBSamples.push(total.rss);
      }
    } finally { busy = false; }
  }
  return {
    async start() { await sample(); timer = setInterval(() => { void sample().catch(error => console.error('process_sample_failed', error.code)); }, 1000); },
    async stop() {
      clearInterval(timer); while (busy) await new Promise(resolve => setTimeout(resolve, 10)); await sample();
      return Object.fromEntries(Object.entries(groups).map(([name, { cpuSamples, rssKiBSamples }]) => [name, {
        cpuSamples: cpuSamples.length,
        meanCpuPercent: cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null,
        maxCpuPercent: cpuSamples.length ? Math.max(...cpuSamples) : null,
        meanRssKiB: rssKiBSamples.reduce((a, b) => a + b, 0) / rssKiBSamples.length,
        maxRssKiB: Math.max(...rssKiBSamples),
      }]));
    },
  };
}
