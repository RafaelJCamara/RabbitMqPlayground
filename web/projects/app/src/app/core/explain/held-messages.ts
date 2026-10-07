import type { CanvasDocument } from '@rmq/domain';
import type { Message, MessageInfo } from '@rmq/engine';

/**
 * The messages that the log still holds (ADR-0061): each with the document that routed it, so that what an explanation says of it is worked out again as it went, though the canvas has changed since.
 * It holds the last 2,000 that it saw published, and it is its own store and not the rows, which are a record of what was said and not a way to ask.
 */

export const HELD_LIMIT = 2000;

/** How the engine dealt with a message when it arrived at its exchange. */
export type Outcome = 'routed' | 'unroutable' | 'refused';

export interface HeldMessage {
  readonly info: MessageInfo;
  /** The virtual time at which it was published. */
  readonly publishedAt: number;
  /** The canvas that it was published under, which is the one that routes it until the engine says that it did. */
  readonly under: CanvasDocument;
  /** What the engine did with it, or `null` while it is on its way to the broker. */
  readonly outcome: Outcome | null;
  /** The canvas that routed it, or `null` while it is on its way. */
  readonly routedUnder: CanvasDocument | null;
  /** The queues that it was routed to. */
  readonly queues: readonly string[];
}

export class HeldMessages {
  private readonly messages = new Map<number, HeldMessage>();
  private last: number | null = null;

  /** The number of the message that was routed, or refused, most lately: the one that Why? shows while the clock is stopped. */
  get lastSettled(): number | null {
    return this.last;
  }

  get size(): number {
    return this.messages.size;
  }

  published(info: MessageInfo, at: number, under: CanvasDocument): void {
    this.messages.set(info.id, { info, publishedAt: at, under, outcome: null, routedUnder: null, queues: [] });
    // A Map keeps the order that keys were put in, so the first is the oldest.
    if (this.messages.size > HELD_LIMIT) {
      this.messages.delete(this.messages.keys().next().value as number);
    }
  }

  /** The engine routed the message, found nothing for it, or refused it, with this canvas. A message that is not held is not held now. */
  settled(id: number, outcome: Outcome, queues: readonly string[], under: CanvasDocument): void {
    const held = this.messages.get(id);
    if (held !== undefined) {
      this.messages.set(id, { ...held, outcome, queues, routedUnder: under });
      this.last = id;
    }
  }

  get(id: number): HeldMessage | undefined {
    return this.messages.get(id);
  }

  /**
   * The messages that `accept` takes, newest first and at most `limit` of them, and how many it took in all (ADR-0070): the live table of a headers binding shows the last few that reached it, and says how many
   * there were. It looks at every message that is held, which is at most `HELD_LIMIT`, once for each turn in which something was said and only while a table is on the screen.
   */
  recent(
    accept: (held: HeldMessage) => boolean,
    limit: number,
  ): { readonly items: readonly HeldMessage[]; readonly total: number } {
    const oldestFirst = [...this.messages.values()];
    const items: HeldMessage[] = [];
    let total = 0;
    for (const held of oldestFirst.reverse()) {
      if (accept(held)) {
        total += 1;
        if (items.length < limit) {
          items.push(held);
        }
      }
    }
    return { items, total };
  }

  clear(): void {
    this.messages.clear();
    this.last = null;
  }
}

/** A held message as the engine routes it: where it was published, the key and the headers. */
export const messageOf = ({ info }: HeldMessage): Message => ({
  exchange: info.exchange,
  key: info.key,
  headers: info.headers,
});

/** The canvas that a held message is explained with: the one that routed it, and the one that it was published under until then. */
export const explainedUnder = (held: HeldMessage): CanvasDocument => held.routedUnder ?? held.under;
