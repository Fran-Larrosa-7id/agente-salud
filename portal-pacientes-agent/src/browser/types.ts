import type { CapturedPdf } from '../jobs/pdf.js';
import type { CapturedMedicalArchive } from '../jobs/medical-archive.js';

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
  /** Señal booleana del extractor Centro DM; sin filas ni identificadores añadidos. */
  centroDmStudyList?: boolean;
  /** Identificador efímero de la pestaña candidata; solo lo usa el detector de login. */
  loginPageId?: string;
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

/** Metadata administrativa del listado; `date` es la fecha real del estudio en el modelo actual del portal. */
export interface ProviderStudyMetadata {
  id: string;
  /** SHA-256 de una referencia estable del proveedor o de sus metadatos; nunca expone la URL original. */
  sourceKey?: string;
  date?: string;
  studyDate?: string;
  protocol?: string;
  deliveryDate?: string;
  status?: string;
  title?: string;
  studyType?: string;
  modality?: string;
}

export interface ProviderStudyList {
  recognized: true;
  listUrl: string;
  studies: ProviderStudyMetadata[];
}

export interface CentroDmStudyReference {
  listUrl: string;
  frame: number;
  /** URL de apertura efímera: solo se conserva mientras vive el job. */
  openHref: string;
  /** Huella opaca; el identificador del query no se retiene en la referencia. */
  sourceKey: string;
  actionToken: string;
  targetBlank: boolean;
  date?: string;
  title?: string;
  modality?: string;
}

export interface RdcChacabucoStudyReference {
  studyId: string;
  frame: number;
  /** Índice del icono fa-file dentro del frame; solo sirve para relocalizarlo. */
  actionIndex: number;
  rowIndex: number;
  actionCount: number;
  /** Token efímero en el document actual; detecta navegación sin guardar URL ni query. */
  documentToken: string;
  iconToken: string;
  sourceKey: string;
}

/** El proveedor mostró acciones de estudios que el extractor no pudo asociar con filas. */
export class ProviderParserMismatchError extends Error {
  readonly code = 'PROVIDER_PARSER_MISMATCH';
  constructor(readonly resultActions: number, readonly candidateRows: number, readonly parsedStudies = 0) {
    super('PROVIDER_PARSER_MISMATCH');
  }
}

export interface ProviderStructureEvent {
  event: 'percamb_page' | 'percamb_login_probe' | 'percamb_login_confirm' | 'percamb_result_links' | 'percamb_result_actions' | 'percamb_candidate_rows' | 'percamb_parsed_studies' | 'percamb_metadata_complete' | 'percamb_action' | 'percamb_ancestor' |
    'centrodm_page' | 'centrodm_tables' | 'centrodm_rows' | 'centrodm_result_actions' | 'centrodm_minimal_studies' | 'centrodm_metadata_enriched' | 'centrodm_metadata_partial' | 'centrodm_metadata_dates_found' | 'centrodm_studies_with_date' | 'centrodm_study_metadata' | 'centrodm_rows_with_action' | 'centrodm_action' | 'centrodm_parsed_studies' | 'centrodm_results' | 'centrodm_study_action' | 'centrodm_viewer_opened' | 'centrodm_viewer_detected' | 'centrodm_download_button' | 'centrodm_download_options' | 'centrodm_download_choice' | 'centrodm_archive_valid' | 'viewer_opened' | 'viewer_detected' | 'viewer_detection_signals' | 'viewer_reference_check' | 'viewer_download_button' | 'viewer_download_options' | 'viewer_download_strategy' | 'medical_archive_downloaded' |
    'pixeon_frames' | 'pixeon_frame' | 'pixeon_download_probe' | 'pixeon_download_probe_start' | 'pixeon_download_probe_end' | 'pixeon_download_fastpath' | 'pixeon_download_click' | 'pixeon_download_options' | 'pixeon_text_exact' | 'pixeon_text_partial' | 'pixeon_attr_candidates' | 'pixeon_dom_candidate' | 'pixeon_clickable_ancestor' | 'pixeon_structural_fallback' | 'pixeon_toolbar_candidates' | 'toolbar_candidate' | 'pixeon_toolbar_detected' | 'pixeon_download_structural_candidate' | 'find_document_dispatch' | 'centrodm_find_document_enter' | 'pixeon_download_text_matches' | 'pixeon_download_role_matches' | 'pixeon_download_attr_matches' | 'pixeon_download_menu_options' | 'pixeon_probe' | 'pixeon_cookie_consent' | 'pixeon_download_candidate' | 'pixeon_download_button' | 'pixeon_download_menu' | 'pixeon_download_choice' |
    'rdc_page' | 'rdc_rows' | 'rdc_file_icons' | 'rdc_file_icons_fallback' | 'rdc_file_icons_class_fallback' | 'rdc_file_icons_global' | 'rdc_result_actions' | 'rdc_candidate_rows' | 'rdc_parsed_studies' | 'rdc_studies_found' | 'rdc_action_build' | 'rdc_study_action' | 'rdc_study_build' | 'rdc_study_reference_saved' | 'rdc_provider_refs' | 'rdc_open_study' | 'rdc_document_listeners_ready' | 'rdc_study_action_click' | 'rdc_modal_opened' | 'rdc_frame_navigation' | 'rdc_frames' | 'rdc_frame' | 'rdc_modal_probe' | 'rdc_pdf_sources_scan' | 'rdc_pdf_dom_candidate' | 'rdc_embed_candidates' | 'rdc_embed_candidate' | 'rdc_embed_fetch' | 'rdc_nested_source_scan' | 'rdc_pdf_response' | 'rdc_pdf_candidate' | 'rdc_pdf_source' | 'rdc_pdf_full' | 'rdc_pdf_valid' | 'rdc_external_origin' | 'rdc_import_complete';
  count?: number;
  index?: number;
  hasDate?: boolean;
  depth?: number;
  tag?: string;
  host?: string;
  port?: string;
  found?: boolean;
  routeMatched?: boolean;
  resultsPage?: boolean;
  snapshotOk?: boolean;
  passwordVisible?: boolean;
  captcha?: boolean;
  otp?: boolean;
  otpSuppressed?: boolean;
  modal?: boolean;
  authenticated?: boolean;
  popup?: boolean;
  links?: number;
  textNodes?: number;
  siblings?: number;
  classType?: string;
  hrefMatch?: boolean;
  hrefPresent?: boolean;
  hrefKind?: 'llamadoURL';
  ancestorTr?: boolean;
  type?: 'results_list';
  strategy?: 'full_dicom_zip' | 'pixeon' | 'class_fastpath' | 'stored_reference' | 'icon' | 'clickable_ancestor' | 'ancestor_wrapper' | 'response' | 'response_full' | 'range_reassembly' | 'iframe' | 'iframe_fetch' | 'iframe_browser_fetch' | 'embed' | 'embed_fetch' | 'embed_browser_fetch' | 'nested_embed_browser_fetch' | 'object' | 'object_fetch' | 'object_browser_fetch' | 'blob' | 'blob_fetch' | 'data' | 'data_url' | 'download' | 'context_request';
  kind?: 'full_dicom_zip';
  selector?: 'downloadToolsItem' | 'i.fa.fa-file.icon-size' | 'i.fa-file' | '.fa-file.icon-size' | '.fa-file';
  elapsedMs?: number;
  intercepted?: boolean;
  brand?: boolean;
  download?: boolean;
  imageToolbar?: boolean;
  downloadCandidates?: number;
  toolbarCandidates?: number;
  readyScore?: number;
  frames?: number;
  frameIndex?: number;
  isMain?: boolean;
  clickableAncestorDepth?: number;
  classNamesSanitized?: string;
  parentTag?: string;
  parentClassSanitized?: string;
  hasOnclick?: boolean;
  hasTabindex?: boolean;
  matchedAttribute?: string;
  toolbarConfidence?: boolean;
  keepViewerOpen?: boolean;
  ttlMs?: number;
  cursorPointer?: boolean;
  xBucket?: number;
  widthBucket?: string;
  childElementCount?: number;
  svgCount?: number;
  imgCount?: number;
  dataTestIdPresent?: boolean;
  dataActionPresent?: boolean;
  actionHint?: string;
  started?: boolean;
  viewer?: boolean;
  candidates?: number;
  reason?: string;
  status?: number;
  contentType?: string;
  contentLengthPresent?: boolean;
  contentRangePresent?: boolean;
  acceptRangesPresent?: boolean;
  bodyBytes?: number;
  magic?: string;
  rejected?: boolean;
  attr?: 'src' | 'data' | 'href' | 'data-src' | 'data-pdf' | 'data-url';
  iframes?: number;
  embeds?: number;
  objects?: number;
  blobSources?: number;
  dataPdfSources?: number;
  sameOriginSources?: number;
  sameOrigin?: boolean;
  typePdf?: boolean;
  role?: string;
  textMatch?: boolean;
  visible?: boolean;
  detected?: boolean;
  accepted?: boolean;
  opened?: boolean;
  studyRefFound?: boolean;
  actionIndex?: number;
  iconFound?: boolean;
  locatorCount?: number;
  hasActionIndex?: boolean;
  hasStableSelector?: boolean;
  clickableFound?: boolean;
  studyCreated?: boolean;
  refCreated?: boolean;
  metadataEnriched?: boolean;
}

/** Puerto que usa el agente para actuar sobre el navegador. Permite testear el agente sin Playwright. */
export interface BrowserPort {
  loginSnapshot?(hints: string[]): Promise<RawPageSnapshot>;
  confirmLogin?(snapshot: RawPageSnapshot): Promise<boolean>;
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
  closeRdcChacabucoModal?(): Promise<void>;
  isStudyOpen?(studyId: string): boolean;
  /** Encuentra/descarga la acción PDF del estudio que ya fue seleccionado y abierto. */
  findPdfAction?(): Promise<string | null>;
  downloadCurrentStudyPdf?(): Promise<CapturedPdf | null>;
  isCentroDmResultsPage?(): Promise<boolean>;
  isRdcChacabucoResultsPage?(): Promise<boolean>;
  downloadRdcChacabucoStudyPdf?(): Promise<CapturedPdf | null>;
  downloadFullDicomStudy?(timeoutMs: number): Promise<CapturedMedicalArchive>;
}
