import { elements, type CanvasDocument, type Id } from '@rmq/domain';
import type { RuntimeView } from '@rmq/engine';
import { DEFAULT_EXCHANGE_ID } from '../state/default-exchange';

/**
 * What a node says about itself while the simulation runs (ADR-0056), worked out from the view of the engine by a function, so that it is tested. A node's
 * component reads the signal of its own node and nothing else, and the signal is set only when what it holds is not what it held.
 */

export interface ProducerStats {
  readonly kind: 'producer';
  /** How many messages it has sent since the counters were last reset. */
  readonly sent: number;
  /** Whether it sends again by itself. */
  readonly repeating: boolean;
}

export interface ExchangeStats {
  readonly kind: 'exchange';
  readonly routed: number;
  readonly unroutable: number;
  readonly refused: number;
}

export interface QueueStats {
  readonly kind: 'queue';
  readonly ready: number;
  readonly unacked: number;
  readonly consumers: number;
}

export interface ConsumerStats {
  readonly kind: 'consumer';
  /** What it holds and has not acknowledged, for all of its queues. */
  readonly holds: number;
  /** What it may hold: its prefetch for each queue that it consumes from, and 0 when there is no limit. */
  readonly limit: number;
  /** It acknowledges for itself, so there is nothing that it holds and has not finished with. */
  readonly acksItself: boolean;
  /** What it has finished with: acknowledged, or handled by a consumer that does that by itself. */
  readonly finished: number;
  /** What has reached it and is waiting for its turn. */
  readonly waiting: number;
  /** Whether it is handling a message now. */
  readonly working: boolean;
}

export type NodeStats = ProducerStats | ExchangeStats | QueueStats | ConsumerStats;

/** The numbers of every node of the canvas, by the id of the node. The default exchange is there too, for when it is drawn. */
export function statsOf(document: CanvasDocument, view: RuntimeView): Map<Id, NodeStats> {
  const stats = new Map<Id, NodeStats>();
  for (const { kind, id, name } of elements(document)) {
    switch (kind) {
      case 'producer': {
        const producer = view.producers[id];
        if (producer !== undefined) {
          stats.set(id, { kind, sent: producer.published, repeating: producer.repeating });
        }
        break;
      }
      case 'exchange': {
        const exchange = view.exchanges[name];
        if (exchange !== undefined) {
          stats.set(id, {
            kind,
            routed: exchange.routed,
            unroutable: exchange.unroutable,
            refused: exchange.refused,
          });
        }
        break;
      }
      case 'queue': {
        const queue = view.queues[name];
        if (queue !== undefined) {
          stats.set(id, { kind, ready: queue.ready, unacked: queue.unacked, consumers: queue.consumers });
        }
        break;
      }
      case 'consumer': {
        const channel = view.channels[id];
        if (channel !== undefined) {
          const live = channel.consumers.filter(({ cancelled }) => !cancelled);
          stats.set(id, {
            kind,
            holds: channel.consumers.reduce((sum, { unacked }) => sum + unacked, 0),
            limit: channel.prefetch === 0 ? 0 : channel.prefetch * Math.max(1, live.length),
            acksItself: live.length > 0 && live.every(({ ack }) => ack === 'auto'),
            finished: channel.consumed,
            waiting: channel.waiting,
            working: channel.working,
          });
        }
        break;
      }
    }
  }
  const defaultExchange = view.exchanges[''];
  if (defaultExchange !== undefined) {
    stats.set(DEFAULT_EXCHANGE_ID, {
      kind: 'exchange',
      routed: defaultExchange.routed,
      unroutable: defaultExchange.unroutable,
      refused: defaultExchange.refused,
    });
  }
  return stats;
}

/** Whether two sets of numbers are the same, which is what decides that a signal need not be set. */
export function sameStats(a: NodeStats | null, b: NodeStats | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}
