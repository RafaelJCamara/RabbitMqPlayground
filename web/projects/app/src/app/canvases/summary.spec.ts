import { emptyDocument } from '@rmq/domain';
import type { CanvasRecord } from '@rmq/persistence';
import { configureFastCheck, documentOf, exchangeRecord, queueRecord, sampleDocument } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EMPTY_THUMBNAIL } from './thumbnail';
import {
  fold,
  PAGE,
  searchSummaries,
  SORTS,
  sortSummaries,
  summarise,
  type CanvasSummary,
  type SortKey,
} from './summary';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const summary = (id: string, change: Partial<CanvasSummary> = {}): CanvasSummary => ({
  id,
  name: `Canvas ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  elements: 0,
  edges: 0,
  thumbnail: EMPTY_THUMBNAIL,
  ...change,
});

const ids = (canvases: readonly CanvasSummary[]): string[] => canvases.map(({ id }) => id);

describe('summarise (ADR-0073)', () => {
  it('keeps what the home shows of a canvas, counts its elements and its edges, and draws its thumbnail, and keeps no document', () => {
    const record: CanvasRecord = { id: 'a', name: 'Orders', createdAt: 11, updatedAt: 22, document: sampleDocument() };

    const made = summarise(record);

    expect(made).toMatchObject({ id: 'a', name: 'Orders', createdAt: 11, updatedAt: 22, elements: 7, edges: 5 });
    expect(made.thumbnail.nodes).toHaveLength(7);
    expect(Object.keys(made).sort()).toEqual([
      'createdAt',
      'edges',
      'elements',
      'id',
      'name',
      'thumbnail',
      'updatedAt',
    ]);
  });

  it('counts a canvas with nothing on it as none, and draws nothing', () => {
    const made = summarise({ id: 'a', name: 'Empty', createdAt: 1, updatedAt: 1, document: emptyDocument() });

    expect(made).toMatchObject({ elements: 0, edges: 0, thumbnail: EMPTY_THUMBNAIL });
  });

  it('counts the elements of every kind', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('a'), Q2: queueRecord('b') },
    });

    expect(summarise({ id: 'a', name: 'n', createdAt: 1, updatedAt: 1, document })).toMatchObject({ elements: 3 });
  });
});

describe('sortSummaries (ADR-0073)', () => {
  const canvases = [
    summary('a', { name: 'banana', createdAt: 30, updatedAt: 300, elements: 5 }),
    summary('b', { name: 'Apple', createdAt: 10, updatedAt: 100, elements: 9 }),
    summary('c', { name: 'cherry', createdAt: 20, updatedAt: 200, elements: 1 }),
  ];

  it('puts the most recently edited first, by default', () => {
    expect(ids(sortSummaries(canvases, 'edited'))).toEqual(['a', 'c', 'b']);
  });

  it('puts the most recently made first, for created', () => {
    expect(ids(sortSummaries(canvases, 'created'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortSummaries([...canvases].reverse(), 'created'))).toEqual(['a', 'c', 'b']);
  });

  it('puts the names in order, whatever their case, for name', () => {
    expect(ids(sortSummaries(canvases, 'name'))).toEqual(['b', 'a', 'c']);
  });

  it('puts the biggest first, for size', () => {
    expect(ids(sortSummaries(canvases, 'size'))).toEqual(['b', 'a', 'c']);
  });

  it('puts numbers in the order of their value and not of their digits', () => {
    const numbered = ['Canvas 10', 'Canvas 2', 'Canvas 1'].map((name, index) => summary(`n${index}`, { name }));

    expect(sortSummaries(numbered, 'name').map(({ name }) => name)).toEqual(['Canvas 1', 'Canvas 2', 'Canvas 10']);
  });

  it('does not let the accent or the case of a letter decide', () => {
    const names = ['zebra', 'Écureuil', 'ecureuil 2', 'Apple'].map((name, index) => summary(`n${index}`, { name }));

    expect(sortSummaries(names, 'name').map(({ name }) => name)).toEqual(['Apple', 'Écureuil', 'ecureuil 2', 'zebra']);
  });

  it('breaks a tie by the name and then by the id', () => {
    const tied = [
      summary('z', { name: 'Same', updatedAt: 5 }),
      summary('y', { name: 'Same', updatedAt: 5 }),
      summary('x', { name: 'Other', updatedAt: 5 }),
    ];

    expect(ids(sortSummaries(tied, 'edited'))).toEqual(['x', 'y', 'z']);
    expect(ids(sortSummaries(tied, 'created'))).toEqual(['x', 'y', 'z']);
    expect(ids(sortSummaries(tied, 'size'))).toEqual(['x', 'y', 'z']);
  });

  it('breaks a tie of names by the id, and leaves a name apart from the same name in another case', () => {
    const tied = [summary('b', { name: 'Same' }), summary('a', { name: 'same' })];

    expect(ids(sortSummaries(tied, 'name'))).toEqual(['a', 'b']);
  });

  it('does not change the list that it is given', () => {
    const before = [...canvases];

    sortSummaries(canvases, 'name');

    expect(canvases).toEqual(before);
  });

  it('has four ways to sort, and the first is the default', () => {
    expect(SORTS.map(({ key }) => key)).toEqual(['edited', 'created', 'name', 'size']);
    expect(SORTS.map(({ label }) => label)).toEqual(['Last edited', 'Created', 'Name', 'Size']);
  });

  describe('for any canvases', () => {
    const arbSummaries = fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 12 }).chain((numbers) =>
      fc.tuple(
        ...numbers.map((number) =>
          fc
            .record({
              name: fc.constantFrom('Apple', 'apple', 'Banana', 'Canvas 2', 'Canvas 10', 'Écu', 'ecu'),
              createdAt: fc.integer({ min: 0, max: 3 }),
              updatedAt: fc.integer({ min: 0, max: 3 }),
              elements: fc.integer({ min: 0, max: 3 }),
            })
            .map((parts) => summary(`id${number}`, parts)),
        ),
      ),
    );
    const arbKey = fc.constantFrom<SortKey>('edited', 'created', 'name', 'size');

    it('is the same list in the same order, whatever order they came in', () => {
      fc.assert(
        fc.property(arbSummaries, arbKey, fc.integer(), (canvases, key, shuffle) => {
          const shuffled = [...canvases].sort(
            (a, b) => ((a.id.length * shuffle) % 7) - ((b.id.length * shuffle) % 7) || (a.id < b.id ? 1 : -1),
          );

          expect(ids(sortSummaries(shuffled, key))).toEqual(ids(sortSummaries(canvases, key)));
        }),
      );
    });

    it('has every canvas once, and sorting it again changes nothing', () => {
      fc.assert(
        fc.property(arbSummaries, arbKey, (canvases, key) => {
          const sorted = sortSummaries(canvases, key);

          expect(ids(sorted).sort()).toEqual(ids(canvases).sort());
          expect(ids(sortSummaries(sorted, key))).toEqual(ids(sorted));
        }),
      );
    });
  });
});

describe('searchSummaries (ADR-0073)', () => {
  const canvases = [
    summary('a', { name: 'Orders flow' }),
    summary('b', { name: 'Café société' }),
    summary('c', { name: 'Fan-out' }),
    summary('d', { name: 'orders' }),
  ];

  it('is every canvas for a text that is empty or only white space', () => {
    expect(searchSummaries(canvases, '')).toBe(canvases);
    expect(searchSummaries(canvases, '   ')).toBe(canvases);
  });

  it('is the canvases that have the text anywhere in their names, and the order that they came in', () => {
    expect(ids(searchSummaries(canvases, 'ord'))).toEqual(['a', 'd']);
    expect(ids(searchSummaries(canvases, 'flow'))).toEqual(['a']);
    expect(ids(searchSummaries(canvases, '-out'))).toEqual(['c']);
  });

  it('does not mind the case or the accents of the letters, in the name or in the text', () => {
    expect(ids(searchSummaries(canvases, 'CAFE'))).toEqual(['b']);
    expect(ids(searchSummaries(canvases, 'société'))).toEqual(['b']);
    expect(ids(searchSummaries(canvases, 'societe'))).toEqual(['b']);
    expect(ids(searchSummaries(canvases, 'ORDERS'))).toEqual(['a', 'd']);
  });

  it('does not mind white space around the text', () => {
    expect(ids(searchSummaries(canvases, '  fan  '))).toEqual(['c']);
  });

  it('is none when no name has the text', () => {
    expect(searchSummaries(canvases, 'xyz')).toEqual([]);
  });

  it('finds a canvas by its whole name, for any name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((name) => name.trim() !== ''),
        (name) => {
          const found = searchSummaries([summary('a', { name })], name);

          expect(ids(found)).toEqual(['a']);
        },
      ),
    );
  });
});

describe('fold and the page', () => {
  it('takes the accents and the capitals off a text', () => {
    expect(fold('Crème BRÛLÉE')).toBe('creme brulee');
    expect(fold('abc')).toBe('abc');
  });

  it('is 48 cards at a time', () => {
    expect(PAGE).toBe(48);
  });
});
