import { entry, exchange, headerArguments, int, message, toExchange, toQueue, topology } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { explainMiss, type MissReason } from './explain';

/** How many reasons an answer has, counting the ones that are inside others. */
const countReasons = (reasons: readonly MissReason[]): number =>
  reasons.reduce(
    (count, reason) => count + 1 + (reason.kind === 'exchange-not-reached' ? countReasons(reason.because) : 0),
    0,
  );

describe('explainMiss (ADR-0010: "why didn’t it get here?")', () => {
  it('says that a queue was reached, and gives no reason', () => {
    const t = topology({ exchanges: [exchange('d', 'direct')], queues: ['q'], bindings: [toQueue('d', 'q', 'k')] });

    expect(explainMiss(t, message('d', 'k'), 'q')).toEqual({ queue: 'q', reached: true, reasons: [] });
  });

  it('shows the binding that was tried and did not match, with what it made of the message', () => {
    const t = topology({ exchanges: [exchange('d', 'direct')], queues: ['q'], bindings: [toQueue('d', 'q', 'a')] });
    const explanation = explainMiss(t, message('d', 'b'), 'q');

    expect(explanation.reached).toBe(false);
    expect(explanation.reasons).toEqual([
      {
        kind: 'binding-did-not-match',
        binding: 0,
        evaluation: {
          index: 0,
          destination: { kind: 'queue', name: 'q' },
          key: 'a',
          matched: false,
          match: { kind: 'direct', bindingKey: 'a', routingKey: 'b' },
        },
      },
    ]);
  });

  it('gives one reason for each binding that points at the queue', () => {
    const t = topology({
      exchanges: [exchange('d', 'direct'), exchange('t', 'topic'), exchange('h', 'headers')],
      queues: ['q'],
      bindings: [
        toQueue('d', 'q', 'a'),
        toQueue('t', 'q', 'a.#'),
        toQueue('h', 'q', '', headerArguments('all', entry('n', int(1)))),
      ],
    });
    const reasons = explainMiss(t, message('d', 'b'), 'q').reasons;

    expect(reasons.map((reason) => reason.kind)).toEqual([
      'binding-did-not-match',
      'exchange-not-reached',
      'exchange-not-reached',
    ]);
  });

  it('follows a chain back to the binding that stopped the message, and says that the exchanges after it were not reached', () => {
    const t = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'fanout'), exchange('c', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'yes'), toExchange('b', 'c'), toQueue('c', 'q')],
    });
    const [outer] = explainMiss(t, message('a', 'no'), 'q').reasons;

    expect(outer).toMatchObject({ kind: 'exchange-not-reached', binding: 2, exchange: 'c' });
    const [middle] = outer?.kind === 'exchange-not-reached' ? outer.because : [];
    expect(middle).toMatchObject({ kind: 'exchange-not-reached', binding: 1, exchange: 'b' });
    const [inner] = middle?.kind === 'exchange-not-reached' ? middle.because : [];
    expect(inner).toMatchObject({
      kind: 'binding-did-not-match',
      binding: 0,
      evaluation: { matched: false, match: { kind: 'direct', bindingKey: 'yes', routingKey: 'no' } },
    });
  });

  it('says that nothing is bound to a queue, and that nothing is bound to an exchange that was not reached', () => {
    const lone = topology({
      exchanges: [exchange('e', 'fanout')],
      queues: ['q', 'orphan'],
      bindings: [toQueue('e', 'q')],
    });
    const t = topology({
      exchanges: [exchange('a', 'fanout'), exchange('island', 'fanout')],
      queues: ['q'],
      bindings: [toQueue('island', 'q')],
    });

    expect(explainMiss(lone, message('e'), 'orphan').reasons).toEqual([
      { kind: 'no-bindings', destination: { kind: 'queue', name: 'orphan' } },
    ]);
    expect(explainMiss(t, message('a'), 'q').reasons).toEqual([
      {
        kind: 'exchange-not-reached',
        binding: 0,
        exchange: 'island',
        because: [{ kind: 'no-bindings', destination: { kind: 'exchange', name: 'island' } }],
      },
    ]);
  });

  it('ends on a cycle instead of going round it, and says where it came back', () => {
    const t = topology({
      exchanges: [exchange('x', 'fanout'), exchange('y', 'fanout'), exchange('z', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('x', 'y'), toExchange('y', 'x'), toQueue('y', 'q')],
    });
    const [reason] = explainMiss(t, message('z'), 'q').reasons;

    expect(reason).toMatchObject({ kind: 'exchange-not-reached', exchange: 'y' });
    const [viaX] = reason?.kind === 'exchange-not-reached' ? reason.because : [];
    expect(viaX).toMatchObject({ kind: 'exchange-not-reached', exchange: 'x' });
    const [back] = viaX?.kind === 'exchange-not-reached' ? viaX.because : [];
    expect(back).toEqual({ kind: 'cycle', exchange: 'y' });
  });

  it('gives the reasons for an exchange once, where it is first met, and refers to it the next time (ADR-0059)', () => {
    // hub feeds both left and right, and both feed q, but nothing leads into hub from where the message was published.
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

    expect(explainMiss(t, message('start'), 'q').reasons).toEqual([
      {
        kind: 'exchange-not-reached',
        binding: 2,
        exchange: 'left',
        because: [
          {
            kind: 'exchange-not-reached',
            binding: 0,
            exchange: 'hub',
            because: [{ kind: 'no-bindings', destination: { kind: 'exchange', name: 'hub' } }],
          },
        ],
      },
      {
        kind: 'exchange-not-reached',
        binding: 3,
        exchange: 'right',
        because: [{ kind: 'already-explained', exchange: 'hub' }],
      },
    ]);
  });

  it('still says cycle for an exchange that is being explained, and each answer is its own', () => {
    // y and z lead into each other, and x leads into y: asking about x's queue goes through y, then z, then back to y.
    const t = topology({
      exchanges: [
        exchange('start', 'fanout'),
        exchange('y', 'fanout'),
        exchange('z', 'fanout'),
        exchange('x', 'fanout'),
      ],
      queues: ['q', 'r'],
      bindings: [
        toExchange('y', 'z'),
        toExchange('z', 'y'),
        toExchange('y', 'x'),
        toQueue('x', 'q'),
        toQueue('z', 'r'),
      ],
    });
    const [viaX] = explainMiss(t, message('start'), 'q').reasons;
    const [viaY] = viaX?.kind === 'exchange-not-reached' ? viaX.because : [];
    const [viaZ] = viaY?.kind === 'exchange-not-reached' ? viaY.because : [];

    expect(viaX).toMatchObject({ exchange: 'x' });
    expect(viaY).toMatchObject({ exchange: 'y' });
    expect(viaZ).toMatchObject({ kind: 'exchange-not-reached', exchange: 'z' });
    // z is bound from y, which is being explained, so that is a cycle, and not another explanation of y.
    expect(viaZ?.kind === 'exchange-not-reached' ? viaZ.because : []).toEqual([{ kind: 'cycle', exchange: 'y' }]);
    // r is bound from z, which has been explained by now, in the answer for q: but each answer is its own, so r explains z again.
    expect(explainMiss(t, message('start'), 'r').reasons).toMatchObject([{ exchange: 'z' }]);
  });

  it('does not grow with the number of paths: a ladder of 40 diamonds is as long as its bindings, and not 2^40 paths', () => {
    const levels = 40;
    const exchanges = [exchange('start', 'fanout')];
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
    exchanges.push(exchange('island', 'fanout'));
    bindings.push(toQueue(`e${levels}`, 'q'));
    const ladder = topology({ exchanges, queues: ['q'], bindings });

    const { reasons } = explainMiss(ladder, message('start'), 'q');

    expect(countReasons(reasons)).toBeLessThanOrEqual(ladder.bindings.length + ladder.exchanges.length + 1);
    // Every exchange of the ladder is explained once, so the first and the last of them are both there.
    expect(JSON.stringify(reasons)).toContain('"exchange":"island"');
    expect(JSON.stringify(reasons)).toContain(`"exchange":"e${levels}"`);
  });

  it('explains the default exchange: it routes by the name of the queue, and the key was another', () => {
    const t = topology({ queues: ['q', 'other'] });

    expect(explainMiss(t, message('', 'other'), 'q')).toEqual({
      queue: 'q',
      reached: false,
      reasons: [{ kind: 'default-exchange', routingKey: 'other' }],
    });
    expect(explainMiss(t, message('', 'q'), 'q').reached).toBe(true);
  });

  it('says when there is no such queue, and when the publish was refused', () => {
    const t = topology({ exchanges: [exchange('hidden', 'fanout', true)], queues: ['q'] });

    expect(explainMiss(t, message('', 'x'), 'nope').reasons).toEqual([{ kind: 'no-such-queue' }]);
    expect(explainMiss(t, message('open'), 'nope').reasons).toEqual([
      { kind: 'refused', code: 404, text: "NOT_FOUND - no exchange 'open' in vhost '/'" },
    ]);
    expect(explainMiss(t, message('hidden'), 'q').reasons).toEqual([
      {
        kind: 'refused',
        code: 403,
        text: "ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost '/'",
      },
    ]);
  });

  it('refuses a message that could not be sent, as route does', () => {
    expect(() => explainMiss(topology({}), message('', 'a'.repeat(256)), 'q')).toThrow(RangeError);
  });

  it('can be written as JSON and read back as it was', () => {
    const t = topology({
      exchanges: [exchange('a', 'fanout'), exchange('b', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('b', 'a'), toExchange('a', 'b'), toQueue('b', 'q')],
    });
    const explanation = explainMiss(t, message('a'), 'q');
    const nothing = explainMiss(topology({ queues: ['q'] }), message('x'), 'q');

    expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
    expect(JSON.parse(JSON.stringify(nothing))).toEqual(nothing);
  });
});
