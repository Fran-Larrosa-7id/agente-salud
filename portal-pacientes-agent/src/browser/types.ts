import type { CapturedPdf } from '../jobs/pdf.js';

/**
 * Lectura CRUDA de la página. Vive solo en el backend: nunca se envía al modelo ni se registra.
 * El modelo recibe una versión reducida y enmascarada (ver agent/observation.ts).
 * No incluye valores de campos de texto ni de contraseña: el colector no los lee.
 */
export interface RawElement {
  id: string;
  frame: number;
  tag: string;
  role: string;
  label: string;
  /** Palabras clave tomadas de clases de íconos y handlers (pdf, print, download…), nunca el código. */
  iconHint: string;
  href: string;
  target: string;
  type: string;
  disabled: boolean;
  collection?: string;
  row?: number;
  inPasswordForm: boolean;
  isSubmit: boolean;
}

export interface RawCollection {
  id: string;
  frame: number;
  kind: 'table' | 'grid' | 'list';
  headers: string[];
  rows: string[][];
  rowCount: number;
}

export interface RawPageSnapshot {
  url: string;
  title: string;
  headings: string[];
  /** Pistas de área autenticada encontradas en el texto visible (solo las pistas, no el texto). */
  hintHits: string[];
  hasPasswordField: boolean;
  captcha: boolean;
  otp: boolean;
  modal: boolean;
  modalText: string;
  noResultsText: boolean;
  isPdfViewer: boolean;
  pdfEmbeds: string[];
  elements: RawElement[];
  collections: RawCollection[];
  /** Tipo semántico para reducir la observación del detalle clínico. */
  pageType?: 'results_list' | 'result_detail' | 'unknown';
}

/** Datos mínimos entregados al frontend; nunca incluye protocolo ni contenido clínico. */
export interface ProviderStudyMetadata {
  id: string;
  date?: string;
  deliveryDate?: string;
  status?: string;
}

export interface ProviderStudyList {
  recognized: true;
  listUrl: string;
  studies: ProviderStudyMetadata[];
}

/** El proveedor mostró acciones de estudios que el extractor no pudo asociar con filas. */
export class ProviderParserMismatchError extends Error {
  readonly code = 'PROVIDER_PARSER_MISMATCH';
  constructor(readonly resultActions: number, readonly candidateRows: number, readonly parsedStudies = 0) {
    super('PROVIDER_PARSER_MISMATCH');
  }
}

export interface ProviderStructureEvent {
  event: 'percamb_page' | 'percamb_result_links' | 'percamb_result_actions' | 'percamb_candidate_rows' | 'percamb_parsed_studies' | 'percamb_metadata_complete' | 'percamb_action' | 'percamb_ancestor';
  count?: number;
  index?: number;
  depth?: number;
  tag?: string;
  links?: number;
  textNodes?: number;
  siblings?: number;
  classType?: string;
  hrefMatch?: boolean;
}

/** Puerto que usa el agente para actuar sobre el navegador. Permite testear el agente sin Playwright. */
export interface BrowserPort {
  snapshot(hints: string[]): Promise<RawPageSnapshot>;
  click(el: RawElement): Promise<{ newPage: boolean }>;
  navigate(url: string): Promise<void>;
  goBack(): Promise<boolean>;
  switchToNewestPage(): Promise<boolean>;
  scroll(direction: 'up' | 'down'): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Ejecuta `action` y espera un PDF (descarga, pestaña nueva o respuesta inline). */
  capturePdfDuring(action: () => Promise<unknown>, timeoutMs: number): Promise<CapturedPdf | null>;
  /** Espera un PDF que ya se esté cargando o que se haya recibido hace instantes. */
  waitForPdf(timeoutMs: number): Promise<CapturedPdf | null>;
  /** GET de solo lectura con la sesión del navegador (para visores de PDF embebidos). */
  fetchPdf(url: string): Promise<CapturedPdf | null>;
  currentUrl(): string;
  openPages(): number;
  /** Capacidad opcional de proveedor; null significa que la página no es su listado de estudios. */
  listStudies?(): Promise<ProviderStudyList | null>;
  /** Abre únicamente el estudio asociado al id opaco del job actual. */
  hasStudy?(studyId: string): boolean;
  openStudy?(studyId: string): Promise<boolean>;
  isStudyOpen?(studyId: string): boolean;
  /** Encuentra/descarga la acción PDF del estudio que ya fue seleccionado y abierto. */
  findPdfAction?(): Promise<string | null>;
  downloadCurrentStudyPdf?(): Promise<CapturedPdf | null>;
}
