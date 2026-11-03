// Synthetic Linux-only benchmark. Never connects to patient services or accounts.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { configurePageDisplay } from '../src/browser/display-profile.ts';
import { captureArguments } from '../src/server/capture-mode.ts';

if (process.platform !== 'linux' || !process.env.DISPLAY) throw Error('Run on Linux under xvfb-run in an isolated container');
const variant = process.env.BENCH_VARIANT || 'baseline';
const profile = process.env.BENCH_PROFILE || 'mobile';
if (!['baseline', 'legacy', 'damage', 'shm', 'both', 'shm_damage', 'wait10'].includes(variant) || !['mobile', 'desktop'].includes(profile)) throw Error('Invalid benchmark variant or profile');
const duration = Number(process.env.BENCH_SECONDS || 12);
if (!Number.isInteger(duration) || duration < 5 || duration > 120) throw Error('BENCH_SECONDS must be 5..120');
const warmup = Number(process.env.BENCH_WARMUP_SECONDS || 3);
if (!Number.isInteger(warmup) || warmup < 1 || warmup > 120) throw Error('BENCH_WARMUP_SECONDS must be 1..120');
const noVnc = '/usr/share/novnc';
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end(`<!doctype html><style>html,body,#target{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="target"></div><script type="module">
      const NativeWebSocket=window.WebSocket;window.__bytes=0;window.__messages=0;window.__socket=null;
      window.WebSocket=function(...a){const socket=new NativeWebSocket(...a);window.__socket=socket;socket.addEventListener('message',e=>{window.__bytes+=e.data.size??e.data.byteLength??0;window.__messages++});return socket};window.WebSocket.prototype=NativeWebSocket.prototype;
      for(const key of ['CONNECTING','OPEN','CLOSING','CLOSED'])window.WebSocket[key]=NativeWebSocket[key];
      import RFB from '/core/rfb.js';const r=new RFB(document.getElementById('target'),'ws://127.0.0.1:6088');r.scaleViewport=true;r.resizeSession=false;
      r.addEventListener('connect',()=>window.__connected=true);r.addEventListener('disconnect',()=>window.__disconnected=true);
    </script>`);
  }
  const file = path.resolve(noVnc, '.' + url.pathname);
  if (!file.startsWith(noVnc + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await readFile(file); res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(6089, '127.0.0.1', resolve));
const children = [];
let sourceBrowser, clientBrowser;
const run = (cmd, args) => { const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] }); children.push(child); return child; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  sourceBrowser = await chromium.launch({ headless: false, chromiumSandbox: true, args: ['--disable-features=Translate', '--no-default-browser-check'] });
  const source = await sourceBrowser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  await source.setContent(`<style>*{box-sizing:border-box}body{margin:0}canvas{display:block}</style><canvas id="a"></canvas><script>
  const c=document.querySelector('canvas'),x=c.getContext('2d');let n=0;window.sourceFrames=0;
  function frame(){c.width=innerWidth;c.height=innerHeight;x.fillStyle='#f6f8fb';x.fillRect(0,0,c.width,c.height);
  for(let y=0;y<c.height;y+=42){x.fillStyle=(Math.floor((y+n*3)/42)%2)?'#d8eaf0':'#ffffff';x.fillRect(0,(y+n*3)%c.height,c.width,28)}
  x.fillStyle='#247c88';x.fillRect((n*7)%(c.width-70),100,70,70);n++;window.sourceFrames=n;
  for(let i=0;i<12;i++){x.fillStyle=(n&(1<<i))?'#ffffff':'#000000';x.fillRect(8+i*10,8,8,8)}requestAnimationFrame(frame)}requestAnimationFrame(frame);</script>`);
  const geometry = await configurePageDisplay(source, profile === 'mobile' ? 'mobile' : 'desktop', 390, 720);
  const clip = profile === 'mobile' ? ['-clip', `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`] : [];
  const args = ['-display', process.env.DISPLAY, '-localhost', '-rfbport', '5908', '-forever', '-nopw', '-quiet',
    ...(variant === 'damage' ? ['-noshm'] : captureArguments(({ baseline: 'legacy', both: 'shm_damage', wait10: 'legacy' })[variant] || variant)),
    ...(variant === 'wait10' ? ['-wait', '10'] : []), ...clip];
  run('x11vnc', args); run('websockify', ['127.0.0.1:6088', '127.0.0.1:5908']);
  await wait(1000);
  clientBrowser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const client = await clientBrowser.newPage({ viewport: profile === 'mobile' ? { width: 390, height: 720 } : { width: 1280, height: 1000 } });
  client.on('pageerror', error => console.error('Synthetic client:', error.message));
  await client.goto('http://127.0.0.1:6089/');
  await client.waitForFunction(() => globalThis.__connected === true, null, { timeout: 15000 });
  await client.waitForSelector('#target canvas');
  await wait(warmup * 1000);
  const offset = profile === 'mobile' ? { x: 0, y: 0 } : geometry;
  const sourceStart = await source.evaluate(() => globalThis.sourceFrames);
  const processSamples = [];
  const sampleTimer = setInterval(() => {
    try { processSamples.push(execFileSync('ps', ['-eo', 'comm,pcpu,rss'], { encoding: 'utf8' })); } catch { /* unavailable */ }
  }, 1000);
  const result = await client.evaluate(async ({ duration, offset }) => {
    const canvas = document.querySelector('#target canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const started = performance.now(), bytes = window.__bytes, messages = window.__messages;
    let previous = null, lastAt = 0, skipped = 0, reads = 0, backwards = 0; const intervals = [];
    await new Promise(resolve => {
      function sample(now) {
        const data = context.getImageData(offset.x + 12, offset.y + 12, 111, 1).data;
        let id = 0; for (let i = 0; i < 12; i++) if (data[i * 10 * 4] > 127) id |= 1 << i;
        if (previous !== null && id !== previous) { const delta = (id - previous + 4096) % 4096; if (delta < 2048) { skipped += delta - 1; if (lastAt) intervals.push(now - lastAt); lastAt = now; } else backwards++; }
        if (id !== previous && (previous === null || (id - previous + 4096) % 4096 < 2048)) previous = id;
        reads++;
        if (now - started < duration * 1000) requestAnimationFrame(sample); else resolve();
      } requestAnimationFrame(sample);
    });
    const elapsedMs = performance.now() - started; intervals.sort((a,b)=>a-b);
    const percentile = p => intervals.length ? intervals[Math.min(intervals.length-1, Math.floor(intervals.length*p))] : null;
    return { elapsedMs, observedChanges: intervals.length, observedFps: intervals.length*1000/elapsedMs, skippedSequenceNumbers: skipped, backwardsSamples: backwards, samples: reads,
      intervalMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, websocketBytes: window.__bytes-bytes, websocketMessages: window.__messages-messages, outboundBufferedBytes: window.__socket.bufferedAmount };
  }, { duration, offset });
  clearInterval(sampleTimer);
  const sourceFrames = (await source.evaluate(() => globalThis.sourceFrames)) - sourceStart;
  const processSummary = {};
  for (const sample of processSamples) for (const line of sample.split('\n').slice(1)) {
    const match = line.trim().match(/^(\S+)\s+([\d.]+)\s+(\d+)$/); if (!match) continue;
    const [, name, cpu, rss] = match; if (!/^(Xvfb|x11vnc|websockify|chromium|chrome|python3?)$/.test(name)) continue;
    const bucket = processSummary[name] ||= { cpuSum: 0, rssKiBSum: 0, processes: 0 };
    bucket.cpuSum += Number(cpu); bucket.rssKiBSum += Number(rss); bucket.processes++;
  }
  for (const bucket of Object.values(processSummary)) { bucket.meanCpuPercent = bucket.cpuSum / processSamples.length; bucket.meanRssKiB = bucket.rssKiBSum / processSamples.length; delete bucket.cpuSum; delete bucket.rssKiBSum; }
  console.log(JSON.stringify({ variant, profile, geometry, framebuffer: profile === 'mobile' ? { width: geometry.width, height: geometry.height } : { width: 1280, height: 1000 }, captureArguments: args, warmupSeconds: warmup, sourceFrames, sourceFps: sourceFrames*1000/result.elapsedMs, ...result, processSamples: processSamples.length, processes: processSummary }, null, 2));
} finally {
  await clientBrowser?.close(); await sourceBrowser?.close();
  for (const child of children) child.kill('SIGTERM');
  server.close();
}
