import { readFileSync } from 'node:fs';
import { encodeShare, type Shared } from '@rmq/persistence';

/**
 * Links for the tests of sharing (ADR-0078): the part after `#c=` for a canvas that a test made, and the links that the repository keeps as golden (ADR-0077), which were made once and are only ever read,
 * so that a change of the format, of the compressor of the browser or of the reader fails here with a link that someone has already been sent.
 */

/** The payload of a link to a canvas, as the app makes it. A canvas that cannot be a link throws, saying why. */
export async function payloadFor(shared: Shared): Promise<string> {
  const made = await encodeShare(shared);
  if (!made.ok) {
    throw new Error(made.error.message);
  }
  return made.value;
}

const FIXTURES = new URL('../../fixtures/', import.meta.url);

/** What a file of the repository's fixtures says, without the line end at its end. */
export const fixture = (path: string): string => readFileSync(new URL(path, FIXTURES), 'utf8').replace(/\r?\n$/, '');

/** The golden links of format 1, by name, with what each must open as. */
export const GOLDEN_LINKS = ['empty', 'sample', 'sample-with-messages', 'typed-headers', 'unicode'] as const;

export interface GoldenLink {
  readonly payload: string;
  readonly expected: { readonly name: string; readonly document: Record<string, Record<string, unknown>> };
}

export function goldenLink(name: (typeof GOLDEN_LINKS)[number]): GoldenLink {
  return {
    payload: fixture(`share/v1/${name}.link`),
    expected: JSON.parse(fixture(`share/v1/${name}.expected.json`)) as GoldenLink['expected'],
  };
}
