import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import { configurePageDisplay, DISPLAY_COMPATIBILITY, DESKTOP_VIEWPORT, type DisplayLayout, type DisplayGeometry } from '../browser/display-profile.js';
import { connect } from 'node:net';
import { request, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ImportJob } from '../jobs/job.js';
import { JobState as S } from '../jobs/states.js';
import type { JobManager } from '../jobs/job-manager.js';
import { silentLogger, type Logger } from '../security/logger.js';
import { requestOrigin, type PortalAccess } from './portal-auth.js';
import type { Config } from '../config.js';

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
const execute = promisify(execFile);
interface View { jobId: string; page: Page; layout: DisplayLayout; geometry: DisplayGeometry; fallback: boolean }

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
  constructor(private readonly log: Logger = silentLogger, private readonly proxyPort = 6080) {}
  private access?: PortalAccess;
  private config?: Config;
  authorizeWith(access: PortalAccess, config: Config): void { this.access = access; this.config = config; }
  private active: Desktop | null = null;
  private pending: Promise<string> | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private view?: View;
  private resizing: Promise<unknown> = Promise.resolve();

  async configure(job: ImportJob, page: Page | undefined, layout: DisplayLayout, width?: number, height?: number) {
    const task = this.resizing.catch(() => {}).then(async () => {
      if (!interactive(job) || !page) throw new Error('DESKTOP_NOT_AVAILABLE');
      const allowed = DISPLAY_COMPATIBILITY[job.provider]?.responsive ?? false;
      let actual: DisplayLayout = layout === 'mobile' && allowed ? 'mobile' : 'desktop', fallback = actual !== layout;
      let geometry: DisplayGeometry = { width: 1280, height: 1000, x: 0, y: 0 };
      try {
        if (actual === 'mobile') geometry = await configurePageDisplay(page, actual, width, height);
        else await page.setViewportSize(DESKTOP_VIEWPORT);
        if (!interactive(job)) { await page.setViewportSize(DESKTOP_VIEWPORT); throw new Error('DESKTOP_NOT_AVAILABLE'); }
        if (this.active?.job.id === job.id) await this.clip(geometry);
      } catch {
        await page.setViewportSize(DESKTOP_VIEWPORT).catch(() => {});
        actual = 'desktop'; fallback = true; geometry = { width: 1280, height: 1000, x: 0, y: 0 };
        if (this.active?.job.id === job.id) await this.clip(geometry);
      }
      if (!interactive(job)) throw new Error('DESKTOP_NOT_AVAILABLE');
      job.remoteLayout = actual;
      this.view = { jobId: job.id, page, layout: actual, geometry, fallback };
      return this.displayInfo(job, page);
    });
    this.resizing = task; return task;
  }
  private async clip(geometry: DisplayGeometry) {
    // Fixed executable and validated numeric geometry. No shell or VNC client resize commands.
    await execute('x11vnc', ['-display', process.env.DISPLAY!, '-R', `clip:${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`], { timeout: 2500, maxBuffer: 1024 });
  }
  displayInfo(job: ImportJob, page?: Page) {
    let origin = '';
    try { const url = new URL(page?.url() || ''); if (['https:', 'http:'].includes(url.protocol)) origin = url.origin; } catch {}
    const view = this.view?.jobId === job.id ? this.view : undefined;
    return { layout: view?.layout || 'desktop', width: view?.geometry.width || 1280, height: view?.geometry.height || 1000, fallback: view?.fallback || false, origin };
  }
  async refresh(job: ImportJob, page?: Page) {
    const view = this.view;
    if (view?.jobId === job.id && view.layout === 'mobile' && page && page !== view.page) return this.configure(job, page, 'mobile', view.geometry.width, view.geometry.height);
    return this.displayInfo(job, page);
  }

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
      ['x11vnc', ['-display', process.env.DISPLAY, '-localhost', '-rfbport', '5900', '-forever', '-nopw', '-quiet', '-noxdamage', '-noshm', ...(this.view?.jobId === job.id && this.view.layout === 'mobile' ? ['-clip', `${this.view.geometry.width}x${this.view.geometry.height}+${this.view.geometry.x}+${this.view.geometry.y}`] : [])]],
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
    if (this.view?.jobId === desktop.job.id) this.view = undefined;
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
    try { originAllowed = !!req.headers.origin && new URL(req.headers.origin).origin === requestOrigin(req, this.config); } catch {}
    const authorized = () => !this.access || (!!desktop && this.access.owner(req) === desktop.job.ownerUserId);
    if (!match || !desktop || desktop.job.id !== match[1] || !interactive(manager.get(match[1])) || !authorized() || !originAllowed || !token || !timingSafeEqual(Buffer.from(token), Buffer.from(desktop.token))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    desktop.sockets.add(socket);
    const guard = setInterval(() => { if (!authorized() || !interactive(desktop.job)) socket.destroy(); }, 1000);
    guard.unref(); socket.once('close', () => clearInterval(guard));
    const headers: Record<string, string> = { connection: 'Upgrade', upgrade: 'websocket' };
    for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const upstream = request({ host: '127.0.0.1', port: this.proxyPort, path: '/', headers });
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.on('upgrade', (response, remote, initial) => {
      if (this.active !== desktop || !interactive(desktop.job) || !authorized() || socket.destroyed) return void remote.destroy();
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

export function desktopHtml(jobId: string, nonce: string, institution = 'tu institución', provider = 'percamb', missing = false, auxiliary = false): string {
  const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const inst = provider === 'centrodm' ? 'cdm' : provider === 'rdcchacabuco' ? 'rdc' : 'pc';
  const settings = JSON.stringify({ id: jobId, institution, missing, auxiliary, returnUrl: `/#/traer?inst=${inst}&job=${encodeURIComponent(jobId)}` }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Ingreso a ${esc(institution)} · Portal de Pacientes</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#f4f8fa;color:#173248;font:16px/1.5 system-ui,sans-serif}header{background:#fff;border-bottom:1px solid #d7e6eb;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{font-weight:750}.brand span{display:inline-grid;place-items:center;background:#078489;color:white;border-radius:10px;width:34px;height:34px;margin-right:10px}.step{color:#547080;font-size:14px}main{max-width:1300px;margin:auto;padding:24px}h1{font-size:clamp(22px,3vw,30px);margin:4px 0 8px}p{margin:8px 0}.eyebrow{color:#078489;font-weight:650}.panel{background:#fff;border:1px solid #d7e6eb;border-radius:16px;padding:20px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}button,.button{font:inherit;border:1px solid #bfd6dc;border-radius:10px;padding:11px 18px;cursor:pointer;text-decoration:none;background:#fff;color:#173248;font-weight:650}button.primary,.button.primary{background:#087d83;color:#fff;border-color:#087d83}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid #148f9b;outline-offset:3px}[hidden]{display:none!important}#desktop{height:min(70vh,820px);min-height:300px;background:#e7eef1;border-radius:12px;overflow:auto}#message-panel{text-align:center;min-height:220px;display:grid;place-content:center;padding:30px}#status{color:#46616e}#status.error{color:#9c2735}.privacy{background:#eaf7f5;border-radius:10px;padding:12px;color:#345b60;font-size:14px;margin-top:16px}.back{color:#087d83}.spinner{width:30px;height:30px;border:3px solid #d3e7e8;border-top-color:#087d83;border-radius:50%;margin:8px auto;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){header{padding:12px;flex-wrap:wrap}main{padding:14px}.panel{padding:14px}.actions button{flex:1}#desktop{height:58vh}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
  #keyboard-tools{position:sticky;bottom:0;z-index:2;background:#fff;border:1px solid #bfd6dc;border-radius:10px;padding:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}#keyboard-input{font:16px system-ui;width:68px;height:44px;resize:none;-webkit-text-security:disc;caret-color:transparent;border:1px solid #bfd6dc;border-radius:6px}#viewer:fullscreen{background:#f4f8fa;padding:12px;overflow:auto}#viewer:fullscreen #desktop{height:calc(var(--remote-viewport,100dvh) - 155px);min-height:120px}.viewer-expanded main{max-width:none}.viewer-expanded #desktop{height:calc(var(--remote-viewport,100dvh) - 160px);min-height:120px}@media(max-width:600px),(pointer:coarse){#desktop{height:clamp(140px,calc(var(--remote-viewport,100dvh) - 280px),620px);min-height:140px}.actions{position:sticky;top:0;z-index:1;background:#fff;padding:8px 0}#keyboard-tools button{padding:10px}main{padding-bottom:env(safe-area-inset-bottom,14px)}}
  </style><link rel="stylesheet" href="/remote-assets/portal-view.css"></head><body><header><div class="remote-identity"><strong>${esc(institution)}</strong><span id="external-origin">Sitio externo</span></div><button type="button" id="exit-remote" aria-label="Salir y cancelar importación">Salir</button><div class="brand"><span aria-hidden="true">✚</span>Portal de Pacientes</div><div class="step">Traer mis estudios · Paso 2 de 4</div><a class="back" id="header-back" href="${esc(`/#/traer?inst=${inst}&job=${jobId}`)}">Volver al Portal</a></header>
  <main><p class="eyebrow">Ingreso a ${esc(institution)}</p><h1 id="title">Preparando el acceso seguro…</h1><p id="instructions">Estamos conectando el navegador de la institución. Mantené esta pestaña abierta.</p>
  <section class="panel"><div id="message-panel"><div class="spinner" id="spinner" aria-hidden="true"></div><h2 id="message-title">Preparando el acceso seguro al centro médico…</h2><p id="message-detail">Podés cancelar si preferís intentarlo más tarde.</p><button id="retry" hidden>Reintentar conexión</button><a id="return" class="button primary" hidden href="${esc(`/#/traer?inst=${inst}&job=${jobId}`)}">Volver al Portal</a><button id="close-tab" class="primary" hidden type="button">Cerrar esta pestaña</button></div>
  <div id="viewer"><div class="actions" id="remote-controls" aria-label="Controles del navegador"><button type="button" id="nav-back" hidden aria-label="Atrás en el sitio externo" title="Atrás en el sitio externo" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span class="control-label">Atrás en el sitio externo</span></button><button type="button" id="nav-forward" hidden aria-label="Adelante en el sitio externo" title="Adelante en el sitio externo" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg><span class="control-label">Adelante en el sitio externo</span></button><button type="button" id="keyboard-toggle" hidden aria-label="Abrir teclado" title="Abrir teclado" aria-expanded="false" aria-controls="keyboard-tools"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v14H3z M7 9h.01 M11 9h.01 M15 9h.01 M7 13h.01 M11 13h.01 M15 13h.01 M7 16h10"/></svg><span class="control-label">Abrir teclado</span></button><button type="button" id="more-controls" hidden aria-label="Más opciones" title="Más opciones" aria-expanded="false" aria-controls="remote-more"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h.01 M12 12h.01 M19 12h.01"/></svg><span class="control-label">Más opciones</span></button><div id="remote-more" hidden role="group" aria-label="Opciones de visualización"><p>Vista del navegador</p><button type="button" id="zoom-out" hidden aria-label="Alejar" title="Alejar" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg><span class="control-label">Alejar</span></button><button type="button" id="zoom-fit" hidden aria-label="Ajustar pantalla" title="Ajustar pantalla" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5"/></svg><span class="control-label">Ajustar pantalla</span></button><button type="button" id="zoom-in" hidden aria-label="Acercar" title="Acercar" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14 M12 5v14"/></svg><span class="control-label">Acercar</span></button><button type="button" id="display-layout" hidden aria-label="Cambiar a vista escritorio" title="Cambiar a vista escritorio" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v12H3z M8 21h8 M12 16v5"/></svg><span class="control-label">Cambiar a vista escritorio</span></button><button type="button" id="fullscreen" hidden aria-label="Ampliar navegador" title="Ampliar navegador" ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5"/></svg><span class="control-label">Ampliar navegador</span></button></div></div><div id="keyboard-tools" hidden><label for="keyboard-input">Teclado remoto</label><textarea id="keyboard-input" rows="1" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text" enterkeyhint="go" aria-label="Escribir en el campo seleccionado del navegador remoto"></textarea><button type="button" data-remote-key="tab">Tab</button><button type="button" data-remote-key="backspace">Borrar</button><button type="button" data-remote-key="enter">Enter</button><button type="button" data-remote-key="close">Cerrar teclado</button></div><div id="remote-surface"><div id="desktop" hidden aria-label="Navegador de la institución"></div></div></div><p id="status" role="status" aria-live="polite">Preparando…</p><div class="actions"><button id="cancel">Cancelar y cerrar</button></div>
  <p class="privacy">Escribí tus credenciales únicamente en el sitio de ${esc(institution)}. No las guardamos ni las enviamos a modelos de IA.</p></section></main>
  <script id="remote-config" type="application/json" nonce="${nonce}">${settings}</script><script type="module" src="/remote-assets/portal-login.js"></script></body></html>`;
}
