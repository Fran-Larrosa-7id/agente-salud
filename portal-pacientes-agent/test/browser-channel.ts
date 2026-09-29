import { loadDotEnv } from '../src/config.js';

loadDotEnv();

/** Share the app's optional Playwright channel with the integration tests. */
export const testBrowserChannel = process.env.BROWSER_CHANNEL?.trim() || undefined;
