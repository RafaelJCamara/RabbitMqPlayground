import { sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { checkCaps, checkName, SIZE_CAPS } from './caps';

/**
 * The caps are about how much a document holds, and are checked on data that nothing has vouched for yet (ADR-0027), so these
 * specs build the data by hand, and most of what they put in is not a valid record: a cap counts, and does not read.
 */

type Raw = Record<string, unknown>;

const sample = (): Raw => JSON.parse(JSON.stringify(sampleDocument())) as Raw;

/** `count` entries with ids `<prefix>0`, `<prefix>1`, …, each the value that is given. */
const many = (prefix: string, count: number, value: unknown = {}): Raw =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}${index}`, value]));

const found = (raw: unknown) => {
  const error = checkCaps(raw as Raw);
  return error === null ? null : error.kind === 'too-large' ? [error.what, error.found, error.limit] : error;
};

describe('the caps', () => {
  it('sit well above what the plan runs: 200 nodes and 500 edges', () => {
    expect(SIZE_CAPS.elements).toBeGreaterThanOrEqual(10 * 200);
    expect(SIZE_CAPS.edges).toBeGreaterThanOrEqual(10 * 500);
  });

  it('are the numbers of ADR-0027', () => {
    expect(SIZE_CAPS).toEqual({
      elements: 2_000,
      edges: 5_000,
      headers: 100,
      text: 10_000,
      file: 50_000_000,
      canvases: 1_000,
      name: 200,
    });
  });
});

describe('checkCaps', () => {
  it('finds nothing wrong with a canvas that has a little of everything, or with one that has nothing', () => {
    expect(checkCaps(sample())).toBeNull();
    expect(checkCaps({})).toBeNull();
  });

  describe('elements', () => {
    it('are the exchanges, the queues, the producers and the consumers together', () => {
      const at = SIZE_CAPS.elements;

      expect(found({ exchanges: many('e', at) })).toBeNull();
      expect(found({ exchanges: many('e', at + 1) })).toEqual(['elements', at + 1, at]);
      expect(found({ queues: many('q', at + 1) })).toEqual(['elements', at + 1, at]);
      expect(found({ producers: many('p', at + 1) })).toEqual(['elements', at + 1, at]);
      expect(found({ consumers: many('c', at + 1) })).toEqual(['elements', at + 1, at]);
      expect(
        found({
          exchanges: many('e', 500),
          queues: many('q', 500),
          producers: many('p', 500),
          consumers: many('c', 500),
        }),
      ).toBeNull();
      expect(
        found({
          exchanges: many('e', 500),
          queues: many('q', 500),
          producers: many('p', 500),
          consumers: many('c', 501),
        }),
      ).toEqual(['elements', 2001, at]);
    });
  });

  describe('edges', () => {
    const at = SIZE_CAPS.edges;

    it('are the bindings', () => {
      expect(found({ bindings: many('b', at) })).toBeNull();
      expect(found({ bindings: many('b', at + 1) })).toEqual(['edges', at + 1, at]);
    });

    it('are the links of the producers that publish somewhere', () => {
      const linked = { target: { kind: 'exchange', id: 'e1' } };
      const loose = { target: null };

      expect(found({ bindings: many('b', at - 1), producers: { p1: linked } })).toBeNull();
      expect(found({ bindings: many('b', at - 1), producers: { p1: linked, p2: linked } })).toEqual([
        'edges',
        at + 1,
        at,
      ]);
      expect(found({ bindings: many('b', at), producers: { p1: loose, p2: {}, p3: 'x', p4: null } })).toBeNull();
    });

    it('are the queues that the consumers read from', () => {
      expect(found({ bindings: many('b', at - 3), consumers: { c1: { queues: ['a', 'b', 'c'] } } })).toBeNull();
      expect(
        found({ bindings: many('b', at - 3), consumers: { c1: { queues: ['a', 'b'] }, c2: { queues: ['c', 'd'] } } }),
      ).toEqual(['edges', at + 1, at]);
      expect(found({ consumers: { c1: { queues: Array.from({ length: at + 1 }, () => 'q') } } })).toEqual([
        'edges',
        at + 1,
        at,
      ]);
      expect(found({ consumers: { c1: { queues: 'not a list' }, c2: null, c3: {} } })).toBeNull();
    });

    it('are not counted for a consumer that reads from no queue, even when the canvas is at the cap', () => {
      const consumers = { c1: {}, c2: { queues: 'x' }, c3: null, c4: { queues: [] }, c5: 5 };

      expect(found({ bindings: many('b', at), consumers })).toBeNull();
    });
  });

  describe('the layout', () => {
    it('has a position for each element, and no more than the elements that a canvas can have', () => {
      const at = SIZE_CAPS.elements;

      expect(found({ layout: { nodes: many('n', at) } })).toBeNull();
      expect(found({ layout: { nodes: many('n', at + 1) } })).toEqual(['positions', at + 1, at]);
    });

    it('has a label for each edge, and no more than the edges that a canvas can have', () => {
      const at = SIZE_CAPS.edges;

      expect(found({ layout: { labels: many('l', at) } })).toBeNull();
      expect(found({ layout: { labels: many('l', at + 1) } })).toEqual(['labels', at + 1, at]);
    });

    it('is not counted when it is not what a layout is', () => {
      expect(found({ layout: null })).toBeNull();
      expect(found({ layout: 'x' })).toBeNull();
      expect(found({ layout: { nodes: 'x', labels: [] } })).toBeNull();
    });
  });

  describe('the headers of a message', () => {
    const producer = (headers: unknown, payload: unknown = 'x') => ({ p1: { message: { payload, headers } } });
    const entries = (count: number, value: unknown = { t: 'string', v: 'x' }) =>
      Array.from({ length: count }, (_, index) => ({ key: `k${index}`, value }));

    it('are at most so many on one message', () => {
      expect(found({ producers: producer(entries(SIZE_CAPS.headers)) })).toBeNull();
      expect(found({ producers: producer(entries(SIZE_CAPS.headers + 1)) })).toEqual([
        'headers',
        SIZE_CAPS.headers + 1,
        SIZE_CAPS.headers,
      ]);
    });

    it('is a payload of at most so many characters', () => {
      const at = SIZE_CAPS.text;

      expect(found({ producers: producer([], 'x'.repeat(at)) })).toBeNull();
      expect(found({ producers: producer([], 'x'.repeat(at + 1)) })).toEqual(['text', at + 1, at]);
      expect(found({ producers: producer([], 12_345) })).toBeNull();
    });

    it('are values of at most so many characters, when they are text', () => {
      const at = SIZE_CAPS.text;

      expect(found({ producers: producer(entries(1, { t: 'string', v: 'x'.repeat(at) })) })).toBeNull();
      expect(found({ producers: producer(entries(1, { t: 'string', v: 'x'.repeat(at + 1) })) })).toEqual([
        'text',
        at + 1,
        at,
      ]);
      expect(found({ producers: producer(entries(2, { t: 'integer', v: 5 })) })).toBeNull();
    });

    it('are not read when they are not what a message has', () => {
      expect(found({ producers: { p1: { message: null } } })).toBeNull();
      expect(found({ producers: { p1: { message: { headers: 'x', payload: null } } } })).toBeNull();
      expect(found({ producers: { p1: { message: { headers: [null, 5, 'x', {}, { value: null }] } } } })).toBeNull();
      expect(found({ producers: { p1: null, p2: 5 } })).toBeNull();
      for (const headers of [undefined, null, 5, {}, { length: 500 }, true]) {
        expect(found({ producers: { p1: { message: { payload: 'x', headers } } } }), String(headers)).toBeNull();
      }
    });

    it('are all looked at, the last producer as much as the first', () => {
      const fine = { message: { payload: 'x', headers: entries(2) } };
      const long = { message: { payload: 'x'.repeat(SIZE_CAPS.text + 1), headers: [] } };
      const many = { message: { payload: 'x', headers: entries(SIZE_CAPS.headers + 1) } };

      expect(found({ producers: { p1: fine, p2: long } })).toEqual(['text', SIZE_CAPS.text + 1, SIZE_CAPS.text]);
      expect(found({ producers: { p1: fine, p2: fine, p3: many } })).toEqual([
        'headers',
        SIZE_CAPS.headers + 1,
        SIZE_CAPS.headers,
      ]);
    });

    it('are all looked at, the last header as much as the first', () => {
      const text = 'x'.repeat(SIZE_CAPS.text + 1);
      const row = [
        { key: 'a', value: { t: 'string', v: 'short' } },
        { key: 'b', value: { t: 'exists' } },
        { key: 'c', value: { t: 'string', v: text } },
      ];

      expect(found({ producers: producer(row) })).toEqual(['text', SIZE_CAPS.text + 1, SIZE_CAPS.text]);
    });
  });

  describe('the arguments of a binding', () => {
    const binding = (args: unknown) => ({ b1: { headers: { xMatch: 'all', args } } });
    const entries = (count: number, value: unknown = { t: 'string', v: 'x' }) =>
      Array.from({ length: count }, (_, index) => ({ key: `k${index}`, value }));

    it('are at most so many on one binding', () => {
      expect(found({ bindings: binding(entries(SIZE_CAPS.headers)) })).toBeNull();
      expect(found({ bindings: binding(entries(SIZE_CAPS.headers + 1)) })).toEqual([
        'headers',
        SIZE_CAPS.headers + 1,
        SIZE_CAPS.headers,
      ]);
    });

    it('have values of at most so many characters, when they are text, and exists has none', () => {
      const at = SIZE_CAPS.text;

      expect(found({ bindings: binding(entries(1, { t: 'string', v: 'x'.repeat(at + 1) })) })).toEqual([
        'text',
        at + 1,
        at,
      ]);
      expect(found({ bindings: binding(entries(3, { t: 'exists' })) })).toBeNull();
    });

    it('are not read when they are not what a binding has', () => {
      expect(found({ bindings: { b1: null } })).toBeNull();
      expect(found({ bindings: { b1: { headers: null } } })).toBeNull();
      expect(found({ bindings: { b1: { headers: { args: 'x' } } } })).toBeNull();
      expect(found({ bindings: { b1: { headers: { args: [null, {}, { value: 5 }] } } } })).toBeNull();
    });

    it('are all looked at, the last binding as much as the first', () => {
      const bindings = {
        b1: { headers: { args: entries(2) } },
        b2: { headers: { args: entries(2) } },
        b3: { headers: { args: entries(SIZE_CAPS.headers + 1) } },
      };

      expect(found({ bindings })).toEqual(['headers', SIZE_CAPS.headers + 1, SIZE_CAPS.headers]);
    });
  });

  it('says the first of the caps that is passed, in the order elements, edges, positions, labels, producers, bindings', () => {
    const big = (extra: Raw): Raw => ({ ...extra });

    expect(
      found(big({ exchanges: many('e', 2001), bindings: many('b', 5001), layout: { nodes: many('n', 2001) } })),
    ).toEqual(['elements', 2001, 2000]);
    expect(found(big({ bindings: many('b', 5001), layout: { nodes: many('n', 2001) } }))).toEqual([
      'edges',
      5001,
      5000,
    ]);
    expect(found(big({ layout: { nodes: many('n', 2001), labels: many('l', 5001) } }))).toEqual([
      'positions',
      2001,
      2000,
    ]);
    expect(
      found(
        big({
          layout: { labels: many('l', 5001) },
          producers: { p1: { message: { payload: 'x'.repeat(10_001), headers: [] } } },
        }),
      ),
    ).toEqual(['labels', 5001, 5000]);
    expect(
      found(
        big({
          producers: { p1: { message: { payload: 'x'.repeat(10_001), headers: [] } } },
          bindings: {
            b1: { headers: { args: Array.from({ length: 101 }, () => ({ key: 'k', value: { t: 'exists' } })) } },
          },
        }),
      ),
    ).toEqual(['text', 10_001, 10_000]);
  });

  it('counts only what the data has of its own', () => {
    const inherited = Object.create({ a: 1, b: 2 }) as Raw;
    inherited['own'] = 1;

    expect(found({ exchanges: inherited })).toBeNull();
    expect(found({ exchanges: Object.assign(Object.create(many('x', 3000)) as Raw, { a: 1 }) })).toBeNull();
  });

  it('does not read data that is not an object, which is the loader’s to refuse', () => {
    for (const raw of [null, undefined, 'x', 5, [], () => 1]) {
      expect(checkCaps(raw as never)).toBeNull();
    }
    expect(found({ exchanges: [1, 2, 3], queues: 'x', producers: null, consumers: 7, bindings: [] })).toBeNull();
  });
});

describe('checkName', () => {
  it('accepts a name of at most so many characters, and says how many it has when it has more', () => {
    expect(checkName('x'.repeat(SIZE_CAPS.name))).toBeNull();
    expect(checkName('x'.repeat(SIZE_CAPS.name + 1))).toMatchObject({
      kind: 'too-large',
      what: 'name',
      found: SIZE_CAPS.name + 1,
      limit: SIZE_CAPS.name,
    });
  });
});
