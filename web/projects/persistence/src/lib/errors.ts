import type { Issue } from '@rmq/domain';

/**
 * Every way that a load or a call to the repository can fail, as a value with a `kind` that a program branches on and a
 * `message` that a person reads (ADR-0027, ADR-0028). The message says the root cause in plain words, and what to do about it
 * where that is not obvious. It never names the product, which lives in one constant of the app.
 */

/** Which of the version numbers of ADR-0027 a `newer-version` error is about. */
export type VersionOf = 'schema' | 'file' | 'backup';

/** What can be wrong with data that is to become a canvas. */
export type LoadError =
  | { readonly kind: 'not-json'; readonly message: string }
  | { readonly kind: 'not-an-object'; readonly message: string }
  | { readonly kind: 'unknown-format'; readonly message: string }
  | {
      readonly kind: 'newer-version';
      readonly of: VersionOf;
      readonly found: number;
      readonly understood: number;
      readonly message: string;
    }
  | { readonly kind: 'unsupported-version'; readonly found: number; readonly message: string }
  | { readonly kind: 'migration-failed'; readonly from: number; readonly message: string }
  | {
      readonly kind: 'too-large';
      readonly what: TooLargeWhat;
      readonly found: number;
      readonly limit: number;
      readonly message: string;
    }
  | { readonly kind: 'invalid'; readonly issues: readonly Issue[]; readonly message: string };

/** What the browser can refuse, and what can go wrong with it. */
export interface StorageError {
  readonly kind: 'quota-exceeded' | 'blocked' | 'unavailable' | 'newer-database' | 'failed';
  readonly message: string;
  /** The browser's own words, for a log, when nothing more specific is known. */
  readonly detail?: string;
}

/** What the repository answers when it is asked for a canvas that is not there, or to make one that is. */
export type CanvasError =
  | { readonly kind: 'not-found'; readonly id: string; readonly message: string }
  | { readonly kind: 'exists'; readonly id: string; readonly message: string };

export type RepositoryError = LoadError | StorageError | CanvasError;

/** What a store throws when it can say what the browser refused. The repository turns it back into an answer. */
export class StorageFailure extends Error {
  constructor(readonly error: StorageError) {
    super(error.message);
    this.name = 'StorageFailure';
  }
}

/** What a cap is on (`SIZE_CAPS` has the numbers). */
export type TooLargeWhat =
  'elements' | 'edges' | 'positions' | 'labels' | 'headers' | 'text' | 'file' | 'canvases' | 'name';

/** A whole number with a comma between the thousands, the same in every locale. */
export const thousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** What a value is, in a few words, for a sentence that says "this is …". */
function describe(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return 'text';
    case 'number':
    case 'bigint':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'function':
      return 'a function';
    case 'symbol':
      return 'a symbol';
    case 'undefined':
      return 'nothing (undefined)';
    default:
      return value === null ? 'nothing (null)' : Array.isArray(value) ? 'a list' : 'an object';
  }
}

/** A value in a few characters, for a sentence that quotes what was found. It never throws. */
export function summarise(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
    case 'boolean':
      return String(value);
    case 'undefined':
      return 'nothing';
    case 'function':
      return 'a function';
    case 'symbol':
      return 'a symbol';
    default:
      return value === null ? 'null' : Array.isArray(value) ? 'a list' : 'an object';
  }
}

export const notJson = (reason: string): LoadError => ({
  kind: 'not-json',
  message: `This is not JSON, so it cannot be a canvas: ${reason}. The file may be cut off, or it may not be a canvas file at all.`,
});

export const notAnObject = (value: unknown): LoadError => ({
  kind: 'not-an-object',
  message: `This is not a canvas. A canvas is an object with fields in it, and this is ${describe(value)}.`,
});

export const unknownFormat = (message: string): LoadError => ({ kind: 'unknown-format', message });

const NEWER: Record<VersionOf, (found: number, understood: number) => string> = {
  schema: (found, understood) =>
    `This canvas was saved by a newer version of this app. It uses schema version ${found}, and this version understands up to ${understood}.`,
  file: (found, understood) =>
    `This file was saved by a newer version of this app. It is canvas file format ${found}, and this version reads up to format ${understood}.`,
  backup: (found, understood) =>
    `This backup was saved by a newer version of this app. It is backup format ${found}, and this version reads up to format ${understood}.`,
};

export const newerVersion = (of: VersionOf, found: number, understood: number): LoadError => ({
  kind: 'newer-version',
  of,
  found,
  understood,
  message: `${NEWER[of](found, understood)} Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.`,
});

export const unsupportedVersion = (found: number, current: number): LoadError => ({
  kind: 'unsupported-version',
  found,
  message: `This canvas uses schema version ${found}, and this version of the app has no way to bring it up to date to version ${current}. Nothing was loaded and nothing was changed.`,
});

export const migrationFailed = (from: number, to: number, reason: string): LoadError => ({
  kind: 'migration-failed',
  from,
  message: `This canvas uses schema version ${from}. Bringing it up to version ${to} failed: ${reason}. It is probably damaged. Nothing was loaded and nothing was changed.`,
});

const HOSTILE = 'It was not opened, so that a damaged or hostile file cannot make the page run out of memory.';

const TOO_LARGE: Record<TooLargeWhat, (found: string, limit: string) => string> = {
  elements: (found, limit) =>
    `This canvas has ${found} elements (exchanges, queues, producers and consumers), and one canvas can have at most ${limit}. ${HOSTILE} If the file is genuine, split it into smaller canvases.`,
  edges: (found, limit) =>
    `This canvas has ${found} edges (bindings, producer links and consumer subscriptions), and one canvas can have at most ${limit}. ${HOSTILE} If the file is genuine, split it into smaller canvases.`,
  positions: (found, limit) =>
    `This canvas keeps ${found} positions, and one canvas can have at most ${limit}, one for each element. ${HOSTILE} If the file is genuine, remove the positions of what is not on the canvas.`,
  labels: (found, limit) =>
    `This canvas keeps ${found} labels for its edges, and one canvas can have at most ${limit}, one for each edge. ${HOSTILE} If the file is genuine, remove the labels of what is not on the canvas.`,
  headers: (found, limit) =>
    `A message or a binding in this canvas has ${found} header entries, and one can have at most ${limit}. ${HOSTILE} If the file is genuine, remove some of the headers.`,
  text: (found, limit) =>
    `A payload or a header value in this canvas has ${found} characters, and one can have at most ${limit}. ${HOSTILE} If the file is genuine, shorten it.`,
  file: (found, limit) =>
    `This file has ${found} characters of text, and a file can have at most ${limit}. ${HOSTILE} If the file is genuine, make the file smaller or split it.`,
  canvases: (found, limit) =>
    `This backup has ${found} canvases, and one backup can have at most ${limit}. ${HOSTILE} If the file is genuine, split the backup into several files.`,
  name: (found, limit) => `The name has ${found} characters, and a name can have at most ${limit}. Shorten the name.`,
};

export const tooLarge = (what: TooLargeWhat, found: number, limit: number): LoadError => ({
  kind: 'too-large',
  what,
  found,
  limit,
  message: TOO_LARGE[what](thousands(found), thousands(limit)),
});

/** Every problem is kept. The sentence names the first, and counts the rest. */
export function invalidError(
  issues: readonly Issue[],
  subject = 'This canvas',
): Extract<LoadError, { kind: 'invalid' }> {
  const first = issues[0]?.message ?? 'it could not be read.';
  return {
    kind: 'invalid',
    issues,
    message:
      issues.length > 1
        ? `${subject} is not valid. The first of ${issues.length} problems: ${first}`
        : `${subject} is not valid: ${first}`,
  };
}

export const notFound = (id: string): CanvasError => ({
  kind: 'not-found',
  id,
  message: `There is no canvas with the id "${id}". It may have been deleted.`,
});

export const existsError = (id: string): CanvasError => ({
  kind: 'exists',
  id,
  message: `There is already a canvas with the id "${id}", so a new one could not be made with it.`,
});

/** The words of whatever was thrown, which is not always an `Error`. It never throws. */
export function reasonOf(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'something that is not an error was thrown';
}

const QUOTA_CODE = 22;

/**
 * Turns whatever the browser threw into a `StorageError`. What a failure means depends on when it happened: while the database
 * was being opened, anything that is not one of the named cases means that the browser does not let the site keep data, and
 * while it was in use, it means that something failed.
 */
export function classifyStorageError(error: unknown, phase: 'open' | 'use'): StorageError {
  const thing = typeof error === 'object' && error !== null ? error : {};
  const name = 'name' in thing ? thing.name : undefined;
  const code = 'code' in thing ? thing.code : undefined;
  const message = 'message' in thing && typeof thing.message === 'string' ? thing.message : undefined;

  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === QUOTA_CODE) {
    return {
      kind: 'quota-exceeded',
      message:
        'The browser has no room left to keep this canvas. Nothing was saved. Export a backup, delete canvases you no longer need, or free some space on the device, then try again.',
    };
  }
  if (name === 'BlockedError') {
    return {
      kind: 'blocked',
      message:
        'Another tab of this app still has the saved canvases open in an older version, so this tab cannot open them yet. Close the other tabs of the app, then try again.',
    };
  }
  if (name === 'VersionError') {
    return {
      kind: 'newer-database',
      message:
        'The canvases in this browser were saved by a newer version of this app than the one on this page. Reload the page to get the newest version. Nothing was changed.',
    };
  }
  if (phase === 'open') {
    return {
      kind: 'unavailable',
      message:
        'The browser does not let this site keep canvases here. That usually means a private window, or site data that is blocked in the browser’s settings. You can still build a canvas and save it as a file, but nothing will be kept automatically.',
    };
  }
  const detail =
    typeof error === 'string'
      ? error
      : typeof name === 'string' && message !== undefined
        ? `${name}: ${message}`
        : 'unknown';
  return {
    kind: 'failed',
    message: `The browser failed to read or save canvases (${detail}). Try again, and if it keeps happening, export a backup.`,
    detail,
  };
}
