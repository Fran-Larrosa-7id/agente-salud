/**
 * Herramientas del agente. TODAS son de lectura o de navegación acotada.
 * No existen herramientas para escribir texto, completar formularios, ejecutar JavaScript,
 * usar la terminal, leer archivos ni navegar a una URL arbitraria.
 */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

const elementId = { type: 'string', description: 'id de un elemento de la observación (p. ej. "f0-12").' };

export const TOOL_DEFS = [
  {
    name: 'listStudies',
    description: 'Usa el extractor de solo lectura del portal para devolver todos los estudios visibles, con metadata mínima e ids opacos.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'openStudy',
    description: 'Abre exactamente el estudio seleccionado por el paciente (target de este objetivo); nunca acepta otro id.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'findPdfAction',
    description: 'Busca una acción visible que entregue el PDF del estudio seleccionado, sin mostrar el contenido clínico.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'downloadCurrentStudyPdf',
    description: 'Captura el PDF del estudio seleccionado y ya abierto usando la acción segura del proveedor.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'getPageSummary',
    description: 'Devuelve títulos, avisos y estado general de la página actual (enmascarados).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'getInteractiveElements',
    description: 'Lista más elementos interactivos de la página (paginado). Usalo si la observación dice que se omitieron elementos.',
    input_schema: {
      type: 'object',
      properties: { offset: { type: 'integer', minimum: 0, description: 'Desde qué elemento listar.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'getTables',
    description: 'Devuelve la estructura de una tabla o listado: encabezados, forma de cada columna y filas de muestra enmascaradas.',
    input_schema: {
      type: 'object',
      properties: { collectionId: { type: 'string' } },
      required: ['collectionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'click',
    description: 'Hace clic en un botón, pestaña o enlace para NAVEGAR o ABRIR contenido de solo lectura.',
    input_schema: { type: 'object', properties: { elementId }, required: ['elementId'], additionalProperties: false },
  },
  {
    name: 'openLink',
    description: 'Abre en la misma pestaña el destino de un enlace del mismo portal.',
    input_schema: { type: 'object', properties: { elementId }, required: ['elementId'], additionalProperties: false },
  },
  {
    name: 'goBack',
    description: 'Vuelve a la página anterior.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wait',
    description: 'Espera a que la página termine de cargar (1 a 5 segundos).',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: 1, maximum: 5 } },
      additionalProperties: false,
    },
  },
  {
    name: 'scroll',
    description: 'Desplaza la página para cargar o ver más contenido.',
    input_schema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down'] } },
      required: ['direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspectCurrentUrl',
    description: 'Devuelve la ruta actual (sin parámetros ni identificadores).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'inspectNewPage',
    description: 'Pasa a la pestaña más reciente (por ejemplo, si un enlace abrió el resultado en otra pestaña).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'findDownloadActions',
    description: 'Lista las acciones que parecen entregar el documento original (PDF, descargar, informe, imprimir).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'downloadFromElement',
    description:
      'Usa la acción que entrega el PDF del estudio seleccionado y captura el documento (descarga, pestaña nueva o PDF en la página). Solo en el objetivo DOWNLOAD_STUDY.',
    input_schema: { type: 'object', properties: { elementId }, required: ['elementId'], additionalProperties: false },
  },
  {
    name: 'detectPdfResponse',
    description: 'Espera y captura un PDF que la página ya está mostrando o cargando (visor de PDF, documento embebido).',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: 1, maximum: 15 } },
      additionalProperties: false,
    },
  },
  {
    name: 'finishGoal',
    description:
      'Termina el objetivo. En DISCOVER_STUDIES indicá qué listado contiene los estudios y qué columna tiene cada dato (índices desde 0); si no hay estudios, noStudies=true. En DOWNLOAD_STUDY no se usa: el objetivo termina solo al capturar el PDF.',
    input_schema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string' },
        columns: {
          type: 'object',
          properties: {
            date: { type: 'integer', minimum: 0 },
            protocol: { type: 'integer', minimum: 0 },
            deliveryDate: { type: 'integer', minimum: 0 },
            status: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
        noStudies: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'requestHumanAction',
    description:
      'Detiene al agente y le pide al paciente que resuelva algo en la ventana del laboratorio: CAPTCHA, código de verificación, sesión vencida, ventana o confirmación desconocida, o un portal que cambió.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['captcha', 'mfa', 'session_expired', 'unknown_modal', 'ambiguous', 'security_check', 'portal_changed'],
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ToolDef[];

export type ToolName = (typeof TOOL_DEFS)[number]['name'];

export const TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_DEFS.map((t) => t.name));

/** Capacidades que el agente NO tiene, verificadas por test. */
export const FORBIDDEN_CAPABILITIES = [
  'type',
  'fill',
  'press',
  'selectOption',
  'setInputFiles',
  'evaluate',
  'arbitraryJavaScript',
  'shell',
  'filesystemAccess',
  'navigate',
  'navigateToArbitraryDomain',
  'goto',
  'submitForm',
];
