import type { ProviderConfig } from '../types.js';

/** RDC Chacabuco · portal VisualMedica. */
export const rdcChacabuco: ProviderConfig = {
  id: 'rdcchacabuco',
  name: 'RDC Chacabuco',
  loginUrl: 'https://rdcchacabuco.from-ar.com/patientportal/index.php',
  allowedHosts: ['rdcchacabuco.from-ar.com'],
  requireHttps: true,
  staticHosts: [],
  loginPathPattern: /\/patientportal\/(?:index\.php)?$/i,
  loginForm: {
    usernameLabel: 'E-mail o DNI',
    usernamePattern: 'email',
    readyTimeoutMs: 10_000,
    termsUrl: 'https://rdcchacabuco.from-ar.com/patientportal/assets/manual/TYC.pdf',
    selectors: {
      form: 'form#login',
      username: 'input#email',
      password: 'input#passL',
      termsCheckbox: 'input#accept_terms_conditions[type="checkbox"]',
      actionPath: '/patientportal/index.php/usuarios/control',
      submitText: 'Ingresar',
    },
  },
  authenticatedHints: ['MIS ESTUDIOS', 'RESULTADOS', 'ESTUDIOS DISPONIBLES', 'CERRAR SESIÓN', 'SUS ESTUDIOS REALIZADOS'],
  expectedPdfLabels: [],
  resultsHints: ['TIPO DE ESTUDIO', 'DESCRIPCIÓN', 'FECHA DEL ESTUDIO'],
  studyExtractor: 'rdcchacabuco',
  agentNotes: 'Portal VisualMedica de diagnóstico por imágenes. El listado se procesa con un parser determinístico y la acción del icono de archivo abre un modal con el PDF original. Nunca envíes datos del portal al modelo.',
};
