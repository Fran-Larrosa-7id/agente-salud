// Panel profesional — Prescripción y Órdenes Digitales (prototipo, sin backend ni lógica clínica).
(function () {
  const S = window.RxStore;
  const R = window.RxSheet;
  const esc = R.esc;
  const view = document.getElementById('view');
  const params = new URLSearchParams(location.search);
  const EMBED = params.get('embed') === '1';
  if (EMBED) document.body.classList.add('is-embed');

  const SESSION_PATIENT = 'rx-current-patient';
  const SESSION_ORIGIN = 'rx-origin';

  function ss(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
    } catch (_) { /* sin sessionStorage */ }
    return null;
  }

  let currentPatientId = params.get('paciente') || ss(SESSION_PATIENT) || 'maria';
  if (!S.patient(currentPatientId)) currentPatientId = 'maria';
  ss(SESSION_PATIENT, currentPatientId);
  // El vínculo con la atención dura mientras se navega desde ahí; entrar directo al panel lo limpia
  ss(SESSION_ORIGIN, params.get('origen') === 'horus' ? 'horus' : null);
  let origin = params.get('origen') === 'horus' ? 'horus' : '';

  let historyFilter = 'todas';
  let historyQuery = '';
  let composer = null; // { draft, dirty }

  // ---------- íconos (trazo Lucide, 1.9) ----------
  const I = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowR: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4-4"/>',
    pill: '<path d="M10.5 20.5 20.5 10.5a4.95 4.95 0 1 0-7-7L3.5 13.5a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    order: '<path d="M9 3h6v3H9z"/><path d="M16 4.5h2a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2"/><path d="M9 12h6M9 16h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    steth: '<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-3"/><circle cx="20" cy="11" r="2"/>',
  };
  function ic(name, size) {
    return '<svg aria-hidden="true" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + I[name] + '</svg>';
  }

  // ---------- toast ----------
  function toast(message) {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg><span></span>';
    el.querySelector('span').textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => { el.classList.remove('is-visible'); setTimeout(() => el.remove(), 250); }, 2800);
  }

  // ---------- helpers ----------
  function patientLine(p) {
    return S.ageFrom(p.birthISO) + ' años · DNI ' + p.dni + ' · ' + (p.coverage === 'Particular' ? 'Particular' : p.coverage + (p.plan ? ' ' + p.plan : ''));
  }
  function firstName(p) { return p.name.split(' ')[0]; }
  function kindNoun(d) { return d.kind === 'receta' ? 'prescripción' : 'orden'; }
  function isOwnDraft(d) { return d.status === 'borrador' && d.professionalId === S.CURRENT_PROFESSIONAL; }
  function portalHref(d) { return '../app-mobile-pacientes/index.html#recetas' + (d ? '/' + encodeURIComponent(d.id) : ''); }

  function focusHeading() {
    const h = view.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function setNav(section) {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function originBanner() {
    if (origin !== 'horus') return '';
    return '<p class="rx-origin">' + ic('steth', 16) + '<span>Iniciado desde la atención en <b>Horus</b></span><a href="consulta.html">Volver a la atención</a></p>';
  }

  // ---------- combobox accesible (paciente y medicamento) ----------
  function combobox({ input, list, items, onSelect }) {
    let active = -1;
    let current = [];
    function open() {
      current = items(input.value);
      list.innerHTML = current.length
        ? current.map((it, i) => '<li role="option" id="' + list.id + '-o' + i + '" data-i="' + i + '" aria-selected="false">' + it.html + '</li>').join('')
        : '<li class="rx-combo-empty" role="presentation">Sin resultados. Probá con otro nombre o número.</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function move(delta) {
      if (list.hidden) open();
      if (!current.length) return;
      active = (active + delta + current.length) % current.length;
      list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      const li = list.querySelector('#' + list.id + '-o' + active);
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
    function pick(i) {
      const it = current[i];
      if (!it) return;
      close();
      onSelect(it.id);
    }
    input.addEventListener('input', open);
    input.addEventListener('focus', open);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { if (!list.hidden && active >= 0) { e.preventDefault(); pick(active); } else if (!list.hidden && current.length === 1) { e.preventDefault(); pick(0); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]');
      if (li) pick(Number(li.dataset.i));
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    return { open, close };
  }

  // =====================================================================
  // Vista: Paciente
  // =====================================================================
  function docRow(d) {
    const key = S.statusOf(d);
    const pro = S.professional(d.professionalId);
    const action = isOwnDraft(d)
      ? '<a class="btn btn-secondary btn-sm" href="#/editar/' + esc(d.id) + '">Continuar</a>'
      : '<button class="btn btn-secondary btn-sm" type="button" data-view="' + esc(d.id) + '">Ver<span class="visually-hidden"> ' + esc(S.kindShort(d) + ' ' + (d.number || '')) + '</span></button>';
    return '<tr>'
      + '<td data-label="Documento"><span class="rx-doc-kind">' + ic(d.kind === 'receta' ? 'pill' : 'order', 15) + esc(S.kindShort(d)) + '</span><span class="rx-doc-head">' + esc(S.headline(d)) + '</span>' + (d.number ? '<span class="rx-doc-num num">' + esc(d.number) + '</span>' : '') + '</td>'
      + '<td data-label="Fecha" class="num">' + esc(S.fmtDate(d.dateISO)) + '</td>'
      + '<td data-label="Profesional">' + esc(pro ? pro.name : '') + '</td>'
      + '<td data-label="Estado">' + R.statusTag(d, 'pro') + '</td>'
      + '<td data-label="Vence" class="num">' + (key === 'borrador' || key === 'anulada' ? '<span class="rx-muted">—</span>' : esc(S.fmtDate(d.expiresISO))) + '</td>'
      + '<td class="rx-td-action">' + action + '</td>'
      + '</tr>';
  }

  function docTable(docs, caption) {
    return '<div class="rx-table-wrap"><table class="rx-table">'
      + '<caption class="visually-hidden">' + esc(caption) + '</caption>'
      + '<thead><tr><th scope="col">Documento</th><th scope="col">Fecha</th><th scope="col">Profesional</th><th scope="col">Estado</th><th scope="col">Vence</th><th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead>'
      + '<tbody>' + docs.map(docRow).join('') + '</tbody></table></div>';
  }

  function renderPaciente() {
    setNav('paciente');
    const p = S.patient(currentPatientId);
    const docs = S.docsForPatient(p.id);
    view.innerHTML = ''
      + '<section class="rx-find" aria-label="Buscar paciente">'
      + '<label class="rx-find-label" for="patientSearch">Buscar paciente</label>'
      + '<div class="rx-combo">' + ic('search', 18)
      + '<input class="input" id="patientSearch" type="search" placeholder="Nombre o DNI" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="patientList" aria-autocomplete="list">'
      + '<ul class="rx-combo-list" id="patientList" tabindex="-1" role="listbox" aria-label="Pacientes" hidden></ul></div>'
      + '</section>'
      + '<section class="rx-patient" aria-labelledby="patientName">'
      + '<div class="rx-patient-id"><p class="rx-eyebrow">Paciente actual</p><h1 class="rx-patient-name" id="patientName">' + esc(p.name) + '</h1><p class="rx-patient-meta num">' + esc(patientLine(p)) + '</p></div>'
      + '<div class="rx-patient-actions">'
      + '<a class="btn btn-primary" href="#/nueva/receta">' + ic('plus', 18) + 'Nueva prescripción</a>'
      + '<a class="btn btn-secondary" href="#/nueva/orden">' + ic('plus', 18) + 'Nueva orden</a>'
      + '</div></section>'
      + '<section class="rx-block" aria-labelledby="recentTitle">'
      + '<div class="rx-block-head"><h2 id="recentTitle">Documentos recientes</h2><a class="rx-link" href="#/historial">Ver historial</a></div>'
      + (docs.length
        ? docTable(docs, 'Documentos de ' + p.name)
        : '<div class="rx-empty"><p class="rx-empty-title">Sin documentos para ' + esc(firstName(p)) + '</p><p>Las prescripciones y órdenes que emitas aparecerán acá.</p></div>')
      + '</section>';

    const input = document.getElementById('patientSearch');
    combobox({
      input,
      list: document.getElementById('patientList'),
      items: (q) => S.searchPatients(q).map((pt) => ({ id: pt.id, html: '<b>' + esc(pt.name) + '</b><span class="num">DNI ' + esc(pt.dni) + ' · ' + esc(pt.coverage) + '</span>' })),
      onSelect: (id) => {
        currentPatientId = id;
        ss(SESSION_PATIENT, id);
        renderPaciente();
        toast('Paciente seleccionado: ' + S.patient(id).name);
        document.getElementById('patientName').focus();
      },
    });
    bindViewButtons();
  }

  function bindViewButtons() {
    view.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.view, b)));
  }

  // =====================================================================
  // Vista: composición (prescripción u orden)
  // =====================================================================
  function newDraft(kind) {
    const base = { id: '', kind, patientId: currentPatientId, professionalId: S.CURRENT_PROFESSIONAL, dateISO: S.todayISO(), instructions: '', source: origin === 'horus' ? 'horus' : 'panel' };
    if (kind === 'receta') return { ...base, med: null, dose: '', frequency: '', duration: { value: '', unit: 'días' }, quantity: 1, notes: '' };
    return { ...base, orderType: 'imagenes', service: '', reason: '', priority: 'habitual' };
  }

  function errorLine(id, text) {
    return '<p class="rx-error" id="' + id + '" hidden>' + ic('alert', 15) + '<span>' + esc(text) + '</span></p>';
  }

  function recetaFields(d) {
    const presentations = d.med ? (S.MED_CATALOG.find((m) => m.id === d.med.id)?.presentations || []) : [];
    return ''
      + '<fieldset class="rx-group"><legend><span class="rx-step num">1</span>Medicamento</legend>'
      + '<div class="rx-med-pick"' + (d.med ? ' hidden' : '') + '>'
      + '<label class="field-label" for="medSearch">Buscar en el catálogo</label>'
      + '<div class="rx-combo">' + ic('search', 18) + '<input class="input" id="medSearch" type="search" placeholder="Ej.: Demo A" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="medList" aria-autocomplete="list" aria-describedby="medHelp medErr"><ul class="rx-combo-list" id="medList" tabindex="-1" role="listbox" aria-label="Medicamentos" hidden></ul></div>'
      + '<p class="field-hint" id="medHelp">Catálogo de demostración: nombres ficticios, sin dosis sugeridas.</p>'
      + errorLine('medErr', 'Elegí un medicamento del catálogo.')
      + '</div>'
      + '<div class="rx-med-picked"' + (d.med ? '' : ' hidden') + '>'
      + '<div class="rx-med-row"><span class="rx-med-ic">' + ic('pill', 18) + '</span><span class="rx-med-txt"><b id="medName">' + (d.med ? esc(d.med.name + ' ' + d.med.strength) : '') + '</b><small id="medForm">' + (d.med ? esc(d.med.form) : '') + '</small></span><button class="btn btn-ghost btn-sm" type="button" id="medChange">Cambiar</button></div>'
      + '<div class="field"><label class="field-label" for="medPresentation">Presentación</label><select class="select" id="medPresentation">' + presentations.map((pr) => '<option' + (d.med && d.med.presentation === pr ? ' selected' : '') + '>' + esc(pr) + '</option>').join('') + '</select></div>'
      + '</div>'
      + '</fieldset>'
      + '<fieldset class="rx-group"><legend><span class="rx-step num">2</span>Cómo usarlo</legend>'
      + '<div class="rx-row">'
      + '<div class="field"><label class="field-label" for="fDose">Dosis</label><input class="input" id="fDose" value="' + esc(d.dose) + '" placeholder="Ej.: 1 comprimido" aria-describedby="doseErr">' + errorLine('doseErr', 'Indicá la dosis.') + '</div>'
      + '<div class="field"><label class="field-label" for="fFreq">Frecuencia</label><select class="select" id="fFreq" aria-describedby="freqErr"><option value="">Elegí una opción</option>' + S.FREQUENCIES.map((f) => '<option' + (d.frequency === f ? ' selected' : '') + '>' + esc(f) + '</option>').join('') + '</select>' + errorLine('freqErr', 'Elegí la frecuencia.') + '</div>'
      + '</div></fieldset>'
      + '<fieldset class="rx-group"><legend><span class="rx-step num">3</span>Cantidad y duración</legend>'
      + '<div class="rx-row">'
      + '<div class="field"><label class="field-label" for="fDur">Duración</label><div class="rx-inline"><input class="input num" id="fDur" type="number" min="1" max="365" inputmode="numeric" value="' + esc(d.duration.value) + '" placeholder="7" aria-describedby="durErr"><label class="visually-hidden" for="fDurUnit">Unidad</label><select class="select" id="fDurUnit"><option' + (d.duration.unit === 'días' ? ' selected' : '') + '>días</option><option' + (d.duration.unit === 'semanas' ? ' selected' : '') + '>semanas</option><option' + (d.duration.unit === 'meses' ? ' selected' : '') + '>meses</option></select></div>' + errorLine('durErr', 'Indicá la duración.') + '</div>'
      + '<div class="field"><label class="field-label" for="fQty">Cantidad <small>(envases)</small></label><input class="input num" id="fQty" type="number" min="1" max="9" inputmode="numeric" value="' + esc(d.quantity) + '" aria-describedby="qtyErr">' + errorLine('qtyErr', 'Indicá al menos 1 envase.') + '</div>'
      + '</div></fieldset>'
      + '<fieldset class="rx-group"><legend><span class="rx-step num">4</span>Indicaciones</legend>'
      + '<div class="field"><label class="field-label" for="fInstr">Indicaciones para el paciente</label><textarea class="textarea" id="fInstr" rows="3" placeholder="Ej.: Tomar según indicación médica." aria-describedby="instrHelp">' + esc(d.instructions) + '</textarea><p class="field-hint" id="instrHelp">El paciente las ve en su Portal.</p></div>'
      + '<div class="field"><label class="field-label" for="fNotes">Observaciones <small>(opcional)</small></label><textarea class="textarea" id="fNotes" rows="2" aria-describedby="notesHelp">' + esc(d.notes) + '</textarea><p class="field-hint" id="notesHelp">Uso interno. No se muestran al paciente.</p></div>'
      + '</fieldset>';
  }

  function ordenFields(d) {
    const type = S.ORDER_TYPES[d.orderType];
    return ''
      + '<fieldset class="rx-group"><legend><span class="rx-step num">1</span>Tipo de orden</legend>'
      + '<div class="rx-types" role="radiogroup" aria-label="Tipo de orden">'
      + Object.keys(S.ORDER_TYPES).map((k) => '<label class="rx-type"><input type="radio" name="orderType" value="' + k + '"' + (d.orderType === k ? ' checked' : '') + '><span>' + esc(S.ORDER_TYPES[k].label) + '</span></label>').join('')
      + '</div><p class="field-hint">Tipos configurables por la institución.</p></fieldset>'
      + '<fieldset class="rx-group"><legend><span class="rx-step num">2</span>Solicitud</legend>'
      + '<div class="field"><label class="field-label" for="fService">Prestación o estudio solicitado</label><input class="input" id="fService" list="serviceList" value="' + esc(d.service) + '" placeholder="' + esc(type && type.examples[0] ? 'Ej.: ' + type.examples[0] : 'Describí la prestación') + '" autocomplete="off" aria-describedby="serviceHelp serviceErr"><datalist id="serviceList">' + (type ? type.examples.map((x) => '<option value="' + esc(x) + '">').join('') : '') + '</datalist><p class="field-hint" id="serviceHelp">Sugerencias de ejemplo de la demo. Podés escribir otra.</p>' + errorLine('serviceErr', 'Indicá la prestación o el estudio.') + '</div>'
      + '<div class="field"><span class="field-label" id="prioLabel">Prioridad</span><div class="rx-seg" role="radiogroup" aria-labelledby="prioLabel">'
      + '<label><input type="radio" name="priority" value="habitual"' + (d.priority !== 'preferente' ? ' checked' : '') + '><span>Habitual</span></label>'
      + '<label><input type="radio" name="priority" value="preferente"' + (d.priority === 'preferente' ? ' checked' : '') + '><span>Preferente</span></label>'
      + '</div><p class="field-hint">Preferente: la institución lo tiene en cuenta al asignar el turno.</p></div>'
      + '</fieldset>'
      + '<fieldset class="rx-group"><legend><span class="rx-step num">3</span>Indicaciones</legend>'
      + '<div class="field"><label class="field-label" for="fInstr">Indicaciones para el paciente</label><textarea class="textarea" id="fInstr" rows="3" placeholder="Ej.: Presentar esta orden en la recepción de imágenes." aria-describedby="instrHelp">' + esc(d.instructions) + '</textarea><p class="field-hint" id="instrHelp">El paciente las ve en su Portal.</p></div>'
      + '<div class="field"><label class="field-label" for="fReason">Motivo u observaciones <small>(opcional)</small></label><textarea class="textarea" id="fReason" rows="2" aria-describedby="reasonHelp">' + esc(d.reason) + '</textarea><p class="field-hint" id="reasonHelp">Para el equipo que realiza la prestación. No se muestra al paciente.</p></div>'
      + '</fieldset>';
  }

  function renderComposer(draft) {
    setNav('paciente');
    composer = { draft, dirty: false };
    const p = S.patient(draft.patientId);
    const isReceta = draft.kind === 'receta';
    const title = draft.id ? (isReceta ? 'Editar prescripción' : 'Editar orden') : (isReceta ? 'Nueva prescripción' : 'Nueva orden');
    view.innerHTML = ''
      + originBanner()
      + '<div class="rx-page-head">'
      + '<a class="rx-back" href="#/paciente">' + ic('arrowL', 16) + esc(p.name) + '</a>'
      + '<h1>' + title + '</h1>'
      + '<p class="rx-page-sub">' + (draft.duplicatedFrom ? 'Borrador creado a partir de ' + esc(draft.duplicatedFrom) + '. El original no cambia. ' : '') + 'Para <b>' + esc(p.name) + '</b> · <span class="num">' + esc(patientLine(p)) + '</span></p>'
      + '</div>'
      + '<div class="rx-compose">'
      + '<form class="rx-form" id="composeForm" novalidate>'
      + '<div class="rx-date field"><label class="field-label" for="fDate">Fecha del documento</label><input class="input num" id="fDate" type="date" value="' + esc(draft.dateISO) + '" min="' + S.todayISO() + '" max="' + S.addDaysISO(S.todayISO(), 30) + '"></div>'
      + (isReceta ? recetaFields(draft) : ordenFields(draft))
      + '<div class="rx-form-foot">'
      + '<button class="btn btn-secondary" type="button" id="saveDraft">Guardar borrador</button>'
      + '<button class="btn btn-primary" type="submit">' + (isReceta ? 'Revisar prescripción' : 'Revisar orden') + ic('arrowR', 18) + '</button>'
      + '</div>'
      + '</form>'
      + '<aside class="rx-preview" aria-labelledby="previewTitle">'
      + '<div class="rx-preview-head"><h2 class="rx-eyebrow" id="previewTitle">Vista previa</h2><span class="rx-preview-hint">Se actualiza mientras completás</span></div>'
      + '<div id="previewSheet"></div>'
      + '</aside>'
      + '</div>';

    const form = document.getElementById('composeForm');
    const preview = document.getElementById('previewSheet');
    const renderPreview = () => { preview.innerHTML = R.render({ ...composer.draft, status: 'borrador' }, { audience: 'pro' }); };

    function readForm() {
      const d = composer.draft;
      d.dateISO = document.getElementById('fDate').value || S.todayISO();
      d.instructions = document.getElementById('fInstr').value.trim();
      if (isReceta) {
        if (d.med) d.med.presentation = document.getElementById('medPresentation').value;
        d.dose = document.getElementById('fDose').value.trim();
        d.frequency = document.getElementById('fFreq').value;
        d.duration = { value: document.getElementById('fDur').value ? Number(document.getElementById('fDur').value) : '', unit: document.getElementById('fDurUnit').value };
        d.quantity = document.getElementById('fQty').value ? Number(document.getElementById('fQty').value) : '';
        d.notes = document.getElementById('fNotes').value.trim();
      } else {
        d.orderType = (form.querySelector('[name="orderType"]:checked') || {}).value || 'otra';
        d.service = document.getElementById('fService').value.trim();
        d.priority = (form.querySelector('[name="priority"]:checked') || {}).value || 'habitual';
        d.reason = document.getElementById('fReason').value.trim();
      }
    }

    form.addEventListener('input', (e) => {
      composer.dirty = true;
      readForm();
      renderPreview();
      const invalid = e.target.getAttribute('aria-invalid') === 'true';
      if (invalid) clearError(e.target);
    });
    form.addEventListener('change', (e) => {
      composer.dirty = true;
      readForm();
      if (!isReceta && e.target.name === 'orderType') {
        const type = S.ORDER_TYPES[composer.draft.orderType];
        document.getElementById('serviceList').innerHTML = type.examples.map((x) => '<option value="' + esc(x) + '">').join('');
        document.getElementById('fService').placeholder = type.examples[0] ? 'Ej.: ' + type.examples[0] : 'Describí la prestación';
      }
      renderPreview();
    });

    if (isReceta) {
      const pickBox = form.querySelector('.rx-med-pick');
      const pickedBox = form.querySelector('.rx-med-picked');
      const medInput = document.getElementById('medSearch');
      combobox({
        input: medInput,
        list: document.getElementById('medList'),
        items: (q) => S.searchMeds(q).map((m) => ({ id: m.id, html: '<b>' + esc(m.name) + '</b><span>' + esc(m.strength + ' · ' + m.form) + '</span>' })),
        onSelect: (id) => {
          const m = S.MED_CATALOG.find((x) => x.id === id);
          composer.draft.med = { id: m.id, name: m.name, strength: m.strength, form: m.form, presentation: m.presentations[0] };
          composer.dirty = true;
          document.getElementById('medName').textContent = m.name + ' ' + m.strength;
          document.getElementById('medForm').textContent = m.form;
          document.getElementById('medPresentation').innerHTML = m.presentations.map((pr) => '<option>' + esc(pr) + '</option>').join('');
          clearError(medInput);
          pickBox.hidden = true;
          pickedBox.hidden = false;
          renderPreview();
          document.getElementById('fDose').focus();
        },
      });
      document.getElementById('medChange').addEventListener('click', () => {
        pickedBox.hidden = true;
        pickBox.hidden = false;
        medInput.value = '';
        medInput.focus();
      });
    }

    document.getElementById('saveDraft').addEventListener('click', () => {
      readForm();
      const saved = S.saveDraft(composer.draft);
      composer.draft.id = saved.id;
      composer.dirty = false;
      toast('Borrador guardado. Lo encontrás en el historial.');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      readForm();
      const firstInvalid = validate();
      if (firstInvalid) { firstInvalid.focus(); return; }
      const saved = S.saveDraft(composer.draft);
      composer = null;
      location.hash = '#/revisar/' + saved.id;
    });

    renderPreview();
  }

  function showError(input, errId) {
    input.setAttribute('aria-invalid', 'true');
    const err = document.getElementById(errId);
    if (err) err.hidden = false;
  }
  function clearError(input) {
    input.removeAttribute('aria-invalid');
    (input.getAttribute('aria-describedby') || '').split(' ').forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.classList.contains('rx-error')) el.hidden = true;
    });
  }

  function validate() {
    const d = composer.draft;
    const checks = d.kind === 'receta'
      ? [
        [!d.med, 'medSearch', 'medErr'],
        [!d.dose, 'fDose', 'doseErr'],
        [!d.frequency, 'fFreq', 'freqErr'],
        [!(Number(d.duration.value) > 0), 'fDur', 'durErr'],
        [!(Number(d.quantity) >= 1), 'fQty', 'qtyErr'],
      ]
      : [[!d.service, 'fService', 'serviceErr']];
    let first = null;
    checks.forEach(([bad, inputId, errId]) => {
      const input = document.getElementById(inputId);
      if (bad) {
        if (inputId === 'medSearch') { document.querySelector('.rx-med-pick').hidden = false; document.querySelector('.rx-med-picked').hidden = true; }
        showError(input, errId);
        if (!first) first = input;
      } else if (input) {
        clearError(input);
      }
    });
    return first;
  }

  // =====================================================================
  // Vista: revisión antes de emitir
  // =====================================================================
  function renderReview(id) {
    setNav('paciente');
    const d = S.doc(id);
    if (!d) return notFound();
    if (d.status !== 'borrador') { location.replace('#/emitida/' + id); return; }
    const p = S.patient(d.patientId);
    const state = S.read();
    const channels = ['portal'].concat(state.channels.whatsapp ? ['whatsapp'] : [], state.channels.email ? ['email'] : []);
    const noun = kindNoun(d);
    view.innerHTML = ''
      + originBanner()
      + '<div class="rx-page-head">'
      + '<a class="rx-back" href="#/editar/' + esc(d.id) + '">' + ic('arrowL', 16) + 'Editar</a>'
      + '<h1>Revisá la ' + noun + ' antes de emitir</h1>'
      + '<p class="rx-page-sub">Así la va a ver ' + esc(p.name) + ' en su Portal. Todavía es un borrador.</p>'
      + '</div>'
      + '<div class="rx-review">'
      + '<div class="rx-review-sheet">' + R.render(d, { audience: 'pro' }) + '</div>'
      + '<aside class="rx-review-side" aria-labelledby="emitTitle">'
      + '<h2 class="rx-eyebrow" id="emitTitle">Al emitir</h2>'
      + '<ul class="rx-facts">'
      + '<li><b>Número de documento</b><span>Se asigna automáticamente.</span></li>'
      + '<li><b>Aviso al paciente</b><span>' + esc(S.channelsLabel(channels)) + ' <button class="rx-link" type="button" data-open-channels>Cambiar</button></span></li>'
      + '<li><b>Trazabilidad</b><span>Queda en el historial. Si hace falta corregirla, se anula y se emite una nueva: no se borra.</span></li>'
      + '</ul>'
      + '<div class="rx-review-actions">'
      + '<a class="btn btn-secondary" href="#/editar/' + esc(d.id) + '">Editar</a>'
      + '<button class="btn btn-primary" type="button" id="emitBtn">' + (d.kind === 'receta' ? 'Emitir prescripción' : 'Emitir orden') + '</button>'
      + '</div>'
      + '<p class="rx-review-note">Emisión simulada: no hay firma digital ni validación externa.</p>'
      + '</aside>'
      + '</div>';

    view.querySelector('[data-open-channels]').addEventListener('click', openChannels);
    const btn = document.getElementById('emitBtn');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.innerHTML = '<span class="rx-spinner" aria-hidden="true"></span>Emitiendo…';
      setTimeout(() => {
        const emitted = S.emit(d.id);
        toast((d.kind === 'receta' ? 'Prescripción emitida · ' : 'Orden emitida · ') + emitted.number);
        location.hash = '#/emitida/' + d.id;
      }, 650);
    });
  }

  // =====================================================================
  // Vista: documento emitido
  // =====================================================================
  function renderDone(id) {
    setNav('paciente');
    const d = S.doc(id);
    if (!d) return notFound();
    if (d.status === 'borrador') { location.replace('#/revisar/' + id); return; }
    const p = S.patient(d.patientId);
    const pro = S.professional(d.professionalId);
    const isReceta = d.kind === 'receta';
    const title = isReceta ? 'Prescripción emitida' : 'Orden emitida';
    view.innerHTML = ''
      + originBanner()
      + '<section class="rx-done" aria-labelledby="doneTitle">'
      + '<div class="rx-done-head">'
      + '<span class="rx-done-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path class="rx-done-check" d="M20 6 9 17l-5-5"/></svg></span>'
      + '<div><h1 id="doneTitle">' + title + '</h1><p class="rx-page-sub">' + esc(p.name) + ' ya puede verla en su Portal del Paciente.</p></div>'
      + '</div>'
      + '<dl class="rx-kv">'
      + '<div><dt>Número</dt><dd class="num">' + esc(d.number) + '</dd></div>'
      + '<div><dt>Fecha</dt><dd class="num">' + esc(S.fmtDate(d.dateISO)) + ' · emitida ' + esc(S.fmtStamp(d.issuedAt).split(' · ')[1]) + '</dd></div>'
      + '<div><dt>Profesional</dt><dd>' + esc(pro.name) + '</dd></div>'
      + '<div><dt>Paciente</dt><dd>' + esc(p.name) + ' <span class="rx-muted num">· DNI ' + esc(p.dni) + '</span></dd></div>'
      + '<div><dt>Estado</dt><dd>' + R.statusTag(d, 'pro') + '</dd></div>'
      + '<div><dt>Aviso al paciente</dt><dd>' + esc(S.channelsLabel(d.channels)) + ' <span class="rx-muted">· «Tenés una nueva ' + (isReceta ? 'receta' : 'orden') + ' disponible.»</span></dd></div>'
      + '</dl>'
      + '<div class="rx-done-actions">'
      + '<button class="btn btn-primary" type="button" data-view="' + esc(d.id) + '">Ver documento</button>'
      + '<a class="btn btn-secondary" href="' + portalHref(d) + '" target="_blank" rel="noopener">Abrir en el Portal del Paciente ' + ic('external', 16) + '<span class="visually-hidden">(se abre en otra pestaña)</span></a>'
      + '</div>'
      + (EMBED ? '<p class="rx-embed-hint">' + ic('arrowL', 16) + 'Mirá el celular: el aviso ya llegó al Portal de ' + esc(firstName(p)) + '.</p>' : '')
      + '<div class="rx-done-next"><span>Seguir con ' + esc(firstName(p)) + ':</span>'
      + '<a class="rx-link" href="#/nueva/' + (isReceta ? 'orden' : 'receta') + '">' + (isReceta ? 'Nueva orden' : 'Nueva prescripción') + '</a>'
      + (origin === 'horus' ? '<a class="rx-link" href="consulta.html">Volver a la atención</a>' : '<a class="rx-link" href="#/paciente">Volver al paciente</a>')
      + '</div>'
      + '</section>';
    bindViewButtons();
  }

  // =====================================================================
  // Vista: historial
  // =====================================================================
  const FILTERS = [
    ['todas', 'Todas', () => true],
    ['emitidas', 'Emitidas', (d) => S.statusOf(d) === 'emitida'],
    ['borradores', 'Borradores', (d) => d.status === 'borrador'],
    ['anuladas', 'Anuladas', (d) => d.status === 'anulada'],
  ];

  function renderHistorial() {
    setNav('historial');
    view.innerHTML = ''
      + '<div class="rx-page-head"><h1>Historial de prescripciones y órdenes</h1><p class="rx-page-sub">Todos los documentos de la institución. Los anulados se conservan para mantener la trazabilidad.</p></div>'
      + '<div class="rx-toolbar">'
      + '<div class="rx-filters" role="group" aria-label="Filtrar por estado" id="histFilters"></div>'
      + '<div class="rx-combo rx-hist-search">' + ic('search', 18) + '<label class="visually-hidden" for="histSearch">Buscar por paciente o número</label><input class="input" id="histSearch" type="search" placeholder="Paciente, DNI o número" value="' + esc(historyQuery) + '" autocomplete="off"></div>'
      + '</div>'
      + '<div id="histResults" aria-live="polite"></div>';
    document.getElementById('histSearch').addEventListener('input', (e) => { historyQuery = e.target.value; paintHistory(); });
    paintHistory();
  }

  function paintHistory() {
    const all = S.read().documents.slice().sort((a, b) => (b.issuedAt || b.updatedAt || b.createdAt) - (a.issuedAt || a.updatedAt || a.createdAt));
    const q = S.fold(historyQuery).trim();
    const qd = S.digits(historyQuery);
    const matches = all.filter((d) => {
      if (!q) return true;
      const p = S.patient(d.patientId);
      return S.fold(p.name).includes(q) || S.fold(d.number).includes(q) || S.fold(S.headline(d)).includes(q) || (qd.length >= 2 && (S.digits(p.dni).includes(qd) || S.digits(d.number).includes(qd)));
    });
    document.getElementById('histFilters').innerHTML = FILTERS.map(([key, label, fn]) => {
      const n = matches.filter(fn).length;
      return '<button type="button" data-filter="' + key + '" aria-pressed="' + (historyFilter === key) + '">' + label + ' <span class="num">' + n + '</span></button>';
    }).join('');
    document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      historyFilter = b.dataset.filter;
      paintHistory();
      document.querySelector('[data-filter="' + historyFilter + '"]').focus();
    }));
    const fn = FILTERS.find((f) => f[0] === historyFilter)[2];
    const rows = matches.filter(fn);
    const results = document.getElementById('histResults');
    if (!rows.length) {
      results.innerHTML = '<div class="rx-empty"><p class="rx-empty-title">No hay documentos para mostrar</p><p>' + (q ? 'Probá con otro nombre, DNI o número.' : 'Cambiá el filtro para ver otros estados.') + '</p></div>';
      return;
    }
    results.innerHTML = '<div class="rx-table-wrap"><table class="rx-table rx-table--hist">'
      + '<caption class="visually-hidden">Historial de documentos, ' + rows.length + ' resultados</caption>'
      + '<thead><tr><th scope="col">Fecha</th><th scope="col">Paciente</th><th scope="col">Tipo</th><th scope="col">Profesional</th><th scope="col">Estado</th><th scope="col"><span class="visually-hidden">Acciones</span></th></tr></thead><tbody>'
      + rows.map((d) => {
        const p = S.patient(d.patientId);
        const pro = S.professional(d.professionalId);
        const action = isOwnDraft(d)
          ? '<a class="btn btn-secondary btn-sm" href="#/editar/' + esc(d.id) + '">Continuar</a>'
          : '<button class="btn btn-secondary btn-sm" type="button" data-view="' + esc(d.id) + '">Ver<span class="visually-hidden"> ' + esc(S.kindShort(d) + ' de ' + p.name) + '</span></button>';
        return '<tr>'
          + '<td data-label="Fecha" class="num">' + esc(S.fmtDate(d.dateISO)) + '</td>'
          + '<td data-label="Paciente"><span class="rx-doc-head">' + esc(p.name) + '</span><span class="rx-doc-num num">DNI ' + esc(p.dni) + '</span></td>'
          + '<td data-label="Tipo"><span class="rx-doc-kind">' + ic(d.kind === 'receta' ? 'pill' : 'order', 15) + esc(S.kindShort(d)) + '</span><span class="rx-doc-sub">' + esc(S.headline(d)) + (d.number ? ' · <span class="num">' + esc(d.number) + '</span>' : '') + '</span></td>'
          + '<td data-label="Profesional">' + esc(pro.name) + '</td>'
          + '<td data-label="Estado">' + R.statusTag(d, 'pro') + '</td>'
          + '<td class="rx-td-action">' + action + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
    bindViewButtons();
  }

  function notFound() {
    view.innerHTML = '<div class="rx-empty"><h1 class="rx-empty-title">No encontramos ese documento</h1><p>Puede haberse reiniciado la demo.</p><p><a class="btn btn-secondary" href="#/paciente">Volver al paciente</a></p></div>';
  }

  // =====================================================================
  // Drawer de documento
  // =====================================================================
  const drawer = document.getElementById('docDrawer');
  const scrim = document.getElementById('scrim');
  let drawerDocId = null;
  let drawerReturn = null;

  function openDrawer(id, trigger) {
    const d = S.doc(id);
    if (!d) return;
    drawerDocId = id;
    drawerReturn = trigger || document.activeElement;
    paintDrawer();
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.add('is-open');
    scrim.classList.add('is-open');
    document.body.classList.add('rx-noscroll');
    document.getElementById('docDrawerClose').focus();
  }

  function paintDrawer() {
    const d = S.doc(drawerDocId);
    if (!d) { closeDrawer(); return; }
    const key = S.statusOf(d);
    const p = S.patient(d.patientId);
    document.getElementById('docDrawerKind').textContent = S.kindShort(d) + (d.number ? ' · ' + d.number : '');
    document.getElementById('docDrawerTitle').textContent = p.name;
    document.getElementById('docDrawerBody').innerHTML = R.render(d, { audience: 'pro' })
      + (d.duplicatedFrom ? '<p class="rx-drawer-note">Creado a partir de ' + esc(d.duplicatedFrom) + '.</p>' : '')
      + (d.notifiedAt && key !== 'borrador' ? '<p class="rx-drawer-note">Aviso al paciente: ' + esc(S.channelsLabel(d.channels)) + ' · ' + esc(S.fmtStamp(d.notifiedAt)) + '</p>' : '');
    let actions = '';
    if (key === 'borrador') {
      actions = (isOwnDraft(d) ? '<a class="btn btn-primary" href="#/editar/' + esc(d.id) + '" data-close>' + ic('edit', 16) + 'Continuar editando</a>' : '')
        + '<button class="btn rx-btn-danger-ghost" type="button" id="dDiscard">' + ic('trash', 16) + 'Descartar borrador</button>';
    } else {
      actions = '<div class="rx-drawer-actions-main">'
        + '<button class="btn btn-secondary btn-sm" type="button" id="dDownload">' + ic('download', 16) + 'Descargar</button>'
        + '<button class="btn btn-secondary btn-sm" type="button" id="dShare">' + ic('share', 16) + 'Compartir</button>'
        + '<button class="btn btn-secondary btn-sm" type="button" id="dDuplicate">' + ic('copy', 16) + 'Duplicar como nueva</button>'
        + '</div>'
        + (key === 'emitida' ? '<div class="rx-drawer-annul"><button class="btn rx-btn-danger-ghost btn-sm" type="button" id="dAnnul">' + ic('ban', 16) + 'Anular</button><span>Queda marcada como anulada; no se borra.</span></div>' : '');
    }
    const foot = document.getElementById('docDrawerFoot');
    foot.innerHTML = actions;
    foot.querySelector('[data-close]')?.addEventListener('click', () => closeDrawer(true));
    foot.querySelector('#dDiscard')?.addEventListener('click', () => {
      S.discardDraft(d.id);
      closeDrawer();
      rerender();
      toast('Borrador descartado.');
    });
    foot.querySelector('#dDownload')?.addEventListener('click', () => { R.downloadHTML(d, 'pro'); toast('Descargamos una copia de demostración.'); });
    foot.querySelector('#dShare')?.addEventListener('click', async () => {
      const r = await R.share(d);
      if (r === 'copied') toast('Copiamos un aviso para compartir, sin datos médicos.');
      else if (r === 'unavailable') toast('Compartir no está disponible en este navegador.');
    });
    foot.querySelector('#dDuplicate')?.addEventListener('click', () => {
      const copy = S.duplicate(d.id);
      closeDrawer(true);
      if (copy.patientId !== currentPatientId) { currentPatientId = copy.patientId; ss(SESSION_PATIENT, currentPatientId); }
      location.hash = '#/editar/' + copy.id;
      toast('Creamos un borrador nuevo. El original no cambia.');
    });
    foot.querySelector('#dAnnul')?.addEventListener('click', () => openAnnul(d));
  }

  function closeDrawer(skipFocus) {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('is-open');
    document.body.classList.remove('rx-noscroll');
    drawerDocId = null;
    if (!skipFocus && drawerReturn && document.body.contains(drawerReturn)) drawerReturn.focus();
    drawerReturn = null;
  }
  document.getElementById('docDrawerClose').addEventListener('click', () => closeDrawer());
  scrim.addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (e) => {
    if (!drawer.classList.contains('is-open')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key === 'Tab') {
      const f = [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---------- anulación ----------
  const annulDialog = document.getElementById('annulDialog');
  let annulTarget = null;
  function openAnnul(d) {
    annulTarget = d.id;
    document.getElementById('annulTitle').textContent = d.kind === 'receta' ? '¿Anular esta prescripción?' : '¿Anular esta orden?';
    document.getElementById('annulDoc').textContent = S.kindShort(d) + ' ' + d.number + ' · ' + S.headline(d) + ' · ' + S.patient(d.patientId).name;
    document.getElementById('annulReason').value = '';
    document.getElementById('annulConfirm').textContent = d.kind === 'receta' ? 'Anular prescripción' : 'Anular orden';
    annulDialog.showModal();
    document.getElementById('annulCancel').focus();
  }
  document.getElementById('annulCancel').addEventListener('click', () => annulDialog.close());
  document.getElementById('annulForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = S.annul(annulTarget, document.getElementById('annulReason').value);
    annulDialog.close();
    annulTarget = null;
    paintDrawer();
    rerender(true);
    toast((d.kind === 'receta' ? 'Prescripción anulada' : 'Orden anulada') + '. Sigue en el historial.');
    document.getElementById('docDrawerClose').focus();
  });

  // ---------- canales ----------
  const channelsDialog = document.getElementById('channelsDialog');
  function openChannels() {
    const st = S.read();
    document.getElementById('chWhatsapp').checked = !!st.channels.whatsapp;
    document.getElementById('chEmail').checked = !!st.channels.email;
    channelsDialog.showModal();
  }
  document.getElementById('channelsBtn').addEventListener('click', openChannels);
  document.getElementById('chWhatsapp').addEventListener('change', (e) => S.setChannel('whatsapp', e.target.checked));
  document.getElementById('chEmail').addEventListener('change', (e) => S.setChannel('email', e.target.checked));
  channelsDialog.addEventListener('close', () => { if (location.hash.startsWith('#/revisar/')) rerender(true); });

  // ---------- reinicio ----------
  document.getElementById('resetDemo').addEventListener('click', () => {
    S.reset();
    ss(SESSION_PATIENT, 'maria');
    ss(SESSION_ORIGIN, null);
    currentPatientId = 'maria';
    origin = '';
    composer = null;
    historyFilter = 'todas';
    historyQuery = '';
    closeDrawer(true);
    if (location.hash === '#/paciente') rerender(); else location.hash = '#/paciente';
    toast('Demo reiniciada. Solo se restauró este módulo.');
  });

  // =====================================================================
  // Router
  // =====================================================================
  function rerender(keepFocus) { route(keepFocus); }

  function route(keepFocus) {
    const hash = location.hash || '#/paciente';
    const [, section, arg] = hash.split('/');
    // Al salir de la composición con cambios, se guarda el borrador para no perder trabajo
    if (composer && composer.dirty && !(section === 'nueva' || section === 'editar')) {
      const saved = S.saveDraft(composer.draft);
      toast('Guardamos el borrador para ' + S.patient(saved.patientId).name + '.');
    }
    if (!(section === 'nueva' || section === 'editar')) composer = null;
    view.classList.toggle('rx-quiet', !!keepFocus);
    if (!keepFocus) window.scrollTo(0, 0);
    if (section === 'nueva' && (arg === 'receta' || arg === 'orden')) renderComposer(newDraft(arg));
    else if (section === 'editar') {
      const d = S.doc(decodeURIComponent(arg || ''));
      if (!d) notFound();
      else if (d.status !== 'borrador') location.replace('#/emitida/' + d.id);
      else { currentPatientId = d.patientId; ss(SESSION_PATIENT, currentPatientId); renderComposer(JSON.parse(JSON.stringify(d))); }
    }
    else if (section === 'revisar') renderReview(decodeURIComponent(arg || ''));
    else if (section === 'emitida') renderDone(decodeURIComponent(arg || ''));
    else if (section === 'historial') renderHistorial();
    else renderPaciente();
    if (!keepFocus && !firstRoute) focusHeading();
    firstRoute = false;
  }
  let firstRoute = true;

  window.addEventListener('hashchange', () => route());

  // Otras pestañas (Portal, atención) pueden cambiar el estado
  window.addEventListener('storage', (e) => {
    if (e.key !== S.KEY) return;
    if (composer) return;
    if (drawerDocId) paintDrawer();
    const active = document.activeElement;
    const activeId = active && active.id;
    route(true);
    if (activeId && document.getElementById(activeId)) document.getElementById(activeId).focus();
  });

  // Entrada desde la atención: ?nueva=receta|orden
  const start = params.get('nueva');
  if (start === 'receta' || start === 'orden') {
    history.replaceState(null, '', location.pathname + (EMBED ? '?embed=1' : '') + '#/nueva/' + start);
  }
  route();
})();
