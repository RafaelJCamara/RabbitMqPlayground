import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { DebugEventLog } from '../debug/debug-sources';
import { FeatureFlags } from '../flags/feature-flags';
import { namesOf } from '../runtime/sentences';
import { Simulation } from '../runtime/simulation';
import { CommandLog } from '../state/command-log';
import { DocumentStore } from '../state/document-store';
import { HeldMessages } from './held-messages';
import {
  draftOfEvent,
  draftOfLine,
  isFiltering,
  matchesFilter,
  NO_FILTER,
  type LogFilter,
  type LogRow,
  type RowDraft,
} from './log-row';

/** How many rows the log keeps (ADR-0061). The oldest go, and the log says how many. */
export const LOG_CAP = 5000;

/** How many rows more than the cap are written before the oldest are taken off in one go, so that a row costs a push and not a shift. */
const TRIM_SLACK = 256;

/**
 * The event log (ADR-0061): the events of the engine and the lines of the log of commands, in one order, with a time on every row. It listens from the moment that the editor opens, so that nothing that happened is missing
 * from it when the panel is opened, and it costs a record for each row and nothing for a panel that is closed. The bus tells it of a command after the simulation has said what the command made, so what was said in a
 * turn is kept, and the line of the command is put before it. It is the session's: a canvas that is opened empties it.
 *
 * It needs both flags, `explain` for what it says and `simulation` for the events that it says, and without either it listens to nothing.
 */
@Injectable()
export class EventLog {
  private readonly simulation = inject(Simulation);
  private readonly commands = inject(CommandLog);
  private readonly store = inject(DocumentStore);

  readonly enabled: boolean;
  /** The messages that it still holds, each with the canvas that routed it. */
  readonly held = new HeldMessages();

  /** The rows, oldest first. It holds up to a slack more than the cap: what the log keeps is the last `LOG_CAP` of them. */
  private rows: LogRow[] = [];
  /** How many rows have been taken off the front of `rows` to make room. */
  private off = 0;
  private next = 1;
  /** What was said in this turn and is not in the rows yet, and where the events of the command that was run last begin. */
  private pending: RowDraft[] = [];
  private commandAt: number | null = null;
  private scheduled = false;

  private readonly revision = signal(0);
  private readonly settled = signal<number | null>(null);
  private readonly filterState = signal<LogFilter>(NO_FILTER);

  /** Changes when rows were added, once for each turn in which something was said, so that a burst of events is one change. */
  readonly changed = this.revision.asReadonly();
  readonly filter = this.filterState.asReadonly();
  /** The number of the message that the engine routed, or refused, most lately. It is set when the rows are, and not for each event, so that what reads it is not woken by a burst. */
  readonly lastSettled = this.settled.asReadonly();

  /** How many rows it keeps now. */
  readonly count = computed(() => {
    this.revision();
    return this.kept();
  });
  /** How many rows went because the log was full. */
  readonly dropped = computed(() => {
    this.revision();
    return this.lost();
  });
  /** The rows that the filter lets through, oldest first. */
  readonly shown = computed(() => {
    this.revision();
    const filter = this.filterState();
    const rows = this.keptRows();
    return isFiltering(filter) ? rows.filter((row) => matchesFilter(row, filter)) : rows;
  });

  constructor() {
    const flags = inject(FeatureFlags);
    this.enabled = flags.isEnabled('explain') && flags.isEnabled('simulation');
    if (!this.enabled) {
      return;
    }
    const stopEvents = this.simulation.onEvents((events, about, cause) => {
      const names = namesOf(about);
      if (cause === 'command') {
        this.commandAt = this.pending.length;
      }
      for (const event of events) {
        this.pending.push(draftOfEvent(event, names));
        if (event.type === 'published') {
          this.held.published(event.message, event.at, about);
        } else if (event.type === 'routed') {
          this.held.settled(event.message, 'routed', event.queues, about);
        } else if (event.type === 'unroutable' || event.type === 'refused') {
          this.held.settled(event.message, event.type, [], about);
        }
      }
      this.schedule();
    });
    const stopLines = this.commands.onLine((line) => {
      // The bus tells of a command after the simulation said what it made, so its line goes in front of that.
      this.pending.splice(this.commandAt ?? this.pending.length, 0, draftOfLine(line, this.simulation.now()));
      this.commandAt = null;
      this.schedule();
    });
    const stopStore = this.store.subscribe((_document, cause) => {
      if (cause === 'load') {
        this.reset();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      stopEvents();
      stopLines();
      stopStore();
    });
  }

  /** Puts what was said in this turn in the rows, in the order that it was said, with its numbers, and says that there are more. It is called when the turn is over, and a spec may call it by hand. */
  flush(): void {
    this.scheduled = false;
    this.commandAt = null;
    if (this.pending.length === 0) {
      return;
    }
    for (const draft of this.pending) {
      this.rows.push({ ...draft, seq: this.next });
      this.next += 1;
    }
    this.pending = [];
    this.settled.set(this.held.lastSettled);
    if (this.rows.length > LOG_CAP + TRIM_SLACK) {
      const extra = this.rows.length - LOG_CAP;
      this.rows.splice(0, extra);
      this.off += extra;
    }
    this.revision.update((count) => count + 1);
  }

  /** The row with this number, if it is still kept. */
  rowBySeq(seq: number): LogRow | undefined {
    let low = Math.max(0, this.rows.length - LOG_CAP);
    let high = this.rows.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const row = this.rows[middle] as LogRow;
      if (row.seq === seq) {
        return row;
      }
      if (row.seq < seq) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return undefined;
  }

  /** What a test of the whole app reads (ADR-0061): how many rows are kept, how many went, and each row as it was said, without what choosing it lights. */
  debugState(): DebugEventLog {
    return {
      count: this.kept(),
      dropped: this.lost(),
      rows: this.keptRows().map(({ seq, at, family, kind, text, message }) => ({
        seq,
        at,
        family,
        kind,
        text,
        message,
      })),
    };
  }

  setFilter(changes: Partial<LogFilter>): void {
    this.filterState.update((filter) => ({ ...filter, ...changes }));
  }

  clearFilter(): void {
    this.filterState.set(NO_FILTER);
  }

  private kept(): number {
    return Math.min(this.rows.length, LOG_CAP);
  }

  /** How many rows went because the log was full: the ones taken off the front, and the ones past the cap that are waiting to be. */
  private lost(): number {
    return this.off + Math.max(0, this.rows.length - LOG_CAP);
  }

  /** A copy of the rows that it keeps, oldest first. */
  private keptRows(): LogRow[] {
    return this.rows.length > LOG_CAP ? this.rows.slice(-LOG_CAP) : this.rows.slice();
  }

  private schedule(): void {
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** A canvas that is opened starts the log again: nothing that was said about another is said about this one. */
  private reset(): void {
    this.rows = [];
    this.pending = [];
    this.off = 0;
    this.next = 1;
    this.commandAt = null;
    this.held.clear();
    this.settled.set(null);
    this.filterState.set(NO_FILTER);
    this.revision.update((count) => count + 1);
  }
}
