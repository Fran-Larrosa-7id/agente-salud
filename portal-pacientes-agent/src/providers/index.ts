import { percamb } from './percamb/percamb.provider.js';
import type { ProviderConfig } from './types.js';

/** Alcance del MVP: solo Pérez Cambet. */
export const PROVIDERS: Record<string, ProviderConfig> = {
  [percamb.id]: percamb,
};

export type { ProviderConfig } from './types.js';
