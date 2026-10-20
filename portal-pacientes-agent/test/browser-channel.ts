import { loadDotEnv } from '../src/config.js';

loadDotEnv();

/** Share the app's optional Playwright channel with the integration tests. */
export const testBrowserChannel = process.env.BROWSER_CHANNEL?.trim() || undefined;
/** Installed Edge on Windows cannot use Playwright's Chromium sandbox switch. Linux tests keep it on. */
export const testChromiumSandbox = process.platform !== 'win32';
