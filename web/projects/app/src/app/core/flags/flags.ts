/**
 * Feature flags (ADR-0004): unfinished features ship behind a flag that is off by default, so `main` is always
 * releasable. A finished feature's flag is deleted from this registry.
 *
 * Flags are read once per page load from `localStorage['rmq.flags']` and from `?ff=` in the URL. Both hold a list
 * separated by commas or spaces, for example `?ff=editor`.
 */
export const FLAGS = {
  editor: {
    default: false,
    description: 'The editor: toolbox, inspector, canvas, undo, linking and the command bar (slices S4 and S5).',
  },
} as const satisfies Record<string, { readonly default: false; readonly description: string }>;
// `default: false` is a literal type, so turning a flag on by default does not compile. A test checks it at runtime too.

export type FlagName = keyof typeof FLAGS;

export const FLAG_NAMES = Object.keys(FLAGS) as readonly FlagName[];

export const FLAGS_STORAGE_KEY = 'rmq.flags';
export const FLAGS_QUERY_PARAM = 'ff';

/** The raw text of each place a flag list can come from. `null` means the place has nothing to say. */
export interface FlagSources {
  readonly stored: string | null;
  readonly query: string | null;
}

export interface ResolvedFlags {
  readonly enabled: ReadonlySet<FlagName>;
  /** Names that were asked for but are not in the registry, usually a typo or a flag that has since shipped. */
  readonly unknown: readonly string[];
}

/** Splits a flag list on commas and white space, lower-cases it and drops empty and repeated names. */
export function parseFlagList(raw: string | null | undefined): string[] {
  const names = (raw ?? '')
    .split(/[\s,]+/)
    .map((name) => name.toLowerCase())
    .filter((name) => name !== '');
  return [...new Set(names)];
}

const isKnown = (name: string): name is FlagName => Object.hasOwn(FLAGS, name);

/** Every flag is off unless a source names it. The two sources add up. */
export function resolveFlags(sources: FlagSources): ResolvedFlags {
  const enabled = new Set<FlagName>();
  const unknown: string[] = [];

  for (const name of [...parseFlagList(sources.stored), ...parseFlagList(sources.query)]) {
    if (isKnown(name)) {
      enabled.add(name);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }

  return { enabled, unknown };
}

/** The part of `window` that flags need. */
export interface FlagWindow {
  readonly localStorage: Pick<Storage, 'getItem'>;
  readonly location: Pick<Location, 'search'>;
}

/**
 * Reads both sources from a window. Reading `localStorage` throws when storage is blocked (private modes, strict
 * cookie settings), and that must never stop the app from starting.
 */
export function readFlagSources(win: FlagWindow | null): FlagSources {
  if (!win) {
    return { stored: null, query: null };
  }

  return { stored: readStored(win), query: new URLSearchParams(win.location.search).get(FLAGS_QUERY_PARAM) };
}

function readStored(win: FlagWindow): string | null {
  try {
    return win.localStorage.getItem(FLAGS_STORAGE_KEY);
  } catch {
    return null;
  }
}
