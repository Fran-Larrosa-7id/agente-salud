/* Portal de Pacientes — pantallas dentro del shell. */
(function () {
  const P = window.P;
  const S = (P.screens = {});
  const A = (P.actions = P.actions || {});
  const IN = (P.inputs = P.inputs || {});
  const CH = (P.changes = P.changes || {});
  const ic = P.icon;

  const pageHead = (title, sub, aside) =>
    '<header class="page-head"><div><h1 class="page-title" tabindex="-1">' + title + '</h1>' +
    (sub ? '<p class="page-sub">' + sub + '</p>' : '') + '</div>' + (aside || '') + '</header>';

  const cardHead = (title, link, id) =>
    '<div class="card-head"><h2 class="card-title"' + (id ? ' id="' + id + '"' : '') + '>' + title + '</h2>' +
    (link ? '<a class="link" href="' + link[1] + '">' + link[0] + ic('arrow-right', 18) + '</a>' : '') + '</div>';

  const option = (value, label, current) => '<option value="' + value + '"' + (String(value) === String(current) ? ' selected' : '') + '>' + label + '</option>';

  /* =====================================================================
     INICIO
     ===================================================================== */
  S.inicio = function () {
    const studies = P.studies();
    const docs = P.documents();
    const meds = P.activeMeds();
    const allergies = P.db.allergies;
    const sources = P.sourceInstitutions();
    const last = studies.find((s) => s.status === 'disponible');
    const empty = !studies.length;

    const stat = (href, icon, label, value, unit, sub) =>
      '<a class="stat" href="' + href + '"><span class="stat-label">' + ic(icon, 20) + label + '</span>' +
      '<span class="stat-value"><span class="num">' + value + '</span>' + (unit ? ' <span class="stat-unit">' + unit + '</span>' : '') + '</span>' +
      '<span class="stat-sub">' + sub + '</span></a>';

    const html =
      '<header class="home-head">' +
      '<div><p class="home-date">' + P.fmtToday() + '</p><h1 class="page-title" tabindex="-1">Hola, ' + P.PATIENT.first + '</h1>' +
      '<p class="page-sub">Este es el resumen de tu salud.</p></div>' +
      '<a class="sources" href="#/perfil/privacidad"><span class="mono-stack">' + sources.slice(0, 5).map((id) => P.mono(id, 'md')).join('') + '</span>' +
      '<span class="sources-text"><b>' + P.plural(sources.length, 'institución', 'instituciones') + '</b><span>aportan datos a tu historial</span></span>' + ic('chevron-right', 18, 'chev') + '</a>' +
      '</header>' +

      '<section class="stats" aria-label="Estado rápido">' +
      stat('#/salud/alergias', 'alert', 'Alergias', allergies.length, allergies.length === 1 ? 'registrada' : 'registradas', allergies.map((a) => a.name).join(', ')) +
      stat('#/salud/medicacion', 'pill', 'Medicación', meds.length, meds.length === 1 ? 'activa' : 'activas', meds.map((m) => m.name).join(', ')) +
      (last
        ? stat('#/estudios/' + last.id, 'flask', 'Último estudio', P.fmt(last.date), '', P.esc(last.name))
        : stat('#/estudios', 'flask', 'Estudios', '0', 'guardados', 'Todavía no trajiste estudios')) +
      stat('#/documentos', 'file', 'Documentos', docs.length, 'disponibles', 'Resultados, informes y recetas') +
      '</section>' +

      featureCard(empty) +

      '<div class="home-grid">' +
      '<section class="card" aria-labelledby="h-recientes">' + cardHead('Estudios recientes', studies.length ? ['Ver todos', '#/estudios'] : null, 'h-recientes') +
      (studies.length
        ? '<ul class="study-list">' + studies.slice(0, 4).map(P.studyRowCompact).join('') + '</ul>'
        : P.empty({ compact: true, icon: 'flask', title: 'Todavía no tenés estudios guardados', text: 'Podés incorporarlos desde una institución compatible.', action: '<a class="btn btn-accent" href="#/traer">' + ic('import', 20) + 'Traer mis primeros estudios</a>' })) +
      '</section>' +

      '<div class="home-side">' +
      '<section class="card card-key" aria-labelledby="h-importante">' + cardHead('Mi información importante', null, 'h-importante') +
      '<p class="key-label">Alergias</p>' +
      '<ul class="allergy-chips">' + allergies.map((a) => '<li><a href="#/salud/alergias" class="allergy-chip">' + ic('alert', 18) + '<span>' + a.name + '</span></a></li>').join('') + '</ul>' +
      '<p class="key-label">Antecedentes</p>' +
      '<ul class="key-list">' + P.db.conditions.slice(0, 2).map((c) => '<li><a href="#/salud/antecedentes">' + P.esc(c.name) + '<span>' + (c.since ? 'Desde ' + c.since : c.category) + '</span></a></li>').join('') + '</ul>' +
      '</section>' +

      '<section class="card" aria-labelledby="h-med">' + cardHead('Medicación actual', ['Ver medicación', '#/salud/medicacion'], 'h-med') +
      '<ul class="med-list">' + meds.map((m) => P.medRow(m, true)).join('') + '</ul>' +
      '</section>' +
      '</div></div>';

    return { title: 'Inicio', html };
  };

  function featureCard(empty) {
    const chips = [['LN', 'sage', 'Laboratorio Norte', 18], ['DM', 'sand', 'Diagnóstico Médico', 78], ['CI', 'sky', 'Centro de Imágenes', 138]];
    const art =
      '<svg class="feature-art" viewBox="0 0 380 200" aria-hidden="true" focusable="false">' +
      chips.map((c, i) =>
        '<g class="fa-chip" style="--d:' + i * 90 + 'ms"><rect x="0" y="' + c[3] + '" width="168" height="44" rx="10" class="fa-chip-bg"/>' +
        '<rect x="10" y="' + (c[3] + 10) + '" width="24" height="24" rx="6" class="fa-mono t-' + c[1] + '"/>' +
        '<text x="22" y="' + (c[3] + 26.5) + '" text-anchor="middle" class="fa-mono-t">' + c[0] + '</text>' +
        '<text x="42" y="' + (c[3] + 27) + '" class="fa-name">' + c[2] + '</text></g>'
      ).join('') +
      chips.map((c, i) => '<path class="fa-line" style="--d:' + (250 + i * 90) + 'ms" d="M168 ' + (c[3] + 22) + ' C 212 ' + (c[3] + 22) + ', 222 100, 262 100"/>').join('') +
      '<g class="fa-target"><rect x="256" y="28" width="118" height="144" rx="14" fill="#fff"/>' +
      '<rect x="270" y="42" width="22" height="22" rx="6" fill="#0F8B8D"/><path d="M281 48v10M276 53h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
      '<rect x="298" y="47" width="58" height="6" rx="3" fill="#DCE4EC"/><rect x="298" y="57" width="38" height="5" rx="2.5" fill="#EEF2F6"/>' +
      [80, 108, 136].map((y, i) =>
        '<g class="fa-row" style="--d:' + (620 + i * 110) + 'ms"><circle cx="279" cy="' + y + '" r="8" fill="#DFF3EF"/><path d="M275.5 ' + y + 'l2.4 2.4 4.6-4.8" stroke="#087477" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="294" y="' + (y - 7) + '" width="' + [60, 48, 54][i] + '" height="6" rx="3" fill="#C9D3DE"/><rect x="294" y="' + (y + 3) + '" width="34" height="5" rx="2.5" fill="#E6ECF2"/></g>'
      ).join('') +
      '</g></svg>';

    return (
      '<section class="feature" aria-labelledby="feature-t">' +
      '<div class="feature-copy">' +
      '<p class="feature-kicker">' + ic('import', 18) + 'Traer mis estudios</p>' +
      '<h2 class="feature-title" id="feature-t">' + (empty ? 'Empezá trayendo tus estudios' : '¿Tenés estudios en otro laboratorio?') + '</h2>' +
      '<p class="feature-text">Traelos a tu historial sin descargarlos y subirlos manualmente. Elegís la institución, iniciás sesión y listo.</p>' +
      '<div class="feature-actions"><a class="btn btn-accent btn-lg" href="#/traer">' + (empty ? 'Traer mis primeros estudios' : 'Traer mis estudios') + ic('arrow-right', 20) + '</a>' +
      '<span class="feature-note">' + ic('lock', 16) + 'Nunca guardamos tu contraseña de otras instituciones.</span></div>' +
      '</div>' + art + '</section>'
    );
  }

  /* =====================================================================
     MI SALUD
     ===================================================================== */
  const SALUD_TABS = [
    ['resumen', 'Resumen'],
    ['antecedentes', 'Antecedentes'],
    ['alergias', 'Alergias'],
    ['medicacion', 'Medicación'],
    ['vacunas', 'Vacunas'],
  ];

  S.salud = function (r) {
    const tab = SALUD_TABS.some((t) => t[0] === r.parts[1]) ? r.parts[1] : 'resumen';
    const counts = { antecedentes: P.db.conditions.length, alergias: P.db.allergies.length, medicacion: P.activeMeds().length, vacunas: P.db.vaccines.length };
    const tabs =
      '<div class="tabs" role="tablist" aria-label="Categorías de Mi salud">' +
      SALUD_TABS.map((t) =>
        '<a class="tab" role="tab" href="#/salud/' + t[0] + '" aria-selected="' + (t[0] === tab) + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] +
        (counts[t[0]] != null ? ' <span class="tab-count num">' + counts[t[0]] + '</span>' : '') + '</a>'
      ).join('') + '</div>';

    const body = { resumen: saludResumen, antecedentes: saludAntecedentes, alergias: saludAlergias, medicacion: saludMedicacion, vacunas: saludVacunas }[tab]();
    const title = tab === 'resumen' ? 'Mi salud' : SALUD_TABS.find((t) => t[0] === tab)[1] + ' · Mi salud';
    return {
      title,
      html: pageHead('Mi salud', 'Tu información médica organizada, con el origen de cada dato.') + tabs + '<div class="tab-panel" role="tabpanel">' + body + '</div>',
    };
  };

  function saludResumen() {
    const sources = P.sourceInstitutions();
    const block = (id, icon, title, count, items, href) =>
      '<section class="sum-block" aria-labelledby="sum-' + id + '">' +
      '<div class="sum-head"><span class="sum-icon sum-' + id + '" aria-hidden="true">' + ic(icon, 22) + '</span>' +
      '<h2 class="sum-title" id="sum-' + id + '">' + title + '</h2><span class="sum-count num">' + count + '</span>' +
      '<a class="link" href="' + href + '">Ver detalle' + ic('arrow-right', 18) + '</a></div>' +
      '<ul class="sum-items">' + items + '</ul></section>';
    const li = (main, sub, inst) => '<li><span class="sum-main">' + main + '</span><span class="sum-sub">' + sub + '</span>' + P.instBadge(inst) + '</li>';

    return (
      '<div class="salud-grid">' +
      '<div class="card sum-card">' +
      block('alergias', 'alert', 'Alergias', P.db.allergies.length, P.db.allergies.map((a) => li(a.name, a.type + ' · ' + a.reaction, a.inst)).join(''), '#/salud/alergias') +
      block('antecedentes', 'clipboard', 'Antecedentes', P.db.conditions.length, P.db.conditions.map((c) => li(P.esc(c.name), c.category + (c.since ? ' · desde ' + c.since : ''), c.inst)).join(''), '#/salud/antecedentes') +
      block('medicacion', 'pill', 'Medicación actual', P.activeMeds().length, P.activeMeds().map((m) => li(m.name + ' ' + m.dose, m.how, m.inst)).join(''), '#/salud/medicacion') +
      block('vacunas', 'syringe', 'Vacunas', P.db.vaccines.length, P.db.vaccines.slice(0, 2).map((v) => li(v.name, v.dose + ' · <span class="num">' + P.fmt(v.date) + '</span>', v.inst)).join(''), '#/salud/vacunas') +
      '</div>' +
      '<aside class="salud-aside">' +
      '<section class="card"><h2 class="card-title">¿De dónde viene esta información?</h2>' +
      '<p class="muted mt-2">Cada dato muestra la institución que lo registró. Así sabés siempre a quién consultar.</p>' +
      '<ul class="source-list">' + sources.map((id) => {
        const i = P.inst(id);
        return '<li>' + P.mono(id, 'md') + '<span><b>' + i.name + '</b><span>' + i.kind + '</span></span></li>';
      }).join('') +
      '<li>' + P.mono('yo', 'md') + '<span><b>Declarado por vos</b><span>Datos que informaste en tu perfil</span></span></li></ul>' +
      '</section>' +
      '<section class="note-card"><p>' + ic('info', 20) + '<span>El portal organiza tu información pero no reemplaza la consulta. Si ves un dato incorrecto, avisale a la institución que lo registró.</span></p></section>' +
      '</aside></div>'
    );
  }

  function saludAntecedentes() {
    return (
      '<p class="panel-intro">Enfermedades, cirugías y antecedentes familiares registrados por tus instituciones o informados por vos.</p>' +
      '<ul class="info-list">' + P.db.conditions.map((c) => {
        const related = c.related.map((id) => P.study(id)).filter(Boolean);
        return (
          '<li class="info-item"><span class="ty ty-cond" aria-hidden="true">' + ic('clipboard', 22) + '</span><div class="info-main">' +
          '<div class="info-top"><h2 class="info-name">' + P.esc(c.name) + '</h2>' + P.badge('neutral', c.category) + '</div>' +
          '<dl class="facts">' + (c.since ? '<div><dt>Diagnosticado</dt><dd class="num">' + c.since + '</dd></div>' : '') +
          '<div><dt>Observaciones</dt><dd>' + P.esc(c.note) + '</dd></div></dl>' +
          (related.length ? '<p class="related">Documentación asociada: ' + related.map((s) => '<a class="link" href="#/estudios/' + s.id + '">' + ic('file', 16) + P.esc(s.name) + ' · <span class="num">' + P.fmt(s.date) + '</span></a>').join('') + '</p>' : '') +
          P.prov(c.inst, c.date) +
          '</div></li>'
        );
      }).join('') + '</ul>'
    );
  }

  function saludAlergias() {
    return (
      '<div class="callout callout-warm">' + ic('info', 20) + '<p>Mostrá esta información a cualquier profesional que te atienda, sobre todo antes de recibir un medicamento nuevo.</p></div>' +
      '<ul class="info-list">' + P.db.allergies.map((a) =>
        '<li class="info-item info-allergy"><span class="ty ty-allergy" aria-hidden="true">' + ic('alert', 22) + '</span><div class="info-main">' +
        '<div class="info-top"><h2 class="info-name">' + a.name + '</h2>' + P.badge('warning', 'Alergia', 'alert') + '</div>' +
        '<dl class="facts"><div><dt>Tipo</dt><dd>' + a.type + '</dd></div><div><dt>Reacción registrada</dt><dd>' + a.reaction + '</dd></div></dl>' +
        P.prov(a.inst, a.date) + '</div></li>'
      ).join('') + '</ul>' +
      '<p class="muted mt-4">¿Falta alguna alergia? Contásela a tu profesional de salud para que quede registrada.</p>'
    );
  }

  function saludMedicacion() {
    const act = P.activeMeds(), past = P.pastMeds();
    return (
      '<section aria-labelledby="h-med-act"><h2 class="section-h" id="h-med-act">Medicación actual <span class="num">' + act.length + '</span></h2>' +
      '<ul class="info-list">' + act.map((m) => P.medRow(m)).join('') + '</ul></section>' +
      '<section aria-labelledby="h-med-past" class="mt-8"><h2 class="section-h" id="h-med-past">Medicación anterior <span class="num">' + past.length + '</span></h2>' +
      '<ul class="info-list info-list-quiet">' + past.map((m) => P.medRow(m)).join('') + '</ul></section>' +
      '<p class="muted mt-4">No cambies ni suspendas una medicación sin hablar antes con tu profesional de salud.</p>'
    );
  }

  function saludVacunas() {
    return (
      '<ul class="info-list">' + P.db.vaccines.map((v) =>
        '<li class="info-item"><span class="ty ty-vac" aria-hidden="true">' + ic('syringe', 22) + '</span><div class="info-main">' +
        '<div class="info-top"><h2 class="info-name">' + v.name + '</h2>' + P.badge('success', 'Aplicada', 'check') + '</div>' +
        '<dl class="facts"><div><dt>Dosis</dt><dd>' + v.dose + '</dd></div><div><dt>Fecha</dt><dd class="num">' + P.fmt(v.date) + '</dd></div></dl>' +
        P.prov(v.inst, v.date) + '</div></li>'
      ).join('') + '</ul>'
    );
  }

  /* =====================================================================
     ESTUDIOS
     ===================================================================== */
  const est = (P.ui.est = P.ui.est || { q: '', type: 'todos', year: 'todos', inst: 'todas', sort: 'desc' });

  function filterStudies() {
    const q = est.q.trim().toLowerCase();
    let list = P.studies().filter((s) =>
      (est.type === 'todos' || s.type === est.type) &&
      (est.year === 'todos' || (s.date || '').slice(0, 4) === est.year) &&
      (est.inst === 'todas' || s.inst === est.inst) &&
      (!q || (s.name + ' ' + P.inst(s.inst).name).toLowerCase().includes(q))
    );
    if (est.sort === 'asc') list = list.reverse();
    if (est.sort === 'az') list = list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return list;
  }

  function studiesResults() {
    const all = P.studies();
    if (!all.length) {
      return P.empty({
        icon: 'flask',
        title: 'Todavía no tenés estudios guardados',
        text: 'Podés incorporarlos desde una institución compatible, sin descargar ni subir archivos.',
        action: '<a class="btn btn-accent btn-lg" href="#/traer">' + ic('import', 20) + 'Traer mis primeros estudios</a>',
      });
    }
    const list = filterStudies();
    if (!list.length) {
      return P.empty({
        icon: 'search',
        title: 'No encontramos estudios con esos filtros',
        text: est.q ? 'Probá con otra palabra o revisá cómo está escrito «' + P.esc(est.q) + '».' : 'Probá cambiando el año, el tipo o la institución.',
        action: '<button class="btn btn-secondary" type="button" data-action="est-clear">' + ic('rotate-ccw', 18) + 'Limpiar filtros</button>',
      });
    }
    let html = '<p class="result-count" role="status">' + P.plural(list.length, 'estudio', 'estudios') + '</p>';
    if (est.sort === 'az') return html + '<div class="card card-flush"><ul class="study-list">' + list.map(P.studyRow).join('') + '</ul></div>';
    const groups = [];
    list.forEach((s) => {
      const y = (s.date || '').slice(0, 4) || 'sin-fecha';
      let g = groups.find((x) => x.y === y);
      if (!g) groups.push((g = { y, items: [] }));
      g.items.push(s);
    });
    return html + groups.map((g) =>
      '<section class="year-group" aria-labelledby="y-' + g.y + '"><h2 class="group-h" id="y-' + g.y + '"><span class="num">' + (g.y === 'sin-fecha' ? 'Sin fecha' : g.y) + '</span><span>' + P.plural(g.items.length, 'estudio', 'estudios') + '</span></h2>' +
      '<div class="card card-flush"><ul class="study-list">' + g.items.map(P.studyRow).join('') + '</ul></div></section>'
    ).join('');
  }

  S.estudios = function () {
    const all = P.studies();
    const years = Array.from(new Set(all.map((s) => (s.date || '').slice(0, 4)).filter(Boolean))).sort().reverse();
    const insts = Array.from(new Set(all.map((s) => s.inst)));
    const count = (t) => all.filter((s) => t === 'todos' || s.type === t).length;
    const types = [['todos', 'Todos'], ['laboratorio', 'Laboratorio'], ['imagenes', 'Imágenes'], ['otros', 'Otros']];
    const ji = P.ui.justImported;

    const html =
      pageHead('Estudios', 'Resultados e informes de todas tus instituciones, en un solo lugar.',
        '<a class="btn btn-accent btn-lg head-cta" href="#/traer">' + ic('import', 20) + 'Traer mis estudios</a>') +
      (ji ? '<div class="notice" role="status">' + P.mono(ji.inst, 'md') + '<p><b>Agregaste ' + P.plural(ji.count, 'estudio', 'estudios') + ' de ' + P.inst(ji.inst).name + '.</b> Están marcados como «Nuevo».</p>' +
        '<button class="icon-btn" type="button" data-action="dismiss-import" aria-label="Cerrar aviso">' + ic('x', 20) + '</button></div>' : '') +
      (all.length
        ? '<div class="toolbar">' +
          '<label class="search"><span class="sr-only">Buscar estudios</span>' + ic('search', 20) +
          '<input type="search" id="est-q" data-input="est-q" value="' + P.esc(est.q) + '" placeholder="Buscar por nombre o institución" autocomplete="off"></label>' +
          '<div class="selects">' +
          '<label class="select"><span class="select-l">Año</span><select data-change="est-year">' + option('todos', 'Todos', est.year) + years.map((y) => option(y, y, est.year)).join('') + '</select></label>' +
          '<label class="select"><span class="select-l">Institución</span><select data-change="est-inst">' + option('todas', 'Todas', est.inst) + insts.map((i) => option(i, P.inst(i).name, est.inst)).join('') + '</select></label>' +
          '<label class="select"><span class="select-l">Orden</span><select data-change="est-sort">' + option('desc', 'Más recientes', est.sort) + option('asc', 'Más antiguos', est.sort) + option('az', 'Nombre (A–Z)', est.sort) + '</select></label>' +
          '</div></div>' +
          '<div class="chips" role="group" aria-label="Tipo de estudio">' + types.map((t) =>
            '<button type="button" class="chip" data-action="est-type" data-value="' + t[0] + '" aria-pressed="' + (est.type === t[0]) + '">' + t[1] + ' <span class="chip-count num">' + count(t[0]) + '</span></button>'
          ).join('') + '</div>'
        : '') +
      '<div id="est-results">' + studiesResults() + '</div>';
    return { title: 'Estudios', html, skeleton: 'list' };
  };

  const refreshStudies = () => { const el = document.getElementById('est-results'); if (el) el.innerHTML = studiesResults(); };
  IN['est-q'] = (el) => { est.q = el.value; refreshStudies(); };
  CH['est-year'] = (el) => { est.year = el.value; refreshStudies(); };
  CH['est-inst'] = (el) => { est.inst = el.value; refreshStudies(); };
  CH['est-sort'] = (el) => { est.sort = el.value; refreshStudies(); };
  A['est-type'] = (el) => {
    est.type = el.dataset.value;
    document.querySelectorAll('[data-action="est-type"]').forEach((b) => b.setAttribute('aria-pressed', b === el));
    refreshStudies();
  };
  A['est-clear'] = () => { Object.assign(est, { q: '', type: 'todos', year: 'todos', inst: 'todas', sort: 'desc' }); P.rerender(); };
  A['dismiss-import'] = (el) => { P.ui.justImported = null; const n = el.closest('.notice'); n.classList.add('is-out'); setTimeout(() => n.remove(), 200); };

  /* =====================================================================
     DETALLE DE ESTUDIO
     ===================================================================== */
  S.estudio = function (r) {
    const s = P.study(r.parts[1]);
    if (!s || (P.db.emptyDemo && !s.importedAt)) {
      return {
        title: 'Estudio no encontrado',
        html: '<nav class="crumbs" aria-label="Ruta"><a href="#/estudios">Estudios</a></nav>' +
          P.empty({ icon: 'search', title: 'No encontramos este estudio', text: 'Puede que el enlace sea incorrecto o que el estudio ya no esté en tu historial.', action: '<a class="btn btn-primary" href="#/estudios">Volver a Estudios</a>' }),
      };
    }
    if (s.isNew) { s.isNew = false; P.save(); }
    const t = P.TYPES[s.type];
    const inst = P.inst(s.inst);
    const available = s.status === 'disponible';
    const doc = P.doc('doc-' + s.id);
    const shares = P.db.shares.filter((x) => x.studyId === s.id && P.shareStatus(x) === 'activo');

    let main = '';
    if (!available) {
      main += '<section class="card card-pending"><div class="pending-row">' + ic('clock', 24) + '<div><h2 class="card-title">El resultado todavía no está listo</h2>' +
        '<p>' + inst.name + ' está procesando este estudio. Cuando esté disponible lo vas a ver acá y en Documentos.</p>' +
        '<p class="muted mt-2">Fecha estimada: <b class="num">' + P.fmt(s.expected) + '</b></p></div></div></section>';
    } else if (s.file) {
      main += '<section class="card" aria-labelledby="h-orig">' + cardHead('Documento original', null, 'h-orig') +
        '<p>Trajimos el PDF original tal como lo emitió ' + inst.name + '. El Portal lo guarda sin leerlo ni interpretarlo.</p>' +
        '<div class="btn-row mt-4"><button type="button" class="btn btn-primary" data-action="doc-view" data-id="doc-' + s.id + '">' + ic('eye', 18) + 'Ver documento</button></div>' +
        '<p class="disclaimer">' + ic('info', 18) + '<span>Si tenés dudas sobre los resultados, consultá con tu profesional de salud.</span></p></section>';
    } else if (s.results) {
      main += '<section class="card" aria-labelledby="h-res">' + cardHead('Resultados', null, 'h-res') +
        '<p class="muted">Valores tal como los informó ' + inst.name + '.</p>' +
        '<table class="rtable"><thead><tr><th scope="col">Determinación</th><th scope="col">Resultado</th><th scope="col">Referencia del laboratorio</th></tr></thead><tbody>' +
        s.results.map((x) => '<tr><th scope="row">' + x[0] + '</th><td data-l="Resultado" class="num"><b>' + x[1] + '</b>' + (x[2] ? ' <span class="unit">' + x[2] + '</span>' : '') + '</td><td data-l="Referencia" class="num">' + x[3] + '</td></tr>').join('') +
        '</tbody></table>' +
        '<p class="disclaimer">' + ic('info', 18) + '<span>El portal organiza tus resultados pero no los interpreta. Si tenés dudas, consultá con tu profesional de salud.</span></p>' +
        '</section>';
    } else {
      main += '<section class="card" aria-labelledby="h-img">' + cardHead(s.type === 'imagenes' ? 'Imágenes e informe' : 'Registro e informe', null, 'h-img') +
        '<div class="img-strip">' + Array.from({ length: Math.min(s.images || 1, 4) }, (_, i) => '<button type="button" class="img-tile" data-action="doc-view" data-id="doc-' + s.id + '" aria-label="Ver imagen ' + (i + 1) + ' en el documento original"><span class="paper-scan"></span></button>').join('') + '</div>' +
        '<p class="muted mt-4">El informe completo del profesional está en el documento original.</p></section>';
    }
    main += '<section class="card" aria-labelledby="h-gen">' + cardHead('Información general', null, 'h-gen') +
      '<dl class="dl-grid">' +
      '<div><dt>Tipo</dt><dd>' + t.label + '</dd></div>' +
      '<div><dt>Fecha de realización</dt><dd class="num">' + P.fmt(s.date) + '</dd></div>' +
      '<div><dt>Fecha del informe</dt><dd class="num">' + (s.reportDate ? P.fmt(s.reportDate) : s.origin === 'agente' ? 'Sin dato' : 'Pendiente') + '</dd></div>' +
      '<div><dt>Solicitado por</dt><dd>' + P.esc(s.requestedBy) + '</dd></div>' +
      '<div><dt>N.º de protocolo</dt><dd class="num">' + P.esc(s.protocol || 'Sin dato') + '</dd></div>' +
      (s.providerStatus ? '<div><dt>Estado en la institución</dt><dd>' + P.esc(s.providerStatus) + '</dd></div>' : '') +
      '<div><dt>Institución</dt><dd>' + P.instBadge(s.inst) + '</dd></div>' +
      '</dl></section>';

    const how = s.importedAt
      ? 'Lo trajiste vos con «Traer mis estudios» el <span class="num">' + P.fmt(s.importedAt) + '</span>.'
      : P.authorization(s.inst) && P.authorization(s.inst).mode === 'autorizada'
        ? 'Llegó por la autorización que diste a ' + inst.name + '.'
        : inst.name + ' lo envió a tu portal automáticamente.';

    const side =
      (available && doc
        ? '<section class="card doc-card" aria-labelledby="h-doc">' + cardHead('Documento original', null, 'h-doc') +
          '<button type="button" class="doc-preview" data-action="doc-view" data-id="' + doc.id + '" aria-label="Ver documento original">' + P.paper(doc, true) + '<span class="doc-preview-cta">' + ic('eye', 18) + 'Ver documento</span></button>' +
          '<p class="file-meta">' + ic('file', 18) + '<span>' + P.fileMeta(s) + '</span></p>' +
          '<div class="btn-row"><button type="button" class="btn btn-secondary" data-action="doc-view" data-id="' + doc.id + '">' + ic('eye', 18) + 'Ver documento</button>' +
          '<button type="button" class="btn btn-secondary" data-action="doc-download" data-id="' + doc.id + '">' + ic('download', 18) + 'Descargar</button></div></section>'
        : '') +
      '<section class="card" aria-labelledby="h-prov">' + cardHead('Procedencia', null, 'h-prov') +
      '<div class="prov-block">' + P.mono(s.inst, 'lg') + '<div><p class="prov-name">' + inst.name + '</p><p class="muted">' + P.instSub(inst) + '</p></div></div>' +
      '<ul class="prov-steps"><li>' + ic('calendar', 18) + '<span>Estudio realizado el <b class="num">' + P.fmt(s.date) + '</b></span></li>' +
      (s.reportDate ? '<li>' + ic('file-check', 18) + '<span>Informe emitido el <b class="num">' + P.fmt(s.reportDate) + '</b></span></li>' : '') +
      '<li>' + ic(s.importedAt ? 'import' : 'link', 18) + '<span>' + how + '</span></li></ul></section>' +
      (shares.length
        ? '<section class="card" aria-labelledby="h-acc">' + cardHead('Accesos activos', null, 'h-acc') +
          '<ul class="access-list">' + shares.map(accessRow).join('') + '</ul></section>'
        : '');

    const html =
      '<nav class="crumbs" aria-label="Ruta"><a href="#/estudios">Estudios</a>' + ic('chevron-right', 16) + '<span aria-current="page">' + P.esc(s.name) + '</span></nav>' +
      '<header class="detail-head">' +
      '<div class="detail-title">' + P.typeTile(s.type, 'lg') +
      '<div><p class="eyebrow">' + t.label + '</p><h1 class="page-title" tabindex="-1">' + P.esc(s.name) + '</h1>' +
      '<p class="detail-meta"><span>' + ic('calendar', 18) + P.fmtLong(s.date) + '</span>' + P.instBadge(s.inst) + P.studyStatus(s) + '</p></div></div>' +
      (available
        ? '<div class="detail-actions">' +
          '<button type="button" class="btn btn-secondary" data-action="doc-download" data-id="doc-' + s.id + '">' + ic('download', 18) + '<span>Descargar</span></button>' +
          '<button type="button" class="btn btn-accent" data-action="share" data-id="' + s.id + '">' + ic('share', 18) + '<span>Compartir</span></button></div>'
        : '') +
      '</header>' +
      '<div class="detail-grid"><div class="detail-main">' + main + '</div><aside class="detail-side">' + side + '</aside></div>';

    return { title: s.name + ' · Estudios', html };
  };

  function accessRow(sh) {
    const st = P.shareStatus(sh);
    const s = P.study(sh.studyId);
    return (
      '<li class="access">' +
      '<span class="access-icon" aria-hidden="true">' + ic('link', 18) + '</span>' +
      '<div class="access-main"><p class="access-name">' + P.esc(sh.recipient || 'Enlace sin nombre') + (s ? ' <span class="muted">· ' + P.esc(s.name) + '</span>' : '') + '</p>' +
      '<p class="access-sub">' + (st === 'activo' ? 'Vence el <span class="num">' + P.fmtDateTime(sh.expires) + '</span> (' + P.fromNow(sh.expires) + ')' : st === 'revocado' ? 'Revocado' : 'Venció el <span class="num">' + P.fmt(sh.expires) + '</span>') + '</p></div>' +
      (st === 'activo'
        ? P.badge('success', 'Activo', 'check') + '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="revoke" data-id="' + sh.id + '">Revocar</button>'
        : P.badge('neutral', st === 'revocado' ? 'Revocado' : 'Vencido', 'ban')) +
      '</li>'
    );
  }
  P.accessRow = accessRow;

  /* Visor de documento */
  A['doc-view'] = (el) => {
    const d = P.doc(el.dataset.id);
    if (!d) return;
    const h = P.overlay({
      kind: 'modal',
      size: 'xl',
      className: 'ov-viewer',
      title: P.esc(d.title) + '<span class="ov-sub">' + P.esc(P.inst(d.inst).name) + ' · <span class="num">' + P.fmt(d.date) + '</span></span>',
      headActions:
        '<div class="ov-head-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="dl">' + ic('download', 18) + '<span>Descargar</span></button>' +
        (d.studyId ? '<button type="button" class="btn btn-accent btn-sm" data-act="share">' + ic('share', 18) + '<span>Compartir</span></button>' : '') + '</div>',
      body: d.file
        ? '<div class="viewer viewer-pdf" id="pdf-host"><p class="pdf-loading"><span class="spin" aria-hidden="true"></span>Abriendo el documento…</p></div>' +
          '<p class="viewer-foot">' + P.fileMeta(d) + ' · Documento original de ' + P.esc(P.inst(d.inst).name) + '</p>'
        : '<div class="viewer">' + P.sheet(d) + '</div><p class="viewer-foot">' + P.fileMeta(d) + '</p>',
      onClose: () => { if (url) URL.revokeObjectURL(url); },
    });
    let url = null;
    if (d.file) {
      const host = h.el.querySelector('#pdf-host');
      P.files.get(d.file.key).then((blob) => {
        if (!blob) throw new Error('missing');
        url = URL.createObjectURL(blob);
        host.innerHTML = '<iframe class="pdf-frame" title="Documento original: ' + P.esc(d.title) + '" src="' + url + '"></iframe>';
      }).catch(() => {
        host.innerHTML = P.empty({
          compact: true, icon: 'file', title: 'El archivo no está en este dispositivo',
          text: 'Los documentos traídos se guardan en el navegador donde los trajiste. Podés volver a traerlo desde «Traer mis estudios».',
        });
      });
    }
    h.el.querySelector('[data-act="dl"]').addEventListener('click', () => P.download(d));
    const sh = h.el.querySelector('[data-act="share"]');
    if (sh) sh.addEventListener('click', () => { h.close(); P.openShare(d.studyId); });
  };
  A['doc-download'] = (el) => { const d = P.doc(el.dataset.id); if (d) P.download(d); };
  A.share = (el) => P.openShare(el.dataset.id);
  A.revoke = async (el) => {
    const sh = P.db.shares.find((x) => x.id === el.dataset.id);
    if (!sh) return;
    const ok = await P.confirm({ title: '¿Revocar este acceso?', text: 'El enlace dejará de funcionar de inmediato. ' + P.esc(sh.recipient || 'Quien lo tenga') + ' ya no podrá ver la información.', confirmLabel: 'Revocar acceso', tone: 'danger' });
    if (!ok) return;
    sh.revoked = true;
    P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Revocaste un acceso compartido', sub: sh.recipient || 'Enlace sin nombre' });
    P.save();
    P.toast('Acceso revocado. El enlace ya no funciona.');
    P.rerender();
  };

  /* =====================================================================
     HISTORIAL (timeline)
     ===================================================================== */
  const hist = (P.ui.hist = P.ui.hist || { kind: 'todo' });

  function events() {
    const ev = [];
    P.studies().forEach((s) => ev.push({ date: s.date, kind: 'estudio', icon: P.TYPES[s.type].icon, title: s.name, sub: P.TYPES[s.type].label, inst: s.inst, href: '#/estudios/' + s.id, tag: s.status === 'pendiente' ? 'Resultado pendiente' : s.importedAt ? 'Traído por vos' : '' }));
    P.db.meds.forEach((m) => {
      ev.push({ date: m.start, kind: 'medicacion', icon: 'pill', title: 'Nueva medicación registrada', sub: m.name + ' ' + m.dose + ' · ' + m.how, inst: m.inst, href: '#/salud/medicacion' });
      if (m.end) ev.push({ date: m.end, kind: 'medicacion', icon: 'pill', title: 'Medicación finalizada', sub: m.name + ' ' + m.dose, inst: m.inst, href: '#/salud/medicacion' });
    });
    P.db.vaccines.forEach((v) => ev.push({ date: v.date, kind: 'vacuna', icon: 'syringe', title: 'Vacuna aplicada', sub: v.name + ' · ' + v.dose, inst: v.inst, href: '#/salud/vacunas' }));
    P.db.allergies.forEach((a) => ev.push({ date: a.date, kind: 'otros', icon: 'alert', title: 'Alergia registrada', sub: a.name, inst: a.inst, href: '#/salud/alergias' }));
    P.db.conditions.filter((c) => c.inst !== 'yo').forEach((c) => ev.push({ date: c.date, kind: 'otros', icon: 'clipboard', title: 'Antecedente registrado', sub: c.name, inst: c.inst, href: '#/salud/antecedentes' }));
    if (!P.db.emptyDemo) P.db.documents.filter((d) => d.kind !== 'otros').forEach((d) => ev.push({ date: d.date, kind: 'documento', icon: 'file', title: d.title, sub: P.DOC_KINDS[d.kind], inst: d.inst, docId: d.id }));
    P.db.imports.forEach((im) => ev.push({ date: im.date, kind: 'estudio', icon: 'import', title: 'Trajiste ' + P.plural(im.count, 'estudio', 'estudios'), sub: 'Desde «Traer mis estudios»', inst: im.inst, href: '#/estudios', highlight: true, order: 1 }));
    return ev.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.order || 0) - (a.order || 0)));
  }

  function timelineHTML() {
    const kinds = { todo: null, estudio: ['estudio'], medicacion: ['medicacion'], vacuna: ['vacuna'], documento: ['documento'], otros: ['otros'] };
    const list = events().filter((e) => !kinds[hist.kind] || kinds[hist.kind].includes(e.kind));
    if (!list.length) return P.empty({ icon: 'history', title: 'No hay eventos para mostrar', text: 'Probá con otra categoría.', action: '<button class="btn btn-secondary" type="button" data-action="hist-kind" data-value="todo">Ver todo</button>' });
    const groups = [];
    list.forEach((e) => {
      const key = !e.date ? 'sin-fecha' : e.date < '2025-01-01' ? 'antes' : e.date.slice(0, 7);
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, label: key === 'antes' ? 'Antes de 2025' : key === 'sin-fecha' ? 'Sin fecha' : P.fmtMonth(e.date), items: [] }));
      g.items.push(e);
    });
    return groups.map((g) =>
      '<section class="tl-month" aria-labelledby="m-' + g.key + '"><h2 class="tl-mh" id="m-' + g.key + '">' + g.label + ' <span>' + P.plural(g.items.length, 'evento', 'eventos') + '</span></h2><ol class="tl">' +
      g.items.map((e) => {
        const d = P.fmtDay(e.date);
        const inner = '<span class="tl-title">' + P.esc(e.title) + '</span><span class="tl-sub">' + P.esc(e.sub) + '</span>' +
          '<span class="tl-foot">' + P.instBadge(e.inst) + (e.tag ? P.badge(e.tag === 'Resultado pendiente' ? 'warning' : 'new', e.tag) : '') + '</span>';
        const body = e.docId
          ? '<button type="button" class="tl-body" data-action="doc-view" data-id="' + e.docId + '">' + inner + '</button>'
          : '<a class="tl-body" href="' + e.href + '">' + inner + '</a>';
        return '<li class="tl-item' + (e.highlight ? ' is-hl' : '') + '">' +
          '<span class="tl-date">' + (g.key === 'antes' ? '<span class="num">' + e.date.slice(0, 4) + '</span>' : g.key === 'sin-fecha' ? '<span class="num">—</span><span>sin fecha</span>' : '<span class="num">' + d.day + '</span><span>' + d.mon + '</span>') + '</span>' +
          '<span class="tl-dot k-' + e.kind + '" aria-hidden="true">' + ic(e.icon, 18) + '</span>' + body + '</li>';
      }).join('') + '</ol></section>'
    ).join('');
  }

  S.historial = function () {
    const chips = [['todo', 'Todo'], ['estudio', 'Estudios'], ['medicacion', 'Medicación'], ['vacuna', 'Vacunas'], ['documento', 'Documentos'], ['otros', 'Alergias y antecedentes']];
    return {
      title: 'Historial',
      html:
        pageHead('Historial', 'Todo lo que pasó con tu salud, en orden y con su origen.') +
        '<div class="chips" role="group" aria-label="Filtrar historial">' + chips.map((c) =>
          '<button type="button" class="chip" data-action="hist-kind" data-value="' + c[0] + '" aria-pressed="' + (hist.kind === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
        '<div id="tl-root" class="tl-root">' + timelineHTML() + '</div>',
      skeleton: 'list',
    };
  };
  A['hist-kind'] = (el) => {
    hist.kind = el.dataset.value;
    document.querySelectorAll('.chips [data-action="hist-kind"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === hist.kind));
    document.getElementById('tl-root').innerHTML = timelineHTML();
  };

  /* =====================================================================
     DOCUMENTOS
     ===================================================================== */
  const dst = (P.ui.docs = P.ui.docs || { q: '', kind: 'todos', inst: 'todas', sort: 'desc', mine: false });

  function filterDocs() {
    const q = dst.q.trim().toLowerCase();
    let list = P.documents().filter((d) =>
      (dst.kind === 'todos' || d.kind === dst.kind) &&
      (dst.inst === 'todas' || d.inst === dst.inst) &&
      (!dst.mine || d.imported) &&
      (!q || (d.title + ' ' + P.inst(d.inst).name + ' ' + P.DOC_KINDS[d.kind]).toLowerCase().includes(q))
    );
    if (dst.sort === 'asc') list = list.reverse();
    return list;
  }

  function docsResults() {
    if (!P.documents().length) {
      return P.empty({ icon: 'file', title: 'Todavía no hay documentos', text: 'Cuando traigas estudios o tus instituciones envíen informes y recetas, los vas a encontrar acá.', action: '<a class="btn btn-accent" href="#/traer">' + ic('import', 20) + 'Traer mis estudios</a>' });
    }
    const list = filterDocs();
    if (!list.length) {
      return P.empty({ icon: 'search', title: 'No encontramos documentos', text: 'Probá con otra búsqueda o quitá algún filtro.', action: '<button class="btn btn-secondary" type="button" data-action="docs-clear">' + ic('rotate-ccw', 18) + 'Limpiar filtros</button>' });
    }
    const view = P.db.docView;
    const count = '<p class="result-count" role="status">' + P.plural(list.length, 'documento', 'documentos') + '</p>';
    if (view === 'list') {
      return count + '<div class="card card-flush"><ul class="doc-rows">' + list.map((d) =>
        '<li><button type="button" class="doc-row" data-action="doc-view" data-id="' + d.id + '">' +
        '<span class="ty ty-doc" aria-hidden="true">' + ic('file', 22) + '</span>' +
        '<span class="study-main"><span class="study-name">' + P.esc(d.title) + '</span><span class="study-meta">' + P.DOC_KINDS[d.kind] + ' · ' + P.fileMeta(d) + '</span>' +
        '<span class="study-meta-m">' + P.esc(P.inst(d.inst).name) + ' · <span class="num">' + P.fmt(d.date) + '</span></span></span>' +
        '<span class="study-inst">' + P.instBadge(d.inst) + '</span><span class="study-date num">' + P.fmt(d.date) + '</span>' +
        '<span class="study-status">' + (d.imported ? P.badge('new', 'Traído por vos') : '') + '</span>' + ic('eye', 20, 'chev') + '</button></li>'
      ).join('') + '</ul></div>';
    }
    return count + '<ul class="doc-grid">' + list.map((d) =>
      '<li><button type="button" class="doc-card-g" data-action="doc-view" data-id="' + d.id + '">' +
      '<span class="doc-thumb">' + P.paper(d) + '</span>' +
      '<span class="doc-body"><span class="doc-kind">' + P.DOC_KINDS[d.kind] + (d.imported ? ' · Traído por vos' : '') + '</span>' +
      '<span class="doc-title">' + P.esc(d.title) + '</span>' +
      '<span class="doc-foot">' + P.instBadge(d.inst) + '<span class="num">' + P.fmt(d.date) + '</span></span></span></button></li>'
    ).join('') + '</ul>';
  }

  S.documentos = function () {
    const all = P.documents();
    const insts = Array.from(new Set(all.map((d) => d.inst)));
    const kinds = [['todos', 'Todos'], ['resultado', 'Resultados'], ['informe', 'Informes'], ['receta', 'Recetas'], ['indicaciones', 'Indicaciones'], ['otros', 'Otros']];
    const hasImported = all.some((d) => d.imported);
    const html =
      pageHead('Documentos', 'Resultados, informes, recetas e indicaciones. Siempre con la institución que los emitió.') +
      (all.length
        ? '<div class="toolbar">' +
          '<label class="search"><span class="sr-only">Buscar documentos</span>' + ic('search', 20) +
          '<input type="search" data-input="docs-q" value="' + P.esc(dst.q) + '" placeholder="Buscar documentos" autocomplete="off"></label>' +
          '<div class="selects">' +
          '<label class="select"><span class="select-l">Institución</span><select data-change="docs-inst">' + option('todas', 'Todas', dst.inst) + insts.map((i) => option(i, P.inst(i).name, dst.inst)).join('') + '</select></label>' +
          '<label class="select"><span class="select-l">Orden</span><select data-change="docs-sort">' + option('desc', 'Más recientes', dst.sort) + option('asc', 'Más antiguos', dst.sort) + '</select></label>' +
          '<div class="seg" role="group" aria-label="Vista">' +
          '<button type="button" class="seg-btn" data-action="docs-view" data-value="grid" aria-pressed="' + (P.db.docView === 'grid') + '">' + ic('grid', 18) + '<span class="sr-only">Vista en tarjetas</span></button>' +
          '<button type="button" class="seg-btn" data-action="docs-view" data-value="list" aria-pressed="' + (P.db.docView === 'list') + '">' + ic('list', 18) + '<span class="sr-only">Vista en lista</span></button>' +
          '</div></div></div>' +
          '<div class="chips" role="group" aria-label="Tipo de documento">' + kinds.map((k) =>
            '<button type="button" class="chip" data-action="docs-kind" data-value="' + k[0] + '" aria-pressed="' + (dst.kind === k[0]) + '">' + k[1] + '</button>').join('') +
          (hasImported ? '<button type="button" class="chip chip-toggle" data-action="docs-mine" aria-pressed="' + dst.mine + '">' + ic('import', 16) + 'Traídos por vos</button>' : '') +
          '</div>'
        : '') +
      '<div id="docs-results">' + docsResults() + '</div>';
    return { title: 'Documentos', html, skeleton: 'grid' };
  };
  const refreshDocs = () => { const el = document.getElementById('docs-results'); if (el) el.innerHTML = docsResults(); };
  IN['docs-q'] = (el) => { dst.q = el.value; refreshDocs(); };
  CH['docs-inst'] = (el) => { dst.inst = el.value; refreshDocs(); };
  CH['docs-sort'] = (el) => { dst.sort = el.value; refreshDocs(); };
  A['docs-kind'] = (el) => {
    dst.kind = el.dataset.value;
    document.querySelectorAll('[data-action="docs-kind"]').forEach((b) => b.setAttribute('aria-pressed', b === el));
    refreshDocs();
  };
  A['docs-mine'] = (el) => { dst.mine = !dst.mine; el.setAttribute('aria-pressed', dst.mine); refreshDocs(); };
  A['docs-view'] = (el) => {
    P.db.docView = el.dataset.value; P.save();
    document.querySelectorAll('[data-action="docs-view"]').forEach((b) => b.setAttribute('aria-pressed', b === el));
    refreshDocs();
  };
  A['docs-clear'] = () => { Object.assign(dst, { q: '', kind: 'todos', inst: 'todas', sort: 'desc', mine: false }); P.rerender(); };

  /* =====================================================================
     PERFIL
     ===================================================================== */
  const PERFIL_TABS = [['datos', 'Mis datos'], ['seguridad', 'Seguridad'], ['privacidad', 'Privacidad']];

  S.perfil = function (r) {
    const tab = PERFIL_TABS.some((t) => t[0] === r.parts[1]) ? r.parts[1] : 'datos';
    const tabs = '<div class="tabs" role="tablist" aria-label="Secciones del perfil">' + PERFIL_TABS.map((t) =>
      '<a class="tab" role="tab" href="#/perfil/' + t[0] + '" aria-selected="' + (t[0] === tab) + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>').join('') + '</div>';
    const head =
      '<header class="profile-head"><span class="avatar avatar-lg" aria-hidden="true">' + P.PATIENT.initials + '</span>' +
      '<div><h1 class="page-title" tabindex="-1">Mi perfil</h1><p class="page-sub">' + P.PATIENT.full + ' · DNI <span class="num">' + P.PATIENT.dniFmt + '</span></p></div></header>';
    const body = { datos: perfilDatos, seguridad: perfilSeguridad, privacidad: perfilPrivacidad }[tab]();
    return { title: PERFIL_TABS.find((t) => t[0] === tab)[1] + ' · Mi perfil', html: head + tabs + '<div class="tab-panel" role="tabpanel">' + body + '</div>' };
  };

  function perfilDatos() {
    const c = P.db.contact;
    return (
      '<div class="profile-grid">' +
      '<section class="card" aria-labelledby="h-datos">' + cardHead('Datos personales', null, 'h-datos') +
      '<dl class="rows">' +
      '<div class="row"><dt>Nombre completo</dt><dd>' + P.PATIENT.full + '</dd></div>' +
      '<div class="row"><dt>DNI</dt><dd class="num">' + P.PATIENT.dniFmt + '</dd></div>' +
      '<div class="row"><dt>Fecha de nacimiento</dt><dd><span class="num">' + P.fmt(P.PATIENT.birth) + '</span> <span class="muted">· ' + P.age(P.PATIENT.birth) + ' años</span></dd></div>' +
      '<div class="row"><dt>Email</dt><dd>' + P.esc(c.email) + '</dd><button type="button" class="btn btn-ghost btn-sm" data-action="edit-contact" data-field="email">Editar</button></div>' +
      '<div class="row"><dt>Teléfono</dt><dd class="num">' + P.esc(c.phone) + '</dd><button type="button" class="btn btn-ghost btn-sm" data-action="edit-contact" data-field="phone">Editar</button></div>' +
      '</dl>' +
      '<p class="muted mt-4">Tu nombre, DNI y fecha de nacimiento vienen de tu identificación. Si hay un error, avisale a tu institución de salud.</p>' +
      '</section>' +
      '<div class="stack">' +
      '<section class="card" aria-labelledby="h-lectura">' + cardHead('Tamaño del texto', null, 'h-lectura') +
      '<p class="muted">Elegí cómo preferís leer el portal. Se aplica en todas las pantallas.</p>' +
      '<div class="seg seg-lg mt-4" role="radiogroup" aria-label="Tamaño del texto">' +
      [['normal', 'Normal'], ['grande', 'Grande']].map((o) =>
        '<button type="button" role="radio" class="seg-btn" data-action="text-size" data-value="' + o[0] + '" aria-checked="' + (P.db.textSize === o[0]) + '">' +
        '<span class="' + (o[0] === 'grande' ? 'aa-lg' : 'aa') + '" aria-hidden="true">Aa</span>' + o[1] + '</button>').join('') +
      '</div></section>' +
      '<section class="card card-demo" aria-labelledby="h-demo">' + cardHead('Opciones de demostración', null, 'h-demo') +
      '<p class="muted">Solo para presentar el prototipo. No forman parte del producto.</p>' +
      '<div class="btn-col mt-4">' +
      '<button type="button" class="btn btn-secondary" data-action="demo-empty">' + ic(P.db.emptyDemo ? 'rotate-ccw' : 'folder', 18) + (P.db.emptyDemo ? 'Volver a la cuenta con datos' : 'Ver como cuenta nueva (sin estudios)') + '</button>' +
      '<button type="button" class="btn btn-ghost" data-action="demo-reset">' + ic('retry', 18) + 'Restablecer datos de la demo</button>' +
      '</div></section></div></div>'
    );
  }

  function perfilSeguridad() {
    return (
      '<div class="profile-grid">' +
      '<div class="stack">' +
      '<section class="card" aria-labelledby="h-acceso">' + cardHead('Acceso', null, 'h-acceso') +
      '<ul class="setting-list">' +
      '<li class="setting"><span class="setting-icon" aria-hidden="true">' + ic('key', 20) + '</span><div><p class="setting-name">Contraseña</p><p class="muted">Última actualización: <span class="num">' + P.fmt(P.db.passwordChanged) + '</span></p></div>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-action="change-password">Cambiar contraseña</button></li>' +
      '<li class="setting"><span class="setting-icon" aria-hidden="true">' + ic('smartphone', 20) + '</span><div><p class="setting-name">Verificación en dos pasos</p><p class="muted">Muy pronto vas a poder sumar un código por SMS o aplicación al ingresar.</p></div>' +
      P.badge('info', 'Próximamente', 'clock') + '</li>' +
      '</ul></section>' +
      '<section class="card" aria-labelledby="h-ses">' + cardHead('Sesiones activas', null, 'h-ses') +
      '<ul class="setting-list">' + P.db.sessions.map((s) =>
        '<li class="setting"><span class="setting-icon" aria-hidden="true">' + ic(s.icon, 20) + '</span><div><p class="setting-name">' + s.device + (s.current ? ' ' + P.badge('success', 'Este dispositivo') : '') + '</p><p class="muted">' + s.place + ' · ' + s.when + '</p></div>' +
        (s.current ? '' : '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="end-session" data-id="' + s.id + '">Cerrar sesión</button>') + '</li>'
      ).join('') + '</ul></section>' +
      '</div>' +
      '<section class="card" aria-labelledby="h-act">' + cardHead('Actividad reciente', null, 'h-act') +
      '<ol class="activity">' + P.db.activity.slice(0, 8).map((a) =>
        '<li><span class="activity-dot" aria-hidden="true"></span><div><p>' + P.esc(a.text) + '</p><p class="muted">' + P.esc(a.sub) + ' · <span class="num">' + P.fmtDateTime(a.at) + '</span></p></div></li>'
      ).join('') + '</ol>' +
      '<p class="muted mt-4">¿Ves algo que no reconocés? Cambiá tu contraseña y cerrá las otras sesiones.</p></section>' +
      '</div>'
    );
  }

  function perfilPrivacidad() {
    const active = P.db.shares.filter((s) => P.shareStatus(s) === 'activo');
    const past = P.db.shares.filter((s) => P.shareStatus(s) !== 'activo');
    return (
      '<div class="privacy-intro">' + ic('shield', 24) + '<div><p class="privacy-t">Vos decidís qué compartir y durante cuánto tiempo.</p><p class="muted">Acá ves quién tiene acceso a tu información y podés quitarlo cuando quieras.</p></div></div>' +
      '<div class="profile-grid">' +
      '<section class="card" aria-labelledby="h-shares">' + cardHead('Accesos compartidos', null, 'h-shares') +
      (active.length
        ? '<ul class="access-list">' + active.map(accessRow).join('') + '</ul>'
        : P.empty({ compact: true, icon: 'link', title: 'No tenés accesos activos', text: 'Para compartir, abrí un estudio y elegí «Compartir».' })) +
      (past.length ? '<h3 class="sub-h">Vencidos o revocados</h3><ul class="access-list access-list-past">' + past.map(accessRow).join('') + '</ul>' : '') +
      '</section>' +
      '<section class="card" aria-labelledby="h-auth">' + cardHead('Instituciones autorizadas', null, 'h-auth') +
      '<p class="muted">Pueden enviar información a tu historial. Quitar una autorización no borra lo que ya está guardado.</p>' +
      '<ul class="setting-list mt-2">' + P.db.authorizations.map((a) => {
        const i = P.inst(a.inst);
        return '<li class="setting">' + P.mono(a.inst, 'md') + '<div><p class="setting-name">' + i.name + '</p><p class="muted">' +
          (a.mode === 'red' ? 'Conexión institucional' : 'Autorizada por vos') + ' · desde <span class="num">' + P.fmt(a.since) + '</span></p></div>' +
          '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="remove-auth" data-id="' + a.inst + '">Quitar</button></li>';
      }).join('') + '</ul>' +
      '<a class="btn btn-secondary mt-4" href="#/traer">' + ic('plus', 18) + 'Conectar otra institución</a>' +
      '</section></div>'
    );
  }

  A['text-size'] = (el) => {
    P.db.textSize = el.dataset.value; P.save(); P.applyPrefs();
    document.querySelectorAll('[data-action="text-size"]').forEach((b) => b.setAttribute('aria-checked', b === el));
    P.toast(el.dataset.value === 'grande' ? 'Ahora el texto se ve más grande.' : 'Volviste al tamaño de texto normal.', { icon: 'type' });
  };
  A['demo-empty'] = () => {
    P.db.emptyDemo = !P.db.emptyDemo; P.ui.justImported = null; P.save();
    P.toast(P.db.emptyDemo ? 'Estás viendo la cuenta como si fuera nueva.' : 'Volviste a la cuenta con datos.', { icon: 'info' });
    location.hash = P.db.emptyDemo ? '#/estudios' : '#/inicio';
  };
  A['demo-reset'] = async () => {
    const ok = await P.confirm({ title: '¿Restablecer la demo?', text: 'Se borran los estudios que trajiste, los accesos que creaste y los cambios de perfil. Seguís con la sesión iniciada.', confirmLabel: 'Restablecer' });
    if (!ok) return;
    P.resetDemo(); P.ui.justImported = null;
    P.toast('Listo, la demo volvió a su estado inicial.');
    location.hash = '#/inicio';
  };
  A['end-session'] = async (el) => {
    const s = P.db.sessions.find((x) => x.id === el.dataset.id);
    const ok = await P.confirm({ title: '¿Cerrar esta sesión?', text: 'Se cerrará el acceso en ' + s.device + '. Para volver a entrar desde ahí, habrá que ingresar el DNI y la contraseña.', confirmLabel: 'Cerrar sesión', tone: 'danger' });
    if (!ok) return;
    P.db.sessions = P.db.sessions.filter((x) => x !== s); P.save();
    P.toast('Sesión cerrada en ' + s.device + '.');
    P.rerender();
  };
  A['remove-auth'] = async (el) => {
    const i = P.inst(el.dataset.id);
    const ok = await P.confirm({ title: '¿Quitar la autorización a ' + i.name + '?', text: 'No va a enviar información nueva a tu historial. Lo que ya está guardado se mantiene. Podés volver a conectarla cuando quieras.', confirmLabel: 'Quitar autorización', tone: 'danger' });
    if (!ok) return;
    P.db.authorizations = P.db.authorizations.filter((a) => a.inst !== i.id);
    P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Quitaste la autorización a ' + i.name, sub: 'Privacidad' });
    P.save();
    P.toast(i.name + ' ya no puede enviar información nueva.');
    P.rerender();
  };

  A['edit-contact'] = (el) => {
    const field = el.dataset.field;
    const isMail = field === 'email';
    const h = P.overlay({
      kind: 'modal', size: 'sm',
      title: isMail ? 'Editar email' : 'Editar teléfono',
      body:
        '<form id="contact-form" novalidate><div class="field"><label for="cf-v">' + (isMail ? 'Email' : 'Teléfono celular') + '</label>' +
        '<input class="input" id="cf-v" name="v" type="' + (isMail ? 'email' : 'tel') + '" value="' + P.esc(P.db.contact[field]) + '" autocomplete="' + (isMail ? 'email' : 'tel') + '" autofocus aria-describedby="cf-h cf-e">' +
        '<p class="field-hint" id="cf-h">' + (isMail ? 'Lo usamos para avisarte cuando llega un estudio nuevo.' : 'Con código de área, por ejemplo +54 9 11 5555-0142.') + '</p>' +
        '<p class="field-error" id="cf-e" hidden></p></div></form>',
      footer: '<button class="btn btn-secondary" type="button" data-ov-close>Cancelar</button><button class="btn btn-primary" type="submit" form="contact-form">Guardar</button>',
    });
    h.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = h.el.querySelector('#cf-v');
      const v = input.value.trim();
      const ok = isMail ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : v.replace(/\D/g, '').length >= 8;
      const err = h.el.querySelector('#cf-e');
      if (!ok) {
        err.hidden = false;
        err.innerHTML = ic('alert', 16) + (isMail ? 'Revisá el email: parece incompleto.' : 'Revisá el número: debe tener al menos 8 dígitos.');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      P.db.contact[field] = v; P.save(); h.close();
      P.toast(isMail ? 'Email actualizado.' : 'Teléfono actualizado.');
      P.rerender();
    });
  };

  A['change-password'] = () => {
    const h = P.overlay({
      kind: 'modal', size: 'sm', title: 'Cambiar contraseña',
      body:
        '<form id="pw-form" novalidate>' +
        '<div class="field"><label for="pw-a">Contraseña actual</label><input class="input" id="pw-a" type="password" autocomplete="current-password" autofocus></div>' +
        '<div class="field"><label for="pw-n">Nueva contraseña</label><input class="input" id="pw-n" type="password" autocomplete="new-password" aria-describedby="pw-h">' +
        '<p class="field-hint" id="pw-h">Al menos 8 caracteres. Te recomendamos combinar letras y números.</p></div>' +
        '<div class="field"><label for="pw-r">Repetí la nueva contraseña</label><input class="input" id="pw-r" type="password" autocomplete="new-password"></div>' +
        '<p class="field-error" id="pw-e" role="alert" hidden></p></form>',
      footer: '<button class="btn btn-secondary" type="button" data-ov-close>Cancelar</button><button class="btn btn-primary" type="submit" form="pw-form">Guardar contraseña</button>',
    });
    h.el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = h.el.querySelector('#pw-a').value, n = h.el.querySelector('#pw-n').value, rr = h.el.querySelector('#pw-r').value;
      const err = h.el.querySelector('#pw-e');
      const msg = !a ? 'Ingresá tu contraseña actual.' : n.length < 8 ? 'La nueva contraseña debe tener al menos 8 caracteres.' : n !== rr ? 'Las contraseñas nuevas no coinciden.' : '';
      if (msg) { err.hidden = false; err.innerHTML = ic('alert', 16) + msg; return; }
      const done = P.busy(h.el.querySelector('[form="pw-form"]'), 'Guardando…');
      await P.wait(700); done();
      P.db.passwordChanged = P.TODAY_ISO;
      P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Cambiaste tu contraseña', sub: 'Chrome en Windows' });
      P.save(); h.close();
      P.toast('Contraseña actualizada.');
      P.rerender();
    });
  };

  /* =====================================================================
     AYUDA
     ===================================================================== */
  S.ayuda = function () {
    const faq = [
      ['¿De dónde sale la información de mi portal?', 'De las instituciones de salud donde te atendés y que están conectadas o que vos autorizaste. Cada dato muestra su origen y la fecha en que se registró.'],
      ['¿Cómo traigo estudios de otro laboratorio?', 'Entrá a Estudios y tocá «Traer mis estudios». Elegís la institución, iniciás sesión en su sitio oficial y elegís qué estudios guardar. Tarda menos de un minuto.'],
      ['¿El portal guarda mi contraseña de otras instituciones?', 'No. La contraseña la escribís solo en el sitio de cada institución. El portal recibe únicamente tu autorización para buscar estudios, y podés quitarla cuando quieras.'],
      ['¿Quién puede ver mis datos?', 'Solo vos. Si compartís un estudio, elegís qué incluir y por cuánto tiempo, y podés revocar el acceso en cualquier momento desde Mi perfil → Privacidad.'],
      ['¿El portal interpreta mis resultados?', 'No. El portal organiza tu información tal como la informan las instituciones. Para entender un resultado, consultá con tu profesional de salud.'],
      ['Veo un dato incorrecto, ¿qué hago?', 'Avisale a la institución que lo registró; figura en «Origen» debajo de cada dato. Ellos pueden corregirlo en su sistema.'],
    ];
    return {
      title: 'Ayuda',
      html:
        pageHead('Ayuda', 'Respuestas a las preguntas más comunes.') +
        '<div class="help-grid"><div class="faq">' + faq.map((f, i) =>
          '<details class="faq-item"' + (i === 0 ? ' open' : '') + '><summary>' + f[0] + ic('chevron-down', 20) + '</summary><p>' + f[1] + '</p></details>').join('') + '</div>' +
        '<aside class="card help-contact"><h2 class="card-title">¿Necesitás ayuda con el portal?</h2><p class="muted mt-2">Te respondemos de lunes a viernes de 8 a 20 h.</p>' +
        '<ul class="contact-list"><li>' + ic('phone', 20) + '<span><b class="num">0800 000 0000</b><span class="muted">Línea de ayuda (demo)</span></span></li>' +
        '<li>' + ic('mail', 20) + '<span><b>ayuda@portal.ejemplo</b><span class="muted">Respondemos en el día</span></span></li></ul>' +
        '<p class="muted mt-4">Por consultas médicas, comunicate con tu institución de salud.</p></aside></div>',
    };
  };
})();
