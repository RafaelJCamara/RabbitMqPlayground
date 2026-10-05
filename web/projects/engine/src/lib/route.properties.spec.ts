import { arbMessageFor, arbTopology, exchange, message, toExchange, toQueue, topology } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explainMiss } from './explain';
import { route, type Routed } from './route';
import type { Message, Topology } from './topology';

/**
 * The invariants of routing (ADR-0015), for any topology, including ones with chains, diamonds, cycles and exchanges
 * bound to themselves. The seed and the number of runs come from FC_SEED and FC_NUM_RUNS (`@rmq/testing`).
 */

const arbCase: fc.Arbitrary<{ topology: Topology; message: Message }> = arbTopology.chain((generated) =>
  arbMessageFor(generated).map((generatedMessage) => ({ topology: generated, message: generatedMessage })),
);

const publishable = (result: ReturnType<typeof route>): Routed => {
  fc.pre(result.ok);
  return result as Routed;
};

describe('route, as a property', () => {
  it('terminates on any topology, visiting each exchange at most once, however they are bound', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = route(t, m);
        if (result.ok) {
          const names = result.trace.visits.map((visit) => visit.exchange);

          expect(new Set(names).size).toBe(names.length);
          expect(names.length).toBeLessThanOrEqual(t.exchanges.length + 1);
        }
      }),
    );
  });

  it('terminates on a ring of exchanges, reaching the queue of each one exactly once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 11 }), (size, start) => {
        const names = Array.from({ length: size }, (_, index) => `x${index}`);
        const ring = topology({
          exchanges: names.map((name) => exchange(name, 'fanout')),
          queues: names.map((name) => `q-${name}`),
          bindings: names.flatMap((name, index) => [
            toExchange(name, names[(index + 1) % size] as string),
            toExchange(name, name),
            toQueue(name, `q-${name}`),
          ]),
        });
        const result = publishable(route(ring, message(names[start % size] as string)));

        expect([...result.queues].sort()).toEqual(names.map((name) => `q-${name}`).sort());
        expect(result.trace.visits).toHaveLength(size);
      }),
    );
  });

  it('gives each queue at most one copy, and only a queue that the topology has', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = publishable(route(t, m));

        expect(new Set(result.queues).size).toBe(result.queues.length);
        for (const queue of result.queues) {
          expect(t.queues).toContain(queue);
        }
        expect(result.paths.map((path) => path.queue)).toEqual(result.queues);
      }),
    );
  });

  it('is deterministic: the same input gives the same result, and so does a copy of it', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const first = route(t, m);

        expect(route(t, m)).toEqual(first);
        expect(route(JSON.parse(JSON.stringify(t)) as Topology, JSON.parse(JSON.stringify(m)) as Message)).toEqual(
          first,
        );
      }),
    );
  });

  it('gives a result that survives JSON, with nothing left undefined', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = route(t, m);

        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      }),
    );
  });

  it('never loses a queue when a binding is added, because a binding can only add a way to reach one', () => {
    fc.assert(
      fc.property(arbCase, arbCase, ({ topology: t, message: m }, { topology: other }) => {
        const before = publishable(route(t, m));
        const extra = other.bindings.filter(
          (binding) =>
            t.exchanges.some((candidate) => candidate.name === binding.source) &&
            t.queues.includes(binding.destination.name) !== (binding.destination.kind === 'exchange'),
        );
        const after = publishable(route({ ...t, bindings: [...t.bindings, ...extra] }, m));

        for (const queue of before.queues) {
          expect(after.queues).toContain(queue);
        }
      }),
    );
  });

  it('gives paths that are chains from the exchange published to, along bindings that matched', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = publishable(route(t, m));
        const evaluations = new Map(
          result.trace.visits.flatMap((visit) => visit.bindings.map((binding) => [binding.index, binding] as const)),
        );

        for (const path of result.paths) {
          let at = m.exchange;
          for (const hop of path.hops) {
            expect(hop.from).toBe(at);
            if (hop.binding !== null) {
              expect(evaluations.get(hop.binding)?.matched).toBe(true);
              expect(t.bindings[hop.binding]?.source).toBe(hop.from);
            }
            at = hop.to.name;
          }
          expect(at).toBe(path.queue);
        }
      }),
    );
  });

  it('lists in each visit every binding that starts from the exchange, and follows only a matched one', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = publishable(route(t, m));

        for (const visit of result.trace.visits) {
          const own = t.bindings.flatMap((binding, index) => (binding.source === visit.exchange ? [index] : []));
          expect(visit.bindings.map((binding) => binding.index)).toEqual(
            m.exchange === '' ? [...visit.bindings.map((b) => b.index)] : own,
          );
          if (visit.via !== undefined) {
            const reached = result.trace.visits
              .find((candidate) => candidate.exchange === visit.via?.from)
              ?.bindings.find((binding) => binding.index === visit.via?.binding);
            expect(reached).toMatchObject({ matched: true, outcome: 'exchange-visited-next' });
          }
        }
      }),
    );
  });

  it('refuses exactly when the exchange is missing or internal, and the default exchange sends to the queue of that name', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = route(t, m);
        const target = t.exchanges.find((candidate) => candidate.name === m.exchange);

        if (m.exchange === '') {
          expect(result).toMatchObject({ ok: true, queues: t.queues.includes(m.key) ? [m.key] : [] });
        } else if (target === undefined) {
          expect(result).toMatchObject({ ok: false, code: 404 });
        } else if (target.internal) {
          expect(result).toMatchObject({ ok: false, code: 403 });
        } else {
          expect(result.ok).toBe(true);
        }
      }),
    );
  });
});

describe('explainMiss, as a property', () => {
  it('says that a queue was reached exactly when route says so, and has a reason when it was not', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = route(t, m);
        for (const queue of t.queues) {
          const explanation = explainMiss(t, m, queue);

          expect(explanation.reached).toBe(result.ok && result.queues.includes(queue));
          expect(explanation.reasons.length === 0).toBe(explanation.reached);
          expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
        }
      }),
    );
  });
});
