/* Portal de Pacientes — router por hash, shell y delegación de eventos. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const app = document.getElementById('app');

  const NAV = [
    { key: 'inicio', label: 'Inicio', icon: 'home' },
    { key: 'salud', label: 'Mi salud', icon: 'heart' },
    { key: 'estudios', label: 'Estudios', icon: 'flask' },
    { key: 'historial', label: 'Historial', icon: 'history' },
    { key: 'documentos', label: 'Documentos', icon: 'file' },
  ];
  const MOBILE_NAV = ['inicio', 'salud', 'estudios', 'documentos'];
  const SEEN = new Set();
  let lastTop = null;

  P.applyPrefs = () => document.documentElement.classList.toggle('text-lg', P.db.textSize === 'grande');

  function parse() {
    const h = location.hash.replace(/^#\/?/, '') || 'inicio';
    const [path, qs] = h.split('?');
    return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
  }

  function shell() {
    const link = (n) => '<a class="nav-link" href="#/' + n.key + '" data-nav="' + n.key + '">' + ic(n.icon, 22) + '<span>' + n.label + '</span></a>';
    return (
      '<div class="shell">' +
      '<aside class="sidebar" aria-label="Navegación principal">' +
      '<a class="brand" href="#/inicio" aria-label="Portal de Pacientes, ir al inicio">' + P.logo(36) + '<span class="brand-text"><span class="brand-name">Portal de Pacientes</span><span class="brand-sub">Vertical Salud</span></span></a>' +
      '<nav class="nav">' + NAV.map(link).join('') + '</nav>' +
      '<div class="side-bottom"><nav class="nav nav-sub" aria-label="Cuenta">' +
      '<a class="nav-link" href="#/ayuda" data-nav="ayuda">' + ic('help', 22) + '<span>Ayuda</span></a>' +
      '<a class="nav-link" href="#/perfil" data-nav="perfil">' + ic('user', 22) + '<span>Mi perfil</span></a>' +
      '<button type="button" class="nav-link" data-action="logout">' + ic('logout', 22) + '<span>Cerrar sesión</span></button></nav>' +
      '<a class="side-user" href="#/perfil"><span class="avatar" aria-hidden="true">' + ic('user', 20) + '</span><span class="side-user-t"><b>Mi cuenta</b><span>Preferencias y privacidad</span></span></a>' +
      '<p class="side-endorse">Una solución de 7Ideas</p></div>' +
      '</aside>' +
      '<header class="topbar"><a class="brand brand-top" href="#/inicio" aria-label="Portal de Pacientes, ir al inicio">' + P.logo(32) + '<span class="brand-name">Portal de Pacientes</span></a>' +
      '<a class="avatar avatar-btn" href="#/perfil" aria-label="Mi cuenta">' + ic('user', 20) + '</a></header>' +
      '<main class="main" id="main" tabindex="-1"><div class="view" id="view"></div></main>' +
      '<nav class="bottomnav" aria-label="Navegación principal">' +
      MOBILE_NAV.map((k) => { const n = NAV.find((x) => x.key === k); return '<a class="bn" href="#/' + k + '" data-nav="' + k + '">' + ic(n.icon, 24) + '<span>' + n.label + '</span></a>'; }).join('') +
      '<button type="button" class="bn" data-action="more" data-nav="more" aria-haspopup="dialog">' + ic('menu', 24) + '<span>Más</span></button></nav>' +
      '</div>'
    );
  }

  function skeleton(kind) {
    const line = (w) => '<span class="sk sk-line" style="width:' + w + '"></span>';
    if (kind === 'grid') {
      return '<div class="sk-wrap" aria-busy="true" aria-label="Cargando"><span class="sk sk-title"></span>' + line('38%') +
        '<div class="sk-toolbar"><span class="sk sk-input"></span></div><div class="doc-grid">' +
        Array.from({ length: 8 }, () => '<div class="sk-doc"><span class="sk sk-thumb"></span>' + line('40%') + line('85%') + line('60%') + '</div>').join('') + '</div></div>';
    }
    if (kind === 'home') {
      return '<div class="sk-wrap" aria-busy="true" aria-label="Cargando">' + line('18%') + '<span class="sk sk-title"></span>' + line('30%') +
        '<span class="sk sk-block" style="height:112px;margin-top:32px"></span><span class="sk sk-block" style="height:220px;margin-top:24px"></span></div>';
    }
    return '<div class="sk-wrap" aria-busy="true" aria-label="Cargando"><span class="sk sk-title"></span>' + line('45%') +
      '<div class="sk-toolbar"><span class="sk sk-input"></span></div><div class="card card-flush">' +
      Array.from({ length: 6 }, () => '<div class="sk-row"><span class="sk sk-tile"></span><span class="sk-col">' + line('45%') + line('25%') + '</span>' + line('14%') + '</div>').join('') + '</div></div>';
  }

  function renderView(r, opts) {
    const identityGeneration = P.identityGeneration;
    const top = r.parts[0];
    const key = top === 'estudios' && r.parts[1] ? 'estudio' : top;
    const screen = P.screens[key];
    const view = document.getElementById('view');
    if (!screen) { location.replace('#/inicio'); return; }
    const out = screen(r);
    document.title = out.title + ' · Portal de Pacientes';

    document.querySelectorAll('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === top || (a.dataset.nav === 'more' && ['historial', 'perfil', 'ayuda'].includes(top));
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    const paint = () => {
      if (identityGeneration !== P.identityGeneration || !P.db.session) return;
      view.innerHTML = out.html + (P.cloudBanner && ['inicio', 'estudios', 'documentos'].includes(key) ? P.cloudBanner() : '');
      if (!(opts && opts.quiet)) {
        view.classList.remove('is-entering');
        void view.offsetWidth;
        view.classList.add('is-entering');
      }
      if (out.mount) out.mount(view);
    };

    const skKey = key === 'inicio' ? 'home' : out.skeleton;
    if (skKey && !SEEN.has(key) && !(opts && opts.quiet)) {
      SEEN.add(key);
      view.innerHTML = skeleton(skKey);
      setTimeout(() => { if (parse().parts.join('/') === r.parts.join('/')) { paint(); focusHeading(); } }, P.reducedMotion() ? 120 : 520);
    } else {
      SEEN.add(key);
      paint();
    }
  }

  function focusHeading() {
    const h = document.querySelector('#view h1');
    if (h) h.focus({ preventScroll: true });
  }

  P.route = function () {
    if (P.identityChanged) return;
    const r = parse();
    const top = r.parts[0];
    const isAuth = top === 'login' || top === 'recuperar';
    P.applyPrefs();

    if (!P.db.session && !isAuth) { location.replace('#/login'); return; }
    if (P.db.session && isAuth) { location.replace('#/inicio'); return; }
    P.closeAllOverlays();
    // Salir de «Traer mis estudios» (por ejemplo con el botón Atrás) cancela una importación real en curso.
    if (lastTop === 'traer' && top !== 'traer' && P.leaveFlow) P.leaveFlow();

    if (isAuth) {
      if (top === 'login' && lastTop !== 'login') P.resetRecover();
      app.innerHTML = top === 'login' ? P.renderLogin() : P.renderRecover();
      if (top === 'login') P.mountLogin(); else P.mountRecover();
      const h = app.querySelector('h1');
      if (lastTop && h) h.focus({ preventScroll: true });
      lastTop = top;
      window.scrollTo(0, 0);
      return;
    }

    if (top === 'traer') {
      if (lastTop !== 'traer') {
        P.flow.returnTo = lastTop && lastTop !== 'login' ? '#/' + (lastTop === 'estudio' ? 'estudios' : lastTop) : '#/estudios';
        P.startFlow(r.query);
        app.innerHTML = P.renderFlow();
      }
      lastTop = 'traer';
      P.mountFlow();
      return;
    }

    if (!app.querySelector('.shell')) app.innerHTML = shell();
    const same = lastTop === top;
    lastTop = top;
    renderView(r);
    if (!same || r.parts.length > 1) window.scrollTo(0, 0);
    if (P.ui.navigated) focusHeading();
    P.ui.navigated = true;
  };

  /* Re-pinta la vista actual sin animación ni skeleton, conservando el scroll. */
  P.rerender = function () {
    if (!document.getElementById('view')) return;
    const y = window.scrollY;
    renderView(parse(), { quiet: true });
    window.scrollTo(0, y);
  };

  /* ---------- Acciones globales ---------- */
  P.actions.logout = async () => {
    const ok = await P.confirm({ title: '¿Cerrar sesión?', text: 'Vas a tener que ingresar de nuevo para volver a entrar.', confirmLabel: 'Cerrar sesión' });
    if (!ok) return;
    if (P.portalAuthEnabled) {
      try {
        const response = await fetch(P.agent.base() + '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('LOGOUT_FAILED');
      } catch { P.toast('No pudimos cerrar la sesión. Volvé a intentar.', { tone: 'danger' }); return; }
    }
    if (P.authMode === 'google') {
      P.applyIdentity('google', null);
      try { localStorage.setItem('pp_auth_changed', String(Date.now()) + Math.random()); } catch {}
      P.identityChanged = true; location.replace('/#/login'); location.reload(); return;
    }
    P.db.session = null;
    P.save();
    P.ui.navigated = false;
    SEEN.clear();
    location.hash = '#/login';
  };

  P.actions.skip = () => { const m = document.getElementById('main'); if (m) m.focus(); };

  P.actions.more = () => {
    const h = P.overlay({
      kind: 'sheet',
      title: 'Más opciones',
      body:
        '<nav class="sheet-nav" aria-label="Más opciones">' +
        '<a href="#/historial">' + ic('history', 22) + '<span>Historial</span>' + ic('chevron-right', 20, 'chev') + '</a>' +
        '<a href="#/perfil">' + ic('user', 22) + '<span>Mi perfil</span>' + ic('chevron-right', 20, 'chev') + '</a>' +
        '<a href="#/perfil/privacidad">' + ic('shield', 22) + '<span>Privacidad y accesos</span>' + ic('chevron-right', 20, 'chev') + '</a>' +
        '<a href="#/ayuda">' + ic('help', 22) + '<span>Ayuda</span>' + ic('chevron-right', 20, 'chev') + '</a>' +
        '<button type="button" data-sheet-logout>' + ic('logout', 22) + '<span>Cerrar sesión</span></button></nav>' +
        '<p class="side-endorse">Una solución de 7Ideas</p>',
    });
    h.el.querySelector('[data-sheet-logout]').addEventListener('click', () => { h.close(); P.actions.logout(); });
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('[aria-disabled="true"]') && el.dataset.action !== 'inst-pick') return;
    const fn = P.actions[el.dataset.action];
    if (fn) fn(el, e);
  });
  document.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.input;
    if (k && P.inputs[k]) P.inputs[k](e.target, e);
  });
  document.addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.change;
    if (k && P.changes[k]) P.changes[k](e.target, e);
  });
  /* Tabs con flechas del teclado */
  document.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const tabs = Array.from(tab.parentElement.querySelectorAll('[role="tab"]'));
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
  });

  window.addEventListener('hashchange', P.route);
  window.addEventListener('storage', event => {
    if (event.key === 'pp_auth_changed') {
      app.textContent = 'Verificando tu sesión…';
      P.closeAllOverlays();
      P.prepareAuth().then(P.route); return;
    }
    if (!P.portalAuthEnabled || event.key !== P.STORE_KEY) return;
    try {
      if (!JSON.parse(event.newValue || '{}').session) { P.db.session = null; location.hash = '#/login'; }
    } catch {}
  });
  window.addEventListener('focus', () => { if (P.authMode === 'google') P.prepareAuth().then(P.route); });
  P.prepareAuth().then(() => { P.appReady = true; P.route(); });
})();
