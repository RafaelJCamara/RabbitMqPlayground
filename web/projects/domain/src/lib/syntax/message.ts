import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import { fail, ok, type Result } from '../document/issue';
import { emptyDocument } from '../document/schema';
import { Cursor, Stop } from './cursor';
import { MESSAGE_OPTIONS } from './specs/runtime';
import { isAtom, tokenize, type Atom } from './tokenizer';

/** A message as it is written after the exchange in `publish` (ADR-0054): the routing key, the payload and the headers, which have their types (ADR-0009). */
export interface MessageText {
  readonly key: string;
  readonly payload: string;
  readonly headers: readonly HeaderEntry<HeaderValue>[];
}

/**
 * Reads what follows the exchange in a `publish`: `key=order.created payload=hello header:format=pdf header:n=1`. It is the reader of the command's own tail, with the same inference of types (`1`
 * is an integer, `"1"` a string, `1.0` a float) and the same refusals, with what was probably meant, so that the what-if tester (ADR-0064) and the command say one thing. Nothing is looked up on the
 * canvas, so it reads a message for any exchange, the default exchange included. Without a key or a payload they are empty, as they are for a message that is published with none.
 */
export function parseMessageText(text: string): Result<MessageText> {
  const tokenized = tokenize(text);
  if (!tokenized.ok) {
    return fail(tokenized.error);
  }
  const atoms: Atom[] = [];
  for (const token of tokenized.tokens) {
    if (!isAtom(token)) {
      return fail({
        kind: 'syntax',
        message: "A message is one line, so leave out the ';'.",
        at: { start: token.start, end: token.end },
      });
    }
    atoms.push(token);
  }
  try {
    const { options, headers } = new Cursor(atoms, emptyDocument()).options({
      options: MESSAGE_OPTIONS,
      messageHeaders: true,
    });
    return ok({
      key: (options['key'] as string | undefined) ?? '',
      payload: (options['payload'] as string | undefined) ?? '',
      headers,
    });
  } catch (error) {
    if (error instanceof Stop) {
      return fail(error.issue);
    }
    throw error;
  }
}
