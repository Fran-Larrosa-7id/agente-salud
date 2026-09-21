// Configuración de onboarding compartida entre el panel institucional y el flujo del paciente (mock).
// La institución elige una plantilla; el flujo del paciente omite secciones y ajusta los documentos.
// Persistencia: localStorage, clave 'onboarding_config_v1'. Sin backend.

const OB_CONFIG_KEY = 'onboarding_config_v1';
const OB_SECCIONES = ['Datos personales', 'Cobertura médica', 'Antecedentes', 'Medicación', 'Documentación'];
const OB_DOCS = ['DNI', 'Credencial', 'Orden médica', 'Estudios previos', 'Consentimiento informado', 'Indicaciones previas'];

// secciones / docs: 1 = se solicita, 0 = no se solicita
const OB_PLANTILLAS = {
  general: { nombre: 'Consulta general', ayuda: 'Datos básicos, cobertura y antecedentes para preparar la consulta.',
    secciones: [1, 1, 1, 1, 1], docs: [1, 1, 1, 0, 0, 0] },
  quirurgica: { nombre: 'Pre-admisión quirúrgica', ayuda: 'Suma estudios previos y consentimiento informado.',
    secciones: [1, 1, 1, 1, 1], docs: [1, 1, 1, 1, 1, 0] },
  imagenes: { nombre: 'Diagnóstico por imágenes', ayuda: 'Prioriza la orden médica y la medicación relevante; omite antecedentes.',
    secciones: [1, 1, 0, 1, 1], docs: [1, 1, 1, 0, 0, 0] },
  laboratorio: { nombre: 'Laboratorio', ayuda: 'Orden médica e indicaciones previas, sin cuestionario clínico.',
    secciones: [1, 1, 0, 0, 1], docs: [1, 1, 1, 0, 0, 1] },
  personalizado: { nombre: 'Personalizado', ayuda: 'La institución elige cada sección y cada documento.',
    secciones: [1, 1, 0, 0, 1], docs: [1, 0, 0, 0, 0, 0] },
};

function obDefaultConfig() {
  const p = OB_PLANTILLAS.general;
  return { plantilla: 'general', secciones: p.secciones.slice(), docs: p.docs.slice() };
}
function obGetConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(OB_CONFIG_KEY));
    if (c && OB_PLANTILLAS[c.plantilla] && c.secciones.length === OB_SECCIONES.length && c.docs.length === OB_DOCS.length) return c;
  } catch (e) { /* usa la plantilla por defecto */ }
  return obDefaultConfig();
}
function obSaveConfig(cfg) {
  try { localStorage.setItem(OB_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* sin persistencia */ }
}
function obResetConfig() {
  try { localStorage.removeItem(OB_CONFIG_KEY); } catch (e) { /* nada que borrar */ }
  return obDefaultConfig();
}
