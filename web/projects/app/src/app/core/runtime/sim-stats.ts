import { Injectable, signal, type Signal, type WritableSignal } from '@angular/core';
import type { Id } from '@rmq/domain';
import { sameStats, type NodeStats } from './stats';

/**
 * The numbers of the nodes, a signal for each (ADR-0056). A node's component reads the signal of its own node, so that a burst of messages to one
 * queue checks the component of that queue and not the template of the adapter or the other nodes, and a frame that moves messages and finishes none
 * sets none. A node that the engine says nothing of has `null`.
 */
@Injectable()
export class SimStats {
  private readonly signals = new Map<Id, WritableSignal<NodeStats | null>>();

  /** The numbers of a node. It is the same signal each time that it is asked for, whether or not the node has numbers yet. */
  of(id: Id): Signal<NodeStats | null> {
    return this.writable(id).asReadonly();
  }

  /** Sets the signal of each node whose numbers changed, and clears the one of each that has none now. It answers how many it set. */
  apply(next: ReadonlyMap<Id, NodeStats>): number {
    let set = 0;
    for (const [id, stats] of next) {
      set += this.put(id, stats);
    }
    for (const id of this.signals.keys()) {
      if (!next.has(id)) {
        set += this.put(id, null);
      }
    }
    return set;
  }

  private put(id: Id, stats: NodeStats | null): number {
    const signal = this.writable(id);
    if (sameStats(signal(), stats)) {
      return 0;
    }
    signal.set(stats);
    return 1;
  }

  private writable(id: Id): WritableSignal<NodeStats | null> {
    let found = this.signals.get(id);
    if (found === undefined) {
      found = signal<NodeStats | null>(null);
      this.signals.set(id, found);
    }
    return found;
  }
}
