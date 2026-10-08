import { describe, expect, it } from 'vitest';
import { canvasFromText, prefixedIds, sequentialIds } from './commands';
import { documentOf, exchangeRecord } from './documents';

/** The helper that a fixture says what canvas it is about with, in the words of the command bar. */

describe('canvasFromText', () => {
  const TEXT = `
    # A comment, and a blank line before and after it.

    declare exchange orders type=topic
    declare queue billing
    bind orders -> billing key=order.*
  `;

  it('makes the canvas that the commands make, one to a line, with the ids that count up from 1', () => {
    const document = canvasFromText(TEXT);

    expect(Object.keys(document.exchanges)).toEqual(['x1']);
    expect(Object.keys(document.queues)).toEqual(['q1']);
    expect(document.bindings['b1']).toMatchObject({ source: 'x1', dest: { kind: 'queue', id: 'q1' }, key: 'order.*' });
  });

  it('skips blank lines and lines that start with a hash, and does not mind indentation or Windows line endings', () => {
    const windows = TEXT.replaceAll('\n', '\r\n');

    expect(canvasFromText(windows)).toEqual(canvasFromText(TEXT));
    expect(canvasFromText('')).toEqual(canvasFromText('# nothing\n\n'));
  });

  it('starts from the canvas it is given, and from the ids it is given', () => {
    const from = documentOf({ exchanges: { E1: exchangeRecord('orders', 'topic') } });

    const document = canvasFromText('declare queue billing\nbind orders -> billing key=a', prefixedIds('t-'), from);

    expect(Object.keys(document.queues)).toEqual(['t-q1']);
    expect(Object.keys(document.exchanges)).toEqual(['E1']);
    expect(document.bindings['t-b1']).toBeDefined();
  });

  it('is the same canvas for the same text, with fresh ids each time', () => {
    expect(canvasFromText(TEXT, sequentialIds())).toEqual(canvasFromText(TEXT, sequentialIds()));
  });

  it('throws, saying which line and why, when a line is not read', () => {
    expect(() => canvasFromText('declare exchange a type=topic\nfrobnicate everything')).toThrow(
      /^Line 2 \(frobnicate everything\) was not read: /,
    );
  });

  it('throws, saying which line and why, when a command is refused', () => {
    expect(() => canvasFromText('declare queue a durable=false')).toThrow(
      /^Line 1 \(declare queue a durable=false\) was refused: /,
    );
  });

  it('throws when a line is a command that does not change the canvas', () => {
    expect(() => canvasFromText('declare queue a\npause')).toThrow(
      'Line 2 (pause) is not a command that changes the canvas',
    );
  });
});
