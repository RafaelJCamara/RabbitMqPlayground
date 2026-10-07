import {
  bindingRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  int,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { HeaderArguments } from '@rmq/engine';
import type { CanvasDocument } from './document/schema';
import { headersLint, lint } from './lints';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());

/** A headers exchange bound to a queue with these arguments, and nothing else. */
const bound = (headers: HeaderArguments | undefined, exchangeType: 'headers' | 'direct' = 'headers'): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { H: exchangeRecord('docs', exchangeType) },
      queues: { Q: queueRecord('archive') },
      bindings: { B: bindingRecord('H', { kind: 'queue', id: 'Q' }, '', headers) },
    }),
  );
const anyLints = (headers: HeaderArguments | undefined, exchangeType: 'headers' | 'direct' = 'headers') =>
  lint(bound(headers, exchangeType)).filter(({ kind }) => kind === 'any-without-conditions');

describe('lint', () => {
  it('has nothing to say about a canvas with nothing on it', () => {
    expect(lint(deepFreeze(documentOf()))).toEqual([]);
  });

  describe('an exchange without bindings', () => {
    it('is an exchange that nothing is bound from, and says what that means', () => {
      const lints = lint(sample());

      expect(lints).toEqual([
        {
          kind: 'exchange-without-bindings',
          severity: 'warning',
          message:
            "Nothing is bound from the exchange 'hidden', so every message that reaches it goes nowhere. Bind it to a queue or to another exchange.",
          subject: { kind: 'exchange', id: 'E3' },
        },
      ]);
    });

    it('is not an exchange with a binding from it, even one to another exchange', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { A: exchangeRecord('a'), B: exchangeRecord('b') },
          queues: { Q: queueRecord('q') },
          bindings: {
            B1: bindingRecord('A', { kind: 'exchange', id: 'B' }),
            B2: bindingRecord('B', { kind: 'queue', id: 'Q' }),
          },
        }),
      );

      expect(lint(document)).toEqual([]);
    });

    it('is an exchange that nothing is bound to either, which is as good as no exchange', () => {
      const document = deepFreeze(documentOf({ exchanges: { A: exchangeRecord('a') } }));

      expect(lint(document).map(({ subject }) => subject)).toEqual([{ kind: 'exchange', id: 'A' }]);
    });

    it('is an exchange bound to itself and nothing else, which routes only to itself', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { A: exchangeRecord('a') },
          bindings: { B: bindingRecord('A', { kind: 'exchange', id: 'A' }) },
        }),
      );

      expect(lint(document)).toEqual([]);
    });

    it('is found for each such exchange, in the order they were made, and is never a queue or a producer', () => {
      const document = deepFreeze(
        documentOf({ exchanges: { Z: exchangeRecord('z'), A: exchangeRecord('a') }, queues: { Q: queueRecord('q') } }),
      );

      expect(lint(document).map(({ subject }) => subject.id)).toEqual(['Z', 'A']);
    });
  });

  describe('x-match=any with no conditions', () => {
    it('is a binding that has the mode any and no conditions, and says that it matches no message', () => {
      const [found] = anyLints(headerArguments('any'));

      expect(found).toEqual({
        kind: 'any-without-conditions',
        severity: 'warning',
        message:
          "The binding from 'docs' to 'archive' has x-match=any and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.",
        subject: { kind: 'binding', id: 'B' },
      });
    });

    it('is also any-with-x, which counts every condition, so only one with none is found', () => {
      expect(anyLints(headerArguments('any-with-x'))).toHaveLength(1);
      expect(anyLints(headerArguments('any-with-x'))[0]?.message).toContain('x-match=any-with-x');
      expect(anyLints(headerArguments('any-with-x', entry('x-c', int(1))))).toEqual([]);
    });

    it('is a binding whose only conditions begin with x-, which any does not count', () => {
      expect(anyLints(headerArguments('any', entry('x-a', int(1)), entry('x-b', str('2'))))).toHaveLength(1);
    });

    it('is not a binding that has a condition that counts', () => {
      expect(anyLints(headerArguments('any', entry('format', str('pdf'))))).toEqual([]);
      expect(anyLints(headerArguments('any', entry('x-a', int(1)), entry('format', str('pdf'))))).toEqual([]);
    });

    it('is not a binding with the mode all, which matches every message when it has no conditions, or one with no mode', () => {
      expect(anyLints(headerArguments('all'))).toEqual([]);
      expect(anyLints(headerArguments('all-with-x'))).toEqual([]);
      expect(anyLints(headerArguments(null))).toEqual([]);
      expect(anyLints(undefined)).toEqual([]);
    });

    it('is not a binding on an exchange that is not a headers exchange, which does not read the arguments', () => {
      expect(anyLints(headerArguments('any'), 'direct')).toEqual([]);
    });

    it('names the destination, an exchange as well as a queue, and its id when the destination is not there', () => {
      const toExchange = deepFreeze(
        documentOf({
          exchanges: { H: exchangeRecord('docs', 'headers'), G: exchangeRecord('next') },
          bindings: { B: bindingRecord('H', { kind: 'exchange', id: 'G' }, '', headerArguments('any')) },
        }),
      );
      const dangling = deepFreeze(
        documentOf({
          exchanges: { H: exchangeRecord('docs', 'headers') },
          bindings: { B: bindingRecord('H', { kind: 'queue', id: 'gone' }, '', headerArguments('any')) },
        }),
      );

      expect(lint(toExchange).find(({ kind }) => kind === 'any-without-conditions')?.message).toContain("to 'next'");
      expect(lint(dangling).find(({ kind }) => kind === 'any-without-conditions')?.message).toContain("to 'gone'");
    });
  });

  it('lists the exchanges first, in the order they were made, and then the bindings', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { H: exchangeRecord('docs', 'headers'), E: exchangeRecord('lonely') },
        queues: { Q: queueRecord('q') },
        bindings: { B: bindingRecord('H', { kind: 'queue', id: 'Q' }, '', headerArguments('any')) },
      }),
    );

    expect(lint(document).map(({ kind, subject }) => `${kind} ${subject.id}`)).toEqual([
      'exchange-without-bindings E',
      'any-without-conditions B',
    ]);
  });

  it('only warns, and does not change the document, and gives the same warnings every time', () => {
    const document = sample();

    expect(lint(document)).toEqual(lint(document));
    expect(lint(document).every(({ severity }) => severity === 'warning')).toBe(true);
    expect(document).toEqual(sampleDocument());
  });
});

describe('headersLint, which words the lint for the editor and for lint() (ADR-0068)', () => {
  it('says it of a binding with x-match=any, or any-with-x, and no condition that counts, and names the two ends', () => {
    expect(headersLint('docs', 'archive', headerArguments('any'))).toBe(
      "The binding from 'docs' to 'archive' has x-match=any and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.",
    );
    expect(headersLint('a', 'b', headerArguments('any-with-x'))).toContain('x-match=any-with-x');
    expect(headersLint('a', 'b', headerArguments('any', entry('x-a', int(1))))).not.toBeNull();
  });

  it('has nothing to say when a condition counts, when the mode is all or left out, or when there are no arguments', () => {
    expect(headersLint('a', 'b', headerArguments('any', entry('f', int(1))))).toBeNull();
    expect(headersLint('a', 'b', headerArguments('any-with-x', entry('x-a', int(1))))).toBeNull();
    expect(headersLint('a', 'b', headerArguments('all'))).toBeNull();
    expect(headersLint('a', 'b', headerArguments('all-with-x'))).toBeNull();
    expect(headersLint('a', 'b', headerArguments(null))).toBeNull();
    expect(headersLint('a', 'b', undefined)).toBeNull();
  });

  it('is the sentence that lint() gives for a binding that is on the canvas', () => {
    const [found] = anyLints(headerArguments('any'));

    expect(found?.message).toBe(headersLint('docs', 'archive', headerArguments('any')));
  });
});
