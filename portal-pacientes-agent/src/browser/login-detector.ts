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

const LOGOUT = /cerrar sesi[oó]n|salir|logout|log out|desconectar/i;

/**
 * Combina varias señales para decidir si el paciente ya inició sesión. Ninguna alcanza sola:
 * - no hay campo de contraseña visible (obligatoria), y
 * - salió de la URL de ingreso o aparece una pista del área autenticada, y
 * - en total, al menos 3 de las 5 señales.
 */
export function evaluateLogin(snap: RawPageSnapshot, provider: ProviderConfig): { authenticated: boolean; score: number; signals: LoginSignals } {
  let path = '';
  try {
    path = new URL(snap.url).pathname;
  } catch {
    /* URL interna */
  }
  const signals: LoginSignals = {
    leftLoginUrl: !!path && !provider.loginPathPattern.test(path),
    noPasswordField: !snap.hasPasswordField,
    authHint: snap.hintHits.length > 0,
    hasCollection: snap.collections.length > 0,
    logoutAction: snap.elements.some((e) => LOGOUT.test(e.label)),
  };
  const score = Object.values(signals).filter(Boolean).length;
  const authenticated = signals.noPasswordField && (signals.leftLoginUrl || signals.authHint) && score >= 3;
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
  while (!opts.signal.aborted) {
    if (Date.now() > deadline) return 'timeout';
    const snap = await port.snapshot(provider.authenticatedHints).catch(() => null);
    if (snap && evaluateLogin(snap, provider).authenticated) {
      if (++streak >= 2) return 'authenticated';
    } else {
      streak = 0;
    }
    await sleep(poll, opts.signal);
  }
  return 'aborted';
}
