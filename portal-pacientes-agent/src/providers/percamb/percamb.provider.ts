import type { ProviderConfig } from '../types.js';

/**
 * Laboratorio Pérez Cambet · portal LabWin Cloud (Biodata).
 * Ingreso relevado: formulario con "USUARIO/DNI" y "CONTRASEÑA" y botón "Entrar".
 * El área autenticada no se pudo relevar sin una cuenta; las pistas vienen del pedido del producto.
 */
export const percamb: ProviderConfig = {
  id: 'percamb',
  name: 'Pérez Cambet',
  loginUrl: 'https://www.biodatasa.com.ar/lwcloud/percamb/login',
  allowedHosts: ['biodatasa.com.ar', 'www.biodatasa.com.ar'],
  staticHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  loginPathPattern: /\/login\/?$/i,
  authenticatedHints: ['RESULTADOS ONLINE', 'CERRAR SESION', 'MIS RESULTADOS', 'PROTOCOLO'],
  expectedPdfLabels: ['Ver en PDF', 'PDF', 'Descargar', 'Informe', 'Imprimir'],
  resultsHints: ['RESULTADOS ONLINE', 'Protocolo', 'Fecha', 'Entrega'],
  studyExtractor: 'labwin',
  agentNotes:
    'Portal LabWin Cloud. Después del ingreso suele mostrarse "RESULTADOS ONLINE" con un listado de protocolos por fecha. ' +
    'Cada protocolo se abre desde su fila y el documento original se obtiene con una acción tipo "Ver en PDF".',
};
