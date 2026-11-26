import type { ElementHandle, Frame } from 'playwright';
import type { OneUseLogin } from '../jobs/login-credentials.js';
import type { ProviderConfig } from '../providers/types.js';
import type { RawPageSnapshot } from './types.js';

type FormConfig = NonNullable<ProviderConfig['loginForm']>;

export type LoginSubmission = {
  submitted: boolean;
  clear(): Promise<void>;
};

export function loginChallenge(snap: RawPageSnapshot) {
  if (snap.captcha) return 'captcha';
  if (snap.otp) return 'mfa';
  if (snap.modal) return 'security_check';
  return null;
}

/** Selects a unique, visible patient form and uses its own submit control. */
export async function submitProviderLogin(
  frame: Frame, config: FormConfig, login: OneUseLogin, signal: AbortSignal, expectedOrigin?: string,
): Promise<LoginSubmission | null> {
  if (signal.aborted) return null;
  const controls = await frame.evaluateHandle(({ usernamePattern, scriptSubmit, selectors, expectedOrigin }) => {
    if (expectedOrigin && location.origin !== expectedOrigin) return null;
    const field = {
      visible(el: Element) {
        const style = getComputedStyle(el);
        return !!el.getClientRects().length && style.visibility === 'visible' && Number(style.opacity) > 0.02;
      },
      editable(el: HTMLInputElement) {
        return field.visible(el) && !el.readOnly && !el.matches(':disabled');
      },
    };
    const scope = selectors ? document.querySelectorAll<HTMLFormElement>(selectors.form) : null;
    if (scope && scope.length !== 1) return null;
    const passwords = Array.from((scope?.[0] || document).querySelectorAll<HTMLInputElement>(
      selectors?.password ?? 'input[type=password]',
    )).filter(field.editable);
    if (passwords.length !== 1 || passwords[0].autocomplete === 'new-password') return null;
    const password = passwords[0];
    const form = password.form;
    if (scope && form !== scope[0]) return null;
    const root = form || document;
    if (selectors?.termsCheckbox) {
      const terms = root.querySelectorAll<HTMLInputElement>(selectors.termsCheckbox);
      if (terms.length !== 1 || terms[0].form !== form || !field.visible(terms[0]) || terms[0].matches(':disabled')) return null;
    }
    const users = Array.from(root.querySelectorAll<HTMLInputElement>(selectors?.username ?? 'input')).filter(el =>
      el.form === form && /^(text|email|tel|number)$/.test(el.type) && field.editable(el) && el.autocomplete !== 'one-time-code');
    const pattern = new RegExp(usernamePattern, 'i');
    const matching = users.filter(el => pattern.test([
      el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label'),
      ...Array.from(el.labels || [], label => label.textContent),
    ].join(' ')));
    const username = matching.length === 1 ? matching[0] : users.length === 1 ? users[0] : null;
    if (!username) return null;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button,input[type=submit],input[type=button],input[type=image]',
    )).filter(button => field.visible(button) && button.form === form);
    const actions = buttons.filter(button => {
      if (selectors && (button.textContent?.trim() || button.value) !== selectors.submitText) return false;
      if (form && /^(submit|image)$/.test(button.type)) {
        const method = button.getAttribute('formmethod') ?? form.method;
        const target = new URL(button.getAttribute('formaction') ?? form.action, location.href);
        return method.toLowerCase() === 'post' && target.origin === location.origin &&
          (!selectors || target.pathname === selectors.actionPath);
      }
      return scriptSubmit && (button.type === 'button' || !form) &&
        /^(?:entrar|ingresar|iniciar sesi[oó]n|acceder|login|sign in)$/i.test(
          (button.getAttribute('aria-label') || button.textContent || button.value).trim());
    });
    return actions.length === 1 ? { username, password, submit: actions[0] } : null;
  }, { ...config, expectedOrigin });
  let user: ElementHandle | null = null;
  let password: ElementHandle | null = null;
  let submit: ElementHandle | null = null;
  const clear = async () => {
    await Promise.all([user, password].map(field => field?.evaluate(el => {
      if (!(el instanceof HTMLInputElement) || !el.isConnected) return;
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {})));
    await Promise.all([user, password, submit].map(field => field?.dispose().catch(() => {})));
  };
  try {
    if (!await controls.evaluate(value => !!value) || signal.aborted) return null;
    user = (await controls.getProperty('username')).asElement();
    password = (await controls.getProperty('password')).asElement();
    submit = (await controls.getProperty('submit')).asElement();
    if (!user || !password || !submit || signal.aborted) { await clear(); return null; }
    const value = login.take();
    const selectors = config.selectors;
    if (!value || (selectors?.termsCheckbox && value.providerTermsAccepted !== true)) { await clear(); return null; }
    try {
      await user.fill(value.username, { timeout: 2000 });
      if (signal.aborted) { await clear(); return null; }
      await password.fill(value.password, { timeout: 2000 });
      if (signal.aborted) { await clear(); return null; }
      if (selectors?.termsCheckbox) {
        const terms = frame.locator(selectors.form).locator(selectors.termsCheckbox);
        await terms.check({ timeout: 2000 });
        if (!await terms.isChecked({ timeout: 1000 })) return { submitted: false, clear };
        if (signal.aborted) { await clear(); return null; }
      }
      await submit.click({ timeout: 2500, noWaitAfter: true });
      return { submitted: true, clear };
    } catch {
      // The submission may have navigated even when Playwright lost the element.
      // Let the same context settle before deciding whether it needs help.
      return { submitted: false, clear };
    }
  } finally {
    await controls.dispose().catch(() => {});
  }
}
