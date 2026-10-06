/**
 * Configuración de un portal externo. Está permitido fijar acá la URL inicial, los dominios y las
 * pistas conocidas; NO la navegación. Las pistas ayudan al agente, no reemplazan su razonamiento.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  loginUrl: string;
  /** Hosts donde el navegador puede navegar. Una navegación fuera de esta lista detiene al agente. */
  allowedHosts: string[];
  /** Orígenes HTTPS adicionales, fijados completos (incluido puerto), para viewers externos. */
  allowedOrigins?: string[];
  requireHttps?: boolean;
  /** Hosts de recursos estáticos (fuentes) que el sitio carga. Nunca se navega a ellos. */
  staticHosts: string[];
  /** La URL de ingreso coincide con este patrón. */
  loginPathPattern: RegExp;
  /** Textos que solo aparecen en el área autenticada. */
  authenticatedHints: string[];
  /** Etiquetas conocidas de la acción que entrega el PDF. */
  expectedPdfLabels: string[];
  /** Pistas sobre la zona de resultados. */
  resultsHints: string[];
  /** Nota breve para el agente sobre el portal (sin datos de pacientes). */
  agentNotes: string;
  /** Extractor DOM de solo lectura, habilitado solo para portales relevados y cubiertos por tests. */
  studyExtractor?: 'labwin' | 'centrodm' | 'rdcchacabuco';
}
