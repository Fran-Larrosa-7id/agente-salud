import type { ProviderConfig } from '../types.js';

/** Portal público de pacientes. El visor externo no se habilita hasta confirmar su origen exacto. */
export const centroDm: ProviderConfig = {
  id: 'centrodm',
  name: 'Centro DM',
  loginUrl: 'https://estudios.centrodm.com.ar/',
  allowedHosts: ['estudios.centrodm.com.ar'],
  // Viewer Pixeon confirmado: el puerto forma parte del origin exacto permitido.
  allowedOrigins: ['https://curie.centrodm.com.ar:8090'],
  requireHttps: true,
  staticHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  loginPathPattern: /(?:^\/$|indexp?\.php$|login|acceso)/i,
  authenticatedHints: ['ESTUDIOS', 'MIS ESTUDIOS', 'RESULTADOS', 'CERRAR SESIÓN', 'PERFIL', 'BIENVENIDO A TU PORTAL DE ESTUDIOS'],
  expectedPdfLabels: [],
  resultsHints: ['ESTUDIOS', 'FECHA', 'MODALIDAD'],
  studyExtractor: 'centrodm',
  agentNotes: 'Centro DM: portal de diagnóstico por imágenes. El paciente inicia sesión manualmente. Solo se importan estudios seleccionados; el artefacto esperado es ZIP DICOM completo, no PDF.',
};
