(function () {
  const SCREENS = ['inicio', 'turnos', 'estudios', 'recetas', 'notificaciones', 'perfil'];
  // Prescripción y Órdenes Digitales: estado compartido con el panel profesional (prescripcion-ordenes/js/rx-store.js)
  const RX = window.RxStore || null;
  const RXS = window.RxSheet || null;
  // Dentro de la vista en paralelo (prescripcion-ordenes/demo.html) no se muestra el enlace al catálogo
  if (window.self !== window.top) document.body.classList.add('is-embedded');
  const TURNOS_STORAGE_KEY = 'vertical-salud-turnos-online-v2';
  const PORTAL_SESSION_KEY = 'vertical-salud-portal-session-v1';
  let pendingScreen = 'inicio';
  let pendingCancellationId = null;
  let creatingAccess = false;
  let deferredInstallPrompt = null;

  function localISO(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function offsetISO(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localISO(date);
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function readPortalSession() {
    try {
      const raw = localStorage.getItem(PORTAL_SESSION_KEY);
      if (raw === null) {
        const demo = { authenticated: true, demo: true, nombre: APP_PACIENTE.nombre, apellido: APP_PACIENTE.apellido, dni: APP_PACIENTE.dni, email: 'maria.gonzalez@demo.com', obraSocial: APP_PACIENTE.obraSocial, plan: APP_PACIENTE.plan };
        localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(demo));
        return demo;
      }
      const session = JSON.parse(raw);
      return session && session.authenticated ? session : null;
    } catch (_) {
      return { authenticated: true, demo: true, nombre: APP_PACIENTE.nombre, apellido: APP_PACIENTE.apellido, dni: APP_PACIENTE.dni, email: 'maria.gonzalez@demo.com', obraSocial: APP_PACIENTE.obraSocial, plan: APP_PACIENTE.plan };
    }
  }

  let portalSession = readPortalSession();

  function writePortalSession(session) {
    portalSession = session;
    try { localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(session || { authenticated: false })); } catch (_) { /* storage opcional */ }
    renderPortalIdentity();
  }

  function readTurnosStore() {
    try {
      const raw = localStorage.getItem(TURNOS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function seedSharedAppointments() {
    const today = offsetISO(0);
    const tomorrow = offsetISO(1);
    const later = offsetISO(9);
    const appointments = [
      { id: 'a1', patientName: 'Juan Pérez', professionalId: 'gomez', dateISO: today, time: '09:00', coverage: 'IOMA', typeId: 'primera', status: 'confirmado', origin: 'Web', whatsapp: '11 4455 2211', email: 'juan.perez@mail.com', dni: '34.221.556' },
      { id: 'a2', patientName: 'Lucía Martínez', professionalId: 'gomez', dateISO: today, time: '11:00', coverage: 'Particular', typeId: 'control', status: 'pendiente', origin: 'WhatsApp', whatsapp: '11 6633 8890', email: 'lucia.martinez@mail.com', dni: '29.887.001' },
      { id: 'a3', patientName: 'Mateo Rodríguez', professionalId: 'perez', dateISO: today, time: '10:00', coverage: 'OSDE', typeId: 'prolongada', status: 'atendido', origin: 'Recepción', whatsapp: '11 2211 7744', email: 'mateo.rodriguez@mail.com', dni: '31.556.220' },
      { id: 'a4', patientName: 'Camila Torres', professionalId: 'fernandez', dateISO: today, time: '09:30', coverage: 'Swiss Medical', typeId: 'control', status: 'confirmado', origin: 'WhatsApp', whatsapp: '11 5544 3390', email: 'camila.torres@mail.com', dni: '38.001.774' },
      { id: 'a5', patientName: 'Santiago López', professionalId: 'romero', dateISO: today, time: '14:00', coverage: 'Galeno', typeId: 'primera', status: 'ausente', origin: 'Recepción', whatsapp: '11 7788 1122', email: 'santiago.lopez@mail.com', dni: '27.998.410' },
      { id: 'a6', patientName: 'Sofía López', professionalId: 'gomez', dateISO: tomorrow, time: '08:30', coverage: 'IOMA', typeId: 'control', status: 'pendiente', origin: 'Web', whatsapp: '11 3322 9981', email: 'sofia.lopez@mail.com', dni: '33.445.109' },
      { id: 'a7', patientName: 'Ana Suárez', professionalId: 'gomez', dateISO: tomorrow, time: '10:00', coverage: 'OSDE', typeId: 'primera', status: 'confirmado', origin: 'Web', whatsapp: '11 4567 8901', email: 'ana.suarez@correo.com', dni: '35.112.908', mine: true },
      { id: 'a8', patientName: 'María González', professionalId: 'romero', dateISO: later, time: '10:30', coverage: 'OSDE', coveragePlan: '310', typeId: 'primera', status: 'confirmado', origin: 'Portal del paciente', whatsapp: '11 6204 1188', email: 'maria.gonzalez@demo.com', dni: '32.104.887', mine: true },
    ];
    const now = new Date().toISOString();
    return {
      seedISO: today,
      appointments,
      blocks: [],
      exceptions: [],
      waitlistEntries: [],
      activity: [],
      coverageRecords: [
        { id: 'ioma', name: 'IOMA', plan: 'Afiliación registrada', status: 'vigente', effectiveFrom: '', reason: '', updatedAt: now, history: [{ at: now, text: 'Convenio activo' }] },
        { id: 'osde', name: 'OSDE', plan: '310', status: 'vigente', effectiveFrom: '', reason: '', updatedAt: now, history: [{ at: now, text: 'Convenio activo' }] },
        { id: 'swiss', name: 'Swiss Medical', plan: 'SMG20', status: 'vigente', effectiveFrom: '', reason: '', updatedAt: now, history: [{ at: now, text: 'Convenio activo' }] },
        { id: 'galeno', name: 'Galeno', plan: 'Plan registrado', status: 'requiere_validacion', effectiveFrom: '', reason: '', updatedAt: now, history: [{ at: now, text: 'Requiere validación de vigencia' }] },
      ],
      appointmentPolicies: { allowCancel: true, cancelLimitHours: 24, allowReschedule: true, confirmPendingCoverage: true },
      documentPolicies: {
        consulta: { dni: 'optional', credential: 'optional', order: 'none' },
        practica: { dni: 'optional', credential: 'recommended', order: 'required' },
      },
    };
  }

  function ensureTurnosStore() {
    const existing = readTurnosStore();
    if (existing && existing.seedISO === localISO(new Date()) && Array.isArray(existing.appointments)) {
      const defaults = seedSharedAppointments();
      const sampleAppointment = defaults.appointments.find((appointment) => appointment.id === 'a8');
      const normalized = {
        ...defaults,
        ...existing,
        appointments: sampleAppointment && !existing.appointments.some((appointment) => appointment.id === sampleAppointment.id)
          ? [...existing.appointments, sampleAppointment]
          : existing.appointments,
        coverageRecords: Array.isArray(existing.coverageRecords) ? existing.coverageRecords : defaults.coverageRecords,
        appointmentPolicies: existing.appointmentPolicies || defaults.appointmentPolicies,
        documentPolicies: existing.documentPolicies || defaults.documentPolicies,
      };
      if (!Array.isArray(existing.coverageRecords) || !existing.appointmentPolicies || !existing.documentPolicies || normalized.appointments !== existing.appointments) {
        try { localStorage.setItem(TURNOS_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) { /* storage opcional */ }
      }
      return normalized;
    }
    const seeded = seedSharedAppointments();
    try { localStorage.setItem(TURNOS_STORAGE_KEY, JSON.stringify(seeded)); } catch (_) { /* storage opcional */ }
    return seeded;
  }

  let sharedTurnos = ensureTurnosStore();

  function openAuthDialog(screen) {
    pendingScreen = screen || 'inicio';
    const dialog = document.getElementById('authDialog');
    const createFields = document.getElementById('createAccessFields');
    creatingAccess = false;
    createFields.hidden = true;
    document.getElementById('authTitle').textContent = portalSession ? 'Cambiar cuenta del portal' : 'Ingresá para gestionar tus turnos';
    document.getElementById('authIdentity').value = portalSession?.email || '';
    document.getElementById('authPassword').value = '';
    document.getElementById('authName').value = '';
    document.getElementById('authName').required = false;
    document.getElementById('authPassword').autocomplete = 'current-password';
    document.getElementById('authSubmitBtn').textContent = 'Ingresar';
    document.getElementById('createAccessBtn').textContent = 'Crear acceso';
    if (!dialog.open) dialog.showModal();
  }

  function showScreen(id) {
    if ((id === 'turnos' || id === 'recetas') && !portalSession) { openAuthDialog(id); return; }
    SCREENS.forEach((s) => {
      document.getElementById('screen-' + s).classList.toggle('is-active', s === id);
    });
    document.querySelectorAll('.app-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.goto === id);
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id === 'notificaciones') renderNotificaciones();
    if (id === 'inicio') renderInicio();
    if (id === 'turnos') renderTurnos();
    if (id === 'recetas') renderRecetas();
  }

  document.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', (event) => { event.preventDefault(); showScreen(el.dataset.goto); }));

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

  const PROFESSIONAL_NAMES = { gomez: 'Dra. Laura Gómez', perez: 'Dr. Martín Pérez', fernandez: 'Dra. Sofía Fernández', romero: 'Dr. Nicolás Romero' };
  const SPECIALTY_NAMES = { gomez: 'Traumatología', perez: 'Traumatología', fernandez: 'Clínica médica', romero: 'Cardiología' };
  const STATUS_LABELS = { confirmado: 'Confirmado', pendiente: 'Pendiente de confirmación', atendido: 'Atendido', ausente: 'No asistió', cancelado: 'Cancelado', ofrecido: 'Oferta disponible' };
  const COVERAGE_LABELS = { vigente: 'Vigente', requiere_validacion: 'Requiere validación', observaciones: 'Con observaciones', suspendido: 'Convenio suspendido' };

  // Mismo criterio que apptCoverageState() en turnos-online.html: convenio registrado + lo que hizo recepción.
  function appointmentCoverageState(appointment) {
    const coverage = appointment.coverage || 'Particular';
    if (coverage === 'Particular') return { key: 'particular', label: 'Particular' };
    if (appointment.coverageReview === 'requires-review') return { key: 'revision', label: 'Requiere revisión' };
    if (appointment.coverageValidatedAt) return { key: 'validada', label: 'Cobertura validada' };
    const status = getCoverageRecord(coverage)?.status || 'requiere_validacion';
    if (status === 'vigente') return { key: 'vigente', label: 'Vigente' };
    if (status === 'suspendido') return { key: 'suspendido', label: 'Convenio suspendido' };
    return { key: 'pendiente', label: 'Cobertura pendiente de validación' };
  }

  // 23/09 · 11:52 (24 h, igual que el panel)
  function formatStamp(value) {
    if (!value) return '';
    const date = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + ' · ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatAppointmentDate(iso) {
    if (!iso) return '';
    const date = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(date);
  }

  function getCoverageRecord(name) {
    return (sharedTurnos?.coverageRecords || []).find((record) => record.name === name) || null;
  }

  function patientAppointments() {
    if (!portalSession) return [];
    const email = String(portalSession.email || '').trim().toLowerCase();
    const dni = String(portalSession.dni || '').replace(/\D/g, '');
    return (sharedTurnos?.appointments || [])
      .filter((appointment) => {
        const appointmentEmail = String(appointment.email || '').trim().toLowerCase();
        const appointmentDni = String(appointment.dni || '').replace(/\D/g, '');
        return (email && appointmentEmail === email) || (dni && appointmentDni === dni);
      })
      .map((appointment) => {
        const professionalId = appointment.professionalId;
        const professional = PROFESSIONAL_NAMES[professionalId] || 'Profesional de la institución';
        const coverage = appointment.coverage || 'Particular';
        const coverageRecord = getCoverageRecord(coverage);
        const rawStatus = appointment.status || 'pendiente';
        const dateTime = appointment.dateISO ? new Date(appointment.dateISO + 'T' + (appointment.time || '00:00') + ':00') : null;
        const hoursToAppointment = dateTime ? (dateTime.getTime() - Date.now()) / 3600000 : -1;
        const policies = sharedTurnos?.appointmentPolicies || { allowCancel: true, cancelLimitHours: 24, allowReschedule: true };
        const canManage = !['cancelado', 'atendido', 'ausente'].includes(rawStatus);
        const canCancel = canManage && policies.allowCancel && hoursToAppointment >= Number(policies.cancelLimitHours || 0);
        const canReschedule = canManage && policies.allowReschedule;
        const cancellationHelp = canManage && !canCancel
          ? (policies.allowCancel ? 'La cancelación online requiere ' + policies.cancelLimitHours + ' h de anticipación.' : 'Para cancelar, comunicate con la institución.')
          : '';
        const coverageState = appointmentCoverageState(appointment);
        const updatedAt = appointment.coverageValidatedAt ? formatStamp(appointment.coverageValidatedAt) : (coverageRecord?.updatedAt ? formatStamp(coverageRecord.updatedAt) : '');
        const coveragePending = coverageState.key === 'pendiente' && canManage;
        return {
          ...appointment,
          profesional: professional,
          especialidad: SPECIALTY_NAMES[professionalId] || 'Consulta',
          fecha: formatAppointmentDate(appointment.dateISO),
          lugar: 'Sede Caballito · Av. Rivadavia 4820',
          estado: (STATUS_LABELS[rawStatus] || rawStatus) + (rawStatus === 'confirmado' && coverageState.key === 'pendiente' ? ' · cobertura pendiente' : ''),
          estadoKey: rawStatus,
          coverageStatus: coverageState.label,
          coverageStateKey: coverageState.key,
          coveragePending,
          coverageUpdated: coverage === 'Particular' ? '' : updatedAt,
          coverageUpdatedVerb: appointment.coverageValidatedAt ? 'Validada' : 'Actualizada',
          coveragePlanLabel: coverage === 'Particular' ? '' : (appointment.coveragePlan || coverageRecord?.plan || 'Sin plan registrado'),
          policyNote: Number(policies.cancelLimitHours)
            ? 'Según la política de la institución, podés cancelar online hasta ' + policies.cancelLimitHours + ' h antes del turno.'
            : 'La institución permite cancelar online sin anticipación mínima.',
          canCancel,
          canReschedule,
          cancellationHelp,
        };
      })
      .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  }

  function saveAppointmentUpdate(id, updater, eventText) {
    const current = readTurnosStore() || ensureTurnosStore();
    const at = Date.now();
    const activity = eventText
      ? [...(current.activity || []), { id: 'portal-' + at.toString(36), at, src: 'patient', text: eventText, short: eventText }].slice(-20)
      : (current.activity || []);
    const next = {
      ...current,
      seedISO: localISO(new Date()),
      appointments: (current.appointments || []).map((appointment) => appointment.id === id ? updater(appointment) : appointment),
      activity,
    };
    sharedTurnos = next;
    try { localStorage.setItem(TURNOS_STORAGE_KEY, JSON.stringify(next)); } catch (_) { showToast('No se pudo guardar el cambio en este navegador.'); }
  }

  const PENDING_COVERAGE_NOTE = 'Tu cobertura necesita ser verificada antes de la atención. Recepción la valida antes de la fecha.';

  function coverageLine(appointment) {
    return 'Cobertura registrada: <b>' + escapeHTML(appointment.coverage || 'Particular') + '</b>'
      + (appointment.coveragePlanLabel ? ' · ' + escapeHTML(appointment.coveragePlanLabel) : '')
      + (appointment.coverageStateKey === 'particular' ? '' : ' · ' + escapeHTML(appointment.coverageStatus));
  }

  function openCancelDialog(appointment) {
    pendingCancellationId = appointment.id;
    document.getElementById('cancelDetails').textContent = appointment.profesional + ' · ' + appointment.especialidad + ' · ' + appointment.fecha + ' a las ' + appointment.time + '. El turno seguirá registrado hasta que confirmes la cancelación.';
    document.getElementById('cancelPolicy').textContent = appointment.policyNote;
    document.getElementById('cancelDialog').showModal();
    document.getElementById('keepAppointmentBtn').focus();
  }

  // Descarga un .ics con el turno: lo abre el calendario del dispositivo
  function downloadCalendarEvent(appointment) {
    const start = appointment.dateISO.replace(/-/g, '') + 'T' + appointment.time.replace(':', '') + '00';
    const endDate = new Date(appointment.dateISO + 'T' + appointment.time + ':00');
    endDate.setMinutes(endDate.getMinutes() + 30);
    const pad = (n) => String(n).padStart(2, '0');
    const end = endDate.getFullYear() + pad(endDate.getMonth() + 1) + pad(endDate.getDate()) + 'T' + pad(endDate.getHours()) + pad(endDate.getMinutes()) + '00';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vertical Salud//Portal del Paciente//ES', 'BEGIN:VEVENT',
      'UID:' + appointment.id + '@portal-vertical-salud', 'DTSTART:' + start, 'DTEND:' + end,
      'SUMMARY:Turno ' + appointment.especialidad + ' · ' + appointment.profesional,
      'LOCATION:Sede Caballito\\, Av. Rivadavia 4820\\, CABA',
      'DESCRIPTION:Llegá 10 minutos antes. Podés gestionar el turno desde el Portal del Paciente.',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'turno-' + appointment.dateISO + '.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Descargamos el evento para tu calendario.');
  }

  function renderPortalIdentity() {
    const greeting = document.querySelector('.app-header-greeting');
    const subtitle = document.querySelector('.app-header-sub');
    const accountBtn = document.getElementById('accountBtn');
    const status = document.getElementById('portalAuthState');
    const signOutButton = document.getElementById('signOutBtn');
    const profileName = document.querySelector('.app-profile-name');
    const profileMeta = document.querySelector('.app-profile-meta');
    if (!greeting || !accountBtn || !status) return;
    if (portalSession) {
      if (signOutButton) signOutButton.hidden = false;
      const firstName = portalSession.nombre || 'Paciente';
      const fullName = [portalSession.nombre, portalSession.apellido].filter(Boolean).join(' ') || 'Paciente';
      greeting.textContent = 'Hola, ' + firstName;
      subtitle.textContent = 'Portal personal · Clínica San Rafael';
      accountBtn.textContent = portalSession.demo ? 'Acceso demo' : 'Mi acceso';
      status.innerHTML = '<span class="app-session-dot" aria-hidden="true"></span>Sesión activa · ' + escapeHTML(fullName) + (portalSession.demo ? ' · cuenta de demostración' : '');
      const avatar = document.querySelector('.app-avatar');
      if (avatar) avatar.textContent = [portalSession.nombre, portalSession.apellido].filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'P';
      if (profileName) profileName.textContent = fullName;
      if (profileMeta) profileMeta.textContent = 'DNI ' + escapeHTML(portalSession.dni || '—') + ' · ' + escapeHTML(portalSession.obraSocial || 'Sin cobertura') + (portalSession.plan ? ' plan ' + escapeHTML(portalSession.plan) : '');
    } else {
      if (signOutButton) signOutButton.hidden = true;
      greeting.textContent = 'Portal del paciente';
      subtitle.textContent = 'Clínica San Rafael';
      accountBtn.textContent = 'Ingresar';
      status.innerHTML = 'Ingresá para consultar y gestionar tus turnos. Podés seguir explorando disponibilidad sin iniciar sesión. <button class="app-inline-link" type="button" id="loginFromHome">Ingresar</button>';
      document.getElementById('loginFromHome')?.addEventListener('click', () => openAuthDialog('turnos'));
      if (profileName) profileName.textContent = 'Acceso no iniciado';
      if (profileMeta) profileMeta.textContent = 'Ingresá para ver tus datos y turnos.';
      const avatar = document.querySelector('.app-avatar');
      if (avatar) avatar.textContent = '?';
    }
    renderInicio();
    renderTurnos();
    renderPortalCoverage();
  }

  // --- Inicio ---
  function renderInicio() {
    const t = patientAppointments().find((appointment) => appointment.dateISO >= localISO(new Date()) && appointment.estadoKey !== 'cancelado' && ['confirmado', 'pendiente'].includes(appointment.estadoKey));
    const card = document.getElementById('proximoTurnoCard');
    card.innerHTML = t ? `
      <div class="app-turno-prof">${escapeHTML(t.profesional)}</div>
      <div class="app-turno-esp">${escapeHTML(t.especialidad)}</div>
      <div class="app-turno-when">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>
        ${escapeHTML(t.fecha)} · ${escapeHTML(t.time)} hs
      </div>
      <div class="app-turno-lugar">${escapeHTML(t.lugar)}</div>
      <div class="app-turno-status">${escapeHTML(t.estado)}</div>
      <div class="app-turno-coverage">${coverageLine(t)}</div>
      ${t.coveragePending ? `<p class="app-coverage-pending">${escapeHTML(PENDING_COVERAGE_NOTE)}</p>` : ''}
      ${t.coverageReview === 'requires-review' ? '<div class="app-coverage-alert" role="status"><b>Revisar cobertura para este turno</b><span>Tu turno sigue registrado. Necesitamos revisar la modalidad de atención.</span><button class="btn btn-secondary btn-sm" data-goto="turnos">Ver opciones</button></div>' : ''}
      <div class="app-turno-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-goto="turnos">Ver detalle</button>
        ${t.canReschedule ? `<a class="btn btn-secondary btn-sm" href="../turnos-online/turnos-online.html?reprogram=${encodeURIComponent(t.id)}">Reprogramar</a>` : ''}
        ${t.canCancel ? `<button class="btn btn-danger-ghost btn-sm" type="button" data-home-cancel="${escapeHTML(t.id)}">Cancelar</button>` : ''}
      </div>
      <div class="app-turno-actions app-turno-actions--quiet">
        <button class="btn btn-ghost btn-sm" type="button" id="btnCalendario">Agregar al calendario</button>
        <button class="btn btn-ghost btn-sm" type="button" id="btnComoLlegar">Cómo llegar</button>
      </div>
      ${t.cancellationHelp ? `<p class="app-policy-note">${escapeHTML(t.cancellationHelp)}</p>` : ''}`
      : `<p style="color: var(--ink-soft); font-size: var(--fs-sm)">${portalSession ? 'No tenés turnos próximos asociados a este acceso.' : 'Ingresá para consultar tus turnos. También podés explorar la disponibilidad.'}</p><a class="btn btn-secondary btn-sm" href="../turnos-online/turnos-online.html">Explorar turnos online</a>`;

    const comoLlegar = document.getElementById('btnComoLlegar');
    if (comoLlegar) comoLlegar.addEventListener('click', () => showToast('Abriendo mapa (simulado)'));
    const calendario = document.getElementById('btnCalendario');
    if (calendario && t) calendario.addEventListener('click', () => downloadCalendarEvent(t));
    const homeCancel = card.querySelector('[data-home-cancel]');
    if (homeCancel && t) homeCancel.addEventListener('click', () => openCancelDialog(t));
    card.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => showScreen(el.dataset.goto)));

    const mini = document.getElementById('notifMini');
    const coverageNotices = patientAppointments().filter((appointment) => appointment.coverageReview === 'requires-review' && appointment.coverageNotifiedAt).map((appointment) => ({ titulo: 'Cambio en tu cobertura', cuerpo: 'Tu turno del ' + appointment.fecha + ' con ' + appointment.profesional + ' sigue registrado. Revisá las opciones en Mis turnos.' }));
    renderRxNotice();
    const rxNotices = rxNotifications().filter((n) => !n.leida).map((n) => ({ titulo: n.titulo, cuerpo: n.cuerpo }));
    mini.innerHTML = [...coverageNotices, ...rxNotices, ...APP_NOTIFICACIONES].slice(0, 2).map((n) => `
      <div class="app-notif-mini-row">
        <div class="app-notif-title">${escapeHTML(n.titulo)}</div>
        <div class="app-notif-body">${escapeHTML(n.cuerpo)}</div>
      </div>`).join('');
  }

  // --- Turnos ---
  function renderTurnos() {
    const all = patientAppointments();
    const now = Date.now();
    const isUpcoming = (appointment) => appointment.estadoKey !== 'cancelado' && appointment.estadoKey !== 'atendido' && appointment.estadoKey !== 'ausente' && new Date(appointment.dateISO + 'T' + appointment.time + ':00').getTime() >= now;
    const upcoming = all.filter(isUpcoming);
    const cancelled = all.filter((appointment) => appointment.estadoKey === 'cancelado');
    const previous = all.filter((appointment) => !isUpcoming(appointment) && appointment.estadoKey !== 'cancelado');

    function appointmentCard(appointment, canManage) {
      const coverageOptions = (sharedTurnos?.coverageRecords || []).filter((record) => record.status !== 'suspendido');
      const review = appointment.coverageReview === 'requires-review';
      const actions = canManage ? `
        <div class="app-list-card-actions">
          ${appointment.canReschedule ? `<a class="btn btn-secondary btn-sm" href="../turnos-online/turnos-online.html?reprogram=${encodeURIComponent(appointment.id)}">Reprogramar</a>` : ''}
          ${appointment.canCancel ? `<button class="btn btn-danger-ghost btn-sm" type="button" data-cancelar="${escapeHTML(appointment.id)}">Cancelar</button>` : ''}
        </div>
        ${appointment.cancellationHelp ? `<p class="app-policy-note">${escapeHTML(appointment.cancellationHelp)}</p>` : ''}` : '';
      const reviewBlock = review ? `
        <div class="app-coverage-alert" role="status">
          <b>Revisar cobertura para este turno</b>
          <span>Tu turno sigue registrado. Hubo un cambio en el convenio y necesitamos revisar la modalidad antes de la fecha.</span>
          ${appointment.coverageNotifiedAt ? '<small>Aviso preparado por la institución.</small>' : ''}
          <div class="app-coverage-actions">
            <label class="sr-only" for="coverage-choice-${escapeHTML(appointment.id)}">Nueva cobertura</label>
            <select class="select select-sm" id="coverage-choice-${escapeHTML(appointment.id)}" data-coverage-choice="${escapeHTML(appointment.id)}">
              ${coverageOptions.map((record) => `<option value="${escapeHTML(record.name)}">${escapeHTML(record.name)} · ${escapeHTML(COVERAGE_LABELS[record.status] || 'Requiere validación')}</option>`).join('')}
              <option value="Particular">Continuar como particular</option>
            </select>
            <button class="btn btn-secondary btn-sm" type="button" data-update-coverage="${escapeHTML(appointment.id)}">Actualizar cobertura</button>
            <button class="btn btn-ghost btn-sm" type="button" data-contact-institution="${escapeHTML(appointment.id)}">Contactar institución</button>
          </div>
        </div>` : '';
      return `
        <article class="app-list-card">
          <div class="app-list-card-head">
            <div><div class="app-list-card-title">${escapeHTML(appointment.profesional)}</div><div class="app-list-card-sub">${escapeHTML(appointment.especialidad)}</div></div>
            <span class="badge ${appointment.estadoKey === 'confirmado' ? 'badge-success' : appointment.estadoKey === 'cancelado' ? 'badge-neutral' : 'badge-pending'}">${escapeHTML(appointment.estado)}</span>
          </div>
          <div class="app-list-card-meta"><b>${escapeHTML(appointment.fecha)} · ${escapeHTML(appointment.time)} hs</b><br>${escapeHTML(appointment.lugar)}</div>
          <div class="app-appointment-detail"><span>Cobertura registrada: <b>${escapeHTML(appointment.coverage || 'Particular')}</b>${appointment.coveragePlanLabel ? ' · ' + escapeHTML(appointment.coveragePlanLabel) : ''}</span><span>Estado: ${escapeHTML(appointment.coverageStatus)}${appointment.coverageUpdated ? ' · ' + appointment.coverageUpdatedVerb + ' ' + escapeHTML(appointment.coverageUpdated) : ''}</span></div>
          ${appointment.coveragePending ? `<p class="app-coverage-pending">${escapeHTML(PENDING_COVERAGE_NOTE)}</p>` : ''}
          ${appointment.coverage && appointment.coverage !== 'Particular' ? '<p class="app-coverage-disclaimer">La vigencia, coseguros y condiciones pueden requerir una nueva validación el día de la atención.</p>' : ''}
          ${reviewBlock}${actions}
        </article>`;
    }

    document.getElementById('turnosProximos').innerHTML = upcoming.length
      ? upcoming.map((appointment) => appointmentCard(appointment, true)).join('')
      : `<p class="app-empty-note">${portalSession ? 'No tenés turnos próximos asociados a este acceso.' : 'Ingresá para consultar tus turnos.'}</p>`;
    document.getElementById('turnosAnteriores').innerHTML = previous.length
      ? previous.map((appointment) => appointmentCard(appointment, false)).join('')
      : '<p class="app-empty-note">Todavía no hay turnos anteriores.</p>';
    document.getElementById('turnosCancelados').innerHTML = cancelled.length
      ? cancelled.map((appointment) => appointmentCard(appointment, false)).join('')
      : '<p class="app-empty-note">No hay turnos cancelados.</p>';

    document.querySelectorAll('[data-cancelar]').forEach((button) => button.addEventListener('click', () => {
      const appointment = all.find((item) => item.id === button.dataset.cancelar);
      if (appointment) openCancelDialog(appointment);
    }));

    document.querySelectorAll('[data-update-coverage]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.updateCoverage;
      const select = document.querySelector(`[data-coverage-choice="${CSS.escape(id)}"]`);
      const coverage = select?.value;
      if (!coverage) return;
      const current = all.find((item) => item.id === id);
      const plan = coverage === 'Particular' ? '' : (getCoverageRecord(coverage)?.plan || '');
      saveAppointmentUpdate(id, (appointment) => ({ ...appointment, coverage, coveragePlan: plan, coverageReview: null, coverageValidatedAt: null, coverageResolution: 'updated', coverageResolvedAt: Date.now() }), current?.patientName + ' actualizó la cobertura registrada para su turno a ' + coverage + '.');
      sharedTurnos = readTurnosStore();
      renderTurnos(); renderInicio(); renderPortalCoverage();
      showToast('Cobertura actualizada. Sujeta a validación por la institución.');
    }));

    document.querySelectorAll('[data-contact-institution]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.contactInstitution;
      saveAppointmentUpdate(id, (appointment) => ({ ...appointment, coverageContactRequestedAt: Date.now() }), 'El paciente pidió contacto para revisar el convenio de su turno.');
      sharedTurnos = readTurnosStore();
      showToast('Solicitud de contacto registrada para recepción.');
    }));
  }

  function renderPortalCoverage() {
    const card = document.getElementById('portalCoverageCard');
    if (!card) return;
    if (!portalSession) {
      card.innerHTML = '<p class="app-empty-note">Ingresá para consultar la cobertura asociada a tu perfil.</p>';
      return;
    }
    const name = portalSession.obraSocial || (portalSession.demo ? APP_PACIENTE.obraSocial : 'Sin cobertura');
    const record = getCoverageRecord(name);
    const status = name === 'Particular' || name === 'Sin cobertura' ? name : (COVERAGE_LABELS[record?.status] || 'Requiere validación');
    const updated = record?.updatedAt ? formatStamp(record.updatedAt) : 'Sin actualización registrada';
    const statusClass = record?.status === 'vigente' ? 'is-ok' : record?.status === 'suspendido' ? 'is-error' : 'is-review';
    card.innerHTML = `
      <div class="app-coverage-head"><div><b>${escapeHTML(name)}</b><small>${escapeHTML(portalSession.plan || record?.plan || 'Sin plan registrado')}</small></div><span class="app-coverage-state ${statusClass}">${escapeHTML(status)}</span></div>
      <div class="app-coverage-updated">Última actualización: ${escapeHTML(updated)}</div>
      <p>El estado refleja el registro disponible actualmente. La vigencia, coseguros, diferenciales y condiciones pueden requerir una nueva validación el día de la atención.</p>
      <small>Si necesitás confirmar condiciones, consultá con la institución.</small>`;
  }

  // --- Pedir turno (drawer) ---
  const scrim = document.getElementById('scrim');
  const drawerTurno = document.getElementById('drawerPedirTurno');
  const drawerEstudio = document.getElementById('drawerEstudio');
  const drawerDoc = document.getElementById('drawerDoc');

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
    [drawerTurno, drawerEstudio, drawerDoc].forEach((d) => { d.classList.remove('is-open'); d.setAttribute('aria-hidden', 'true'); });
    if (drawerReturnFocus && document.body.contains(drawerReturnFocus)) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }
  scrim.addEventListener('click', closeDrawers);
  document.getElementById('closeDrawerTurno').addEventListener('click', closeDrawers);
  document.getElementById('closeDrawerEstudio').addEventListener('click', closeDrawers);
  document.getElementById('closeDrawerDoc').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (drawerTurno.classList.contains('is-open') || drawerEstudio.classList.contains('is-open') || drawerDoc.classList.contains('is-open'))) closeDrawers();
  });

  document.getElementById('fabPedirTurno').addEventListener('click', (e) => {
    const specialties = { 'Cardiología': 'cardio', 'Traumatología': 'trauma', 'Clínica Médica': 'clinica' };
    document.getElementById('especialidadesList').innerHTML = APP_ESPECIALIDADES_DISPONIBLES.map((esp) => {
      const specialtyId = specialties[esp];
      const href = '../turnos-online/turnos-online.html' + (specialtyId ? '?especialidad=' + encodeURIComponent(specialtyId) : '');
      return `<a class="app-especialidad-btn" href="${href}">${escapeHTML(esp)}<span aria-hidden="true"> →</span></a>`;
    }).join('');
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
    const noLeidas = notificationItems().filter((n) => !n.leida).length;
    const badge = document.getElementById('bellBadge');
    badge.hidden = noLeidas === 0;
    badge.textContent = noLeidas;
  }

  const NOTIF_ICONS = {
    turno: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    estudio: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2h6l1 4H8l1-4z"/><path d="M6 6h12l1 15H5L6 6z"/></svg>',
    documentacion: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    receta: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    recordatorio: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>',
  };

  const readCoverageNotifications = new Set();

  function notificationItems() {
    const coverage = patientAppointments()
      .filter((appointment) => appointment.coverageReview === 'requires-review' && appointment.coverageNotifiedAt)
      .map((appointment) => ({
        id: 'coverage-' + appointment.id,
        tipo: 'turno',
        titulo: 'Cambio en tu cobertura',
        cuerpo: 'Tu turno del ' + appointment.fecha + ' con ' + appointment.profesional + ' sigue registrado. Revisá las opciones en Mis turnos.',
        hora: 'Aviso de la institución · WhatsApp y Portal',
        leida: readCoverageNotifications.has(appointment.id),
        appointmentId: appointment.id,
      }));
    return [...coverage, ...rxNotifications(), ...APP_NOTIFICACIONES];
  }

  function renderNotificaciones() {
    const notifications = notificationItems();
    document.getElementById('notifList').innerHTML = notifications.map((n) => `
      <div class="app-notif-row${n.leida ? '' : ' is-unread'}" data-notif="${escapeHTML(n.id)}" role="button" tabindex="0" aria-label="${escapeHTML(n.titulo)}${n.leida ? '' : ', sin leer'}">
        <div class="app-notif-icon">${NOTIF_ICONS[n.tipo] || ''}</div>
        <div class="app-notif-content">
          <div class="app-notif-title">${escapeHTML(n.titulo)}</div>
          <div class="app-notif-body">${escapeHTML(n.cuerpo)}</div>
          <div class="app-notif-hora">${escapeHTML(n.hora)}</div>
        </div>
        ${n.leida ? '' : '<span class="app-notif-dot" aria-hidden="true"></span>'}
      </div>`).join('');

    function marcarLeida(row) {
      const n = notificationItems().find((x) => x.id === row.dataset.notif);
      if (!n) return;
      if (n.rxDocId) {
        showScreen('recetas');
        openDocDrawer(n.rxDocId, null);
        updateBellBadge();
        return;
      }
      if (n.appointmentId) {
        readCoverageNotifications.add(n.appointmentId);
        showScreen('turnos');
        const alert = document.querySelector('#turnosProximos .app-coverage-alert');
        if (alert) { alert.setAttribute('tabindex', '-1'); alert.focus(); }
        updateBellBadge();
        return;
      }
      const original = APP_NOTIFICACIONES.find((x) => x.id === n.id);
      if (original) original.leida = true;
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

  const authDialog = document.getElementById('authDialog');
  const authForm = document.getElementById('authForm');

  function finishAuthentication(session) {
    const destination = pendingScreen;
    authDialog.close();
    writePortalSession(session);
    showScreen(destination);
  }

  document.getElementById('accountBtn').addEventListener('click', () => openAuthDialog(portalSession ? 'perfil' : 'turnos'));
  document.getElementById('closeAuthDialog').addEventListener('click', () => authDialog.close());
  authDialog.addEventListener('click', (event) => { if (event.target === authDialog) authDialog.close(); });
  document.getElementById('createAccessBtn').addEventListener('click', () => {
    creatingAccess = !creatingAccess;
    document.getElementById('createAccessFields').hidden = !creatingAccess;
    document.getElementById('authName').required = creatingAccess;
    document.getElementById('authPassword').autocomplete = creatingAccess ? 'new-password' : 'current-password';
    document.getElementById('authTitle').textContent = creatingAccess ? 'Creá tu acceso al portal' : (portalSession ? 'Cambiar cuenta del portal' : 'Ingresá para gestionar tus turnos');
    document.getElementById('authSubmitBtn').textContent = creatingAccess ? 'Crear acceso' : 'Ingresar';
    document.getElementById('createAccessBtn').textContent = creatingAccess ? 'Ya tengo cuenta' : 'Crear acceso';
    if (creatingAccess) {
      document.getElementById('authIdentity').value = '';
      document.getElementById('authPassword').value = '';
      document.getElementById('authName').focus();
    }
  });
  document.getElementById('demoLoginBtn').addEventListener('click', () => finishAuthentication({
    authenticated: true,
    demo: true,
    nombre: APP_PACIENTE.nombre,
    apellido: APP_PACIENTE.apellido,
    dni: APP_PACIENTE.dni,
    email: 'maria.gonzalez@demo.com',
    obraSocial: APP_PACIENTE.obraSocial,
    plan: APP_PACIENTE.plan,
  }));
  document.getElementById('continueGuestBtn').addEventListener('click', () => {
    pendingScreen = 'inicio';
    authDialog.close();
    writePortalSession(null);
    showScreen('inicio');
  });
  authForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const identity = document.getElementById('authIdentity').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!identity || !password) return;
    const normalizedIdentity = identity.toLowerCase().replace(/\s/g, '');
    const isDemo = normalizedIdentity === 'maria.gonzalez@demo.com' || normalizedIdentity.replace(/\D/g, '') === '32104887';
    if (isDemo && creatingAccess) {
      showToast('Ese acceso está reservado para la cuenta demo. Ingresá otro email o DNI.');
      return;
    }
    if (isDemo) {
      finishAuthentication({ authenticated: true, demo: true, nombre: APP_PACIENTE.nombre, apellido: APP_PACIENTE.apellido, dni: APP_PACIENTE.dni, email: 'maria.gonzalez@demo.com', obraSocial: APP_PACIENTE.obraSocial, plan: APP_PACIENTE.plan });
      return;
    }
    let nombre = 'Paciente';
    let apellido = '';
    if (creatingAccess) {
      const parts = document.getElementById('authName').value.trim().split(/\s+/).filter(Boolean);
      nombre = parts.shift() || 'Paciente';
      apellido = parts.join(' ');
    } else if (identity.includes('@')) {
      const parts = identity.split('@')[0].replace(/[._-]+/g, ' ').split(/\s+/).filter(Boolean);
      nombre = parts.shift() || 'Paciente';
      apellido = parts.join(' ');
    }
    finishAuthentication({
      authenticated: true,
      demo: false,
      nombre,
      apellido,
      dni: identity.includes('@') ? '' : identity,
      email: identity.includes('@') ? identity : '',
      obraSocial: '',
      plan: '',
    });
  });
  document.getElementById('signOutBtn').addEventListener('click', () => {
    writePortalSession(null);
    showScreen('inicio');
    showToast('Sesión cerrada en este dispositivo.');
  });

  document.getElementById('keepAppointmentBtn').addEventListener('click', () => {
    document.getElementById('cancelDialog').close();
    pendingCancellationId = null;
  });
  document.getElementById('cancelForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = pendingCancellationId;
    const current = readTurnosStore();
    const appointment = current?.appointments?.find((item) => item.id === id);
    const sessionEmail = String(portalSession?.email || '').trim().toLowerCase();
    const sessionDni = String(portalSession?.dni || '').replace(/\D/g, '');
    const ownsAppointment = appointment && ((sessionEmail && String(appointment.email || '').trim().toLowerCase() === sessionEmail)
      || (sessionDni && String(appointment.dni || '').replace(/\D/g, '') === sessionDni));
    if (!ownsAppointment || ['cancelado', 'atendido', 'ausente'].includes(appointment.status)) {
      document.getElementById('cancelDialog').close();
      pendingCancellationId = null;
      sharedTurnos = current || ensureTurnosStore();
      renderTurnos();
      const heading = document.querySelector('#screen-turnos .app-screen-title');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
      showToast('El turno ya no está disponible para cancelar.');
      return;
    }
    const policy = current.appointmentPolicies || { allowCancel: true, cancelLimitHours: 24 };
    const hours = (new Date(appointment.dateISO + 'T' + appointment.time + ':00') - Date.now()) / 3600000;
    if (!policy.allowCancel || hours < Number(policy.cancelLimitHours || 0)) {
      document.getElementById('cancelDialog').close();
      pendingCancellationId = null;
      sharedTurnos = current;
      renderTurnos();
      const heading = document.querySelector('#screen-turnos .app-screen-title');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
      showToast('La política de la institución ya no permite cancelar online.');
      return;
    }
    saveAppointmentUpdate(id, (item) => ({ ...item, status: 'cancelado', cancelledAt: Date.now() }), appointment.patientName + ' canceló su turno: ' + appointment.dateISO + ' a las ' + appointment.time + '.');
    sharedTurnos = readTurnosStore();
    document.getElementById('cancelDialog').close();
    pendingCancellationId = null;
    renderTurnos(); renderInicio(); renderPortalCoverage(); updateBellBadge();
    const heading = document.querySelector('#screen-turnos .app-screen-title');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
    showToast('Turno cancelado. La disponibilidad se actualizó.');
  });

  window.addEventListener('storage', (event) => {
    if (event.key === TURNOS_STORAGE_KEY) {
      try { sharedTurnos = event.newValue ? JSON.parse(event.newValue) : ensureTurnosStore(); } catch (_) { sharedTurnos = ensureTurnosStore(); }
      renderInicio(); renderTurnos(); renderPortalCoverage(); updateBellBadge();
      if (document.getElementById('screen-notificaciones').classList.contains('is-active')) renderNotificaciones();
    }
    if (RX && event.key === RX.KEY) {
      renderRecetas(); renderInicio(); updateBellBadge();
      if (document.getElementById('screen-notificaciones').classList.contains('is-active')) renderNotificaciones();
      if (drawerDoc.classList.contains('is-open') && openDocId) paintDocDrawer(openDocId);
    }
    if (event.key === PORTAL_SESSION_KEY) {
      try { const value = event.newValue ? JSON.parse(event.newValue) : null; portalSession = value?.authenticated ? value : null; } catch (_) { portalSession = null; }
      renderPortalIdentity();
    }
  });

  const installButton = document.getElementById('installPortalBtn');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent) return;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    try { promptEvent.prompt(); await promptEvent.userChoice; } catch (_) { /* el diálogo puede cerrarse sin instalar */ }
  });
  window.addEventListener('appinstalled', () => { installButton.hidden = true; deferredInstallPrompt = null; });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => { /* PWA opcional en este entorno */ });
  }

  // --- Recetas y órdenes ---
  let openDocId = null;

  function rxPatient() { return RX ? RX.patientForSession(portalSession) : null; }
  function rxDocs() {
    const patient = rxPatient();
    return patient ? RX.docsForPatient(patient.id, { includeDrafts: false }) : [];
  }
  function rxNoun(d) { return d.kind === 'receta' ? 'receta' : 'orden'; }

  // Avisos de documentos: el texto no incluye contenido médico
  function rxNotifications() {
    if (!RX) return [];
    const recent = Date.now() - 14 * 24 * 3600000;
    return rxDocs()
      .filter((d) => d.notifiedAt && Math.max(d.notifiedAt, d.annulledAt || 0) >= recent)
      .map((d) => {
        const pro = RX.professional(d.professionalId);
        const annulled = d.status === 'anulada';
        const at = annulled ? d.annulledAt : d.notifiedAt;
        return {
          id: 'rx-' + d.id + (annulled ? '-anulada' : ''),
          tipo: 'receta',
          titulo: annulled ? (d.kind === 'receta' ? 'Receta anulada' : 'Orden anulada') : 'Tenés una nueva ' + rxNoun(d) + ' disponible',
          cuerpo: annulled
            ? 'El profesional anuló la ' + rxNoun(d) + ' del ' + RX.fmtDate(d.dateISO) + '. Sigue visible en Recetas y órdenes.'
            : 'Emitida por ' + (pro ? pro.name : 'tu profesional') + '. Podés verla en Recetas y órdenes.',
          hora: RX.channelsLabel(d.channels) + ' · ' + RX.fmtStamp(at),
          leida: !!d.seenByPatient,
          rxDocId: d.id,
          at,
        };
      })
      .sort((a, b) => b.at - a.at);
  }

  function renderRxNotice() {
    const box = document.getElementById('rxNewNotice');
    if (!box) return;
    const unseen = portalSession && RX ? rxDocs().filter((d) => !d.seenByPatient && d.status === 'emitida') : [];
    if (!unseen.length) { box.innerHTML = ''; return; }
    const d = unseen[0];
    const pro = RX.professional(d.professionalId);
    box.innerHTML = `<div class="app-rx-new-card">
        <span class="app-rx-new-ic" aria-hidden="true">${NOTIF_ICONS.receta}</span>
        <div class="app-rx-new-txt"><b>Tenés una nueva ${rxNoun(d)} disponible</b><span>${escapeHTML(RX.kindLabel(d))} · ${escapeHTML(pro ? pro.name : '')}${unseen.length > 1 ? ' · y ' + (unseen.length - 1) + ' más' : ''}</span></div>
        <button class="btn btn-accent btn-sm" type="button" data-rx-open="${escapeHTML(d.id)}">Ver ${rxNoun(d)}</button>
      </div>`;
    box.querySelector('[data-rx-open]').addEventListener('click', () => { showScreen('recetas'); openDocDrawer(d.id, null); });
  }

  function rxStatusLine(d) {
    const key = RX.statusOf(d);
    if (key === 'emitida') return 'hasta ' + RX.fmtDate(d.expiresISO);
    if (key === 'vencida') return 'el ' + RX.fmtDate(d.expiresISO);
    return 'el ' + RX.fmtDate(RX.isoOf(d.annulledAt));
  }

  function rxCard(d) {
    const pro = RX.professional(d.professionalId);
    const key = RX.statusOf(d);
    const detail = d.kind === 'receta' ? RX.usageLine(d) : (RX.ORDER_TYPES[d.orderType] ? RX.ORDER_TYPES[d.orderType].label : '');
    return `<article class="app-list-card app-rx-card${key !== 'emitida' ? ' is-inactive' : ''}">
        <button class="app-rx-open" type="button" data-rx-open="${escapeHTML(d.id)}">
          <span class="app-rx-kind">${escapeHTML(d.kind === 'receta' ? 'Prescripción' : RX.kindLabel(d))}${d.seenByPatient ? '' : '<span class="app-rx-dot">' + (d.status === 'anulada' ? 'Actualizada' : 'Nuevo') + '</span>'}</span>
          <span class="app-list-card-title">${escapeHTML(RX.headline(d))}</span>
          ${detail ? `<span class="app-rx-detail">${escapeHTML(detail)}</span>` : ''}
          <span class="app-rx-meta">Emitida ${escapeHTML(RX.fmtDate(d.dateISO))} · ${escapeHTML(pro ? pro.name : '')}</span>
          <span class="app-rx-status">${RXS.statusTag(d, 'patient')}<span>${escapeHTML(rxStatusLine(d))}</span></span>
          <span class="app-rx-chev" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg></span>
        </button>
        ${key === 'anulada' ? '' : `<div class="app-rx-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-rx-download="${escapeHTML(d.id)}">Descargar</button>
          <button class="btn btn-ghost btn-sm" type="button" data-rx-share="${escapeHTML(d.id)}">Compartir</button>
        </div>`}
      </article>`;
  }

  function renderRecetas() {
    const list = document.getElementById('rxList');
    if (!list) return;
    if (!RX) { list.innerHTML = '<p class="app-empty-note">Este servicio no está disponible sin conexión.</p>'; return; }
    if (!portalSession) { list.innerHTML = '<p class="app-empty-note">Ingresá para ver tus recetas y órdenes.</p>'; return; }
    const docs = rxDocs();
    const recetas = docs.filter((d) => d.kind === 'receta');
    const ordenes = docs.filter((d) => d.kind === 'orden');
    const group = (title, items, empty) => `<div class="app-section-title">${title}</div>` + (items.length ? items.map(rxCard).join('') : `<p class="app-empty-note">${empty}</p>`);
    list.innerHTML = group('Recetas', recetas, 'Todavía no tenés recetas. Cuando un profesional emita una, aparece acá y te avisamos.')
      + group('Órdenes', ordenes, 'Todavía no tenés órdenes para estudios o prestaciones.');
    list.querySelectorAll('[data-rx-open]').forEach((b) => b.addEventListener('click', () => openDocDrawer(b.dataset.rxOpen, b)));
    list.querySelectorAll('[data-rx-download]').forEach((b) => b.addEventListener('click', () => rxDownload(b.dataset.rxDownload)));
    list.querySelectorAll('[data-rx-share]').forEach((b) => b.addEventListener('click', () => rxShare(b.dataset.rxShare)));
  }

  function rxDownload(id) {
    const d = RX.doc(id);
    if (!d) return;
    RXS.downloadHTML(d, 'patient');
    showToast('Descargamos una copia del documento de demostración.');
  }
  async function rxShare(id) {
    const d = RX.doc(id);
    if (!d) return;
    const result = await RXS.share(d);
    if (result === 'copied') showToast('Copiamos un aviso para compartir. No incluye datos médicos.');
    else if (result === 'unavailable') showToast('Compartir no está disponible en este dispositivo.');
  }

  function paintDocDrawer(id) {
    const d = RX.doc(id);
    if (!d) { closeDrawers(); return; }
    document.getElementById('docDrawerTitle').textContent = RX.kindLabel(d);
    document.getElementById('docDrawerBody').innerHTML = RXS.render(d, { audience: 'patient' });
    const actions = document.getElementById('docDrawerActions');
    actions.innerHTML = d.status === 'anulada'
      ? '<p class="app-policy-note">Este documento fue anulado por el profesional. Si tenés dudas, consultá con la institución.</p>'
      : '<button class="btn btn-accent" type="button" id="docDownload">Descargar</button><button class="btn btn-secondary" type="button" id="docShare">Compartir</button>';
    const download = document.getElementById('docDownload');
    const share = document.getElementById('docShare');
    if (download) download.addEventListener('click', () => rxDownload(d.id));
    if (share) share.addEventListener('click', () => rxShare(d.id));
  }

  function openDocDrawer(id, trigger) {
    if (!RX || !RX.doc(id)) return;
    const patient = rxPatient();
    const d = RX.doc(id);
    if (!patient || d.patientId !== patient.id) return;
    openDocId = id;
    paintDocDrawer(id);
    if (!d.seenByPatient) { RX.markSeen([id]); renderRecetas(); renderInicio(); updateBellBadge(); }
    openDrawer(drawerDoc, trigger);
  }

  // Enlaces directos: index.html#recetas o #recetas/<id> (desde el panel profesional o WhatsApp)
  function handleHash() {
    const match = location.hash.match(/^#recetas(?:\/(.+))?$/);
    if (!match) return;
    showScreen('recetas');
    if (match[1] && portalSession) openDocDrawer(decodeURIComponent(match[1]), null);
  }
  window.addEventListener('hashchange', handleHash);

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

  renderPortalIdentity();
  renderEstudios();
  renderRecetas();
  handleHash();
  renderDocumentos();
  updateBellBadge();
})();
