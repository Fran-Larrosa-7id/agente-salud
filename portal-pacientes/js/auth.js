/* Portal de Pacientes — ingreso y recuperación de contraseña. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const rec = (P.ui.rec = { step: 'dni', dni: '' });
  P.portalAuthEnabled = true;
  P.portalAuthUnavailable = false;
  P.prepareAuth = async () => {
    try {
      const response = await fetch(P.agent.base() + '/api/auth/session', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
      const session = await response.json();
      if (typeof session.enabled !== 'boolean' || typeof session.authenticated !== 'boolean') throw new Error('INVALID_AUTH_STATUS');
      P.portalAuthEnabled = session.enabled;
      P.portalAuthUnavailable = false;
      if (session.enabled) { P.db.session = session.authenticated ? { since: new Date().toISOString() } : null; P.save(); }
      return true;
    } catch {
      // Un error de red nunca habilita el login local de desarrollo.
      P.portalAuthEnabled = true;
      P.portalAuthUnavailable = true;
      if (P.db.session) { P.db.session = null; P.save(); }
      return false;
    }
  };

  const art =
    '<div class="auth-art" aria-hidden="true">' +
    '<div class="aa-sources">' +
    [['PC', 'teal', 'Pérez Cambet', 'Estudios'], ['CDM', 'sky', 'Centro DM', 'Estudios'], ['RDC', 'sky', 'RDC Chacabuco', 'Estudios']].map((x, i) =>
      '<div class="aa-chip" style="--i:' + i + '"><span class="mono mono-md t-' + x[1] + '">' + x[0] + '</span><span><b>' + x[2] + '</b><span>' + x[3] + '</span></span></div>'
    ).join('') + '</div>' +
    '<div class="aa-card"><div class="aa-card-head">' + P.logo(28) + '<span>Tu historial</span></div>' +
    ['Estudios importados', 'Archivos originales', 'Documentos', 'Historial'].map((t, i) => '<div class="aa-row" style="--i:' + i + '"><span class="aa-check">' + ic('check', 14) + '</span>' + t + '</div>').join('') +
    '</div></div>';

  function layout(inner) {
    return (
      '<div class="auth">' +
      '<section class="auth-brand">' +
      '<div class="auth-logo">' + P.logo(40) + '<span><span class="brand-name">Portal de Pacientes</span><span class="brand-sub">Vertical Salud</span></span></div>' +
      '<div class="auth-pitch"><h2 class="auth-h">Tus estudios, en un solo lugar.</h2>' +
      '<p>Traé tus estudios desde las instituciones disponibles y conservá sus archivos originales.</p></div>' +
      art +
      '<p class="auth-trust">' + ic('shield', 18) + 'Tus datos están protegidos. Vos decidís qué compartir.</p>' +
      '</section>' +
      '<main class="auth-main" id="main" tabindex="-1"><div class="auth-mobile-logo">' + P.logo(36) + '<span class="brand-name">Portal de Pacientes</span></div>' +
      '<div class="auth-card">' + inner + '</div>' +
      '<footer class="auth-foot">Una solución de 7Ideas · Vertical Salud</footer></main></div>'
    );
  }

  P.renderLogin = function () {
    document.title = 'Ingresar · Portal de Pacientes';
    const connectionAlert = P.portalAuthUnavailable
      ? '<div class="alert alert-error" role="alert">No pudimos conectar con el Portal. Revisá la conexión y reintentá.<p><button class="btn btn-secondary btn-sm" type="button" data-action="retry-auth">Reintentar conexión</button></p></div>'
      : '';
    return layout(
      '<h1 class="auth-title" tabindex="-1">Ingresar</h1>' +
      '<p class="muted">Ingresá con la cuenta del piloto.</p>' +
      connectionAlert +
      '<div class="alert alert-error" id="login-alert" role="alert" hidden></div>' +
      '<form id="login-form" class="auth-form" novalidate>' +
      '<div class="field"><label for="dni">Usuario</label>' +
      '<input class="input input-lg num" id="dni" name="dni" autocomplete="username" value="1234" aria-describedby="dni-e">' +
      '<p class="field-error" id="dni-e" hidden></p></div>' +
      '<div class="field"><div class="field-top"><label for="pass">Contraseña</label>' + (P.portalAuthEnabled ? '' : '<a class="link link-sm" href="#/recuperar">Olvidé mi contraseña</a>') + '</div>' +
      '<div class="pass-wrap"><input class="input input-lg" id="pass" name="pass" type="password" autocomplete="current-password" value="1234" aria-describedby="pass-e caps">' +
      '<button type="button" class="pass-toggle" data-action="toggle-pass" aria-label="Mostrar contraseña" aria-pressed="false">' + ic('eye', 20) + '</button></div>' +
      '<p class="field-hint" id="caps" hidden>' + ic('info', 16) + 'Bloq Mayús está activado.</p>' +
      '<p class="field-error" id="pass-e" hidden></p></div>' +
      '<button class="btn btn-primary btn-lg btn-block" type="submit">Ingresar</button>' +
      '</form>' +
      '<p class="auth-note">' + ic('info', 16) + '<span>Piloto: usuario <b>1234</b> y contraseña <b>1234</b>.</span></p>'
    );
  };

  P.mountLogin = function () {
    const f = document.getElementById('login-form');
    const dni = f.querySelector('#dni');
    const pass = f.querySelector('#pass');
    dni.addEventListener('input', () => clearErr(dni));
    pass.addEventListener('input', () => clearErr(pass));
    pass.addEventListener('keyup', (e) => { if (e.getModifierState) document.getElementById('caps').hidden = !e.getModifierState('CapsLock'); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alert = document.getElementById('login-alert');
      alert.hidden = true;
      let bad = false;
      if (!dni.value.trim()) { setErr(dni, 'Ingresá tu usuario.'); bad = true; }
      if (!pass.value) { setErr(pass, 'Ingresá tu contraseña.'); bad = true; }
      if (bad) { f.querySelector('[aria-invalid="true"]').focus(); return; }
      const done = P.busy(f.querySelector('[type="submit"]'), 'Ingresando…');
      if (P.portalAuthEnabled) {
        try {
          const response = await fetch(P.agent.base() + '/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: dni.value.trim(), password: pass.value }), signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error(response.status === 401 ? 'Usuario o contraseña incorrectos.' : response.status === 429 ? 'Esperá un minuto y volvé a intentar.' : 'No pudimos iniciar sesión. Volvé a intentar.');
          P.db.session = { since: new Date().toISOString() }; P.save(); P.ui.fresh = true;
          const returnTo = new URLSearchParams(location.search).get('returnTo');
          if (returnTo && /^\/remote\/[0-9a-f-]{36}$/.test(returnTo)) location.replace(returnTo);
          else location.hash = '#/inicio';
        } catch (error) { done(); alert.hidden = false; alert.textContent = error.message || 'No pudimos conectar con el Portal.'; }
        return;
      }
      await P.wait(800);
      P.db.session = { since: P.toISO(P.TODAY) };
      P.save();
      P.ui.fresh = true;
      location.hash = '#/inicio';
    });
  };

  function setErr(input, msg) {
    const e = document.getElementById(input.id + '-e');
    input.setAttribute('aria-invalid', 'true');
    e.hidden = false;
    e.innerHTML = ic('alert', 16) + msg;
  }
  function clearErr(input) {
    input.removeAttribute('aria-invalid');
    const e = document.getElementById(input.id + '-e');
    if (e) e.hidden = true;
  }

  P.actions['toggle-pass'] = (el) => {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', show);
    el.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    el.innerHTML = ic(show ? 'eye-off' : 'eye', 20);
  };

  P.actions['retry-auth'] = async (button) => {
    button.disabled = true;
    button.textContent = 'Verificando…';
    await P.prepareAuth();
    P.route();
  };

  P.renderRecover = () => layout('<h1 class="auth-title">Acceso al piloto</h1><p>Usá el usuario 1234 y la contraseña 1234.</p><a class="btn btn-primary" href="#/login">Volver a ingresar</a>');
  P.mountRecover = () => {};
  P.resetRecover = () => {};
})();
