import type { ProviderConfig } from '../providers/types.js';
import { sleep } from '../util.js';
import type { BrowserPort, RawPageSnapshot } from './types.js';

export interface LoginSignals {
  leftLoginUrl: boolean;
  noPasswordField: boolean;
  authHint: boolean;
  hasCollection: boolean;
  logoutAction: boolean;
}

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/** Ruta final de ingreso de LabWin. Puede redirigir entre www y el dominio raíz. */
export function isPercambResultsRoute(url: string, provider: ProviderConfig): boolean {
  if (provider.id !== 'percamb' || provider.studyExtractor !== 'labwin') return false;
  try {
    const parsed = new URL(url);
    return provider.allowedHosts.some(host => host.toLowerCase() === parsed.hostname.toLowerCase()) &&
      (!provider.requireHttps || parsed.protocol === 'https:') &&
      /^\/lwcloud\/percamb\/rol\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * LabWin sometimes labels ordinary search filters as OTP evidence. Only suppress that
 * ambiguous signal on the provider's exact results route when its heading or result
 * list is recognized; login challenges on other pages remain blocking.
 */
export function hasPercambResultsEvidence(snap: RawPageSnapshot, provider: ProviderConfig): boolean {
  return isPercambResultsRoute(snap.url, provider) && (
    [...snap.hintHits, ...snap.headings].some(text => fold(text).includes('RESULTADOS ONLINE')) ||
    snap.pageType === 'results_list'
  );
}

const LOGOUT = /cerrar sesi[oó]n|salir|logout|log out|desconectar/i;

/**
 * Combina varias señales para decidir si el paciente ya inició sesión. Ninguna alcanza sola:
 * - no hay campo de contraseña visible (obligatoria), y
 * - salió de la URL de ingreso o aparece una pista del área autenticada, y
 * - en total, al menos 3 de las 5 señales.
 */
export function evaluateLogin(snap: RawPageSnapshot, provider: ProviderConfig): { authenticated: boolean; score: number; signals: LoginSignals } {
  let path = '';
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(snap.url);
    path = parsedUrl.pathname;
  } catch {
    /* URL interna */
  }
  const signals: LoginSignals = {
    leftLoginUrl: !!path && !provider.loginPathPattern.test(path),
    noPasswordField: !snap.hasPasswordField,
    authHint: snap.hintHits.length > 0,
    hasCollection: snap.collections.length > 0 || (provider.studyExtractor === 'centrodm' && snap.centroDmStudyList === true),
    logoutAction: snap.elements.some((e) => LOGOUT.test(e.label)),
  };
  const score = Object.values(signals).filter(Boolean).length;
  const percambResultsPage = hasPercambResultsEvidence(snap, provider);
  const otpChallenge = snap.otp && !percambResultsPage;
  const noChallenge = !snap.captcha && !otpChallenge && !snap.modal;
  const specificHint = snap.hintHits.some(hint => !/^(ESTUDIOS|PERFIL)$/.test(fold(hint).trim()));
  const typedStudies = snap.collections.some(collection => {
    const headers = fold(collection.headers.join(' '));
    return /FECHA/.test(headers) && /MODALIDAD/.test(headers) && /ESTUDIO|DESCRIPCION/.test(headers);
  });
  const centroAction = snap.elements.some(element => /\/funcion\/llamadoURL\.php(?:\?|$)/i.test(element.href));
  // LabWin redirige a /rol al terminar el ingreso. En algunas variantes de la página
  // el listado se dibuja en controles legacy que el colector no reconoce como texto;
  // el host permitido + esta ruta exacta son la señal específica de autenticación.
  const percambResultsRoute = isPercambResultsRoute(snap.url, provider);
  const evidence = provider.studyExtractor === 'centrodm'
    ? (specificHint || signals.logoutAction) && (typedStudies || centroAction || snap.centroDmStudyList === true || (snap.noResultsText && signals.logoutAction))
    : specificHint && (signals.leftLoginUrl || signals.hasCollection || signals.logoutAction) || percambResultsRoute;
  const authenticated = signals.noPasswordField && noChallenge && evidence && (score >= 3 || percambResultsRoute);
  return { authenticated, score, signals };
}

export type LoginWaitResult = 'authenticated' | 'timeout' | 'aborted';

/**
 * Espera a que el paciente termine de iniciar sesión, sin preguntarle nada.
 * Exige dos lecturas positivas seguidas para no confundir una transición con el área autenticada.
 */
export async function waitForLogin(
  port: BrowserPort,
  provider: ProviderConfig,
  opts: { timeoutMs: number; signal: AbortSignal; pollMs?: number },
): Promise<LoginWaitResult> {
  const deadline = Date.now() + opts.timeoutMs;
  const poll = opts.pollMs ?? 1000;
  let streak = 0;
  let candidate = '';
  while (!opts.signal.aborted) {
    if (Date.now() > deadline) return 'timeout';
    const snap = await (port.loginSnapshot ? port.loginSnapshot(provider.authenticatedHints) : port.snapshot(provider.authenticatedHints)).catch(() => null);
    if (opts.signal.aborted) return 'aborted';
    if (snap && evaluateLogin(snap, provider).authenticated) {
      const identity = snap.loginPageId || 'current';
      if (identity !== candidate) { candidate = identity; streak = 0; }
      if (++streak >= 2) {
        if (!port.confirmLogin || await port.confirmLogin(snap)) return opts.signal.aborted ? 'aborted' : 'authenticated';
        streak = 0;
      }
    } else {
      streak = 0;
    }
    await sleep(poll, opts.signal);
  }
  return 'aborted';
}
