import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { request, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ImportJob } from '../jobs/job.js';
import { JobState as S } from '../jobs/states.js';
import type { JobManager } from '../jobs/job-manager.js';
import { silentLogger, type Logger } from '../security/logger.js';

export function interactive(job: ImportJob | undefined): boolean {
  return !!job && (job.state === S.WAITING_FOR_USER_LOGIN || job.state === S.HUMAN_ACTION_REQUIRED);
}

interface Desktop {
  job: ImportJob;
  token: string;
  children: ChildProcess[];
  sockets: Set<Duplex>;
  listener: () => void;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function ready(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.setTimeout(200);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/** Un desktop efímero. Los bytes VNC se transportan sin interpretar ni registrar teclas/pantallas. */
export class RemoteDesktop {
  constructor(private readonly log: Logger = silentLogger) {}
  private active: Desktop | null = null;
  private pending: Promise<string> | null = null;
  private stopping: Promise<void> = Promise.resolve();

  async start(job: ImportJob): Promise<string> {
    if (!interactive(job)) throw new Error('DESKTOP_NOT_AVAILABLE');
    if (this.pending) return this.pending;
    if (this.active?.job.id === job.id) return this.active.token;
    this.pending = this.open(job).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async open(job: ImportJob): Promise<string> {
    const started = Date.now();
    this.log.info(job.id, 'desktop_preparing', { provider: job.provider, state: job.state });
    await this.stopping;
    if (this.active || !interactive(job) || !process.env.DISPLAY) {
      this.log.warn(job.id, 'desktop_error', { errorCode: 'DESKTOP_NOT_AVAILABLE', durationMs: Date.now() - started });
      throw new Error('DESKTOP_NOT_AVAILABLE');
    }
    const desktop: Desktop = { job, token: randomBytes(32).toString('hex'), children: [], sockets: new Set(), listener: () => {} };
    this.active = desktop;
    desktop.listener = () => { if (!interactive(job)) void this.stop(job.id); };
    job.on('event', desktop.listener);
    for (const [command, args] of [
      ['x11vnc', ['-display', process.env.DISPLAY, '-localhost', '-rfbport', '5900', '-forever', '-nopw', '-quiet', '-noxdamage', '-noshm']],
      ['websockify', ['127.0.0.1:6080', '127.0.0.1:5900']],
    ] as [string, string[]][]) {
      const child = spawn(command, args, { stdio: 'ignore' });
      desktop.children.push(child);
      child.once('error', () => { void this.stop(job.id); });
      child.once('exit', () => { if (this.active === desktop) void this.stop(job.id); });
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      if (this.active !== desktop || !interactive(job)) break;
      if (await ready(5900) && await ready(6080)) {
        this.log.info(job.id, 'desktop_ready', { durationMs: Date.now() - started });
        return desktop.token;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await this.stop(job.id);
    this.log.warn(job.id, 'desktop_error', { errorCode: 'DESKTOP_UNAVAILABLE', durationMs: Date.now() - started });
    throw new Error('DESKTOP_NOT_AVAILABLE');
  }

  stop(jobId?: string): Promise<void> {
    const desktop = this.active;
    if (!desktop || (jobId && desktop.job.id !== jobId)) return this.stopping;
    this.active = null;
    this.log.info(desktop.job.id, 'desktop_closed', { state: desktop.job.state });
    desktop.job.off('event', desktop.listener);
    for (const socket of desktop.sockets) socket.destroy();
    this.stopping = Promise.all(desktop.children.map(stopChild)).then(() => {});
    return this.stopping;
  }

  attach(server: Server, manager: JobManager): void {
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head, manager));
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, manager: JobManager): void {
    const match = /^\/remote\/([0-9a-f-]{36})\/socket$/.exec(req.url || '');
    const desktop = this.active;
    const token = /(?:^|;\s*)portal_remote=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    let originAllowed = false;
    try { originAllowed = new URL(req.headers.origin || '').host === req.headers.host; } catch {}
    if (!match || !desktop || desktop.job.id !== match[1] || !interactive(manager.get(match[1])) || !originAllowed || !token || !timingSafeEqual(Buffer.from(token), Buffer.from(desktop.token))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    desktop.sockets.add(socket);
    const headers: Record<string, string> = { connection: 'Upgrade', upgrade: 'websocket' };
    for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const upstream = request({ host: '127.0.0.1', port: 6080, path: '/', headers });
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.on('upgrade', (response, remote, initial) => {
      if (this.active !== desktop || !interactive(desktop.job) || socket.destroyed) return void remote.destroy();
      desktop.sockets.add(remote);
      this.log.info(desktop.job.id, 'desktop_websocket_connected', { durationMs: Date.now() - desktop.job.createdAt });
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (initial.length) socket.write(initial);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
      socket.once('close', () => { remote.destroy(); desktop.sockets.delete(socket); desktop.sockets.delete(remote); });
    });
    socket.once('close', () => { upstream.destroy(); desktop.sockets.delete(socket); });
    upstream.end();
  }
}

export function desktopHtml(jobId: string, nonce: string, institution = 'tu institución', provider = 'percamb', missing = false): string {
  const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const inst = provider === 'centrodm' ? 'cdm' : provider === 'rdcchacabuco' ? 'rdc' : 'pc';
  const settings = JSON.stringify({ id: jobId, institution, missing, returnUrl: `/#/traer?inst=${inst}&job=${encodeURIComponent(jobId)}` }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingreso a ${esc(institution)} · Portal de Pacientes</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#f4f8fa;color:#173248;font:16px/1.5 system-ui,sans-serif}header{background:#fff;border-bottom:1px solid #d7e6eb;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{font-weight:750}.brand span{display:inline-grid;place-items:center;background:#078489;color:white;border-radius:10px;width:34px;height:34px;margin-right:10px}.step{color:#547080;font-size:14px}main{max-width:1300px;margin:auto;padding:24px}h1{font-size:clamp(22px,3vw,30px);margin:4px 0 8px}p{margin:8px 0}.eyebrow{color:#078489;font-weight:650}.panel{background:#fff;border:1px solid #d7e6eb;border-radius:16px;padding:20px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}button,.button{font:inherit;border:1px solid #bfd6dc;border-radius:10px;padding:11px 18px;cursor:pointer;text-decoration:none;background:#fff;color:#173248;font-weight:650}button.primary,.button.primary{background:#087d83;color:#fff;border-color:#087d83}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid #148f9b;outline-offset:3px}[hidden]{display:none!important}#desktop{height:min(70vh,820px);min-height:300px;background:#e7eef1;border-radius:12px;overflow:auto}#message-panel{text-align:center;min-height:220px;display:grid;place-content:center;padding:30px}#status{color:#46616e}#status.error{color:#9c2735}.privacy{background:#eaf7f5;border-radius:10px;padding:12px;color:#345b60;font-size:14px;margin-top:16px}.back{color:#087d83}.spinner{width:30px;height:30px;border:3px solid #d3e7e8;border-top-color:#087d83;border-radius:50%;margin:8px auto;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){header{padding:12px;flex-wrap:wrap}main{padding:14px}.panel{padding:14px}.actions button{flex:1}#desktop{height:58vh}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
  </style></head><body><header><div class="brand"><span aria-hidden="true">✚</span>Portal de Pacientes</div><div class="step">Traer mis estudios · Paso 2 de 4</div><a class="back" id="header-back" href="${esc(`/#/traer?inst=${inst}&job=${jobId}`)}">Volver al Portal</a></header>
  <main><p class="eyebrow">Ingreso a ${esc(institution)}</p><h1 id="title">Preparando el acceso seguro…</h1><p id="instructions">Estamos conectando el navegador de la institución. Mantené esta pestaña abierta.</p>
  <section class="panel"><div id="message-panel"><div class="spinner" id="spinner" aria-hidden="true"></div><h2 id="message-title">Preparando el acceso seguro al centro médico…</h2><p id="message-detail">Podés cancelar si preferís intentarlo más tarde.</p><a id="return" class="button primary" hidden href="${esc(`/#/traer?inst=${inst}&job=${jobId}`)}">Volver al Portal</a></div>
  <div id="desktop" hidden aria-label="Navegador de la institución"></div><p id="status" role="status" aria-live="polite">Preparando…</p><div class="actions"><button id="retry" hidden>Reintentar conexión</button><button id="fullscreen" hidden>Ampliar navegador</button><button id="cancel">Cancelar y cerrar</button></div>
  <p class="privacy">Escribí tus credenciales únicamente en el sitio de ${esc(institution)}. No las guardamos ni las enviamos a modelos de IA.</p></section></main>
  <script id="remote-config" type="application/json" nonce="${nonce}">${settings}</script><script type="module" src="/remote-assets/portal-login.js"></script></body></html>`;
}
