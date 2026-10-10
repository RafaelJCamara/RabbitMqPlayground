import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { lookup, type CanvasDocument, type Id } from '@rmq/domain';
import type { EngineEvent, MessageInfo } from '@rmq/engine';
import { Simulation } from '../runtime/simulation';
import { DocumentStore } from '../state/document-store';

/** How many rows of received messages a consumer keeps (ADR-0098). The oldest go. */
export const INBOX_ROWS = 100;

/** How many published messages the inbox remembers, so that a row can say what it carried: as many as the log keeps rows (`LOG_CAP`), and not the 2,000 that the log holds the messages of. */
export const INBOX_MESSAGES = 5000;

/** Where a message is with a consumer, in the words of the engine's events, and `cleared` for one that "Clear messages" took out of the simulation before the consumer had finished with it (ADR-0105). */
export type ReceivedState = 'on its way' | 'received' | 'processed' | 'acked' | 'requeued' | 'cleared';

/** One message that a queue gave to a consumer. */
export interface ReceivedRow {
  /** Which row it is, for as long as the inbox lives: what a list tracks it by. A message that is given again is another row. */
  readonly seq: number;
  readonly message: number;
  readonly queue: string;
  /** The virtual time at which the queue gave it to the consumer. */
  readonly at: number;
  readonly redelivered: boolean;
  readonly state: ReceivedState;
  /** What was published, or `null` when the inbox does not hold it any more. */
  readonly info: MessageInfo | null;
}

/**
 * What each consumer was given, with the payload, for its inspector (ADR-0098). It listens to the engine from the moment that the editor opens, as the log does, so that nothing that was given is
 * missing when a consumer is selected. A row is added when a queue gives a message to a consumer, and it moves through received, processed and acknowledged, or to requeued, as the engine says it
 * does. It is its own store and not the log: the log holds rows of text and 2,000 messages, and this holds the last hundred of each consumer and is read by the node that it is about.
 *
 * It is the session's: a canvas that is opened empties it, and a consumer that is deleted takes its rows. A learner can also empty the list of one consumer (`clear`, ADR-0105), which is only a view: nothing in the engine or the
 * document changes, and what the consumer is given afterwards starts a new list. A tag that is taken again after a cancel is the same node (ADR-0089), so its list goes on,
 * and a message that it is given again is a new row marked redelivered.
 */
@Injectable()
export class ConsumerInbox {
  private readonly simulation = inject(Simulation);
  private readonly store = inject(DocumentStore);

  /** The rows of each consumer, by the id of its node, oldest first. */
  private readonly rows = new Map<Id, ReceivedRow[]>();
  /** What was published, by the number of the message, oldest first: a Map keeps the order that keys were put in. */
  private readonly published = new Map<number, MessageInfo>();
  private next = 1;
  private readonly revision = signal(0);

  /** Changes when a row was added or moved on, once for each turn in which something was said. */
  readonly changed = this.revision.asReadonly();

  constructor() {
    const stopEvents = this.simulation.onEvents((events, about) => this.apply(events, about));
    const stopStore = this.store.subscribe((document, cause) => {
      if (cause === 'load') {
        this.reset();
        return;
      }
      let removed = false;
      for (const id of [...this.rows.keys()]) {
        if (lookup(document.consumers, id) === undefined) {
          this.rows.delete(id);
          removed = true;
        }
      }
      if (removed) {
        this.revision.update((count) => count + 1);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      stopEvents();
      stopStore();
    });
  }

  /** What the engine said, in order, about this canvas. The simulation calls it after each command and each advance of the clock; a spec calls it with the events that it needs. */
  apply(events: readonly EngineEvent[], about: CanvasDocument): void {
    let touched = false;
    for (const event of events) {
      switch (event.type) {
        case 'published':
          this.remember(event.message);
          break;
        case 'delivered':
          // A consumer that is not on the canvas (it was deleted in this turn) is given nothing to show.
          if (lookup(about.consumers, event.channel) !== undefined) {
            this.add(event.channel, {
              seq: this.next++,
              message: event.message,
              queue: event.queue,
              at: event.at,
              redelivered: event.redelivered,
              state: 'on its way',
              info: this.published.get(event.message) ?? null,
            });
            touched = true;
          }
          break;
        case 'received':
          touched = this.move(event.channel, event.message, 'received') || touched;
          break;
        case 'processed':
          touched = this.move(event.channel, event.message, 'processed') || touched;
          break;
        case 'acked':
          touched = this.move(event.channel, event.message, 'acked') || touched;
          break;
        case 'requeued':
          touched = this.move(event.channel, event.message, 'requeued') || touched;
          break;
        case 'cleared':
          // "Clear messages" takes every message that was on its way or being handled out of the simulation, so a row that was not finished is marked, and those that were are left as they are.
          touched = this.markUnfinishedCleared() || touched;
          break;
        default:
          break;
      }
    }
    if (touched) {
      this.revision.update((count) => count + 1);
    }
  }

  /** What the consumer was given, newest first: the last `INBOX_ROWS` of it. Read it again when `changed` changes. */
  of(consumer: Id): readonly ReceivedRow[] {
    return [...(this.rows.get(consumer) ?? [])].reverse();
  }

  /** Empties the list of one consumer, and nothing else (ADR-0105). It is the view only: the engine, the document and the other consumers are as they were, and there is no command and no undo. */
  clear(consumer: Id): void {
    if ((this.rows.get(consumer)?.length ?? 0) > 0) {
      this.rows.set(consumer, []);
      this.revision.update((count) => count + 1);
    }
  }

  /** The rows of a consumer as a signal, so that what shows them follows the engine. */
  rowsOf(consumer: () => Id | undefined) {
    return computed(() => {
      this.revision();
      const id = consumer();
      return id === undefined ? [] : this.of(id);
    });
  }

  private remember(message: MessageInfo): void {
    this.published.set(message.id, message);
    if (this.published.size > INBOX_MESSAGES) {
      this.published.delete(this.published.keys().next().value as number);
    }
  }

  private add(consumer: Id, row: ReceivedRow): void {
    const rows = this.rows.get(consumer) ?? [];
    rows.push(row);
    if (rows.length > INBOX_ROWS) {
      rows.splice(0, rows.length - INBOX_ROWS);
    }
    this.rows.set(consumer, rows);
  }

  /** Moves the latest row of a message on, for the consumer that the engine says it is about. It answers whether there was one. */
  private move(consumer: Id, message: number, state: ReceivedState): boolean {
    const rows = this.rows.get(consumer);
    if (rows === undefined) {
      return false;
    }
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index] as ReceivedRow;
      if (row.message === message) {
        rows[index] = { ...row, state };
        return true;
      }
    }
    return false;
  }

  /** Marks every row that the consumer had not finished with as cleared. It answers whether there was one. */
  private markUnfinishedCleared(): boolean {
    let marked = false;
    for (const rows of this.rows.values()) {
      rows.forEach((row, index) => {
        if (row.state === 'on its way' || row.state === 'received') {
          rows[index] = { ...row, state: 'cleared' };
          marked = true;
        }
      });
    }
    return marked;
  }

  /** A canvas that is opened starts the inbox again: nothing that was given to the consumers of another is shown for this one. */
  private reset(): void {
    this.rows.clear();
    this.published.clear();
    this.next = 1;
    this.revision.update((count) => count + 1);
  }
}
