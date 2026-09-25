/* Portal de Pacientes — flujo «Traer mis estudios».
   Todo es simulado: no hay autenticación real ni conexión con instituciones. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const A = P.actions;
  const F = (P.flow = { step: 'select', inst: null, found: [], selected: new Set(), q: '', more: false, run: 0, retried: {}, saved: [], returnTo: '#/estudios' });

  const STEPS = ['Institución', 'Autorización', 'Búsqueda', 'Selección'];
  const STEP_INDEX = { select: 0, explain: 1, connect: 1, search: 2, results: 3, success: 4 };

  P.startFlow = function (query) {
    F.run++;
    Object.assign(F, { step: 'select', inst: null, found: [], selected: new Set(), q: '', more: false, saved: [] });
    const pre = query && query.get('inst');
    if (pre && P.inst(pre).compatible) { F.inst = pre; F.step = 'explain'; }
  };

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
    const cur = STEP_INDEX[F.step];
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
    const html = { select: viewSelect, explain: viewExplain, connect: viewConnect, search: viewSearch, results: viewResults, success: viewSuccess }[F.step]();
    v.innerHTML = '<div class="fv fv-' + F.step + '">' + html + '</div>';
    document.title = STEPS[Math.min(STEP_INDEX[F.step], 3)] + ' · Traer mis estudios · Portal de Pacientes';
    window.scrollTo(0, 0);
    const h = v.querySelector('h1');
    if (h && F.step !== 'select') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (F.step === 'select') { const q = document.getElementById('inst-q'); if (q && !matchMedia('(max-width: 760px)').matches) q.focus({ preventScroll: true }); }
    if (F.step === 'search') runSearch();
  };

  /* ---------- Paso 1: institución ---------- */
  function instRows() {
    const q = F.q.trim().toLowerCase();
    const list = P.INSTITUTIONS.filter((i) => (q ? (i.name + ' ' + i.kind + ' ' + i.city).toLowerCase().includes(q) : F.more || i.featured));
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
      const badge = !i.compatible ? P.badge('neutral', 'Próximamente', 'clock') : auth ? P.badge('info', 'Conectada', 'link') : P.badge('teal', 'Compatible', 'check');
      return '<li><button type="button" class="inst-row" data-action="inst-pick" data-id="' + i.id + '"' + (i.compatible ? '' : ' aria-disabled="true"') + '>' +
        P.mono(i.id, 'lg') +
        '<span class="inst-row-main"><span class="inst-row-name">' + i.name + '</span><span class="inst-row-sub">' + i.kind + ' · ' + i.city + '</span></span>' +
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
      '<p class="legend"><span>' + ic('check', 16) + 'Compatible: podemos traer tus estudios automáticamente.</span></p></div>' +
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
    const steps = [
      ['external', 'Abrimos el acceso oficial de ' + i.name, 'Se abre su propio sitio de ingreso, no el nuestro.'],
      ['user', 'Iniciás sesión directamente allí', 'Con el usuario y la contraseña que ya usás en ' + i.name + '.'],
      ['search', 'Con tu autorización, buscamos tus estudios', 'Solo leemos los estudios disponibles a tu nombre.'],
      ['check', 'Elegís cuáles guardar', 'Nada se guarda en tu historial sin que lo confirmes.'],
    ];
    return (
      '<div class="flow-inst">' + P.mono(i.id, 'lg') + '<span class="fi-t"><b>' + i.name + '</b><span>' + i.kind + ' · ' + i.city + '</span></span>' +
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
    const n = F.found.length, k = F.selected.size;
    const all = document.getElementById('res-all');
    all.checked = k === n;
    all.indeterminate = k > 0 && k < n;
    document.getElementById('sel-count').textContent = k;
    document.getElementById('sel-word').textContent = k === 1 ? 'estudio seleccionado' : 'estudios seleccionados';
    document.getElementById('res-save').disabled = !k;
  }
  P.changes['res-all'] = (el) => {
    F.selected = el.checked ? new Set(F.found.map((f) => f.id)) : new Set();
    document.querySelectorAll('[data-change="res-one"]').forEach((c) => (c.checked = el.checked));
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
    return (
      '<div class="done-mark done-mark-lg" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>' +
      '<h1 class="flow-title center">¡Listo! Tus estudios ya están en tu historial.</h1>' +
      '<p class="flow-sub center"><b>' + P.plural(n, 'estudio agregado', 'estudios agregados') + '</b> desde ' + i.name + '. También los vas a encontrar en Documentos y en tu Historial.</p>' +
      '<ul class="success-list">' + F.saved.map((s, k) =>
        '<li style="--i:' + k + '">' + ic('check', 18) + '<span class="sl-name">' + s.name + '</span><span class="num muted">' + P.fmt(s.date) + '</span></li>').join('') + '</ul>' +
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
})();
