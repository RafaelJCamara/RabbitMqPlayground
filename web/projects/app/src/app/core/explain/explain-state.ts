import { computed, inject, Injectable, signal } from '@angular/core';
import { explainQueue, kindOf, nameOf, summaryOf, toTopology } from '@rmq/domain';
import { Announcer } from '../announcer';
import type { DebugEmphasis } from '../debug/debug-sources';
import { Simulation } from '../runtime/simulation';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { NO_EMPHASIS, type Emphasis } from './emphasis';
import { EventLog } from './event-log';
import { emphasisOfQueue, emphasisOfRoute, emphasisOfSubject, explanationOf } from './highlight';
import { explainedUnder, messageOf } from './held-messages';

/**
 * What the learner is looking at when they ask the canvas why (ADR-0061, ADR-0062, ADR-0063): the row of the log that they chose, the message that is open, and what is lit because of them. One thing is lit at a time, by this
 * order: a queue that is selected while a message is chosen (why it got the message, or did not), the row or the message that the learner chose, and, while the clock is stopped, the Why? of the message that was
 * routed last. The choice stays until another is made or it is let go.
 */

/** What the learner chose to see on the canvas: the path of a row of the log, or the Why? of a message. */
export type Focus = { readonly kind: 'row'; readonly seq: number } | { readonly kind: 'why'; readonly message: number };

/** What is lit, and why, for the card that says it. */
export interface Shown {
  /** `row` for a row of the log, `why` for the Why? of a message that was chosen, `queue` for a queue that is asked about, and `auto` for the message that was routed last. */
  readonly source: 'row' | 'why' | 'queue' | 'auto';
  readonly message: number | null;
  readonly title: string;
  readonly text: string;
  readonly emphasis: Emphasis;
}

@Injectable()
export class ExplainState {
  private readonly log = inject(EventLog);
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly simulation = inject(Simulation);
  private readonly announcer = inject(Announcer);

  /** Whether the log, the message and Why? are there: they need both flags. */
  readonly enabled = this.log.enabled;

  private readonly logShown = signal(false);
  private readonly focusing = signal<Focus | null>(null);
  private readonly opened = signal<number | null>(null);
  private readonly letGo = signal<number | null>(null);

  /** Whether the panel of the log is open. */
  readonly logOpen = this.logShown.asReadonly();
  /** What the learner chose to see on the canvas, or `null`. */
  readonly focus = this.focusing.asReadonly();
  /** The message that is open in the inspector, or `null`. */
  readonly message = this.opened.asReadonly();
  /** The row of the log that the learner chose, or `null`. */
  readonly chosenRow = computed<number | null>(() => {
    const focus = this.focusing();
    return focus?.kind === 'row' ? focus.seq : null;
  });

  /** The message that what is chosen is about: the one that is open, or the one of the row or the Why?, else the one that was routed last. */
  private readonly subject = computed<number | null>(() => {
    const open = this.opened();
    if (open !== null) {
      return open;
    }
    const focus = this.focusing();
    if (focus?.kind === 'why') {
      return focus.message;
    }
    if (focus?.kind === 'row') {
      return this.log.rowBySeq(focus.seq)?.message ?? null;
    }
    return this.log.lastSettled();
  });

  /** What is lit and why, or `null` when nothing is. */
  readonly shown = computed<Shown | null>(() => {
    if (!this.enabled) {
      return null;
    }
    const document = this.store.document();
    const focus = this.focusing();

    const asked = this.askedQueue();
    if (asked !== null) {
      return asked;
    }
    if (focus?.kind === 'row') {
      const row = this.log.rowBySeq(focus.seq);
      if (row !== undefined) {
        return {
          source: 'row',
          message: row.message,
          title: `Event ${row.seq}`,
          text: row.subject === null ? `${row.text}. There is nothing of it to show on the canvas.` : `${row.text}.`,
          emphasis: row.subject === null ? NO_EMPHASIS : emphasisOfSubject(row.subject, this.log.held, document),
        };
      }
    }
    if (focus?.kind === 'why') {
      return this.why('why', focus.message, document);
    }
    // While the clock is stopped, the Why? of the message that was routed last, until it is let go.
    if (!this.simulation.running()) {
      const last = this.log.lastSettled();
      if (last !== null && last !== this.letGo()) {
        return this.why('auto', last, document);
      }
    }
    return null;
  });

  private why(source: 'why' | 'auto', message: number, document: ReturnType<DocumentStore['document']>): Shown | null {
    const held = this.log.held.get(message);
    if (held === undefined) {
      return null;
    }
    const { explanation, document: routedUnder } = explanationOf(held);
    return {
      source,
      message,
      title: `Why? Message ${message}${source === 'auto' ? ' (the last one routed)' : ''}`,
      text: summaryOf(explanation),
      emphasis: emphasisOfRoute(explanation, held.info.producer, routedUnder, document),
    };
  }

  /** A queue is selected while a message is chosen: why it got the message, or why it did not. */
  private askedQueue(): Shown | null {
    const only = this.selection.only();
    if (only?.kind !== 'node') {
      return null;
    }
    // Nothing that is selected and is not a queue wakes this when a message is routed, which happens all the time while the clock runs.
    const document = this.store.document();
    if (kindOf(document, only.id) !== 'queue') {
      return null;
    }
    const message = this.subject();
    const held = message === null ? undefined : this.log.held.get(message);
    if (message === null || held === undefined) {
      return null;
    }
    const under = explainedUnder(held);
    const name = nameOf(under, 'queue', only.id);
    if (name === undefined) {
      return null;
    }
    const queue = explainQueue(toTopology(under), messageOf(held), name);
    return {
      source: 'queue',
      message,
      title: `Why? Message ${message} and ${name}`,
      text: queue.text,
      emphasis: emphasisOfQueue(queue, held.info.producer, under, document),
    };
  }

  /** What a test of the whole app reads: what is lit and what its card says, as plain data, or `null` when nothing is lit. */
  debugState(): DebugEmphasis | null {
    const shown = this.shown();
    if (shown === null) {
      return null;
    }
    return {
      source: shown.source,
      message: shown.message,
      title: shown.title,
      text: shown.text,
      edges: [...shown.emphasis.edges].map(([key, { mark, reason }]) =>
        reason === undefined ? { key, mark } : { key, mark, reason },
      ),
      nodes: [...shown.emphasis.nodes].map(([id, mark]) => ({ id, mark })),
      gone: shown.emphasis.gone,
    };
  }

  // What the learner does.

  toggleLog(): boolean {
    this.logShown.update((open) => !open);
    return this.logShown();
  }

  openLog(): void {
    this.logShown.set(true);
  }

  closeLog(): void {
    this.logShown.set(false);
  }

  /** Chooses a row of the log: its path is lit, and the message that it is about is opened. It says what it did, once. */
  chooseRow(seq: number): void {
    const row = this.log.rowBySeq(seq);
    if (row === undefined) {
      return;
    }
    this.focusing.set({ kind: 'row', seq });
    if (row.message !== null) {
      this.opened.set(row.message);
    }
    this.letGo.set(null);
    this.announcer.announce(
      row.subject === null
        ? `${row.text}. There is nothing of it to show on the canvas.`
        : `${row.text}. Showing it on the canvas.`,
    );
  }

  /** Opens a message in the inspector, from a row, a list of a queue or a marker, and lights its Why?. */
  openMessage(message: number): void {
    this.opened.set(message);
    this.focusing.set({ kind: 'why', message });
    this.letGo.set(null);
    this.announcer.announce(`Message ${message} is open in the inspector.`);
  }

  /** Lights the Why? of the message that is open, which is what its button says. */
  showWhy(message: number): void {
    this.focusing.set({ kind: 'why', message });
    this.letGo.set(null);
  }

  /** Closes the message in the inspector, and what it lit. */
  closeMessage(): void {
    const message = this.opened();
    this.opened.set(null);
    if (message !== null && this.focusing()?.kind === 'why') {
      this.focusing.set(null);
    }
  }

  /**
   * Lets go of what is lit: what the learner chose, and for the message that was routed last, until the next one is. A queue that is asked about is lit because it is selected, so it is let go by taking the
   * selection away.
   */
  letGoOfWhat(): void {
    if (this.askedQueue() !== null) {
      this.selection.clear();
    }
    this.focusing.set(null);
    this.letGo.set(this.log.lastSettled());
  }
}
