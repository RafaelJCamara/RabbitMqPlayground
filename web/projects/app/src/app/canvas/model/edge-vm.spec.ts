import { edgeKey, type CanvasDocument } from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';
import {
  bindingRecord,
  bool,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  exists,
  float,
  headerArguments,
  int,
  producerRecord,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { buildCanvasVm } from './canvas-vm';
import {
  DEFAULT_EXCHANGE_ID,
  defaultExchangePosition,
  implicitEdgeId,
  isVirtual,
} from '../../core/state/default-exchange';
import {
  CHIP_SEPARATOR,
  chipsOf,
  isConditionsChip,
  MAX_CHIPS,
  MAX_CONDITIONS,
  nodeLabel,
  splitChips,
  type ChipText,
} from './labels';

const frozen = (document: CanvasDocument): CanvasDocument => deepFreeze(document);
const shorts = (chips: readonly ChipText[]): string[] => chips.map(({ short }) => short);
const edgeOf = (document: CanvasDocument, id: string) => buildCanvasVm(document).edges.find((edge) => edge.id === id);

describe('the chips of an edge (ADR-0044)', () => {
  const keyed = (type: 'direct' | 'topic' | 'fanout' | 'headers', keys: readonly string[]) =>
    frozen(
      documentOf({
        exchanges: { x: exchangeRecord('orders', type) },
        queues: { q: queueRecord('billing') },
        bindings: Object.fromEntries(
          keys.map((key, index) => [`b${index}`, bindingRecord('x', { kind: 'queue', id: 'q' }, key)]),
        ),
      }),
    );

  it('are the key of each binding, in the order that the bindings were made', () => {
    expect(edgeOf(keyed('topic', ['order.*', 'invoice.#']), 'x>q')).toMatchObject({
      chips: ['order.*', 'invoice.#'],
      more: [],
    });
  });

  it('are the same text once, however many bindings say it', () => {
    expect(edgeOf(keyed('direct', ['a', 'b', 'a']), 'x>q')?.chips).toEqual(['a', 'b']);
  });

  it('say "(empty key)" for an empty key that matters, which is one of a direct or a topic exchange', () => {
    expect(edgeOf(keyed('direct', ['']), 'x>q')?.chips).toEqual(['(empty key)']);
    expect(edgeOf(keyed('topic', ['', 'a']), 'x>q')?.chips).toEqual(['(empty key)', 'a']);
  });

  it('say nothing for the empty key of an exchange that ignores it, a fanout or a headers exchange', () => {
    expect(edgeOf(keyed('fanout', ['']), 'x>q')?.chips).toEqual([]);
    expect(edgeOf(keyed('headers', ['']), 'x>q')?.chips).toEqual([]);
  });

  it('say a key that an exchange ignores all the same, because the learner wrote it', () => {
    expect(edgeOf(keyed('fanout', ['ignored']), 'x>q')?.chips).toEqual(['ignored']);
  });

  it('say "headers" once for bindings that have header arguments', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive') },
        bindings: {
          b1: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('any', entry('format', str('pdf')))),
          b2: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('all', entry('size', str('a4')))),
        },
      }),
    );

    expect(edgeOf(document, 'x>q')?.chips).toEqual(['headers']);
  });

  it('show three at most, and say how many more there are, and which', () => {
    const edge = edgeOf(keyed('topic', ['a', 'b', 'c', 'd', 'e']), 'x>q');

    expect(MAX_CHIPS).toBe(3);
    expect(edge?.chips).toEqual(['a', 'b', 'c']);
    expect(edge?.more).toEqual(['d', 'e']);
  });

  it('show all of four, with no "+1 more" for a single chip more than fits, as long as there are three or fewer', () => {
    expect(edgeOf(keyed('topic', ['a', 'b', 'c']), 'x>q')).toMatchObject({ chips: ['a', 'b', 'c'], more: [] });
    expect(splitChips(['a', 'b', 'c', 'd'].map((text) => ({ short: text, full: text })))).toEqual({
      chips: ['a', 'b', 'c'],
      more: ['d'],
      cards: ['a', 'b', 'c', 'd'],
      cut: false,
    });
  });

  it('are none for the link of a producer to an exchange, and for a subscription', () => {
    const { edges } = buildCanvasVm(frozen(sampleDocument()));

    expect(edges.find(({ kind }) => kind === 'link')?.chips).toEqual([]);
    expect(edges.find(({ kind }) => kind === 'subscription')?.chips).toEqual([]);
  });

  it('say "default exchange" for the link of a producer to a queue', () => {
    const document = frozen(
      documentOf({
        queues: { q: queueRecord('billing') },
        producers: { p: producerRecord('s', { kind: 'queue', id: 'q' }) },
      }),
    );

    expect(edgeOf(document, 'p>q')?.chips).toEqual(['default exchange']);
  });

  describe('chipsOf and splitChips', () => {
    it('take the keys of the bindings between two ends, and the type of the exchange that they leave from', () => {
      expect(shorts(chipsOf('direct', [{ key: 'a', hasArguments: false }]))).toEqual(['a']);
      expect(shorts(chipsOf('direct', [{ key: '', hasArguments: false }]))).toEqual(['(empty key)']);
      expect(shorts(chipsOf('headers', [{ key: '', hasArguments: true }]))).toEqual(['headers']);
      expect(chipsOf('topic', [])).toEqual([]);
    });

    it('put a "headers" chip after the keys, because it is about every binding that has arguments', () => {
      expect(
        shorts(
          chipsOf('headers', [
            { key: 'k', hasArguments: false },
            { key: '', hasArguments: true },
          ]),
        ),
      ).toEqual(['k', 'headers']);
    });

    it('split a short list into all chips and none more', () => {
      expect(splitChips([])).toEqual({ chips: [], more: [], cards: [], cut: false });
      expect(splitChips([{ short: 'a', full: 'a' }])).toEqual({ chips: ['a'], more: [], cards: ['a'], cut: false });
    });
  });
});

describe('where the document keeps a label', () => {
  it('is on the edge, as the place along it, and the edge has none when the document has none', () => {
    const document = frozen(sampleDocument());

    expect(edgeOf(document, 'E1>Q1')?.labelAt).toBe(0.5);
    expect(edgeOf(document, 'E1>E3')?.labelAt).toBeUndefined();
  });
});

describe('the lints on the canvas (ADR-0044)', () => {
  it('are a warning on an exchange that nothing is bound from, with the sentence of the lint', () => {
    const document = frozen(documentOf({ exchanges: { x: exchangeRecord('lonely') } }));
    const [node] = buildCanvasVm(document).nodes;

    expect(node?.warnings).toHaveLength(1);
    expect(node?.warnings[0]).toContain("Nothing is bound from the exchange 'lonely'");
    expect(node?.label).toBe('Exchange lonely, direct, 1 warning');
  });

  it('are none for an exchange that has a binding, and none for any other kind of node', () => {
    const { nodes } = buildCanvasVm(frozen(sampleDocument()));

    expect(nodes.find(({ name }) => name === 'orders')?.warnings).toEqual([]);
    expect(nodes.find(({ name }) => name === 'orders')?.label).toBe('Exchange orders, topic');
    expect(nodes.filter(({ kind }) => kind !== 'exchange').every(({ warnings }) => warnings.length === 0)).toBe(true);
  });

  it('are a warning on the edge of a binding that matches nothing, which is x-match=any with no condition that counts', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive') },
        bindings: { b: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('any')) },
      }),
    );

    const edge = edgeOf(document, 'x>q');
    expect(edge?.warnings).toHaveLength(1);
    expect(edge?.warnings[0]).toContain('x-match=any');
  });

  it('say how many warnings a node has in the words that a screen reader reads', () => {
    expect(nodeLabel('exchange', 'orders', 'topic', 0)).toBe('Exchange orders, topic');
    expect(nodeLabel('exchange', 'orders', 'topic', 1)).toBe('Exchange orders, topic, 1 warning');
    expect(nodeLabel('exchange', 'orders', 'topic', 2)).toBe('Exchange orders, topic, 2 warnings');
    expect(nodeLabel('queue', 'billing')).toBe('Queue billing');
  });
});

describe('the default exchange (ADR-0043)', () => {
  const shown = (document: CanvasDocument): CanvasDocument =>
    frozen({ ...document, settings: { ...document.settings, showDefaultExchange: true } });
  const withQueues = frozen(
    documentOf({
      exchanges: { x: exchangeRecord('orders') },
      queues: { q1: queueRecord('billing'), q2: queueRecord('archive') },
      producers: {
        p1: producerRecord('sender', { kind: 'queue', id: 'q1' }),
        p2: producerRecord('other', { kind: 'exchange', id: 'x' }),
      },
    }),
  );

  it('is not drawn while the setting is off, and a link to a queue is one edge between the two', () => {
    const { nodes, edges } = buildCanvasVm(withQueues);

    expect(nodes.some(({ id }) => isVirtual(id))).toBe(false);
    expect(edges.map(({ id, source, target }) => [id, source, target])).toContainEqual(['p1>q1', 'p1', 'q1']);
  });

  it('is drawn when the setting is on: a node that the document does not have, with its own words', () => {
    const { nodes } = buildCanvasVm(shown(withQueues));
    const node = nodes.find(({ id }) => id === DEFAULT_EXCHANGE_ID);

    expect(node).toMatchObject({
      id: '~default',
      kind: 'exchange',
      name: '(default)',
      caption: 'default exchange',
      label: 'Default exchange',
      virtual: true,
      hasInput: true,
      hasOutput: true,
      warnings: [],
    });
    expect(node?.exchangeType).toBeUndefined();
  });

  it('is in the column of the exchanges, a row above the highest of them, so that a new node never lands on it', () => {
    const document = frozen(
      documentOf({ exchanges: { x: exchangeRecord('orders') }, nodes: { x: { x: 320, y: 40 } } }),
    );

    expect(defaultExchangePosition(document)).toEqual({ x: 320, y: -80 });
    expect(defaultExchangePosition(frozen(documentOf()))).toEqual({ x: 320, y: -120 });
    expect(
      defaultExchangePosition(
        frozen(documentOf({ exchanges: { x: exchangeRecord('a') }, nodes: { x: { x: 0, y: -500 } } })),
      ),
    ).toEqual({
      x: 320,
      y: -620,
    });
  });

  it('has an implicit edge to every queue, with the name of the queue as its key', () => {
    const { edges } = buildCanvasVm(shown(withQueues));
    const implicit = edges.filter(({ kind }) => kind === 'implicit');

    expect(implicit.map(({ id, source, target, chips }) => [id, source, target, chips])).toEqual([
      ['~default>q1', '~default', 'q1', ['billing']],
      ['~default>q2', '~default', 'q2', ['archive']],
    ]);
    expect(implicitEdgeId('q1')).toBe(edgeKey(DEFAULT_EXCHANGE_ID, 'q1'));
    expect(implicit[0]?.label).toBe('Implicit binding from the default exchange to queue billing, key billing');
    expect(implicit[0]?.labelAt).toBeUndefined();
  });

  it('draws the link of a producer to a queue to the default exchange, under the key that it always had', () => {
    const { edges } = buildCanvasVm(shown(withQueues));
    const link = edges.find(({ id }) => id === 'p1>q1');

    expect(link).toMatchObject({ kind: 'link', source: 'p1', target: '~default', chips: ['billing'] });
    expect(link?.label).toBe('Producer sender publishes to queue billing, through the default exchange');
    // A link to an exchange is not touched by it.
    expect(edges.find(({ id }) => id === 'p2>x')).toMatchObject({ source: 'p2', target: 'x', chips: [] });
  });

  it('has no implicit edge when there is no queue, and still has the node', () => {
    const { nodes, edges } = buildCanvasVm(shown(frozen(documentOf())));

    expect(nodes.map(({ id }) => id)).toEqual(['~default']);
    expect(edges).toEqual([]);
  });

  it('is never an id that a document can have, so that nothing can be taken for it', () => {
    const pattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

    expect(pattern.test(DEFAULT_EXCHANGE_ID)).toBe(false);
    expect(pattern.test(implicitEdgeId('q1'))).toBe(false);
    expect(isVirtual(DEFAULT_EXCHANGE_ID)).toBe(true);
    expect(isVirtual(implicitEdgeId('q1'))).toBe(true);
    expect(isVirtual('q1')).toBe(false);
    expect(isVirtual('p1>q1')).toBe(false);
  });

  it('keeps every node and edge that did not change when the setting changes, and is the same view model when it does not', () => {
    const before = buildCanvasVm(frozen(withQueues));
    const after = buildCanvasVm(shown(withQueues), before);

    expect(
      after.nodes.filter(({ virtual }) => virtual !== true).every((node, index) => node === before.nodes[index]),
    ).toBe(true);
    expect(buildCanvasVm(shown(withQueues), after)).toBe(after);
  });
});

describe('the chips of a headers binding, with the conditions (ADR-0070)', () => {
  const OPTIONS = { conditions: true };
  /** A headers exchange `docs` bound to a queue `archive` by bindings with these arguments, and the edge between them. */
  const edgeWith = (...headers: (HeaderArguments | undefined)[]) =>
    buildCanvasVm(
      frozen(
        documentOf({
          exchanges: { x: exchangeRecord('docs', 'headers') },
          queues: { q: queueRecord('archive') },
          bindings: Object.fromEntries(
            headers.map((arguments_, index) => [
              `b${index}`,
              bindingRecord('x', { kind: 'queue', id: 'q' }, '', arguments_),
            ]),
          ),
        }),
      ),
      undefined,
      OPTIONS,
    ).edges.find(({ id }) => id === 'x>q');

  it.each<[string, HeaderArguments | undefined, string]>([
    [
      'the mode and the conditions',
      headerArguments('all', entry('format', str('pdf')), entry('n', int(1))),
      'all · format=pdf · n=1',
    ],
    [
      'a string that looks like a number, a float and exists, each as the grammar writes it',
      headerArguments('any', entry('s', str('1')), entry('f', float(1)), entry('g', exists)),
      'any · s="1" · f=1.0 · exists(g)',
    ],
    ['a boolean', headerArguments('all', entry('ok', bool(true))), 'all · ok=true'],
    [
      'a mode that was left out, which is all',
      headerArguments(null, entry('x-foo', int(1))),
      'all · x-foo=1 (ignored)',
    ],
    [
      'an x- condition that the mode counts',
      headerArguments('all-with-x', entry('x-foo', int(1))),
      'all-with-x · x-foo=1',
    ],
    [
      'an x- condition of any, which is not counted',
      headerArguments('any', entry('x-a', str('b'))),
      'any · x-a=b (ignored)',
    ],
    ['a name that has to be quoted', headerArguments('all', entry('my key', str('a b'))), 'all · "my key"="a b"'],
    ['a header called like an option of bind', headerArguments('all', entry('key', int(2))), 'all · "key"=2'],
    ['no conditions', headerArguments('all'), 'all · no conditions'],
    ['no arguments at all', undefined, 'all · no conditions'],
    ['any with no conditions', headerArguments('any'), 'any · no conditions'],
  ])('is %s: %s', (_what, headers, chip) => {
    expect(edgeWith(headers)?.chips).toEqual([chip]);
  });

  it('names three conditions at most and says how many more there are inside the chip, with the whole in the card', () => {
    const edge = edgeWith(
      headerArguments('all', ...['a', 'b', 'c', 'd', 'e'].map((key, index) => entry(key, int(index + 1)))),
    );

    expect(MAX_CONDITIONS).toBe(3);
    expect(edge?.chips).toEqual(['all · a=1 · b=2 · c=3 · +2 more']);
    expect(edge?.more).toEqual([]);
    expect(edge?.cards).toEqual(['all · a=1 · b=2 · c=3 · d=4 · e=5']);
    expect(edge?.cut).toBe(true);
  });

  it('names three conditions without a count, and the card is the chip, so nothing is cut', () => {
    const edge = edgeWith(headerArguments('all', entry('a', int(1)), entry('b', int(2)), entry('c', int(3))));

    expect(edge?.chips).toEqual(['all · a=1 · b=2 · c=3']);
    expect(edge?.cards).toEqual(['all · a=1 · b=2 · c=3']);
    expect(edge?.cut).toBe(false);
  });

  it('is one chip for each binding between the same two ends, in the order they were made, and the same text once', () => {
    const edge = edgeWith(
      headerArguments('all', entry('a', int(1))),
      headerArguments('any', entry('b', int(2))),
      headerArguments('all', entry('a', int(1))),
      headerArguments('all-with-x', entry('c', int(3))),
      headerArguments('all', entry('d', int(4))),
    );

    expect(edge?.chips).toEqual(['all · a=1', 'any · b=2', 'all-with-x · c=3']);
    expect(edge?.more).toEqual(['all · d=4']);
  });

  it('puts the chip of the conditions after the key of the binding, for a key that a headers exchange ignores and the learner wrote', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive') },
        bindings: {
          b: bindingRecord('x', { kind: 'queue', id: 'q' }, 'order.*', headerArguments('all', entry('a', int(1)))),
        },
      }),
    );

    expect(buildCanvasVm(document, undefined, OPTIONS).edges[0]?.chips).toEqual(['order.*', 'all · a=1']);
  });

  it('is the old chip, "headers" once, without the flag, and none for a headers binding that has no arguments', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive'), r: queueRecord('rest') },
        bindings: {
          a: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('any', entry('format', str('pdf')))),
          b: bindingRecord('x', { kind: 'queue', id: 'r' }),
        },
      }),
    );

    const { edges } = buildCanvasVm(document);

    expect(edges.find(({ id }) => id === 'x>q')?.chips).toEqual(['headers']);
    expect(edges.find(({ id }) => id === 'x>r')?.chips).toEqual([]);
    expect(edges.every(({ cut }) => !cut)).toBe(true);
    expect(buildCanvasVm(document, undefined, OPTIONS).edges.find(({ id }) => id === 'x>r')?.chips).toEqual([
      'all · no conditions',
    ]);
  });

  it('is the chip "headers" for arguments that an exchange which is not a headers exchange ignores, flag or no flag', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('orders', 'direct') },
        queues: { q: queueRecord('archive') },
        bindings: {
          b: bindingRecord('x', { kind: 'queue', id: 'q' }, 'k', headerArguments('all', entry('a', int(1)))),
        },
      }),
    );

    expect(buildCanvasVm(document, undefined, OPTIONS).edges[0]?.chips).toEqual(['k', 'headers']);
  });

  it('says the conditions of every binding in the label of the edge, which is what a screen reader reads of it', () => {
    const edge = edgeWith(
      headerArguments('all', entry('format', str('pdf')), entry('n', int(1))),
      headerArguments('any', entry('s', str('1')), entry('x-a', int(1))),
      headerArguments('all'),
    );

    expect(edge?.label).toBe(
      'Binding from exchange docs to queue archive, x-match all: format=pdf, n=1; x-match any: s="1", x-a=1 (ignored); x-match all, no conditions',
    );
  });

  it('says in the label a mode that was left out as all', () => {
    expect(edgeWith(headerArguments(null, entry('a', int(1))))?.label).toBe(
      'Binding from exchange docs to queue archive, x-match all: a=1',
    );
  });

  it('says only that there are header arguments in the label without the flag', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive') },
        bindings: { b: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('all', entry('a', int(1)))) },
      }),
    );

    expect(buildCanvasVm(document).edges[0]?.label).toBe(
      'Binding from exchange docs to queue archive, with header arguments',
    );
  });

  it('is told from a chip of a key by its separator, which a conditions chip has and is wider for', () => {
    expect(isConditionsChip('all · a=1')).toBe(true);
    expect(isConditionsChip('order.*')).toBe(false);
    expect(isConditionsChip('(empty key)')).toBe(false);
    expect(CHIP_SEPARATOR).toBe(' · ');
  });

  it('keeps the same object for an edge that did not change, as the other edges do', () => {
    const document = frozen(
      documentOf({
        exchanges: { x: exchangeRecord('docs', 'headers') },
        queues: { q: queueRecord('archive') },
        bindings: { b: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('all', entry('a', int(1)))) },
      }),
    );
    const first = buildCanvasVm(document, undefined, OPTIONS);

    expect(buildCanvasVm(document, first, OPTIONS)).toBe(first);
  });
});
