import type { Bind } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { bindingKey, canonicalTopology } from './broker';
import {
  deepFreeze,
  entry,
  exchange,
  exists,
  headerArguments,
  int,
  str,
  toExchange,
  toQueue,
  topology,
} from './topology';

const bind = (source: string, kind: 'queue' | 'exchange', name: string, key = ''): Bind => ({
  op: 'bind',
  source,
  destination: { kind, name },
  key,
});

describe('bindingKey', () => {
  const a = headerArguments('all', entry('x', str('1')), entry('y', exists));
  const b = headerArguments('all', entry('y', exists), entry('x', str('1')));

  it('does not depend on the order of the arguments', () => {
    expect(bindingKey({ ...bind('e', 'queue', 'q'), headers: a })).toBe(
      bindingKey({ ...bind('e', 'queue', 'q'), headers: b }),
    );
  });

  it('tells apart what a broker tells apart: the mode, a value, its type and the key', () => {
    const keys = new Set([
      bindingKey({ ...bind('e', 'queue', 'q'), headers: a }),
      bindingKey({ ...bind('e', 'queue', 'q'), headers: { ...a, xMatch: 'any' } }),
      bindingKey({
        ...bind('e', 'queue', 'q'),
        headers: headerArguments('all', entry('x', int(1)), entry('y', exists)),
      }),
      bindingKey({ ...bind('e', 'queue', 'q', 'k'), headers: a }),
      bindingKey({ ...bind('e', 'queue', 'r'), headers: a }),
      bindingKey({ ...bind('e', 'exchange', 'q'), headers: a }),
      bindingKey({ ...bind('f', 'queue', 'q'), headers: a }),
      bindingKey(bind('e', 'queue', 'q')),
    ]);

    expect(keys.size).toBe(8);
  });

  it('takes no arguments, and an empty list with no x-match, as the same thing', () => {
    expect(bindingKey({ ...bind('e', 'queue', 'q'), headers: headerArguments(null) })).toBe(
      bindingKey(bind('e', 'queue', 'q')),
    );
    expect(bindingKey({ ...bind('e', 'queue', 'q'), headers: headerArguments('all') })).not.toBe(
      bindingKey(bind('e', 'queue', 'q')),
    );
  });

  it('is the same for a binding and for the unbinding of it', () => {
    expect(bindingKey({ ...bind('e', 'queue', 'q', 'k'), op: 'unbind' })).toBe(
      bindingKey(bind('e', 'queue', 'q', 'k')),
    );
  });
});

describe('canonicalTopology', () => {
  it('puts exchanges, queues and bindings in a fixed order, so that two builds of one topology are equal', () => {
    const one = topology({
      exchanges: [exchange('b', 'direct'), exchange('a', 'direct')],
      queues: ['z', 'y'],
      bindings: [toQueue('b', 'z'), toQueue('a', 'y')],
    });
    const other = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'direct')],
      queues: ['y', 'z'],
      bindings: [toQueue('a', 'y'), toQueue('b', 'z')],
    });

    expect(one).not.toEqual(other);
    expect(canonicalTopology(one)).toEqual(canonicalTopology(other));
  });

  it('puts any number of bindings in the same order, whatever order they were made in', () => {
    const permutations = <T>(items: readonly T[]): T[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, at) =>
            permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
          );
    const bindings = [toQueue('a', 'q', 'k1'), toQueue('a', 'q', 'k2'), toQueue('b', 'r'), toExchange('b', 'a', 'z')];
    const [first, ...others] = permutations(bindings).map((order) =>
      canonicalTopology(
        topology({
          exchanges: [exchange('a', 'direct'), exchange('b', 'direct')],
          queues: ['q', 'r'],
          bindings: order,
        }),
      ),
    );

    expect(others).toHaveLength(23);
    for (const other of others) {
      expect(other).toEqual(first);
    }
    // By what a broker keeps: the source, the kind and name of the destination, then the key.
    expect(first?.bindings.map(({ key }) => key)).toEqual(['k1', 'k2', 'z', '']);
  });

  it('keeps the arguments of a binding that has conditions and no x-match, and an x-match and no conditions', () => {
    const conditions = toQueue('a', 'q', '', headerArguments(null, entry('x', int(1))));
    const mode = toQueue('a', 'r', '', headerArguments('any'));
    const [first, second] = canonicalTopology(topology({ bindings: [conditions, mode] })).bindings;

    expect(first?.headers).toEqual({ xMatch: null, args: [entry('x', int(1))] });
    expect(second?.headers).toEqual({ xMatch: 'any', args: [] });
  });

  it('sorts the arguments of a binding by key, and drops arguments that say nothing', () => {
    const unordered = toQueue('a', 'q', '', headerArguments('any', entry('y', int(2)), entry('x', int(1))));
    const empty = toQueue('a', 'r', '', headerArguments(null));

    const [first, second] = canonicalTopology(topology({ bindings: [unordered, empty] })).bindings;

    expect(first?.headers?.args.map(({ key }) => key)).toEqual(['x', 'y']);
    expect(second !== undefined && 'headers' in second).toBe(false);
  });

  it('tells topologies apart that differ in anything a broker keeps', () => {
    const base = topology({ exchanges: [exchange('a', 'direct')], queues: ['q'] });

    expect(canonicalTopology(base)).not.toEqual(
      canonicalTopology(topology({ exchanges: [exchange('a', 'fanout')], queues: ['q'] })),
    );
    expect(canonicalTopology(base)).not.toEqual(
      canonicalTopology(topology({ exchanges: [exchange('a', 'direct')], queues: ['q', 'r'] })),
    );
    expect(canonicalTopology(base)).not.toEqual(
      canonicalTopology(topology({ exchanges: [exchange('a', 'direct', true)], queues: ['q'] })),
    );
    expect(canonicalTopology(base)).not.toEqual(
      canonicalTopology(topology({ vhost: 'prod', exchanges: [exchange('a', 'direct')], queues: ['q'] })),
    );
  });

  it('does not change the topology it is given', () => {
    const given = deepFreeze(
      topology({
        exchanges: [exchange('b', 'direct'), exchange('a', 'direct')],
        queues: ['q', 'p'],
        bindings: [toQueue('b', 'q'), toQueue('a', 'p')],
      }),
    );

    expect(() => canonicalTopology(given)).not.toThrow();
  });
});
