/* Portal de Pacientes — formato, componentes reutilizables y superposiciones (modal, drawer, toast). */
(function () {
  const P = window.P;
  P.ui = P.ui || {};

  /* ---------- Formato ---------- */
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = (n) => String(n).padStart(2, '0');

  P.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  P.cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  P.toDate = (iso) => {
    if (iso instanceof Date) return iso;
    if (typeof iso !== 'string' || !iso) return new Date(NaN);
    if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) return new Date(iso);
    const [d, t] = iso.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [h, min] = (t || '0:0').split(':').map(Number);
    return new Date(y, m - 1, day || 1, h || 0, min || 0);
  };
  P.fmt = (iso) => { const d = P.toDate(iso); return Number.isNaN(d.getTime()) ? 'Sin fecha' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  P.fmtLong = (iso) => { const d = P.toDate(iso); return Number.isNaN(d.getTime()) ? 'Sin fecha' : d.getDate() + ' de ' + MONTHS[d.getMonth()] + ' de ' + d.getFullYear(); };
  P.fmtDay = (iso) => { const d = P.toDate(iso); return Number.isNaN(d.getTime()) ? { day: '—', mon: 'sin fecha' } : { day: d.getDate(), mon: MONTHS_SHORT[d.getMonth()] }; };
  P.fmtMonth = (iso) => { const d = P.toDate(iso); return Number.isNaN(d.getTime()) ? 'Sin fecha' : P.cap(MONTHS[d.getMonth()]) + ' ' + d.getFullYear(); };
  P.fmtTime = (iso) => { const d = P.toDate(iso); return Number.isNaN(d.getTime()) ? '—' : pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  P.fmtDateTime = (iso) => P.fmt(iso) + ', ' + P.fmtTime(iso) + ' h';
  P.fmtToday = () => { const d = P.TODAY; return P.cap(DAYS[d.getDay()]) + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()]; };
  P.toISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  P.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  P.age = (iso) => {
    const b = P.toDate(iso), t = P.TODAY;
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a;
  };
  P.fromNow = (iso) => {
    const days = Math.round((P.toDate(iso) - P.TODAY) / 86400000);
    if (days <= 0) return 'hoy';
    if (days === 1) return 'mañana';
    return 'en ' + days + ' días';
  };
  P.fmtDni = (digits) => digits.replace(/\D/g, '').slice(0, 8).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /* ---------- Componentes ---------- */
  P.TYPES = {
    laboratorio: { label: 'Laboratorio', icon: 'flask', cls: 'ty-lab' },
    imagenes: { label: 'Imágenes', icon: 'scan', cls: 'ty-img' },
    otros: { label: 'Otros estudios', icon: 'activity', cls: 'ty-otr' },
  };

  P.mono = (id, size) => {
    const i = P.inst(id);
    const sz = size || 'sm';
    if (i.id === 'yo') return '<span class="mono mono-' + sz + ' t-self" aria-hidden="true">' + P.icon('user', sz === 'lg' ? 20 : 14) + '</span>';
    return '<span class="mono mono-' + sz + ' t-' + i.tone + '" aria-hidden="true">' + i.mono + '</span>';
  };
  P.instBadge = (id, size) => '<span class="inst">' + P.mono(id, size) + '<span class="inst-name">' + P.esc(P.inst(id).name) + '</span></span>';

  /* Procedencia: quién aportó el dato y cuándo. Presente en todo el producto. */
  P.prov = (id, date, verb) =>
    '<p class="prov"><span class="prov-k">Origen</span>' + P.instBadge(id) +
    (date ? '<span class="prov-sep" aria-hidden="true"></span><span>' + (verb || 'Registrado') + ' el <span class="num">' + P.fmt(date) + '</span></span>' : '') +
    '</p>';

  P.badge = (tone, text, icon) => '<span class="badge b-' + tone + '">' + (icon ? P.icon(icon, 16) : '') + '<span>' + text + '</span></span>';

  P.studyStatus = (s) => {
    if (s.status === 'pendiente') return P.badge('warning', 'Resultado pendiente', 'clock');
    if (s.isNew) return P.badge('new', 'Nuevo', 'sparkle');
    return '';
  };

  P.typeTile = (type, size) => {
    const t = P.TYPES[type] || P.TYPES.otros;
    return '<span class="ty ' + t.cls + (size === 'lg' ? ' ty-lg' : '') + '" aria-hidden="true">' + P.icon(t.icon, size === 'lg' ? 26 : 22) + '</span>';
  };

  P.studyRow = (s) => {
    const t = P.TYPES[s.type];
    const extra = s.results ? P.plural(s.results.length, 'valor', 'valores') : s.images ? P.plural(s.images, 'imagen', 'imágenes') : s.status === 'pendiente' ? 'En proceso' : '';
    return (
      '<li><a class="study" href="#/estudios/' + s.id + '">' +
      P.typeTile(s.type) +
      '<span class="study-main"><span class="study-name">' + P.esc(s.name) + '</span>' +
      '<span class="study-meta">' + t.label + (extra ? ' · ' + extra : '') + '</span>' +
      '<span class="study-meta-m">' + P.esc(P.inst(s.inst).name) + ' · <span class="num">' + P.fmt(s.date) + '</span></span></span>' +
      '<span class="study-inst">' + P.instBadge(s.inst) + '</span>' +
      '<span class="study-date num">' + P.fmt(s.date) + '</span>' +
      '<span class="study-status">' + P.studyStatus(s) + '</span>' +
      P.icon('chevron-right', 20, 'chev') +
      '</a></li>'
    );
  };

  /* Variante compacta (Inicio): nombre + tipo + institución, a la derecha fecha y estado. */
  P.studyRowCompact = (s) =>
    '<li><a class="study-c" href="#/estudios/' + s.id + '">' + P.typeTile(s.type) +
    '<span class="study-main"><span class="study-name">' + P.esc(s.name) + '</span>' +
    '<span class="study-c-meta">' + P.TYPES[s.type].label + '<span class="prov-sep" aria-hidden="true"></span>' + P.instBadge(s.inst) + '</span></span>' +
    '<span class="study-c-right"><span class="num">' + P.fmt(s.date) + '</span>' + P.studyStatus(s) + '</span>' +
    P.icon('chevron-right', 20, 'chev') + '</a></li>';

  P.medRow = (m, compact) =>
    '<li class="med' + (compact ? ' med-compact' : '') + '">' +
    '<span class="ty ty-med" aria-hidden="true">' + P.icon('pill', 22) + '</span>' +
    '<div class="med-main"><p class="med-name">' + P.esc(m.name) + ' <span class="med-dose">' + P.esc(m.dose) + '</span></p>' +
    '<p class="med-how">' + P.esc(m.how) + '</p>' +
    (compact ? '' :
      '<dl class="facts">' +
      '<div><dt>' + (m.status === 'activa' ? 'Desde' : 'Período') + '</dt><dd class="num">' + P.fmt(m.start) + (m.end ? ' – ' + P.fmt(m.end) : '') + '</dd></div>' +
      '<div><dt>Indicado por</dt><dd>' + P.esc(m.by) + '</dd></div></dl>' +
      P.prov(m.inst, m.start)) +
    '</div>' +
    (compact ? '' : '<span class="med-status">' + (m.status === 'activa' ? P.badge('success', 'Activa', 'check') : P.badge('neutral', 'Finalizada', 'clock')) + '</span>') +
    '</li>';

  P.empty = (o) =>
    '<div class="empty' + (o.compact ? ' empty-compact' : '') + '">' +
    '<div class="empty-art" aria-hidden="true">' + P.icon(o.icon || 'folder', 28) + '</div>' +
    '<h3 class="empty-title">' + o.title + '</h3>' +
    (o.text ? '<p class="empty-text">' + o.text + '</p>' : '') +
    (o.action ? '<div class="empty-actions">' + o.action + '</div>' : '') +
    '</div>';

  /* Miniatura de documento (vista previa de "PDF"). */
  P.paper = (d, big) => {
    const i = P.inst(d.inst);
    if (d.isImage) {
      return '<span class="paper paper-img' + (big ? ' paper-big' : '') + '" aria-hidden="true"><span class="paper-scan"></span><span class="paper-tag">' + i.mono + '</span></span>';
    }
    return (
      '<span class="paper t-' + i.tone + (big ? ' paper-big' : '') + '" aria-hidden="true">' +
      '<span class="paper-band"></span>' +
      '<span class="paper-head"><span class="paper-mono">' + i.mono + '</span><span class="bar w50"></span></span>' +
      '<span class="bar w80"></span><span class="bar w60"></span>' +
      '<span class="paper-rows"><span class="bar w90"></span><span class="bar w70"></span><span class="bar w90"></span><span class="bar w60"></span><span class="bar w80"></span></span>' +
      '</span>'
    );
  };

  /* Hoja completa del documento (visor). Contenido de demostración. */
  P.sheet = (d) => {
    const i = P.inst(d.inst);
    const s = d.studyId ? P.study(d.studyId) : null;
    let body = '';
    if (s && s.results) {
      body =
        '<table class="sheet-table"><thead><tr><th>Determinación</th><th>Resultado</th><th>Unidad</th><th>Valores de referencia</th></tr></thead><tbody>' +
        s.results.map((r) => '<tr><td>' + r[0] + '</td><td class="num"><b>' + r[1] + '</b></td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') +
        '</tbody></table>';
    } else if (s) {
      body =
        '<div class="sheet-images">' + Array.from({ length: Math.min(s.images || 1, 4) }, () => '<span class="sheet-img"></span>').join('') + '</div>' +
        '<p class="sheet-label">Informe</p><div class="sheet-lines"><span></span><span></span><span class="short"></span><span></span><span class="short"></span></div>';
    } else {
      body = '<p class="sheet-label">' + P.esc(P.DOC_KINDS[d.kind] || 'Documento') + '</p><div class="sheet-lines"><span></span><span class="short"></span><span></span><span></span><span class="short"></span></div>';
    }
    return (
      '<article class="sheet t-' + i.tone + '">' +
      '<header class="sheet-head"><span class="sheet-mono">' + i.mono + '</span><div><p class="sheet-inst">' + P.esc(i.name) + '</p><p class="sheet-kind">' + P.esc(i.kind) + ' · Documento de demostración</p></div></header>' +
      '<h2 class="sheet-title">' + P.esc(d.title) + '</h2>' +
      '<dl class="sheet-meta"><div><dt>Paciente</dt><dd>' + P.PATIENT.full + '</dd></div><div><dt>DNI</dt><dd class="num">' + P.PATIENT.dniFmt + '</dd></div>' +
      '<div><dt>Fecha</dt><dd class="num">' + P.fmt(d.date) + '</dd></div>' +
      (s ? '<div><dt>Protocolo</dt><dd class="num">' + s.protocol + '</dd></div><div><dt>Solicitado por</dt><dd>' + P.esc(s.requestedBy) + '</dd></div>' : d.by ? '<div><dt>Emitido por</dt><dd>' + P.esc(d.by) + '</dd></div>' : '') +
      '</dl>' + body +
      '<footer class="sheet-foot">Documento emitido por ' + P.esc(i.name) + '. Contenido ficticio para demostración.</footer>' +
      '<span class="sheet-water" aria-hidden="true">DEMO</span>' +
      '</article>'
    );
  };

  /* ---------- Toast ---------- */
  P.toast = function (text, opts) {
    const o = opts || {};
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (o.tone ? ' toast-' + o.tone : '');
    el.setAttribute('role', 'status');
    el.innerHTML = P.icon(o.icon || 'check', 20) + '<span>' + text + '</span>';
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 260);
    }, o.duration || 3600);
  };

  /* ---------- Superposiciones ---------- */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const stack = [];
  let uid = 0;

  P.overlay = function (o) {
    const id = 'ov-' + ++uid;
    const kind = o.kind || 'modal';
    const wrap = document.createElement('div');
    wrap.className = 'ov ov-' + kind + (o.size ? ' ov-' + o.size : '') + (o.className ? ' ' + o.className : '');
    wrap.innerHTML =
      '<div class="ov-backdrop" data-ov-close></div>' +
      '<div class="ov-panel" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t">' +
      '<header class="ov-head"><h2 class="ov-title" id="' + id + '-t">' + o.title + '</h2>' +
      (o.headActions || '') +
      '<button class="icon-btn" type="button" data-ov-close aria-label="Cerrar">' + P.icon('x', 22) + '</button></header>' +
      '<div class="ov-body"></div>' +
      '<footer class="ov-foot"' + (o.footer ? '' : ' hidden') + '></footer>' +
      '</div>';
    const handle = {
      el: wrap,
      body: wrap.querySelector('.ov-body'),
      foot: wrap.querySelector('.ov-foot'),
      returnFocus: document.activeElement,
      setBody(html) { handle.body.innerHTML = html; },
      setFoot(html) { handle.foot.innerHTML = html || ''; handle.foot.hidden = !html; },
      setTitle(t) { wrap.querySelector('.ov-title').innerHTML = t; },
      close(result) {
        if (handle.closed) return;
        handle.closed = true;
        wrap.classList.remove('is-open');
        const i = stack.indexOf(handle);
        if (i > -1) stack.splice(i, 1);
        if (!stack.length) document.documentElement.classList.remove('is-locked');
        setTimeout(() => wrap.remove(), 300);
        if (handle.returnFocus && document.contains(handle.returnFocus)) handle.returnFocus.focus();
        if (o.onClose) o.onClose(result);
      },
      focusFirst() {
        const target = wrap.querySelector('[autofocus]') || wrap.querySelector('.ov-body ' + FOCUSABLE) || wrap.querySelector(FOCUSABLE);
        if (target) target.focus();
      },
    };
    handle.setBody(o.body || '');
    if (o.footer) handle.setFoot(o.footer);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-ov-close]')) handle.close();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); handle.close(); }
      if (e.key === 'Tab') {
        const f = Array.from(wrap.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.getElementById('overlay-root').appendChild(wrap);
    document.documentElement.classList.add('is-locked');
    stack.push(handle);
    requestAnimationFrame(() => {
      wrap.classList.add('is-open');
      handle.focusFirst();
    });
    if (o.onOpen) o.onOpen(handle);
    return handle;
  };
  P.closeAllOverlays = () => stack.slice().forEach((h) => h.close());

  P.confirm = function (o) {
    return new Promise((resolve) => {
      let answered = false;
      const h = P.overlay({
        kind: 'modal',
        size: 'sm',
        title: o.title,
        body: '<p class="ov-text">' + o.text + '</p>',
        footer:
          '<button class="btn btn-secondary" type="button" data-ov-close>' + (o.cancelLabel || 'Cancelar') + '</button>' +
          '<button class="btn ' + (o.tone === 'danger' ? 'btn-danger' : 'btn-primary') + '" type="button" data-confirm>' + o.confirmLabel + '</button>',
        onClose: () => { if (!answered) resolve(false); },
      });
      h.foot.querySelector('[data-confirm]').addEventListener('click', () => { answered = true; resolve(true); h.close(); });
      setTimeout(() => h.foot.querySelector('[data-confirm]').focus(), 60);
    });
  };

  /* Botón con estado de carga */
  P.busy = function (btn, label) {
    btn.disabled = true;
    btn.dataset.label = btn.innerHTML;
    btn.classList.add('is-busy');
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>' + label + '</span>';
    return () => { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = btn.dataset.label; };
  };

  P.wait = (ms) => new Promise((r) => setTimeout(r, P.reducedMotion() ? Math.min(ms, 250) : ms));
  P.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  P.instSub = (i) => i.kind + (i.city ? ' · ' + i.city : '');

  /* Metadatos del archivo: los PDF traídos por el agente no traen cantidad de páginas. */
  P.fileMeta = (d) => 'PDF' + (d.pages ? ' · ' + P.plural(d.pages, 'página', 'páginas') : '') + (d.size ? ' · ' + d.size : '');

  P.download = function (d) {
    const name = d.title.replace(/[^\wÁÉÍÓÚáéíóúñÑ ]+/g, '').trim().replace(/\s+/g, '_') + '_' + P.fmt(d.date).replace(/\//g, '-') + '.pdf';
    if (!d.file) {
      P.toast('Descarga iniciada · <span class="num">' + P.esc(name) + '</span>', { icon: 'download' });
      return;
    }
    // Documento real (traído con el agente): se descarga el PDF original guardado en este dispositivo.
    P.files.get(d.file.key).then((blob) => {
      if (!blob) throw new Error('missing');
      P.saveBlob(blob, name);
      P.toast('Descarga iniciada · <span class="num">' + P.esc(name) + '</span>', { icon: 'download' });
    }).catch(() => P.toast('El archivo no está guardado en este dispositivo.', { icon: 'alert', tone: 'danger' }));
  };
})();
