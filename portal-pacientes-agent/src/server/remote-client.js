import RFB from '/remote-assets/core/rfb.js';
import { mobileKeyboard } from '/remote-assets/portal-keyboard.js';
const config = JSON.parse(document.querySelector('#remote-config').textContent);
const el = id => document.getElementById(id);
let rfb, stream, state, preparing = false, finished = false, connected = false, awaitingRetry = false, attempts = 0, timer, lastSeq = -1;
// Retain the narrow-window presentation through a phone-sized rotation even
// when DevTools or a browser reports a mouse instead of a coarse pointer.
const mobileViewport = (previous = false) => innerWidth <= 600 || matchMedia('(pointer:coarse)').matches && Math.min(innerWidth, innerHeight) <= 600 || previous && innerWidth <= 960 && innerHeight <= 600;
let mobile = mobileViewport();
let layout = mobile ? 'mobile' : 'desktop', displayTimer, resizeTimer, changing = false, pendingResize = false, zoom = null, display;
const controls = ['zoom-in', 'zoom-out', 'zoom-fit', 'nav-back', 'nav-forward', 'display-layout', 'more-controls'];
function controlLabel(id, text) { const button = el(id); (button.querySelector('.control-label') || button).textContent = text; button.title = text; button.setAttribute('aria-label', text); }
function closeOptions() { el('remote-more').hidden = true; el('more-controls').setAttribute('aria-expanded', 'false'); }

// noVNC 1.3 identifies a one-finger swipe as mouse-button drag. In fitted
// mobile view it should scroll the actual external page instead. Capture the
// recognized gesture before RFB presses a mouse button; taps/longpress/pinch
// retain noVNC behavior. Wheel delivery uses RFB's own coordinate mapping.
let swipe;
function mobileScroll(event) {
  if (event.detail?.type !== 'drag') return;
  if (event.type === 'gesturestart') {
    swipe = connected && !finished && layout === 'mobile' && !zoom && !document.body.classList.contains('display-changing')
      ? { x: event.detail.clientX, y: event.detail.clientY, anchorX: event.detail.clientX, anchorY: event.detail.clientY } : null;
  }
  if (!swipe) return;
  event.stopImmediatePropagation();
  if (event.type === 'gesturemove' && connected && !finished && !document.body.classList.contains('display-changing')) {
    const canvas = event.target, box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: swipe.anchorX, clientY: swipe.anchorY,
      deltaX: (swipe.x - event.detail.clientX) * scale, deltaY: (swipe.y - event.detail.clientY) * scale, cancelable: true }));
    swipe.x = event.detail.clientX; swipe.y = event.detail.clientY;
  }
  if (event.type === 'gestureend') swipe = null;
}
for (const name of ['gesturestart', 'gesturemove', 'gestureend']) el('desktop').addEventListener(name, mobileScroll, true);
document.body.classList.toggle('immersive', mobile);
const keyboard = mobileKeyboard({ input: el('keyboard-input'), toggle: el('keyboard-toggle'), tools: el('keyboard-tools'), desktop: el('desktop'), connection: () => connected && !finished ? rfb : null });
const interactive = value => ['WAITING_FOR_USER_LOGIN', 'HUMAN_ACTION_REQUIRED'].includes(value);
const opening = value => ['CREATED', 'OPENING_PROVIDER'].includes(value);
const failed = value => ['CANCELLED', 'EXPIRED', 'AUTH_TIMEOUT', 'ERROR', 'PROVIDER_UNAVAILABLE', 'PROVIDER_CHANGED', 'AGENT_UNABLE_TO_CONTINUE'].includes(value);
function resetConnection() { closeOptions(); clearInterval(displayTimer); clearTimeout(resizeTimer); keyboard.close(); const previous = rfb; rfb = null; connected = false; previous?.disconnect(); document.body.classList.remove('connected', 'display-changing'); controls.forEach(id => el(id).hidden = true); el('desktop').hidden = true; el('fullscreen').hidden = true; el('keyboard-toggle').hidden = true; }
function viewport() {
  mobile = mobileViewport(mobile);
  document.body.classList.toggle('immersive', mobile || !!document.fullscreenElement || document.body.classList.contains('viewer-expanded'));
  const v = window.visualViewport, root = document.documentElement;
  for (const [key, value] of Object.entries({ 'remote-viewport': v?.height || innerHeight, 'remote-width': v?.width || innerWidth, 'remote-top': v?.offsetTop || 0, 'remote-left': v?.offsetLeft || 0 })) root.style.setProperty('--' + key, Math.round(value) + 'px');
  queueDisplayResize();
}
function queueDisplayResize() {
  if (!connected || layout !== 'mobile' || zoom) return;
  document.body.classList.add('display-changing'); clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeTimer = null; void changeDisplay('mobile'); }, 150);
}
async function settleDisplay(info) {
  const deadline = performance.now() + 2500; let stable = 0;
  while (connected && !finished && performance.now() < deadline) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const canvas = el('desktop').querySelector('canvas');
    if (canvas?.width === info.width && canvas?.height === info.height) { if (++stable >= 3) return true; } else stable = 0;
  }
  return false;
}
function dimensions() { const box = el('remote-surface').getBoundingClientRect(); return { width: Math.round(box.width || 390), height: Math.round(box.height || 720) }; }
function renderDisplay(info) {
  if (!info) return;
  display = info; layout = info.layout;
  el('external-origin').textContent = info.origin || 'Sitio externo: verificá la dirección en Chromium';
  controlLabel('display-layout', layout === 'mobile' ? 'Vista escritorio' : 'Vista móvil');
  el('display-layout').setAttribute('aria-label', layout === 'mobile' ? 'Cambiar a vista escritorio sin cerrar sesión' : 'Cambiar a vista móvil sin cerrar sesión');
  if (info.fallback) { el('status').textContent = 'Usamos la vista escritorio para conservar tu sesión. Podés acercar la pantalla o reintentar la vista móvil.'; el('status').className = 'error'; }
}
function applyZoom() {
  if (!rfb) return;
  const target = el('desktop');
  // Resize noVNC's target, letting its own display scaling map pointer coordinates.
  // Never transform the canvas independently from RFB's coordinate mapping.
  const canvas = target.querySelector('canvas');
  target.style.width = zoom && canvas ? Math.round(canvas.width * zoom) + 'px' : '100%';
  target.style.height = zoom && canvas ? Math.round(canvas.height * zoom) + 'px' : document.body.classList.contains('immersive') ? '100%' : 'min(70vh,820px)';
  rfb.scaleViewport = true;
}
async function changeDisplay(next) {
  if (!connected || finished || !interactive(state)) return;
  if (changing) { pendingResize = true; return; }
  changing = true; pendingResize = false; let settled = false;
  document.body.classList.add('display-changing');
  try {
    const response = await fetch('/api/imports/' + config.id + '/desktop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: next, ...dimensions() }), signal: AbortSignal.timeout(10000) });
    if (accessError(response.status)) return;
    if (response.status === 409) { await snapshot(); return; }
    if (!response.ok) throw new Error();
    const data = await response.json(); if (finished) return;
    el('status').className = ''; renderDisplay(data.display); applyZoom();
    settled = await settleDisplay(data.display);
    if (!settled && !finished) { el('status').className = 'error'; el('status').textContent = 'Esperando la nueva imagen. Podés reintentar la vista o reconectar sin cerrar tu sesión.'; }
  } catch { if (!finished) { el('status').textContent = 'No pudimos cambiar la vista. Tu sesión sigue abierta; podés reintentar.'; el('status').className = 'error'; } }
  finally { changing = false; if (pendingResize && !finished && layout === 'mobile' && !zoom) queueDisplayResize(); else if (settled || finished) document.body.classList.remove('display-changing'); }
}
async function refreshDisplay() {
  if (!connected || finished || changing) return;
  try {
    const response = await fetch('/api/imports/' + config.id + '/display', { signal: AbortSignal.timeout(5000) });
    if (accessError(response.status)) return;
    if (response.status === 409) { await snapshot(); return; }
    if (response.ok && !finished) renderDisplay(await response.json());
  } catch {} // SSE remains authoritative; a temporary poll error does not discard the session.
}
function message(title, detail, retry = false) {
  awaitingRetry = true;
  resetConnection(); el('message-panel').hidden = false; el('spinner').hidden = true;
  el('message-title').textContent = title; el('message-detail').textContent = detail;
  el('title').textContent = title; el('status').textContent = detail; el('status').className = 'error';
  el('retry').hidden = !retry;
}
function complete(cancelled = false) {
  if (finished) return;
  finished = true; clearTimeout(timer); stream?.close();
  if (rfb) rfb.viewOnly = true;
  message(cancelled ? 'Importación cancelada' : 'Estamos buscando tus estudios…', cancelled ? 'Cerramos el navegador de la institución.' : 'Detectamos tu ingreso. Continuamos automáticamente en el Portal.');
  el('status').className = ''; el('cancel').hidden = true; el('retry').hidden = true;
  if (cancelled) { el('return').hidden = false; el('return').href = '/#/estudios'; el('return').textContent = 'Volver a Estudios'; }
  else {
    if (config.auxiliary) {
      el('message-title').textContent = 'Ingreso detectado';
      el('message-detail').textContent = 'La importación continúa en la pestaña original del Portal. Si esta pestaña no se cerró automáticamente, volvé a la original.';
      el('status').textContent = 'Volvé a la pestaña original del Portal para seguir.';
      el('header-back').hidden = true;
      el('close-tab').hidden = false;
      el('close-tab').onclick = () => window.close();
      window.close();
    } else {
      location.replace(config.returnUrl);
    }
  }
}
function accessError(status) {
  if (status === 401 || status === 403) {
    finished = true;
    message(status === 401 ? 'Tu acceso al Portal necesita renovarse' : 'No pudimos autorizar esta conexión', 'Volvé al Portal para iniciar sesión y recuperar la importación.');
    clearTimeout(timer); stream?.close(); return true;
  }
  if (status === 404 || status === 410) { finished = true; message('Esta sesión ya no está disponible', 'Volvé al Portal para iniciar una nueva importación.'); clearTimeout(timer); stream?.close(); return true; }
  return false;
}
async function snapshot() {
  try {
    const response = await fetch('/api/imports/' + config.id, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) { accessError(response.status); return; }
    observe(await response.json());
  } catch { if (!finished) message('Se interrumpió la conexión', 'Tus credenciales no se guardaron. Podés reconectar a la misma sesión.', true); }
}
function observe(data) {
  if (finished || !data.state) return;
  if (Number.isFinite(data.lastSeq)) { if (data.lastSeq < lastSeq) return; lastSeq = data.lastSeq; }
  state = data.state;
  if (failed(state)) {
    if (state === 'CANCELLED') { complete(true); return; }
    finished = true; clearTimeout(timer); stream?.close();
    message(['EXPIRED', 'AUTH_TIMEOUT'].includes(state) ? 'Se venció el tiempo de esta sesión' : 'La importación no pudo continuar', 'Cerramos el navegador de la institución. Volvé al Portal para intentarlo de nuevo.');
    el('return').hidden = false; el('return').href = '/#/estudios'; el('return').textContent = 'Volver al Portal';
    el('cancel').hidden = true; return;
  }
  if (!opening(state) && !interactive(state)) { complete(); return; }
  if (interactive(state) && !rfb && !preparing && !awaitingRetry && attempts < 4) void prepare();
}
async function prepare() {
  if (finished || preparing || !interactive(state)) return;
  preparing = true; awaitingRetry = false; attempts++; el('retry').hidden = true; el('spinner').hidden = false;
  let retryTransient = false;
  el('status').className = ''; el('status').textContent = 'Preparando el navegador seguro…';
  el('message-panel').hidden = false; el('message-title').textContent = 'Conectando con ' + config.institution + '…';
  try {
    const response = await fetch('/api/imports/' + config.id + '/desktop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout, ...dimensions() }), signal: AbortSignal.timeout(12000) });
    if (accessError(response.status)) return;
    if (response.status === 409) {
      // Revalidar el estado autorizado; no asumir que la espera de login continúa.
      await snapshot();
      if (!finished) message('El navegador todavía se está preparando', 'Esperá la confirmación del acceso o reintentá la conexión.', attempts < 4);
      retryTransient = interactive(state) && attempts < 4;
      return;
    }
    if (!response.ok) { message('No pudimos preparar el navegador', 'Podés reintentar la conexión o cancelar la importación.', attempts < 4); return; }
    const prepared = await response.json(); renderDisplay(prepared.display);
    if (finished || !interactive(state)) return;
    el('desktop').hidden = false; el('message-panel').hidden = true; el('spinner').hidden = true;
    el('title').textContent = 'Iniciá sesión en ' + config.institution;
    el('instructions').textContent = 'Ingresá tus credenciales en el sitio de la institución. Cuando termines, seguimos automáticamente.';
    const current = new RFB(el('desktop'), (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/remote/' + config.id + '/socket');
    rfb = current; current.background = '#e7eef1'; current.scaleViewport = true; current.resizeSession = false;
    current.addEventListener('connect', () => {
      if (rfb !== current || finished) return;
      connected = true; clearTimeout(timer); el('fullscreen').hidden = false;
      el('keyboard-toggle').hidden = false;
      document.body.classList.add('connected'); controls.forEach(id => el(id).hidden = false);
      el('status').textContent = 'Ingresá en el sitio de la institución. Detectaremos el acceso automáticamente.';
      if (display?.fallback) renderDisplay(display);
      displayTimer = setInterval(() => void refreshDisplay(), 1500);
      applyZoom(); if (layout === 'mobile') void changeDisplay(layout);
    });
    current.addEventListener('disconnect', () => {
      if (rfb !== current || finished) return;
      // La revocación automática puede llegar antes que authenticated.
      resetConnection(); el('message-panel').hidden = false; el('spinner').hidden = false;
      el('message-title').textContent = 'Estamos actualizando tu acceso…';
      el('status').textContent = 'Recuperando el estado de la importación…';
      void snapshot();
    });
  } catch { if (!finished) message('La conexión está demorando', 'Podés reintentar o cancelar esta importación.', attempts < 4); }
  finally { preparing = false; if (retryTransient && !finished) timer = setTimeout(() => void prepare(), 300 * attempts); }
}
function watch() {
  clearTimeout(timer); timer = setTimeout(() => { if (!finished && !connected) message('La preparación está demorando', 'Podés reintentar el acceso o cancelar y volver más tarde.', true); }, 30000);
  stream?.close(); stream = new EventSource('/api/imports/' + config.id + '/events');
  for (const name of ['snapshot', 'provider_opened', 'waiting_user_login', 'human_action_required', 'authenticated', 'searching_studies', 'waiting_selection', 'completed', 'error']) {
    stream.addEventListener(name, event => { try { const data = JSON.parse(event.data); if (event.lastEventId) data.lastSeq = Number(event.lastEventId); observe(data); } catch {} });
  }
  let lost = 0;
  stream.onopen = () => { lost = 0; void snapshot(); };
  stream.onerror = () => { if (++lost >= 3) { stream.close(); if (!finished) message('Se interrumpió la conexión con el Portal', 'Reintentá para recuperar el estado de tu importación.', true); } };
  void snapshot();
}
el('retry').onclick = () => { attempts = 0; finished = false; awaitingRetry = false; resetConnection(); watch(); };
el('fullscreen').onclick = () => {
  closeOptions();
  keyboard.close();
  if (document.fullscreenElement) { void document.exitFullscreen(); return; }
  const expand = () => { document.body.classList.toggle('viewer-expanded'); document.body.classList.toggle('immersive', mobile || document.body.classList.contains('viewer-expanded')); viewport(); applyZoom(); controlLabel('fullscreen', document.body.classList.contains('viewer-expanded') ? 'Reducir navegador' : 'Ampliar navegador'); };
  // Keep the server-verified external origin visible in fullscreen, including cropped mode.
  if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(expand); else expand();
};
document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('immersive', mobile || !!document.fullscreenElement || document.body.classList.contains('viewer-expanded')); viewport(); applyZoom(); controlLabel('fullscreen', document.fullscreenElement ? 'Reducir navegador' : 'Ampliar navegador'); });
el('zoom-in').onclick = () => { const canvas = el('desktop').querySelector('canvas'); zoom = Math.min(2, (zoom || (canvas?.getBoundingClientRect().width / canvas?.width) || 1) * 1.25); applyZoom(); };
el('zoom-out').onclick = () => { const canvas = el('desktop').querySelector('canvas'); zoom = Math.max(0.25, (zoom || (canvas?.getBoundingClientRect().width / canvas?.width) || 1) / 1.25); applyZoom(); };
el('zoom-fit').onclick = () => { zoom = null; applyZoom(); };
el('display-layout').onclick = () => { closeOptions(); zoom = null; void changeDisplay(layout === 'mobile' ? 'desktop' : 'mobile'); };
el('more-controls').onclick = () => { const open = el('remote-more').hidden; el('remote-more').hidden = !open; el('more-controls').setAttribute('aria-expanded', String(open)); };
el('keyboard-toggle').addEventListener('click', closeOptions);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !el('remote-more').hidden) { closeOptions(); el('more-controls').focus(); } });
document.addEventListener('pointerdown', event => { if (!el('remote-controls').contains(event.target)) closeOptions(); });
for (const action of ['back', 'forward']) el('nav-' + action).onclick = async () => {
  if (!connected || finished || changing) return;
  keyboard.close();
  try { const response = await fetch('/api/imports/' + config.id + '/navigation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(7000) }); if (!accessError(response.status)) await refreshDisplay(); } catch { el('status').className = 'error'; el('status').textContent = 'No pudimos navegar. Tu sesión permanece abierta.'; }
};
el('exit-remote').onclick = () => el('cancel').click();
window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport); window.addEventListener('resize', viewport);
new ResizeObserver(queueDisplayResize).observe(el('remote-surface'));
viewport();
el('cancel').onclick = async () => {
  el('cancel').disabled = true;
  try {
    const response = await fetch('/api/imports/' + config.id, { method: 'DELETE', signal: AbortSignal.timeout(15000) });
    if (accessError(response.status)) return;
    if (response.ok) complete(true); else { el('status').textContent = 'No pudimos confirmar la cancelación. Volvé a intentar.'; }
  } catch { el('status').textContent = 'Se interrumpió la conexión. Reintentá cancelar o volvé al Portal.'; }
  finally { el('cancel').disabled = false; }
};
el('return').onclick = event => {
  if (window.opener && !window.opener.closed) { event.preventDefault(); window.opener.focus(); window.close(); }
};
window.addEventListener('pagehide', () => { clearTimeout(timer); clearTimeout(resizeTimer); stream?.close(); resetConnection(); });
if (config.missing) accessError(404); else watch();
