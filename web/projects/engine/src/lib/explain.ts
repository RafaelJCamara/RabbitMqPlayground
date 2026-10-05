import { route, type BindingEvaluation, type Routed } from './route';
import type { Destination, Message, Topology } from './topology';

/**
 * Why a queue did not get a message (ADR-0010: click any queue to ask "why didn't it get here?"). It is read off the
 * trace of `route`, so it can only say what the router did.
 */

export type MissReason =
  /** The publish was refused, so the message reached nothing. */
  | { readonly kind: 'refused'; readonly code: 403 | 404; readonly text: string }
  | { readonly kind: 'no-such-queue' }
  /** Published to the default exchange, which routes by the name of a queue, and the key was not this one's. */
  | { readonly kind: 'default-exchange'; readonly routingKey: string }
  /** Nothing is bound to this queue or exchange, so a message cannot get there by a binding. */
  | { readonly kind: 'no-bindings'; readonly destination: Destination }
  /** The exchange that the binding starts from got the message, tried this binding, and it did not match. */
  | { readonly kind: 'binding-did-not-match'; readonly binding: number; readonly evaluation: BindingEvaluation }
  /** The binding starts from an exchange that the message never reached, and `because` says why that is. */
  | {
      readonly kind: 'exchange-not-reached';
      readonly binding: number;
      readonly exchange: string;
      readonly because: readonly MissReason[];
    }
  /** The explanation has come back round to an exchange that it is already explaining. */
  | { readonly kind: 'cycle'; readonly exchange: string };

export interface MissExplanation {
  readonly queue: string;
  readonly reached: boolean;
  /** One for each way that the queue could have been reached. Empty when it was. */
  readonly reasons: readonly MissReason[];
}

/** Why `queue` did not get `message`, or that it did. Throws what `route` throws for a message that cannot be sent. */
export function explainMiss(topology: Topology, message: Message, queue: string): MissExplanation {
  const result = route(topology, message);
  if (!result.ok) {
    return { queue, reached: false, reasons: [{ kind: 'refused', code: result.code, text: result.text }] };
  }
  if (result.queues.includes(queue)) {
    return { queue, reached: true, reasons: [] };
  }
  if (!topology.queues.includes(queue)) {
    return { queue, reached: false, reasons: [{ kind: 'no-such-queue' }] };
  }
  if (message.exchange === '') {
    return { queue, reached: false, reasons: [{ kind: 'default-exchange', routingKey: message.key }] };
  }
  return {
    queue,
    reached: false,
    reasons: explainDestination(topology, result, { kind: 'queue', name: queue }, new Set()),
  };
}

function explainDestination(
  topology: Topology,
  result: Routed,
  destination: Destination,
  explaining: ReadonlySet<string>,
): MissReason[] {
  const incoming = topology.bindings.flatMap((binding, index) =>
    binding.destination.kind === destination.kind && binding.destination.name === destination.name
      ? [{ binding, index }]
      : [],
  );
  if (incoming.length === 0) {
    return [{ kind: 'no-bindings', destination }];
  }

  return incoming.map(({ binding, index }): MissReason => {
    const visit = result.trace.visits.find((candidate) => candidate.exchange === binding.source);
    const evaluation = visit?.bindings.find((candidate) => candidate.index === index);
    if (evaluation !== undefined) {
      return { kind: 'binding-did-not-match', binding: index, evaluation };
    }
    if (explaining.has(binding.source)) {
      return { kind: 'cycle', exchange: binding.source };
    }
    return {
      kind: 'exchange-not-reached',
      binding: index,
      exchange: binding.source,
      because: explainDestination(
        topology,
        result,
        { kind: 'exchange', name: binding.source },
        new Set([...explaining, binding.source]),
      ),
    };
  });
}
