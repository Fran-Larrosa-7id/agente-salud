import { percamb } from './percamb/percamb.provider.js';
import { centroDm } from './centrodm/centrodm.provider.js';
import { rdcChacabuco } from './rdcchacabuco/rdcchacabuco.provider.js';
import type { ProviderConfig } from './types.js';

/** Providers conocidos. Los orígenes del viewer Pixeon se agregan solo por configuración explícita. */
export const PROVIDERS: Record<string, ProviderConfig> = {
  [percamb.id]: percamb,
  [centroDm.id]: centroDm,
  [rdcChacabuco.id]: rdcChacabuco,
};

export type { ProviderConfig } from './types.js';
