/**
 * Allowlist de dominios.
 *
 * - Navegación de documentos (la pestaña cambia de página): solo hosts del laboratorio.
 * - Subrecursos (fuentes, estilos): hosts del laboratorio + hosts estáticos declarados por el proveedor.
 * Cualquier otra cosa se bloquea. Una navegación a un dominio inesperado detiene al agente.
 */
export class DomainPolicy {
  private readonly nav: Set<string>;
  private readonly statics: Set<string>;

  constructor(allowedHosts: string[], staticHosts: string[] = []) {
    this.nav = new Set(allowedHosts.map((h) => h.toLowerCase()));
    this.statics = new Set(staticHosts.map((h) => h.toLowerCase()));
  }

  static hostOf(url: string): string | null {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  static isTransientBlank(url: string): boolean {
    return url === '' || /^about:blank(?:#.*)?$/i.test(url);
  }

  /** Identificadores internos del visor no son hosts permitidos ni destinos descargables. */
  static isBrowserPdfViewer(url: string): boolean {
    return /^(?:edge|chrome|chrome-extension):\/\//i.test(url);
  }

  isAllowedNavigation(url: string): boolean {
    if (DomainPolicy.isTransientBlank(url)) return true;
    if (/^blob:/i.test(url)) return this.isAllowedNavigation(url.slice(5));
    if (!/^https?:/i.test(url)) return false;
    const host = DomainPolicy.hostOf(url);
    return !!host && this.nav.has(host);
  }

  isAllowedSubresource(url: string): boolean {
    if (DomainPolicy.isTransientBlank(url)) return true;
    if (/^blob:/i.test(url)) return this.isAllowedNavigation(url);
    if (!/^https?:/i.test(url)) return false;
    const host = DomainPolicy.hostOf(url);
    return !!host && (this.nav.has(host) || this.statics.has(host));
  }
}
