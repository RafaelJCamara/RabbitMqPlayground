import { cutName, SIZE_CAPS } from '@rmq/persistence';

/**
 * The names that the app gives to canvases and to files (ADR-0072, ADR-0075). They are only a help: two canvases may have the same name, and a
 * name is any text that is not blank, up to the cap of S3, so nothing here refuses; each of these finds a name that nobody has.
 */

/** The name of a canvas that the learner has not named. */
export const UNTITLED = 'Untitled canvas';

/** `base` if nobody has it, and else `base 2`, `base 3`, and so on, the first that nobody has. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? base : `${base} ${number}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
}

/** The name of a copy: `name (copy)`, and else `name (copy 2)` and so on, with the name cut so that the whole stays inside the cap, at a character. */
export function copyName(name: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? ' (copy)' : ` (copy ${number})`;
    const candidate = `${cutName(name, SIZE_CAPS.name - suffix.length)}${suffix}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
}

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
