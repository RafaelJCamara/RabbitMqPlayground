import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { localStorageOf } from '../core/browser-storage';

/**
 * The lines that the learner has given to the command bar (ADR-0045). They are a preference of the browser, as the theme is, and not part of any canvas,
 * so a share link or a file never carries what its author typed.
 */

export const HISTORY_STORAGE_KEY = 'rmq.command-history';

/** How many lines are kept. */
export const HISTORY_LIMIT = 100;

/** The lines with one more at the end: not an empty one, not the same as the last, and no more than the limit, the oldest going first. */
export function remember(lines: readonly string[], line: string): readonly string[] {
  const text = line.trim();
  if (text === '' || lines.at(-1) === text) {
    return lines;
  }
  return [...lines, text].slice(-HISTORY_LIMIT);
}

/** What the browser kept: the lines of a list of texts, the newest hundred. Anything else that is there is not a history, and nothing here may stop the app. */
export function readHistory(storage: Pick<Storage, 'getItem'> | null): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HISTORY_STORAGE_KEY) ?? 'null');
    return Array.isArray(parsed)
      ? parsed.filter((line): line is string => typeof line === 'string' && line !== '').slice(-HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Keeps the lines. A failure is not an error to show: the history of the page still holds until it is closed. */
export function writeHistory(storage: Pick<Storage, 'setItem'> | null, lines: readonly string[]): void {
  try {
    storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Nothing can be done: a full storage or a blocked one has no use for the learner knowing.
  }
}

/** The history of the command bar, oldest line first. */
@Injectable({ providedIn: 'root' })
export class CommandHistory {
  private readonly storage = localStorageOf(inject(DOCUMENT));
  private readonly list = signal(readHistory(this.storage));

  readonly lines = this.list.asReadonly();

  /** Keeps a line that was given, whether it worked or not, so that a typing mistake can be taken back and mended. */
  add(line: string): void {
    const next = remember(this.list(), line);
    if (next !== this.list()) {
      this.list.set(next);
      writeHistory(this.storage, next);
    }
  }
}
