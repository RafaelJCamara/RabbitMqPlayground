import type { HeaderEntry, HeaderValue } from '@rmq/engine';

/** A header as it is shown: its name, the name of its type, and its value as a command would write it. */
export interface HeaderRow {
  readonly name: string;
  readonly type: string;
  readonly value: string;
}

/** A header value as it is written: a string in quotes, a float with its point, so that `1` and `1.0` are not mistaken, a boolean as a word. */
export function headerRow({ key, value }: HeaderEntry<HeaderValue>): HeaderRow {
  switch (value.t) {
    case 'string':
      return { name: key, type: 'string', value: JSON.stringify(value.v) };
    case 'integer':
      return { name: key, type: 'integer', value: String(value.v) };
    case 'float':
      return { name: key, type: 'float', value: Number.isInteger(value.v) ? value.v.toFixed(1) : String(value.v) };
    case 'boolean':
      return { name: key, type: 'boolean', value: String(value.v) };
  }
}
