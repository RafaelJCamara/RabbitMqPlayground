import type { HeaderValue } from '@rmq/engine';
import { formatFloat } from '../syntax/values';

/**
 * The small pieces of the sentences that explain a route (ADR-0060). A sentence says the cause first, in the words of a learner, and quotes what was compared:
 * a key, a pattern and a header value are quoted (JSON's string syntax, which says any text exactly), and the name of an exchange or a queue is written as it is on the canvas.
 */

/** The most that the short reason of a binding takes, in characters: it is written on the label of an edge (ADR-0062). */
export const SHORT_MOST = 48;

/** A text as it is quoted in a sentence. */
export const quoted = (text: string): string => JSON.stringify(text);

/** A key or a pattern in a sentence: quoted, and the empty one said in words, because two quotes are easy to miss. */
export const keyText = (text: string): string => (text === '' ? 'the empty key' : quoted(text));

/** A word of a key or a pattern: quoted, and an empty one said in words. */
export const wordText = (word: string): string => (word === '' ? 'an empty word' : quoted(word));

/** `a`, `a and b`, `a, b and c`: names in prose. */
export const listOf = (items: readonly string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** An exchange in a sentence: its name, or what the exchange with no name is called. */
export const exchangeText = (name: string): string => (name === '' ? 'the default exchange' : name);

/** A text cut to at most `most` characters, with an ellipsis where it was cut. Characters are counted as code points, so that a pair is never cut in half. */
export function shorten(text: string, most: number = SHORT_MOST): string {
  const characters = [...text];
  return characters.length <= most ? text : `${characters.slice(0, most - 1).join('')}…`;
}

/** A header value as it is written in a command, so that `1`, `"1"` and `1.0` are told apart: the three are three types. */
export function valueText(value: HeaderValue): string {
  switch (value.t) {
    case 'string':
      return quoted(value.v);
    case 'integer':
      return String(value.v);
    case 'float':
      return formatFloat(value.v);
    case 'boolean':
      return value.v ? 'true' : 'false';
  }
}

/** The type of a header value in a sentence, with its article: `a string`, `an integer`. */
export function typeText(type: HeaderValue['t']): string {
  return type === 'integer' ? 'an integer' : `a ${type}`;
}
