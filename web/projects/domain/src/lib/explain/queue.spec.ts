import { deepFreeze, entry, exchange, int, message, str, toExchange, toQueue, topology } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { explainQueue } from './queue';
import type { ReasonNode } from './types';

/** How many reasons an answer has, counting the ones that are inside others. */
const count = (reasons: readonly ReasonNode[]): number =>
  reasons.reduce(
    (total, reason) => total + 1 + (reason.kind === 'exchange-not-reached' ? count(reason.because) : 0),
    0,
  );

const orders = topology({
  exchanges: [exchange('orders', 'topic'), exchange('payments', 'fanout'), exchange('hub', 'direct')],
  queues: ['billing', 'audit', 'archive'],
  bindings: [
    toQueue('orders', 'billing', 'order.*'),
    toQueue('orders', 'audit', 'payment.*'),
    toExchange('orders', 'payments', 'pay.#.done'),
    toQueue('payments', 'audit'),
    toQueue('hub', 'archive', 'x'),
  ],
});
const created = message('orders', 'order.created');

describe('explainQueue: a queue that got the message (ADR-0060)', () => {
  it('says that it did, and the bindings that took the message there', () => {
    const explanation = explainQueue(orders, created, 'billing');

    expect(explanation).toMatchObject({
      queue: 'billing',
      reached: true,
      text: 'The queue billing got a copy of the message.',
      because: [],
    });
    expect(explanation.path).toHaveLength(1);
    expect(explanation.path[0]).toMatchObject({
      index: 0,
      from: 'orders',
      to: { kind: 'queue', name: 'billing' },
      verdict: 'matched',
      followed: true,
    });
  });

  it('gives the whole way for a queue that is reached through other exchanges', () => {
    const chain = topology({
      exchanges: [exchange('a', 'fanout'), exchange('b', 'direct'), exchange('c', 'topic')],
      queues: ['q'],
      bindings: [toExchange('a', 'b'), toExchange('b', 'c', 'k'), toQueue('c', 'q', '#')],
    });
    const { path } = explainQueue(chain, message('a', 'k'), 'q');

    expect(path.map(({ from, to, label }) => `${from} -> ${to.name} (${label})`)).toEqual([
      'a -> b (any key)',
      'b -> c ("k")',
      'c -> q ("#")',
    ]);
  });

  it('gives the way through the default exchange for a queue that the key names', () => {
    const { path } = explainQueue(topology({ queues: ['billing', 'audit'] }), message('', 'audit'), 'audit');

    expect(path).toHaveLength(1);
    expect(path[0]).toMatchObject({
      index: null,
      from: '',
      to: { name: 'audit' },
      verdict: 'matched',
      short: 'named by the key',
    });
  });
});

describe('explainQueue: a queue that did not', () => {
  it('says which binding was tried and did not match, with what it made of the message', () => {
    const explanation = explainQueue(orders, created, 'archive');

    expect(explanation.reached).toBe(false);
    expect(explanation.text).toBe('The queue archive did not get the message.');
    expect(explanation.path).toEqual([]);
    expect(explanation.because).toHaveLength(1);
    const [reason] = explanation.because;
    expect(reason).toMatchObject({ kind: 'exchange-not-reached', binding: 4, exchange: 'hub' });
    expect(reason?.text).toBe('hub is bound to queue archive ("x"), but the message never reached hub.');
  });

  it('gives one reason for each binding that points at the queue, with the sentence of the binding and what it compared', () => {
    const { because } = explainQueue(orders, created, 'audit');

    expect(because.map(({ kind }) => kind)).toEqual(['binding-did-not-match', 'exchange-not-reached']);
    const [tried, notReached] = because;
    expect(tried?.text).toBe(
      'The binding from orders to queue audit ("payment.*") was tried, and it did not match. The pattern "payment.*" does not match the key "order.created": the first word of the key is "order", and the pattern asks for "payment".',
    );
    expect(tried?.kind === 'binding-did-not-match' && tried.binding.detail).toMatchObject({
      kind: 'topic',
      miss: { kind: 'word-differs', patternIndex: 0, keyIndex: 0 },
    });
    expect(notReached?.text).toBe(
      'payments is bound to queue audit (any key), but the message never reached payments.',
    );
    const [inner] = notReached?.kind === 'exchange-not-reached' ? notReached.because : [];
    expect(inner?.kind).toBe('binding-did-not-match');
    expect(inner?.text).toContain(
      'The binding from orders to exchange payments ("pay.#.done") was tried, and it did not match.',
    );
  });

  it('says that nothing is bound to a queue, and that nothing is bound to an exchange that the message did not reach', () => {
    const lone = topology({ exchanges: [exchange('e', 'fanout')], queues: ['orphan'] });
    const island = topology({
      exchanges: [exchange('a', 'fanout'), exchange('island', 'fanout')],
      queues: ['q'],
      bindings: [toQueue('island', 'q')],
    });

    expect(explainQueue(lone, message('e'), 'orphan').because).toEqual([
      {
        kind: 'no-bindings',
        text: 'Nothing is bound to the queue orphan, so no message can get there by a binding.',
        destination: { kind: 'queue', name: 'orphan' },
      },
    ]);
    const [reason] = explainQueue(island, message('a'), 'q').because;
    expect(reason).toMatchObject({ kind: 'exchange-not-reached', exchange: 'island' });
    expect(reason?.kind === 'exchange-not-reached' && reason.because).toEqual([
      {
        kind: 'no-bindings',
        text: 'Nothing is bound to the exchange island, so nothing leads into it and the message cannot reach it.',
        destination: { kind: 'exchange', name: 'island' },
      },
    ]);
  });

  it('says that exchanges that only lead into each other are a cycle that the message never entered', () => {
    const t = topology({
      exchanges: [exchange('z', 'fanout'), exchange('x', 'fanout'), exchange('y', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('x', 'y'), toExchange('y', 'x'), toQueue('y', 'q')],
    });
    const [viaY] = explainQueue(t, message('z'), 'q').because;
    const [viaX] = viaY?.kind === 'exchange-not-reached' ? viaY.because : [];
    const [back] = viaX?.kind === 'exchange-not-reached' ? viaX.because : [];

    expect(viaY).toMatchObject({ exchange: 'y' });
    expect(viaX).toMatchObject({ exchange: 'x' });
    expect(back).toEqual({
      kind: 'cycle',
      text: 'The exchange y is part of a cycle that this explanation is already inside: the exchanges in it only lead into each other, and nothing that the message reached leads into them.',
      exchange: 'y',
    });
  });

  it('refers to an exchange that was explained already, and says where', () => {
    const t = topology({
      exchanges: [
        exchange('start', 'fanout'),
        exchange('hub', 'fanout'),
        exchange('left', 'fanout'),
        exchange('right', 'fanout'),
      ],
      queues: ['q'],
      bindings: [toExchange('hub', 'left'), toExchange('hub', 'right'), toQueue('left', 'q'), toQueue('right', 'q')],
    });
    const [, viaRight] = explainQueue(t, message('start'), 'q').because;

    expect(viaRight?.kind === 'exchange-not-reached' && viaRight.because).toEqual([
      {
        kind: 'already-explained',
        text: 'Why the message did not reach the exchange hub is given above, where it was first met.',
        exchange: 'hub',
      },
    ]);
  });

  it('says that the default exchange sends a message to the queue that its key names, and no other', () => {
    const { because } = explainQueue(topology({ queues: ['a', 'b'] }), message('', 'a'), 'b');

    expect(because).toEqual([
      {
        kind: 'default-exchange',
        text: 'The message was published to the default exchange, which sends it to the queue that is named by its key, "a", and not to b.',
        routingKey: 'a',
      },
    ]);
  });

  it('says a binding that starts from an exchange that is not declared as it is, with its key, and that nothing leads into it', () => {
    const t = topology({
      exchanges: [exchange('start', 'fanout')],
      queues: ['q'],
      bindings: [toQueue('ghost', 'q', 'k')],
    });
    const [reason] = explainQueue(t, message('start'), 'q').because;

    expect(reason?.text).toBe('ghost is bound to queue q ("k"), but the message never reached ghost.');
    expect(reason?.kind === 'exchange-not-reached' && reason.because.map(({ kind }) => kind)).toEqual(['no-bindings']);
  });

  it('says that there is no such queue', () => {
    expect(explainQueue(orders, created, 'nope').because).toEqual([
      { kind: 'no-such-queue', text: 'There is no queue called "nope".' },
    ]);
  });

  it('says the cause of a refused publish first and the broker reply after it, for every queue', () => {
    const t = topology({ exchanges: [exchange('hidden', 'fanout', true)], queues: ['q'] });
    const explanation = explainQueue(t, message('hidden'), 'q');

    expect(explanation).toMatchObject({
      reached: false,
      text: 'The broker refuses the publish, so q did not get the message.',
    });
    expect(explanation.because).toEqual([
      {
        kind: 'refused',
        text: "hidden is an internal exchange, which a client cannot publish to and only another exchange can send messages to, so the broker refuses the publish. Its reply is 403 ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost '/'.",
        code: 403,
        reply: "ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost '/'",
      },
    ]);
  });

  it('does not throw for a message that could not be sent, and says why', () => {
    const explanation = explainQueue(orders, message('orders', 'x'.repeat(300)), 'billing');

    expect(explanation).toEqual({
      queue: 'billing',
      reached: false,
      text: 'The message cannot be sent, so billing did not get it.',
      path: [],
      because: [{ kind: 'invalid', text: 'A routing key is at most 255 bytes of UTF-8, and this one is 300.' }],
    });
  });

  it('says the way a headers binding failed, condition by condition', () => {
    const t = topology({
      exchanges: [exchange('docs', 'headers')],
      queues: ['pdfs'],
      bindings: [
        {
          source: 'docs',
          destination: { kind: 'queue', name: 'pdfs' },
          key: '',
          headers: { xMatch: 'all', args: [entry('format', str('pdf')), entry('n', int(1))] },
        },
      ],
    });
    const [reason] = explainQueue(t, message('docs', '', [entry('format', str('doc'))]), 'pdfs').because;

    expect(reason?.kind === 'binding-did-not-match' && reason.binding.detail).toMatchObject({
      kind: 'headers',
      counted: 2,
      passed: 0,
      conditions: [
        { key: 'format', outcome: 'fail', found: '"doc"' },
        { key: 'n', outcome: 'fail', found: null },
      ],
    });
  });
});

describe('explainQueue, as a function', () => {
  it('does not change what it is given, and gives plain data: the same every time, and the same after a trip through JSON', () => {
    const frozen = deepFreeze(structuredClone(orders));
    const m = deepFreeze(structuredClone(created));
    for (const queue of orders.queues) {
      const explanation = explainQueue(frozen, m, queue);

      expect(explainQueue(frozen, m, queue)).toEqual(explanation);
      expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
    }
  });

  it('is as big as the topology, however many paths there are: a ladder of forty diamonds is answered in a blink', () => {
    const levels = 40;
    const exchanges = [exchange('start', 'fanout'), exchange('island', 'fanout')];
    const bindings = [];
    for (let level = 0; level < levels; level++) {
      const from = level === 0 ? 'island' : `e${level}`;
      exchanges.push(
        exchange(`a${level}`, 'fanout'),
        exchange(`b${level}`, 'fanout'),
        exchange(`e${level + 1}`, 'fanout'),
      );
      bindings.push(
        toExchange(from, `a${level}`),
        toExchange(from, `b${level}`),
        toExchange(`a${level}`, `e${level + 1}`),
        toExchange(`b${level}`, `e${level + 1}`),
      );
    }
    bindings.push(toQueue(`e${levels}`, 'q'));
    const ladder = topology({ exchanges, queues: ['q'], bindings });

    const { because } = explainQueue(ladder, message('start'), 'q');

    expect(count(because)).toBeLessThanOrEqual(ladder.bindings.length + ladder.exchanges.length + 1);
  });
});
