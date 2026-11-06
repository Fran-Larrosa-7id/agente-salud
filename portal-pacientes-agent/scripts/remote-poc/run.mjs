// Standalone synthetic experiment. Never starts the Portal app or loads its env files.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdir, chmod, open } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { configurePageDisplay } from '../../src/browser/display-profile.ts';
import { RemoteDesktop } from '../../src/server/remote-desktop.ts';
import { ImportJob } from '../../src/jobs/job.ts';
import { JobState } from '../../src/jobs/states.ts';
import { loadConfig } from '../../src/config.ts';
import { decodeMarker, observationSummary, rawMarkerSamples } from './metrics.mjs';
import { processMonitor } from './processes.mjs';
import { functionalChecks } from './functional.mjs';

const variants = ['source_xvfb', 'source_kasm', 'novnc_legacy', 'novnc_damage', 'kasm_image', 'kasm_h264', 'kasm_h265', 'kasm_av1'];
const variant = process.env.POC_VARIANT || 'novnc_damage', profile = process.env.POC_PROFILE || 'desktop';
const transport = process.env.POC_PATH || 'direct', scale = process.env.POC_SCALE || 'native';
const seconds = Number(process.env.POC_SECONDS || 20), warmup = Number(process.env.POC_WARMUP || 5);
if (process.platform !== 'linux' || !variants.includes(variant) || !['desktop', 'mobile'].includes(profile) || !['direct', 'portal_proxy'].includes(transport) || !['native', 'half'].includes(scale)) throw Error('Invalid PoC platform/options');
if (![seconds, warmup].every(Number.isInteger) || seconds < 5 || seconds > 120 || warmup < 1 || warmup > 30) throw Error('Invalid PoC duration');
if (transport === 'portal_proxy' && !variant.startsWith('novnc')) throw Error('KasmVNC does not use the Portal RFB proxy; use direct');
const kasm = variant.includes('kasm'), sourceOnly = variant.startsWith('source_');
const videoMode = ({ kasm_h264: { codec: 'h264', id: '-1027', prefix: /^(avc)/i, quality: '34' },
  kasm_h265: { codec: 'h265', id: '-1032', prefix: /^(hvc1|hev1)/i, quality: '34' },
  kasm_av1: { codec: 'av1', id: '-1037', prefix: /^av01/i, quality: '46' } })[variant];
const preview = process.env.POC_PREVIEW === '1';
if (preview && (!kasm || sourceOnly || transport !== 'direct')) throw Error('Preview is restricted to the isolated Kasm variants');
const framebuffer = profile === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 1000 };
const viewport = profile === 'mobile' ? { width: 390, height: 720 } : { width: 1180, height: 820 };
const dir = path.dirname(new URL(import.meta.url).pathname), root = '/tmp/remote-poc';
const sourceDirectory = `${root}/source`, clientDirectory = `${root}/client`;
const children = [], servers = [], requests = [], diagnosticCodecs = [], errors = [];
process.umask(0o077);
let sourceContext, clientContext, remote, ffmpeg, monitor, traceSession, traceFile, checkKasmSocket;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  child.on('error', error => { errors.push(`${command}:${error.code}`); console.error(command, error.code); });
  children.push(child); return child;
}
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await wait(100); }
  throw Error(`Not ready: ${label}`);
}
async function shutdown(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
  });
}
const checkOrigin = url => ['http://127.0.0.1:6089', 'https://127.0.0.1:8444'].includes(new URL(url).origin);
try {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(`${process.env.HOME}/.pki/nssdb`, { recursive: true, mode: 0o700 });
  const auth = `${root}/Xauthority`;
  await writeFile(auth, '', { mode: 0o600 });
  process.env.DISPLAY = ':91'; process.env.XAUTHORITY = auth;
  execFileSync('xauth', ['-f', auth, 'add', ':91', '.', randomBytes(16).toString('hex')], { stdio: ['ignore', 'ignore', 'inherit'] });
  const vncPassword = randomBytes(24).toString('hex');
  const xArgs = [':91', '-geometry', `${framebuffer.width}x${framebuffer.height}`, '-depth', '24', '-auth', auth, '-nolisten', 'tcp'];
  if (kasm) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=remote-poc',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-keyout', `${root}/key.pem`, '-out', `${root}/cert.pem`], { stdio: ['ignore', 'ignore', 'inherit'] });
    await chmod(`${root}/key.pem`, 0o600);
    // Trust only this container's ephemeral certificate, without ignoreHTTPSErrors or browser flags bypassing TLS.
    execFileSync('certutil', ['-N', '--empty-password', '-d', `sql:${process.env.HOME}/.pki/nssdb`], { stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('certutil', ['-A', '-d', `sql:${process.env.HOME}/.pki/nssdb`, '-n', 'remote-poc', '-t', 'C,,', '-i', `${root}/cert.pem`]);
    execFileSync('kasmvncpasswd', ['-u', 'synthetic', '-w', `${root}/kasmpasswd`], { input: `${vncPassword}\n${vncPassword}\n`, stdio: ['pipe', 'ignore', 'inherit'] });
    run('Xkasmvnc', [...xArgs, '-interface', preview ? '0.0.0.0' : '127.0.0.1', '-websocketPort', '8444', '-httpd', '/usr/share/kasmvnc/www',
      '-KasmPasswordFile', `${root}/kasmpasswd`, '-SecurityTypes', 'None', '-cert', `${root}/cert.pem`, '-key', `${root}/key.pem`, '-sslOnly', '1',
      '-FrameRate', '60', '-AcceptSetDesktopSize', '0', '-VideoCodec', videoMode?.codec || 'h264', '-VideoQualityCRFCQP', '17',
      '-SendCutText', '0', '-AcceptCutText', '0', '-http-header', 'Cross-Origin-Embedder-Policy=require-corp',
      '-http-header', 'Cross-Origin-Opener-Policy=same-origin', '-Log', '*:stderr:30']);
  } else run('Xvfb', [':91', '-screen', '0', `${framebuffer.width}x${framebuffer.height}x24`, '-auth', auth, '-nolisten', 'tcp']);
  await until(async () => { try { execFileSync('xdpyinfo', ['-display', ':91'], { stdio: 'ignore' }); return true; } catch { return false; } }, 'X display');
  if (kasm) {
    const ca = await readFile(`${root}/cert.pem`);
    async function status(authorization, socketPath) {
      return new Promise((resolve, reject) => {
        const headers = authorization ? { authorization } : {};
        if (socketPath) Object.assign(headers, { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' });
        const req = httpsRequest({ hostname: '127.0.0.1', port: 8444, path: socketPath || '/', ca, timeout: 2000,
          headers }, res => { res.resume(); resolve(res.statusCode); });
        req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
        req.on('error', reject); req.on('timeout', () => req.destroy(Error('TLS preflight timeout'))); req.end();
      });
    }
    // Basic Auth is mandatory even though the inner legacy VNC challenge is unused.
    await until(async () => { try { return await status() === 401; } catch { return false; } }, 'authenticated HTTPS server');
    if (await status('Basic ' + Buffer.from(`synthetic:${vncPassword}`).toString('base64')) !== 200) throw Error('Kasm HTTPS authentication failed');
    checkKasmSocket = async socketUrl => {
      const url = new URL(socketUrl);
      if (url.hostname !== '127.0.0.1' || url.port !== '8444') throw Error('Unexpected Kasm WebSocket target');
      if (await status(undefined, url.pathname + url.search) !== 401) throw Error('Unauthenticated Kasm WebSocket was not rejected with 401');
    };
  }
  const ownerToken = randomBytes(24).toString('hex');
  const sourceHtml = await readFile(path.join(dir, 'scene.html'), 'utf8');
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:6089');
    if (url.pathname === '/scene') { res.setHeader('Content-Type', 'text/html'); res.end(sourceHtml); return; }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><style>html,body,#target{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="target"></div><textarea id="input" style="position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:.01" aria-label="Synthetic mobile keyboard"></textarea><script type="module">
      import RFB from '/novnc/core/rfb.js';import { mobileKeyboard } from '/keyboard.js';
      const ws=${JSON.stringify(transport === 'direct' ? 'ws://127.0.0.1:6080' : '__PROXY__')};
      const r=new RFB(document.querySelector('#target'),ws==='__PROXY__'?window.__pocProxy:ws);r.scaleViewport=${scale === 'half'};r.resizeSession=false;
      r.addEventListener('connect',()=>window.__connected=true);window.__rfb=r;
      const toggle=document.createElement('button'),tools=document.createElement('div');tools.hidden=true;
      mobileKeyboard({input:document.querySelector('#input'),toggle,tools,desktop:document.querySelector('#target'),connection:()=>r});window.__openKeyboard=()=>toggle.click();
      </script>`); return;
    }
    const prefix = url.pathname.startsWith('/remote-assets/') ? '/remote-assets' : '/novnc';
    const file = url.pathname === '/keyboard.js' ? '/app/portal-pacientes-agent/src/server/remote-keyboard.js'
      : path.resolve('/usr/share/novnc', '.' + url.pathname.slice(prefix.length));
    if (url.pathname !== '/keyboard.js' && ((!url.pathname.startsWith('/novnc/') && !url.pathname.startsWith('/remote-assets/')) || !file.startsWith('/usr/share/novnc/'))) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  }); servers.push(httpServer);
  await new Promise(resolve => httpServer.listen(6089, '127.0.0.1', resolve));
  sourceContext = await chromium.launchPersistentContext(sourceDirectory, { headless: false, chromiumSandbox: true, viewport, deviceScaleFactor: 1, hasTouch: profile === 'mobile', args: ['--disable-features=Translate', '--no-default-browser-check', '--window-position=0,0'] });
  await sourceContext.route('**/*', route => checkOrigin(route.request().url()) ? route.continue() : route.abort());
  const source = sourceContext.pages()[0];
  await source.goto('http://127.0.0.1:6089/scene');
  const geometry = await configurePageDisplay(source, profile === 'mobile' ? 'mobile' : 'desktop', viewport.width, viewport.height);
  if (geometry.x + geometry.width > framebuffer.width || geometry.y + geometry.height > framebuffer.height) throw Error('Content does not fit native framebuffer');
  let proxyUrl;
  if (!kasm && !sourceOnly) {
    // Real production stream proxy and x11vnc launcher, using an in-memory synthetic job.
    const job = new ImportJob('percamb', 'Synthetic', 'poc-owner');
    job.transition(JobState.OPENING_PROVIDER); job.transition(JobState.WAITING_FOR_USER_LOGIN);
    remote = new RemoteDesktop();
    remote.authorizeWith({ owner: req => (req.headers.cookie || '').split(';').some(c => c.trim() === `poc_owner=${ownerToken}`) ? 'poc-owner' : undefined }, loadConfig({ LOG_LEVEL: 'silent' }, []));
    remote.attach(httpServer, { get: id => id === job.id ? job : undefined });
    process.env.REMOTE_CAPTURE_MODE = variant === 'novnc_legacy' ? 'legacy' : 'shm_damage';
    const token = await remote.start(job); proxyUrl = `ws://127.0.0.1:6089/remote/${job.id}/socket`;
    requests.push({ name: 'portal_remote', value: token, url: 'http://127.0.0.1:6089', httpOnly: true, sameSite: 'Strict' }, { name: 'poc_owner', value: ownerToken, url: 'http://127.0.0.1:6089', httpOnly: true, sameSite: 'Strict' });
  }
  let client, wireBytes = 0, wireMessages = 0, countingWire = false;
  const socketUrls = [];
  if (!sourceOnly) {
    clientContext = await chromium.launchPersistentContext(clientDirectory, { headless: true, chromiumSandbox: true,
      viewport: { width: Math.round(framebuffer.width * (scale === 'half' ? .5 : 1)), height: Math.round(framebuffer.height * (scale === 'half' ? .5 : 1)) },
      hasTouch: profile === 'mobile', httpCredentials: kasm ? { username: 'synthetic', password: vncPassword, origin: 'https://127.0.0.1:8444' } : undefined,
      ...(process.env.POC_RECORD_VIDEO === '1' ? { recordVideo: { dir: '/out/video', size: framebuffer } } : {}) });
    await clientContext.route('**/*', route => checkOrigin(route.request().url()) ? route.continue() : route.abort());
    if (requests.length) await clientContext.addCookies(requests);
    await clientContext.addInitScript(({ proxyUrl }) => {
      window.__pocProxy = proxyUrl; window.__decoderOutputs = 0; window.__decoderCodecs = []; window.__decoderOutputCodecs = [];
      if (window.VideoDecoder) {
        const Native = window.VideoDecoder;
        window.VideoDecoder = class extends Native {
          constructor(init) { const state = { codec: '' }; super({ ...init, output: frame => { window.__decoderOutputs++; window.__decoderOutputCodecs.push(state.codec); init.output(frame); } }); this.__pocState = state; }
          configure(config) { this.__pocState.codec = config.codec; window.__decoderCodecs.push(config.codec); return super.configure(config); }
        };
      }
    }, { proxyUrl });
    client = clientContext.pages()[0];
    client.on('pageerror', error => { errors.push(error.message); console.error('viewer_error', error.message); });
    client.on('websocket', socket => { socketUrls.push(socket.url()); socket.on('framereceived', frame => { if (countingWire) { wireMessages++; wireBytes += Buffer.byteLength(frame.payload); } }); });
    const params = new URLSearchParams({ autoconnect: '1', resize: scale === 'half' ? 'scale' : 'off', video_rendering_mode: 'canvas2d', enable_webrtc: 'false',
      kasmvnc_mode_preference: videoMode?.id || 'image', framerate_image_mode: '60', framerate_streaming_mode: '60',
      video_stream_quality: videoMode?.quality || '34', max_video_resolution_x: String(framebuffer.width), max_video_resolution_y: String(framebuffer.height), clipboard_up: 'false', clipboard_down: 'false' });
    await client.goto(kasm ? `https://127.0.0.1:8444/?${params}` : 'http://127.0.0.1:6089/');
    await client.waitForFunction(({ width, height }) => Array.from(document.querySelectorAll('canvas')).some(c => c.width === width && c.height === height && c.getBoundingClientRect().width > 0), framebuffer, { timeout: 30000 });
    await wait(warmup * 1000);
    await client.evaluate(() => { window.__decoderOutputCodecs = []; });
    if (kasm) {
      if (!socketUrls.length) throw Error('No Kasm WebSocket observed');
      await checkKasmSocket(socketUrls[0]);
    }
    if (videoMode) {
      // Exclude startup codec-capability probes from proof of actual decoding.
      await client.waitForFunction(prefix => window.__decoderOutputCodecs.filter(c => new RegExp(prefix, 'i').test(c)).length > 30, videoMode.prefix.source, { timeout: 15000 });
    }
  } else await wait(warmup * 1000);
  // Native X11 sampling is in a SEPARATE pass, so it does not distort client FPS.
  const nativeSamples = [];
  const nativePass = sourceOnly || process.env.POC_NATIVE_SAMPLE === '1';
  if (nativePass) {
    let pending = Buffer.alloc(0); const frameBytes = 264 * 12 * 3;
    ffmpeg = run('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-f', 'x11grab', '-framerate', '60', '-video_size', `${framebuffer.width}x${framebuffer.height}`, '-i', ':91',
      '-vf', `crop=264:12:${geometry.x + 8}:${geometry.y + 8}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    ffmpeg.stdout.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameBytes) {
        nativeSamples.push(rawMarkerSamples(pending.subarray(0, frameBytes), performance.now())); pending = pending.subarray(frameBytes);
      }
    });
  }
  if (process.env.POC_TRACE === '1') {
    traceSession = await sourceContext.newCDPSession(source);
    await traceSession.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,viz', transferMode: 'ReturnAsStream' });
  }
  monitor = processMonitor(sourceDirectory, clientDirectory); await monitor.start();
  const started = performance.now(), sourceStart = await source.evaluate(() => window.synthetic.frames);
  if (client) await client.evaluate(() => { window.__decoderOutputCodecs = []; });
  countingWire = true;
  let clientSamples = [];
  if (client) clientSamples = await client.evaluate(async ({ framebuffer, geometry, seconds, decode }) => {
    const decodeMarker = (0, eval)(`(${decode})`);
    const canvas = Array.from(document.querySelectorAll('canvas')).find(c => c.width === framebuffer.width && c.height === framebuffer.height && c.getBoundingClientRect().width > 0);
    const context = canvas.getContext('2d'); if (!context) throw Error('Visible framebuffer is not Canvas2D; do not report bogus FPS');
    const samples = [], start = performance.now();
    await new Promise(resolve => {
      function sample(now) {
        const pixels = context.getImageData(geometry.x + 8, geometry.y + 8, 264, 12).data;
        const id = decodeMarker((x, y) => pixels.subarray((y * 264 + x) * 4, (y * 264 + x) * 4 + 3));
        samples.push({ at: now - start, id });
        if (now - start < seconds * 1000) requestAnimationFrame(sample); else resolve();
      } requestAnimationFrame(sample);
    }); return samples;
  }, { framebuffer, geometry, seconds, decode: decodeMarker.toString() });
  else await wait(seconds * 1000);
  countingWire = false;
  const elapsedMs = performance.now() - started, sourceFrames = await source.evaluate(() => window.synthetic.frames) - sourceStart;
  if (ffmpeg) { await shutdown(ffmpeg); if (!nativeSamples.length) throw Error('No direct X11 samples received'); }
  const processes = await monitor.stop(); monitor = undefined;
  if (traceSession) {
    const completion = new Promise(resolve => traceSession.once('Tracing.tracingComplete', resolve));
    await traceSession.send('Tracing.end'); const { stream } = await completion;
    traceFile = '/out/source-trace.json'; const file = await open(traceFile, 'wx');
    try { while (true) { const chunk = await traceSession.send('IO.read', { handle: stream }); await file.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data); if (chunk.eof) break; } }
    finally { await file.close(); await traceSession.send('IO.close', { handle: stream }); }
  }
  if (client) diagnosticCodecs.push(...await client.evaluate(() => window.__decoderOutputCodecs));
  if (videoMode && diagnosticCodecs.filter(c => videoMode.prefix.test(c)).length < 30) throw Error('Insufficient video decoder output during the measured window');
  const functional = client && process.env.POC_FUNCTIONAL === '1'
    ? await functionalChecks({ source, client, sourceContext, framebuffer, geometry, kasm, mobile: profile === 'mobile' }) : null;
  const observed = observationSummary(clientSamples), native = observationSummary(nativeSamples);
  if (!sourceOnly && observed.changes < 2) throw Error('No coherent changing framebuffer; metrics invalid');
  if (sourceOnly && native.changes < 2) throw Error('No coherent changing native X11 framebuffer; metrics invalid');
  const output = { schemaVersion: 1, variant, profile, transport, scale, framebuffer, geometry, elapsedMs,
    chromiumVersion: sourceContext.browser()?.version() || null,
    instrumentation: { nativeSampling: nativePass, trace: !!traceFile, videoRecording: process.env.POC_RECORD_VIDEO === '1' },
    generatedCallbacksPerSecond: sourceFrames * 1000 / elapsedMs, client: observed, nativeX11: nativePass ? native : null,
    websocketPayloadBytes: wireBytes, websocketMessages: wireMessages, payloadBytesPerSecond: wireBytes * 1000 / elapsedMs,
    processes, decoderCodecs: [...new Set(diagnosticCodecs)], decoderOutputsDuringMeasurement: diagnosticCodecs.length, errors, traceFile, functional,
    caveats: ['Generator callbacks are not presented Chromium FPS.', 'Canvas sampling limits observations and adds cost.', 'Native X11 sampling adds readback/ffmpeg load; compare separate passes.', 'RSS sums shared pages; CPU excludes exited processes.', 'WebSocket payload excludes TLS/TCP overhead; no inbound backlog measured.', 'Codec requested must also be negotiated and decoded.'] };
  if (errors.length) throw Error(`Viewer/process errors detected (${errors.length}); see diagnostics`);
  writeSync(3, JSON.stringify(output, null, 2) + '\n');
  if (preview) {
    // Credentials are random, temporary and unrelated to any Portal/account secret.
    await writeFile(`${root}/preview-access.json`, JSON.stringify({ username: 'synthetic', password: vncPassword }), { mode: 0o600 });
    await clientContext.close(); clientContext = undefined;
    console.error('Synthetic preview ready; use only fake input. Expires in 20 minutes.');
    await new Promise(resolve => {
      const timer = setTimeout(done, 20 * 60 * 1000);
      function done() { clearTimeout(timer); process.removeListener('SIGTERM', done); process.removeListener('SIGINT', done); resolve(); }
      process.once('SIGTERM', done); process.once('SIGINT', done);
    });
  }
} finally {
  if (monitor) await monitor.stop().catch(() => {});
  await clientContext?.close(); await remote?.stop(); await sourceContext?.close();
  for (const child of [...children].reverse()) await shutdown(child);
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
