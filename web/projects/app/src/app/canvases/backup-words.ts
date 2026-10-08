import type { RestoreReport } from '@rmq/persistence';

/**
 * What the app says of a backup that it made and of one that it put back (ADR-0075): plain sentences, the root cause first, made from numbers, so that a spec can read each
 * of them. Nothing here touches the screen.
 */

const canvases = (count: number): string => `${count} ${count === 1 ? 'canvas' : 'canvases'}`;

/** What a backup came to. */
export interface BackupDone {
  /** The name of the file that was saved. */
  readonly file: string;
  /** How many canvases are in it. */
  readonly count: number;
  /** How many canvases could not be read, and so are not in it (ADR-0073). */
  readonly left: number;
}

/** "Backed up 5 canvases to rmq-playground-backup-2026-10-08.json. 2 could not be opened and are not in the file. Keep the file somewhere other than this device too: …". */
export function backupDone({ file, count, left }: BackupDone): string {
  return [
    `Backed up ${canvases(count)} to ${file}.`,
    ...(left > 0 ? [`${canvases(left)} could not be opened and ${left === 1 ? 'is' : 'are'} not in the file.`] : []),
    'Keep the file somewhere other than this device too: a backup beside the canvases is lost with them.',
  ].join(' ');
}

/** How many problems the report lists; the rest are counted. */
export const PROBLEMS_SHOWN = 20;

/** How many names of copies the summary says. */
const COPIES_NAMED = 5;

export interface RestoreView {
  /** What was done, a sentence for each thing that happened, in the order of the report. */
  readonly summary: readonly string[];
  /** What went wrong, a line for each, at most `PROBLEMS_SHOWN` of them. */
  readonly problems: readonly string[];
  /** How many more problems there were than are listed. */
  readonly more: number;
}

/** The report of a restore as it is shown: what was put back, what was left, what was copied, and what could not be read or written. */
export function restoreView(report: RestoreReport): RestoreView {
  const { restored, alreadyHere, copies, unreadable, failed, outOfRoom } = report;
  const summary: string[] = [];
  if (restored.length > 0) {
    summary.push(`Put back ${canvases(restored.length)}.`);
  }
  if (alreadyHere.length > 0) {
    summary.push(
      alreadyHere.length === 1
        ? '1 canvas was already here, and was left as it is.'
        : `${alreadyHere.length} canvases were already here, and were left as they are.`,
    );
  }
  if (copies.length > 0) {
    const named = copies.slice(0, COPIES_NAMED).map(({ name }) => `“${name}”`);
    const rest = copies.length - named.length;
    const list = `${named.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
    summary.push(
      copies.length === 1
        ? `1 canvas has the id of a canvas that is here and is different, so it was added as a new canvas: ${list}.`
        : `${copies.length} canvases have the ids of canvases that are here and are different, so they were added as new canvases: ${list}.`,
    );
  }
  if (outOfRoom !== undefined) {
    summary.push(
      `The browser ran out of room, so ${canvases(outOfRoom.notPutBack)} ${outOfRoom.notPutBack === 1 ? 'was' : 'were'} not put back. ${outOfRoom.message}`,
    );
  }
  if (summary.length === 0 && unreadable.length === 0 && failed.length === 0) {
    summary.push('The backup holds no canvases.');
  }

  const problems = [
    ...unreadable.map(
      ({ position, name, message }) =>
        `Canvas ${position}${name === undefined ? '' : ` “${name}”`} could not be read. ${message}`,
    ),
    ...failed.map(({ name, message }) => `“${name}” could not be put back. ${message}`),
  ];
  return { summary, problems: problems.slice(0, PROBLEMS_SHOWN), more: Math.max(0, problems.length - PROBLEMS_SHOWN) };
}
