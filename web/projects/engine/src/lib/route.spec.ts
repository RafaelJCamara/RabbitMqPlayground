import {
  bool,
  deepFreeze,
  entry,
  exchange,
  exists,
  float,
  headerArguments,
  int,
  message,
  str,
  toExchange,
  toQueue,
  topology,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { HeaderEntry, HeaderValue } from './headers';
import { route, type RouteResult, type Routed } from './route';

const routed = (result: RouteResult): Routed => {
  if (!result.ok) {
    throw new Error(`refused: ${result.code} ${result.text}`);
  }
  return result;
};
const queuesOf = (result: RouteResult): readonly string[] => routed(result).queues;

describe('route: direct exchanges (ADR-0008, rule 2)', () => {
  const t = topology({
    exchanges: [exchange('d', 'direct')],
    queues: ['a', 'b', 'c', 'empty'],
    bindings: [toQueue('d', 'a', 'k'), toQueue('d', 'b', 'k'), toQueue('d', 'c', 'K'), toQueue('d', 'empty', '')],
  });

  it('sends a message to every queue bound with exactly its key', () => {
    expect(queuesOf(route(t, message('d', 'k')))).toEqual(['a', 'b']);
  });

  it('compares case, and the whole key', () => {
    expect(queuesOf(route(t, message('d', 'K')))).toEqual(['c']);
    expect(queuesOf(route(t, message('d', 'k.x')))).toEqual([]);
    expect(queuesOf(route(t, message('d', 'k ')))).toEqual([]);
  });

  it('matches the empty key with a binding whose key is empty', () => {
    expect(queuesOf(route(t, message('d', '')))).toEqual(['empty']);
  });

  it('takes a wildcard character in a binding key as an ordinary character', () => {
    const wild = topology({
      exchanges: [exchange('d', 'direct')],
      queues: ['q'],
      bindings: [toQueue('d', 'q', 'a.#')],
    });

    expect(queuesOf(route(wild, message('d', 'a.#')))).toEqual(['q']);
    expect(queuesOf(route(wild, message('d', 'a.b')))).toEqual([]);
  });

  it('ignores the headers of the message', () => {
    expect(queuesOf(route(t, message('d', 'k', [entry('a', int(1))])))).toEqual(['a', 'b']);
  });
});

describe('route: fanout exchanges (ADR-0008, rule 3)', () => {
  it('sends a message to every bound queue whatever its key and headers, and whatever key the binding has', () => {
    const t = topology({
      exchanges: [exchange('f', 'fanout')],
      queues: ['a', 'b', 'unbound'],
      bindings: [toQueue('f', 'a', 'one'), toQueue('f', 'b', '#.#.#', headerArguments('all', entry('x', int(1))))],
    });

    expect(queuesOf(route(t, message('f', 'zzz', [entry('n', int(2))])))).toEqual(['a', 'b']);
    expect(queuesOf(route(t, message('f')))).toEqual(['a', 'b']);
  });
});

describe('route: topic exchanges (ADR-0008, rule 4)', () => {
  const t = topology({
    exchanges: [exchange('t', 'topic')],
    queues: ['star', 'hash', 'all', 'middle'],
    bindings: [
      toQueue('t', 'star', 'a.*'),
      toQueue('t', 'hash', 'a.#'),
      toQueue('t', 'all', '#'),
      toQueue('t', 'middle', 'a.#.b'),
    ],
  });

  it.each<[string, string[]]>([
    ['a', ['hash', 'all']],
    ['a.b', ['star', 'hash', 'all', 'middle']],
    ['a.b.c', ['hash', 'all']],
    ['a.x.y.b', ['hash', 'all', 'middle']],
    ['a..b', ['hash', 'all', 'middle']],
    ['', ['all']],
    ['b', ['all']],
  ])('routes the key %j to %j', (key, expected) => {
    expect([...queuesOf(route(t, message('t', key)))].sort()).toEqual([...expected].sort());
  });
});

describe('route: headers exchanges (ADR-0009)', () => {
  const t = topology({
    exchanges: [exchange('h', 'headers')],
    queues: ['all', 'any', 'int', 'float', 'nothing', 'exists', 'x'],
    bindings: [
      toQueue('h', 'all', '', headerArguments('all', entry('a', int(1)), entry('b', int(2)))),
      toQueue('h', 'any', '', headerArguments('any', entry('a', int(1)), entry('b', int(2)))),
      toQueue('h', 'int', '', headerArguments(null, entry('n', int(1)))),
      toQueue('h', 'float', '', headerArguments(null, entry('n', float(1)))),
      toQueue('h', 'nothing', '', headerArguments('any')),
      toQueue('h', 'exists', '', headerArguments('all', entry('n', exists))),
      toQueue('h', 'x', '', headerArguments('all-with-x', entry('x-k', str('v')))),
    ],
  });

  it.each<[string, HeaderEntry<HeaderValue>[], string[]]>([
    ['a=1 b=2', [entry('a', int(1)), entry('b', int(2))], ['all', 'any']],
    ['a=1 only', [entry('a', int(1))], ['any']],
    ['b=2 only', [entry('b', int(2))], ['any']],
    ['a=2 b=2', [entry('a', int(2)), entry('b', int(2))], ['any']],
    ['no headers', [], []],
    ['n=1, an integer', [entry('n', int(1))], ['int', 'exists']],
  ])('routes the headers %s to %j', (_name, headers, expected) => {
    expect(queuesOf(route(t, message('h', 'ignored', headers)))).toEqual(expected);
  });

  it('tells an integer from a float, a string and a boolean, so that 1 is not 1.0', () => {
    expect(queuesOf(route(t, message('h', '', [entry('n', float(1))])))).toEqual(['float', 'exists']);
    expect(queuesOf(route(t, message('h', '', [entry('n', str('1'))])))).toEqual(['exists']);
    expect(queuesOf(route(t, message('h', '', [entry('n', bool(true))])))).toEqual(['exists']);
  });

  it('counts an x- argument only in a with-x mode', () => {
    expect(queuesOf(route(t, message('h', '', [entry('x-k', str('v'))])))).toEqual(['x']);
    expect(queuesOf(route(t, message('h', '', [entry('x-k', str('w'))])))).toEqual([]);
  });

  it('treats a headers binding that has no arguments as matching everything', () => {
    const bare = topology({ exchanges: [exchange('h', 'headers')], queues: ['q'], bindings: [toQueue('h', 'q')] });

    expect(queuesOf(route(bare, message('h')))).toEqual(['q']);
  });

  it('ignores the routing key', () => {
    expect(queuesOf(route(t, message('h', 'whatever.key', [entry('n', int(1))])))).toEqual(['int', 'exists']);
  });
});

describe('route: the default exchange (ADR-0008, rule 6)', () => {
  const t = topology({
    exchanges: [exchange('e', 'fanout')],
    queues: ['alpha', 'ALPHA', 'a.b', 'e'],
    bindings: [toQueue('e', 'alpha')],
  });

  it('sends a message to the queue whose name is its key, and to no other', () => {
    expect(queuesOf(route(t, message('', 'alpha')))).toEqual(['alpha']);
    expect(queuesOf(route(t, message('', 'ALPHA')))).toEqual(['ALPHA']);
    expect(queuesOf(route(t, message('', 'a.b')))).toEqual(['a.b']);
  });

  it('sends nothing when no queue has that name, whether the key is empty, a pattern, or the name of an exchange', () => {
    expect(queuesOf(route(t, message('', 'nobody')))).toEqual([]);
    expect(queuesOf(route(t, message('', '')))).toEqual([]);
    expect(queuesOf(route(t, message('', 'a.*')))).toEqual([]);
    expect(queuesOf(route(topology({ exchanges: [exchange('x', 'fanout')] }), message('', 'x')))).toEqual([]);
  });

  it('does not follow the bindings of other exchanges, and ignores the headers', () => {
    expect(queuesOf(route(t, message('', 'e', [entry('a', int(1))])))).toEqual(['e']);
    expect(queuesOf(route(t, message('', 'alpha', [entry('a', int(1))])))).toEqual(['alpha']);
  });

  it('is there without being declared, and is never refused', () => {
    expect(route(topology({}), message('', 'q')).ok).toBe(true);
  });
});

describe('route: exchange-to-exchange bindings (ADR-0008, rule 7)', () => {
  it('follows a chain of exchanges, each applying its own type to the same key and headers', () => {
    const t = topology({
      exchanges: [exchange('t', 'topic'), exchange('h', 'headers'), exchange('d', 'direct'), exchange('f', 'fanout')],
      queues: ['end', 'side'],
      bindings: [
        toExchange('t', 'h', 'a.#'),
        toExchange('h', 'd', '', headerArguments('all', entry('n', int(1)))),
        toExchange('d', 'f', 'a.b'),
        toQueue('f', 'end'),
        toQueue('d', 'side', 'a.c'),
      ],
    });

    expect(queuesOf(route(t, message('t', 'a.b', [entry('n', int(1))])))).toEqual(['end']);
    expect(queuesOf(route(t, message('t', 'a.c', [entry('n', int(1))])))).toEqual(['side']);
    expect(queuesOf(route(t, message('t', 'a.b', [entry('n', int(2))])))).toEqual([]);
    expect(queuesOf(route(t, message('t', 'b.b', [entry('n', int(1))])))).toEqual([]);
    expect(queuesOf(route(t, message('t', 'a.x', [entry('n', int(1))])))).toEqual([]);
    expect(queuesOf(route(t, message('d', 'a.b')))).toEqual(['end']);
    expect(queuesOf(route(t, message('f')))).toEqual(['end']);
  });

  it('gives a queue one copy however many paths reach it, and visits an exchange once', () => {
    const t = topology({
      exchanges: [exchange('top', 'fanout'), exchange('left', 'fanout'), exchange('right', 'fanout')],
      queues: ['shared', 'left-only'],
      bindings: [
        toExchange('top', 'left'),
        toExchange('top', 'right'),
        toQueue('top', 'shared'),
        toQueue('left', 'shared'),
        toQueue('right', 'shared'),
        toQueue('left', 'left-only'),
      ],
    });
    const result = routed(route(t, message('top')));

    expect(result.queues).toEqual(['shared', 'left-only']);
    expect(result.trace.visits.map((visit) => visit.exchange)).toEqual(['top', 'left', 'right']);
  });

  it('visits an exchange once when two paths reach it, and gives its queue one copy', () => {
    const t = topology({
      exchanges: [
        exchange('top', 'fanout'),
        exchange('left', 'fanout'),
        exchange('right', 'fanout'),
        exchange('bottom', 'fanout'),
      ],
      queues: ['q'],
      bindings: [
        toExchange('top', 'left'),
        toExchange('top', 'right'),
        toExchange('left', 'bottom'),
        toExchange('right', 'bottom'),
        toQueue('bottom', 'q'),
      ],
    });
    const result = routed(route(t, message('top')));

    expect(result.trace.visits.map((visit) => visit.exchange)).toEqual(['top', 'left', 'right', 'bottom']);
    expect(result.trace.visits[3]?.via).toEqual({ from: 'left', binding: 2 });
    expect(result.queues).toEqual(['q']);
  });

  it.each<[string, string[]]>([
    ['a', ['qa', 'qb']],
    ['b', ['qa', 'qb']],
  ])('terminates on a cycle, starting from %s', (start, expected) => {
    const t = topology({
      exchanges: [exchange('a', 'fanout'), exchange('b', 'fanout')],
      queues: ['qa', 'qb'],
      bindings: [toExchange('a', 'b'), toExchange('b', 'a'), toQueue('a', 'qa'), toQueue('b', 'qb')],
    });

    expect([...queuesOf(route(t, message(start)))].sort()).toEqual(expected);
  });

  it('terminates on an exchange that is bound to itself, and still delivers', () => {
    const t = topology({
      exchanges: [exchange('e', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('e', 'e'), toQueue('e', 'q')],
    });
    const result = routed(route(t, message('e')));

    expect(result.queues).toEqual(['q']);
    expect(result.trace.visits).toHaveLength(1);
  });

  it('reaches a queue through a cycle only once, from any exchange of it', () => {
    const t = topology({
      exchanges: [exchange('x1', 'fanout'), exchange('x2', 'fanout'), exchange('x3', 'fanout')],
      queues: ['only'],
      bindings: [toExchange('x1', 'x2'), toExchange('x2', 'x3'), toExchange('x3', 'x1'), toQueue('x3', 'only')],
    });

    for (const start of ['x1', 'x2', 'x3']) {
      expect(queuesOf(route(t, message(start)))).toEqual(['only']);
    }
  });

  it('routes through an internal exchange that another exchange forwards to', () => {
    const t = topology({
      exchanges: [exchange('front', 'fanout'), exchange('hidden', 'fanout', true)],
      queues: ['q'],
      bindings: [toExchange('front', 'hidden'), toQueue('hidden', 'q')],
    });

    expect(queuesOf(route(t, message('front')))).toEqual(['q']);
  });

  it('follows a chain of any length', () => {
    const names = Array.from({ length: 200 }, (_, index) => `x${index}`);
    const t = topology({
      exchanges: names.map((name) => exchange(name, 'fanout')),
      queues: ['end'],
      bindings: [
        ...names.slice(1).map((name, index) => toExchange(names[index] ?? '', name)),
        toQueue(names[199] ?? '', 'end'),
      ],
    });

    expect(queuesOf(route(t, message('x0')))).toEqual(['end']);
  });

  it('lists the queues in the order they were first reached, which is breadth first', () => {
    const t = topology({
      exchanges: [exchange('root', 'fanout'), exchange('child', 'fanout'), exchange('other', 'fanout')],
      queues: ['deep', 'near', 'also-near'],
      bindings: [
        toExchange('root', 'child'),
        toQueue('root', 'near'),
        toQueue('child', 'deep'),
        toExchange('root', 'other'),
        toQueue('root', 'also-near'),
      ],
    });

    expect(queuesOf(route(t, message('root')))).toEqual(['near', 'also-near', 'deep']);
  });

  it('ignores a binding that starts from an exchange that is not declared, and notes one that points at nothing', () => {
    const t = topology({
      exchanges: [exchange('e', 'fanout')],
      queues: ['q'],
      bindings: [
        toQueue('ghost', 'q'),
        toQueue('e', 'missing-queue'),
        toExchange('e', 'missing-exchange'),
        toQueue('e', 'q'),
      ],
    });
    const result = routed(route(t, message('e')));

    expect(result.queues).toEqual(['q']);
    expect(result.trace.visits[0]?.bindings.map((evaluation) => evaluation.outcome)).toEqual([
      'destination-missing',
      'destination-missing',
      'queue-first-copy',
    ]);
  });
});

describe('route: what it refuses (ADR-0008, rules 8; ADR-0021)', () => {
  const t = topology({
    vhost: 'prod',
    exchanges: [exchange('open', 'fanout'), exchange('hidden', 'fanout', true)],
    queues: ['q'],
    bindings: [toQueue('hidden', 'q')],
  });

  it('refuses a publish to an internal exchange with 403, in the broker’s words, naming the vhost', () => {
    expect(route(t, message('hidden'))).toEqual({
      ok: false,
      code: 403,
      text: "ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost 'prod'",
    });
  });

  it('refuses a publish to an exchange that does not exist with 404, even if a queue has that name', () => {
    expect(route(t, message('nowhere'))).toEqual({
      ok: false,
      code: 404,
      text: "NOT_FOUND - no exchange 'nowhere' in vhost 'prod'",
    });
    expect(route(t, message('q'))).toMatchObject({ ok: false, code: 404 });
  });

  it('does not refuse a publish to an exchange that is open, or to the default exchange', () => {
    expect(route(t, message('open')).ok).toBe(true);
    expect(route(t, message('')).ok).toBe(true);
  });

  it('uses the vhost that the topology has', () => {
    expect(route({ ...t, vhost: '/' }, message('nowhere'))).toMatchObject({
      text: "NOT_FOUND - no exchange 'nowhere' in vhost '/'",
    });
  });
});

describe('route: input that cannot be sent', () => {
  const t = topology({ exchanges: [exchange('e', 'topic')], queues: ['q'], bindings: [toQueue('e', 'q', '#')] });

  it('accepts a key of 255 bytes and refuses one of 256, counting bytes (ADR-0008, rule 4)', () => {
    expect(route(t, message('e', 'a'.repeat(255))).ok).toBe(true);
    expect(route(t, message('e', `${'é'.repeat(127)}a`)).ok).toBe(true);
    expect(() => route(t, message('e', 'a'.repeat(256)))).toThrow(RangeError);
    expect(() => route(t, message('e', 'é'.repeat(128)))).toThrow(
      'A routing key is at most 255 bytes of UTF-8, and this one is 256',
    );
  });

  it('refuses a header that has no exact value, naming it (ADR-0023)', () => {
    expect(() => route(t, message('e', '', [entry('big', int(2 ** 53))]))).toThrow(RangeError);
    expect(() => route(t, message('e', '', [entry('big', int(2 ** 53))]))).toThrow(/Header "big": An integer header/);
    expect(() => route(t, message('e', '', [entry('f', float(Number.NaN))]))).toThrow(/Header "f": A float header/);
    expect(route(t, message('e', '', [entry('ok', int(2 ** 53 - 1))])).ok).toBe(true);
  });

  it('refuses before it looks at the exchange, so that a missing one does not hide the problem', () => {
    expect(() => route(t, message('nowhere', 'a'.repeat(256)))).toThrow(RangeError);
  });
});

describe('route: the paths', () => {
  const t = topology({
    exchanges: [exchange('a', 'fanout'), exchange('b', 'fanout'), exchange('c', 'fanout')],
    queues: ['q1', 'q2'],
    bindings: [toExchange('a', 'b'), toExchange('b', 'c'), toQueue('a', 'q1'), toQueue('c', 'q2'), toQueue('b', 'q2')],
  });

  it('gives the path to each queue, as the hops from the exchange published to, parallel to the queues', () => {
    const result = routed(route(t, message('a')));

    expect(result.queues).toEqual(['q1', 'q2']);
    expect(result.paths).toEqual([
      { queue: 'q1', hops: [{ from: 'a', binding: 2, to: { kind: 'queue', name: 'q1' } }] },
      {
        queue: 'q2',
        hops: [
          { from: 'a', binding: 0, to: { kind: 'exchange', name: 'b' } },
          { from: 'b', binding: 4, to: { kind: 'queue', name: 'q2' } },
        ],
      },
    ]);
  });

  it('takes the shortest way when there are two, because it follows exchanges breadth first', () => {
    const result = routed(route(t, message('a')));

    expect(result.paths[1]?.hops).toHaveLength(2);
  });

  it('has the one hop through the default exchange, which has no binding', () => {
    const result = routed(route(topology({ queues: ['q'] }), message('', 'q')));

    expect(result.paths).toEqual([
      { queue: 'q', hops: [{ from: '', binding: null, to: { kind: 'queue', name: 'q' } }] },
    ]);
  });
});

describe('route: the trace (ADR-0007, ADR-0009, ADR-0010)', () => {
  const t = topology({
    exchanges: [exchange('t', 'topic'), exchange('d', 'direct'), exchange('h', 'headers'), exchange('f', 'fanout')],
    queues: ['q', 'r', 's', 'u'],
    bindings: [
      toExchange('t', 'd', 'a.*'),
      toQueue('t', 'q', 'a.#'),
      toQueue('t', 'r', 'b.*'),
      toQueue('d', 'q', 'a.b'),
      toQueue('d', 'r', 'other'),
      toExchange('t', 'h', 'a.b'),
      toQueue('h', 's', '', headerArguments('any', entry('n', int(1)))),
      toExchange('t', 'f', '#'),
      toQueue('f', 'u'),
    ],
  });
  const result = routed(route(t, message('t', 'a.b', [entry('n', float(1))])));

  it('has one visit for each exchange reached, in the order that they were visited', () => {
    expect(result.trace.exchange).toBe('t');
    expect(result.trace.visits.map((visit) => [visit.exchange, visit.type])).toEqual([
      ['t', 'topic'],
      ['d', 'direct'],
      ['h', 'headers'],
      ['f', 'fanout'],
    ]);
  });

  it('says how each exchange was reached, and nothing for the one that was published to', () => {
    expect(result.trace.visits.map((visit) => visit.via)).toEqual([
      undefined,
      { from: 't', binding: 0 },
      { from: 't', binding: 5 },
      { from: 't', binding: 7 },
    ]);
    expect(Object.hasOwn(result.trace.visits[0] ?? {}, 'via')).toBe(false);
  });

  it('lists every binding that starts from an exchange, matched or not, in the order they were made', () => {
    const first = result.trace.visits[0];

    expect(first?.bindings.map((binding) => [binding.index, binding.destination.name, binding.matched])).toEqual([
      [0, 'd', true],
      [1, 'q', true],
      [2, 'r', false],
      [5, 'h', true],
      [7, 'f', true],
    ]);
  });

  it('says what became of each binding that matched', () => {
    const outcomes = result.trace.visits.flatMap((visit) => visit.bindings.map((binding) => binding.outcome));

    expect(outcomes).toEqual([
      'exchange-visited-next',
      'queue-first-copy',
      undefined,
      'exchange-visited-next',
      'exchange-visited-next',
      'queue-already-had-a-copy',
      undefined,
      undefined,
      'queue-first-copy',
    ]);
  });

  it('says that a binding to an exchange that was already visited was not followed again', () => {
    const cyclic = topology({
      exchanges: [exchange('a', 'fanout'), exchange('b', 'fanout')],
      bindings: [toExchange('a', 'b'), toExchange('b', 'a')],
    });
    const trace = routed(route(cyclic, message('a'))).trace;

    expect(trace.visits.flatMap((visit) => visit.bindings.map((binding) => binding.outcome))).toEqual([
      'exchange-visited-next',
      'exchange-already-visited',
    ]);
  });

  it('shows a topic binding word by word, matched or not', () => {
    const [matched, , missed] = result.trace.visits[0]?.bindings ?? [];

    expect(matched?.match).toEqual({
      kind: 'topic',
      pattern: ['a', '*'],
      key: ['a', 'b'],
      alignment: {
        matched: true,
        segments: [
          { pattern: 'a', words: ['a'] },
          { pattern: '*', words: ['b'] },
        ],
      },
    });
    expect(missed?.match).toMatchObject({
      kind: 'topic',
      alignment: { matched: false, miss: { kind: 'word-differs', patternIndex: 0, keyIndex: 0 } },
    });
  });

  it('shows a direct binding by its key and the routing key', () => {
    const direct = result.trace.visits[1]?.bindings;

    expect(direct?.[0]).toMatchObject({
      destination: { kind: 'queue', name: 'q' },
      key: 'a.b',
      matched: true,
      match: { kind: 'direct', bindingKey: 'a.b', routingKey: 'a.b' },
    });
    expect(direct?.[1]).toMatchObject({ matched: false, match: { kind: 'direct', bindingKey: 'other' } });
  });

  it('shows a headers binding argument by argument, with why one did not pass: 1 is not 1.0', () => {
    const binding = result.trace.visits[2]?.bindings[0];

    expect(binding?.matched).toBe(false);
    expect(binding?.match).toMatchObject({
      kind: 'headers',
      result: {
        xMatch: 'any',
        counted: 1,
        passed: 0,
        conditions: [{ key: 'n', expected: int(1), actual: float(1), outcome: 'fail', reason: 'type-differs' }],
      },
    });
  });

  it('shows a fanout binding, which has nothing to compare', () => {
    expect(result.trace.visits[3]?.bindings[0]).toMatchObject({ matched: true, match: { kind: 'fanout' } });
  });

  it('shows the default exchange as one binding to the queue that has the key as its name, or none', () => {
    const named = routed(route(topology({ queues: ['q'] }), message('', 'q'))).trace;
    const none = routed(route(topology({ queues: ['q'] }), message('', 'x'))).trace;

    expect(named).toEqual({
      exchange: '',
      visits: [
        {
          exchange: '',
          type: 'default',
          bindings: [
            {
              index: null,
              destination: { kind: 'queue', name: 'q' },
              key: 'q',
              matched: true,
              match: { kind: 'default', queue: 'q', routingKey: 'q' },
              outcome: 'queue-first-copy',
            },
          ],
        },
      ],
    });
    expect(none).toEqual({ exchange: '', visits: [{ exchange: '', type: 'default', bindings: [] }] });
  });

  it('lists no queue and an empty path list for a message that no binding matched', () => {
    const miss = routed(route(t, message('d', 'zzz')));

    expect(miss.queues).toEqual([]);
    expect(miss.paths).toEqual([]);
    expect(miss.trace.visits).toHaveLength(1);
  });
});

describe('route: properties of the function itself', () => {
  const t = deepFreeze(
    topology({
      exchanges: [exchange('a', 'topic'), exchange('b', 'headers'), exchange('c', 'fanout')],
      queues: ['q1', 'q2'],
      bindings: [
        toExchange('a', 'b', '#'),
        toExchange('b', 'c', '', headerArguments('all', entry('n', int(1)))),
        toExchange('c', 'a'),
        toQueue('c', 'q1'),
        toQueue('a', 'q2', 'x.#'),
      ],
    }),
  );
  const m = deepFreeze(message('a', 'x.y', [entry('n', int(1)), entry('x-note', str('hi'))]));

  it('does not change what it is given, which a frozen topology and message prove', () => {
    expect(() => route(t, m)).not.toThrow();
  });

  it('gives the same result for the same input, and for a copy of it', () => {
    const first = route(t, m);

    expect(route(t, m)).toEqual(first);
    expect(route(JSON.parse(JSON.stringify(t)), JSON.parse(JSON.stringify(m)))).toEqual(first);
  });

  it('gives a result that can be written as JSON and read back as it was', () => {
    const result = route(t, m);

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
