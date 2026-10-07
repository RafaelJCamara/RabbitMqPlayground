import { route, type Message, type Topology } from '@rmq/engine';
import { arbMessageFor, arbTopology } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explainQueue } from './queue';
import { explainRoute } from './route';
import { explanationText } from './text';
import type { BindingNode, ExchangeNode, ReasonNode } from './types';

/**
 * What the explanation of a route owes to the engine, for any topology (ADR-0060): it says what `route` did, it gives a reason for each queue that was missed, it is bounded by the size of the topology,
 * it never throws, and it is plain data and the same text every time. The seed and the number of runs come from FC_SEED and FC_NUM_RUNS (`@rmq/testing`).
 */

const arbCase: fc.Arbitrary<{ topology: Topology; message: Message }> = arbTopology.chain((generated) =>
  arbMessageFor(generated).map((generatedMessage) => ({ topology: generated, message: generatedMessage })),
);

/** A message that a client may or may not be able to send: long keys, and header values that are not exact. */
const arbAnyMessage: fc.Arbitrary<Message> = fc.record({
  exchange: fc.constantFrom('', 'x0', 'x1', 'missing'),
  key: fc.oneof(fc.string({ maxLength: 40 }), fc.string({ minLength: 250, maxLength: 300 })),
  headers: fc.array(
    fc.record({
      key: fc.constantFrom('a', 'b', 'x-c'),
      value: fc.oneof(
        fc.string({ maxLength: 4 }).map((v) => ({ t: 'string' as const, v })),
        fc
          .oneof(fc.integer(), fc.constant(2 ** 60), fc.constant(Number.MAX_SAFE_INTEGER + 2))
          .map((v) => ({ t: 'integer' as const, v })),
        fc
          .oneof(fc.double({ noNaN: true }), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY))
          .map((v) => ({ t: 'float' as const, v })),
      ),
    }),
    { maxLength: 3 },
  ),
});

function bindingsOf(root: ExchangeNode): BindingNode[] {
  const found: BindingNode[] = [];
  const stack = [...root.bindings].reverse();
  for (let binding = stack.pop(); binding !== undefined; binding = stack.pop()) {
    found.push(binding);
    if (binding.next !== null) {
      stack.push(...[...binding.next.bindings].reverse());
    }
  }
  return found;
}

const reasonCount = (reasons: readonly ReasonNode[]): number =>
  reasons.reduce(
    (total, reason) => total + 1 + (reason.kind === 'exchange-not-reached' ? reasonCount(reason.because) : 0),
    0,
  );

describe('explainRoute, as a property', () => {
  it('says the queues that route reached, in the same order, and the queues that it did not, in the order of the topology', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const explanation = explainRoute(t, m);
        const result = route(t, m);

        if (!result.ok) {
          expect(explanation).toMatchObject({ outcome: 'refused', code: result.code, reply: result.text });
          return;
        }
        expect(explanation.outcome === 'routed' || explanation.outcome === 'unroutable').toBe(true);
        if (explanation.outcome === 'routed' || explanation.outcome === 'unroutable') {
          expect(explanation.queues).toEqual(result.queues);
          expect(explanation.outcome).toBe(result.queues.length === 0 ? 'unroutable' : 'routed');
          expect(explanation.unreached).toEqual(t.queues.filter((queue) => !result.queues.includes(queue)));
          expect(explanation.paths).toEqual(result.paths);
        }
      }),
    );
  });

  it('has a node for each exchange that the message reached, and a binding for each one that they tried, each with the verdict of the engine', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const explanation = explainRoute(t, m);
        const result = route(t, m);
        fc.pre(result.ok && (explanation.outcome === 'routed' || explanation.outcome === 'unroutable'));
        if (!result.ok || (explanation.outcome !== 'routed' && explanation.outcome !== 'unroutable')) {
          return;
        }

        const evaluations = result.trace.visits.flatMap((visit) => visit.bindings);
        const nodes = bindingsOf(explanation.root);
        if (m.exchange === '') {
          // The default exchange lists a binding for each queue, and the one that matched is the one that the engine found.
          expect(nodes).toHaveLength(t.queues.length);
          expect(nodes.filter(({ verdict }) => verdict === 'matched').map(({ to }) => to.name)).toEqual(
            evaluations.filter(({ matched }) => matched).map(({ destination }) => destination.name),
          );
          return;
        }
        expect(nodes).toHaveLength(evaluations.length);
        expect(nodes.map(({ index, verdict }) => [index, verdict]).sort()).toEqual(
          evaluations.map(({ index, matched }) => [index, matched ? 'matched' : 'missed']).sort(),
        );
        // A binding is followed exactly when it gave a queue its first copy or took the message to an exchange that had not been reached.
        for (const node of nodes) {
          const evaluation = evaluations.find(({ index }) => index === node.index);
          expect(node.followed).toBe(
            evaluation?.outcome === 'queue-first-copy' || evaluation?.outcome === 'exchange-visited-next',
          );
          expect(node.next !== null).toBe(evaluation?.outcome === 'exchange-visited-next');
        }
      }),
    );
  });

  it('never throws, whatever the message: one that no client could send is invalid, and says why', () => {
    fc.assert(
      fc.property(arbTopology, arbAnyMessage, (t, m) => {
        const explanation = explainRoute(t, m);

        expect(['invalid', 'refused', 'routed', 'unroutable']).toContain(explanation.outcome);
        for (const queue of t.queues) {
          expect(explainQueue(t, m, queue).queue).toBe(queue);
        }
        expect(
          typeof explanationText(
            explanation,
            t.queues.map((queue) => explainQueue(t, m, queue)),
          ),
        ).toBe('string');
      }),
    );
  });

  it('is plain data that survives JSON, and gives the same answer, and the same text, every time', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const explanation = explainRoute(t, m);
        const queues = t.queues.map((queue) => explainQueue(t, m, queue));
        const text = explanationText(explanation, queues);

        expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
        expect(JSON.parse(JSON.stringify(queues))).toEqual(queues);
        expect(explainRoute(t, m)).toEqual(explanation);
        expect(
          explanationText(
            explainRoute(t, m),
            t.queues.map((queue) => explainQueue(t, m, queue)),
          ),
        ).toBe(text);
        expect(text.includes('\r')).toBe(false);
        expect(text.endsWith('\n')).toBe(true);
        expect(text.endsWith('\n\n')).toBe(false);
      }),
    );
  });

  it('says in its text the queues that were reached, which a check against the broker reads', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const explanation = explainRoute(t, m);
        const reached = explanationText(explanation)
          .split('\n')
          .find((line) => line.startsWith('reached: '));
        const wanted =
          explanation.outcome === 'routed' || explanation.outcome === 'unroutable'
            ? explanation.queues.length === 0
              ? 'nothing'
              : explanation.queues.join(', ')
            : 'nothing';

        expect(reached).toBe(`reached: ${wanted}`);
      }),
    );
  });
});

describe('explainQueue, as a property', () => {
  it('says that a queue was reached exactly when route says so, with a way in when it was and a reason when it was not', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        const result = route(t, m);
        for (const queue of t.queues) {
          const explanation = explainQueue(t, m, queue);
          const reached = result.ok && result.queues.includes(queue);

          expect(explanation.reached).toBe(reached);
          expect(explanation.because.length === 0).toBe(reached);
          expect(explanation.path.length > 0).toBe(reached);
          if (reached) {
            expect(explanation.path.at(-1)?.to).toEqual({ kind: 'queue', name: queue });
            expect(explanation.path[0]?.from).toBe(m.exchange);
            expect(explanation.path.every(({ verdict }) => verdict === 'matched')).toBe(true);
          }
        }
      }),
    );
  });

  it('is as big as the topology and no bigger: at most a reason for each binding, each exchange and the queue', () => {
    fc.assert(
      fc.property(arbCase, ({ topology: t, message: m }) => {
        for (const queue of t.queues) {
          expect(reasonCount(explainQueue(t, m, queue).because)).toBeLessThanOrEqual(
            t.bindings.length + t.exchanges.length + 1,
          );
        }
      }),
    );
  });
});
