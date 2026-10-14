import RFB from '/remote-assets/core/rfb.js';
const config = JSON.parse(document.querySelector('#remote-config').textContent);
const el = id => document.getElementById(id);
let rfb, stream, state, preparing = false, finished = false, connected = false, awaitingRetry = false, attempts = 0, timer, lastSeq = -1;
const interactive = value => ['WAITING_FOR_USER_LOGIN', 'HUMAN_ACTION_REQUIRED'].includes(value);
const opening = value => ['CREATED', 'OPENING_PROVIDER'].includes(value);
const failed = value => ['CANCELLED', 'EXPIRED', 'AUTH_TIMEOUT', 'ERROR', 'PROVIDER_UNAVAILABLE', 'PROVIDER_CHANGED', 'AGENT_UNABLE_TO_CONTINUE'].includes(value);
function resetConnection() { const previous = rfb; rfb = null; connected = false; previous?.disconnect(); el('desktop').hidden = true; el('fullscreen').hidden = true; }
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
    // Solo navegamos esta pestaña auxiliar. La original continúa por su propio SSE.
    if (window.opener && !window.opener.closed) window.opener.focus();
    location.replace(config.returnUrl);
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
    const response = await fetch('/api/imports/' + config.id + '/desktop', { method: 'POST', signal: AbortSignal.timeout(12000) });
    if (accessError(response.status)) return;
    if (response.status === 409) {
      // Revalidar el estado autorizado; no asumir que la espera de login continúa.
      await snapshot();
      if (!finished) message('El navegador todavía se está preparando', 'Esperá la confirmación del acceso o reintentá la conexión.', attempts < 4);
      retryTransient = interactive(state) && attempts < 4;
      return;
    }
    if (!response.ok) { message('No pudimos preparar el navegador', 'Podés reintentar la conexión o cancelar la importación.', attempts < 4); return; }
    if (finished || !interactive(state)) return;
    el('desktop').hidden = false; el('message-panel').hidden = true; el('spinner').hidden = true;
    el('title').textContent = 'Iniciá sesión en ' + config.institution;
    el('instructions').textContent = 'Ingresá tus credenciales en el sitio de la institución. Cuando termines, seguimos automáticamente.';
    const current = new RFB(el('desktop'), (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/remote/' + config.id + '/socket');
    rfb = current; current.background = '#e7eef1'; current.scaleViewport = true; current.resizeSession = false;
    current.addEventListener('connect', () => {
      if (rfb !== current || finished) return;
      connected = true; clearTimeout(timer); el('fullscreen').hidden = false;
      el('status').textContent = 'Ingresá en el sitio de la institución. Detectaremos el acceso automáticamente.';
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
el('fullscreen').onclick = () => el('desktop').requestFullscreen?.().catch(() => {});
document.addEventListener('fullscreenchange', () => { if (rfb) rfb.scaleViewport = !document.fullscreenElement; });
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
window.addEventListener('pagehide', () => { clearTimeout(timer); stream?.close(); resetConnection(); });
if (config.missing) accessError(404); else watch();
