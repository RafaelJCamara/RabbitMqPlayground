import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { formatCommand } from '@rmq/domain';
import { CommandBus } from './command-bus';
import { DocumentStore } from './document-store';
import type { CommandOrigin } from './origin';

/** How many lines the log keeps. It is for the session, and a learner does not scroll back through more. */
export const LOG_LIMIT = 1000;

/** One line of the log: what the learner used, and the command that would have done the same. */
export interface LogEntry {
  /** Counts from 1 for as long as the canvas is open, and is not used twice. */
  readonly id: number;
  readonly origin: CommandOrigin;
  /** The equivalent command, written the way that a learner would type it (ADR-0025). */
  readonly text: string;
}

/**
 * The log of equivalent commands (ADR-0011, ADR-0046): for each command that changed the canvas, and each undo and redo that did, the line that a
 * learner would type to do the same. The bus feeds it, so nothing that goes through the bus can be left out of it, and a refusal, a command that
 * changed nothing and a selection are not in it. It is the session's, in memory: opening another canvas empties it.
 */
@Injectable()
export class CommandLog {
  private readonly list = signal<readonly LogEntry[]>([]);
  private next = 1;

  readonly entries = this.list.asReadonly();
  /** The last line, which the panel shows when it is closed. */
  readonly latest = computed(() => this.list().at(-1));

  constructor() {
    const stopBus = inject(CommandBus).onApplied(({ command, origin, before }) => {
      const entry: LogEntry = { id: this.next, origin, text: formatCommand(command, before) };
      this.next += 1;
      this.list.update((entries) => [...entries.slice(1 - LOG_LIMIT), entry]);
    });
    const stopStore = inject(DocumentStore).subscribe((_document, cause) => {
      if (cause === 'load') {
        this.list.set([]);
        this.next = 1;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      stopBus();
      stopStore();
    });
  }
}
