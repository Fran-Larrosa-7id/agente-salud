// Datos mock — Sistema de triage / evaluador de riesgo
// Priorización basada en reglas ilustrativas de esta demo. No es un protocolo clínico validado:
// en una implementación real las define y valida la institución.
// No es asesoramiento médico real.

const TR_NIVELES = {
  rojo: { id: 'rojo', nombre: 'Emergencia', accion: 'Dirigite de inmediato a Guardia, te van a atender ahora mismo.', minutos: 0, orden: 0 },
  naranja: { id: 'naranja', nombre: 'Muy urgente', accion: 'Pasá a Guardia. La atención objetivo es dentro de los próximos 10 minutos.', minutos: 10, orden: 1 },
  amarillo: { id: 'amarillo', nombre: 'Urgente', accion: 'Aguardá en sala de espera. La atención objetivo es dentro de los próximos 60 minutos.', minutos: 60, orden: 2 },
  verde: { id: 'verde', nombre: 'Poco urgente', accion: 'Podés esperar en sala. La atención objetivo es dentro de las próximas 2 horas.', minutos: 120, orden: 3 },
  azul: { id: 'azul', nombre: 'No urgente', accion: 'Tu consulta puede resolverse con un turno programado, sin necesidad de guardia.', minutos: 240, orden: 4 },
};

const TR_MOTIVOS = {
  dolor_pecho: {
    label: 'Dolor en el pecho', baseline: 2,
    preguntas: [
      { texto: '¿El dolor se irradia al brazo, cuello o mandíbula?', peso: 3 },
      { texto: '¿Tenés dificultad para respirar además del dolor?', peso: 3 },
      { texto: '¿Sudoración fría o mareos intensos?', peso: 2 },
    ],
  },
  dificultad_respirar: {
    label: 'Dificultad para respirar', baseline: 2,
    preguntas: [
      { texto: '¿Apareció de forma repentina o empeoró mucho en la última hora?', peso: 3 },
      { texto: '¿Notás los labios o los dedos de color azulado?', peso: 4 },
      { texto: '¿Tenés silbidos al respirar (sibilancias)?', peso: 1 },
    ],
  },
  fiebre: {
    label: 'Fiebre alta', baseline: 0,
    preguntas: [
      { texto: '¿La fiebre supera los 39,5°C?', peso: 2 },
      { texto: '¿Tenés rigidez de cuello o manchas en la piel?', peso: 4 },
      { texto: '¿La fiebre dura más de 3 días?', peso: 1 },
    ],
  },
  dolor_abdominal: {
    label: 'Dolor abdominal', baseline: 1,
    preguntas: [
      { texto: '¿El dolor es muy intenso y de aparición súbita?', peso: 2 },
      { texto: '¿Tuviste vómitos con sangre o materia fecal muy oscura?', peso: 4 },
      { texto: '¿El abdomen está muy duro o hinchado?', peso: 2 },
    ],
  },
  sangrado: {
    label: 'Sangrado', baseline: 2,
    preguntas: [
      { texto: '¿El sangrado no se detiene con presión directa?', peso: 3 },
      { texto: '¿Es un sangrado abundante (empapa ropa o vendas)?', peso: 3 },
      { texto: '¿Sentís mareos o debilidad por la pérdida de sangre?', peso: 2 },
    ],
  },
  dolor_cabeza: {
    label: 'Dolor de cabeza intenso', baseline: 1,
    preguntas: [
      { texto: '¿Es el peor dolor de cabeza que tuviste en tu vida?', peso: 3 },
      { texto: '¿Tenés visión borrosa, confusión o dificultad para hablar?', peso: 4 },
      { texto: '¿Comenzó después de un golpe en la cabeza?', peso: 2 },
    ],
  },
  otro: {
    label: 'Otro motivo / consulta general', baseline: 0,
    preguntas: [
      { texto: '¿Tus síntomas empeoraron mucho en las últimas horas?', peso: 1 },
      { texto: '¿Tenés alguna condición crónica que te preocupe hoy?', peso: 1 },
    ],
  },
};

function trClasificar(motivoKey, respuestas, intensidad) {
  const motivo = TR_MOTIVOS[motivoKey];
  let score = motivo.baseline;
  motivo.preguntas.forEach((p, i) => { if (respuestas[i]) score += p.peso; });
  score += Math.round(intensidad / 3);

  let nivelId;
  if (score >= 8) nivelId = 'rojo';
  else if (score >= 5) nivelId = 'naranja';
  else if (score >= 3) nivelId = 'amarillo';
  else if (score >= 1) nivelId = 'verde';
  else nivelId = 'azul';

  return { nivel: TR_NIVELES[nivelId], score };
}
