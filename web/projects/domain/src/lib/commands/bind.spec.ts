import { defaultExchangeReply, noExchangeReply, noQueueReply, topicWildcardsReply } from '@rmq/engine';
import {
  bool,
  deepFreeze,
  documentOf,
  entry,
  exchangeEnd,
  exchangeRecord,
  exists,
  headerArguments,
  int,
  queueEnd,
  queueRecord,
  sampleDocument,
  sequentialIds,
  str,
  undoRedoProblems,
  bindingRecord,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applyBind, applyUnbind } from './bind';
import type { BindCommand, UnbindCommand } from './types';

const bind = (
  source: string,
  destination: BindCommand['destination'],
  key = '',
  headers?: BindCommand['headers'],
): BindCommand => ({
  type: 'bind',
  source,
  destination,
  key,
  ...(headers ? { headers } : {}),
});
const unbind = (
  source: string,
  destination: UnbindCommand['destination'],
  key = '',
  headers?: UnbindCommand['headers'],
): UnbindCommand => ({
  type: 'unbind',
  source,
  destination,
  key,
  ...(headers ? { headers } : {}),
});

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
/** Two exchanges of every type that matters, and two queues, with no bindings. */
const bare = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: {
        D: exchangeRecord('direct', 'direct'),
        T: exchangeRecord('topic', 'topic'),
        F: exchangeRecord('fanout', 'fanout'),
        H: exchangeRecord('headers', 'headers'),
      },
      queues: { Q1: queueRecord('one'), Q2: queueRecord('two') },
    }),
  );

describe('bind', () => {
  describe('binds an exchange', () => {
    it('to a queue, with a key', () => {
      const result = applyBind(bare(), bind('direct', queueEnd('one'), 'k'), sequentialIds());

      expect(result.ok && result.value.bindings).toEqual({
        b1: { source: 'D', dest: { kind: 'queue', id: 'Q1' }, key: 'k' },
      });
      expect(result.ok && validateDocument(result.value)).toEqual([]);
    });

    it('to another exchange', () => {
      const result = applyBind(bare(), bind('fanout', exchangeEnd('topic')), sequentialIds());

      expect(result.ok && result.value.bindings['b1']).toEqual({
        source: 'F',
        dest: { kind: 'exchange', id: 'T' },
        key: '',
      });
    });

    it('to a queue that has the name of an exchange, when it says which it means', () => {
      const document = deepFreeze(
        documentOf({ exchanges: { E: exchangeRecord('both') }, queues: { Q: queueRecord('both') } }),
      );

      expect(applyBind(document, bind('both', queueEnd('both')), sequentialIds())).toMatchObject({
        ok: true,
        value: { bindings: { b1: { dest: { kind: 'queue', id: 'Q' } } } },
      });
      expect(applyBind(document, bind('both', exchangeEnd('both')), sequentialIds())).toMatchObject({
        ok: true,
        value: { bindings: { b1: { dest: { kind: 'exchange', id: 'E' } } } },
      });
    });

    it('with arguments, which it keeps as they are given, in every type of value', () => {
      const headers = headerArguments(
        'any-with-x',
        entry('s', str('1')),
        entry('i', int(1)),
        entry('b', bool(true)),
        entry('e', exists),
      );
      const result = applyBind(bare(), bind('headers', queueEnd('one'), '', headers), sequentialIds());

      expect(result.ok && result.value.bindings['b1']?.headers).toEqual(headers);
    });

    it('with no arguments at all when it is given an empty list and no x-match, which say nothing', () => {
      const result = applyBind(bare(), bind('headers', queueEnd('one'), '', headerArguments(null)), sequentialIds());

      expect(result.ok && 'headers' in (result.value.bindings['b1'] as object)).toBe(false);
    });

    it('with an x-match and no conditions, which is a binding that says something', () => {
      const result = applyBind(bare(), bind('headers', queueEnd('one'), '', headerArguments('any')), sequentialIds());

      expect(result.ok && result.value.bindings['b1']?.headers).toEqual({ xMatch: 'any', args: [] });
    });

    it('with a key on a fanout exchange and arguments on a direct one, which a broker takes and ignores', () => {
      const keyed = applyBind(bare(), bind('fanout', queueEnd('one'), 'ignored'), sequentialIds());
      const withHeaders = applyBind(
        bare(),
        bind('direct', queueEnd('one'), 'k', headerArguments('all', entry('a', int(1)))),
        sequentialIds(),
      );

      expect(keyed.ok && keyed.value.bindings['b1']?.key).toBe('ignored');
      expect(withHeaders.ok && withHeaders.value.bindings['b1']?.headers?.args).toHaveLength(1);
    });

    it('to itself, and round in a cycle, which a broker accepts (ADR-0008, rule 7)', () => {
      const first = applyBind(bare(), bind('fanout', exchangeEnd('fanout')), sequentialIds());
      const second = first.ok
        ? applyBind(first.value, bind('fanout', exchangeEnd('topic')), { newId: () => 'b2' })
        : first;
      const third = second.ok
        ? applyBind(second.value, bind('topic', exchangeEnd('fanout')), { newId: () => 'b3' })
        : second;

      expect(third.ok && Object.keys(third.value.bindings)).toEqual(['b1', 'b2', 'b3']);
      expect(third.ok && validateDocument(third.value)).toEqual([]);
    });

    it('as many times as the keys differ: a queue may be bound to the same exchange with several keys', () => {
      const first = applyBind(bare(), bind('direct', queueEnd('one'), 'a'), sequentialIds());
      const second = first.ok
        ? applyBind(first.value, bind('direct', queueEnd('one'), 'b'), { newId: () => 'b2' })
        : first;

      expect(second.ok && Object.values(second.value.bindings).map(({ key }) => key)).toEqual(['a', 'b']);
    });

    it('with a key of exactly 255 bytes', () => {
      expect(applyBind(bare(), bind('direct', queueEnd('one'), 'k'.repeat(255)), sequentialIds()).ok).toBe(true);
      expect(applyBind(bare(), bind('direct', queueEnd('one'), `${'é'.repeat(127)}a`), sequentialIds()).ok).toBe(true);
    });
  });

  describe('binds nothing twice: a broker keeps a binding once, so the document stays the same one', () => {
    it('for the same ends, key and arguments', () => {
      const before = sample();

      expect(applyBind(before, bind('orders', queueEnd('billing'), 'order.*'), sequentialIds())).toEqual({
        ok: true,
        value: before,
      });
      expect(
        (applyBind(before, bind('orders', queueEnd('billing'), 'order.*'), sequentialIds()) as { value: unknown })
          .value,
      ).toBe(before);
      expect(
        (applyBind(before, bind('orders', exchangeEnd('hidden'), '#'), sequentialIds()) as { value: unknown }).value,
      ).toBe(before);
    });

    it('for the same arguments written in another order, which a table does not have', () => {
      const one = headerArguments('all', entry('a', int(1)), entry('b', exists));
      const other = headerArguments('all', entry('b', exists), entry('a', int(1)));
      const before = deepFreeze(
        documentOf({
          exchanges: { H: exchangeRecord('headers', 'headers') },
          queues: { Q: queueRecord('q') },
          bindings: { B: bindingRecord('H', { kind: 'queue', id: 'Q' }, '', one) },
        }),
      );

      expect(
        (applyBind(before, bind('headers', queueEnd('q'), '', other), sequentialIds()) as { value: unknown }).value,
      ).toBe(before);
    });

    it('but not for another key, another mode, another value of another type, or another destination', () => {
      const before = sample();
      const differ = [
        bind('orders', queueEnd('billing'), 'order.#'),
        bind('orders', queueEnd('archive'), 'order.*'),
        bind('docs', queueEnd('archive'), '', headerArguments('all', entry('format', str('pdf')))),
        bind('docs', queueEnd('archive'), '', headerArguments('any', entry('format', str('PDF')))),
        bind('docs', queueEnd('archive'), '', headerArguments('any', entry('format', int(1)))),
        bind('docs', queueEnd('archive'), '', headerArguments('any')),
        bind('docs', queueEnd('archive')),
      ];

      for (const command of differ) {
        const result = applyBind(before, command, sequentialIds());

        expect(result.ok && result.value, JSON.stringify(command)).not.toBe(before);
        expect(result.ok && Object.keys(result.value.bindings), JSON.stringify(command)).toHaveLength(4);
      }
    });
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applyBind(before, bind('orders', queueEnd('archive'), 'late'), sequentialIds());

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && result.value.bindings['B1']).toBe(before.bindings['B1']);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  describe('refuses', () => {
    it('the default exchange as the source, with the 403 that the broker gave, and says why', () => {
      const result = applyBind(bare(), bind('', queueEnd('one'), 'k'), sequentialIds());

      expect(!result.ok && result.error).toMatchObject({ kind: 'default-exchange', refusal: defaultExchangeReply() });
      expect(!result.ok && result.error.message).toContain('nothing can be bound from it or to it');
    });

    it('the default exchange as the destination, but not a queue with no name, which is a different mistake', () => {
      expect(applyBind(bare(), bind('direct', exchangeEnd('')), sequentialIds())).toMatchObject({
        error: { kind: 'default-exchange', refusal: defaultExchangeReply() },
      });
      expect(applyBind(bare(), bind('direct', queueEnd('')), sequentialIds())).toMatchObject({
        error: { kind: 'missing-queue' },
      });
    });

    it('the default exchange at both ends, and before anything that is missing', () => {
      expect(applyBind(bare(), bind('', exchangeEnd('')), sequentialIds())).toMatchObject({
        error: { kind: 'default-exchange' },
      });
      expect(applyBind(bare(), bind('', queueEnd('nope')), sequentialIds())).toMatchObject({
        error: { kind: 'default-exchange' },
      });
      expect(applyBind(bare(), bind('nope', exchangeEnd('')), sequentialIds())).toMatchObject({
        error: { kind: 'default-exchange' },
      });
    });

    it('a source that is not there, with the 404 that the broker gave', () => {
      const result = applyBind(bare(), bind('nope', queueEnd('one'), 'k'), sequentialIds());

      expect(!result.ok && result.error.kind).toBe('missing-exchange');
      expect(!result.ok && result.error.refusal).toEqual(noExchangeReply('nope', '/'));
      expect(!result.ok && result.error.message).toBe("There is no exchange named 'nope'.");
    });

    it('a queue that is not there, and an exchange that is not there, with the 404 that the broker gave for each', () => {
      const queue = applyBind(bare(), bind('direct', queueEnd('nope')), sequentialIds());
      const exchange = applyBind(bare(), bind('direct', exchangeEnd('nope')), sequentialIds());

      expect(!queue.ok && queue.error).toMatchObject({ kind: 'missing-queue', refusal: noQueueReply('nope', '/') });
      expect(!exchange.ok && exchange.error).toMatchObject({
        kind: 'missing-exchange',
        refusal: noExchangeReply('nope', '/'),
      });
    });

    it('the source before the destination when both are missing, which is the order that a broker looks them up in', () => {
      const result = applyBind(bare(), bind('nope', queueEnd('also-nope')), sequentialIds());

      expect(!result.ok && result.error.refusal).toEqual(noExchangeReply('nope', '/'));
    });

    it('a name with amq. that is not there, as a broker does when the declaration of it was refused', () => {
      const result = applyBind(bare(), bind('amq.mine', queueEnd('one')), sequentialIds());

      expect(!result.ok && result.error.refusal).toEqual(noExchangeReply('amq.mine', '/'));
    });

    it('a built-in exchange, which the simulator does not have yet, and does not call a refusal of the broker’s', () => {
      for (const name of ['amq.direct', 'amq.fanout', 'amq.topic', 'amq.headers', 'amq.match']) {
        const result = applyBind(bare(), bind(name, queueEnd('one')), sequentialIds());

        expect(!result.ok && result.error.kind, name).toBe('built-in-exchange');
        expect(!result.ok && result.error.refusal, name).toBeUndefined();
        expect(!result.ok && result.error.message).toContain('The simulator does not have them yet');
      }
      expect(applyBind(bare(), bind('direct', exchangeEnd('amq.topic')), sequentialIds())).toMatchObject({
        error: { kind: 'built-in-exchange' },
      });
    });

    it('says when the name is that of something else, and what was probably meant', () => {
      const result = applyBind(sample(), bind('billing', queueEnd('archive')), sequentialIds());

      expect(!result.ok && result.error.message).toBe(
        "There is no exchange named 'billing'. There is a queue with that name.",
      );
      const typo = applyBind(sample(), bind('ordres', queueEnd('billing')), sequentialIds());

      expect(!typo.ok && typo.error.suggestions).toEqual(['orders']);
      expect(!typo.ok && typo.error.message).toBe("There is no exchange named 'ordres'. Did you mean 'orders'?");
      expect(!typo.ok && typo.error.refusal).toEqual(noExchangeReply('ordres', '/'));
    });

    it('names the vhost of the canvas in the broker’s reply', () => {
      const document = deepFreeze(documentOf({ vhost: 'prod', exchanges: { D: exchangeRecord('direct') } }));
      const result = applyBind(document, bind('direct', queueEnd('nope')), sequentialIds());

      expect(!result.ok && result.error.refusal).toEqual(noQueueReply('nope', 'prod'));
    });

    it('a key of more than 255 bytes, which no client library would send, before it looks at anything else', () => {
      const long = 'k'.repeat(256);

      expect(applyBind(bare(), bind('direct', queueEnd('one'), long), sequentialIds())).toMatchObject({
        error: { kind: 'routing-key' },
      });
      expect(applyBind(bare(), bind('', queueEnd('one'), long), sequentialIds())).toMatchObject({
        error: { kind: 'routing-key' },
      });
      expect(applyBind(bare(), bind('nope', queueEnd('nope'), long), sequentialIds())).toMatchObject({
        error: { kind: 'routing-key' },
      });
      expect(applyBind(bare(), bind('direct', queueEnd('one'), 'é'.repeat(128)), sequentialIds())).toMatchObject({
        error: { kind: 'routing-key', message: expect.stringContaining('this one is 256') },
      });
    });

    it('arguments that a broker would not take: an x-match among the conditions, a repeat, a value that cannot be exact', () => {
      const xMatch = applyBind(
        bare(),
        bind('headers', queueEnd('one'), '', headerArguments('all', entry('x-match', str('any')))),
        sequentialIds(),
      );
      const repeated = applyBind(
        bare(),
        bind('headers', queueEnd('one'), '', headerArguments('all', entry('a', exists), entry('a', exists))),
        sequentialIds(),
      );
      const unsafe = applyBind(
        bare(),
        bind('headers', queueEnd('one'), '', headerArguments('all', entry('n', int(2 ** 53)))),
        sequentialIds(),
      );

      expect(!xMatch.ok && xMatch.error.kind).toBe('header');
      expect(!xMatch.ok && xMatch.error.message).toContain("'x-match' is the mode of a headers binding");
      expect(!repeated.ok && repeated.error.message).toContain('is there twice');
      expect(!unsafe.ok && unsafe.error.message).toContain("The header 'n'");
    });
  });

  describe('refuses a topic key with more than two # words (ADR-0022)', () => {
    it.each(['#.#.#', 'a.#.b.#.c.#', '#.*.#.*.#'])('%j, with the 406 that the broker gave', (key) => {
      const result = applyBind(bare(), bind('topic', queueEnd('one'), key), sequentialIds());

      expect(!result.ok && result.error.kind).toBe('topic-wildcards');
      expect(!result.ok && result.error.refusal).toEqual(topicWildcardsReply(key, 3));
      expect(!result.ok && result.error.message).toContain('at most 2');
    });

    it('for a binding to an exchange too, which the broker refuses in the same words', () => {
      const result = applyBind(bare(), bind('topic', exchangeEnd('fanout'), '#.#.#'), sequentialIds());

      expect(!result.ok && result.error.refusal).toEqual(topicWildcardsReply('#.#.#', 3));
    });

    it('and takes two, and words that only look like #', () => {
      for (const key of ['#.#', 'a.#.b.#.c', '##.#.#', 'a#.#.#', '*.*.*.*']) {
        expect(applyBind(bare(), bind('topic', queueEnd('one'), key), sequentialIds()).ok, key).toBe(true);
      }
    });

    it('on a topic exchange only: any other exchange takes #.#.#, because it does not read the key as a pattern', () => {
      for (const source of ['direct', 'fanout', 'headers']) {
        expect(applyBind(bare(), bind(source, queueEnd('one'), '#.#.#'), sequentialIds()).ok, source).toBe(true);
      }
    });

    it('after the ends, which a broker looks up first: a key that is wrong for a queue that is not there is a 404', () => {
      expect(applyBind(bare(), bind('topic', queueEnd('nope'), '#.#.#'), sequentialIds())).toMatchObject({
        error: { kind: 'missing-queue' },
      });
      expect(applyBind(bare(), bind('nope', queueEnd('one'), '#.#.#'), sequentialIds())).toMatchObject({
        error: { kind: 'missing-exchange' },
      });
    });

    it('and a refusal changes nothing', () => {
      const before = bare();
      applyBind(before, bind('topic', queueEnd('one'), '#.#.#'), sequentialIds());

      expect(Object.keys(before.bindings)).toEqual([]);
    });
  });

  it('does not ask for an id for a binding that it refuses or that is already there', () => {
    const asked: string[] = [];
    const context = { newId: (kind: string) => (asked.push(kind), 'b9') };

    applyBind(sample(), bind('orders', queueEnd('billing'), 'order.*'), context);
    applyBind(sample(), bind('nope', queueEnd('billing')), context);

    expect(asked).toEqual([]);
    applyBind(sample(), bind('orders', queueEnd('archive'), 'late'), context);
    expect(asked).toEqual(['binding']);
  });
});

describe('unbind', () => {
  it('removes the binding that it is told to, and no other', () => {
    const before = sample();
    const result = applyUnbind(before, unbind('orders', queueEnd('billing'), 'order.*'));

    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['B2', 'B3']);
    expect(result.ok && result.value.bindings['B2']).toBe(before.bindings['B2']);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('removes a binding to an exchange, and a binding with arguments, found by its arguments in any order', () => {
    const before = sample();

    expect(applyUnbind(before, unbind('orders', exchangeEnd('hidden'), '#'))).toMatchObject({ ok: true });
    expect(
      applyUnbind(before, unbind('docs', queueEnd('archive'), '', headerArguments('any', entry('format', str('pdf'))))),
    ).toMatchObject({
      ok: true,
    });
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applyUnbind(
      before,
      unbind('docs', queueEnd('archive'), '', headerArguments('any', entry('format', str('pdf')))),
    );

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('takes the label of the edge with the last binding that it had, and keeps it while another is left', () => {
    const two = deepFreeze(
      documentOf({
        exchanges: { D: exchangeRecord('direct') },
        queues: { Q: queueRecord('q') },
        bindings: {
          B1: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'a'),
          B2: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'b'),
        },
        labels: { 'D>Q': { at: 0.3 } },
      }),
    );
    const one = applyUnbind(two, unbind('direct', queueEnd('q'), 'a'));
    const none = one.ok ? applyUnbind(one.value, unbind('direct', queueEnd('q'), 'b')) : one;

    expect(one.ok && one.value.layout.labels).toBe(two.layout.labels);
    expect(none.ok && none.value.layout.labels).toEqual({});
    expect(none.ok && validateDocument(none.value)).toEqual([]);
  });

  describe('refuses', () => {
    it('a binding that is not there, and lists the keys of the bindings that are between the two', () => {
      const none = applyUnbind(sample(), unbind('orders', queueEnd('archive'), 'x'));
      const wrongKey = applyUnbind(sample(), unbind('orders', queueEnd('billing'), 'order.#'));

      expect(!none.ok && none.error).toEqual({
        kind: 'not-bound',
        message: "There is no binding from exchange 'orders' to queue 'archive' with the key 'x'.",
      });
      expect(!wrongKey.ok && wrongKey.error.message).toBe(
        "There is no binding from exchange 'orders' to queue 'billing' with the key 'order.#'. The bindings between them have the key 'order.*'.",
      );
    });

    it('lists several keys, and says when it was the arguments that differed', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { D: exchangeRecord('direct') },
          queues: { Q: queueRecord('q') },
          bindings: {
            B1: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'a'),
            B2: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'b'),
          },
        }),
      );
      const result = applyUnbind(
        document,
        unbind('direct', queueEnd('q'), 'a', headerArguments('all', entry('n', int(1)))),
      );

      expect(!result.ok && result.error.message).toBe(
        "There is no binding from exchange 'direct' to queue 'q' with the key 'a' and those arguments. The bindings between them have the keys 'a', 'b'.",
      );
    });

    it('the default exchange, a source or a destination that is not there, and a key that cannot exist, as bind does', () => {
      expect(applyUnbind(sample(), unbind('', queueEnd('billing')))).toMatchObject({
        error: { kind: 'default-exchange' },
      });
      expect(applyUnbind(sample(), unbind('orders', exchangeEnd('')))).toMatchObject({
        error: { kind: 'default-exchange' },
      });
      expect(applyUnbind(sample(), unbind('nope', queueEnd('billing')))).toMatchObject({
        error: { kind: 'missing-exchange', refusal: noExchangeReply('nope', '/') },
      });
      expect(applyUnbind(sample(), unbind('orders', queueEnd('nope')))).toMatchObject({
        error: { kind: 'missing-queue', refusal: noQueueReply('nope', '/') },
      });
      expect(applyUnbind(sample(), unbind('orders', queueEnd('billing'), 'k'.repeat(256)))).toMatchObject({
        error: { kind: 'routing-key' },
      });
      expect(applyUnbind(sample(), unbind('amq.topic', queueEnd('billing')))).toMatchObject({
        error: { kind: 'built-in-exchange' },
      });
    });

    it('arguments that no binding could have, and a topic key that no binding could have, as a binding that is not there', () => {
      expect(
        applyUnbind(
          sample(),
          unbind('docs', queueEnd('archive'), '', headerArguments('all', entry('x-match', str('a')))),
        ),
      ).toMatchObject({
        error: { kind: 'header' },
      });
      expect(applyUnbind(sample(), unbind('orders', queueEnd('billing'), '#.#.#'))).toMatchObject({
        error: { kind: 'not-bound' },
      });
    });
  });
});
