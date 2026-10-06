import { topicWildcardsReply, transientQueueReply } from '@rmq/engine';
import {
  bindingRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  float,
  int,
  producerRecord,
  queueRecord,
  sampleDocument,
  str,
  undoRedoProblems,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { LIMITS, type CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applySet, applyUnset } from './set';
import type { ConsumerChanges, SetCommand, Unset } from './types';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
/** `Omit` of each member of a union, which `Omit` of the union is not. */
type WithoutType<T> = T extends unknown ? Omit<T, 'type'> : never;
const set = (command: WithoutType<SetCommand>): SetCommand => ({ type: 'set', ...command }) as SetCommand;
const unset = (name: string, ...headers: string[]): Unset => ({ type: 'unset', kind: 'producer', name, headers });

describe('set exchange', () => {
  it('sets the type and each flag, whichever are named', () => {
    const type = applySet(sample(), set({ kind: 'exchange', name: 'docs', changes: { exchangeType: 'direct' } }));
    const flags = applySet(
      sample(),
      set({ kind: 'exchange', name: 'docs', changes: { durable: false, autoDelete: true, internal: true } }),
    );

    expect(type.ok && type.value.exchanges['E2']).toEqual({
      name: 'docs',
      type: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    });
    expect(flags.ok && flags.value.exchanges['E2']).toEqual({
      name: 'docs',
      type: 'headers',
      durable: false,
      autoDelete: true,
      internal: true,
    });
    expect(type.ok && validateDocument(type.value)).toEqual([]);
  });

  it('keeps what it did not touch, can be undone and redone, and shares the other exchanges', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'exchange', name: 'docs', changes: { autoDelete: true } }));

    expect(result.ok && result.value.exchanges['E1']).toBe(before.exchanges['E1']);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when every value is the one it has, and returns the same document', () => {
    const before = sample();
    const result = applySet(
      before,
      set({ kind: 'exchange', name: 'docs', changes: { exchangeType: 'headers', durable: true } }),
    );

    expect(result.ok && result.value).toBe(before);
  });

  describe('refuses', () => {
    it('becoming a topic exchange while a binding of it has a key that a topic exchange would refuse (ADR-0022)', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { D: exchangeRecord('d', 'direct'), O: exchangeRecord('other', 'direct') },
          queues: { Q: queueRecord('q') },
          bindings: {
            B1: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'fine'),
            B2: bindingRecord('D', { kind: 'queue', id: 'Q' }, '#.#.#'),
            B3: bindingRecord('O', { kind: 'queue', id: 'Q' }, '#.#.#.#'),
          },
        }),
      );
      const result = applySet(document, set({ kind: 'exchange', name: 'd', changes: { exchangeType: 'topic' } }));

      expect(!result.ok && result.error.kind).toBe('topic-wildcards');
      expect(!result.ok && result.error.refusal).toEqual(topicWildcardsReply('#.#.#', 3));
      expect(!result.ok && result.error.message).toContain('Change that binding first');
    });

    it('but allows it when the bindings are fine, when the key is on another exchange, and when it already is a topic exchange', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { D: exchangeRecord('d', 'direct'), O: exchangeRecord('other', 'direct') },
          queues: { Q: queueRecord('q') },
          bindings: {
            B1: bindingRecord('D', { kind: 'queue', id: 'Q' }, 'a.#.b.#'),
            B3: bindingRecord('O', { kind: 'queue', id: 'Q' }, '#.#.#'),
          },
        }),
      );

      expect(applySet(document, set({ kind: 'exchange', name: 'd', changes: { exchangeType: 'topic' } })).ok).toBe(
        true,
      );
      expect(applySet(document, set({ kind: 'exchange', name: 'other', changes: { durable: false } })).ok).toBe(true);
    });

    it('becoming internal while a producer publishes to it, and says which', () => {
      const result = applySet(sample(), set({ kind: 'exchange', name: 'orders', changes: { internal: true } }));

      expect(!result.ok && result.error).toEqual({
        kind: 'internal-exchange',
        message:
          "The exchange 'orders' cannot be internal while the producer 'sender' publishes to it, because a client cannot publish to an internal exchange. Unlink the producer first.",
      });
    });

    it('but allows it when the producer publishes to a queue of that name, or to another exchange, or no longer does', () => {
      expect(applySet(sample(), set({ kind: 'exchange', name: 'docs', changes: { internal: true } })).ok).toBe(true);
      expect(applySet(sample(), set({ kind: 'exchange', name: 'hidden', changes: { internal: true } })).ok).toBe(true);
    });

    it('and makes an exchange that is internal ordinary, even when a producer is pointed at it', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('x', 'direct', { internal: true }) },
          producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        }),
      );

      expect(applySet(document, set({ kind: 'exchange', name: 'x', changes: { internal: false } })).ok).toBe(true);
    });

    it('an exchange that is not there, and says what was probably meant', () => {
      const result = applySet(sample(), set({ kind: 'exchange', name: 'ordres', changes: { durable: true } }));

      expect(!result.ok && result.error.message).toBe("There is no exchange named 'ordres'. Did you mean 'orders'?");
    });
  });
});

describe('set queue', () => {
  it('leaves a durable queue durable, and returns the same document', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'queue', name: 'billing', changes: { durable: true } }));

    expect(result.ok && result.value).toBe(before);
  });

  it('refuses to make a queue that is not durable, with the 541 that the broker gave, and says why (ADR-0021, ADR-0024)', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'queue', name: 'billing', changes: { durable: false } }));

    expect(!result.ok && result.error.kind).toBe('transient-queue');
    expect(!result.ok && result.error.refusal).toEqual(transientQueueReply());
    expect(!result.ok && result.error.message).toContain("Queue 'billing' is not durable.");
    expect(!result.ok && result.error.message).toContain('every queue has to be durable');
    expect(before).toEqual(sampleDocument());
  });

  it('can make a queue durable that a document loaded from outside has as not durable, which is how an invalid one is mended', () => {
    const document = deepFreeze(documentOf({ queues: { Q: queueRecord('q', { durable: false }) } }));
    const result = applySet(document, set({ kind: 'queue', name: 'q', changes: { durable: true } }));

    expect(result.ok && result.value.queues['Q']?.durable).toBe(true);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
    expect(result.ok && undoRedoProblems(document, result.value)).toEqual([]);
  });

  it('refuses a queue that is not there', () => {
    expect(applySet(sample(), set({ kind: 'queue', name: 'nope', changes: { durable: true } }))).toMatchObject({
      error: { kind: 'missing-element' },
    });
  });
});

describe('set producer', () => {
  const target = 'sender';

  it('sets the payload, the key, the burst, the interval and whether it repeats', () => {
    const result = applySet(
      sample(),
      set({
        kind: 'producer',
        name: target,
        changes: { payload: 'bye', key: 'a.b', burst: 7, everyMs: 90, repeat: false },
      }),
    );

    expect(result.ok && result.value.producers['P1']).toMatchObject({
      message: { payload: 'bye', key: 'a.b' },
      burst: 7,
      interval: { everyMs: 90, on: false },
    });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('sets one value and keeps the others as they were', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'producer', name: target, changes: { burst: 9 } }));

    expect(result.ok && result.value.producers['P1']).toEqual({ ...before.producers['P1'], burst: 9 });
    expect(result.ok && result.value.producers['P1']?.message).toBe(before.producers['P1']?.message);
    expect(result.ok && result.value.producers['P1']?.interval).toBe(before.producers['P1']?.interval);
  });

  it('keeps the branch that it did not change as the same object: the message when only the interval changes, and the other way round', () => {
    const before = sample();
    const interval = applySet(before, set({ kind: 'producer', name: target, changes: { everyMs: 77, repeat: false } }));
    const message = applySet(before, set({ kind: 'producer', name: target, changes: { payload: 'new' } }));

    expect(interval.ok && interval.value.producers['P1']?.message).toBe(before.producers['P1']?.message);
    expect(interval.ok && interval.value.producers['P1']?.interval).not.toBe(before.producers['P1']?.interval);
    expect(message.ok && message.value.producers['P1']?.interval).toBe(before.producers['P1']?.interval);
    expect(message.ok && message.value.producers['P1']?.message).not.toBe(before.producers['P1']?.message);
    expect(message.ok && message.value.producers['P1']?.message.headers).toBe(before.producers['P1']?.message.headers);
  });

  it('puts the headers that it is given on the message: a header that is there gets its value where it is, and the new ones go last', () => {
    const result = applySet(
      sample(),
      set({
        kind: 'producer',
        name: target,
        changes: { headers: [entry('format', str('pdf')), entry('n', int(2)), entry('ratio', float(1))] },
      }),
    );

    expect(result.ok && result.value.producers['P1']?.message.headers).toEqual([
      entry('n', int(2)),
      entry('format', str('pdf')),
      entry('ratio', float(1)),
    ]);
  });

  it('changes nothing when every value is the one it has, and returns the same document', () => {
    const before = sample();
    const same = applySet(
      before,
      set({
        kind: 'producer',
        name: target,
        changes: {
          payload: 'hello',
          key: 'order.new',
          burst: 2,
          everyMs: 500,
          repeat: true,
          headers: [entry('n', int(1))],
        },
      }),
    );

    expect(same.ok && same.value).toBe(before);
  });

  it('tells the integer 1 from the float 1.0 when it looks for a change: setting the other one is a change', () => {
    const before = sample();
    const result = applySet(
      before,
      set({ kind: 'producer', name: target, changes: { headers: [entry('n', float(1))] } }),
    );

    expect(result.ok && result.value).not.toBe(before);
    expect(result.ok && result.value.producers['P1']?.message.headers).toEqual([entry('n', float(1))]);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'producer', name: target, changes: { key: 'other' } }));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  describe('refuses', () => {
    it.each<[string, number]>([
      ['burst', 0],
      ['burst', LIMITS.burst.max + 1],
      ['burst', 1.5],
      ['burst', Number.NaN],
    ])('a %s of %d', (what, value) => {
      const result = applySet(sample(), set({ kind: 'producer', name: target, changes: { [what]: value } }));

      expect(!result.ok && result.error.kind).toBe('invalid-value');
      expect(!result.ok && result.error.message).toBe(
        `The burst must be a whole number from ${LIMITS.burst.min} to ${LIMITS.burst.max}, and ${value} is not.`,
      );
    });

    it('an interval outside its range, and takes both ends of it', () => {
      for (const everyMs of [0, LIMITS.everyMs.max + 1, -5, 2.5]) {
        expect(applySet(sample(), set({ kind: 'producer', name: target, changes: { everyMs } }))).toMatchObject({
          error: { kind: 'invalid-value', message: expect.stringContaining('The interval must be a whole number') },
        });
      }
      for (const everyMs of [LIMITS.everyMs.min, LIMITS.everyMs.max]) {
        expect(applySet(sample(), set({ kind: 'producer', name: target, changes: { everyMs } })).ok).toBe(true);
      }
      expect(applySet(sample(), set({ kind: 'producer', name: target, changes: { burst: LIMITS.burst.max } })).ok).toBe(
        true,
      );
    });

    it('a routing key of more than 255 bytes, and takes one of exactly 255', () => {
      expect(
        applySet(sample(), set({ kind: 'producer', name: target, changes: { key: 'k'.repeat(256) } })),
      ).toMatchObject({
        error: {
          kind: 'routing-key',
          message: 'A routing key is at most 255 bytes of UTF-8, and this one is 256.',
        },
      });
      expect(applySet(sample(), set({ kind: 'producer', name: target, changes: { key: 'k'.repeat(255) } })).ok).toBe(
        true,
      );
    });

    it('headers that a broker would not take: no name, a name twice, a value that cannot be exact', () => {
      expect(
        applySet(sample(), set({ kind: 'producer', name: target, changes: { headers: [entry('', int(1))] } })),
      ).toMatchObject({
        error: { kind: 'header', message: 'A header needs a name.' },
      });
      expect(
        applySet(
          sample(),
          set({ kind: 'producer', name: target, changes: { headers: [entry('a', int(1)), entry('a', int(2))] } }),
        ),
      ).toMatchObject({ error: { kind: 'header', message: expect.stringContaining('is there twice') } });
      expect(
        applySet(sample(), set({ kind: 'producer', name: target, changes: { headers: [entry('a', int(2 ** 53))] } })),
      ).toMatchObject({
        error: { kind: 'header', message: expect.stringContaining("The header 'a'") },
      });
    });

    it('a producer that is not there', () => {
      expect(applySet(sample(), set({ kind: 'producer', name: 'sendr', changes: { burst: 2 } }))).toMatchObject({
        error: { message: "There is no producer named 'sendr'. Did you mean 'sender'?" },
      });
    });
  });
});

describe('set consumer', () => {
  it('sets the acknowledgement, the prefetch and the processing time', () => {
    const result = applySet(
      sample(),
      set({ kind: 'consumer', name: 'worker', changes: { ack: 'auto', prefetch: 0, processingMs: 1500 } }),
    );

    expect(result.ok && result.value.consumers['C1']).toEqual({
      name: 'worker',
      queues: ['Q1'],
      ack: 'auto',
      prefetch: 0,
      processingMs: 1500,
    });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('takes both ends of each range', () => {
    for (const changes of [
      { prefetch: LIMITS.prefetch.min },
      { prefetch: LIMITS.prefetch.max },
      { processingMs: LIMITS.processingMs.min },
      { processingMs: LIMITS.processingMs.max },
    ]) {
      expect(applySet(sample(), set({ kind: 'consumer', name: 'worker', changes })).ok, JSON.stringify(changes)).toBe(
        true,
      );
    }
  });

  it('changes nothing when every value is the one it has, and returns the same document', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'consumer', name: 'worker', changes: { ack: 'manual', prefetch: 3 } }));

    expect(result.ok && result.value).toBe(before);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'consumer', name: 'worker', changes: { prefetch: 10 } }));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.consumers['C1']?.queues).toBe(before.consumers['C1']?.queues);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('sets one value and keeps the others as they were, whatever the value is: a new one, and none', () => {
    const before = sample();
    const worker = before.consumers['C1'] as CanvasDocument['consumers'][string];
    const changed: ConsumerChanges[] = [
      { ack: 'auto' },
      { prefetch: 10 },
      { prefetch: 0 },
      { processingMs: 250 },
      { processingMs: 0 },
    ];

    expect(worker).toMatchObject({ ack: 'manual', prefetch: 3 });
    for (const changes of changed) {
      const result = applySet(before, set({ kind: 'consumer', name: 'worker', changes }));

      expect(result.ok && result.value.consumers['C1'], JSON.stringify(changes)).toEqual({ ...worker, ...changes });
    }
  });

  it.each([
    ['prefetch', 'prefetch', -1],
    ['prefetch', 'prefetch', LIMITS.prefetch.max + 1],
    ['prefetch', 'prefetch', 2.5],
    ['processingMs', 'processing time', -1],
    ['processingMs', 'processing time', LIMITS.processingMs.max + 1],
    ['processingMs', 'processing time', 0.5],
  ])('refuses a %s of %d, in words that name it', (field, label, value) => {
    const result = applySet(sample(), set({ kind: 'consumer', name: 'worker', changes: { [field]: value } }));

    expect(!result.ok && result.error.kind).toBe('invalid-value');
    expect(!result.ok && result.error.message).toContain(`The ${label} must be a whole number from`);
  });

  it('refuses a consumer that is not there', () => {
    expect(applySet(sample(), set({ kind: 'consumer', name: 'nobody', changes: { prefetch: 1 } }))).toMatchObject({
      error: { kind: 'missing-element' },
    });
  });
});

describe('set canvas', () => {
  it('sets whether the default exchange is shown, the seed and the timing', () => {
    const result = applySet(
      sample(),
      set({
        kind: 'canvas',
        changes: { showDefaultExchange: true, seed: 42, publishMs: 100, brokerMs: 200, deliverMs: 300 },
      }),
    );

    expect(result.ok && result.value.settings).toEqual({
      showDefaultExchange: true,
      seed: 42,
      timing: { publishMs: 100, brokerMs: 200, deliverMs: 300 },
    });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('sets one setting and keeps the rest', () => {
    const before = sample();
    const result = applySet(before, set({ kind: 'canvas', changes: { brokerMs: 0 } }));

    expect(result.ok && result.value.settings).toEqual({
      ...before.settings,
      timing: { ...before.settings.timing, brokerMs: 0 },
    });
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when the setting is the one it has, and returns the same document', () => {
    const before = sample();
    const result = applySet(
      before,
      set({ kind: 'canvas', changes: { showDefaultExchange: false, seed: before.settings.seed } }),
    );

    expect(result.ok && result.value).toBe(before);
  });

  it.each([
    ['seed', 'seed', -1],
    ['seed', 'seed', LIMITS.seed.max + 1],
    ['seed', 'seed', 1.5],
    ['publishMs', 'publish time', LIMITS.timingMs.max + 1],
    ['brokerMs', 'broker time', -1],
    ['deliverMs', 'delivery time', 0.5],
  ])('refuses a %s of %d, in words that name it', (field, label, value) => {
    const result = applySet(sample(), set({ kind: 'canvas', changes: { [field]: value } }));

    expect(!result.ok && result.error.message).toContain(`The ${label} must be a whole number from`);
  });

  it('takes the ends of each range', () => {
    expect(applySet(sample(), set({ kind: 'canvas', changes: { seed: LIMITS.seed.max } })).ok).toBe(true);
    expect(
      applySet(sample(), set({ kind: 'canvas', changes: { seed: 0, publishMs: 0, brokerMs: LIMITS.timingMs.max } })).ok,
    ).toBe(true);
  });
});

describe('set with nothing to set', () => {
  it('is a mistake, for every kind, and says what to do', () => {
    for (const command of [
      set({ kind: 'exchange', name: 'orders', changes: {} }),
      set({ kind: 'queue', name: 'billing', changes: {} }),
      set({ kind: 'producer', name: 'sender', changes: {} }),
      set({ kind: 'consumer', name: 'worker', changes: {} }),
      set({ kind: 'canvas', changes: {} }),
      set({ kind: 'queue', name: 'billing', changes: { durable: undefined } }),
    ]) {
      expect(applySet(sample(), command)).toEqual({
        ok: false,
        error: { kind: 'nothing-to-change', message: 'Say what to set, for example durable=true.' },
      });
    }
  });
});

describe('unset', () => {
  it('takes headers off the message of a producer, and keeps the others in their order', () => {
    const document = deepFreeze(
      documentOf({
        producers: {
          P: producerRecord('p', null, {
            message: { payload: '', key: '', headers: [entry('a', int(1)), entry('b', int(2)), entry('c', int(3))] },
          }),
        },
      }),
    );
    const one = applyUnset(document, unset('p', 'b'));
    const two = applyUnset(document, unset('p', 'c', 'a'));

    expect(one.ok && one.value.producers['P']?.message.headers.map(({ key }) => key)).toEqual(['a', 'c']);
    expect(two.ok && two.value.producers['P']?.message.headers.map(({ key }) => key)).toEqual(['b']);
    expect(one.ok && validateDocument(one.value)).toEqual([]);
    expect(one.ok && undoRedoProblems(document, one.value)).toEqual([]);
  });

  it('keeps what it did not touch', () => {
    const before = sample();
    const result = applyUnset(before, unset('sender', 'n'));

    expect(result.ok && result.value.producers['P1']?.message.headers).toEqual([]);
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.layout).toBe(before.layout);
  });

  it('refuses a header that the producer does not have, and lists the ones that it has', () => {
    expect(applyUnset(sample(), unset('sender', 'format'))).toEqual({
      ok: false,
      error: { kind: 'no-header', message: "The producer 'sender' has no header 'format'. Its headers are 'n'." },
    });
    const bare = deepFreeze(documentOf({ producers: { P: producerRecord('p') } }));

    expect(applyUnset(bare, unset('p', 'x'))).toMatchObject({
      error: { message: "The producer 'p' has no header 'x'. It has no headers." },
    });
    const two = deepFreeze(
      documentOf({
        producers: {
          P: producerRecord('p', null, {
            message: { payload: '', key: '', headers: [entry('a', int(1)), entry('b', int(2))] },
          }),
        },
      }),
    );

    expect(applyUnset(two, unset('p', 'x'))).toMatchObject({
      error: { message: "The producer 'p' has no header 'x'. Its headers are 'a', 'b'." },
    });
  });

  it('refuses all of it when one header is missing, and changes nothing', () => {
    const before = sample();
    const result = applyUnset(before, unset('sender', 'n', 'nope'));

    expect(result.ok).toBe(false);
    expect(before).toEqual(sampleDocument());
  });

  it('refuses a producer that is not there, and a command that names no header', () => {
    expect(applyUnset(sample(), unset('nobody', 'n'))).toMatchObject({ error: { kind: 'missing-element' } });
    expect(applyUnset(sample(), unset('sender'))).toEqual({
      ok: false,
      error: { kind: 'nothing-to-change', message: 'Say which headers to take off, for example header:format.' },
    });
  });
});

describe('every set and unset', () => {
  it('leaves a document that is valid valid, whatever it sets', () => {
    const commands: (SetCommand | Unset)[] = [
      set({ kind: 'exchange', name: 'orders', changes: { exchangeType: 'direct', durable: false, autoDelete: true } }),
      set({ kind: 'queue', name: 'billing', changes: { durable: true } }),
      set({
        kind: 'producer',
        name: 'sender',
        changes: { payload: 'x', key: '', burst: 1000, everyMs: 1, repeat: false, headers: [entry('z', str(''))] },
      }),
      set({ kind: 'consumer', name: 'worker', changes: { ack: 'auto', prefetch: 65535, processingMs: 0 } }),
      set({ kind: 'canvas', changes: { showDefaultExchange: true, seed: 0, publishMs: 0, brokerMs: 0, deliverMs: 0 } }),
      unset('sender', 'n'),
    ];
    for (const command of commands) {
      const result = command.type === 'set' ? applySet(sample(), command) : applyUnset(sample(), command);

      expect(result.ok && validateDocument(result.value), JSON.stringify(command)).toEqual([]);
    }
  });
});
