/* Portal de Pacientes — ingreso y recuperación de contraseña. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const rec = (P.ui.rec = { step: 'dni', dni: '' });
  P.portalAuthEnabled = true;
  P.portalAuthUnavailable = false;
  P.authMode = 'unknown';
  let check = 0;
  P.prepareAuth = async () => {
    const request = ++check;
    try {
      const response = await fetch(P.agent.base() + '/api/auth/session', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
      const session = await response.json();
      if (request !== check) return false;
      if (typeof session.enabled !== 'boolean' || typeof session.authenticated !== 'boolean') throw new Error('INVALID_AUTH_STATUS');
      const mode = session.mode || 'pilot';
      if (!['pilot', 'google'].includes(mode)) throw new Error('INVALID_AUTH_STATUS');
      if (mode === 'google' && (!session.enabled || session.authenticated && (!session.user || !/^[a-f0-9]{64}$/.test(session.user.id)))) throw new Error('INVALID_AUTH_STATUS');
      const previous = P.accountId;
      P.authMode = mode;
      P.storageBackend = session.storageProvider || 'local';
      P.labLoginForms = session.labLoginForms || {};
      P.labLoginTerms = session.labLoginTerms || {};
      P.applyIdentity(mode, session.user || null);
      P.driveStatus = session.drive || 'disconnected';
      P.portalAuthEnabled = session.enabled;
      P.portalAuthUnavailable = false;
      if (session.enabled) { P.db.session = session.authenticated ? { since: new Date().toISOString() } : null; P.save(); }
      if (mode === 'google' && previous !== P.accountId) {
        try { localStorage.setItem('pp_auth_changed', String(Date.now()) + Math.random()); } catch {}
        if (P.appReady) { P.identityChanged = true; location.reload(); return false; }
      }
      if (mode === 'google' && session.authenticated && P.syncCloudCatalog) await P.syncCloudCatalog(true);
      return true;
    } catch {
      if (request !== check) return false;
      // Un error de red nunca habilita el login local de desarrollo.
      P.portalAuthEnabled = true;
      P.portalAuthUnavailable = true;
      P.applyIdentity('google', null);
      return false;
    }
  };

  /* El entorno de prueba solo admite las cuentas de GOOGLE_ALLOWED_EMAILS / GOOGLE_ALLOWED_SUBS.
     El servidor no expone esa restricción, por eso el aviso se controla desde aquí. */
  const RESTRICTED_ACCOUNTS = true;
  const SIGNUP_URL = 'https://accounts.google.com/signup';

  // Logotipo oficial «G» de Google (colores y proporciones sin modificar).
  const googleG =
    '<svg class="gbtn-logo" width="22" height="22" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '<path fill="none" d="M0 0h48v48H0z"/></svg>';

  const brand = '<header class="auth-top"><div class="auth-wrap"><div class="auth-logo">' + P.logo(40) +
    '<span><span class="brand-name">Portal de Pacientes</span><span class="brand-sub">Vertical Salud</span></span></div></div></header>';
  const foot = '<footer class="auth-foot"><div class="auth-wrap">Una solución de 7Ideas · Vertical Salud</div></footer>';

  const hero = '<div class="auth-hero"><h1 class="auth-h" tabindex="-1">Tus estudios médicos, en un solo lugar.</h1>' +
    '<p class="auth-lead">Consultá, organizá y guardá tus estudios de diferentes instituciones sin tener que ingresar a cada una por separado.</p></div>';

  /* Ilustraciones vectoriales de «¿Cómo funciona?». Decorativas (aria-hidden): el texto del paso
     transmite la información. Las animaciones son de transform/opacity, se pausan fuera de pantalla
     y se desactivan con prefers-reduced-motion (el estado base es la composición final). */
  const ILL = [
    // 1. Ingresá: celular con el Portal, toque sobre el botón y confirmación.
    '<svg class="ill ill-1" viewBox="0 0 240 150" aria-hidden="true" focusable="false">' +
      '<circle cx="120" cy="78" r="60" fill="#fff" opacity=".5"/>' +
      '<g class="ill-float"><rect x="30" y="52" width="44" height="44" rx="12" fill="#fff" stroke="#dce4ec" stroke-width="1.5"/><circle cx="52" cy="68" r="7" fill="#bfdcee"/><path d="M41 88c2.2-6 6.2-8.4 11-8.4s8.8 2.4 11 8.4" fill="#bfdcee"/></g>' +
      '<g class="ill-float ill-float-b"><rect x="168" y="84" width="38" height="38" rx="11" fill="#dff3ef"/><rect x="180" y="101" width="14" height="11" rx="2.5" fill="#087477"/><path d="M183 101v-3.2a4 4 0 0 1 8 0V101" stroke="#087477" stroke-width="2.2" fill="none"/></g>' +
      '<rect x="88" y="20" width="64" height="114" rx="13" fill="#fff" stroke="#c5d0dc" stroke-width="2"/><rect x="110" y="27" width="20" height="4" rx="2" fill="#dce4ec"/>' +
      '<rect x="111" y="40" width="18" height="18" rx="5" fill="#0f8b8d"/><path d="M120 44.5v9M115.5 49h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' +
      '<rect x="100" y="66" width="40" height="5" rx="2.5" fill="#102a43" opacity=".8"/><rect x="106" y="76" width="28" height="4" rx="2" fill="#c5d0dc"/>' +
      '<rect class="i1-btn" x="97" y="92" width="46" height="16" rx="8" fill="#fff" stroke="#747775" stroke-width="1.2"/><circle cx="106" cy="100" r="3.2" fill="#4285F4"/><rect x="112" y="98" width="23" height="4" rx="2" fill="#5b6678"/>' +
      '<circle class="i1-ripple" cx="128" cy="100" r="12" fill="#0f8b8d"/>' +
      '<path class="i1-cursor" d="M128 100v17l4.6-4.2 3.6 7.6 3.2-1.5-3.5-7.4h6.2z" fill="#102a43" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<g class="i1-ok"><circle cx="152" cy="24" r="12" fill="#268267" stroke="#fff" stroke-width="2.5"/><path d="M146.5 24.2l3.8 3.8 7-7.6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
    '</svg>',
    // 2. Buscá: barra de búsqueda y una lupa que recorre las instituciones.
    '<svg class="ill ill-2" viewBox="0 0 240 150" aria-hidden="true" focusable="false">' +
      '<circle cx="120" cy="80" r="60" fill="#fff" opacity=".5"/>' +
      '<rect x="60" y="14" width="120" height="22" rx="11" fill="#fff" stroke="#dce4ec" stroke-width="1.5"/><circle cx="74" cy="25" r="4.2" stroke="#5b6678" stroke-width="1.8" fill="none"/><path d="M77 28l3 3" stroke="#5b6678" stroke-width="1.8" stroke-linecap="round"/><rect x="86" y="23" width="54" height="4" rx="2" fill="#c5d0dc"/>' +
      [[36, '#dcf1ed', '#087477'], [96, '#e1eff8', '#1d5a85'], [156, '#e1eff8', '#1d5a85']].map(t =>
        '<g><rect x="' + t[0] + '" y="52" width="48" height="66" rx="12" fill="#fff" stroke="#dce4ec" stroke-width="1.5"/>' +
        '<rect x="' + (t[0] + 10) + '" y="62" width="28" height="28" rx="8" fill="' + t[1] + '"/>' +
        '<path d="M' + (t[0] + 17) + ' 84V71l7-4 7 4v13z" fill="' + t[2] + '"/><rect x="' + (t[0] + 22) + '" y="77" width="4" height="7" rx="1" fill="#fff"/>' +
        '<rect x="' + (t[0] + 9) + '" y="98" width="30" height="4" rx="2" fill="#102a43" opacity=".7"/><rect x="' + (t[0] + 13) + '" y="106" width="22" height="3.5" rx="1.75" fill="#c5d0dc"/></g>').join('') +
      '<g class="i2-mag"><rect x="31" y="47" width="58" height="76" rx="15" fill="none" stroke="#0f8b8d" stroke-width="2.5"/>' +
        '<circle cx="74" cy="104" r="14" fill="#fff" fill-opacity=".45" stroke="#102a43" stroke-width="4"/><path d="M84 114l10 10" stroke="#102a43" stroke-width="6" stroke-linecap="round"/></g>' +
    '</svg>',
    // 3. Guardá: el estudio entra en la carpeta de Drive, sube a la nube y queda confirmado.
    '<svg class="ill ill-3" viewBox="0 0 240 150" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="ill3f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2aa3a0"/><stop offset="1" stop-color="#0f8b8d"/></linearGradient></defs>' +
      '<circle cx="120" cy="80" r="60" fill="#fff" opacity=".5"/>' +
      '<g class="ill-float"><path d="M168 52h36a12 12 0 0 0 1-24 17 17 0 0 0-32-3 12 12 0 0 0-5 27z" fill="#fff" stroke="#dce4ec" stroke-width="1.5"/><path d="M186 46V33m-5.5 5.5L186 33l5.5 5.5" stroke="#0f8b8d" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<path d="M62 64a8 8 0 0 1 8-8h30l9 9h53a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H70a8 8 0 0 1-8-8z" fill="#087477"/>' +
      '<g class="i3-doc"><rect x="90" y="36" width="56" height="66" rx="7" fill="#fff" stroke="#dce4ec" stroke-width="1.5"/>' +
        '<path d="M98 56h9l4-8 6 16 4-8h17" stroke="#0f8b8d" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="98" y="72" width="38" height="4" rx="2" fill="#c5d0dc"/><rect x="98" y="81" width="28" height="4" rx="2" fill="#c5d0dc"/></g>' +
      '<path d="M58 88a8 8 0 0 1 8-8h108a8 8 0 0 1 8 8v37a8 8 0 0 1-8 8H66a8 8 0 0 1-8-8z" fill="url(#ill3f)"/><rect x="74" y="96" width="44" height="5" rx="2.5" fill="#fff" opacity=".55"/>' +
      '<g class="i3-ok"><circle cx="176" cy="122" r="12" fill="#268267" stroke="#fff" stroke-width="2.5"/><path d="M170.5 122.2l3.8 3.8 7-7.6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
    '</svg>',
  ];

  const steps = '<section class="auth-sec auth-steps" aria-labelledby="how-h"><h2 class="auth-sec-h" id="how-h">¿Cómo funciona?</h2><ol class="steps">' +
    [['Ingresá al Portal', 'Utilizá tu cuenta de Google.'],
      ['Buscá tus estudios', 'Elegí la institución donde te atendiste e ingresá sus datos de acceso.'],
      ['Guardalos y consultalos', 'Organizá tus estudios en tu propio Google Drive y accedé a ellos cuando los necesites.']]
      .map((s, i) => '<li class="step"><div class="ill-wrap">' + ILL[i] + '</div>' +
        '<div class="step-t"><span class="step-k">Paso ' + (i + 1) + '</span><b>' + s[0] + '</b><span>' + s[1] + '</span></div></li>').join('') +
    '</ol></section>';

  const institutions = () => '<section class="auth-sec auth-inst" aria-labelledby="inst-h"><h2 class="auth-sec-h" id="inst-h">Instituciones disponibles</h2>' +
    '<p class="auth-sec-sub">Podés recuperar tus estudios de estas instituciones.</p><ul class="auth-inst-list">' +
    P.INSTITUTIONS.map(i => '<li><span class="mono mono-lg t-' + i.tone + '" aria-hidden="true">' + P.esc(i.mono) + '</span>' +
      '<span class="inst-t"><b>' + P.esc(i.name) + '</b><span>' + P.esc(i.kind) + '</span>' +
      '<span class="inst-ok">' + ic('check', 16) + 'Disponible</span></span></li>').join('') +
    '</ul></section>';

  // «Tus estudios, bajo tu control»: acceso compacto dentro de la tarjeta; el detalle se lee en un modal.
  const privacyTrigger = '<button type="button" class="auth-priv" data-action="privacy-info" aria-haspopup="dialog">' +
    '<span class="auth-priv-ic" aria-hidden="true">' + ic('shield', 20) + '</span>' +
    '<span class="auth-priv-t"><b>Tus estudios, bajo tu control</b><span>Qué pasa con tus datos</span></span>' + ic('info', 20, 'auth-priv-more') + '</button>';
  const privacyBody = '<p class="ov-text">Tus estudios se guardan en tu propio Google Drive. Te pediremos permiso antes de acceder al almacenamiento y no necesitamos la contraseña de tu cuenta de Google.</p><ul class="priv-list">' +
    [['folder', 'Quedan en tu Google Drive', 'Los archivos de tus estudios se guardan en tu propia cuenta de Google.'],
      ['key', 'El permiso se pide aparte', 'Ingresar al Portal no nos da acceso a tu Drive. Te lo pedimos recién cuando quieras guardar un estudio.'],
      ['eye', 'Solo vemos lo que guarda el Portal', 'El permiso alcanza a los archivos que crea el Portal o a los que vos elijas compartirle, no al resto de tu Drive.'],
      ['lock', 'Tu contraseña de Google es tuya', 'El ingreso se hace en la página de Google. El Portal nunca la ve ni la guarda.']]
      .map(x => '<li><span class="priv-ic" aria-hidden="true">' + ic(x[0], 20) + '</span><span><b>' + x[1] + '</b><span>' + x[2] + '</span></span></li>').join('') + '</ul>';
  P.actions['privacy-info'] = () => P.overlay({ title: 'Tus estudios, bajo tu control', className: 'ov-privacy', body: privacyBody,
    footer: '<button type="button" class="btn btn-primary" data-ov-close>Entendido</button>' });

  const faq = '<section class="auth-sec auth-faq" aria-labelledby="faq-h"><h2 class="auth-sec-h" id="faq-h">Preguntas frecuentes</h2><div class="faq">' +
    [['¿Por qué necesito una cuenta de Google?', 'Para identificarte y permitirte guardar tus estudios en tu propio Google Drive.'],
      ['¿Necesito una cuenta de Gmail?', 'No necesariamente. Podés ingresar utilizando una cuenta de Google, aunque esté asociada a otro correo electrónico.'],
      ['¿Pueden ver todos mis archivos de Google Drive?', 'No. El permiso solicitado se limita a los archivos que la aplicación crea o a aquellos a los que le concedés acceso.'],
      ['¿Necesito los datos de acceso de mi laboratorio?', 'Sí. Cuando quieras recuperar estudios, te solicitaremos los datos de acceso de la institución correspondiente.'],
      ['¿Se guardan las contraseñas de mis laboratorios?', 'No se almacenan permanentemente. Se utilizan temporalmente para iniciar sesión en la institución durante la recuperación de tus estudios.']]
      .map(q => '<details class="faq-item"><summary><span>' + q[0] + '</span>' + ic('chevron-down', 20, 'faq-chev') + '</summary><p>' + q[1] + '</p></details>').join('') +
    '</div></section>';

  // Cruces decorativas del fondo mobile (en escritorio se ocultan).
  const deco = '<svg class="auth-deco" viewBox="0 0 132 76" aria-hidden="true" focusable="false">' +
    '<path class="deco-a" d="M92 6h10a3 3 0 0 1 3 3v9h9a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-9v9a3 3 0 0 1-3 3H92a3 3 0 0 1-3-3v-9h-9a3 3 0 0 1-3-3V21a3 3 0 0 1 3-3h9V9a3 3 0 0 1 3-3z" fill="#0f8b8d" fill-opacity=".14"/>' +
    '<path class="deco-b" d="M50 40h6a2 2 0 0 1 2 2v5h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5v5a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-5h-5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h5v-5a2 2 0 0 1 2-2z" fill="#3478f6" fill-opacity=".12"/>' +
    '<circle class="deco-c" cx="122" cy="62" r="5" fill="none" stroke="#0f8b8d" stroke-opacity=".3" stroke-width="2"/></svg>';

  function layout(card, opts) {
    const o = opts || {};
    return (
      '<div class="auth"><div class="auth-band">' + deco + brand +
      '<main class="auth-main" id="main" tabindex="-1"><div class="auth-wrap auth-hero-grid">' +
      hero + '<section class="auth-card" aria-labelledby="access-h">' + card + '</section>' +
      '</div></main></div>' +
      '<div class="auth-wrap auth-more">' + (o.info ? steps : '') + institutions() + (o.info ? faq : '') + '</div>' +
      foot + '</div>'
    );
  }

  /* Mensajes del retorno de Google (`#/login?error=CODE`). El servidor usa GOOGLE_ACCESS_DENIED tanto
     para la cancelación como para una cuenta no habilitada, así que el texto cubre ambos casos. */
  function loginMessage(code) {
    if (code === 'SESSION_EXPIRED') return { tone: 'info', icon: 'clock', title: 'Tu sesión terminó',
      text: 'Por seguridad, la sesión se cierra después de un tiempo. Volvé a ingresar con Google para seguir; tus estudios guardados en tu Drive siguen ahí.' };
    if (code === 'GOOGLE_ACCESS_DENIED') return { tone: 'error', icon: 'alert', title: 'No pudimos completar el ingreso',
      text: 'Puede que hayas cancelado el ingreso en Google o que la cuenta elegida ' + (RESTRICTED_ACCOUNTS ? 'todavía no esté habilitada para este Portal' : 'no se haya podido verificar') +
        '. Podés volver a intentarlo con el botón «Continuar con Google»' + (RESTRICTED_ACCOUNTS ? ' y, si tenés más de una cuenta, elegir la que te habilitaron.' : '.') };
    return { tone: 'error', icon: 'alert', title: 'No pudimos completar el ingreso', text: 'Ocurrió un problema al ingresar. Volvé a intentarlo en unos minutos.' };
  }
  const notice = (m, extra) => '<div class="auth-alert auth-alert-' + m.tone + '" role="' + (m.tone === 'error' ? 'alert' : 'status') + '">' + ic(m.icon, 20) +
    '<div><p class="auth-alert-t">' + m.title + '</p><p>' + m.text + '</p>' + (extra || '') + '</div></div>';

  P.renderLogin = function () {
    if (P.authMode === 'google' || P.authMode === 'unknown' && P.portalAuthUnavailable) {
      document.title = 'Ingresar · Portal de Pacientes';
      const error = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
      const body = P.portalAuthUnavailable
        ? notice({ tone: 'error', icon: 'alert', title: 'No pudimos conectar con el Portal', text: 'Revisá que tengas conexión a internet y volvé a intentar. Si el problema sigue, probá de nuevo en unos minutos.' },
          '<button type="button" class="btn btn-secondary btn-block mt-4" data-action="retry-auth">' + ic('retry', 20) + '<span>Reintentar</span></button>')
        : (error ? notice(loginMessage(error)) : '') +
          '<a class="gbtn" href="/api/auth/google/start" data-google-start>' + googleG + '<span class="gbtn-label">Continuar con Google</span></a>' +
          '<p class="sr-only" id="gbtn-status" role="status" aria-live="polite"></p>' +
          '<p class="auth-check">' + ic('check', 18) + '<span>No necesitás registrarte previamente en el Portal.</span></p>' +
          '<details class="auth-noacc"><summary>¿No tenés una cuenta de Google?</summary><div class="auth-noacc-b">' +
          '<p>Podés crear una gratis en el sitio oficial de Google. Te sirve también para otros servicios, como Gmail, y podés usar el correo electrónico que ya tenés.</p>' +
          '<a class="link" href="' + SIGNUP_URL + '" target="_blank" rel="noopener noreferrer">Crear una cuenta de Google' + ic('external', 18) + '<span class="sr-only"> (se abre en otra pestaña)</span></a>' +
          (RESTRICTED_ACCOUNTS ? '<p class="auth-small">El Portal está en etapa de prueba: solo pueden ingresar las cuentas habilitadas. Si creás una cuenta nueva, pedí que la habiliten antes de ingresar.</p>' : '') +
          '</div></details>' + privacyTrigger;
      return layout('<h2 class="auth-title" id="access-h">Accedé a tus estudios</h2>' +
        '<p class="auth-text">Ingresá con tu cuenta de Google para comenzar. Si tenés Gmail, podés usar esa misma cuenta.</p>' + body, { info: true });
    }
    document.title = 'Ingresar · Portal de Pacientes';
    const connectionAlert = P.portalAuthUnavailable
      ? '<div class="alert alert-error" role="alert">No pudimos conectar con el Portal. Revisá la conexión y reintentá.<p><button class="btn btn-secondary btn-sm" type="button" data-action="retry-auth">Reintentar conexión</button></p></div>'
      : '';
    return layout(
      '<h2 class="auth-title" id="access-h">Ingresar</h2>' +
      '<p class="auth-text">Ingresá con la cuenta del piloto.</p>' +
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

  /* Estado «Redirigiendo a Google»: no se cancela la navegación, solo se informa. */
  function resetGoogleButton() {
    const a = document.querySelector('[data-google-start]');
    if (!a) return;
    a.classList.remove('is-busy'); a.removeAttribute('aria-disabled');
    a.querySelector('.gbtn-label').textContent = 'Continuar con Google';
    const s = document.getElementById('gbtn-status'); if (s) s.textContent = '';
  }
  window.addEventListener('pageshow', (e) => { if (e.persisted) resetGoogleButton(); });

  P.mountLogin = function () {
    // Las ilustraciones animan solo mientras están en pantalla.
    const ills = document.querySelectorAll('.ill-wrap');
    if (ills.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => entries.forEach(e => e.target.classList.toggle('is-playing', e.isIntersecting)), { threshold: 0.35 });
      ills.forEach(el => io.observe(el));
    } else ills.forEach(el => el.classList.add('is-playing'));
    const g = document.querySelector('[data-google-start]');
    if (g) g.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (g.classList.contains('is-busy')) { e.preventDefault(); return; }
      g.classList.add('is-busy'); g.setAttribute('aria-disabled', 'true');
      g.querySelector('.gbtn-label').textContent = 'Abriendo Google…';
      document.getElementById('gbtn-status').textContent = 'Te estamos llevando a Google para que elijas tu cuenta.';
      // Si la navegación no ocurre (sin conexión, bloqueo del navegador), el botón vuelve a estar disponible.
      setTimeout(resetGoogleButton, 15000);
    });
    const f = document.getElementById('login-form');
    if (!f) return;
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
    delete document.getElementById('app').dataset.authView; // fuerza el repintado aunque siga sin conexión
    P.route();
  };

  P.renderRecover = () => layout(P.authMode === 'google'
    ? '<h2 class="auth-title" id="access-h">Acceso con Google</h2><p class="auth-text">No necesitás una contraseña del Portal: usá tu cuenta de Google para volver a ingresar.</p><a class="gbtn" href="/api/auth/google/start">' + googleG + '<span class="gbtn-label">Continuar con Google</span></a>'
    : '<h2 class="auth-title" id="access-h">Acceso al piloto</h2><p class="auth-text">Usá el usuario 1234 y la contraseña 1234.</p><a class="btn btn-primary btn-lg btn-block" href="#/login">Volver a ingresar</a>');
  P.mountRecover = () => {};
  P.resetRecover = () => {};
})();
