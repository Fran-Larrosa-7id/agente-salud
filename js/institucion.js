(function () {
  let statusFilter = '';
  let searchTerm = '';
  let profFilter = '';

  function docSummary(p) {
    const total = p.documentos.length;
    if (total === 0) return 'Sin documentos';
    const validados = p.documentos.filter((d) => d.estado === 'validado').length;
    return `${validados}/${total} validados`;
  }

  function statusBadge(estado) {
    const icons = {
      listo: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>',
      info_pendiente: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>',
      doc_pendiente: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>',
      revision: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
      no_iniciado: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
    };
    return `<span class="badge ${estado.badge}">${icons[estado.key]}${estado.label}</span>`;
  }

  function populateProfesionalFilter() {
    const sel = document.getElementById('profFilter');
    const names = [...new Set(PACIENTES.map((p) => p.profesional.nombre))];
    names.forEach((n) => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });
  }

  function renderStats() {
    const total = PACIENTES.length;
    const listos = PACIENTES.filter((p) => p.estado.key === 'listo').length;
    const pendientes = PACIENTES.filter((p) => p.estado.key === 'info_pendiente' || p.estado.key === 'doc_pendiente' || p.estado.key === 'no_iniciado').length;
    const revision = PACIENTES.filter((p) => p.estado.key === 'revision').length;
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statListos').textContent = listos;
    document.getElementById('statPendientes').textContent = pendientes;
    document.getElementById('statRevision').textContent = revision;
  }

  function matchesFilters(p) {
    const matchStatus =
      !statusFilter ||
      (statusFilter === 'listo' && p.estado.key === 'listo') ||
      (statusFilter === 'pendiente' && (p.estado.key === 'info_pendiente' || p.estado.key === 'doc_pendiente' || p.estado.key === 'no_iniciado')) ||
      (statusFilter === 'revision' && p.estado.key === 'revision');
    const matchProf = !profFilter || p.profesional.nombre === profFilter;
    const term = searchTerm.trim().toLowerCase();
    const matchSearch = !term || `${p.nombre} ${p.apellido}`.toLowerCase().includes(term) || p.dni.includes(term);
    return matchStatus && matchProf && matchSearch;
  }

  function renderTable() {
    const tbody = document.getElementById('patientTableBody');
    const filtered = PACIENTES.filter(matchesFilters).sort((a, b) => a.turno.localeCompare(b.turno));
    document.getElementById('tableCount').textContent = `${filtered.length} paciente${filtered.length === 1 ? '' : 's'}`;
    document.getElementById('emptyState').hidden = filtered.length !== 0;

    tbody.innerHTML = filtered.map((p) => `
      <tr class="${p.estado.key === 'revision' ? 'row-revision' : ''}" data-id="${p.id}" tabindex="0" role="button" aria-label="Ver detalle de ${p.nombre} ${p.apellido}">
        <td>
          <div class="patient-name-cell">
            <span class="patient-name">${p.nombre} ${p.apellido}</span>
            <span class="patient-dni num">DNI ${p.dni}</span>
          </div>
        </td>
        <td class="num">${p.turno} hs</td>
        <td>${p.profesional.nombre}</td>
        <td>
          <div class="mini-progress">
            <div class="progress-track"><div class="progress-fill" style="transform:scaleX(${p.progreso / 100})"></div></div>
            <span class="num">${p.progreso}%</span>
          </div>
        </td>
        <td class="doc-cell">${docSummary(p)}</td>
        <td>${statusBadge(p.estado)}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach((row) => {
      row.addEventListener('click', () => openDrawer(row.dataset.id, row));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(row.dataset.id, row); }
      });
    });
  }

  function renderProximosTurnos() {
    const container = document.getElementById('proximosTurnos');
    const list = [...PACIENTES].sort((a, b) => a.turno.localeCompare(b.turno)).slice(0, 5);
    container.innerHTML = list.map((p) => `
      <div class="turno-row">
        <span class="turno-time num">${p.turno}</span>
        <div class="turno-info">
          <span class="turno-name">${p.nombre} ${p.apellido}</span>
          ${statusBadge(p.estado)}
        </div>
      </div>
    `).join('');
  }

  function renderActividad() {
    const container = document.getElementById('actividadReciente');
    container.innerHTML = ACTIVIDAD_RECIENTE.map((a) => `
      <div class="activity-row">
        <span class="activity-dot"></span>
        <div>
          <div class="activity-text"><b>${a.paciente}</b> ${a.accion}</div>
          <div class="activity-time">${a.hace}</div>
        </div>
      </div>
    `).join('');
  }

  // --- Filters wiring ---
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderTable();
  });
  document.getElementById('profFilter').addEventListener('change', (e) => {
    profFilter = e.target.value;
    renderTable();
  });
  function setStatusFilter(status) {
    statusFilter = status;
    document.querySelectorAll('#statusFilters .filter-chip').forEach((c) => {
      const on = c.dataset.status === status;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on);
    });
    document.querySelectorAll('.stat-cell').forEach((c) => {
      const on = c.dataset.status === status;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on);
    });
    renderTable();
  }
  document.querySelectorAll('#statusFilters .filter-chip, .stat-cell').forEach((el) => {
    el.addEventListener('click', () => setStatusFilter(el.dataset.status));
  });

  // --- Drawer ---
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('scrim');
  let drawerReturnFocus = null;

  function openDrawer(id, triggerEl) {
    const p = PACIENTES.find((x) => x.id === id);
    if (!p) return;
    drawerReturnFocus = triggerEl || document.activeElement;

    document.getElementById('drawerDni').textContent = `DNI ${p.dni}`;
    document.getElementById('drawerName').textContent = `${p.nombre} ${p.apellido}`;
    document.getElementById('drawerMeta').textContent = `Turno ${p.turno} hs · ${p.profesional.nombre} · ${p.profesional.especialidad}`;
    document.getElementById('drawerProgressBar').style.transform = `scaleX(${p.progreso / 100})`;
    document.getElementById('drawerProgressValue').textContent = p.progreso + '%';

    const alertBox = document.getElementById('drawerAlert');
    const faltantes = [];
    if (!p.secciones.antecedentes) faltantes.push('antecedentes');
    if (!p.secciones.medicacion) faltantes.push('medicación');
    if (!p.secciones.documentacion) faltantes.push('documentación');
    if (!p.secciones.cobertura) faltantes.push('cobertura médica');
    if (faltantes.length) {
      alertBox.innerHTML = `<div class="alert alert-warning">
        <svg aria-hidden="true" class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
        <div><div class="alert-title">Falta completar</div><div>Pendiente: ${faltantes.join(', ')}.</div></div>
      </div>`;
    } else if (p.estado.key === 'revision') {
      alertBox.innerHTML = `<div class="alert alert-danger">
        <svg aria-hidden="true" class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
        <div><div class="alert-title">Requiere revisión manual</div><div>Hay documentos marcados para validar antes del turno.</div></div>
      </div>`;
    } else {
      alertBox.innerHTML = `<div class="alert alert-success">
        <svg aria-hidden="true" class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        <div><div class="alert-title">Sin pendientes</div><div>El paciente está listo para ser atendido.</div></div>
      </div>`;
    }

    const items = [
      ['Datos personales', p.secciones.personales],
      ['Cobertura', p.secciones.cobertura],
      ['Antecedentes', p.secciones.antecedentes],
      ['Medicación', p.secciones.medicacion],
      ['Documentación', p.secciones.documentacion],
    ];
    document.getElementById('drawerChecklist').innerHTML = items.map(([label, done]) => `
      <div class="checklist-item">
        <span>${label}</span>
        ${done
          ? '<span class="badge badge-success"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Completo</span>'
          : '<span class="badge badge-pending"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>Pendiente</span>'}
      </div>
    `).join('');

    const alergiasTxt = p.alergias.length ? p.alergias.join(', ') : 'No tiene alergias conocidas';
    const medicacionTxt = p.medicacion.length ? p.medicacion.map((m) => `${m.nombre} ${m.dosis}`).join(', ') : 'Sin medicación registrada';
    document.getElementById('drawerClinical').innerHTML = `
      <div class="clinical-row"><span class="k">Alergias</span><span class="v">${alergiasTxt}</span></div>
      <div class="clinical-row"><span class="k">Medicación</span><span class="v">${medicacionTxt}</span></div>
      <div class="clinical-row"><span class="k">Antecedentes</span><span class="v">${p.antecedentes || 'No informados'}</span></div>
    `;

    document.getElementById('drawerDocs').innerHTML = p.documentos.length
      ? p.documentos.map((d) => {
          const badgeClass = d.estado === 'validado' ? 'badge-success' : d.estado === 'revision' ? 'badge-review' : 'badge-pending';
          const label = d.estado === 'validado' ? 'Validado' : d.estado === 'revision' ? 'Revisión requerida' : 'Pendiente';
          const icon = d.estado === 'validado'
            ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'
            : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>';
          return `<div class="doc-row">
            <div class="doc-icon"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div>
            <div class="doc-info"><div class="doc-name">${d.nombre}</div><div class="doc-meta">${d.tipo}</div></div>
            <span class="badge ${badgeClass}">${icon}${label}</span>
          </div>`;
        }).join('')
      : '<div class="empty-state"><div class="empty-state-title">Sin documentos cargados</div><p>El paciente todavía no subió documentación.</p></div>';

    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-open');
    document.getElementById('drawerClose').focus();
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('is-open');
    if (drawerReturnFocus && document.body.contains(drawerReturnFocus)) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }

  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (!drawer.classList.contains('is-open')) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key === 'Tab') {
      const focusable = drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // --- Quick actions (simulated) ---
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

  document.getElementById('actionRequestDocs').addEventListener('click', () => showToast('Solicitud de documentación enviada al paciente'));
  document.getElementById('actionMarkReviewed').addEventListener('click', () => { showToast('Paciente marcado como revisado'); closeDrawer(); });
  document.getElementById('actionRemind').addEventListener('click', () => showToast('Recordatorio enviado por email y SMS'));

  populateProfesionalFilter();
  renderStats();
  renderTable();
  renderProximosTurnos();
  renderActividad();
})();
