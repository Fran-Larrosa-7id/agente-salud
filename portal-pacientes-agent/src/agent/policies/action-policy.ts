import type { RawElement } from '../../browser/types.js';
import type { DomainPolicy } from '../../security/domain-policy.js';
import type { GoalKind } from '../types.js';

/**
 * Política de acciones. Se aplica en el backend ANTES de ejecutar cualquier herramienta,
 * independientemente de lo que decida el modelo. El modelo además ve el motivo del bloqueo.
 */

/** Etiquetas de acciones de escritura o fuera del alcance del agente. */
export const FORBIDDEN_LABEL =
  /(?:^|[^\p{L}])(eliminar|borrar|quitar|modificar|editar|cambiar|actualizar|contraseñ|contrasen|password|clave|pagar|pago|abonar|comprar|carrito|turno|reservar|agendar|cancelar|confirmar|aceptar|acepto|enviar|guardar|registrar|suscrib|cerrar sesi|salir|logout|compartir|firmar|autorizar|olvid|recuperar|agregar|subir|adjuntar|nuevo paciente|cambiar paciente|otro paciente|grupo familiar)/iu;

/** Botones de envío que solo consultan (filtros de búsqueda). */
const READONLY_SUBMIT = /^(buscar|filtrar|consultar|ver|mostrar|aplicar|ir)(\s|$)/i;

export interface PolicyContext {
  goal: GoalKind;
  domains: DomainPolicy;
  /** Tabla y fila del estudio seleccionado, si están en la página actual. */
  targetCollection?: string;
  targetRow?: number;
  /** El agente ya abrió el estudio seleccionado en este objetivo. */
  targetOpened: boolean;
  downloadsUsed: number;
  maxDownloads: number;
}

export function elementBlockReason(el: RawElement, ctx: PolicyContext): string | undefined {
  if (el.disabled) return 'deshabilitado';
  if (el.inPasswordForm) return 'formulario de ingreso';
  if (FORBIDDEN_LABEL.test(el.label)) return 'acción de escritura o fuera de alcance';
  if (el.href) {
    if (/^(mailto|tel|sms|whatsapp|ftp|file|data):/i.test(el.href)) return 'enlace externo';
    if (/^https?:/i.test(el.href) && !ctx.domains.isAllowedNavigation(el.href)) return 'dominio no permitido';
  }
  if (el.isSubmit && !READONLY_SUBMIT.test(el.label.trim())) return 'envía un formulario';
  if (ctx.goal === 'DOWNLOAD_STUDY' && ctx.targetCollection && el.collection === ctx.targetCollection && el.row !== ctx.targetRow) {
    return 'otro estudio';
  }
  return undefined;
}

export function downloadBlockReason(el: RawElement, ctx: PolicyContext): string | undefined {
  if (ctx.goal !== 'DOWNLOAD_STUDY') return 'no se descarga nada durante la búsqueda';
  if (ctx.downloadsUsed >= ctx.maxDownloads) return 'límite de descargas alcanzado';
  const inTargetRow = !!ctx.targetCollection && el.collection === ctx.targetCollection && el.row === ctx.targetRow;
  if (!ctx.targetOpened && !inTargetRow) return 'primero abrí el estudio seleccionado';
  return elementBlockReason(el, ctx);
}
