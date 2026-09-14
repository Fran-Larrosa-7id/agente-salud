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
  atendiendo: { c1: null, c2: null, c3: null },
  llamados: [],
};

function llGetState() {
  try {
    const raw = localStorage.getItem(LL_STORAGE_KEY);
    if (!raw) throw new Error('empty');
    return JSON.parse(raw);
  } catch (e) {
    const seed = JSON.parse(JSON.stringify(LL_SEED));
    localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(seed));
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
  const seed = JSON.parse(JSON.stringify(LL_SEED));
  llSaveState(seed);
  return seed;
}

function llOnStateChange(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === LL_STORAGE_KEY) callback(llGetState());
  });
}
