import { dateWords } from './ago';
import type { CanvasSummary } from './summary';

/**
 * When to remind the learner to make a backup (ADR-0075). The reminder is on the home and nowhere else, and it is a pure function of the clock and a few numbers, so that its
 * edges are cases of a table and not behaviour that has to be waited for.
 */

const DAY = 24 * 60 * 60 * 1000;

/** A backup is asked for after this long without one (or, if there has never been one, since the oldest canvas was made). */
export const REMIND_AFTER_MS = 14 * DAY;

/** "Remind me in a week". */
export const SNOOZE_MS = 7 * DAY;

export interface ReminderFacts {
  /** The time now, in milliseconds. */
  readonly now: number;
  readonly canvases: readonly CanvasSummary[];
  /** When the learner last made a backup, if they ever did. */
  readonly lastBackupAt: number | undefined;
  /** The reminder stays quiet until this time. */
  readonly snoozedUntil: number | undefined;
}

export type Reminder = { readonly due: false } | { readonly due: true; readonly text: string };

const NOT_DUE: Reminder = { due: false };

/**
 * Whether to remind, and in what words. It is due when there is a canvas, the reminder is not snoozed, at least 14 days have passed since the last backup, and something has
 * changed since: some canvas was edited after it. If there has never been a backup, the 14 days are counted from the oldest canvas that has an element on it, because a canvas
 * with nothing on it has nothing to lose, and a learner who made an empty one a month ago and started to build today is not told today that they have never backed up. A
 * learner who has only empty canvases, or who has changed nothing since a backup, is not asked.
 */
export function backupReminder({ now, canvases, lastBackupAt, snoozedUntil }: ReminderFacts): Reminder {
  if (canvases.length === 0 || (snoozedUntil !== undefined && snoozedUntil > now)) {
    return NOT_DUE;
  }
  if (lastBackupAt === undefined) {
    const worked = canvases.filter(({ elements }) => elements > 0);
    if (worked.length === 0 || now - Math.min(...worked.map(({ createdAt }) => createdAt)) < REMIND_AFTER_MS) {
      return NOT_DUE;
    }
  } else if (now - lastBackupAt < REMIND_AFTER_MS || !canvases.some(({ updatedAt }) => updatedAt > lastBackupAt)) {
    return NOT_DUE;
  }
  const opening =
    lastBackupAt === undefined
      ? 'You have never backed up your canvases.'
      : `You have not backed up your canvases since ${dateWords(lastBackupAt)}.`;
  return {
    due: true,
    text: `${opening} This browser keeps them on this device only, and they can be lost if the browser is cleared or the device is replaced.`,
  };
}
