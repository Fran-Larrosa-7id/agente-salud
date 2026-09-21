// Guiones de conversación mock — Gestor de turnos por WhatsApp
// Cada paso es del bot, del paciente o del sistema. Un paso con `opciones` simula los botones
// interactivos de WhatsApp; cada opción tiene su propia rama `siguiente`.
//
// Principio: la IA solo interpreta la intención. La disponibilidad la decide el motor de turnos
// consultando la agenda (fuente de verdad). `traza` documenta qué capa hizo qué en cada paso
// y se muestra en el panel "Qué pasa por detrás".
//   capa: 'ia' (interpreta) · 'motor' (valida reglas) · 'agenda' (fuente de verdad)

// Un horario mostrado es solo una OPCIÓN DISPONIBLE. Recién tras revalidar y reservar es un TURNO CONFIRMADO.
function waConfirmar(prof, esp, fecha, hora, extra) {
  return [
    { de: 'sistema', texto: 'Revalidando disponibilidad…', traza: [
      { capa: 'motor', texto: 'Revalida ' + fecha + ' · ' + hora + ' antes de reservar' },
      { capa: 'agenda', texto: 'Horario libre → reserva registrada' },
    ] },
    { de: 'bot', tipo: 'confirmado', titulo: 'Turno confirmado', datos: [
      ['Profesional', prof], ['Especialidad', esp], ['Fecha', fecha], ['Hora', hora],
    ], texto: 'Te vamos a recordar 24 hs antes.' + (extra ? ' ' + extra : '') },
  ];
}
const WA_SOFIA = 'Dra. Sofía Martínez';

const WA_ESCENARIOS = {
  solicitud: {
    nombre: 'Solicitar turno',
    pasos: [
      { de: 'user', texto: 'Hola, quiero sacar un turno con Cardiología', traza: [
        { capa: 'ia', texto: 'Interpreta: especialidad = Cardiología' },
        { capa: 'motor', texto: 'Pide a la agenda los próximos turnos libres' },
        { capa: 'agenda', texto: 'Devuelve 3 horarios disponibles' },
      ] },
      { de: 'bot', texto: '¡Hola María! Estos son los horarios disponibles con ' + WA_SOFIA + '. Elegí uno y lo reservo:', rotulo: 'Opciones disponibles · aún no reservadas',
        opciones: [
          { texto: 'Mar 16/09 · 10:30', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'martes 16/09', '10:30') },
          { texto: 'Mar 16/09 · 14:00', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'martes 16/09', '14:00') },
          { texto: 'Mié 17/09 · 09:00', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'miércoles 17/09', '09:00') },
        ] },
    ],
  },
  noDisponible: {
    nombre: 'Profesional no disponible',
    pasos: [
      { de: 'user', texto: 'Quiero turno con el Dr. Larrosa el 18/09', traza: [
        { capa: 'ia', texto: 'Interpreta: profesional = Dr. Larrosa · fecha = 18/09' },
        { capa: 'motor', texto: 'Consulta disponibilidad con sus reglas' },
        { capa: 'agenda', texto: '18/09 · Dr. Larrosa → NO DISPONIBLE. Motivo interno: vacaciones (no se informa al paciente)' },
        { capa: 'motor', texto: 'Busca las próximas fechas libres del mismo profesional' },
      ] },
      { de: 'bot', texto: 'El Dr. Larrosa no tiene disponibilidad ese día.\n\nEncontré estas próximas opciones:', rotulo: 'Opciones disponibles · aún no reservadas',
        opciones: [
          { texto: 'Mié 17/09 · 15:30', siguiente: waConfirmar('Dr. Larrosa', 'Clínica Médica', 'miércoles 17/09', '15:30') },
          { texto: 'Lun 22/09 · 09:00', siguiente: waConfirmar('Dr. Larrosa', 'Clínica Médica', 'lunes 22/09', '09:00') },
          { texto: 'Lun 22/09 · 11:30', siguiente: waConfirmar('Dr. Larrosa', 'Clínica Médica', 'lunes 22/09', '11:30') },
        ] },
    ],
  },
  ocupado: {
    nombre: 'Horario que se ocupa',
    pasos: [
      { de: 'user', texto: 'Necesito un turno de Clínica Médica el jueves a la mañana', traza: [
        { capa: 'ia', texto: 'Interpreta: Clínica Médica · jueves · franja mañana' },
        { capa: 'motor', texto: 'Consulta disponibilidad' },
        { capa: 'agenda', texto: 'Devuelve jueves 18/09 · 10:00 y 12:00 libres' },
      ] },
      { de: 'bot', texto: 'Tengo estos horarios el jueves 18/09 con el Dr. Martín Gómez:', rotulo: 'Opciones disponibles · aún no reservadas',
        opciones: [
          { texto: 'Jue 18/09 · 10:00', siguiente: [
            { de: 'sistema', texto: 'Revalidando disponibilidad…', traza: [
              { capa: 'motor', texto: 'Revalida jueves 18/09 · 10:00 antes de reservar' },
              { capa: 'agenda', texto: '10:00 tomado hace instantes por otro paciente → NO SE RESERVA' },
              { capa: 'motor', texto: 'Recalcula alternativas cercanas' },
            ] },
            { de: 'bot', texto: 'Ese horario acaba de ocuparse. Estos siguen disponibles:', rotulo: 'Opciones disponibles · aún no reservadas',
              opciones: [
                { texto: 'Jue 18/09 · 10:30', siguiente: waConfirmar('Dr. Martín Gómez', 'Clínica Médica', 'jueves 18/09', '10:30') },
                { texto: 'Jue 18/09 · 11:00', siguiente: waConfirmar('Dr. Martín Gómez', 'Clínica Médica', 'jueves 18/09', '11:00') },
                { texto: 'Jue 18/09 · 11:30', siguiente: waConfirmar('Dr. Martín Gómez', 'Clínica Médica', 'jueves 18/09', '11:30') },
              ] },
          ] },
          { texto: 'Jue 18/09 · 12:00', siguiente: waConfirmar('Dr. Martín Gómez', 'Clínica Médica', 'jueves 18/09', '12:00') },
        ] },
    ],
  },
  recordatorio: {
    nombre: 'Recordatorio automático',
    pasos: [
      { de: 'bot', texto: 'Hola María 👋 Te recordamos tu turno de mañana martes 16/09 a las 10:30 con ' + WA_SOFIA + ' (Cardiología). ¿Confirmás tu asistencia?',
        opciones: [
          { texto: 'Confirmar', siguiente: [
            { de: 'bot', texto: '¡Gracias por confirmar! Te esperamos mañana a las 10:30. 📍 Av. Libertador 1234.' },
          ] },
          { texto: 'Reprogramar', siguiente: [
            { de: 'sistema', texto: 'Consultando próximos horarios…', traza: [
              { capa: 'motor', texto: 'Pide a la agenda horarios libres del mismo profesional' },
              { capa: 'agenda', texto: 'Devuelve 2 horarios disponibles' },
            ] },
            { de: 'bot', texto: 'Sin problema. Estos son los próximos horarios disponibles:', rotulo: 'Opciones disponibles · aún no reservadas',
              opciones: [
                { texto: 'Jue 18/09 · 11:00', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'jueves 18/09', '11:00', 'Liberamos el turno anterior.') },
                { texto: 'Vie 19/09 · 09:30', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'viernes 19/09', '09:30', 'Liberamos el turno anterior.') },
              ] },
          ] },
          { texto: 'Cancelar', siguiente: [
            { de: 'sistema', texto: 'Turno del martes 16/09 10:30 cancelado y horario liberado en la agenda.', traza: [
              { capa: 'agenda', texto: 'Turno cancelado · horario vuelve a estar disponible' },
            ] },
            { de: 'bot', texto: 'Cancelamos tu turno del martes 16/09 10:30. Escribinos cuando necesites uno nuevo 🙂' },
          ] },
        ] },
    ],
  },
  cancelacion: {
    nombre: 'Cancelar turno',
    pasos: [
      { de: 'user', texto: 'Necesito cancelar mi turno de mañana', traza: [
        { capa: 'ia', texto: 'Interpreta: intención = cancelar turno' },
        { capa: 'motor', texto: 'Identifica el turno del paciente y valida que se pueda cancelar' },
        { capa: 'agenda', texto: 'Turno cancelado · horario liberado' },
      ] },
      { de: 'bot', texto: 'Entendido, María. Cancelé tu turno del martes 16/09 10:30 con ' + WA_SOFIA + '. ¿Querés que te ayude a reprogramarlo?',
        opciones: [
          { texto: 'Sí, reprogramar', siguiente: [
            { de: 'bot', texto: 'Estos son los próximos horarios disponibles con ' + WA_SOFIA + ':', rotulo: 'Opciones disponibles · aún no reservadas',
              opciones: [
                { texto: 'Jue 18/09 · 11:00', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'jueves 18/09', '11:00') },
                { texto: 'Vie 19/09 · 09:30', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'viernes 19/09', '09:30') },
              ] },
          ] },
          { texto: 'No, gracias', siguiente: [
            { de: 'bot', texto: 'Listo, cualquier cosa estoy para ayudarte 🙂' },
          ] },
        ] },
    ],
  },
  reprogramacion: {
    nombre: 'Reprogramar turno',
    pasos: [
      { de: 'user', texto: 'Quiero cambiar mi turno a otro día', traza: [
        { capa: 'ia', texto: 'Interpreta: intención = reprogramar' },
        { capa: 'motor', texto: 'Busca horarios libres del mismo profesional' },
        { capa: 'agenda', texto: 'Devuelve 2 horarios disponibles' },
      ] },
      { de: 'bot', texto: 'Claro, estos son los próximos horarios disponibles con ' + WA_SOFIA + ':', rotulo: 'Opciones disponibles · aún no reservadas',
        opciones: [
          { texto: 'Jue 18/09 · 11:00', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'jueves 18/09', '11:00', 'Cancelamos el anterior automáticamente.') },
          { texto: 'Vie 19/09 · 09:30', siguiente: waConfirmar(WA_SOFIA, 'Cardiología', 'viernes 19/09', '09:30', 'Cancelamos el anterior automáticamente.') },
        ] },
    ],
  },
  operador: {
    nombre: 'Hablar con un operador',
    pasos: [
      { de: 'user', texto: 'Prefiero hablar con alguien, es un caso particular', traza: [
        { capa: 'ia', texto: 'Detecta pedido de atención humana' },
        { capa: 'motor', texto: 'No intenta resolverlo: deriva la conversación' },
      ] },
      { de: 'bot', texto: 'Te voy a derivar con un operador de la clínica.' },
      { de: 'sistema', texto: 'Conversación transferida a Recepción · el operador ve el historial completo.', traza: [
        { capa: 'motor', texto: 'Transfiere el chat a la bandeja de Recepción con contexto' },
      ] },
    ],
  },
};

const WA_AUTOMATIZACIONES = [
  {
    id: 'solicitud',
    nombre: 'Solicitud de turno por chat',
    descripcion: 'El paciente pide un turno por WhatsApp y el asistente ofrece los horarios disponibles según especialidad.',
    disparador: 'Mensaje entrante con intención de "sacar turno"',
    accion: 'Consultar agenda, ofrecer horarios y reservar tras revalidar',
    activo: true,
  },
  {
    id: 'recordatorio',
    nombre: 'Recordatorio 24 hs antes',
    descripcion: 'Se envía un recordatorio automático con opción de confirmar, reprogramar o cancelar.',
    disparador: '24 hs antes del turno',
    accion: 'Enviar recordatorio con Confirmar / Reprogramar / Cancelar',
    activo: true,
  },
  {
    id: 'reprogramacion',
    nombre: 'Reprogramación automática',
    descripcion: 'Si el paciente cancela, se le ofrecen los próximos horarios disponibles sin intervención humana.',
    disparador: 'Paciente responde "Cancelar" o "Reprogramar"',
    accion: 'Liberar el horario y ofrecer nuevas opciones',
    activo: true,
  },
  {
    id: 'encuesta',
    nombre: 'Encuesta post-consulta',
    descripcion: 'A las 2 horas de finalizada la consulta, se envía una encuesta corta de satisfacción.',
    disparador: '2 hs después de un turno "Atendido"',
    accion: 'Enviar encuesta corta de satisfacción',
    activo: false,
  },
];

const WA_STATS = [
  { label: 'Turnos gestionados esta semana', valor: '184', foot: '+22% vs. semana anterior', tono: 'accent' },
  { label: 'Tasa de confirmación', valor: '91%', foot: 'Sobre recordatorios enviados', tono: 'accent' },
  { label: 'Recordatorios enviados', valor: '212', foot: 'Últimos 7 días', tono: '' },
  { label: 'Ausentismo evitado', valor: '37', foot: 'Turnos reprogramados a tiempo', tono: '' },
];

const WA_ACTIVIDAD = [
  { paciente: 'María González', accion: 'confirmó su turno del 16/09 10:30', hace: 'Hace 3 min' },
  { paciente: 'Roberto Aguirre', accion: 'reprogramó su turno para el 18/09', hace: 'Hace 20 min' },
  { paciente: 'Carla Suárez', accion: 'solicitó un turno de Clínica Médica', hace: 'Hace 35 min' },
  { paciente: 'Diego Molina', accion: 'canceló su turno del 17/09', hace: 'Hace 1 h' },
  { paciente: 'Florencia Díaz', accion: 'confirmó su turno del 15/09 12:00', hace: 'Hace 2 h' },
];

// ---------- Vínculo panel de automatizaciones <-> conversación (estado en localStorage) ----------
const WA_KEY_FLUJOS = 'wa-flujos';
const WA_KEY_ACTIVIDAD = 'wa-actividad-extra';

function waLeer(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}
function waEscribir(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin persistencia: queda en memoria */ }
}

function waCargarFlujos() {
  const guardado = waLeer(WA_KEY_FLUJOS, {});
  WA_AUTOMATIZACIONES.forEach((f) => { if (typeof guardado[f.id] === 'boolean') f.activo = guardado[f.id]; });
}
function waFlujo(id) { return WA_AUTOMATIZACIONES.find((f) => f.id === id); }
function waFlujoActivo(id) { const f = waFlujo(id); return !f || f.activo; }
function waSetFlujo(id, activo) {
  const f = waFlujo(id);
  if (!f) return;
  f.activo = activo;
  const guardado = waLeer(WA_KEY_FLUJOS, {});
  guardado[id] = activo;
  waEscribir(WA_KEY_FLUJOS, guardado);
}

function waRegistrarActividad(paciente, accion) {
  const lista = waLeer(WA_KEY_ACTIVIDAD, []);
  lista.unshift({ paciente, accion, ts: Date.now() });
  waEscribir(WA_KEY_ACTIVIDAD, lista.slice(0, 6));
}
function waHace(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return 'Hace ' + min + ' min';
  return 'Hace ' + Math.floor(min / 60) + ' h';
}
function waActividadCompleta() {
  const extra = waLeer(WA_KEY_ACTIVIDAD, []).map((a) => ({ paciente: a.paciente, accion: a.accion, hace: waHace(a.ts) }));
  return extra.concat(WA_ACTIVIDAD).slice(0, 8);
}

// Cada escenario depende de un flujo. Si el flujo está apagado, la conversación cambia.
const WA_OPERADOR = 'Te voy a derivar con un operador de la clínica.';
Object.assign(WA_ESCENARIOS.solicitud, {
  flujo: 'solicitud',
  actividad: 'solicitó un turno de Cardiología',
  sinFlujo: [WA_ESCENARIOS.solicitud.pasos[0], { de: 'bot', texto: WA_OPERADOR }],
});
Object.assign(WA_ESCENARIOS.recordatorio, {
  flujo: 'recordatorio',
  actividad: 'recibió el recordatorio de su turno',
  sinFlujo: [{ de: 'sistema', texto: 'No se envió el recordatorio: la paciente no recibe ningún mensaje automático.' }],
});
Object.assign(WA_ESCENARIOS.cancelacion, {
  flujo: 'reprogramacion',
  actividad: 'canceló su turno del 16/09',
  sinFlujo: [WA_ESCENARIOS.cancelacion.pasos[0], { de: 'bot', texto: 'Recibimos tu solicitud de cancelación. Un operador la va a gestionar y te confirma por acá.' }],
});
Object.assign(WA_ESCENARIOS.reprogramacion, {
  flujo: 'reprogramacion',
  actividad: 'pidió reprogramar su turno',
  sinFlujo: [WA_ESCENARIOS.reprogramacion.pasos[0], { de: 'bot', texto: WA_OPERADOR }],
});

Object.assign(WA_ESCENARIOS.noDisponible, {
  flujo: 'solicitud',
  actividad: 'pidió turno con el Dr. Larrosa (sin disponibilidad, se ofrecieron alternativas)',
  sinFlujo: [WA_ESCENARIOS.noDisponible.pasos[0], { de: 'bot', texto: WA_OPERADOR }],
});
Object.assign(WA_ESCENARIOS.ocupado, {
  flujo: 'solicitud',
  actividad: 'pidió turno de Clínica Médica (un horario se ocupó y se ofrecieron alternativas)',
  sinFlujo: [WA_ESCENARIOS.ocupado.pasos[0], { de: 'bot', texto: WA_OPERADOR }],
});
Object.assign(WA_ESCENARIOS.operador, {
  flujo: null,
  actividad: 'pidió hablar con una persona y fue derivada a Recepción',
  sinFlujo: WA_ESCENARIOS.operador.pasos,
});

waCargarFlujos();
