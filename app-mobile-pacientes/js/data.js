// Datos mock — App mobile de pacientes (prototipo, sin backend)
// Misma paciente de referencia que el resto de la vertical: María González.

const APP_PACIENTE = {
  nombre: 'María', apellido: 'González', dni: '32.104.887',
  obraSocial: 'OSDE', plan: '310',
};

const APP_TURNOS = {
  proximos: [
    {
      id: 't1', profesional: 'Dra. Sofía Martínez', especialidad: 'Cardiología',
      fecha: 'Martes 16/09', hora: '10:30', lugar: 'Av. Libertador 1234, 3er piso',
      estado: 'Confirmado',
    },
    {
      id: 't2', profesional: 'Dr. Juan Pérez', especialidad: 'Traumatología',
      fecha: 'Lunes 22/09', hora: '09:15', lugar: 'Av. Libertador 1234, 1er piso',
      estado: 'Pendiente de confirmación',
    },
  ],
  historial: [
    { id: 'h1', profesional: 'Dr. Martín Gómez', especialidad: 'Clínica Médica', fecha: 'Jueves 04/09', hora: '11:00', estado: 'Atendido' },
    { id: 'h2', profesional: 'Dra. Sofía Martínez', especialidad: 'Cardiología', fecha: 'Martes 12/08', hora: '10:00', estado: 'Atendido' },
  ],
};

const APP_ESPECIALIDADES_DISPONIBLES = [
  'Cardiología', 'Traumatología', 'Clínica Médica', 'Dermatología', 'Pediatría',
];

const APP_ESTUDIOS = [
  { id: 'e1', nombre: 'Análisis de sangre completo', profesional: 'Dr. Martín Gómez', fecha: '04/09/2026', estado: 'disponible' },
  { id: 'e2', nombre: 'Electrocardiograma', profesional: 'Dra. Sofía Martínez', fecha: '12/08/2026', estado: 'disponible' },
  { id: 'e3', nombre: 'Radiografía de rodilla', profesional: 'Dr. Juan Pérez', fecha: '22/09/2026', estado: 'pendiente' },
];

const APP_NOTIFICACIONES = [
  { id: 'n1', tipo: 'turno', titulo: 'Turno confirmado', cuerpo: 'Tu turno con Dra. Sofía Martínez (Cardiología) el martes 16/09 a las 10:30 fue confirmado.', hora: 'Hoy · 09:12', leida: false },
  { id: 'n2', tipo: 'estudio', titulo: 'Resultado disponible', cuerpo: 'Ya podés ver el resultado de tu Análisis de sangre completo.', hora: 'Ayer · 18:40', leida: false },
  { id: 'n3', tipo: 'documentacion', titulo: 'Falta un documento', cuerpo: 'Todavía no cargaste la orden médica para tu turno de Traumatología.', hora: 'Ayer · 10:05', leida: false },
  { id: 'n4', tipo: 'recordatorio', titulo: 'Recordatorio de turno', cuerpo: 'Mañana tenés turno con Dra. Sofía Martínez a las 10:30.', hora: 'Lunes · 20:00', leida: true },
  { id: 'n5', tipo: 'turno', titulo: 'Turno solicitado', cuerpo: 'Recibimos tu solicitud de turno con Dr. Juan Pérez. Te avisamos cuando esté confirmado.', hora: 'Sáb · 16:22', leida: true },
];

const APP_DOCUMENTOS = [
  { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
  { nombre: 'credencial_osde.jpg', tipo: 'Credencial de obra social', estado: 'validado' },
  { nombre: 'orden_medica.pdf', tipo: 'Orden médica — Traumatología', estado: 'pendiente' },
];
