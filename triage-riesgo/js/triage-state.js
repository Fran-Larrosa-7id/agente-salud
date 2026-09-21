// Cola de guardia compartida entre Evaluación (paciente) y Panel (institución).
// Sin backend: se sincroniza vía localStorage + evento 'storage' entre pestañas del mismo navegador.

const TR_STORAGE_KEY = 'triage_riesgo_state_v1';

const TR_SEED = {
  cola: [
    { id: 'q1', nombre: 'Pablo Ibáñez', motivoLabel: 'Dolor abdominal', nivelId: 'amarillo', score: 3, ts: Date.now() - 1000 * 60 * 22, estado: 'esperando' },
    { id: 'q2', nombre: 'Carla Suárez', motivoLabel: 'Fiebre alta', nivelId: 'verde', score: 1, ts: Date.now() - 1000 * 60 * 9, estado: 'esperando' },
  ],
};

function trGetState() {
  try {
    const raw = localStorage.getItem(TR_STORAGE_KEY);
    if (!raw) throw new Error('empty');
    return JSON.parse(raw);
  } catch (e) {
    const seed = JSON.parse(JSON.stringify(TR_SEED));
    localStorage.setItem(TR_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function trSaveState(state) {
  localStorage.setItem(TR_STORAGE_KEY, JSON.stringify(state));
}

function trAgregarACola(nombre, motivoLabel, nivelId, score) {
  const state = trGetState();
  const entrada = { id: 'q' + Date.now(), nombre, motivoLabel, nivelId, score, ts: Date.now(), estado: 'esperando' };
  state.cola.push(entrada);
  trSaveState(state);
  return entrada;
}

function trMarcarAtendido(id) {
  const state = trGetState();
  const item = state.cola.find((p) => p.id === id);
  if (item) item.estado = 'atendida';
  trSaveState(state);
  return state;
}

function trResetDemo() {
  const seed = JSON.parse(JSON.stringify(TR_SEED));
  seed.cola.forEach((p) => { p.ts = Date.now() - 1000 * 60 * (10 + Math.random() * 20); });
  trSaveState(seed);
  return seed;
}

function trOnStateChange(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === TR_STORAGE_KEY) callback(trGetState());
  });
}

function trTiempoEsperando(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'recién llegado';
  return `hace ${min} min`;
}

// ---------- Contacto de emergencia configurable (cada institución define el suyo) ----------
const TR_CONTACTO_KEY = 'triage_contacto_v1';
const TR_CONTACTO_DEMO = { etiqueta: 'Emergencias médicas', numero: '107' };

function trGetContacto() {
  try {
    const c = JSON.parse(localStorage.getItem(TR_CONTACTO_KEY));
    if (c && c.etiqueta && c.numero) return c;
  } catch (e) { /* usa el valor demo */ }
  return Object.assign({}, TR_CONTACTO_DEMO);
}
function trSaveContacto(c) {
  try { localStorage.setItem(TR_CONTACTO_KEY, JSON.stringify(c)); } catch (e) { /* sin persistencia */ }
}
function trRestaurarContacto() {
  try { localStorage.removeItem(TR_CONTACTO_KEY); } catch (e) { /* nada que borrar */ }
  return Object.assign({}, TR_CONTACTO_DEMO);
}
