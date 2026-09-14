(function () {
  const SCREENS = ['inicio', 'turnos', 'estudios', 'notificaciones', 'perfil'];

  function showScreen(id) {
    SCREENS.forEach((s) => {
      document.getElementById('screen-' + s).classList.toggle('is-active', s === id);
    });
    document.querySelectorAll('.app-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.goto === id);
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id === 'notificaciones') renderNotificaciones();
  }

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => showScreen(el.dataset.goto));
  });

  // --- Toasts ---
  function showToast(message) {
    const stack = document.getElementById('toastStack');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg><span>${message}</span>`;
    stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 250);
    }, 2600);
  }

  // --- Inicio ---
  function renderInicio() {
    const t = APP_TURNOS.proximos[0];
    const card = document.getElementById('proximoTurnoCard');
    card.innerHTML = t ? `
      <div class="app-turno-prof">${t.profesional}</div>
      <div class="app-turno-esp">${t.especialidad}</div>
      <div class="app-turno-when">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>
        ${t.fecha} · ${t.hora}
      </div>
      <div class="app-turno-lugar">${t.lugar}</div>
      <div class="app-turno-actions">
        <button class="btn btn-secondary btn-sm" data-goto="turnos">Ver detalle</button>
        <button class="btn btn-ghost btn-sm" id="btnComoLlegar">Cómo llegar</button>
      </div>`
      : `<p style="color: var(--ink-soft); font-size: var(--fs-sm)">No tenés turnos próximos.</p>`;

    const comoLlegar = document.getElementById('btnComoLlegar');
    if (comoLlegar) comoLlegar.addEventListener('click', () => showToast('Abriendo mapa (simulado)'));
    card.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => showScreen(el.dataset.goto)));

    const mini = document.getElementById('notifMini');
    mini.innerHTML = APP_NOTIFICACIONES.slice(0, 2).map((n) => `
      <div class="app-notif-mini-row">
        <div class="app-notif-title">${n.titulo}</div>
        <div class="app-notif-body">${n.cuerpo}</div>
      </div>`).join('');
  }

  // --- Turnos ---
  function renderTurnos() {
    document.getElementById('turnosProximos').innerHTML = APP_TURNOS.proximos.length
      ? APP_TURNOS.proximos.map((t) => `
        <div class="app-list-card">
          <div class="app-list-card-head">
            <div>
              <div class="app-list-card-title">${t.profesional}</div>
              <div class="app-list-card-sub">${t.especialidad}</div>
            </div>
            <span class="badge ${t.estado === 'Confirmado' ? 'badge-success' : 'badge-pending'}">${t.estado}</span>
          </div>
          <div class="app-list-card-meta">${t.fecha} · ${t.hora} · ${t.lugar}</div>
          <div class="app-list-card-actions">
            <button class="btn btn-secondary btn-sm" data-reprogramar="${t.id}">Reprogramar</button>
            <button class="btn btn-danger-ghost btn-sm" data-cancelar="${t.id}">Cancelar</button>
          </div>
        </div>`).join('')
      : `<p style="color: var(--ink-soft); font-size: var(--fs-sm)">No tenés turnos próximos.</p>`;

    document.getElementById('turnosHistorial').innerHTML = APP_TURNOS.historial.map((t) => `
      <div class="app-list-card">
        <div class="app-list-card-head">
          <div>
            <div class="app-list-card-title">${t.profesional}</div>
            <div class="app-list-card-sub">${t.especialidad}</div>
          </div>
          <span class="badge badge-neutral">${t.estado}</span>
        </div>
        <div class="app-list-card-meta">${t.fecha} · ${t.hora}</div>
      </div>`).join('');

    document.querySelectorAll('[data-cancelar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cancelar;
        APP_TURNOS.proximos = APP_TURNOS.proximos.filter((t) => t.id !== id);
        renderTurnos();
        renderInicio();
        showToast('Turno cancelado. Te avisamos por WhatsApp.');
        const title = document.querySelector('#screen-turnos .app-screen-title');
        title.setAttribute('tabindex', '-1');
        title.focus();
      });
    });
    document.querySelectorAll('[data-reprogramar]').forEach((btn) => {
      btn.addEventListener('click', () => showToast('Te enviamos las opciones de horario por WhatsApp.'));
    });
  }

  // --- Pedir turno (drawer) ---
  const scrim = document.getElementById('scrim');
  const drawerTurno = document.getElementById('drawerPedirTurno');
  const drawerEstudio = document.getElementById('drawerEstudio');

  let drawerReturnFocus = null;

  function openDrawer(drawer, triggerEl) {
    drawerReturnFocus = triggerEl || document.activeElement;
    drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-open');
    drawer.classList.add('is-open');
    drawer.querySelector('.app-drawer-close').focus();
  }
  function closeDrawers() {
    scrim.classList.remove('is-open');
    [drawerTurno, drawerEstudio].forEach((d) => { d.classList.remove('is-open'); d.setAttribute('aria-hidden', 'true'); });
    if (drawerReturnFocus && document.body.contains(drawerReturnFocus)) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }
  scrim.addEventListener('click', closeDrawers);
  document.getElementById('closeDrawerTurno').addEventListener('click', closeDrawers);
  document.getElementById('closeDrawerEstudio').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (drawerTurno.classList.contains('is-open') || drawerEstudio.classList.contains('is-open'))) closeDrawers();
  });

  document.getElementById('fabPedirTurno').addEventListener('click', (e) => {
    document.getElementById('especialidadesList').innerHTML = APP_ESPECIALIDADES_DISPONIBLES.map((esp) =>
      `<button class="app-especialidad-btn" data-esp="${esp}">${esp}</button>`).join('');
    document.querySelectorAll('.app-especialidad-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeDrawers();
        showToast(`Solicitamos tu turno de ${btn.dataset.esp}. Te confirmamos por WhatsApp.`);
      });
    });
    openDrawer(drawerTurno, e.currentTarget);
  });

  // --- Estudios ---
  function renderEstudios() {
    document.getElementById('estudiosList').innerHTML = APP_ESTUDIOS.map((e) => `
      <div class="app-list-card${e.estado === 'disponible' ? ' is-clickable' : ''}" data-estudio="${e.id}"${e.estado === 'disponible' ? ' role="button" tabindex="0"' : ''} aria-label="${e.nombre}${e.estado === 'disponible' ? '' : ', pendiente'}">
        <div class="app-list-card-head">
          <div>
            <div class="app-list-card-title">${e.nombre}</div>
            <div class="app-list-card-sub">Solicitado por ${e.profesional}</div>
          </div>
          <span class="badge ${e.estado === 'disponible' ? 'badge-success' : 'badge-pending'}">${e.estado === 'disponible' ? 'Disponible' : 'Pendiente'}</span>
        </div>
        <div class="app-list-card-meta">${e.fecha}</div>
      </div>`).join('');

    function abrirEstudio(card) {
        const e = APP_ESTUDIOS.find((x) => x.id === card.dataset.estudio);
        if (e.estado !== 'disponible') return;
        document.getElementById('estudioDrawerTitle').textContent = e.nombre;
        document.getElementById('estudioDrawerBody').innerHTML = `
          <p style="color: var(--ink-soft); font-size: var(--fs-sm); margin-bottom: var(--sp-4)">Solicitado por ${e.profesional} · ${e.fecha}</p>
          <div class="doc-row">
            <div class="doc-icon"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2h6l1 4H8l1-4z"/><path d="M6 6h12l1 15H5L6 6z"/></svg></div>
            <div class="doc-info">
              <div class="doc-name">${e.nombre}.pdf</div>
              <div class="doc-meta">Resultado listo para descargar</div>
            </div>
          </div>
          <button class="btn btn-accent btn-block" id="btnDescargarEstudio" style="margin-top: var(--sp-5)" type="button">Descargar PDF</button>`;
        document.getElementById('btnDescargarEstudio').addEventListener('click', () => showToast('Descarga simulada'));
        openDrawer(drawerEstudio, card);
    }

    document.querySelectorAll('[data-estudio]').forEach((card) => {
      card.addEventListener('click', () => abrirEstudio(card));
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirEstudio(card); }
      });
    });
  }

  // --- Notificaciones ---
  function updateBellBadge() {
    const noLeidas = APP_NOTIFICACIONES.filter((n) => !n.leida).length;
    const badge = document.getElementById('bellBadge');
    badge.hidden = noLeidas === 0;
    badge.textContent = noLeidas;
  }

  const NOTIF_ICONS = {
    turno: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    estudio: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2h6l1 4H8l1-4z"/><path d="M6 6h12l1 15H5L6 6z"/></svg>',
    documentacion: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    recordatorio: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>',
  };

  function renderNotificaciones() {
    document.getElementById('notifList').innerHTML = APP_NOTIFICACIONES.map((n) => `
      <div class="app-notif-row${n.leida ? '' : ' is-unread'}" data-notif="${n.id}" role="button" tabindex="0" aria-label="${n.titulo}${n.leida ? '' : ', sin leer'}">
        <div class="app-notif-icon">${NOTIF_ICONS[n.tipo] || ''}</div>
        <div class="app-notif-content">
          <div class="app-notif-title">${n.titulo}</div>
          <div class="app-notif-body">${n.cuerpo}</div>
          <div class="app-notif-hora">${n.hora}</div>
        </div>
        ${n.leida ? '' : '<span class="app-notif-dot" aria-hidden="true"></span>'}
      </div>`).join('');

    function marcarLeida(row) {
      const n = APP_NOTIFICACIONES.find((x) => x.id === row.dataset.notif);
      n.leida = true;
      renderNotificaciones();
      updateBellBadge();
      const same = document.querySelector(`[data-notif="${n.id}"]`);
      if (same) same.focus();
    }

    document.querySelectorAll('[data-notif]').forEach((row) => {
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); marcarLeida(row); }
      });
      row.addEventListener('click', () => marcarLeida(row));
    });
    updateBellBadge();
  }

  document.getElementById('bellBtn').addEventListener('click', () => showScreen('notificaciones'));

  // --- Perfil / documentos ---
  function renderDocumentos() {
    document.getElementById('documentosList').innerHTML = APP_DOCUMENTOS.map((d) => `
      <div class="doc-row">
        <div class="doc-icon"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></div>
        <div class="doc-info">
          <div class="doc-name">${d.tipo}</div>
          <div class="doc-meta">${d.nombre}</div>
        </div>
        <span class="badge ${d.estado === 'validado' ? 'badge-success' : 'badge-pending'}">${d.estado === 'validado' ? 'Validado' : 'Pendiente'}</span>
      </div>`).join('');
  }

  renderInicio();
  renderTurnos();
  renderEstudios();
  renderDocumentos();
  updateBellBadge();
})();
