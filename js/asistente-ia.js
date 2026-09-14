// Analista / Agente de IA — panel embebido en el dashboard institucional.
// Responde en base a los datos reales de PACIENTES / ACTIVIDAD_RECIENTE (js/data.js).
// Motor de reglas por palabras clave (sin backend, no es un LLM real).

(function () {
  const PENDIENTES_KEYS = ['info_pendiente', 'doc_pendiente', 'no_iniciado'];

  function listaPacientes(list, detalle) {
    return list.map((p) => `• ${p.nombre} ${p.apellido} (${p.turno} hs)${detalle ? ' — ' + detalle(p) : ''}`).join('<br>');
  }

  function resumenDelDia() {
    const total = PACIENTES.length;
    const listos = PACIENTES.filter((p) => p.estado.key === 'listo').length;
    const pendientes = PACIENTES.filter((p) => PENDIENTES_KEYS.includes(p.estado.key)).length;
    const revision = PACIENTES.filter((p) => p.estado.key === 'revision').length;
    return `Hoy hay <b>${total}</b> pacientes agendados: <b>${listos}</b> listos para atender, <b>${pendientes}</b> con información o documentación pendiente, y <b>${revision}</b> que requieren revisión manual.`;
  }

  function pacientesPendientes() {
    const list = PACIENTES.filter((p) => PENDIENTES_KEYS.includes(p.estado.key));
    if (!list.length) return 'No hay pacientes con información pendiente hoy 🎉';
    return `Estos pacientes tienen información o documentación pendiente:<br>${listaPacientes(list, (p) => p.estado.label)}`;
  }

  function pacientesEnRevision() {
    const list = PACIENTES.filter((p) => p.estado.key === 'revision');
    if (!list.length) return 'Ningún paciente requiere revisión manual en este momento.';
    return `Estos pacientes requieren revisión manual:<br>${listaPacientes(list)}`;
  }

  function pacientesListos() {
    const list = PACIENTES.filter((p) => p.estado.key === 'listo');
    if (!list.length) return 'Todavía ningún paciente está listo para atender.';
    return `Pacientes listos para atender:<br>${listaPacientes(list)}`;
  }

  function proximosTurnos() {
    const list = [...PACIENTES].sort((a, b) => a.turno.localeCompare(b.turno)).slice(0, 5);
    return `Los próximos turnos de hoy son:<br>${listaPacientes(list, (p) => p.profesional.nombre)}`;
  }

  function pacientesDeProfesional(prof) {
    const list = PACIENTES.filter((p) => p.profesional.nombre === prof.nombre);
    if (!list.length) return `${prof.nombre} no tiene pacientes agendados hoy.`;
    return `Pacientes de ${prof.nombre} (${prof.especialidad}) hoy:<br>${listaPacientes(list, (p) => p.estado.label)}`;
  }

  function actividadReciente() {
    if (!ACTIVIDAD_RECIENTE.length) return 'No hay actividad registrada todavía.';
    const lista = ACTIVIDAD_RECIENTE.map((a) => `• <b>${a.paciente}</b> ${a.accion} — ${a.hace}`).join('<br>');
    return `Actividad reciente:<br>${lista}`;
  }

  function responder(mensaje) {
    const m = mensaje.toLowerCase();

    for (const prof of PROFESIONALES) {
      const apellido = prof.nombre.split(' ').pop().toLowerCase();
      if (m.includes(apellido)) return pacientesDeProfesional(prof);
    }

    if (m.includes('resumen') || m.includes('cómo va') || m.includes('como va') || m.includes('estado general')) return resumenDelDia();
    if (m.includes('revisi')) return pacientesEnRevision();
    if (m.includes('pendient')) return pacientesPendientes();
    if (m.includes('listo') || m.includes('completo')) return pacientesListos();
    if (m.includes('turno') || m.includes('próximo') || m.includes('proximo')) return proximosTurnos();
    if (m.includes('actividad') || m.includes('reciente')) return actividadReciente();

    return 'No tengo información sobre eso todavía. Puedo ayudarte con: pacientes pendientes, quién requiere revisión, pacientes listos, próximos turnos, actividad reciente, o pacientes de un profesional puntual.';
  }

  // --- UI wiring ---
  const drawer = document.getElementById('aiDrawer');
  const scrim = document.getElementById('aiScrim');
  const chatBody = document.getElementById('aiChatBody');
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');

  const SUGERENCIAS = [
    '¿Cuál es el resumen del día?',
    '¿Quién requiere revisión?',
    '¿Quién tiene información pendiente?',
    '¿Cuáles son los próximos turnos?',
  ];

  function addBubble(texto, de) {
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble ' + de;
    bubble.innerHTML = texto;
    chatBody.appendChild(bubble);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function enviarMensaje(texto) {
    if (!texto.trim()) return;
    addBubble(texto, 'user');

    const typing = document.createElement('div');
    typing.className = 'ai-typing';
    typing.textContent = 'Analizando datos…';
    chatBody.appendChild(typing);
    chatBody.scrollTop = chatBody.scrollHeight;

    await wait(600);
    typing.remove();
    addBubble(responder(texto), 'ai');
  }

  function openAiDrawer() {
    const patientDrawer = document.getElementById('drawer');
    if (patientDrawer && patientDrawer.classList.contains('is-open')) {
      document.getElementById('drawerClose').click();
    }
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-open');
    input.focus();
  }

  function closeAiDrawer() {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('is-open');
  }

  document.getElementById('aiFabBtn').addEventListener('click', () => {
    if (drawer.classList.contains('is-open')) { closeAiDrawer(); return; }
    if (!chatBody.children.length) {
      addBubble('Hola 👋 Soy el analista de datos de la clínica. Preguntame lo que necesites sobre los pacientes de hoy.', 'ai');
    }
    openAiDrawer();
  });
  document.getElementById('aiDrawerClose').addEventListener('click', closeAiDrawer);
  scrim.addEventListener('click', closeAiDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeAiDrawer();
  });

  document.getElementById('patientTableBody').addEventListener('click', (e) => {
    if (e.target.closest('tr') && drawer.classList.contains('is-open')) closeAiDrawer();
  });

  document.getElementById('aiSuggestions').innerHTML = SUGERENCIAS.map((s) => `<button class="ai-suggestion-chip" type="button">${s}</button>`).join('');
  document.querySelectorAll('.ai-suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => enviarMensaje(chip.textContent));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = input.value;
    input.value = '';
    enviarMensaje(texto);
  });
})();
