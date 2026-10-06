import type { Completion, CompletionItem } from '@rmq/domain';

/** The field after an item of a completion was taken: its text, and where the cursor is. */
export interface Taken {
  readonly text: string;
  readonly cursor: number;
}

/** What an item that ends like this goes on in the same word: `key=` wants its value, `exists(` the name of a header, `header:` the name of one. */
const GOES_ON = /[=(:]$/;

/**
 * Takes an item of a completion (ADR-0045): it goes where the word was, as the completer wrote it, quoted if it has to be. A space follows it, because what comes
 * next is another word, except for what goes on in the same word. A space that is already there is used and not doubled, and the cursor goes past it.
 */
export function take(text: string, completion: Completion, item: CompletionItem): Taken {
  const before = text.slice(0, completion.from);
  const after = text.slice(completion.to);
  if (GOES_ON.test(item.insert)) {
    return { text: before + item.insert + after, cursor: before.length + item.insert.length };
  }
  if (/^\s/.test(after)) {
    return { text: before + item.insert + after, cursor: before.length + item.insert.length + 1 };
  }
  return { text: `${before}${item.insert} ${after}`, cursor: before.length + item.insert.length + 1 };
}
