import type { AgentAction } from '../types.js';
import type { RawPageSnapshot } from '../../browser/types.js';
import type { HumanReason } from '../../jobs/job.js';
import { TOOL_DEFS, TOOL_NAMES, type ToolName } from './definitions.js';

type Schema = {
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  required?: readonly string[];
};

export type ValidationResult = { ok: true; action: AgentAction } | { ok: false; reason: string };

const DEFS = new Map<string, Schema>(TOOL_DEFS.map((t) => [t.name, t.input_schema as Schema]));

function checkValue(value: unknown, schema: Schema, path: string): string | null {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string' || value.length > 200) return `${path} debe ser texto`;
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${path} debe ser un entero`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} es menor que ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} es mayor que ${schema.maximum}`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${path} debe ser true o false`;
      break;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} debe ser un objeto`;
      const err = checkObject(value as Record<string, unknown>, schema, path);
      if (err) return err;
      break;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} no es un valor permitido`;
  return null;
}

function checkObject(obj: Record<string, unknown>, schema: Schema, path: string): string | null {
  const props = schema.properties ?? {};
  for (const key of Object.keys(obj)) if (!(key in props)) return `${path}${key} no existe`;
  for (const key of schema.required ?? []) if (obj[key] === undefined) return `falta ${path}${key}`;
  for (const [key, value] of Object.entries(obj)) {
    const err = checkValue(value, props[key], `${path}${key}`);
    if (err) return err;
  }
  return null;
}

/**
 * Valida una decisión del modelo contra el esquema de su herramienta antes de ejecutarla.
 * Los argumentos con valor null se descartan (algunos modelos los devuelven para campos opcionales).
 */
export function validateAction(candidate: unknown): ValidationResult {
  if (typeof candidate !== 'object' || candidate === null) return { ok: false, reason: 'respuesta vacía' };
  const { tool, args } = candidate as { tool?: unknown; args?: unknown };
  if (typeof tool !== 'string' || !TOOL_NAMES.has(tool)) return { ok: false, reason: 'herramienta no disponible' };
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return { ok: false, reason: 'argumentos inválidos' };
  }
  const clean = Object.fromEntries(Object.entries((args ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined));
  const err = checkObject(clean, DEFS.get(tool)!, '');
  if (err) return { ok: false, reason: err };
  return { ok: true, action: { tool: tool as ToolName, args: clean } };
}

/** Impide que el modelo invente un desafío de seguridad o un modal que el usuario no ve. */
export function validateHumanActionEvidence(reason: HumanReason, page: RawPageSnapshot): boolean {
  switch (reason) {
    case 'captcha':
      return page.captcha;
    case 'mfa':
      return page.otp;
    case 'session_expired':
      return page.hasPasswordField;
    case 'security_check':
      return page.captcha || page.otp;
    case 'unknown_modal':
      return page.modal && /confirm|verific|seguridad|c[oó]digo|aceptar|continuar|autorizar/i.test(page.modalText);
    case 'ambiguous':
      return page.modal && page.modalText.trim().length > 0;
    case 'portal_changed':
      return page.pageType === 'unknown' && page.hintHits.length === 0 && !page.hasPasswordField;
  }
}
