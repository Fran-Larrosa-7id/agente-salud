/**
 * Errores de la capa de inferencia. Los mensajes son códigos fijos: nunca incluyen
 * la respuesta del modelo ni la observación (podrían repetir contenido de la página).
 */

/** El modelo no responde o no existe (p. ej. Ollama apagado o modelo sin descargar). No hay reintento ni fallback. */
export class ModelUnavailableError extends Error {
  constructor(readonly reason: 'OFFLINE' | 'MODEL_NOT_FOUND') {
    super('MODEL_UNAVAILABLE');
  }
}

/** El modelo respondió, pero no con una decisión válida. Cuenta como paso del agente y se reintenta. */
export class InvalidModelOutputError extends Error {
  constructor(readonly reason: string) {
    super('MODEL_INVALID_OUTPUT');
  }
}
