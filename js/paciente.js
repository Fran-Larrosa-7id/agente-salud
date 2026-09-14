(function () {
  const SCREENS = ['bienvenida', 'estado', 'personales', 'cobertura', 'clinica', 'documentacion', 'revision', 'consentimiento', 'final'];
  const STEP_SCREENS = ['estado', 'personales', 'cobertura', 'clinica', 'documentacion', 'revision', 'consentimiento'];

  const PHASES = [
    { key: 'personales', label: 'Datos personales' },
    { key: 'cobertura', label: 'Cobertura médica' },
    { key: 'antecedentes', label: 'Antecedentes' },
    { key: 'medicacion', label: 'Medicación' },
    { key: 'documentacion', label: 'Documentación' },
  ];

  const topContextStep = document.getElementById('topContextStep');
  let currentScreen = 'bienvenida';
  let ordenMedicaCargada = false;
  const completedPhases = { personales: false, cobertura: false, clinica: false };

  function showScreen(id, direction) {
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
    const doneCount = [
      completedPhases.personales,
      completedPhases.cobertura,
      completedPhases.clinica,
      completedPhases.clinica,
      ordenMedicaCargada,
    ].filter(Boolean).length;
    const percent = Math.round((doneCount / PHASES.length) * 100);
    document.getElementById('overviewPercent').textContent = percent + '%';
    document.getElementById('overviewBar').style.transform = `scaleX(${percent / 100})`;

    rail.innerHTML = PHASES.map((phase, i) => {
      const isDone = i < doneCount;
      const isCurrent = i === doneCount;
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
    if (ordenMedicaCargada) {
      badge.className = 'badge badge-success';
      badge.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Completo';
      alert.hidden = true;
    } else {
      badge.className = 'badge badge-pending';
      badge.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>1 pendiente';
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
        ordenMedicaCargada = true;
        document.getElementById('ordenMedicaMeta').textContent = 'Cargado';
        const badge = document.getElementById('ordenMedicaBadge');
        badge.className = 'badge badge-success is-pop';
        badge.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Cargado';
        flashRow(document.getElementById('ordenMedicaRow'));
        renderRevision();
        showToast('Orden médica cargada correctamente');
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

  showScreen('bienvenida');
})();
