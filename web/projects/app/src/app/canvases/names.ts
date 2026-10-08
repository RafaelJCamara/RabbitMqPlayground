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

/**
 * Why this cannot be the name of a canvas, in words, or `null` if it can (ADR-0028): it needs something in it that is not white space, and it is at most
 * 200 characters. The root cause comes first, and then what to do.
 */
export function nameProblem(name: string): string | null {
  if (!/\S/.test(name)) {
    return 'A canvas needs a name, and this one is blank. Type a name.';
  }
  return name.length > SIZE_CAPS.name
    ? `The name has ${name.length} characters, and a name can have at most ${SIZE_CAPS.name}. Shorten the name.`
    : null;
}
