import type { Bind, EngineCommand, ExchangeDeclare, QueueDeclare } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import {
  applyEngineCommand,
  applyEngineCommands,
  BrokerError,
  bindingKey,
  canonicalTopology,
  emptyBroker,
  topologyOf,
  type BrokerState,
} from './broker';
import { deepFreeze, entry, exists, headerArguments, int, str } from './topology';

const exchange = (name: string, type: ExchangeDeclare['type'] = 'direct', internal = false): ExchangeDeclare => ({
  op: 'exchange.declare',
  name,
  type,
  durable: true,
  autoDelete: false,
  internal,
});
const queue = (name: string): QueueDeclare => ({ op: 'queue.declare', name, durable: true });
const bind = (source: string, kind: 'queue' | 'exchange', name: string, key = ''): Bind => ({
  op: 'bind',
  source,
  destination: { kind, name },
  key,
});

const build = (...commands: EngineCommand[]): BrokerState => applyEngineCommands(deepFreeze(emptyBroker()), commands);

describe('the broker oracle', () => {
  describe('declaring', () => {
    it('keeps exchanges and queues in the order they were declared', () => {
      const state = build(exchange('b'), queue('z'), exchange('a', 'topic', true), queue('y'));

      expect(state.exchanges.map(({ name }) => name)).toEqual(['b', 'a']);
      expect(state.queues.map(({ name }) => name)).toEqual(['z', 'y']);
    });

    it('allows a queue and an exchange to share a name', () => {
      expect(() => build(exchange('x'), queue('x'))).not.toThrow();
    });

    it('refuses a name that is taken, even when it is declared the same way', () => {
      expect(() => build(exchange('x'), exchange('x'))).toThrow(BrokerError);
      expect(() => build(queue('q'), queue('q'))).toThrow('a queue with that name exists');
      expect(() => build(exchange('x'), exchange('x', 'topic'))).toThrow('an exchange with that name exists');
    });

    it('refuses the default exchange, and a queue with no name', () => {
      expect(() => build(exchange(''))).toThrow('the default exchange cannot be declared');
      expect(() => build(queue(''))).toThrow('a queue needs a name');
    });

    it('does not change the state it is given', () => {
      const before = deepFreeze(build(exchange('x')));

      expect(() => applyEngineCommand(before, queue('q'))).not.toThrow();
      expect(before.queues).toEqual([]);
    });
  });

  describe('deleting', () => {
    it('refuses a name that is not there', () => {
      expect(() => build(queue('q'), { op: 'exchange.delete', name: 'q' })).toThrow('there is no exchange');
      expect(() => build(exchange('x'), { op: 'queue.delete', name: 'x' })).toThrow('there is no queue');
    });

    it('deletes the bindings that start from an exchange and the ones that end at it', () => {
      const state = build(
        exchange('a'),
        exchange('b'),
        exchange('c'),
        queue('q'),
        bind('a', 'exchange', 'b'),
        bind('b', 'exchange', 'c'),
        bind('c', 'queue', 'q'),
        bind('b', 'queue', 'q'),
        { op: 'exchange.delete', name: 'b' },
      );

      expect(state.exchanges.map(({ name }) => name)).toEqual(['a', 'c']);
      expect(state.bindings.map(({ source }) => source)).toEqual(['c']);
    });

    it('deletes the bindings that end at a queue, and no others', () => {
      const state = build(
        exchange('a'),
        queue('q'),
        queue('r'),
        exchange('q'),
        bind('a', 'queue', 'q'),
        bind('a', 'queue', 'r'),
        bind('a', 'exchange', 'q'),
        { op: 'queue.delete', name: 'q' },
      );

      expect(state.queues.map(({ name }) => name)).toEqual(['r']);
      expect(state.bindings.map(({ destination }) => `${destination.kind}:${destination.name}`)).toEqual([
        'queue:r',
        'exchange:q',
      ]);
    });

    it('does not delete a binding to an exchange when a queue of the same name goes', () => {
      const state = build(exchange('a'), exchange('n'), queue('n'), bind('a', 'exchange', 'n'), {
        op: 'queue.delete',
        name: 'n',
      });

      expect(state.bindings).toHaveLength(1);
    });
  });

  describe('deleting an exchange', () => {
    it('does not delete a binding to a queue when an exchange of the same name goes', () => {
      const state = build(exchange('a'), exchange('n'), queue('n'), bind('a', 'queue', 'n'), {
        op: 'exchange.delete',
        name: 'n',
      });

      expect(state.bindings).toHaveLength(1);
    });

    it('deletes a binding from the exchange to a queue, and keeps the ones from the other exchanges', () => {
      const state = build(exchange('a'), exchange('b'), queue('q'), bind('a', 'queue', 'q'), bind('b', 'queue', 'q'), {
        op: 'exchange.delete',
        name: 'a',
      });

      expect(state.bindings.map(({ source }) => source)).toEqual(['b']);
    });
  });

  describe('binding', () => {
    const base = [exchange('a'), exchange('b'), queue('q')] as const;

    it('refuses the default exchange at either end', () => {
      expect(() => build(...base, bind('', 'queue', 'q'))).toThrow('the default exchange cannot be bound');
      expect(() => build(...base, bind('a', 'exchange', ''))).toThrow('the default exchange cannot be bound');
    });

    it('refuses an end that does not exist, and says which', () => {
      expect(() => build(...base, bind('nope', 'queue', 'q'))).toThrow('the source exchange does not exist');
      expect(() => build(...base, bind('a', 'queue', 'nope'))).toThrow('the destination queue does not exist');
      expect(() => build(...base, bind('a', 'exchange', 'nope'))).toThrow('the destination exchange does not exist');
      expect(() => build(...base, bind('a', 'exchange', 'q'))).toThrow('the destination exchange does not exist');
      expect(() => build(...base, bind('a', 'queue', 'b'))).toThrow('the destination queue does not exist');
    });

    it('accepts an exchange bound to itself, and a cycle', () => {
      expect(() =>
        build(...base, bind('a', 'exchange', 'a'), bind('a', 'exchange', 'b'), bind('b', 'exchange', 'a')),
      ).not.toThrow();
    });

    it('refuses the same binding twice, and takes bindings with another key or other arguments as other bindings', () => {
      const keyed = bind('a', 'queue', 'q', 'k');
      const withHeaders: Bind = { ...keyed, headers: headerArguments('any', entry('n', int(1))) };

      expect(() => build(...base, keyed, keyed)).toThrow('that binding exists');
      expect(() => build(...base, keyed, bind('a', 'queue', 'q', 'other'), withHeaders)).not.toThrow();
      expect(() => build(...base, withHeaders, withHeaders)).toThrow('that binding exists');
    });

    it('unbinds the binding that it is told to, and refuses one that is not there', () => {
      const keyed = bind('a', 'queue', 'q', 'k');
      const state = build(...base, keyed, bind('a', 'queue', 'q', 'other'), { ...keyed, op: 'unbind' });

      expect(state.bindings.map(({ key }) => key)).toEqual(['other']);
      expect(() => build(...base, { ...keyed, op: 'unbind' })).toThrow('there is no such binding');
      expect(() => build(...base, { ...bind('nope', 'queue', 'q'), op: 'unbind' })).toThrow('the source exchange');
    });

    it('keeps bindings in the order they were made', () => {
      const state = build(...base, bind('a', 'queue', 'q', '2'), bind('a', 'queue', 'q', '1'), bind('b', 'queue', 'q'));

      expect(state.bindings.map(({ key }) => key)).toEqual(['2', '1', '']);
    });
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
  });

  describe('topologyOf', () => {
    it('is what the engine routes: names, types, internal flags and bindings in order', () => {
      const withHeaders: Bind = {
        ...bind('a', 'queue', 'q', 'k'),
        headers: headerArguments('any', entry('n', int(1))),
      };
      const state = build(exchange('a', 'headers', true), queue('q'), withHeaders, bind('a', 'exchange', 'a'));

      expect(topologyOf(state)).toEqual({
        vhost: '/',
        exchanges: [{ name: 'a', type: 'headers', internal: true }],
        queues: ['q'],
        bindings: [
          { source: 'a', destination: { kind: 'queue', name: 'q' }, key: 'k', headers: withHeaders.headers },
          { source: 'a', destination: { kind: 'exchange', name: 'a' }, key: '' },
        ],
      });
    });

    it('does not give a binding that has no arguments an empty `headers` field', () => {
      const state = build(exchange('a'), queue('q'), bind('a', 'queue', 'q'));

      expect('headers' in (topologyOf(state).bindings[0] as object)).toBe(false);
    });

    it('takes the vhost of the broker', () => {
      expect(topologyOf(emptyBroker('prod')).vhost).toBe('prod');
    });
  });

  describe('canonicalTopology', () => {
    it('puts exchanges, queues and bindings in a fixed order, so that two builds of one topology are equal', () => {
      const one = build(
        exchange('b'),
        exchange('a'),
        queue('z'),
        queue('y'),
        bind('b', 'queue', 'z'),
        bind('a', 'queue', 'y'),
      );
      const other = build(
        exchange('a'),
        exchange('b'),
        queue('y'),
        queue('z'),
        bind('a', 'queue', 'y'),
        bind('b', 'queue', 'z'),
      );

      expect(topologyOf(one)).not.toEqual(topologyOf(other));
      expect(canonicalTopology(topologyOf(one))).toEqual(canonicalTopology(topologyOf(other)));
    });

    it('puts any number of bindings in the same order, whatever order they were made in', () => {
      const permutations = <T>(items: readonly T[]): T[][] =>
        items.length <= 1
          ? [[...items]]
          : items.flatMap((item, at) =>
              permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
            );
      const bindings = [
        bind('a', 'queue', 'q', 'k1'),
        bind('a', 'queue', 'q', 'k2'),
        bind('b', 'queue', 'r'),
        bind('b', 'exchange', 'a', 'z'),
      ];
      const [first, ...others] = permutations(bindings).map((order) =>
        canonicalTopology(topologyOf(build(exchange('a'), exchange('b'), queue('q'), queue('r'), ...order))),
      );

      expect(others).toHaveLength(23);
      for (const other of others) {
        expect(other).toEqual(first);
      }
      // By what a broker keeps: the source, the kind and name of the destination, then the key.
      expect(first?.bindings.map(({ key }) => key)).toEqual(['k1', 'k2', 'z', '']);
    });

    it('keeps the arguments of a binding that has conditions and no x-match, and an x-match and no conditions', () => {
      const conditions: Bind = { ...bind('a', 'queue', 'q'), headers: headerArguments(null, entry('x', int(1))) };
      const mode: Bind = { ...bind('a', 'queue', 'r'), headers: headerArguments('any') };
      const [first, second] = canonicalTopology(
        topologyOf(build(exchange('a'), queue('q'), queue('r'), conditions, mode)),
      ).bindings;

      expect(first?.headers).toEqual({ xMatch: null, args: [entry('x', int(1))] });
      expect(second?.headers).toEqual({ xMatch: 'any', args: [] });
    });

    it('sorts the arguments of a binding by key, and drops arguments that say nothing', () => {
      const unordered: Bind = {
        ...bind('a', 'queue', 'q'),
        headers: headerArguments('any', entry('y', int(2)), entry('x', int(1))),
      };
      const empty: Bind = { ...bind('a', 'queue', 'r'), headers: headerArguments(null) };
      const state = build(exchange('a'), queue('q'), queue('r'), unordered, empty);

      const [first, second] = canonicalTopology(topologyOf(state)).bindings;

      expect(first?.headers?.args.map(({ key }) => key)).toEqual(['x', 'y']);
      expect(second !== undefined && 'headers' in second).toBe(false);
    });

    it('tells topologies apart that differ in anything a broker keeps', () => {
      const base = build(exchange('a'), queue('q'));

      expect(canonicalTopology(topologyOf(base))).not.toEqual(
        canonicalTopology(topologyOf(build(exchange('a', 'fanout'), queue('q')))),
      );
      expect(canonicalTopology(topologyOf(base))).not.toEqual(
        canonicalTopology(topologyOf(build(exchange('a'), queue('q'), queue('r')))),
      );
      expect(canonicalTopology(topologyOf(base))).not.toEqual(
        canonicalTopology(topologyOf(build(exchange('a', 'direct', true), queue('q')))),
      );
    });

    it('does not change the topology it is given', () => {
      const topology = deepFreeze(topologyOf(build(exchange('b'), exchange('a'), queue('q'), bind('b', 'queue', 'q'))));

      expect(() => canonicalTopology(topology)).not.toThrow();
    });
  });

  it('is an error of its own, with a name', () => {
    expect(() => build(exchange(''))).toThrow(BrokerError);
    try {
      build(exchange(''));
    } catch (error) {
      expect((error as Error).name).toBe('BrokerError');
    }
  });

  it('names the command that it refused, and why', () => {
    expect(() => build(bind('x', 'queue', 'q'))).toThrow(
      /^bind \{.*"source":"x".*\}: the source exchange does not exist$/,
    );
  });
});
