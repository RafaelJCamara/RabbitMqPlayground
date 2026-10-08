/**
 * The names that the app gives to the files that it makes (ADR-0075, ADR-0079). They are only a help: a name is any text, and what a file is called says nothing that the file does not. Each is made of the name of the canvas,
 * so that the file of a canvas is found by what it is called.
 */

/** The most that the name of a file says of the name of a canvas. */
const FILE_NAME_LENGTH = 60;

/** What is left of a name when it is made fit to be a file: its letters and digits, in lower case, with a hyphen between the runs of the rest, or `canvas` if nothing is left. */
export function slug(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const cut = Array.from(words).slice(0, FILE_NAME_LENGTH).join('').replace(/-+$/, '');
  return cut === '' ? 'canvas' : cut;
}

/** The extension of the file of one canvas. It ends in `.json`, so that a file picker offers it. */
export const CANVAS_FILE_EXTENSION = '.rmq.json';

/** The name of the file that a canvas is saved as: `orders-flow.rmq.json`. */
export const canvasFileName = (name: string): string => `${slug(name)}${CANVAS_FILE_EXTENSION}`;

const two = (number: number): string => String(number).padStart(2, '0');

/** The name of the file of a backup: `rmq-playground-backup-2026-10-08.json`, with the date of the learner's own day. */
export function backupFileName(time: number): string {
  const day = new Date(time);
  return `rmq-playground-backup-${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}.json`;
}

/** The extension of a definitions file, which a broker imports (ADR-0079). It ends in `.json`, so that a file picker offers it. */
export const DEFINITIONS_FILE_EXTENSION = '.definitions.json';

/** The name of the file that a canvas is exported as: `orders-flow.definitions.json`. */
export const definitionsFileName = (name: string): string => `${slug(name)}${DEFINITIONS_FILE_EXTENSION}`;
