(function () {
  // Configuración de la institución (panel institucional → js/onboarding-config.js)
  const CFG = obGetConfig();
  const S = CFG.secciones;
  const ORDER = ['personales', 'cobertura', 'clinica', 'documentacion', 'revision', 'consentimiento'];
  const INCLUDED = {
    personales: !!S[0], cobertura: !!S[1], clinica: !!(S[2] || S[3]), documentacion: !!S[4], revision: true, consentimiento: true,
  };
  const SCREENS = ['bienvenida', 'estado', 'personales', 'cobertura', 'clinica', 'documentacion', 'revision', 'consentimiento', 'final'];
  const STEP_SCREENS = ['estado'].concat(ORDER.filter((k) => INCLUDED[k]));

  // Al avanzar o volver se saltean las secciones que la plantilla no solicita
  function resolve(id, dir) {
    let k = ORDER.indexOf(id);
    if (k < 0) return id;
    const step = dir === 'back' ? -1 : 1;
    while (k >= 0 && k < ORDER.length && !INCLUDED[ORDER[k]]) k += step;
    return ORDER[k] || id;
  }

  const completedPhases = { personales: false, cobertura: false, clinica: false };
  const docsState = OB_DOCS.map((nombre, i) => ({ nombre, req: !!CFG.docs[i], cargado: i < 2 })).filter((d) => d.req);
  const pendingDocs = () => (INCLUDED.documentacion ? docsState.filter((d) => !d.cargado) : []);

  const PHASES = [
    { label: 'Datos personales', on: S[0], done: () => completedPhases.personales },
    { label: 'Cobertura médica', on: S[1], done: () => completedPhases.cobertura },
    { label: 'Antecedentes', on: S[2], done: () => completedPhases.clinica },
    { label: 'Medicación', on: S[3], done: () => completedPhases.clinica },
    { label: 'Documentación', on: S[4], done: () => pendingDocs().length === 0 },
  ].filter((ph) => ph.on);

  const topContextStep = document.getElementById('topContextStep');
  let currentScreen = 'bienvenida';

  function applyConfig() {
    document.getElementById('tplTag').textContent = 'Plantilla: ' + OB_PLANTILLAS[CFG.plantilla].nombre;
    ORDER.forEach((k) => {
      if (INCLUDED[k]) return;
      document.querySelectorAll(`.review-item[data-goto="${k}"]`).forEach((el) => { el.hidden = true; });
    });
    if (!S[2]) { document.getElementById('secAntecedentes').hidden = true; document.getElementById('secAlergias').hidden = true; }
    if (!S[3]) document.getElementById('secMedicacion').hidden = true;
    const nombres = [S[2] ? 'Antecedentes' : '', S[3] ? 'medicación' : ''].filter(Boolean).join(' y ');
    document.getElementById('clinicaReviewName').textContent = nombres.charAt(0).toUpperCase() + nombres.slice(1);
    document.getElementById('t-clinica').textContent = S[2] ? 'Información clínica' : 'Medicación relevante';
    document.getElementById('docHint').textContent = docsState.map((d) => d.nombre).join(', ');
    document.querySelector('.duration-chip').lastChild.textContent = ` Aproximadamente ${Math.max(2, STEP_SCREENS.length - 1)} minutos`;
    renderDocs();
  }

  function docRow(d, id) {
    const icon = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';
    const badge = d.cargado
      ? '<span class="badge badge-success"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Cargado</span>'
      : '<span class="badge badge-pending"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>Pendiente</span>';
    return `<div class="doc-row" data-doc="${id}"><div class="doc-icon">${icon}</div><div class="doc-info"><div class="doc-name">${d.nombre}</div><div class="doc-meta">${d.cargado ? 'Cargado' : 'Pendiente'}</div></div>${badge}</div>`;
  }
  function renderDocs() {
    document.getElementById('docList').innerHTML = docsState.map((d, i) => docRow(d, i)).join('');
  }

  function showScreen(id, direction) {
    id = resolve(id, direction);
    SCREENS.forEach((s) => {
      const el = document.getElementById('screen-' + s);
      if (!el) return;
      el.classList.remove('dir-forward', 'dir-back');
      el.classList.toggle('is-active', s === id);
      if (s === id && direction) el.classList.add(direction === 'back' ? 'dir-back' : 'dir-forward');
    });
    currentScreen = id;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    const stepIndex = STEP_SCREENS.indexOf(id);
    if (stepIndex >= 0) {
      topContextStep.hidden = false;
      topContextStep.textContent = `Paso ${stepIndex + 1} de ${STEP_SCREENS.length}`;
    } else {
      topContextStep.hidden = true;
    }

    if (id === 'estado') renderPhaseRail();
    if (id === 'revision') renderRevision();
  }

  document.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (currentScreen in completedPhases) completedPhases[currentScreen] = true;
      showScreen(btn.dataset.next, 'forward');
    });
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => showScreen(el.dataset.goto, 'back'));
  });

  function renderPhaseRail() {
    const rail = document.getElementById('phaseRail');
    const done = PHASES.map((ph) => ph.done());
    const doneCount = done.filter(Boolean).length;
    const current = done.indexOf(false);
    const percent = PHASES.length ? Math.round((doneCount / PHASES.length) * 100) : 100;
    document.getElementById('overviewPercent').textContent = percent + '%';
    document.getElementById('overviewBar').style.transform = `scaleX(${percent / 100})`;

    rail.innerHTML = PHASES.map((phase, i) => {
      const isDone = done[i];
      const isCurrent = i === current;
      const stateClass = isDone ? 'is-done' : isCurrent ? 'is-current' : '';
      const dotContent = isDone
        ? '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'
        : (i + 1);
      const sub = isDone ? 'Completo' : isCurrent ? 'Siguiente paso' : 'Pendiente';
      return `<div class="phase-item ${stateClass}">
        <div class="phase-dot">${dotContent}</div>
        <div>
          <div class="phase-label">${phase.label}</div>
          <div class="phase-sub">${sub}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderRevision() {
    const badge = document.getElementById('revisionDocBadge');
    const alert = document.getElementById('ordenMedicaAlert');
    if (!badge || !alert) return;
    const pend = pendingDocs();
    if (!pend.length) {
      badge.className = 'badge badge-success';
      badge.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Completo';
      alert.hidden = true;
    } else {
      badge.className = 'badge badge-pending';
      badge.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>${pend.length} pendiente${pend.length > 1 ? 's' : ''}`;
      document.getElementById('docAlertTitle').textContent = pend.length === 1 ? 'Falta: ' + pend[0].nombre : 'Faltan ' + pend.length + ' documentos: ' + pend.map((d) => d.nombre).join(', ');
      alert.hidden = false;
    }
  }

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

  // --- Simulated uploads ---
  document.querySelectorAll('.uploader').forEach((uploader) => {
    uploader.addEventListener('click', () => simulateUpload(uploader));
    uploader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); simulateUpload(uploader); }
    });
  });

  function flashRow(row) {
    if (!row) return;
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 900);
  }

  function simulateUpload(uploader) {
    const type = uploader.dataset.upload;
    if (type === 'doc' && !pendingDocs().length) { showToast('Ya cargaste todos los documentos solicitados'); return; }
    uploader.querySelector('.uploader-title').textContent = 'Subiendo...';
    uploader.classList.add('is-uploading');
    uploader.style.pointerEvents = 'none';

    setTimeout(() => {
      uploader.classList.remove('is-uploading');
      if (type === 'credencial') {
        uploader.querySelector('.uploader-title').textContent = 'Subir foto de la credencial';
        uploader.style.pointerEvents = '';
        document.getElementById('credencialResult').innerHTML = `
          <div class="doc-row" style="margin-top: var(--sp-3)">
            <div class="doc-icon"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/></svg></div>
            <div class="doc-info">
              <div class="doc-name">credencial_osde.jpg</div>
              <div class="doc-meta">Cargado</div>
            </div>
            <span class="badge badge-success"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Cargado</span>
          </div>`;
        flashRow(document.querySelector('#credencialResult .doc-row'));
        showToast('Credencial cargada correctamente');
      } else {
        uploader.querySelector('.uploader-title').textContent = 'Arrastrá o tocá para subir';
        uploader.style.pointerEvents = '';
        const doc = docsState.find((d) => !d.cargado);
        if (doc) doc.cargado = true;
        renderDocs();
        flashRow(document.querySelector(`#docList [data-doc="${docsState.indexOf(doc)}"]`));
        renderRevision();
        showToast((doc ? doc.nombre : 'Documento') + ' cargado correctamente');
      }
    }, 1100);
  }

  // --- Alergias "no tengo alergias" toggle ---
  const noAlergiasCheck = document.getElementById('noAlergias');
  if (noAlergiasCheck) {
    noAlergiasCheck.addEventListener('change', () => {
      const list = document.getElementById('alergiaList');
      list.style.opacity = noAlergiasCheck.checked ? '0.4' : '1';
      list.style.pointerEvents = noAlergiasCheck.checked ? 'none' : 'auto';
    });
  }

  // --- Remove chips (alergias / medicación) ---
  document.addEventListener('click', (e) => {
    if (e.target.closest('.med-card .btn-ghost')) {
      e.target.closest('.med-card').remove();
    }
  });

  applyConfig();
  showScreen('bienvenida');
})();
