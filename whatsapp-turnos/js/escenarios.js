// Guiones de conversación mock — Gestor de turnos por WhatsApp
// Cada paso es del bot o del paciente. Un paso con `opciones` simula los botones interactivos
// de WhatsApp; cada opción tiene su propia rama `siguiente` para que la respuesta del bot
// dependa de lo que el usuario efectivamente eligió.

const WA_ESCENARIOS = {
  solicitud: {
    nombre: 'Solicitar turno',
    pasos: [
      { de: 'user', texto: 'Hola, quiero sacar un turno con Cardiología' },
      { de: 'bot', texto: '¡Hola María! Puedo ayudarte 😊 Elegí un horario disponible con Dra. Sofía Martínez:',
        opciones: [
          { texto: 'Mar 16/09 · 10:30', siguiente: [
            { de: 'bot', texto: 'Perfecto ✅ Tu turno con Dra. Sofía Martínez (Cardiología) quedó agendado para el martes 16/09 a las 10:30. Te vamos a recordar 24 hs antes.' },
          ] },
          { texto: 'Mar 16/09 · 14:00', siguiente: [
            { de: 'bot', texto: 'Perfecto ✅ Tu turno con Dra. Sofía Martínez (Cardiología) quedó agendado para el martes 16/09 a las 14:00. Te vamos a recordar 24 hs antes.' },
          ] },
          { texto: 'Mié 17/09 · 09:00', siguiente: [
            { de: 'bot', texto: 'Perfecto ✅ Tu turno con Dra. Sofía Martínez (Cardiología) quedó agendado para el miércoles 17/09 a las 09:00. Te vamos a recordar 24 hs antes.' },
          ] },
        ] },
    ],
  },
  recordatorio: {
    nombre: 'Recordatorio automático',
    pasos: [
      { de: 'bot', texto: 'Hola María 👋 Te recordamos tu turno de mañana martes 16/09 a las 10:30 con Dra. Sofía Martínez (Cardiología). ¿Confirmás tu asistencia?',
        opciones: [
          { texto: 'Confirmar', siguiente: [
            { de: 'bot', texto: '¡Gracias por confirmar! Te esperamos mañana a las 10:30. 📍 Av. Libertador 1234.' },
          ] },
          { texto: 'Reprogramar', siguiente: [
            { de: 'bot', texto: 'Sin problema. Estos son los próximos horarios disponibles:',
              opciones: [
                { texto: 'Jue 18/09 · 11:00', siguiente: [
                  { de: 'bot', texto: 'Listo ✅ Reprogramamos tu turno para el jueves 18/09 a las 11:00.' },
                ] },
                { texto: 'Vie 19/09 · 09:30', siguiente: [
                  { de: 'bot', texto: 'Listo ✅ Reprogramamos tu turno para el viernes 19/09 a las 09:30.' },
                ] },
              ] },
          ] },
          { texto: 'Cancelar', siguiente: [
            { de: 'bot', texto: 'Cancelamos tu turno del martes 16/09 10:30. Avisale a tu médico si necesitás uno nuevo más adelante 🙂' },
          ] },
        ] },
    ],
  },
  cancelacion: {
    nombre: 'Cancelar turno',
    pasos: [
      { de: 'user', texto: 'Necesito cancelar mi turno de mañana' },
      { de: 'bot', texto: 'Entendido, María. Cancelé tu turno del martes 16/09 10:30 con Dra. Sofía Martínez. ¿Querés que te ayude a reprogramarlo?',
        opciones: [
          { texto: 'Sí, reprogramar', siguiente: [
            { de: 'bot', texto: 'Estos son los próximos horarios disponibles con Dra. Sofía Martínez:',
              opciones: [
                { texto: 'Jue 18/09 · 11:00', siguiente: [
                  { de: 'bot', texto: 'Listo ✅ Tu nuevo turno quedó para el jueves 18/09 a las 11:00.' },
                ] },
                { texto: 'Vie 19/09 · 09:30', siguiente: [
                  { de: 'bot', texto: 'Listo ✅ Tu nuevo turno quedó para el viernes 19/09 a las 09:30.' },
                ] },
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
      { de: 'user', texto: 'Quiero cambiar mi turno a otro día' },
      { de: 'bot', texto: 'Claro, estos son los próximos horarios disponibles con Dra. Sofía Martínez:',
        opciones: [
          { texto: 'Jue 18/09 · 11:00', siguiente: [
            { de: 'bot', texto: 'Listo ✅ Tu turno quedó reprogramado para el jueves 18/09 a las 11:00. Cancelamos el anterior automáticamente.' },
          ] },
          { texto: 'Vie 19/09 · 09:30', siguiente: [
            { de: 'bot', texto: 'Listo ✅ Tu turno quedó reprogramado para el viernes 19/09 a las 09:30. Cancelamos el anterior automáticamente.' },
          ] },
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
    activo: true,
  },
  {
    id: 'recordatorio',
    nombre: 'Recordatorio 24 hs antes',
    descripcion: 'Se envía un recordatorio automático con opción de confirmar, reprogramar o cancelar.',
    disparador: '24 hs antes de cada turno agendado',
    activo: true,
  },
  {
    id: 'reprogramacion',
    nombre: 'Reprogramación automática',
    descripcion: 'Si el paciente cancela, se le ofrecen los próximos horarios disponibles sin intervención humana.',
    disparador: 'Respuesta "Cancelar" o "Reprogramar" en un recordatorio',
    activo: true,
  },
  {
    id: 'encuesta',
    nombre: 'Encuesta post-consulta',
    descripcion: 'A las 2 horas de finalizada la consulta, se envía una encuesta corta de satisfacción.',
    disparador: 'Turno marcado como "Atendido" en el sistema',
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
const WA_OPERADOR = 'Gracias por escribirnos. Un operador de la clínica te va a responder a la brevedad.';
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

waCargarFlujos();
