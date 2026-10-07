import {
  bindQueue,
  consume,
  declareExchange,
  declareQueue,
  entry,
  exists,
  headerArguments,
  int,
  newEngine,
  only,
  openChannel,
  publish,
  run,
  runAll,
  settle,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineCommand } from './command';
import type { Engine } from './engine';
import {
  defaultExchangeReply,
  inequivalentReply,
  noExchangeReply,
  noQueueReply,
  reservedNameReply,
  topicWildcardsReply,
  transientQueueReply,
} from './refusal';

/**
 * The commands that build a topology, as the engine answers them (ADR-0050, ADR-0051): what each does, what each refuses, with the broker's words,
 * and that a refusal changes nothing. The fixtures that the broker recorded are replayed in `fixtures.spec.ts`; these are the cases that
 * they do not reach, and the reasons in words.
 */

/** Dispatches a command that is expected to be refused, and answers the refusal. */
function refused(engine: Engine, command: EngineCommand) {
  const before = JSON.stringify(engine.snapshot());
  const result = engine.dispatch(command);
  if (result.ok) {
    throw new Error(`${command.op} was accepted`);
  }
  expect(JSON.stringify(engine.snapshot()), 'a refusal changes nothing').toBe(before);
  return result;
}

describe('exchange.declare', () => {
  it('makes an exchange, which the topology then has, with every flag that it was given', () => {
    const engine = newEngine();

    expect(run(engine, declareExchange('orders', 'topic', { internal: true }))).toEqual([]);

    expect(engine.view().topology.exchanges).toEqual([{ name: 'orders', type: 'topic', internal: true }]);
    expect(engine.view().exchanges['orders']).toEqual({ routed: 0, unroutable: 0, refused: 0 });
  });

  it('refuses the default exchange with the 403 that the broker gave, and a name that starts with amq. with the 403 for it', () => {
    const engine = newEngine();

    expect(refused(engine, declareExchange(''))).toEqual({ ok: false, ...defaultExchangeReply(), events: [] });
    expect(refused(engine, declareExchange('amq.mine'))).toMatchObject(reservedNameReply('exchange', 'amq.mine'));
    expect(run(engine, declareExchange('AMQ.mine'))).toEqual([]);
  });

  it('accepts a declaration that says the same as the exchange that is there, and changes nothing', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('e', 'topic', { durable: false, autoDelete: true }),
      declareQueue('q'),
      bindQueue('e', 'q', 'a.#'),
    );
    const before = JSON.stringify(engine.snapshot());

    expect(run(engine, declareExchange('e', 'topic', { durable: false, autoDelete: true }))).toEqual([]);

    expect(JSON.stringify(engine.snapshot())).toBe(before);
  });

  it.each([
    ['type', declareExchange('e', 'topic'), 'topic', 'direct'],
    ['durable', declareExchange('e', 'direct', { durable: false }), 'false', 'true'],
    ['auto_delete', declareExchange('e', 'direct', { autoDelete: true }), 'true', 'false'],
    ['internal', declareExchange('e', 'direct', { internal: true }), 'true', 'false'],
  ])(
    'refuses a declaration that says another %s, with the 406 of the broker, and keeps the exchange as it was',
    (attribute, command, received, current) => {
      const engine = newEngine();
      run(engine, declareExchange('e'));

      expect(refused(engine, command)).toMatchObject(
        inequivalentReply('exchange', attribute, 'e', '/', received, current),
      );
      expect(engine.view().topology.exchanges).toEqual([{ name: 'e', type: 'direct', internal: false }]);
    },
  );

  it('reports the first attribute that differs, in the order of the broker: type, durable, auto_delete, internal', () => {
    const engine = newEngine();
    run(engine, declareExchange('e'));
    const which = (command: EngineCommand): string | undefined => {
      const result = engine.dispatch(command);
      return result.ok ? undefined : /inequivalent arg '(\w+)'/.exec(result.text)?.[1];
    };

    expect(which(declareExchange('e', 'fanout', { durable: false, autoDelete: true, internal: true }))).toBe('type');
    expect(which(declareExchange('e', 'direct', { durable: false, autoDelete: true, internal: true }))).toBe('durable');
    expect(which(declareExchange('e', 'direct', { autoDelete: true, internal: true }))).toBe('auto_delete');
    expect(which(declareExchange('e', 'direct', { internal: true }))).toBe('internal');
  });
});

describe('exchange.delete', () => {
  it('takes the exchange, the bindings that start from it and the ones that end at it, and its counters', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('a'),
      declareExchange('b'),
      declareQueue('q'),
      bindQueue('a', 'q', 'k'),
      bindQueue('b', 'q', 'k'),
      { op: 'bind', source: 'a', destination: { kind: 'exchange', name: 'b' }, key: 'x' },
    );

    run(engine, { op: 'exchange.delete', name: 'b' });

    expect(engine.view().topology.exchanges.map(({ name }) => name)).toEqual(['a']);
    expect(engine.view().topology.bindings).toEqual([
      { source: 'a', destination: { kind: 'queue', name: 'q' }, key: 'k' },
    ]);
    expect(engine.view().exchanges['b']).toBeUndefined();
  });

  it('is accepted for an exchange that is not there, as a broker accepts it', () => {
    const engine = newEngine();

    expect(run(engine, { op: 'exchange.delete', name: 'nope' })).toEqual([]);
  });

  it('can be followed by a declaration of the same name, which is a new exchange with counters of its own', () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e'), publish('e', 'k'));
    settle(engine);
    expect(engine.view().exchanges['e']?.unroutable).toBe(1);

    runAll(engine, { op: 'exchange.delete', name: 'e' }, declareExchange('e', 'fanout'));

    expect(engine.view().exchanges['e']).toEqual({ routed: 0, unroutable: 0, refused: 0 });
  });
});

describe('queue.declare', () => {
  it('makes a queue that is empty, and the topology has it', () => {
    const engine = newEngine();

    expect(run(engine, declareQueue('q'))).toEqual([]);

    expect(engine.view().topology.queues).toEqual(['q']);
    expect(engine.view().queues['q']).toEqual({ ready: 0, unacked: 0, enqueued: 0, delivered: 0, consumers: 0 });
  });

  it('refuses a name that starts with amq., and a queue that is not durable with the 541 of the broker', () => {
    const engine = newEngine();

    expect(refused(engine, declareQueue('amq.gen-x'))).toMatchObject(reservedNameReply('queue', 'amq.gen-x'));
    expect(refused(engine, { op: 'queue.declare', name: 'transient', durable: false })).toMatchObject(
      transientQueueReply(),
    );
    expect(engine.view().topology.queues).toEqual([]);
  });

  it('throws for no name, because the simulator does not name queues for a client', () => {
    expect(() => newEngine().dispatch(declareQueue(''))).toThrow(RangeError);
  });

  it('accepts a queue that is there, declared again as durable, and keeps what it holds', () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e'), declareQueue('q'), bindQueue('e', 'q', 'k'), publish('e', 'k'));
    settle(engine);

    expect(run(engine, declareQueue('q'))).toEqual([]);

    expect(engine.view().queues['q']?.ready).toBe(1);
  });

  it('answers a queue that is there, declared as not durable, with the 406 for durable, and not with the 541 of a new queue', () => {
    const engine = newEngine();
    run(engine, declareQueue('q'));

    expect(refused(engine, { op: 'queue.declare', name: 'q', durable: false })).toMatchObject(
      inequivalentReply('queue', 'durable', 'q', '/', 'false', 'true'),
    );
  });
});

describe('queue.delete and queue.purge', () => {
  it('delete is accepted for a queue that is not there, and takes a queue, its messages and the bindings that end at it', () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e'), declareQueue('q'), bindQueue('e', 'q', 'k'), publish('e', 'k'));
    settle(engine);

    expect(run(engine, { op: 'queue.delete', name: 'nope' })).toEqual([]);
    const events = run(engine, { op: 'queue.delete', name: 'q' });

    expect(events).toMatchObject([{ type: 'queue.deleted', queue: 'q', ready: 1, unacked: 0 }]);
    expect(engine.view().topology).toMatchObject({ queues: [], bindings: [] });
    expect(engine.view().queues['q']).toBeUndefined();
  });

  it('purge takes the ready messages and says how many, and says nothing when there were none', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('e'),
      declareQueue('q'),
      bindQueue('e', 'q', 'k'),
      publish('e', 'k'),
      publish('e', 'k'),
    );
    settle(engine);

    expect(run(engine, { op: 'queue.purge', name: 'q' })).toMatchObject([
      { type: 'queue.purged', queue: 'q', count: 2 },
    ]);
    expect(run(engine, { op: 'queue.purge', name: 'q' })).toEqual([]);
    expect(engine.view().queues['q']?.ready).toBe(0);
  });

  it('purge of a queue that is not there is the 404 of the broker', () => {
    const engine = newEngine();

    expect(refused(engine, { op: 'queue.purge', name: 'nope' })).toMatchObject(noQueueReply('nope', '/'));
  });
});

describe('bind', () => {
  const direct = () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e'), declareExchange('t', 'topic'), declareQueue('q'));
    return engine;
  };

  it('refuses the default exchange as a source and as a destination, whatever else is wrong, with the 403', () => {
    const engine = direct();

    expect(refused(engine, bindQueue('', 'nope', 'k'))).toMatchObject(defaultExchangeReply());
    expect(
      refused(engine, { op: 'bind', source: 'e', destination: { kind: 'exchange', name: '' }, key: 'k' }),
    ).toMatchObject(defaultExchangeReply());
  });

  it('checks the source, then the destination, then the key of a topic binding, as the broker does', () => {
    const engine = direct();

    expect(refused(engine, bindQueue('nope', 'nope', '#.#.#'))).toMatchObject(noExchangeReply('nope', '/'));
    expect(refused(engine, bindQueue('t', 'nope', '#.#.#'))).toMatchObject(noQueueReply('nope', '/'));
    expect(
      refused(engine, { op: 'bind', source: 't', destination: { kind: 'exchange', name: 'nope' }, key: '#.#.#' }),
    ).toMatchObject(noExchangeReply('nope', '/'));
    expect(refused(engine, bindQueue('t', 'q', '#.#.#'))).toMatchObject(topicWildcardsReply('#.#.#', 3));
    expect(run(engine, bindQueue('t', 'q', 'a.#.b.#'))).toEqual([]);
  });

  it('does not look at the key of a binding of a direct exchange for wildcards', () => {
    const engine = direct();

    expect(run(engine, bindQueue('e', 'q', '#.#.#'))).toEqual([]);
  });

  it('keeps a binding once, however often it is made, and keeps the order that they were made in', () => {
    const engine = direct();
    runAll(engine, bindQueue('e', 'q', 'b'), bindQueue('e', 'q', 'a'), bindQueue('e', 'q', 'b'));

    expect(engine.view().topology.bindings.map(({ key }) => key)).toEqual(['b', 'a']);
  });

  it('tells bindings apart by their arguments and their x-match, and keeps them with no arguments as the same', () => {
    const engine = newEngine();
    runAll(engine, declareExchange('h', 'headers'), declareQueue('q'));
    const bindHeaders = (headers: ReturnType<typeof headerArguments> | undefined) =>
      run(engine, bindQueue('h', 'q', '', headers));

    bindHeaders(undefined);
    bindHeaders(headerArguments(null));
    bindHeaders(headerArguments('all', entry('a', int(1))));
    bindHeaders(headerArguments('all', entry('a', int(1))));
    bindHeaders(headerArguments('any', entry('a', int(1))));
    bindHeaders(headerArguments('all', entry('a', exists)));
    bindHeaders(headerArguments(null, entry('a', str('1'))));

    expect(engine.view().topology.bindings).toHaveLength(5);
    expect(engine.view().topology.bindings[0]).not.toHaveProperty('headers');
  });

  it('throws for a key that no client could send', () => {
    expect(() => direct().dispatch(bindQueue('e', 'q', 'k'.repeat(256)))).toThrow(RangeError);
  });
});

describe('unbind', () => {
  const bound = () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e'), declareQueue('q'), bindQueue('e', 'q', 'k1'), bindQueue('e', 'q', 'k2'));
    return engine;
  };
  const unbind = (key: string, source = 'e', name = 'q'): EngineCommand => ({
    op: 'unbind',
    source,
    destination: { kind: 'queue', name },
    key,
  });

  it('takes off the binding that is exactly this one, and keeps the others', () => {
    const engine = bound();

    expect(run(engine, unbind('k1'))).toEqual([]);

    expect(engine.view().topology.bindings.map(({ key }) => key)).toEqual(['k2']);
  });

  it('is accepted whether or not there is such a binding, and whether or not its ends are there, as a broker accepts it', () => {
    const engine = bound();
    const before = JSON.stringify(engine.snapshot());

    runAll(engine, unbind('never'), unbind('k1', 'e', 'other'), unbind('k1', 'nope'));
    run(engine, { op: 'unbind', source: 'e', destination: { kind: 'exchange', name: 'nope' }, key: 'k1' });

    expect(JSON.stringify(engine.snapshot())).toBe(before);
  });

  it('refuses the default exchange as a source and as a destination with the 403, as bind does', () => {
    const engine = bound();

    expect(refused(engine, unbind('k1', ''))).toMatchObject(defaultExchangeReply());
    expect(
      refused(engine, { op: 'unbind', source: 'e', destination: { kind: 'exchange', name: '' }, key: 'k1' }),
    ).toMatchObject(defaultExchangeReply());
  });

  it('needs the same arguments and the same x-match as the binding, and an x-match left out is not all', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('h', 'headers'),
      declareQueue('q'),
      bindQueue('h', 'q', '', headerArguments(null, entry('a', int(1)))),
    );
    const unbindHeaders = (headers: ReturnType<typeof headerArguments>): EngineCommand => ({
      op: 'unbind',
      source: 'h',
      destination: { kind: 'queue', name: 'q' },
      key: '',
      headers,
    });

    run(engine, unbindHeaders(headerArguments('all', entry('a', int(1)))));
    run(engine, unbindHeaders(headerArguments(null, entry('a', int(2)))));
    expect(engine.view().topology.bindings).toHaveLength(1);
    run(engine, unbindHeaders(headerArguments(null, entry('a', int(1)))));
    expect(engine.view().topology.bindings).toHaveLength(0);
  });

  it('throws for a key that no client could send', () => {
    expect(() => bound().dispatch(unbind('k'.repeat(256)))).toThrow(RangeError);
  });

  it('stops routing by the binding at once, so that the next message is not delivered by it', () => {
    const engine = bound();
    runAll(engine, openChannel('ch'), consume('ch', 'q', 'c1'));
    run(engine, unbind('k1'));
    run(engine, publish('e', 'k1'));

    expect(types(settle(engine))).toEqual(['unroutable']);
  });
});

/** The types of the events, in order. */
const types = (events: readonly { readonly type: string }[]): string[] => events.map(({ type }) => type);

describe('what a refusal says', () => {
  it('is the broker’s code and text, with the events that it caused, which are none for a command that is not on a channel', () => {
    const engine = newEngine();

    expect(engine.dispatch(declareExchange('amq.x'))).toEqual({
      ok: false,
      code: 403,
      text: "ACCESS_REFUSED - exchange name 'amq.x' contains reserved prefix 'amq.*'",
      events: [],
    });
    expect(only([], 'refused')).toEqual([]);
  });
});
