import type { Completion, CompletionItem } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import { take } from './completion';

const item = (insert: string, kind: CompletionItem['kind'] = 'name'): CompletionItem => ({
  insert,
  label: insert,
  kind,
});
const at = (from: number, to: number, ...items: CompletionItem[]): Completion => ({ from, to, items });

describe('take (ADR-0045)', () => {
  it('puts the item where the word was, with a space after a name, and the cursor after the space', () => {
    expect(take('bind or', at(5, 7), item('orders'))).toEqual({ text: 'bind orders ', cursor: 12 });
  });

  it('puts the item at the cursor when there is no word yet', () => {
    expect(take('bind ', at(5, 5), item('orders'))).toEqual({ text: 'bind orders ', cursor: 12 });
    expect(take('', at(0, 0), item('bind', 'command'))).toEqual({ text: 'bind ', cursor: 5 });
  });

  it('writes no space after what goes on in the same word: key=, exists( and header:', () => {
    expect(take('bind a -> b ke', at(12, 14), item('key=', 'option'))).toEqual({
      text: 'bind a -> b key=',
      cursor: 16,
    });
    expect(take('bind a -> b ex', at(12, 14), item('exists(', 'keyword'))).toEqual({
      text: 'bind a -> b exists(',
      cursor: 19,
    });
    expect(take('set sender he', at(11, 13), item('header:', 'keyword'))).toEqual({
      text: 'set sender header:',
      cursor: 18,
    });
  });

  it('writes a space after a value, because the next thing is another word', () => {
    expect(take('set x type=to', at(6, 13), item('type=topic', 'value'))).toEqual({
      text: 'set x type=topic ',
      cursor: 17,
    });
  });

  it('uses the space that is already after the word when it is taken in the middle of a line, and goes past it', () => {
    expect(take('bind or -> billing', at(5, 7), item('orders'))).toEqual({
      text: 'bind orders -> billing',
      cursor: 12,
    });
  });

  it('leaves the rest of the line as it was, and puts the cursor where the item ends when what follows goes on in the same word', () => {
    expect(take('set x ke1', at(6, 8), item('key=', 'option'))).toEqual({ text: 'set x key=1', cursor: 10 });
  });

  it('writes the item as the completer says, quoted if it has to be', () => {
    expect(take('bind my', at(5, 7), item('"my orders"'))).toEqual({ text: 'bind "my orders" ', cursor: 17 });
  });
});
