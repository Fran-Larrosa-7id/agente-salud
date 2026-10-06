import type { ProviderConfig } from '../types.js';

/** RDC Chacabuco · portal VisualMedica. El paciente inicia sesión manualmente. */
export const rdcChacabuco: ProviderConfig = {
  id: 'rdcchacabuco',
  name: 'RDC Chacabuco',
  loginUrl: 'https://rdcchacabuco.from-ar.com/patientportal/index.php',
  allowedHosts: ['rdcchacabuco.from-ar.com'],
  requireHttps: true,
  staticHosts: [],
  loginPathPattern: /\/patientportal\/(?:index\.php)?$/i,
  authenticatedHints: ['MIS ESTUDIOS', 'RESULTADOS', 'ESTUDIOS DISPONIBLES', 'CERRAR SESIÓN'],
  expectedPdfLabels: [],
  resultsHints: ['TIPO DE ESTUDIO', 'DESCRIPCIÓN', 'FECHA DEL ESTUDIO'],
  studyExtractor: 'rdcchacabuco',
  agentNotes: 'Portal VisualMedica de diagnóstico por imágenes. El paciente inicia sesión manualmente. El listado se procesa con un parser determinístico y la acción del icono de archivo abre un modal con el PDF original. Nunca envíes datos del portal al modelo.',
};
