import {
  matchHeaders,
  type ConditionResult,
  type HeaderArguments,
  type HeaderEntry,
  type HeaderValue,
} from '@rmq/engine';
import { BINDING_OPTION_NAMES } from '../syntax/specs/bind';
import { formatCondition, formatValue } from '../syntax/values';
import { wordText } from '../syntax/words';
import { describeHeaders, headersWords } from './headers-words';

/**
 * The live table of a headers binding (ADR-0070): recent messages against each of its conditions. It is a rendering of what the engine's matcher says and of the sentences of `headers-words.ts`, with no matcher of its
 * own, so that a cell says what the message inspector says of the same message, and the verdict of a row is the verdict that `explainRoute` gives that binding. The messages are the caller's: which ones are recent
 * is not a question of the domain.
 */

/** A message as the table reads it: its number, and the headers that it carries. */
export interface TableMessage {
  readonly id: number;
  readonly headers: readonly HeaderEntry<HeaderValue>[];
}

/** A condition of the binding, as a column. */
export interface TableColumn {
  readonly key: string;
  /** As the grammar and the chip write it: `n=1`, `s="1"`, `exists(f)`. */
  readonly text: string;
}

/** What a cell says in a word, so that the verdict is not told by a colour or an icon alone. */
export type CellWord = 'holds' | 'missing' | 'differs' | 'type differs' | 'not counted';

export interface TableCell {
  readonly outcome: 'pass' | 'fail' | 'ignored';
  readonly word: CellWord;
  /** The sentence of the explanation for this condition and this message. */
  readonly text: string;
}

export interface TableRow {
  readonly message: number;
  /** The headers of the message as the grammar writes them: `format=pdf n=1`. */
  readonly headers: string;
  /** One for each column. */
  readonly cells: readonly TableCell[];
  readonly matched: boolean;
  readonly result: 'Matches' | 'Does not match';
  /** The sentence of the explanation for the binding as a whole. */
  readonly text: string;
}

export interface HeadersTable {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  /** What the binding asks, in a sentence. */
  readonly sentence: string;
}

function wordOf({ outcome, reason }: ConditionResult): CellWord {
  if (outcome === 'pass') {
    return 'holds';
  }
  if (outcome === 'ignored') {
    return 'not counted';
  }
  return reason === 'missing' ? 'missing' : reason === 'type-differs' ? 'type differs' : 'differs';
}

/** The headers of a message as a line: `format=pdf n=1 s="1"`. */
export const headersLine = (headers: readonly HeaderEntry<HeaderValue>[]): string =>
  headers.map(({ key, value }) => `${wordText(key)}=${formatValue(value)}`).join(' ');

/** The table of these arguments against these messages, in the order the messages are given. */
export function headersTable(headers: HeaderArguments | undefined, messages: readonly TableMessage[]): HeadersTable {
  return {
    columns: (headers?.args ?? []).map(({ key, value }) => ({
      key,
      text: formatCondition(key, value, BINDING_OPTION_NAMES),
    })),
    rows: messages.map(({ id, headers: carried }): TableRow => {
      const result = matchHeaders(headers, carried);
      const words = headersWords(result);
      return {
        message: id,
        headers: headersLine(carried),
        cells: result.conditions.map((condition, index): TableCell => ({
          outcome: condition.outcome,
          word: wordOf(condition),
          text: (words.conditions[index] as (typeof words.conditions)[number]).text,
        })),
        matched: result.matched,
        result: result.matched ? 'Matches' : 'Does not match',
        text: words.text,
      };
    }),
    sentence: describeHeaders(headers),
  };
}
