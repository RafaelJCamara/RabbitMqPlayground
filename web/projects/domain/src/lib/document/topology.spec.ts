import { route } from '@rmq/engine';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  int,
  message,
  producerRecord,
  queueRecord,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { edgeKey, edgeKeys, toTopology } from './topology';

describe('toTopology', () => {
  const document = deepFreeze(
    documentOf({
      vhost: 'prod',
      exchanges: {
        e2: exchangeRecord('second', 'topic'),
        e1: exchangeRecord('first', 'headers', { internal: true }),
        e3: exchangeRecord('shared', 'fanout'),
      },
      queues: { q9: queueRecord('last'), q1: queueRecord('shared'), q5: queueRecord('mid', { durable: true }) },
      bindings: {
        b2: bindingRecord('e2', { kind: 'queue', id: 'q9' }, 'a.#'),
        b1: bindingRecord(
          'e1',
          { kind: 'exchange', id: 'e3' },
          '',
          headerArguments('any', entry('n', int(1)), entry('s', str('x'))),
        ),
        b3: bindingRecord('e3', { kind: 'queue', id: 'q1' }),
        b4: bindingRecord('e3', { kind: 'exchange', id: 'e3' }, 'self'),
      },
    }),
  );

  it('is what the engine routes: the names, the types, the internal flags and the vhost', () => {
    const topology = toTopology(document);

    expect(topology.vhost).toBe('prod');
    expect(topology.exchanges).toEqual([
      { name: 'second', type: 'topic', internal: false },
      { name: 'first', type: 'headers', internal: true },
      { name: 'shared', type: 'fanout', internal: false },
    ]);
    expect(topology.queues).toEqual(['last', 'shared', 'mid']);
  });

  it('turns each binding’s ids into names, and keeps the bindings in the order they were made', () => {
    expect(toTopology(document).bindings).toEqual([
      { source: 'second', destination: { kind: 'queue', name: 'last' }, key: 'a.#' },
      {
        source: 'first',
        destination: { kind: 'exchange', name: 'shared' },
        key: '',
        headers: headerArguments('any', entry('n', int(1)), entry('s', str('x'))),
      },
      { source: 'shared', destination: { kind: 'queue', name: 'shared' }, key: '' },
      { source: 'shared', destination: { kind: 'exchange', name: 'shared' }, key: 'self' },
    ]);
  });

  it('tells the queue and the exchange that share a name apart, by the kind of the destination', () => {
    const [, , toQueue, toExchange] = toTopology(document).bindings;

    expect(toQueue?.destination).toEqual({ kind: 'queue', name: 'shared' });
    expect(toExchange?.destination).toEqual({ kind: 'exchange', name: 'shared' });
  });

  it('gives a binding without arguments no `headers` field', () => {
    expect('headers' in (toTopology(document).bindings[0] as object)).toBe(false);
  });

  it('leaves out a binding that names something that is not on the canvas, which a valid document has none of', () => {
    const broken = documentOf({
      exchanges: { e1: exchangeRecord('a') },
      queues: { q1: queueRecord('q') },
      bindings: {
        ok: bindingRecord('e1', { kind: 'queue', id: 'q1' }),
        noSource: bindingRecord('gone', { kind: 'queue', id: 'q1' }),
        noQueue: bindingRecord('e1', { kind: 'queue', id: 'gone' }),
        noExchange: bindingRecord('e1', { kind: 'exchange', id: 'gone' }),
        wrongKind: bindingRecord('e1', { kind: 'exchange', id: 'q1' }),
        inherited: bindingRecord('e1', { kind: 'queue', id: 'constructor' }),
      },
    });

    expect(toTopology(broken).bindings).toHaveLength(1);
  });

  it('is empty for an empty canvas, with the vhost /', () => {
    expect(toTopology(documentOf())).toEqual({ vhost: '/', exchanges: [], queues: [], bindings: [] });
  });

  it('can be routed through, and routes as the canvas says', () => {
    const result = route(toTopology(document), message('second', 'a.b.c'));

    expect(result).toMatchObject({ ok: true, queues: ['last'] });
    expect(route(toTopology(document), message('first'))).toMatchObject({ ok: false, code: 403 });
  });
});

describe('edgeKey and edgeKeys', () => {
  it('name an edge by the id that it starts from and the id that it ends at', () => {
    expect(edgeKey('ex1', 'q1')).toBe('ex1>q1');
  });

  it('have an edge for each of the three ways to link: a binding, a producer’s link and a subscription', () => {
    const document = documentOf({
      exchanges: { e1: exchangeRecord('a'), e2: exchangeRecord('b') },
      queues: { q1: queueRecord('q'), q2: queueRecord('r') },
      bindings: {
        b1: bindingRecord('e1', { kind: 'queue', id: 'q1' }),
        b2: bindingRecord('e1', { kind: 'exchange', id: 'e2' }),
      },
      producers: {
        p1: producerRecord('x', { kind: 'exchange', id: 'e1' }),
        p2: producerRecord('y', { kind: 'queue', id: 'q2' }),
        p3: producerRecord('z', null),
      },
      consumers: { c1: consumerRecord('w', ['q1', 'q2']), c2: consumerRecord('v') },
    });

    expect([...edgeKeys(document)].sort()).toEqual(['e1>e2', 'e1>q1', 'p1>e1', 'p2>q2', 'q1>c1', 'q2>c1']);
  });

  it('count several bindings between the same two elements as one edge, which is how they are drawn', () => {
    const document = documentOf({
      exchanges: { e1: exchangeRecord('a') },
      queues: { q1: queueRecord('q') },
      bindings: {
        b1: bindingRecord('e1', { kind: 'queue', id: 'q1' }, 'one'),
        b2: bindingRecord('e1', { kind: 'queue', id: 'q1' }, 'two'),
      },
    });

    expect([...edgeKeys(document)]).toEqual(['e1>q1']);
  });

  it('are none for a canvas with no links', () => {
    expect(edgeKeys(documentOf()).size).toBe(0);
  });
});
