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
  requireHttps: true,
  staticHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  loginPathPattern: /\/login\/?$/i,
  loginForm: {
    usernameLabel: 'Usuario o DNI',
    usernamePattern: 'usuario',
    readyTimeoutMs: 10_000,
    selectors: {
      form: 'form[name="form1"]:has(input[type="hidden"][name="enviar"])',
      username: 'input[name="usuario"]',
      password: 'input[name="pass"]',
      actionPath: '/lwcloud/percamb/login',
      submitText: 'Entrar',
    },
  },
  authenticatedHints: ['RESULTADOS ONLINE', 'CERRAR SESION', 'MIS RESULTADOS', 'PROTOCOLO'],
  expectedPdfLabels: ['Ver en PDF', 'PDF', 'Descargar', 'Informe', 'Imprimir'],
  resultsHints: ['RESULTADOS ONLINE', 'Protocolo', 'Fecha', 'Entrega'],
  studyExtractor: 'labwin',
  agentNotes:
    'Portal LabWin Cloud. Después del ingreso suele mostrarse "RESULTADOS ONLINE" con un listado de protocolos por fecha. ' +
    'Cada protocolo se abre desde su fila y el documento original se obtiene con una acción tipo "Ver en PDF".',
};
