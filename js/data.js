// Datos mock — Onboarding de Pacientes (prototipo, sin backend)

const OBRAS_SOCIALES = [
  'OSDE', 'Swiss Medical', 'Galeno', 'Medifé', 'IOMA', 'PAMI', 'Unión Personal', 'Accord Salud',
];

const PROFESIONALES = [
  { nombre: 'Dr. Juan Pérez', especialidad: 'Traumatología' },
  { nombre: 'Dra. Sofía Martínez', especialidad: 'Cardiología' },
  { nombre: 'Dr. Martín Gómez', especialidad: 'Clínica Médica' },
  { nombre: 'Dra. Valentina Ríos', especialidad: 'Dermatología' },
  { nombre: 'Dr. Ezequiel Torres', especialidad: 'Pediatría' },
];

const ESTADOS = {
  LISTO: { key: 'listo', label: 'Listo para atender', badge: 'badge-success' },
  INFO_PENDIENTE: { key: 'info_pendiente', label: 'Información pendiente', badge: 'badge-pending' },
  DOC_PENDIENTE: { key: 'doc_pendiente', label: 'Documentación pendiente', badge: 'badge-pending' },
  REVISION: { key: 'revision', label: 'Revisión requerida', badge: 'badge-review' },
  NO_INICIADO: { key: 'no_iniciado', label: 'No iniciado', badge: 'badge-neutral' },
};

const PACIENTES = [
  {
    id: 'p1', nombre: 'María', apellido: 'González', dni: '32.104.887',
    turno: '10:30', fecha: '15 de septiembre', profesional: PROFESIONALES[0],
    obraSocial: 'OSDE', plan: '310', progreso: 85,
    estado: ESTADOS.DOC_PENDIENTE,
    secciones: { personales: true, cobertura: true, antecedentes: true, medicacion: true, documentacion: false },
    alergias: ['Penicilina'],
    medicacion: [{ nombre: 'Losartán', dosis: '50 mg', frecuencia: '1 vez al día' }],
    antecedentes: 'Hipertensión arterial controlada.',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
      { nombre: 'credencial_osde.jpg', tipo: 'Credencial', estado: 'validado' },
      { nombre: 'orden_medica.pdf', tipo: 'Orden médica', estado: 'pendiente' },
    ],
  },
  {
    id: 'p2', nombre: 'Juan', apellido: 'Fernández', dni: '28.665.213',
    turno: '11:00', fecha: '15 de septiembre', profesional: PROFESIONALES[1],
    obraSocial: 'Swiss Medical', plan: 'SMG20', progreso: 100,
    estado: ESTADOS.LISTO,
    secciones: { personales: true, cobertura: true, antecedentes: true, medicacion: true, documentacion: true },
    alergias: [],
    medicacion: [],
    antecedentes: 'Sin antecedentes relevantes.',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
      { nombre: 'credencial_swiss.jpg', tipo: 'Credencial', estado: 'validado' },
    ],
  },
  {
    id: 'p3', nombre: 'Lucía', apellido: 'Rodríguez', dni: '40.221.905',
    turno: '11:30', fecha: '15 de septiembre', profesional: PROFESIONALES[2],
    obraSocial: 'Medifé', plan: 'Plan 3', progreso: 60,
    estado: ESTADOS.INFO_PENDIENTE,
    secciones: { personales: true, cobertura: true, antecedentes: false, medicacion: false, documentacion: false },
    alergias: [],
    medicacion: [],
    antecedentes: '',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
    ],
  },
  {
    id: 'p4', nombre: 'Roberto', apellido: 'Aguirre', dni: '25.887.441',
    turno: '09:00', fecha: '15 de septiembre', profesional: PROFESIONALES[3],
    obraSocial: 'IOMA', plan: '-', progreso: 100,
    estado: ESTADOS.LISTO,
    secciones: { personales: true, cobertura: true, antecedentes: true, medicacion: true, documentacion: true },
    alergias: ['Ibuprofeno'],
    medicacion: [{ nombre: 'Levotiroxina', dosis: '75 mcg', frecuencia: '1 vez al día, en ayunas' }],
    antecedentes: 'Hipotiroidismo.',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
      { nombre: 'credencial_ioma.jpg', tipo: 'Credencial', estado: 'validado' },
    ],
  },
  {
    id: 'p5', nombre: 'Carla', apellido: 'Suárez', dni: '35.442.109',
    turno: '09:30', fecha: '15 de septiembre', profesional: PROFESIONALES[4],
    obraSocial: 'PAMI', plan: '-', progreso: 40,
    estado: ESTADOS.NO_INICIADO,
    secciones: { personales: true, cobertura: false, antecedentes: false, medicacion: false, documentacion: false },
    alergias: [],
    medicacion: [],
    antecedentes: '',
    documentos: [],
  },
  {
    id: 'p6', nombre: 'Diego', apellido: 'Molina', dni: '30.998.762',
    turno: '10:00', fecha: '15 de septiembre', profesional: PROFESIONALES[0],
    obraSocial: 'Unión Personal', plan: 'Plan 1', progreso: 75,
    estado: ESTADOS.REVISION,
    secciones: { personales: true, cobertura: true, antecedentes: true, medicacion: true, documentacion: false },
    alergias: ['No tiene alergias conocidas'],
    medicacion: [{ nombre: 'Atorvastatina', dosis: '20 mg', frecuencia: '1 vez al día, noche' }],
    antecedentes: 'Dislipemia. Cirugía de rodilla en 2019.',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'revision' },
      { nombre: 'estudio_rodilla.pdf', tipo: 'Estudio previo', estado: 'revision' },
    ],
  },
  {
    id: 'p7', nombre: 'Florencia', apellido: 'Díaz', dni: '38.775.301',
    turno: '12:00', fecha: '15 de septiembre', profesional: PROFESIONALES[1],
    obraSocial: 'Accord Salud', plan: 'Full', progreso: 100,
    estado: ESTADOS.LISTO,
    secciones: { personales: true, cobertura: true, antecedentes: true, medicacion: true, documentacion: true },
    alergias: [],
    medicacion: [],
    antecedentes: 'Sin antecedentes relevantes.',
    documentos: [
      { nombre: 'DNI_frente.jpg', tipo: 'DNI', estado: 'validado' },
      { nombre: 'credencial_accord.jpg', tipo: 'Credencial', estado: 'validado' },
    ],
  },
  {
    id: 'p8', nombre: 'Pablo', apellido: 'Ibáñez', dni: '27.114.558',
    turno: '13:00', fecha: '15 de septiembre', profesional: PROFESIONALES[2],
    obraSocial: 'Galeno', plan: 'Azul', progreso: 20,
    estado: ESTADOS.NO_INICIADO,
    secciones: { personales: true, cobertura: false, antecedentes: false, medicacion: false, documentacion: false },
    alergias: [],
    medicacion: [],
    antecedentes: '',
    documentos: [],
  },
];

const ACTIVIDAD_RECIENTE = [
  { paciente: 'María González', accion: 'cargó documentación', hace: 'Hace 5 min' },
  { paciente: 'Juan Fernández', accion: 'completó antecedentes', hace: 'Hace 18 min' },
  { paciente: 'Lucía Rodríguez', accion: 'completó datos personales', hace: 'Hace 32 min' },
  { paciente: 'Diego Molina', accion: 'envió documentación para revisión', hace: 'Hace 41 min' },
  { paciente: 'Florencia Díaz', accion: 'confirmó consentimiento', hace: 'Hace 1 h' },
];

const PACIENTE_ACTUAL = PACIENTES[0]; // María González — usada en la demo de flujo paciente
