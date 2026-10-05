import * as fc from 'fast-check';

/** The seed used when `FC_SEED` is not set, so that a normal run explores the same cases every time. */
export const DEFAULT_FC_SEED = 20_261_005;

/** The number of cases per property when `FC_NUM_RUNS` is not set. The nightly fuzz job raises it to 5,000. */
export const DEFAULT_FC_NUM_RUNS = 100;

export interface FastCheckSettings {
  readonly seed: number;
  readonly numRuns: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Reads `FC_SEED` and `FC_NUM_RUNS`. A bad value throws instead of silently falling back, because a typo in a CI
 * variable would otherwise turn a 5,000-run fuzz job into a 100-run one without anyone noticing.
 */
export function readFastCheckSettings(env: Env): FastCheckSettings {
  return {
    seed: readInteger(env, 'FC_SEED', DEFAULT_FC_SEED, 0),
    numRuns: readInteger(env, 'FC_NUM_RUNS', DEFAULT_FC_NUM_RUNS, 1),
  };
}

/** Applies the settings from the environment to every fast-check property in the current test file. */
export function configureFastCheck(env: Env): FastCheckSettings {
  const settings = readFastCheckSettings(env);
  fc.configureGlobal({ seed: settings.seed, numRuns: settings.numRuns });
  return settings;
}

function readInteger(env: Env, name: string, fallback: number, minimum: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}, got "${raw}"`);
  }
  return value;
}
