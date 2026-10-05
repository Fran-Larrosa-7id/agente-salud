/* Portal de Pacientes — flujo «Traer mis estudios».
   Las instituciones con `live` (Pérez Cambet) usan el agente de IA real (portal-pacientes-agent):
   el paciente inicia sesión en la ventana del laboratorio y el agente hace el resto.
   El resto de las instituciones sigue simulado. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const A = P.actions;
  const F = (P.flow = { step: 'select', inst: null, found: [], selected: new Set(), q: '', more: false, run: 0, retried: {}, saved: [], existing: [], returnTo: '#/estudios', live: null });

  const STEPS = ['Institución', 'Autorización', 'Búsqueda', 'Selección'];
  const LIVE_STEPS = ['Institución', 'Inicio de sesión', 'Búsqueda', 'Descarga'];
  const STEP_INDEX = { select: 0, explain: 1, connect: 1, search: 2, results: 3, success: 4, wait: 1, lsearch: 2, lparser: 2, lresults: 3, download: 3 };
  const steps = () => (F.inst && P.inst(F.inst).live ? LIVE_STEPS : STEPS);
  const stepIndex = () => (F.step === 'human' || F.step === 'lerror' || F.step === 'lparser' ? (F.live && F.live.at) || 1 : STEP_INDEX[F.step]);

  P.startFlow = function (query) {
    F.run++;
    liveClose(true);
    Object.assign(F, { step: 'select', inst: null, found: [], selected: new Set(), q: '', more: false, saved: [], existing: [], live: null });
    const pre = query && query.get('inst');
    if (pre && P.inst(pre).compatible) { F.inst = pre; F.step = 'explain'; }
  };
  P.leaveFlow = () => { F.run++; liveClose(true); };

  P.renderFlow = function () {
    return (
      '<div class="flow">' +
      '<header class="flow-bar"><div class="flow-bar-in">' +
      '<span class="flow-brand">' + P.logo(32) + '<span>Traer mis estudios</span></span>' +
      '<ol class="stepper" id="stepper" aria-label="Progreso"></ol>' +
      '<button type="button" class="btn btn-ghost flow-exit" data-action="flow-exit">' + ic('x', 20) + '<span>Salir</span></button>' +
      '</div><div class="flow-progress" aria-hidden="true"><span id="flow-progress-bar"></span></div></header>' +
      '<main class="flow-main" id="main" tabindex="-1"><div id="flow-view" class="flow-view"></div></main>' +
      '</div>'
    );
  };

  function stepper() {
    const cur = stepIndex();
    const STEPS = steps();
    const el = document.getElementById('stepper');
    el.innerHTML =
      STEPS.map((s, i) =>
        '<li class="st' + (i < cur ? ' is-done' : i === cur ? ' is-current' : '') + '"' + (i === cur ? ' aria-current="step"' : '') + '>' +
        '<span class="st-dot">' + (i < cur ? ic('check', 14) : i + 1) + '</span><span class="st-l">' + s + '</span>' +
        '<span class="sr-only">' + (i < cur ? ' (completado)' : '') + '</span></li>'
      ).join('') +
      '<li class="st-compact" aria-hidden="true">' + (cur < 4 ? 'Paso ' + (cur + 1) + ' de 4 · ' + STEPS[cur] : 'Completado') + '</li>';
    document.getElementById('flow-progress-bar').style.transform = 'scaleX(' + Math.min(1, (cur + (cur < 4 ? 0.5 : 0)) / 4) + ')';
  }

  function go(step) {
    F.step = step;
    P.mountFlow();
  }

  P.mountFlow = function () {
    stepper();
    const v = document.getElementById('flow-view');
    const html = {
      select: viewSelect, explain: viewExplain, connect: viewConnect, search: viewSearch, results: viewResults, success: viewSuccess,
      wait: viewWait, human: viewHuman, lsearch: viewLiveSearch, lparser: viewParserMismatch, lresults: viewLiveResults, download: viewDownload, lerror: viewLiveError,
    }[F.step]();
    v.innerHTML = '<div class="fv fv-' + F.step + '">' + html + '</div>';
    document.title = steps()[Math.min(stepIndex(), 3)] + ' · Traer mis estudios · Portal de Pacientes';
    window.scrollTo(0, 0);
    const h = v.querySelector('h1');
    if (h && F.step !== 'select') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (F.step === 'select') { const q = document.getElementById('inst-q'); if (q && !matchMedia('(max-width: 760px)').matches) q.focus({ preventScroll: true }); }
    if (F.step === 'search') runSearch();
  };

  /* ---------- Paso 1: institución ---------- */
  function instRows() {
    const q = F.q.trim().toLowerCase();
    const list = P.INSTITUTIONS.filter((i) => (q ? (i.name + ' ' + P.instSub(i)).toLowerCase().includes(q) : F.more || i.featured));
    if (!list.length) {
      return P.empty({
        compact: true, icon: 'search',
        title: 'No encontramos «' + P.esc(F.q) + '»',
        text: 'Probá con otra parte del nombre. Si tu institución todavía no está, podés sugerirla.',
        action: '<button type="button" class="btn btn-secondary" data-action="inst-suggest">Sugerir institución</button>',
      });
    }
    return '<ul class="inst-list">' + list.map((i) => {
      const auth = P.authorization(i.id);
      const badge = !i.compatible ? P.badge('neutral', 'Próximamente', 'clock')
        : i.live ? P.badge('teal', 'Asistente IA', 'sparkle')
        : auth ? P.badge('info', 'Conectada', 'link') : P.badge('teal', 'Compatible', 'check');
      return '<li><button type="button" class="inst-row" data-action="inst-pick" data-id="' + i.id + '"' + (i.compatible ? '' : ' aria-disabled="true"') + '>' +
        P.mono(i.id, 'lg') +
        '<span class="inst-row-main"><span class="inst-row-name">' + i.name + '</span><span class="inst-row-sub">' + P.instSub(i) + '</span></span>' +
        badge + ic('chevron-right', 20, 'chev') + '</button></li>';
    }).join('') + '</ul>';
  }

  function viewSelect() {
    const hidden = P.INSTITUTIONS.filter((i) => !i.featured).length;
    return (
      '<h1 class="flow-title" tabindex="-1">¿Dónde te hiciste los estudios?</h1>' +
      '<p class="flow-sub">Elegí la institución. Después vas a poder repetirlo con otras.</p>' +
      '<label class="search search-lg"><span class="sr-only">Buscar institución</span>' + ic('search', 22) +
      '<input type="search" id="inst-q" data-input="inst-q" value="' + P.esc(F.q) + '" placeholder="Buscá por nombre, tipo o localidad" autocomplete="off"></label>' +
      '<div class="list-head"><h2 class="list-h" id="inst-h">' + (F.q ? 'Resultados' : 'Instituciones conocidas') + '</h2>' +
      '<p class="legend"><span>' + ic('check', 16) + 'Compatible: podemos traer tus estudios automáticamente.</span>' +
      '<span>' + ic('sparkle', 16) + 'Asistente IA: vos iniciás sesión y el asistente trae tus PDF originales.</span></p></div>' +
      '<div id="inst-results">' + instRows() + '</div>' +
      (F.q || F.more ? '' : '<button type="button" class="more-btn" data-action="inst-more">' + ic('plus', 18) + 'Ver más instituciones <span class="num">(' + hidden + ')</span></button>') +
      '<p class="flow-foot">¿No encontrás la tuya? <button type="button" class="link" data-action="inst-suggest">Sugerir una institución</button></p>'
    );
  }

  P.inputs['inst-q'] = (el) => {
    F.q = el.value;
    document.getElementById('inst-results').innerHTML = instRows();
    document.getElementById('inst-h').textContent = F.q ? 'Resultados' : 'Instituciones conocidas';
    const more = document.querySelector('.more-btn');
    if (more) more.hidden = !!F.q;
  };
  A['inst-more'] = (el) => {
    F.more = true;
    el.remove();
    document.getElementById('inst-results').innerHTML = instRows();
    const rows = document.querySelectorAll('.inst-row');
    if (rows[6]) rows[6].focus();
  };
  A['inst-pick'] = (el) => {
    const i = P.inst(el.dataset.id);
    if (!i.compatible) {
      P.toast(i.name + ' todavía no es compatible. Estamos trabajando para sumarla.', { icon: 'clock', tone: 'info' });
      return;
    }
    F.inst = i.id;
    go('explain');
  };
  A['inst-suggest'] = () => {
    const h = P.overlay({
      kind: 'modal', size: 'sm', title: 'Sugerir una institución',
      body: '<form id="sug-form" novalidate><p class="ov-text">Contanos dónde te hacés estudios. Vamos sumando instituciones según lo que más nos piden.</p>' +
        '<div class="field mt-4"><label for="sug-n">Nombre de la institución</label><input class="input" id="sug-n" value="' + P.esc(F.q) + '" autofocus></div>' +
        '<div class="field"><label for="sug-c">Localidad <span class="optional">(opcional)</span></label><input class="input" id="sug-c"></div></form>',
      footer: '<button class="btn btn-secondary" type="button" data-ov-close>Cancelar</button><button class="btn btn-primary" type="submit" form="sug-form">Enviar sugerencia</button>',
    });
    h.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = h.el.querySelector('#sug-n');
      if (!n.value.trim()) { n.setAttribute('aria-invalid', 'true'); n.focus(); return; }
      h.close();
      P.toast('Gracias. Te avisamos cuando ' + P.esc(n.value.trim()) + ' sea compatible.', { icon: 'mail' });
    });
  };

  /* ---------- Paso 2: explicación ---------- */
  function viewExplain() {
    const i = P.inst(F.inst);
    if (i.live) return viewLiveExplain(i);
    const steps = [
      ['external', 'Abrimos el acceso oficial de ' + i.name, 'Se abre su propio sitio de ingreso, no el nuestro.'],
      ['user', 'Iniciás sesión directamente allí', 'Con el usuario y la contraseña que ya usás en ' + i.name + '.'],
      ['search', 'Con tu autorización, buscamos tus estudios', 'Solo leemos los estudios disponibles a tu nombre.'],
      ['check', 'Elegís cuáles guardar', 'Nada se guarda en tu historial sin que lo confirmes.'],
    ];
    return (
      '<div class="flow-inst">' + P.mono(i.id, 'lg') + '<span class="fi-t"><b>' + i.name + '</b><span>' + P.instSub(i) + '</span></span>' +
      '<button type="button" class="link" data-action="flow-back">Cambiar</button></div>' +
      '<h1 class="flow-title">Vamos a ayudarte a traer tus estudios</h1>' +
      '<p class="flow-sub">Son cuatro pasos y te llevan menos de un minuto.</p>' +
      '<ol class="how">' + steps.map((s, n) =>
        '<li style="--i:' + n + '"><span class="how-n" aria-hidden="true">' + (n + 1) + '</span><div><h2 class="how-t">' + s[1] + '</h2><p>' + s[2] + '</p></div></li>').join('') + '</ol>' +
      '<div class="assure">' + ic('shield', 24) + '<div><p class="assure-t">El Portal de Pacientes no guarda tu contraseña de ' + i.name + '.</p>' +
      '<p>La escribís solo en su sitio. Podés quitar la autorización cuando quieras desde Mi perfil → Privacidad.</p></div></div>' +
      '<div class="flow-actions"><button type="button" class="btn btn-ghost" data-action="flow-back">' + ic('arrow-left', 18) + 'Elegir otra institución</button>' +
      '<button type="button" class="btn btn-accent btn-lg" data-action="flow-connect">Continuar a ' + i.name + ic('external', 18) + '</button></div>'
    );
  }
  A['flow-back'] = () => go('select');
  A['flow-connect'] = () => go('connect');

  /* ---------- Paso 3: acceso externo (simulado) ---------- */
  function viewConnect() {
    const i = P.inst(F.inst);
    return (
      '<h1 class="sr-only">Iniciá sesión en ' + i.name + '</h1>' +
      '<p class="ext-note">' + ic('external', 18) + '<span>Se abrió el sitio de <b>' + i.name + '</b>. Lo que escribas ahí no pasa por el Portal de Pacientes.</span></p>' +
      '<div class="browser t-' + i.tone + '" role="group" aria-label="Sitio de ' + i.name + ' (simulado)">' +
      '<div class="browser-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="url">' + ic('lock', 14) + '<span>' + i.host + '/ingresar</span></span></div>' +
      '<div class="browser-body" id="ext-body">' + extLogin(i) + '</div></div>' +
      '<p class="ext-cancel"><button type="button" class="link" data-action="flow-back-explain">Cancelar y volver</button></p>'
    );
  }

  function extHead(i) {
    return '<div class="ext-head"><span class="ext-logo">' + i.mono + '</span><span class="ext-brand">' + i.name + '<small>Portal de resultados</small></span></div>';
  }
  function extLogin(i) {
    return (
      '<div class="ext">' + extHead(i) +
      '<form class="ext-form" id="ext-form" novalidate><h2>Ingresá a tu cuenta</h2>' +
      '<label class="ext-field"><span>Número de documento</span><input id="ext-dni" inputmode="numeric" value="' + P.PATIENT.dni + '" autocomplete="off"></label>' +
      '<label class="ext-field"><span>Contraseña</span><input id="ext-pass" type="password" autocomplete="off" placeholder="Tu contraseña de ' + i.name + '"></label>' +
      '<p class="ext-err" id="ext-err" role="alert" hidden>Ingresá tu contraseña.</p>' +
      '<button class="ext-btn" type="submit">Ingresar</button>' +
      '<p class="ext-demo">Demo: escribí cualquier contraseña.</p></form></div>'
    );
  }
  function extConsent(i) {
    return (
      '<div class="ext ext-consent">' + extHead(i) +
      '<div class="ext-apps" aria-hidden="true"><span class="ext-logo">' + i.mono + '</span><span class="ext-link">' + ic('arrow-right', 18) + '</span>' + P.logo(40) + '</div>' +
      '<h2>Portal de Pacientes quiere acceder a tus estudios</h2>' +
      '<p class="ext-who">' + P.PATIENT.full + ' · DNI <span class="num">' + P.PATIENT.dniFmt + '</span></p>' +
      '<ul class="ext-perms">' +
      '<li class="yes">' + ic('check', 18) + 'Ver la lista de tus estudios</li>' +
      '<li class="yes">' + ic('check', 18) + 'Descargar tus resultados e informes</li>' +
      '<li class="no">' + ic('x', 18) + 'No podrá ver ni guardar tu contraseña</li>' +
      '<li class="no">' + ic('x', 18) + 'No podrá modificar tus datos</li></ul>' +
      '<div class="ext-actions"><button type="button" class="ext-btn ext-btn-2" data-action="ext-deny">No autorizar</button>' +
      '<button type="button" class="ext-btn" data-action="ext-allow">Autorizar</button></div></div>'
    );
  }

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ext-form') return;
    e.preventDefault();
    const pass = document.getElementById('ext-pass');
    if (!pass.value) { document.getElementById('ext-err').hidden = false; pass.focus(); return; }
    const btn = e.target.querySelector('.ext-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Ingresando…';
    const token = F.run;
    await P.wait(900);
    if (token !== F.run || F.step !== 'connect') return;
    const body = document.getElementById('ext-body');
    body.innerHTML = extConsent(P.inst(F.inst));
    body.querySelector('[data-action="ext-allow"]').focus();
  });
  A['ext-allow'] = async (el) => {
    el.disabled = true;
    const token = F.run;
    const b = document.querySelector('.browser');
    b.classList.add('is-closing');
    await P.wait(320);
    if (token !== F.run) return;
    go('search');
  };
  A['ext-deny'] = () => {
    go('explain');
    P.toast('No autorizaste el acceso. No se compartió ningún dato.', { icon: 'info', tone: 'info' });
  };
  A['flow-back-explain'] = () => go('explain');

  /* ---------- Paso 4: búsqueda ---------- */
  function viewSearch() {
    const i = P.inst(F.inst);
    const slots = 6;
    return (
      '<div class="scan" aria-hidden="true">' +
      '<div class="scan-src">' + P.mono(i.id, 'lg') + '</div>' +
      '<div class="scan-track"><span></span><span></span><span></span></div>' +
      '<div class="scan-grid" id="scan-grid">' + Array.from({ length: slots }, () => '<span class="slot"></span>').join('') + '</div>' +
      '</div>' +
      '<h1 class="flow-title center" id="search-title">Buscando tus estudios…</h1>' +
      '<p class="flow-sub center" id="search-sub">Estamos revisando lo que ' + i.name + ' tiene disponible para vos.</p>' +
      '<ol class="plist" id="plist" aria-live="polite">' +
      ['Conectando con ' + i.name + '…', 'Revisar estudios disponibles', 'Contar documentos', 'Preparar resultados'].map((t, n) =>
        '<li class="pl" data-state="pending" data-n="' + n + '"><span class="pl-icon" aria-hidden="true"><span class="pl-spin"></span>' + ic('check', 14) + ic('x', 14) + '</span><span class="pl-text">' + t + '</span></li>').join('') +
      '</ol><div id="search-error"></div>'
    );
  }

  async function runSearch() {
    const token = ++F.run;
    const alive = () => token === F.run && F.step === 'search';
    const i = P.inst(F.inst);
    const found = P.findImportable(F.inst);
    const fail = i.flaky && !F.retried[i.id];
    const items = document.querySelectorAll('#plist .pl');
    const set = (n, state, text) => { const li = items[n]; li.dataset.state = state; if (text) li.querySelector('.pl-text').textContent = text; };

    set(0, 'active');
    await P.wait(1200);
    if (!alive()) return;
    if (fail) {
      set(0, 'error', 'No pudimos conectar con ' + i.name);
      document.getElementById('search-title').textContent = 'No pudimos conectarnos';
      document.getElementById('search-sub').textContent = 'No se guardó ningún dato.';
      document.querySelector('.scan').classList.add('is-error');
      document.getElementById('search-error').innerHTML =
        '<div class="error-card" role="alert">' + ic('alert', 22) + '<div><p class="error-t">' + i.name + ' no responde en este momento.</p>' +
        '<p>Suele resolverse en unos minutos. Podés intentar de nuevo o elegir otra institución.</p>' +
        '<div class="btn-row mt-4"><button type="button" class="btn btn-primary" data-action="search-retry">' + ic('retry', 18) + 'Reintentar</button>' +
        '<button type="button" class="btn btn-secondary" data-action="flow-back">Elegir otra institución</button></div></div></div>';
      document.querySelector('[data-action="search-retry"]').focus();
      return;
    }
    set(0, 'done', 'Conexión realizada');
    set(1, 'active', 'Revisando estudios disponibles…');
    const slots = document.querySelectorAll('#scan-grid .slot');
    for (let n = 0; n < found.length && n < slots.length; n++) {
      await P.wait(420);
      if (!alive()) return;
      slots[n].innerHTML = P.paper({ inst: F.inst, isImage: found[n].type !== 'laboratorio' });
      slots[n].classList.add('is-filled');
    }
    await P.wait(450);
    if (!alive()) return;
    set(1, 'done', 'Estudios revisados');
    set(2, 'done', found.length ? 'Encontramos ' + P.plural(found.length, 'documento', 'documentos') : 'No hay estudios nuevos');
    set(3, 'active', 'Preparando resultados…');
    document.getElementById('search-title').textContent = found.length ? 'Encontramos tus estudios' : 'Revisión terminada';
    await P.wait(900);
    if (!alive()) return;
    set(3, 'done', 'Resultados listos');
    await P.wait(350);
    if (!alive()) return;
    F.found = found;
    F.selected = new Set(found.map((f) => f.id));
    go('results');
  }
  A['search-retry'] = () => { F.retried[F.inst] = true; go('search'); };

  /* ---------- Paso 5: resultados ---------- */
  function viewResults() {
    const i = P.inst(F.inst);
    if (!F.found.length) {
      return (
        '<div class="res-empty">' + P.empty({
          icon: 'file-check',
          title: 'Ya tenés todos tus estudios de ' + i.name,
          text: 'No encontramos estudios nuevos desde la última vez. Cuando haya resultados nuevos, podés volver a traerlos.',
          action: '<a class="btn btn-primary" href="#/estudios">Ver mis estudios</a><button type="button" class="btn btn-secondary" data-action="flow-restart">Elegir otra institución</button>',
        }) + '</div>'
      );
    }
    const n = F.found.length;
    return (
      '<div class="res-head">' + P.mono(i.id, 'lg') + '<div><h1 class="flow-title">Encontramos ' + P.plural(n, 'estudio', 'estudios') + '</h1>' +
      '<p class="flow-sub">en ' + i.name + '. Elegí cuáles querés guardar en tu historial.</p></div></div>' +
      '<div class="res-card">' +
      '<label class="res-all"><input type="checkbox" id="res-all" data-change="res-all"' + (F.selected.size === n ? ' checked' : '') + '>' +
      '<span class="cbox" aria-hidden="true">' + ic('check', 16) + '<span class="cbox-dash"></span></span><span>Seleccionar todos <span class="muted num">(' + n + ')</span></span></label>' +
      '<ul class="res-list">' + F.found.map((s, k) => {
        const t = P.TYPES[s.type];
        return '<li style="--i:' + k + '"><label class="res-row"><input type="checkbox" data-change="res-one" value="' + s.id + '"' + (F.selected.has(s.id) ? ' checked' : '') + '>' +
          '<span class="cbox" aria-hidden="true">' + ic('check', 16) + '</span>' + P.typeTile(s.type) +
          '<span class="res-main"><span class="res-name">' + s.name + '</span><span class="res-sub">' + t.label + ' · PDF · ' + P.plural(s.pages, 'página', 'páginas') + '</span></span>' +
          '<span class="res-date num">' + P.fmt(s.date) + '</span></label></li>';
      }).join('') + '</ul></div>' +
      '<div class="res-bar"><div class="res-bar-in"><p class="res-count" aria-live="polite"><b class="num" id="sel-count">' + F.selected.size + '</b> <span id="sel-word">' + (F.selected.size === 1 ? 'estudio seleccionado' : 'estudios seleccionados') + '</span></p>' +
      '<button type="button" class="btn btn-accent btn-lg" id="res-save" data-action="res-save"' + (F.selected.size ? '' : ' disabled') + '>' + ic('import', 20) + 'Guardar en mi historial</button></div></div>'
    );
  }

  function syncSelection() {
    const n = availableStudies().length, k = F.selected.size;
    const all = document.getElementById('res-all');
    if (all) { all.checked = n > 0 && k === n; all.indeterminate = k > 0 && k < n; }
    document.getElementById('sel-count').textContent = k;
    document.getElementById('sel-word').textContent = k === 1 ? 'estudio seleccionado' : 'estudios seleccionados';
    document.getElementById('res-save').disabled = !k;
    if (F.live) document.getElementById('res-save').lastChild.textContent = k === 1 ? 'Traer seleccionado' : 'Traer seleccionados';
  }
  P.changes['res-all'] = (el) => {
    F.selected = el.checked ? new Set(availableStudies().map((f) => f.id)) : new Set();
    document.querySelectorAll('[data-change="res-one"]:not(:disabled)').forEach((c) => (c.checked = el.checked));
    syncSelection();
  };
  P.changes['res-one'] = (el) => {
    if (el.checked) F.selected.add(el.value); else F.selected.delete(el.value);
    syncSelection();
  };
  A['res-save'] = async (el) => {
    const done = P.busy(el, 'Guardando…');
    const token = F.run;
    await P.wait(1000);
    if (token !== F.run) return;
    done();
    const chosen = F.found.filter((f) => F.selected.has(f.id));
    chosen.forEach((s) => P.db.studies.push(Object.assign({}, s, { importedAt: P.TODAY_ISO, isNew: true })));
    if (!P.authorization(F.inst)) P.db.authorizations.push({ inst: F.inst, since: P.TODAY_ISO, mode: 'autorizada' });
    P.db.imports.unshift({ id: 'im-' + Date.now(), inst: F.inst, date: P.TODAY_ISO, count: chosen.length });
    P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Trajiste ' + P.plural(chosen.length, 'estudio', 'estudios'), sub: P.inst(F.inst).name });
    P.save();
    F.saved = chosen;
    P.ui.justImported = { inst: F.inst, count: chosen.length };
    go('success');
  };

  /* ---------- Paso 6: éxito ---------- */
  function viewSuccess() {
    const i = P.inst(F.inst);
    const n = F.saved.length;
    const existing = F.existing || [];
    const all = F.saved.concat(existing);
    return (
      '<div class="done-mark done-mark-lg" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>' +
      '<h1 class="flow-title center">' + (n ? '¡Listo! Tus estudios ya están en tu historial.' : 'Estos estudios ya estaban en tu portal.') + '</h1>' +
      '<p class="flow-sub center">' + (n ? '<b>' + P.plural(n, 'estudio agregado', 'estudios agregados') + '</b> desde ' + i.name + '. También los vas a encontrar en Documentos y en tu Historial.' : 'No creamos copias. Podés consultarlos en Estudios y Documentos.') +
      (existing.length ? '<br>' + P.plural(existing.length, 'Estudio que ya estaba', 'Estudios que ya estaban') + ' guardado' + (existing.length === 1 ? '' : 's') + ' en tu portal.' : '') + '</p>' +
      '<ul class="success-list">' + all.map((s, k) =>
        '<li style="--i:' + k + '">' + ic('check', 18) + '<span class="sl-name">' + s.name + (F.saved.includes(s) ? '' : ' · Ya estaba guardado') + '</span><span class="num muted">' + P.fmt(s.date) + '</span>' +
        (s.file ? '<button type="button" class="btn btn-secondary btn-sm sl-dl" data-action="doc-download" data-id="doc-' + s.id + '" aria-label="Descargar ' + (s.file.kind === 'DICOM_ZIP' ? 'estudio DICOM' : 'PDF') + ' del ' + P.fmt(s.date) + '">' + ic('download', 16) + '<span>' + (s.file.kind === 'DICOM_ZIP' ? 'ZIP DICOM' : 'PDF') + '</span></button>' : '') +
        '</li>').join('') + '</ul>' +
      '<div class="flow-actions center"><a class="btn btn-secondary btn-lg" href="#/inicio">Volver al inicio</a>' +
      '<a class="btn btn-accent btn-lg" href="#/estudios" data-action="see-imported">Ver estudios' + ic('arrow-right', 20) + '</a></div>' +
      '<p class="flow-foot center"><button type="button" class="link" data-action="flow-restart">Traer estudios de otra institución</button></p>'
    );
  }
  A['see-imported'] = () => {
    Object.assign(P.ui.est, { q: '', type: 'todos', year: 'todos', inst: 'todas', sort: 'desc' });
  };
  A['flow-restart'] = () => { P.startFlow(); P.mountFlow(); };

  A['flow-exit'] = async () => {
    if (F.live && !F.live.closed) {
      const ok = await P.confirm({
        title: '¿Cancelar la importación?',
        text: 'Vamos a cerrar la ventana de ' + P.inst(F.inst).name + '. No se guarda nada que no hayas traído.',
        confirmLabel: 'Cancelar importación', cancelLabel: 'Seguir acá',
      });
      if (!ok) return;
      liveClose(true);
      F.run++;
      location.hash = F.returnTo || '#/estudios';
      return;
    }
    const risky = ['connect', 'search', 'results'].includes(F.step) && F.found.length + (F.step !== 'results' ? 1 : 0) > 0;
    if (risky) {
      const ok = await P.confirm({
        title: '¿Salir sin guardar?',
        text: F.step === 'results' ? 'Los estudios que encontramos no se van a guardar en tu historial.' : 'Vamos a cancelar la búsqueda. No se guardó ningún dato.',
        confirmLabel: 'Salir', cancelLabel: 'Seguir acá',
      });
      if (!ok) return;
    }
    F.run++;
    location.hash = F.step === 'success' ? '#/estudios' : F.returnTo || '#/estudios';
  };

  /* =====================================================================
     Conexión real con el agente de IA (Pérez Cambet)
     El Portal no ve la contraseña: el paciente la escribe en la ventana del laboratorio.
     La UI solo refleja estados resumidos que llegan por SSE; nunca razonamiento del agente.
     ===================================================================== */

  const LIVE_SEARCH = ['Acceso detectado', 'Buscando tus estudios disponibles', 'Preparando resultados'];
  const LIVE_SEARCH_DONE = ['Acceso detectado', 'Estudios revisados', 'Resultados listos'];
  const HUMAN_TEXT = {
    captcha: 'Te pide confirmar que no sos un robot.',
    mfa: 'Te pide un código de verificación.',
    session_expired: 'Tu sesión se cerró. Volvé a iniciar sesión en esa ventana.',
    unknown_modal: 'Apareció un aviso que el asistente prefiere no responder por vos.',
    ambiguous: 'El asistente no está seguro de cómo seguir y prefiere no adivinar.',
    security_check: 'Te pide un control de seguridad.',
  };

  function liveClose(cancel) {
    const L = F.live;
    if (!L || L.closed) return;
    L.closed = true;
    if (L.stop) L.stop();
    if (cancel && L.jobId) P.agent.cancel(L.jobId);
  }

  function pill(text) {
    return '<p class="wait-pill" role="status"><span class="spin" aria-hidden="true"></span><span>' + text + '</span></p>';
  }

  function liveArt(i, variant) {
    return (
      '<div class="live-art' + (variant ? ' is-' + variant : '') + '" aria-hidden="true">' +
      '<span class="la-window"><span class="la-bar"><i></i><i></i><i></i></span>' +
      '<span class="la-body">' + P.mono(i.id, 'lg') + '<span class="la-lines"><span></span><span></span><span class="short"></span></span></span></span>' +
      '<span class="la-badge">' + ic(variant === 'human' ? 'user' : 'lock', 18) + '</span></div>'
    );
  }

  /* ---------- Explicación (antes de abrir el laboratorio) ---------- */
  function viewLiveExplain(i) {
    const s = [
      ['Abrimos la ventana oficial de ' + i.name, 'Se abre su propio sitio de resultados, en una ventana aparte.'],
      ['Iniciás sesión ahí, como siempre', 'Con tu usuario y contraseña de ' + i.name + '. Es lo único que hacés vos.'],
      ['El asistente busca tus estudios', 'Detectamos solos que entraste y revisamos qué estudios hay disponibles.'],
      ['Elegís cuáles traer', 'El asistente descarga los PDF originales y los guarda en tu portal.'],
    ];
    return (
      '<div class="flow-inst">' + P.mono(i.id, 'lg') + '<span class="fi-t"><b>' + i.name + '</b><span>' + P.instSub(i) + ' · Asistente IA</span></span>' +
      '<button type="button" class="link" data-action="flow-back">Cambiar</button></div>' +
      '<h1 class="flow-title">Vamos a abrir ' + i.name + '</h1>' +
      '<p class="flow-sub">Iniciá sesión directamente en su sitio. Cuando termines, seguimos automáticamente.</p>' +
      '<ol class="how">' + s.map((x, n) =>
        '<li style="--i:' + n + '"><span class="how-n" aria-hidden="true">' + (n + 1) + '</span><div><h2 class="how-t">' + x[0] + '</h2><p>' + x[1] + '</p></div></li>').join('') + '</ol>' +
      '<div class="assure">' + ic('shield', 24) + '<div><p class="assure-t">Tu contraseña nunca pasa por el Portal de Pacientes.</p>' +
      '<p>La escribís solo en el sitio de ' + i.name + '. El asistente solo lee: no modifica nada en tu cuenta y cierra la ventana al terminar.</p></div></div>' +
      '<div id="live-open-error"></div>' +
      '<div class="flow-actions"><button type="button" class="btn btn-ghost" data-action="flow-back">' + ic('arrow-left', 18) + 'Elegir otra institución</button>' +
      '<button type="button" class="btn btn-accent btn-lg" data-action="live-open">Abrir ' + i.name + ic('external', 18) + '</button></div>'
    );
  }

  const OPEN_ERRORS = {
    AGENT_OFFLINE: ['No pudimos iniciar el asistente', 'El servicio del asistente no responde. Si estás probando en tu computadora, iniciá portal-pacientes-agent (npm run dev) y volvé a intentar.'],
    LLM_NOT_CONFIGURED: ['El asistente todavía no está configurado', 'Falta la clave del modelo de IA en el servicio del asistente.'],
    TOO_MANY_JOBS: ['Ya hay una importación en curso', 'Esperá a que termine o cancelala antes de empezar otra.'],
  };

  A['live-open'] = async (el) => {
    const i = P.inst(F.inst);
    const box = document.getElementById('live-open-error');
    box.innerHTML = '';
    const done = P.busy(el, 'Abriendo ' + i.name + '…');
    const token = F.run;
    let res;
    try {
      res = await P.agent.start(i.live);
    } catch (e) {
      done();
      if (token !== F.run) return;
      const m = OPEN_ERRORS[e.code] || ['No pudimos abrir ' + i.name, 'Probá de nuevo en unos minutos.'];
      box.innerHTML = '<div class="error-card mt-4" role="alert" tabindex="-1">' + ic('alert', 22) + '<div><p class="error-t">' + m[0] + '</p><p>' + m[1] + '</p></div></div>';
      box.firstChild.focus();
      return;
    }
    if (token !== F.run) { P.agent.cancel(res.jobId); return; }
    liveBegin(res.jobId);
  };

  function liveBegin(jobId) {
    const L = (F.live = {
      jobId, state: 'CREATED', studies: [], selectedIds: [], phase: {}, failures: [], importFailures: [], saved: [], existing: [],
      human: null, error: null, at: 1, completed: false, closed: false, found: null, stop: null,
    });
    L.stop = P.agent.events(jobId, (type, data) => onLiveEvent(L, type, data), () => {
      if (L.closed || L !== F.live) return;
      liveFail(L, 'AGENT_LOST');
    });
    go('wait');
  }

  function liveFail(L, code) {
    L.error = code;
    L.at = Math.min(stepIndex(), 3);
    liveClose(false);
    go('lerror');
  }

  function showParserMismatch(L) {
    L.error = 'PROVIDER_PARSER_MISMATCH';
    L.at = Math.min(stepIndex(), 3);
    if (F.step !== 'lparser') go('lparser');
  }

  const SEARCH_EVENTS = ['authenticated', 'agent_started', 'agent_observing', 'searching_studies', 'studies_found'];
  const DOWNLOAD_EVENTS = ['opening_study', 'viewer_ready', 'finding_document', 'downloading', 'importing'];
  const PHASE_OF = { opening_study: 'opening', viewer_ready: 'finding', finding_document: 'finding', downloading: 'downloading', importing: 'importing' };

  function onLiveEvent(L, type, d) {
    if (L !== F.live || L.closed) return;
    if (d.state) L.state = d.state;

    if (type === 'snapshot') {
      if (d.studies && d.studies.length) L.studies = d.studies;
      if (d.state === 'WAITING_SELECTION' && F.step !== 'lresults') return showResults(L);
      if (d.state === 'HUMAN_ACTION_REQUIRED') return onLiveEvent(L, 'human_action_required', { reason: d.human });
      if (d.state === 'PROVIDER_PARSER_MISMATCH' || d.errorCode === 'PROVIDER_PARSER_MISMATCH') return showParserMismatch(L);
      if (d.errorCode && d.state !== 'COMPLETED') return liveFail(L, d.errorCode);
      if (F.step === 'wait') refreshWait();
      return;
    }
    if (type === 'provider_parser_mismatch') return showParserMismatch(L);
    if (type === 'error') {
      if (d.code === 'PROVIDER_PARSER_MISMATCH') return showParserMismatch(L);
      return liveFail(L, d.code || d.state || 'ERROR');
    }
    if (type === 'human_action_required') {
      L.human = d.reason || 'ambiguous';
      L.at = Math.min(stepIndex(), 3);
      return go('human');
    }
    if (type === 'provider_opened' || type === 'waiting_user_login') {
      if (F.step !== 'wait') go('wait'); else refreshWait();
      return;
    }
    if (SEARCH_EVENTS.includes(type)) {
      if (L.error === 'PROVIDER_PARSER_MISMATCH') L.error = null;
      if (type === 'studies_found') L.found = d.count;
      if (F.step !== 'lsearch') go('lsearch'); else refreshSearch();
      return;
    }
    if (type === 'waiting_selection') {
      L.studies = d.studies || [];
      L.found = L.studies.length;
      if (F.step === 'lsearch') { refreshSearch(true); setTimeout(() => { if (F.live === L && !L.closed) showResults(L); }, P.reducedMotion() ? 0 : 700); }
      else showResults(L);
      return;
    }
    if (DOWNLOAD_EVENTS.includes(type)) {
      if (d.studyId && L.phase[d.studyId] !== 'stored') L.phase[d.studyId] = PHASE_OF[type];
      if (F.step !== 'download') go('download'); else refreshDownload();
      return;
    }
    if (type === 'file_ready') { storeLiveFile(L, d); return; }
    if (type === 'study_failed') {
      L.phase[d.studyId] = 'failed';
      L.failures.push(d.studyId);
      refreshDownload();
      return maybeFinish(L);
    }
    if (type === 'completed') {
      L.completed = true;
      // El servidor cierra el stream al terminar: se cierra acá para que EventSource no reintente.
      if (L.stop) { L.stop(); L.stop = null; }
      maybeFinish(L);
    }
  }

  /* ---------- Esperando el inicio de sesión ---------- */
  function viewWait() {
    const i = P.inst(F.inst);
    const L = F.live;
    const opened = L && L.state !== 'CREATED' && L.state !== 'OPENING_PROVIDER';
    return (
      liveArt(i) +
      '<h1 class="flow-title center">' + (opened ? 'Esperando tu inicio de sesión' : 'Abrimos ' + i.name) + '</h1>' +
      '<p class="flow-sub center">Completá el acceso en la ventana de ' + i.name + '.</p>' +
      '<p class="flow-sub center wait-note">No necesitás volver acá ni avisarnos: cuando el acceso esté listo, seguimos automáticamente.</p>' +
      '<div id="wait-pill">' + pill(opened ? 'Esperando inicio de sesión…' : 'Abriendo ' + i.name + '…') + '</div>' +
      '<div class="assure assure-sm">' + ic('shield', 22) + '<p>Tu contraseña va directo a ' + i.name + '. El Portal de Pacientes no la ve ni la guarda.</p></div>' +
      '<p class="flow-foot center">¿No ves la ventana? Puede haber quedado detrás de esta. <button type="button" class="link" data-action="flow-exit">Cancelar</button></p>'
    );
  }
  function refreshWait() {
    if (F.step === 'wait') go('wait');
  }

  /* ---------- Intervención humana ---------- */
  function viewHuman() {
    const i = P.inst(F.inst);
    const L = F.live;
    return (
      liveArt(i, 'human') +
      '<h1 class="flow-title center">' + i.name + ' necesita que completes un paso</h1>' +
      '<p class="flow-sub center">Volvé a la ventana del laboratorio y completalo. Nosotros seguimos después.</p>' +
      '<p class="human-why center">' + ic('info', 18) + '<span>' + (HUMAN_TEXT[L && L.human] || HUMAN_TEXT.ambiguous) + '</span></p>' +
      '<div>' + pill('Esperando que completes el paso…') + '</div>' +
      '<p class="flow-foot center"><button type="button" class="link" data-action="flow-exit">Cancelar la importación</button></p>'
    );
  }

  /* ---------- Buscando estudios ---------- */
  function searchStates(L, ready) {
    if (ready) return ['done', 'done', 'done'];
    if (L.found !== null) return ['done', 'done', 'active'];
    return ['done', 'active', 'pending'];
  }
  function plistItems(states, labels, doneLabels) {
    return states.map((st, n) =>
      '<li class="pl" data-state="' + st + '"><span class="pl-icon" aria-hidden="true"><span class="pl-spin"></span>' + ic('check', 14) + ic('x', 14) + '</span>' +
      '<span class="pl-text">' + (st === 'done' ? doneLabels[n] : labels[n] + (st === 'active' ? '…' : '')) + '</span></li>').join('');
  }
  function viewLiveSearch() {
    const i = P.inst(F.inst);
    const L = F.live;
    return (
      '<div class="scan" aria-hidden="true">' +
      '<div class="scan-src">' + P.mono(i.id, 'lg') + '</div>' +
      '<div class="scan-track"><span></span><span></span><span></span></div>' +
      '<div class="scan-grid" id="scan-grid">' + Array.from({ length: 6 }, () => '<span class="slot"></span>').join('') + '</div></div>' +
      '<h1 class="flow-title center" id="search-title">Buscando tus estudios…</h1>' +
      '<p class="flow-sub center">El asistente está revisando tu cuenta de ' + i.name + '. Podés mirar la ventana del laboratorio: navega solo.</p>' +
      '<ol class="plist" id="plist" aria-live="polite">' + plistItems(searchStates(L), LIVE_SEARCH, LIVE_SEARCH_DONE) + '</ol>'
    );
  }

  function viewParserMismatch() {
    const i = P.inst(F.inst);
    return (
      '<div class="live-error" role="alert">' +
      '<div class="empty-art" aria-hidden="true">' + ic('alert', 28) + '</div>' +
      '<h1 class="flow-title center">No pudimos interpretar el listado de ' + i.name + '</h1>' +
      '<p class="flow-sub center">La sesión del laboratorio sigue abierta. Podés volver a intentar sin iniciar sesión de nuevo.</p>' +
      '<div class="flow-actions center"><button type="button" class="btn btn-secondary btn-lg" data-action="flow-exit">Cancelar importación</button>' +
      '<button type="button" class="btn btn-accent btn-lg" data-action="live-retry">' + ic('retry', 18) + 'Volver a intentar</button></div>' +
      '<p class="flow-foot center muted">No se guardó ningún dato.</p></div>'
    );
  }
  function refreshSearch(ready) {
    const L = F.live;
    const list = document.getElementById('plist');
    if (!L || !list) return;
    list.innerHTML = plistItems(searchStates(L, ready), LIVE_SEARCH, LIVE_SEARCH_DONE);
    if (L.found !== null) {
      document.getElementById('search-title').textContent = L.found ? 'Encontramos tus estudios' : 'Revisión terminada';
      document.querySelectorAll('#scan-grid .slot').forEach((slot, n) => {
        if (n < L.found && !slot.classList.contains('is-filled')) {
          slot.innerHTML = P.paper({ inst: F.inst });
          slot.classList.add('is-filled');
        }
      });
    }
  }

  /* ---------- Resultados encontrados ---------- */
  function showResults(L) {
    refreshAlreadyImported(L);
    F.found = L.studies;
    F.selected = new Set();
    go('lresults');
    if (!L.studies.length) liveClose(true);
  }
  function storedAgentStudies() {
    try {
      const raw = localStorage.getItem(P.STORE_KEY);
      const db = raw ? JSON.parse(raw) : null;
      if (db && Array.isArray(db.studies)) return db.studies;
    } catch (e) { /* usa el estado cargado en memoria */ }
    return P.db.studies || [];
  }
  function isAgentStudyFromProvider(s, providerId) {
    if (!s || !providerId) return false;
    if (s.provider === providerId) return true;
    const institution = P.INSTITUTIONS.find((item) => item.live === providerId);
    return !!institution && s.origin === 'agente' && s.inst === institution.id;
  }
  function sameStudyMetadata(a, b, providerId) {
    const dateA = String(a.date || '').trim();
    const dateB = String(b.date || '').trim();
    if (providerId === 'centrodm') {
      const titleA = String(a.title || a.name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const titleB = String(b.title || b.name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const modeA = String(a.modality || '').trim().toUpperCase();
      const modeB = String(b.modality || '').trim().toUpperCase();
      return !!(dateA && titleA && dateA === dateB && titleA === titleB && modeA === modeB);
    }
    const protocolA = String(a.protocol || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const protocolB = String(b.protocol || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return !!(dateA && protocolA && dateA === dateB && protocolA === protocolB);
  }
  function importedMatch(external, records) {
    const providerId = external.provider || P.inst(F.inst).live;
    return records.find((saved) => isAgentStudyFromProvider(saved, providerId) &&
      ((external.sourceKey && saved.sourceKey === external.sourceKey) || sameStudyMetadata(external, saved, providerId)));
  }
  function refreshAlreadyImported(L) {
    const records = storedAgentStudies();
    L.studies = L.studies.map((study) => {
      const existing = importedMatch(study, records);
      return Object.assign({}, study, existing ? { alreadyImported: true } : { alreadyImported: false });
    });
  }
  function availableStudies() {
    return F.found.filter((study) => !study.alreadyImported);
  }
  function selectedImportedKeys(studies) {
    const records = storedAgentStudies();
    return Array.from(new Set(studies
      .filter((study) => importedMatch(study, records))
      .map((study) => study.sourceKey)
      .filter((key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))));
  }
  function studyLabel(s) {
    return s.provider === 'centrodm'
      ? P.esc(s.title || 'Estudio de imágenes')
      : 'Resultados de laboratorio' + (s.date ? ' · ' + P.fmt(s.date) : ' · Sin fecha');
  }
  function viewLiveResults() {
    const i = P.inst(F.inst);
    const list = F.found;
    if (!list.length) {
      return '<div class="res-empty">' + P.empty({
        icon: 'file-check',
        title: 'No encontramos estudios en tu cuenta de ' + i.name,
        text: 'El asistente revisó tu cuenta y no hay estudios disponibles para traer. Ya cerramos la ventana del laboratorio.',
        action: '<a class="btn btn-primary" href="#/estudios">Ver mis estudios</a><button type="button" class="btn btn-secondary" data-action="flow-restart">Elegir otra institución</button>',
      }) + '</div>';
    }
    const n = list.length;
    const available = list.filter((s) => !s.alreadyImported);
    return (
      '<div class="res-head">' + P.mono(i.id, 'lg') + '<div><h1 class="flow-title">Encontramos ' + P.plural(n, 'estudio', 'estudios') + '</h1>' +
      '<p class="flow-sub">en ' + i.name + '. Elegí cuáles querés traer a tu portal.</p></div></div>' +
      '<div class="res-card">' +
      '<label class="res-all"><input type="checkbox" id="res-all" data-change="res-all"' + (available.length ? '' : ' disabled') + '>' +
      '<span class="cbox" aria-hidden="true">' + ic('check', 16) + '<span class="cbox-dash"></span></span><span>Seleccionar estudios nuevos <span class="muted num">(' + available.length + ')</span></span></label>' +
      '<ul class="res-list">' + list.map((s, k) =>
        '<li style="--i:' + k + '"><label class="res-row' + (s.alreadyImported ? ' is-imported' : '') + '"><input type="checkbox" data-change="res-one" value="' + P.esc(s.id) + '"' + (s.alreadyImported ? ' disabled aria-label="Este estudio ya está en tu portal"' : '') + '>' +
        '<span class="cbox" aria-hidden="true">' + ic('check', 16) + '</span>' + P.typeTile(s.provider === 'centrodm' ? 'imagenes' : 'laboratorio') +
        '<span class="res-main"><span class="res-name">' + studyLabel(s) + '</span>' +
        '<span class="res-sub">' + (s.provider === 'centrodm'
          ? 'Imágenes' + (s.modality ? ' · Modalidad ' + P.esc(s.modality) : '') + ' · Archivo DICOM ZIP'
          : (s.protocol ? 'Protocolo <span class="num">' + P.esc(s.protocol) + '</span>' : 'Sin número de protocolo')) +
        (s.status ? ' · ' + P.esc(s.status) : '') + (s.alreadyImported ? ' · Ya está en tu portal' : '') + '</span></span>' +
        '<span class="res-date num">' + (s.date ? P.fmt(s.date) : s.deliveryDate ? 'Entregado ' + P.fmt(s.deliveryDate) : '') + '</span></label></li>').join('') + '</ul></div>' +
      (available.length ? '' : '<p class="res-note">' + ic('check', 18) + '<span>Todos estos estudios ya están en tu portal. No vamos a descargar copias.</span></p><p class="flow-actions center"><a class="btn btn-accent btn-lg" href="#/estudios">Ver mis estudios ' + ic('arrow-right', 20) + '</a></p>') +
      '<p class="res-note">' + ic('info', 18) + '<span>El asistente descarga solo los que elijas. No lee ni interpreta su contenido.</span></p>' +
      (available.length ? '<div class="res-bar"><div class="res-bar-in"><p class="res-count" aria-live="polite"><b class="num" id="sel-count">0</b> <span id="sel-word">estudios seleccionados</span></p>' +
      '<button type="button" class="btn btn-accent btn-lg" id="res-save" data-action="live-import" disabled>' + ic('import', 20) + 'Traer seleccionados</button></div></div>' : '')
    );
  }

  A['live-import'] = async (el) => {
    const L = F.live;
    if (!L || L.closed || !F.selected.size) return;
    const selected = F.found.filter((s) => F.selected.has(s.id));
    const ids = selected.map((s) => s.id);
    const sourceKeys = selectedImportedKeys(L.studies);
    const done = P.busy(el, 'Empezando…');
    try {
      await P.agent.importSelected(L.jobId, ids, sourceKeys);
    } catch (e) {
      done();
      if (e.code === 'AGENT_OFFLINE') return liveFail(L, 'AGENT_LOST');
      if (e.code === 'ALREADY_IMPORTED') {
        showResults(L);
        P.toast('Uno o más estudios ya estaban en tu portal. Actualizamos la lista para evitar duplicados.', { icon: 'check' });
        return;
      }
      P.toast('No pudimos empezar la descarga. Probá de nuevo.', { icon: 'alert', tone: 'danger' });
      return;
    }
    L.selectedIds = ids;
    ids.forEach((id) => { if (!L.phase[id]) L.phase[id] = 'queued'; });
    go('download');
  };

  /* ---------- Descargando ---------- */
  const DL_STEPS = [
    ['opening', (s) => 'Abriendo tu ' + (s.date ? 'estudio del ' + P.fmt(s.date) : 'estudio'), (s) => 'Abrí tu ' + (s.date ? 'estudio del ' + P.fmt(s.date) : 'estudio')],
    ['finding', () => 'Buscando el documento original', () => 'Encontré el documento original'],
    ['downloading', (s) => s.provider === 'centrodm' ? 'Descargando el estudio DICOM ZIP' : 'Descargando el PDF', (s) => s.provider === 'centrodm' ? 'Estudio DICOM ZIP descargado' : 'PDF descargado'],
    ['importing', () => 'Agregándolo a tu portal', () => 'Agregado a tu portal'],
  ];
  const ORDER = { queued: -1, opening: 0, finding: 1, downloading: 2, importing: 3, stored: 4 };

  function dlBlock(s, phase) {
    const failed = phase === 'failed';
    const existing = phase === 'existing';
    const importFailed = failed && F.live && F.live.importFailures.includes(s.id);
    const cur = failed ? -2 : ORDER[phase] === undefined ? -1 : ORDER[phase];
    const st = (n) => (cur > n ? 'done' : cur === n ? 'active' : 'pending');
    const head = phase === 'stored' ? P.badge('success', 'Listo', 'check') : existing ? P.badge('success', 'Ya estaba', 'check') : failed ? P.badge('danger', importFailed ? 'No se guardó' : 'No se pudo traer', 'alert') : cur >= 0 ? P.badge('info', 'En curso', 'clock') : P.badge('neutral', 'En espera', 'clock');
    return (
      '<li class="dl-study' + (cur >= 0 && cur < 4 ? ' is-current' : '') + (failed ? ' is-failed' : '') + '">' +
      '<div class="dl-head">' + P.typeTile(s.provider === 'centrodm' ? 'imagenes' : 'laboratorio') + '<span class="dl-name">' + studyLabel(s) +
      (s.provider === 'centrodm' ? (s.modality ? '<small>Modalidad ' + P.esc(s.modality) + '</small>' : '') : s.protocol ? '<small>Protocolo <span class="num">' + P.esc(s.protocol) + '</span></small>' : '') + '</span>' + head + '</div>' +
      (existing
        ? '<p class="dl-fail">Este estudio ya está en tu portal. No creamos otra copia.</p>'
        : failed
        ? '<p class="dl-fail">' + (importFailed ? 'No pudimos guardar el archivo original junto con su estudio en el Portal.' : 'El asistente no encontró el documento de este estudio. Podés intentarlo de nuevo más tarde.') + '</p>'
        : '<ol class="plist plist-sm">' + DL_STEPS.map((x, n) => {
          const state = st(n);
          return '<li class="pl" data-state="' + state + '"><span class="pl-icon" aria-hidden="true"><span class="pl-spin"></span>' + ic('check', 14) + ic('x', 14) + '</span>' +
            '<span class="pl-text">' + (state === 'done' ? x[2](s) : x[1](s)) + '</span></li>';
        }).join('') + '</ol>') +
      '</li>'
    );
  }
  function viewDownload() {
    const i = P.inst(F.inst);
    const L = F.live;
    const chosen = L.selectedIds.map((id) => L.studies.find((s) => s.id === id)).filter(Boolean);
    const doneN = chosen.filter((s) => L.phase[s.id] === 'stored' || L.phase[s.id] === 'existing' || L.phase[s.id] === 'failed').length;
    return (
      '<h1 class="flow-title center">El asistente está trabajando por vos</h1>' +
      '<p class="flow-sub center">Está abriendo tus estudios en ' + i.name + ' y trayendo los archivos originales. No cierres la ventana de la institución.</p>' +
      '<p class="dl-count center" id="dl-count" aria-live="polite"><b class="num">' + doneN + '</b> de <span class="num">' + chosen.length + '</span> ' + (chosen.length === 1 ? 'estudio' : 'estudios') + '</p>' +
      '<ul class="dl-list" id="dl-list">' + chosen.map((s) => dlBlock(s, L.phase[s.id])).join('') + '</ul>'
    );
  }
  function refreshDownload() {
    if (F.step !== 'download') return;
    const v = document.querySelector('.fv-download');
    if (v) v.innerHTML = viewDownload();
  }

  function persistedStudyArtifact(id, key, sha256) {
    try {
      const raw = localStorage.getItem(P.STORE_KEY);
      const savedDb = raw && JSON.parse(raw);
      const savedStudy = savedDb && Array.isArray(savedDb.studies) && savedDb.studies.find((item) => item.id === id);
      return !!savedStudy && !!savedStudy.file && savedStudy.file.key === key && savedStudy.file.sha256 === sha256;
    } catch (e) { return false; }
  }

  function deletePortalFileIfUnused(key) {
    if (P.db.studies.some((study) => study.file && study.file.key === key)) return Promise.resolve();
    return P.files.del(key).catch(() => {});
  }

  async function storeLiveFile(L, d) {
    L.phase[d.studyId] = 'importing';
    refreshDownload();
    const ext = L.studies.find((s) => s.id === d.studyId);
    let fileKey = null;
    let fileStored = false;
    let targetStudy = null;
    let previous = null;
    let metadataChanged = false;
    let committed = false;
    const rollback = async () => {
      if (metadataChanged && targetStudy) {
        if (previous) Object.assign(targetStudy, previous);
        else P.db.studies = P.db.studies.filter((item) => item !== targetStudy);
        P.save();
        metadataChanged = false;
      }
      if (fileStored && fileKey) {
        await deletePortalFileIfUnused(fileKey);
        fileStored = false;
      }
    };
    try {
      const { blob, sha256, kind, mimeType } = await P.agent.file(L.jobId, d.fileId);
      if (!ext || !d.studyId) throw new Error('STUDY_METADATA_MISSING');
      const providerId = ext.provider || P.inst(F.inst).live;
      const duplicate = P.db.studies.find((study) => isAgentStudyFromProvider(study, providerId) && sha256 && (study.file && study.file.sha256 || study.pdfSha256) === sha256);
      const sameStudy = !!(duplicate && importedMatch(ext, [duplicate], providerId));
      const id = sameStudy ? duplicate.id : (providerId === 'centrodm' ? 'cdm-' : 'pc-') + String(d.studyId).replace(/[^\w-]/g, '');
      const prev = P.study(id);
      targetStudy = prev || null;
      previous = prev ? Object.assign({}, prev) : null;
      // Reusa una clave ya asociada al mismo hash. Si es otro estudio con bytes idénticos,
      // queda un registro propio que comparte el Blob sin guardar una segunda copia.
      fileKey = duplicate && duplicate.file && duplicate.file.key && duplicate.file.kind === kind
        ? duplicate.file.key
        : (kind === 'DICOM_ZIP' ? 'dicom-' : 'pdf-') + d.fileId;
      fileStored = await P.files.put(fileKey, blob);
      if (!fileStored) throw new Error('ARTIFACT_STORAGE_FAILED');
      const isImage = providerId === 'centrodm' || kind === 'DICOM_ZIP';
      const study = {
        id, name: isImage ? (ext.title || 'Estudio de imágenes') : 'Resultados de laboratorio', type: isImage ? 'imagenes' : 'laboratorio',
        date: ext.date || '', reportDate: ext.deliveryDate || null,
        inst: F.inst, provider: providerId, providerDisplayName: P.inst(F.inst).name,
        sourceKey: ext.sourceKey || (sameStudy && duplicate.sourceKey) || undefined,
        modality: ext.modality || '', artifactKind: kind,
        requestedBy: 'Sin dato en el documento', protocol: ext.protocol || '', providerStatus: ext.status || '',
        status: 'disponible', pages: 0, images: 0, results: null, size: P.fmtBytes(blob.size),
        importedAt: d.importedAt || new Date().toISOString(), importedBy: d.importedBy || 'agent',
        isNew: true, origin: 'agente', file: { key: fileKey, bytes: blob.size, sha256, kind, mimeType },
      };
      if (prev) Object.assign(prev, study);
      else { targetStudy = study; P.db.studies.push(study); }
      metadataChanged = true;
      if (!P.save() || !persistedStudyArtifact(id, fileKey, sha256)) throw new Error('STUDY_METADATA_STORAGE_FAILED');
      await P.agent.acknowledgePortalImport(L.jobId, d.fileId, d.studyId, true);
      committed = true;
      if (previous && previous.file && previous.file.key !== fileKey) await deletePortalFileIfUnused(previous.file.key);
      fileStored = false;
      metadataChanged = false;
      if (sameStudy) {
        L.phase[d.studyId] = 'existing';
        L.existing.push(targetStudy);
      } else {
        L.phase[d.studyId] = 'stored';
        L.saved.push(targetStudy);
      }
    } catch (e) {
      if (!committed) await rollback();
      L.phase[d.studyId] = 'failed';
      L.failures.push(d.studyId);
      L.importFailures.push(d.studyId);
      await P.agent.acknowledgePortalImport(L.jobId, d.fileId, d.studyId, false).catch(() => {});
    }
    refreshDownload();
    maybeFinish(L);
  }

  function maybeFinish(L) {
    if (!L.completed || L.closed) return;
    const pending = L.selectedIds.some((id) => L.phase[id] !== 'stored' && L.phase[id] !== 'existing' && L.phase[id] !== 'failed');
    if (pending) return;
    liveClose(true); // cierra el SSE y le pide al agente borrar los archivos temporales
    if (L.importFailures.length) {
      L.error = 'ARTIFACT_IMPORT_FAILED';
      L.at = 3;
      return go('lerror');
    }
    if (!L.saved.length && !L.existing.length) { L.error = 'NO_DOCUMENTS'; L.at = 3; return go('lerror'); }
    const inst = F.inst;
    if (L.saved.length) {
      P.db.imports.unshift({ id: 'im-' + Date.now(), inst, date: P.TODAY_ISO, count: L.saved.length });
      P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Trajiste ' + P.plural(L.saved.length, 'estudio', 'estudios') + ' con el asistente', sub: P.inst(inst).name });
      P.save();
    }
    F.saved = L.saved;
    F.existing = L.existing;
    P.ui.justImported = L.saved.length ? { inst, count: L.saved.length } : null;
    setTimeout(() => { if (F.live === L) go('success'); }, P.reducedMotion() ? 0 : 500);
  }

  /* ---------- Errores ---------- */
  const LIVE_ERRORS = {
    LOGIN_TIMEOUT: ['Se venció el tiempo para iniciar sesión', 'Por seguridad cerramos la ventana del laboratorio. No se guardó ningún dato.', 'clock'],
    AUTH_TIMEOUT: ['Se venció el tiempo para iniciar sesión', 'Por seguridad cerramos la ventana del laboratorio. No se guardó ningún dato.', 'clock'],
    HUMAN_ACTION_TIMEOUT: ['El paso pendiente no se completó a tiempo', 'Por seguridad cerramos la ventana del laboratorio. No se guardó ningún dato.', 'clock'],
    WINDOW_CLOSED: ['Se cerró la ventana del laboratorio', 'No se guardó ningún dato. Podés volver a intentarlo cuando quieras.', 'x'],
    PROVIDER_UNAVAILABLE: ['El laboratorio no responde en este momento', 'Suele resolverse en unos minutos. No se guardó ningún dato.', 'alert'],
    PROVIDER_CHANGED: ['El sitio del laboratorio cambió', 'El asistente no reconoce cómo está organizado ahora y prefirió no adivinar. No se guardó ningún dato de esta búsqueda.', 'alert'],
    UNEXPECTED_DOMAIN: ['El asistente se detuvo por seguridad', 'El sitio intentó llevarlo a una dirección que no es la del laboratorio. No se guardó ningún dato de esta búsqueda.', 'shield'],
    NO_DOCUMENTS: ['No pudimos traer los documentos', 'El asistente no encontró el PDF de los estudios elegidos. Podés intentarlo de nuevo más tarde.', 'file'],
    NO_ARTIFACTS_IMPORTED: ['No pudimos importar los estudios', 'No se logró descargar ningún archivo de los estudios seleccionados. Podés volver a intentarlo más tarde.', 'file'],
    ARTIFACT_IMPORT_FAILED: ['No pudimos guardar los estudios en tu Portal', 'No confirmamos la importación de los archivos que no se pudieron guardar.', 'file'],
    STUDY_REFERENCE_MISSING: ['No pudimos abrir el estudio seleccionado', 'Se perdió la referencia temporal del estudio en el laboratorio. Volvé a cargar el listado y probá otra vez.', 'alert'],
    LLM_NOT_CONFIGURED: ['El asistente no está disponible', 'Falta configurar el modelo de IA del asistente.', 'alert'],
    BROWSER_NOT_INSTALLED: ['El asistente no está disponible', 'Falta instalar el navegador del asistente (npx playwright install chromium).', 'alert'],
    MODEL_ERROR: ['El asistente no está disponible', 'No pudimos comunicarnos con el modelo de IA. Probá de nuevo en unos minutos.', 'alert'],
    AGENT_LOST: ['Perdimos la conexión con el asistente', 'Si la ventana del laboratorio sigue abierta, podés cerrarla. No se guardó ningún dato de esta búsqueda.', 'alert'],
    JOB_TTL: ['La importación se venció', 'Por seguridad la cerramos después de un tiempo. Podés empezar de nuevo.', 'clock'],
    EXPIRED: ['La importación se venció', 'Por seguridad la cerramos después de un tiempo. Podés empezar de nuevo.', 'clock'],
  };
  function viewLiveError() {
    const code = (F.live && F.live.error) || 'ERROR';
    const m = LIVE_ERRORS[code] || ['El asistente no pudo terminar', 'Es posible que el sitio del laboratorio haya cambiado. No se guardó ningún dato de esta búsqueda.', 'alert'];
    if (code === 'ARTIFACT_IMPORT_FAILED' && F.live) {
      const saved = F.live.saved.length;
      const failed = F.live.importFailures.length;
      m[1] = saved
        ? 'Se guardaron ' + P.plural(saved, 'estudio', 'estudios') + ' correctamente, pero ' + P.plural(failed, 'archivo no pudo', 'archivos no pudieron') + ' guardarse junto con su estudio. Revisá Estudios antes de volver a intentarlo para evitar copias.'
        : 'El archivo no quedó guardado junto con el estudio y no confirmamos la importación. Podés volver a intentarlo más tarde.';
    }
    return (
      '<div class="live-error">' +
      '<div class="empty-art" aria-hidden="true">' + ic(m[2], 28) + '</div>' +
      '<h1 class="flow-title center">' + m[0] + '</h1>' +
      '<p class="flow-sub center">' + m[1] + '</p>' +
      '<div class="flow-actions center"><button type="button" class="btn btn-secondary btn-lg" data-action="flow-restart">Elegir otra institución</button>' +
      '<button type="button" class="btn btn-accent btn-lg" data-action="live-retry">' + ic('retry', 18) + 'Volver a intentar</button></div>' +
      '<p class="flow-foot center muted">Código: <span class="num">' + P.esc(code) + '</span></p></div>'
    );
  }
  A['live-retry'] = async (el) => {
    const L = F.live;
    if (L && L.error === 'PROVIDER_PARSER_MISMATCH' && !L.closed) {
      const done = P.busy(el, 'Volviendo a intentar...');
      try {
        const result = await P.agent.retryDiscovery(L.jobId);
        if (L !== F.live || L.closed) return;
        if (result.state === 'PROVIDER_PARSER_MISMATCH') {
          L.error = 'PROVIDER_PARSER_MISMATCH';
          go('lparser');
        } else {
          L.error = null;
          L.state = result.state;
          if (F.step !== 'lresults') go('lsearch');
        }
      } catch (e) {
        done();
        P.toast(e.code === 'AGENT_OFFLINE' ? 'Se perdiÃ³ la conexiÃ³n con el asistente.' : 'No pudimos volver a intentar. La sesiÃ³n sigue abierta; probÃ¡ otra vez.', { icon: 'alert', tone: 'danger' });
      }
      return;
    }
    liveClose(true);
    F.live = null;
    go('explain');
  };
})();
