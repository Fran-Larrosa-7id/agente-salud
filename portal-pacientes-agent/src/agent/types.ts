import type { RawPageSnapshot } from '../browser/types.js';
import type { HumanReason } from '../jobs/job.js';
import type { ExternalStudy } from '../jobs/job.js';
import type { CapturedPdf } from '../jobs/pdf.js';
import type { ToolName } from './tools/definitions.js';

export type GoalKind = 'DISCOVER_STUDIES' | 'DOWNLOAD_STUDY';

/** Cómo volver a encontrar la fila de un estudio sin guardar ni enviar su contenido. */
export interface TargetLocator {
  studyId: string;
  /** Firma de la tabla de resultados (encabezados normalizados + cantidad de columnas). */
  signature?: string;
  /** SHA-256 truncado del contenido de la fila. */
  fingerprint?: string;
  listUrl?: string;
}

export interface AgentGoal {
  kind: GoalKind;
  target?: TargetLocator;
}

export interface ElementObs {
  id: string;
  role: string;
  label: string;
  icon?: string;
  href?: string;
  opensNewTab?: boolean;
  collection?: string;
  row?: number;
  /** Pertenece a la fila del estudio que hay que traer. */
  target?: boolean;
  disabled?: boolean;
  /** Si está bloqueado por política, el motivo. El agente no puede usarlo. */
  blocked?: string;
}

export interface CollectionObs {
  id: string;
  kind: 'table' | 'grid' | 'list';
  headers: string[];
  rowCount: number;
  /** Forma de cada columna según todas las filas: fecha, número, texto, interfaz, vacío. */
  columnShapes: string[];
  /** Primeras filas enmascaradas (solo formas o palabras de interfaz). */
  sampleRows: string[][];
  targetRow?: number;
}

export interface HistoryItem {
  step: number;
  tool: string;
  element?: string;
  outcome: 'ok' | 'bloqueado' | 'error' | 'sin_efecto';
  note?: string;
}

export interface AgentObservation {
  promptVersion: string;
  goal: { kind: GoalKind; instruction: string };
  step: number;
  maxSteps: number;
  remainingSeconds: number;
  page: {
    title: string;
    path: string;
    headings: string[];
    openPages: number;
    isPdfViewer: boolean;
    pdfEmbeds: number;
    modalOpen: boolean;
    modalText: string;
    noResultsText: boolean;
    captchaSuspected: boolean;
    otpSuspected: boolean;
    passwordFieldVisible: boolean;
  };
  elements: ElementObs[];
  elementsOmitted: number;
  collections: CollectionObs[];
  target?: { collection?: string; row?: number; visibleOnPage: boolean; alreadyOpened: boolean };
  hints: { expectedPdfLabels: string[]; resultsHints: string[]; notes: string };
  history: HistoryItem[];
  lastToolResult?: string;
}

export interface AgentAction {
  tool: ToolName;
  args: Record<string, unknown>;
}

/** Contrato con el proveedor de IA. El resto del sistema no conoce ningún SDK. */
export interface AgentModel {
  readonly name: string;
  decide(input: AgentObservation, opts: { signal: AbortSignal }): Promise<AgentAction>;
}

export interface ColumnMapping {
  date?: number;
  protocol?: number;
  deliveryDate?: number;
  status?: number;
}

export type GoalOutcome =
  | { kind: 'discovered'; collectionId: string | null; columns: ColumnMapping; snapshot: RawPageSnapshot; listUrl: string; studies?: ExternalStudy[] }
  | { kind: 'downloaded'; pdf: CapturedPdf }
  | { kind: 'human'; reason: HumanReason }
  | { kind: 'unable'; code: string }
  | { kind: 'aborted' };
