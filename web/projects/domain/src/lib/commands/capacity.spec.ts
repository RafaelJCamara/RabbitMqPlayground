import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sequentialIds,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { elementCount, edgeCount } from '../document/capacity';
import { LIMITS, type CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applyCommand } from './apply';
import type { DocumentCommand, ProducerChanges } from './types';

/**
 * ADR-0029: no command makes a canvas that cannot be saved or opened again. These are the counts that
 * `loadCanvas` refuses above (ADR-0027), met from the other side: each command that adds something refuses at the cap, and
 * says that the canvas is full, and a canvas that is exactly at a cap is fine.
 */

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
const apply = (document: CanvasDocument, command: DocumentCommand) => applyCommand(document, command, sequentialIds());

/** `count` elements, half exchanges and half queues, and nothing else. */
function withElements(count: number): CanvasDocument {
  const exchanges = Math.ceil(count / 2);
  return deepFreeze(
    documentOf({
      exchanges: Object.fromEntries(range(exchanges).map((i) => [`E${i}`, exchangeRecord(`e${i}`)])),
      queues: Object.fromEntries(range(count - exchanges).map((i) => [`Q${i}`, queueRecord(`q${i}`)])),
    }),
  );
}

/**
 * `count` edges that are all bindings, from one exchange to ten queues with a key of its own each, and a producer and a
 * consumer that are not linked to anything.
 */
function withBindings(count: number): CanvasDocument {
  return deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('e') },
      queues: Object.fromEntries(range(10).map((i) => [`Q${i}`, queueRecord(`q${i}`)])),
      producers: { P: producerRecord('p') },
      consumers: { C: consumerRecord('c') },
      bindings: Object.fromEntries(
        range(count).map((i) => [`B${i}`, bindingRecord('E', { kind: 'queue', id: `Q${i % 10}` }, `key.${i}`)]),
      ),
    }),
  );
}

describe('the number of elements (exchanges, queues, producers and consumers together)', () => {
  const adds: readonly [string, DocumentCommand][] = [
    [
      'an exchange',
      {
        type: 'declare-exchange',
        name: 'new',
        exchangeType: 'direct',
        durable: true,
        autoDelete: false,
        internal: false,
      },
    ],
    ['a queue', { type: 'declare-queue', name: 'new', durable: true }],
    ['a producer', { type: 'add-producer', name: 'new' }],
    ['a consumer', { type: 'add-consumer', name: 'new' }],
  ];

  it('is counted over the four kinds together', () => {
    const document = documentOf({
      exchanges: { E: exchangeRecord('e') },
      queues: { Q: queueRecord('q') },
      bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
      producers: { P: producerRecord('p') },
      consumers: { C: consumerRecord('c'), D: consumerRecord('d') },
    });

    expect(elementCount(document)).toBe(5);
    expect(elementCount(documentOf())).toBe(0);
  });

  it.each(adds)('refuses %s when the canvas holds as many as it can, and says that it is full', (_, command) => {
    const before = withElements(LIMITS.elements);
    const result = apply(before, command);

    expect(!result.ok && result.error.kind).toBe('canvas-full');
    expect(!result.ok && result.error.message).toBe(
      'The canvas is full: a canvas holds at most 2,000 elements (exchanges, queues, producers and consumers), so that it can always be saved and opened again, and this one has 2,000. Delete something you no longer need to make room.',
    );
    expect(!result.ok && result.error.refusal).toBeUndefined();
    expect(elementCount(before)).toBe(LIMITS.elements);
  });

  it.each(adds)('accepts %s as the last one that fits, and the canvas it makes is valid', (_, command) => {
    const result = apply(withElements(LIMITS.elements - 1), command);

    expect(result.ok && elementCount(result.value)).toBe(LIMITS.elements);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('counts the kinds together, so that producers and consumers fill the room that exchanges and queues leave', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: Object.fromEntries(range(500).map((i) => [`E${i}`, exchangeRecord(`e${i}`)])),
        queues: Object.fromEntries(range(500).map((i) => [`Q${i}`, queueRecord(`q${i}`)])),
        producers: Object.fromEntries(range(500).map((i) => [`P${i}`, producerRecord(`p${i}`)])),
        consumers: Object.fromEntries(range(500).map((i) => [`C${i}`, consumerRecord(`c${i}`)])),
      }),
    );

    expect(apply(document, { type: 'add-consumer', name: 'one-more' })).toMatchObject({
      error: { kind: 'canvas-full' },
    });
  });

  it('says what is wrong with the name, or the flag, or the repeat, before it says that the canvas is full', () => {
    const full = withElements(LIMITS.elements);

    expect(apply(full, { type: 'declare-queue', name: 'amq.x', durable: true })).toMatchObject({
      error: { kind: 'reserved-name' },
    });
    expect(apply(full, { type: 'declare-queue', name: 'fresh', durable: false })).toMatchObject({
      error: { kind: 'transient-queue' },
    });
    expect(apply(full, { type: 'declare-queue', name: 'q0', durable: true })).toMatchObject({
      error: { kind: 'duplicate-name' },
    });
    expect(apply(full, { type: 'add-producer', name: '' })).toMatchObject({ error: { kind: 'empty-name' } });
  });

  it('leaves room for the commands that add no element: a rename, a move, a delete and a set still work', () => {
    const full = withElements(LIMITS.elements);

    expect(apply(full, { type: 'rename', target: { kind: 'queue', name: 'q0' }, name: 'renamed' }).ok).toBe(true);
    expect(apply(full, { type: 'move', target: { kind: 'queue', name: 'q0' }, x: 5 }).ok).toBe(true);
    expect(apply(full, { type: 'delete', target: { kind: 'queue', name: 'q0' } }).ok).toBe(true);
    expect(apply(full, { type: 'layout' }).ok).toBe(true);
  });

  it('makes room again when something is deleted', () => {
    const full = withElements(LIMITS.elements);
    const deleted = apply(full, { type: 'delete', target: { kind: 'queue', name: 'q0' } });

    expect(deleted.ok && apply(deleted.value, { type: 'add-producer', name: 'p' }).ok).toBe(true);
  });
});

describe('the number of edges (bindings, producer links and subscriptions together)', () => {
  const bind = (key: string): DocumentCommand => ({
    type: 'bind',
    source: 'e',
    destination: { kind: 'queue', name: 'q0' },
    key,
  });
  const full = (): CanvasDocument => withBindings(LIMITS.edges);

  it('is counted over bindings, producer links and subscriptions', () => {
    const document = documentOf({
      exchanges: { E: exchangeRecord('e') },
      queues: { Q: queueRecord('q') },
      bindings: {
        B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'a'),
        B2: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'b'),
      },
      producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }), Q: producerRecord('unlinked') },
      consumers: { C: consumerRecord('c', ['Q']), D: consumerRecord('d', ['Q']), F: consumerRecord('f') },
    });

    expect(edgeCount(document)).toBe(5);
    expect(edgeCount(documentOf())).toBe(0);
  });

  it('refuses a new binding at the cap, and says that the canvas is full of connections', () => {
    const result = apply(full(), bind('one.more'));

    expect(!result.ok && result.error.kind).toBe('canvas-full');
    expect(!result.ok && result.error.message).toBe(
      'The canvas is full: a canvas holds at most 5,000 connections (bindings, producer links and consumer subscriptions), so that it can always be saved and opened again, and this one has 5,000. Delete something you no longer need to make room.',
    );
  });

  it('accepts the last binding that fits, and the canvas it makes is valid', () => {
    const result = apply(withBindings(LIMITS.edges - 1), bind('last'));

    expect(result.ok && edgeCount(result.value)).toBe(LIMITS.edges);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('answers a binding that is already there with the same document, even when the canvas is full', () => {
    const before = full();
    const result = apply(before, bind('key.0'));

    expect(result.ok && result.value).toBe(before);
  });

  it('says what is wrong with a binding before it says that the canvas is full', () => {
    const missing = apply(full(), { ...bind('x'), source: 'nope' } as DocumentCommand);

    expect(missing).toMatchObject({ error: { kind: 'missing-exchange' } });
  });

  it('refuses a producer that has no target yet, because a link is an edge', () => {
    const result = apply(full(), { type: 'link', producer: 'p', target: { kind: 'exchange', name: 'e' } });

    expect(result).toMatchObject({ error: { kind: 'canvas-full' } });
  });

  it('lets a producer that has a target point at another, since that is the same number of edges', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        bindings: Object.fromEntries(
          range(LIMITS.edges - 1).map((i) => [`B${i}`, bindingRecord('E', { kind: 'queue', id: 'Q' }, `key.${i}`)]),
        ),
      }),
    );

    expect(edgeCount(document)).toBe(LIMITS.edges);
    const result = apply(document, { type: 'link', producer: 'p', target: { kind: 'queue', name: 'q' } });
    expect(result.ok && edgeCount(result.value)).toBe(LIMITS.edges);
    const same = apply(document, { type: 'link', producer: 'p', target: { kind: 'exchange', name: 'e' } });
    expect(same.ok && same.value).toBe(document);
  });

  it('refuses a new subscription, and answers one that is already there with the same document', () => {
    const refused = apply(full(), { type: 'subscribe', consumer: 'c', queue: 'q0' });
    expect(refused).toMatchObject({ error: { kind: 'canvas-full' } });

    const document = deepFreeze(
      documentOf({
        queues: { Q: queueRecord('q') },
        consumers: { C: consumerRecord('c', ['Q']) },
        exchanges: { E: exchangeRecord('e') },
        bindings: Object.fromEntries(
          range(LIMITS.edges - 1).map((i) => [`B${i}`, bindingRecord('E', { kind: 'queue', id: 'Q' }, `key.${i}`)]),
        ),
      }),
    );
    const again = apply(document, { type: 'subscribe', consumer: 'c', queue: 'q' });
    expect(again.ok && again.value).toBe(document);
  });

  it('makes room again when an edge is taken away', () => {
    const unbound = apply(full(), {
      type: 'unbind',
      source: 'e',
      destination: { kind: 'queue', name: 'q0' },
      key: 'key.0',
    });

    expect(unbound.ok && apply(unbound.value, bind('fits')).ok).toBe(true);
  });
});

describe('the length of a payload and of the text in a header', () => {
  const sender = (): CanvasDocument =>
    deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e', 'headers') },
        queues: { Q: queueRecord('q') },
        producers: { P: producerRecord('p') },
      }),
    );
  const setProducer = (changes: ProducerChanges) =>
    apply(sender(), { type: 'set', kind: 'producer', name: 'p', changes });
  const header = (key: string, value: string) => ({ key, value: { t: 'string' as const, v: value } });

  it('is at most 10,000 characters for a payload, and the canvas that holds one that long is valid', () => {
    const result = setProducer({ payload: 'x'.repeat(LIMITS.textLength) });

    expect(result.ok && result.value.producers['P']?.message.payload).toHaveLength(LIMITS.textLength);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('refuses a payload that is one character longer, and says how long it is', () => {
    const result = setProducer({ payload: 'x'.repeat(LIMITS.textLength + 1) });

    expect(!result.ok && result.error).toEqual({
      kind: 'invalid-value',
      message: 'A payload is at most 10,000 characters, and this one has 10,001. Shorten it.',
    });
  });

  it('is at most 10,000 characters for a header value that is text, in a message and in a binding', () => {
    const fits = 'x'.repeat(LIMITS.textLength);
    const tooLong = 'x'.repeat(LIMITS.textLength + 1);

    expect(setProducer({ headers: [header('k', fits)] }).ok).toBe(true);
    expect(setProducer({ headers: [header('k', tooLong)] })).toMatchObject({
      error: {
        kind: 'header',
        message: "The header 'k': a value that is text is at most 10,000 characters, and this one has 10,001.",
      },
    });

    const bindWith = (value: string) =>
      apply(sender(), {
        type: 'bind',
        source: 'e',
        destination: { kind: 'queue', name: 'q' },
        key: '',
        headers: { xMatch: 'all', args: [{ key: 'k', value: { t: 'string', v: value } }] },
      });
    expect(bindWith(fits).ok).toBe(true);
    expect(bindWith(tooLong)).toMatchObject({ error: { kind: 'header' } });
  });

  it('does not count a number, a boolean or an exists condition as text', () => {
    expect(setProducer({ headers: [{ key: 'n', value: { t: 'integer', v: Number.MAX_SAFE_INTEGER } }] }).ok).toBe(true);
    expect(
      apply(sender(), {
        type: 'bind',
        source: 'e',
        destination: { kind: 'queue', name: 'q' },
        key: '',
        headers: { xMatch: 'any', args: [{ key: 'k', value: { t: 'exists' } }] },
      }).ok,
    ).toBe(true);
  });
});

describe('the number of headers on one message, and of arguments on one binding', () => {
  const entries = (count: number, from = 0) =>
    range(count).map((i) => ({ key: `h${from + i}`, value: { t: 'integer' as const, v: i } }));
  const producerWith = (count: number): CanvasDocument =>
    deepFreeze(
      documentOf({
        producers: {
          P: producerRecord('p', null, { message: { payload: '', key: '', headers: entries(count) } }),
        },
      }),
    );

  it('is at most 100 for a message, and the canvas that holds 100 is valid', () => {
    const result = apply(documentOf({ producers: { P: producerRecord('p') } }), {
      type: 'set',
      kind: 'producer',
      name: 'p',
      changes: { headers: entries(LIMITS.headerEntries) },
    });

    expect(result.ok && result.value.producers['P']?.message.headers).toHaveLength(LIMITS.headerEntries);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('refuses 101 headers set at once, and says how many there are', () => {
    const result = apply(documentOf({ producers: { P: producerRecord('p') } }), {
      type: 'set',
      kind: 'producer',
      name: 'p',
      changes: { headers: entries(LIMITS.headerEntries + 1) },
    });

    expect(!result.ok && result.error).toEqual({
      kind: 'header',
      message: 'The headers of one message are at most 100, and there are 101. Take some off.',
    });
  });

  it('refuses headers that, with the ones the message has, come to more than 100, and counts a header that is replaced once', () => {
    const adding = apply(producerWith(60), {
      type: 'set',
      kind: 'producer',
      name: 'p',
      changes: { headers: entries(50, 60) },
    });
    expect(!adding.ok && adding.error.message).toBe(
      'The headers of one message are at most 100, and there are 110. Take some off.',
    );

    // 20 of the 50 are headers that the message has, so the message ends with 60 + 30 = 90.
    const replacing = apply(producerWith(60), {
      type: 'set',
      kind: 'producer',
      name: 'p',
      changes: { headers: [...entries(20, 40), ...entries(30, 60)] },
    });
    expect(replacing.ok && replacing.value.producers['P']?.message.headers).toHaveLength(90);
  });

  it('is at most 100 for the arguments of a binding', () => {
    const document = deepFreeze(
      documentOf({ exchanges: { E: exchangeRecord('e', 'headers') }, queues: { Q: queueRecord('q') } }),
    );
    const bindWith = (count: number) =>
      apply(document, {
        type: 'bind',
        source: 'e',
        destination: { kind: 'queue', name: 'q' },
        key: '',
        headers: { xMatch: 'all', args: entries(count) },
      });

    expect(bindWith(LIMITS.headerEntries).ok).toBe(true);
    const refused = bindWith(LIMITS.headerEntries + 1);
    expect(!refused.ok && refused.error).toEqual({
      kind: 'header',
      message: 'The arguments of one binding are at most 100, and there are 101. Take some off.',
    });
  });
});

describe('a canvas at every cap at once', () => {
  it('is valid, which is what makes "a document that a command made always loads" true', () => {
    const document = documentOf({
      exchanges: Object.fromEntries(
        range(LIMITS.elements - 1).map((i) => [`E${i}`, exchangeRecord(`e${i}`, 'headers')]),
      ),
      queues: {},
      producers: {
        P: producerRecord('p', null, {
          message: {
            payload: 'x'.repeat(LIMITS.textLength),
            key: '',
            headers: range(LIMITS.headerEntries).map((i) => ({
              key: `h${i}`,
              value: { t: 'string' as const, v: 'y'.repeat(LIMITS.textLength) },
            })),
          },
        }),
      },
      bindings: Object.fromEntries(
        range(LIMITS.edges).map((i) => [
          `B${i}`,
          bindingRecord('E0', { kind: 'exchange', id: `E${(i % (LIMITS.elements - 2)) + 1}` }, `key.${i}`),
        ]),
      ),
    });

    expect(elementCount(document)).toBe(LIMITS.elements);
    expect(edgeCount(document)).toBe(LIMITS.edges);
    expect(validateDocument(document)).toEqual([]);
  });
});
