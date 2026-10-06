import * as fc from 'fast-check';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import {
  COLUMN_X,
  defaultPosition,
  didYouMean,
  freshId,
  joinList,
  keepIfSame,
  missingElementIssue,
  namesOf,
  ROW_HEIGHT,
  sameValue,
  without,
  withElement,
  withNameHints,
  withoutDanglingLabels,
} from './helpers';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());

describe('freshId', () => {
  it('gives the id that the context gives, for the kind that it was asked about', () => {
    const asked: string[] = [];

    expect(freshId(sample(), { newId: (kind) => (asked.push(kind), 'fresh1') }, 'queue')).toBe('fresh1');
    expect(asked).toEqual(['queue']);
  });

  it.each(['E1', 'Q2', 'B3', 'P1', 'C1'])('refuses %s, which the canvas has, whichever kind of thing has it', (id) => {
    expect(() => freshId(sample(), { newId: () => id }, 'exchange')).toThrow(
      `The id generator gave '${id}' for a new exchange, which is already used on the canvas.`,
    );
  });

  it.each(['', '1a', 'a b', '__proto__', 'a'.repeat(65), 'é'])('refuses %j, which is not an id', (id) => {
    expect(() => freshId(sample(), { newId: () => id }, 'binding')).toThrow(`which is not a valid id`);
  });

  it('takes an id that is only like one that the canvas has', () => {
    expect(freshId(sample(), { newId: () => 'e1' }, 'exchange')).toBe('e1');
    expect(freshId(sample(), { newId: () => 'E11' }, 'exchange')).toBe('E11');
  });

  it('takes an id that is a name that every object has, because the canvas does not have it', () => {
    expect(freshId(sample(), { newId: () => 'constructor' }, 'queue')).toBe('constructor');
  });
});

describe('defaultPosition', () => {
  it('puts the first node of a kind at the top of its column', () => {
    const document = documentOf();

    expect(defaultPosition(document, 'producer')).toEqual({ x: COLUMN_X.producer, y: 0 });
    expect(defaultPosition(document, 'exchange')).toEqual({ x: COLUMN_X.exchange, y: 0 });
    expect(defaultPosition(document, 'queue')).toEqual({ x: COLUMN_X.queue, y: 0 });
    expect(defaultPosition(document, 'consumer')).toEqual({ x: COLUMN_X.consumer, y: 0 });
  });

  it('lists the columns from left to right in the way a message goes', () => {
    expect(COLUMN_X.producer).toBeLessThan(COLUMN_X.exchange);
    expect(COLUMN_X.exchange).toBeLessThan(COLUMN_X.queue);
    expect(COLUMN_X.queue).toBeLessThan(COLUMN_X.consumer);
  });

  it('has the columns and the rows that it has, so that a change of one is a change that a test shows', () => {
    expect(COLUMN_X).toEqual({ producer: 0, exchange: 320, queue: 640, consumer: 960 });
    expect(ROW_HEIGHT).toBe(120);
  });

  it('puts the next node of a kind below the lowest one of that kind, wherever it is, and ignores the other kinds', () => {
    const document = documentOf({
      exchanges: { A: exchangeRecord('a'), B: exchangeRecord('b') },
      queues: { Q: queueRecord('q') },
      nodes: { A: { x: 0, y: 40 }, B: { x: 900, y: 300 }, Q: { x: 0, y: 5000 } },
    });

    expect(defaultPosition(document, 'exchange')).toEqual({ x: COLUMN_X.exchange, y: 300 + ROW_HEIGHT });
    expect(defaultPosition(document, 'queue')).toEqual({ x: COLUMN_X.queue, y: 5000 + ROW_HEIGHT });
    expect(defaultPosition(document, 'consumer').y).toBe(0);
  });

  it('copes with a lowest node that is above the origin, and with nodes that have no position', () => {
    const above = documentOf({
      queues: { A: queueRecord('a'), B: queueRecord('b') },
      nodes: { A: { x: 0, y: -500 }, B: { x: 0, y: -300 } },
    });
    const none = documentOf({ queues: { A: queueRecord('a') }, nodes: {} });

    expect(defaultPosition(above, 'queue').y).toBe(-300 + ROW_HEIGHT);
    expect(defaultPosition(none, 'queue').y).toBe(0);
  });
});

describe('without', () => {
  it('is the record minus an entry, and the record is untouched', () => {
    const record = deepFreeze({ a: 1, b: 2, c: 3 });

    expect(without(record, 'b')).toEqual({ a: 1, c: 3 });
    expect(record).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('is a copy of the record when the entry is not there, and does not take what every object has', () => {
    const record = { a: 1 };

    expect(without(record, 'missing')).toEqual({ a: 1 });
    expect(without(record, 'toString')).toEqual({ a: 1 });
    expect(without(record, 'missing')).not.toBe(record);
  });
});

describe('withElement', () => {
  it('adds the element and a position for it, and shares the rest', () => {
    const before = sample();
    const result = withElement(before, 'queue', 'Q9', { name: 'new', serverNamed: false, durable: true });

    expect(result.queues['Q9']).toEqual({ name: 'new', serverNamed: false, durable: true });
    expect(result.layout.nodes['Q9']).toEqual({
      x: COLUMN_X.queue,
      y: Math.max(...['Q1', 'Q2'].map((id) => before.layout.nodes[id]?.y ?? 0)) + ROW_HEIGHT,
    });
    expect(result.exchanges).toBe(before.exchanges);
    expect(result.layout.labels).toBe(before.layout.labels);
    expect(before.queues['Q9']).toBeUndefined();
  });
});

describe('withoutDanglingLabels', () => {
  it('is the same document when every label has its edge, or there is no label', () => {
    const before = sample();

    expect(withoutDanglingLabels(before)).toBe(before);
    const none = deepFreeze(documentOf());

    expect(withoutDanglingLabels(none)).toBe(none);
  });

  it('drops the labels of edges that are gone, and keeps the others, and the rest of the document is shared', () => {
    const before = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q'), R: queueRecord('r') },
        bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        consumers: { C: consumerRecord('c', ['R']) },
        labels: { 'E>Q': { at: 0.1 }, 'E>R': { at: 0.2 }, 'P>E': { at: 0.3 }, 'Q>C': { at: 0.4 }, 'R>C': { at: 0.5 } },
      }),
    );
    const after = withoutDanglingLabels(before);

    expect(Object.keys(after.layout.labels)).toEqual(['E>Q', 'P>E', 'R>C']);
    expect(after.layout.labels['E>Q']).toBe(before.layout.labels['E>Q']);
    expect(after.layout.nodes).toBe(before.layout.nodes);
    expect(after.bindings).toBe(before.bindings);
  });

  it('drops every label when no edge is left', () => {
    const before = deepFreeze(documentOf({ labels: { 'a>b': { at: 0.5 } } }));

    expect(withoutDanglingLabels(before).layout.labels).toEqual({});
  });
});

describe('namesOf', () => {
  it('lists the names of one kind in the order they were made', () => {
    expect(namesOf(sample(), 'exchange')).toEqual(['orders', 'docs', 'hidden']);
    expect(namesOf(sample(), 'queue')).toEqual(['billing', 'archive']);
    expect(namesOf(sample(), 'producer')).toEqual(['sender']);
    expect(namesOf(sample(), 'consumer')).toEqual(['worker']);
  });
});

describe('joinList', () => {
  it.each<[string[], 'and' | 'or', string]>([
    [[], 'and', ''],
    [['a'], 'or', 'a'],
    [['a', 'b'], 'and', 'a and b'],
    [['a', 'b', 'c'], 'or', 'a, b or c'],
    [['a', 'b', 'c', 'd'], 'and', 'a, b, c and d'],
  ])('puts %j together with %s as %j', (items, word, text) => {
    expect(joinList(items, word)).toBe(text);
  });
});

describe('didYouMean', () => {
  it.each<[string[], string]>([
    [[], ''],
    [['a'], " Did you mean 'a'?"],
    [['a', 'b'], " Did you mean 'a' or 'b'?"],
    [['a', 'b', 'c'], " Did you mean 'a', 'b' or 'c'?"],
  ])('says %j as %j', (names, text) => {
    expect(didYouMean(names)).toBe(text);
  });
});

describe('missingElementIssue and withNameHints', () => {
  it('says that there is no such element, and nothing more when nothing is close and nothing else has the name', () => {
    expect(missingElementIssue(sample(), 'queue', 'zzzzzz')).toEqual({
      kind: 'missing-element',
      message: "There is no queue named 'zzzzzz'.",
    });
  });

  it('says which other kinds have the name, with the right article', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('same') },
        queues: { Q: queueRecord('same') },
        producers: { P: producerRecord('same') },
      }),
    );

    expect(missingElementIssue(document, 'consumer', 'same').message).toBe(
      "There is no consumer named 'same'. There is an exchange, a queue and a producer with that name.",
    );
    expect(missingElementIssue(document, 'producer', 'same').message).toBe(
      "There is no producer named 'same'. There is an exchange and a queue with that name.",
    );
    expect(missingElementIssue(document, 'exchange', 'same').message).toBe(
      "There is no exchange named 'same'. There is a queue and a producer with that name.",
    );
  });

  it('suggests the names of the same kind that are close, and gives them in the issue too', () => {
    const issue = missingElementIssue(sample(), 'queue', 'billin');

    expect(issue.suggestions).toEqual(['billing']);
    expect(issue.message).toBe("There is no queue named 'billin'. Did you mean 'billing'?");
  });

  it('adds to the message of an issue that it is given, and keeps the rest of it', () => {
    const issue = withNameHints(
      { kind: 'missing-queue', message: 'Nope.', refusal: { code: 404, text: 'NOT_FOUND' } },
      sample(),
      'queue',
      'billin',
    );

    expect(issue).toEqual({
      kind: 'missing-queue',
      message: "Nope. Did you mean 'billing'?",
      refusal: { code: 404, text: 'NOT_FOUND' },
      suggestions: ['billing'],
    });
  });

  it('leaves out `suggestions` when there are none, and does not suggest a name of another kind', () => {
    expect('suggestions' in missingElementIssue(sample(), 'queue', 'orderz')).toBe(false);
  });
});

describe('sameValue', () => {
  it('is true for the same primitives and for data of the same shape, whatever order the keys are in', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(undefined, undefined)).toBe(true);
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue([], [])).toBe(true);
    expect(sameValue({}, {})).toBe(true);
  });

  it('is false for different primitives, and keeps 1 and 1.0 apart only through their tags, since they are one number here', () => {
    expect(sameValue(1, 2)).toBe(false);
    expect(sameValue('1', 1)).toBe(false);
    expect(sameValue(true, 1)).toBe(false);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue(0, -0)).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue({ t: 'integer', v: 1 }, { t: 'float', v: 1 })).toBe(false);
  });

  it('is false for data of another shape: a key more or fewer, an array and an object, a longer array, a missing key', () => {
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue({ 0: 1 }, [1])).toBe(false);
    expect(sameValue([1, 2], [1])).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue({ a: 1 }, null)).toBe(false);
    expect(sameValue(null, { a: 1 })).toBe(false);
    expect(sameValue({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('is false for a primitive and a container, whichever comes first, even when the container has no keys to differ by', () => {
    for (const primitive of [1, 0, 'a', '', true, false, undefined]) {
      expect(sameValue(primitive, {}), String(primitive)).toBe(false);
      expect(sameValue({}, primitive), String(primitive)).toBe(false);
      expect(sameValue(primitive, []), String(primitive)).toBe(false);
      expect(sameValue([], primitive), String(primitive)).toBe(false);
    }
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue({}, null)).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue({}, [])).toBe(false);
  });

  it('is true for a value and a copy of it, whatever it is made of, and false when one leaf differs', () => {
    const arbJson = fc.jsonValue();

    fc.assert(
      fc.property(arbJson, (value) => {
        // A structured clone, and not a JSON round trip, which writes -0 as 0, and then it is not a copy.
        expect(sameValue(value, structuredClone(value))).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 6 }), fc.nat(), (numbers, at) => {
        const other = numbers.map((n, index) => (index === at % numbers.length ? n + 1 : n));

        expect(sameValue(numbers, other)).toBe(false);
      }),
    );
  });
});

describe('keepIfSame', () => {
  it('is the value that it already had when the new one is the same data, and the new one when it is not', () => {
    const current = { a: [1, 2] };
    const same = { a: [1, 2] };
    const other = { a: [1, 3] };

    expect(keepIfSame(current, same)).toBe(current);
    expect(keepIfSame(current, other)).toBe(other);
  });
});
