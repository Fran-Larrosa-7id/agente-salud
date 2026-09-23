// Prescripción y Órdenes Digitales — estado mock compartido (panel profesional, atención y Portal del Paciente).
// PROTOTIPO: todos los datos son ficticios. El catálogo de medicamentos es de demostración, no es una base
// farmacológica. No hay firma digital, validación regulatoria ni integración con farmacias u obras sociales.
(function (global) {
  const KEY = 'salud_prescripciones_v1';
  const VERSION = 1;

  const INSTITUTION = { name: 'Clínica San Rafael', site: 'Sede Caballito · Av. Rivadavia 4820' };

  const PROFESSIONALS = {
    romero: { id: 'romero', name: 'Dr. Nicolás Romero', specialty: 'Cardiología', license: 'Mat. demo 10245' },
    gomez: { id: 'gomez', name: 'Dra. Laura Gómez', specialty: 'Traumatología', license: 'Mat. demo 20918' },
  };
  // Profesional que usa el panel en esta demo
  const CURRENT_PROFESSIONAL = 'romero';

  const PATIENTS = [
    { id: 'maria', name: 'María González', dni: '32.104.887', birthISO: '1986-04-12', coverage: 'OSDE', plan: '310', email: 'maria.gonzalez@demo.com' },
    { id: 'juan', name: 'Juan Fernández', dni: '28.556.310', birthISO: '1979-08-03', coverage: 'IOMA', plan: '', email: 'juan.fernandez@demo.com' },
    { id: 'camila', name: 'Camila Torres', dni: '38.001.774', birthISO: '1994-02-20', coverage: 'Swiss Medical', plan: 'SMG20', email: 'camila.torres@mail.com' },
    { id: 'lucia', name: 'Lucía Martínez', dni: '29.887.001', birthISO: '1982-11-05', coverage: 'Particular', plan: '', email: 'lucia.martinez@mail.com' },
    { id: 'santiago', name: 'Santiago López', dni: '27.998.410', birthISO: '1978-06-15', coverage: 'Galeno', plan: '', email: 'santiago.lopez@mail.com' },
    { id: 'ana', name: 'Ana Suárez', dni: '35.112.908', birthISO: '1990-09-30', coverage: 'OSDE', plan: '210', email: 'ana.suarez@correo.com' },
  ];

  // Catálogo DE DEMOSTRACIÓN: nombres ficticios a propósito, sin dosis sugeridas ni datos farmacológicos.
  const MED_CATALOG = [
    { id: 'demo-a', name: 'Medicamento Demo A', strength: '500 mg', form: 'Comprimidos', presentations: ['Envase x 10 comprimidos', 'Envase x 20 comprimidos'] },
    { id: 'demo-b', name: 'Medicamento Demo B', strength: '20 mg', form: 'Cápsulas', presentations: ['Envase x 14 cápsulas', 'Envase x 28 cápsulas'] },
    { id: 'demo-c', name: 'Medicamento Demo C', strength: '5 mg/5 ml', form: 'Solución oral', presentations: ['Frasco x 100 ml'] },
    { id: 'demo-d', name: 'Medicamento Demo D', strength: '1 %', form: 'Crema', presentations: ['Pomo x 30 g', 'Pomo x 60 g'] },
    { id: 'demo-e', name: 'Medicamento Demo E', strength: '10 mg', form: 'Comprimidos', presentations: ['Envase x 30 comprimidos'] },
  ];

  const FREQUENCIES = ['Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Cada 24 horas', 'Según indicación médica'];

  // Tipos de orden configurables por la institución. Las prestaciones son ejemplos de la demo.
  const ORDER_TYPES = {
    laboratorio: { label: 'Laboratorio', title: 'Orden de laboratorio', examples: ['Hemograma completo', 'Perfil lipídico', 'Glucemia', 'Hepatograma'] },
    imagenes: { label: 'Diagnóstico por imágenes', title: 'Orden de diagnóstico por imágenes', examples: ['Radiografía de tórax', 'Ecografía abdominal', 'Ecocardiograma', 'Resonancia de rodilla'] },
    kinesiologia: { label: 'Kinesiología', title: 'Orden de kinesiología', examples: ['Sesiones de kinesiología (10)', 'Evaluación kinésica'] },
    interconsulta: { label: 'Interconsulta', title: 'Interconsulta', examples: ['Clínica médica', 'Traumatología', 'Dermatología'] },
    otra: { label: 'Otra', title: 'Orden de prestación', examples: [] },
  };

  const VALIDITY_DAYS = { receta: 30, orden: 60 };

  // ---------- fechas ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function localISO(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function todayISO() { return localISO(new Date()); }
  function isoOf(ms) { return ms ? localISO(new Date(ms)) : ''; }
  function addDaysISO(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return localISO(d);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y;
  }
  function fmtStamp(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function ageFrom(birthISO) {
    const b = new Date(birthISO + 'T00:00:00');
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age -= 1;
    return age;
  }
  function fold(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function digits(value) { return String(value || '').replace(/\D/g, ''); }

  // ---------- semilla ----------
  function seed() {
    const t = todayISO();
    const at = (days, hh, mm) => { const d = new Date(addDaysISO(t, days) + 'T00:00:00'); d.setHours(hh, mm, 0, 0); return d.getTime(); };
    const documents = [
      {
        id: 'seed-rx-maria', kind: 'receta', status: 'emitida', number: 'RX-DEMO-000121', patientId: 'maria', professionalId: 'romero',
        dateISO: addDaysISO(t, -6), expiresISO: addDaysISO(t, -6 + VALIDITY_DAYS.receta), createdAt: at(-6, 10, 42), issuedAt: at(-6, 10, 48),
        med: { id: 'demo-a', name: 'Medicamento Demo A', strength: '500 mg', form: 'Comprimidos', presentation: 'Envase x 20 comprimidos' },
        dose: '1 comprimido', frequency: 'Cada 12 horas', duration: { value: 7, unit: 'días' }, quantity: 1,
        instructions: 'Tomar según indicación médica.', notes: '',
        notifiedAt: at(-6, 10, 48), channels: ['portal', 'whatsapp'], seenByPatient: true,
      },
      {
        id: 'seed-or-maria', kind: 'orden', status: 'emitida', number: 'OR-DEMO-000044', patientId: 'maria', professionalId: 'romero',
        dateISO: addDaysISO(t, -2), expiresISO: addDaysISO(t, -2 + VALIDITY_DAYS.orden), createdAt: at(-2, 11, 5), issuedAt: at(-2, 11, 9),
        orderType: 'laboratorio', service: 'Hemograma completo', instructions: 'Presentar esta orden en el laboratorio de la institución.',
        reason: 'Control programado.', priority: 'habitual',
        notifiedAt: at(-2, 11, 9), channels: ['portal', 'whatsapp'], seenByPatient: true,
      },
      {
        id: 'seed-rx-maria-old', kind: 'receta', status: 'emitida', number: 'RX-DEMO-000098', patientId: 'maria', professionalId: 'romero',
        dateISO: addDaysISO(t, -75), expiresISO: addDaysISO(t, -75 + VALIDITY_DAYS.receta), createdAt: at(-75, 9, 20), issuedAt: at(-75, 9, 26),
        med: { id: 'demo-b', name: 'Medicamento Demo B', strength: '20 mg', form: 'Cápsulas', presentation: 'Envase x 28 cápsulas' },
        dose: '1 cápsula', frequency: 'Cada 24 horas', duration: { value: 30, unit: 'días' }, quantity: 1,
        instructions: 'Tomar según indicación médica.', notes: '',
        notifiedAt: at(-75, 9, 26), channels: ['portal'], seenByPatient: true,
      },
      {
        id: 'seed-rx-juan', kind: 'receta', status: 'anulada', number: 'RX-DEMO-000117', patientId: 'juan', professionalId: 'gomez',
        dateISO: addDaysISO(t, -10), expiresISO: addDaysISO(t, -10 + VALIDITY_DAYS.receta), createdAt: at(-10, 16, 2), issuedAt: at(-10, 16, 6),
        med: { id: 'demo-d', name: 'Medicamento Demo D', strength: '1 %', form: 'Crema', presentation: 'Pomo x 30 g' },
        dose: 'Aplicar una capa fina', frequency: 'Cada 12 horas', duration: { value: 10, unit: 'días' }, quantity: 1,
        instructions: 'Aplicar según indicación médica.', notes: '',
        notifiedAt: at(-10, 16, 6), channels: ['portal'], seenByPatient: true,
        annulledAt: at(-10, 16, 31), annulReason: 'Error en la presentación indicada',
      },
      {
        id: 'seed-or-juan', kind: 'orden', status: 'emitida', number: 'OR-DEMO-000041', patientId: 'juan', professionalId: 'gomez',
        dateISO: addDaysISO(t, -10), expiresISO: addDaysISO(t, -10 + VALIDITY_DAYS.orden), createdAt: at(-10, 16, 10), issuedAt: at(-10, 16, 12),
        orderType: 'kinesiologia', service: 'Sesiones de kinesiología (10)', instructions: 'Coordinar los turnos con el servicio de kinesiología.',
        reason: '', priority: 'habitual', notifiedAt: at(-10, 16, 12), channels: ['portal'], seenByPatient: true,
      },
      {
        id: 'seed-draft-camila', kind: 'orden', status: 'borrador', number: '', patientId: 'camila', professionalId: 'romero',
        dateISO: addDaysISO(t, -1), expiresISO: '', createdAt: at(-1, 17, 40), issuedAt: null,
        orderType: 'interconsulta', service: 'Clínica médica', instructions: '', reason: 'Evaluación general.', priority: 'habitual',
      },
    ];
    return {
      version: VERSION,
      documents,
      counters: { receta: 124, orden: 45 },
      channels: { whatsapp: true, email: false },
    };
  }

  // ---------- persistencia (solo esta clave; nunca localStorage.clear) ----------
  let memory = null;
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === VERSION && Array.isArray(parsed.documents)) return parsed;
      }
    } catch (_) { /* storage no disponible: se usa memoria */ }
    if (memory) return memory;
    const fresh = seed();
    write(fresh);
    return fresh;
  }
  function write(state) {
    memory = state;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* sin persistencia: queda en memoria */ }
    return state;
  }
  function reset() {
    memory = null;
    try { localStorage.removeItem(KEY); } catch (_) { /* nada que borrar */ }
    return read();
  }
  function update(mutator) {
    const state = read();
    const next = mutator(JSON.parse(JSON.stringify(state))) || state;
    return write(next);
  }

  // ---------- consultas ----------
  function patient(id) { return PATIENTS.find((p) => p.id === id) || null; }
  function professional(id) { return PROFESSIONALS[id] || null; }
  function doc(id) { return read().documents.find((d) => d.id === id) || null; }

  function searchPatients(query) {
    const q = fold(query).trim();
    const qd = digits(query);
    if (!q) return PATIENTS.slice();
    return PATIENTS.filter((p) => fold(p.name).includes(q) || (qd.length >= 2 && digits(p.dni).includes(qd)));
  }
  function searchMeds(query) {
    const q = fold(query).trim();
    if (!q) return MED_CATALOG.slice();
    return MED_CATALOG.filter((m) => fold(m.name + ' ' + m.strength + ' ' + m.form).includes(q));
  }

  // Paciente del Portal: se identifica por DNI o email (igual que los turnos)
  function patientForSession(session) {
    if (!session) return null;
    const dni = digits(session.dni);
    const email = String(session.email || '').trim().toLowerCase();
    return PATIENTS.find((p) => (dni && digits(p.dni) === dni) || (email && p.email === email)) || null;
  }

  // Estado derivado: VENCIDA no se guarda, se calcula con la vigencia
  function statusOf(d) {
    if (!d) return 'borrador';
    if (d.status === 'emitida' && d.expiresISO && d.expiresISO < todayISO()) return 'vencida';
    return d.status;
  }
  const STATUS_LABELS = { borrador: 'Borrador', emitida: 'Emitida', anulada: 'Anulada', vencida: 'Vencida' };
  // El paciente ve «Vigente» en lugar de «Emitida»
  const PATIENT_STATUS_LABELS = { emitida: 'Vigente', anulada: 'Anulada', vencida: 'Vencida' };

  function kindLabel(d) { return d.kind === 'receta' ? 'Prescripción' : (ORDER_TYPES[d.orderType]?.title || 'Orden'); }
  function kindShort(d) { return d.kind === 'receta' ? 'Prescripción' : 'Orden · ' + (ORDER_TYPES[d.orderType]?.label || 'Otra'); }
  function headline(d) {
    if (d.kind === 'receta') return d.med ? d.med.name + ' ' + d.med.strength : 'Medicamento sin elegir';
    return d.service || 'Prestación sin completar';
  }
  function usageLine(d) {
    if (d.kind !== 'receta') return '';
    const parts = [d.dose, d.frequency ? d.frequency.charAt(0).toLowerCase() + d.frequency.slice(1) : ''].filter(Boolean).join(' ');
    const dur = d.duration && d.duration.value ? 'durante ' + d.duration.value + ' ' + d.duration.unit : '';
    return [parts, dur].filter(Boolean).join(' · ');
  }

  function docsForPatient(patientId, { includeDrafts = true } = {}) {
    return read().documents
      .filter((d) => d.patientId === patientId && (includeDrafts || d.status !== 'borrador'))
      .sort((a, b) => (b.issuedAt || b.createdAt) - (a.issuedAt || a.createdAt));
  }

  // ---------- acciones ----------
  function newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function saveDraft(draft) {
    let saved = null;
    update((state) => {
      const now = Date.now();
      const existing = state.documents.find((d) => d.id === draft.id);
      if (existing && existing.status !== 'borrador') { saved = existing; return state; }
      saved = { ...draft, id: draft.id || newId('doc'), status: 'borrador', number: '', createdAt: existing?.createdAt || now, updatedAt: now };
      state.documents = existing ? state.documents.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...state.documents];
      return state;
    });
    return saved;
  }

  function emit(id) {
    let emitted = null;
    update((state) => {
      const d = state.documents.find((x) => x.id === id);
      if (!d || d.status !== 'borrador') { emitted = d || null; return state; }
      const counterKey = d.kind === 'receta' ? 'receta' : 'orden';
      state.counters[counterKey] = (state.counters[counterKey] || 0) + 1;
      const now = Date.now();
      const channels = ['portal'].concat(state.channels.whatsapp ? ['whatsapp'] : [], state.channels.email ? ['email'] : []);
      Object.assign(d, {
        status: 'emitida',
        number: (d.kind === 'receta' ? 'RX' : 'OR') + '-DEMO-' + String(state.counters[counterKey]).padStart(6, '0'),
        dateISO: d.dateISO || todayISO(),
        issuedAt: now,
        notifiedAt: now,
        channels,
        seenByPatient: false,
      });
      d.expiresISO = addDaysISO(d.dateISO, VALIDITY_DAYS[d.kind]);
      emitted = d;
      return state;
    });
    return emitted;
  }

  function annul(id, reason) {
    let result = null;
    update((state) => {
      const d = state.documents.find((x) => x.id === id);
      if (!d || d.status !== 'emitida') { result = d || null; return state; }
      d.status = 'anulada';
      d.annulledAt = Date.now();
      d.annulReason = reason || '';
      d.seenByPatient = false;
      result = d;
      return state;
    });
    return result;
  }

  // Crea un borrador independiente; el original no se toca
  function duplicate(id) {
    const source = doc(id);
    if (!source) return null;
    const copy = JSON.parse(JSON.stringify(source));
    ['number', 'issuedAt', 'notifiedAt', 'channels', 'seenByPatient', 'annulledAt', 'annulReason', 'expiresISO', 'updatedAt'].forEach((k) => delete copy[k]);
    Object.assign(copy, { id: newId('doc'), status: 'borrador', dateISO: todayISO(), duplicatedFrom: source.number || source.id, professionalId: CURRENT_PROFESSIONAL, createdAt: Date.now() });
    update((state) => { state.documents = [copy, ...state.documents]; return state; });
    return copy;
  }

  function discardDraft(id) {
    update((state) => { state.documents = state.documents.filter((d) => !(d.id === id && d.status === 'borrador')); return state; });
  }

  function markSeen(ids) {
    update((state) => { state.documents.forEach((d) => { if (ids.includes(d.id)) d.seenByPatient = true; }); return state; });
  }

  function setChannel(channel, on) {
    update((state) => { state.channels[channel] = !!on; return state; });
  }

  const CHANNEL_LABELS = { portal: 'Portal', whatsapp: 'WhatsApp', email: 'Email' };
  function channelsLabel(list) { return (list || ['portal']).map((c) => CHANNEL_LABELS[c] || c).join(' · '); }

  // ---------- código de demostración ----------
  // Patrón visual con aspecto de código 2D. NO es un QR decodificable ni valida nada.
  function demoCodeSVG(text, size) {
    const n = 21;
    let h = 2166136261;
    const cells = [];
    for (let i = 0; i < n * n; i += 1) {
      h ^= (text.charCodeAt(i % text.length) + i) & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
      cells.push((h >>> 7) & 1);
    }
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let rects = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (finder(r, c)) continue;
        if (cells[r * n + c]) rects += '<rect x="' + c + '" y="' + r + '" width="1" height="1"/>';
      }
    }
    const eye = (x, y) => '<path d="M' + x + ' ' + y + 'h7v7h-7z M' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5z" fill-rule="evenodd"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3"/>';
    return '<svg class="rx-code" viewBox="-1 -1 23 23" width="' + (size || 72) + '" height="' + (size || 72) + '" role="img" aria-label="Código de demostración, sin validez" shape-rendering="crispEdges"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/><g fill="currentColor">' + rects + eye(0, 0) + eye(n - 7, 0) + eye(0, n - 7) + '</g></svg>';
  }

  global.RxStore = {
    KEY, INSTITUTION, PROFESSIONALS, CURRENT_PROFESSIONAL, PATIENTS, MED_CATALOG, FREQUENCIES, ORDER_TYPES, VALIDITY_DAYS,
    STATUS_LABELS, PATIENT_STATUS_LABELS, CHANNEL_LABELS,
    todayISO, isoOf, addDaysISO, fmtDate, fmtStamp, ageFrom, fold, digits,
    read, write, reset, update,
    patient, professional, doc, searchPatients, searchMeds, patientForSession, docsForPatient,
    statusOf, kindLabel, kindShort, headline, usageLine, channelsLabel,
    saveDraft, emit, annul, duplicate, discardDraft, markSeen, setChannel,
    demoCodeSVG,
  };
})(window);
