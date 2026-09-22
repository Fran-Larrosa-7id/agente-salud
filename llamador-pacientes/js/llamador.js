// Llamador de pacientes — estado mock compartido entre Pantalla / Panel / Mobile
// Sin backend: se sincroniza vía localStorage + evento 'storage' entre pestañas del mismo navegador.

const LL_STORAGE_KEY = 'llamador_pacientes_state_v1';

const LL_CONSULTORIOS = [
  { id: 'c1', nombre: 'Consultorio 1', profesional: 'Dr. Juan Pérez', especialidad: 'Traumatología' },
  { id: 'c2', nombre: 'Consultorio 2', profesional: 'Dra. Sofía Martínez', especialidad: 'Cardiología' },
  { id: 'c3', nombre: 'Consultorio 3', profesional: 'Dr. Martín Gómez', especialidad: 'Clínica Médica' },
];

const LL_SEED = {
  colas: {
    c1: [
      { id: 'p1', nombre: 'María González', turno: '10:30' },
      { id: 'p6', nombre: 'Diego Molina', turno: '10:45' },
    ],
    c2: [
      { id: 'p2', nombre: 'Juan Fernández', turno: '11:00' },
      { id: 'p7', nombre: 'Florencia Díaz', turno: '11:15' },
    ],
    c3: [
      { id: 'p3', nombre: 'Lucía Rodríguez', turno: '11:30' },
      { id: 'p8', nombre: 'Pablo Ibáñez', turno: '11:45' },
      { id: 'p5', nombre: 'Carla Suárez', turno: '12:00' },
    ],
  },
  // Estado de media mañana: la demo abre con la sala en funcionamiento, no vacía
  atendiendo: {
    c1: { id: 'p10', nombre: 'Roberto Aguirre', turno: '10:15' },
    c2: { id: 'p11', nombre: 'Ana López', turno: '10:40' },
    c3: null,
  },
  llamados: [],
};

// Llamados recientes con hora relativa al momento en que se abre la demo
function llSeed() {
  const seed = JSON.parse(JSON.stringify(LL_SEED));
  const hace = (min) => { const d = new Date(Date.now() - min * 60000); return { ts: d.getTime(), hora: d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') }; };
  seed.llamados = [
    { pacienteNombre: 'Ana López', pacienteId: 'p11', consultorioId: 'c2', turno: '10:40', tipo: 'nuevo', ...hace(2) },
    { pacienteNombre: 'Roberto Aguirre', pacienteId: 'p10', consultorioId: 'c1', turno: '10:15', tipo: 'nuevo', ...hace(9) },
    { pacienteNombre: 'Julián Castro', pacienteId: 'p12', consultorioId: 'c3', turno: '10:00', tipo: 'nuevo', ...hace(21) },
  ];
  return seed;
}

function llGetState() {
  try {
    const raw = localStorage.getItem(LL_STORAGE_KEY);
    if (!raw) throw new Error('empty');
    return JSON.parse(raw);
  } catch (e) {
    const seed = llSeed();
    try { localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(seed)); } catch (err) { /* sin persistencia */ }
    return seed;
  }
}

function llSaveState(state) {
  localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(state));
}

function llHoraActual() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function llConsultorio(id) {
  return LL_CONSULTORIOS.find((c) => c.id === id);
}

function llLlamarSiguiente(consultorioId) {
  const state = llGetState();
  const cola = state.colas[consultorioId];
  if (!cola || cola.length === 0) return state;
  const paciente = cola.shift();
  state.atendiendo[consultorioId] = paciente;
  state.llamados.unshift({
    pacienteNombre: paciente.nombre,
    pacienteId: paciente.id,
    consultorioId,
    turno: paciente.turno,
    hora: llHoraActual(),
    ts: Date.now(),
    tipo: 'nuevo',
  });
  state.llamados = state.llamados.slice(0, 10);
  llSaveState(state);
  return state;
}

function llVolverALlamar(consultorioId) {
  const state = llGetState();
  const paciente = state.atendiendo[consultorioId];
  if (!paciente) return state;
  state.llamados.unshift({
    pacienteNombre: paciente.nombre,
    pacienteId: paciente.id,
    consultorioId,
    turno: paciente.turno,
    hora: llHoraActual(),
    ts: Date.now(),
    tipo: 'repetido',
  });
  state.llamados = state.llamados.slice(0, 10);
  llSaveState(state);
  return state;
}

function llFinalizarAtencion(consultorioId) {
  const state = llGetState();
  state.atendiendo[consultorioId] = null;
  llSaveState(state);
  return state;
}

function llResetDemo() {
  const seed = llSeed();
  llSaveState(seed);
  return seed;
}

function llOnStateChange(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === LL_STORAGE_KEY) callback(llGetState());
  });
}

// ---------- Configuración de la institución (simulada, se guarda en localStorage) ----------
const LL_CONFIG_KEY = 'llamador_config_v1';
const LL_CONFIG_DEFAULT = {
  pantalla: 'Sala de espera Planta Baja',
  formato: 'completo', // completo | inicial | iniciales | turno
  visible: { consultorio: true, profesional: true, especialidad: true },
  sonido: 'campanilla', // campanilla | suave | ninguno
};
const LL_FORMATOS = [
  { id: 'completo', nombre: 'Nombre completo', ejemplo: 'María González' },
  { id: 'inicial', nombre: 'Nombre + inicial', ejemplo: 'María G.' },
  { id: 'iniciales', nombre: 'Iniciales', ejemplo: 'M.G.' },
  { id: 'turno', nombre: 'Número de turno', ejemplo: 'Turno A-024' },
];

function llGetConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LL_CONFIG_KEY));
    if (c) return Object.assign({}, LL_CONFIG_DEFAULT, c, { visible: Object.assign({}, LL_CONFIG_DEFAULT.visible, c.visible) });
  } catch (e) { /* usa los valores por defecto */ }
  return JSON.parse(JSON.stringify(LL_CONFIG_DEFAULT));
}
function llSaveConfig(config) {
  try { localStorage.setItem(LL_CONFIG_KEY, JSON.stringify(config)); } catch (e) { /* sin persistencia */ }
}

// Código de turno mostrable, derivado del id del paciente (mock)
function llCodigoTurno(id) {
  const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  return 'A-' + String(20 + n).padStart(3, '0');
}

// Solo la pantalla de sala aplica este formato: recepción y profesional siempre ven el nombre completo.
function llNombreSala(nombre, id, formato) {
  const partes = nombre.split(' ');
  const ini = (s) => s.charAt(0).toUpperCase();
  if (formato === 'inicial') return partes[0] + ' ' + ini(partes[partes.length - 1]) + '.';
  if (formato === 'iniciales') return ini(partes[0]) + '.' + ini(partes[partes.length - 1]) + '.';
  if (formato === 'turno') return 'Turno ' + llCodigoTurno(id);
  return nombre;
}

function llResetConfig() {
  try { localStorage.removeItem(LL_CONFIG_KEY); } catch (e) { /* nada que borrar */ }
  return llGetConfig();
}

function llOnConfigChange(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === LL_CONFIG_KEY) callback(llGetConfig());
  });
}

// Sonido simulado con Web Audio (puede quedar bloqueado hasta que el navegador reciba un gesto)
function llSonar(tipo) {
  if (tipo === 'ninguno') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notas = tipo === 'suave' ? [523] : [880, 660];
    notas.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(tipo === 'suave' ? 0.08 : 0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.65);
    });
  } catch (e) { /* audio no disponible */ }
}
