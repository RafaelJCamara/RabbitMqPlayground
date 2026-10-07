import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import {
  allowedTargets,
  draftFromMessage,
  edgeKey,
  formatCommand,
  headersLint,
  kindOf,
  nameOf,
  reportDraft,
  reservedHeaderIssue,
  X_MATCH,
  type BindCommand,
  type Id,
  type Issue,
} from '@rmq/domain';
import type { HeaderEntry, HeaderValue, XMatch } from '@rmq/engine';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { Icon } from '../core/ui/icon';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { Segmented, type Segment } from '../core/ui/segmented';
import { headerRow } from './header-row';
import { HeadersLive } from './headers-live';

let nextPanel = 0;

const FIELD = 'border-border bg-surface min-h-8 w-full rounded-md border px-2 py-1';

const MODES: readonly Segment[] = (['all', 'any', 'all-with-x', 'any-with-x'] as const).map((value) => ({
  value,
  label: value,
}));

/** Where a binding could go, as the select lists it: what it is, and a key that tells it from the others. */
interface Target {
  readonly id: Id;
  readonly kind: 'queue' | 'exchange';
  readonly name: string;
  readonly key: string;
}

/**
 * "Bind from this message" (ADR-0070), a section of the message inspector: the headers of the message with a tick for each, all ticked, with their names, types and values exactly as the message has them; the headers
 * exchange to bind from, which starts as the one the message was published to when that is a headers exchange; what to bind to, which starts as the first queue that did not get the message; the mode; the sentence of what
 * the binding would ask, the lint, the table of recent messages, and the one `bind` line that "Create binding" makes. The binding is made through the bus, so it is one step of undo and one line in the log, and the new edge is selected,
 * so that the inspector below shows it and its editor. It says what it does for a message with no headers, one that went to an exchange that does not read headers, and a canvas with no headers exchange.
 */
@Component({
  selector: 'rmq-bind-from-message',
  imports: [Icon, RefusalNotice, Segmented, HeadersLive],
  template: `
    <section class="flex flex-col gap-2" data-testid="bind-from-message" [attr.aria-labelledby]="titleId">
      <h3 class="font-semibold" [id]="titleId">
        <button
          type="button"
          class="border-border bg-surface hover:bg-canvas flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5 font-semibold"
          data-testid="bind-toggle"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="bodyId"
          (click)="open.set(!open())"
        >
          <rmq-icon name="link" [size]="14" />
          Bind from this message…
        </button>
      </h3>
      @if (open()) {
        <div [id]="bodyId" class="border-line flex flex-col gap-3 border-l-2 pl-3" data-testid="bind-body">
          @if (headers().length === 0) {
            <p data-testid="bind-no-headers">
              This message has no headers, so there is nothing to make a condition of. Give the producer some in the
              table under its routing key, publish again, and open the new message.
            </p>
          } @else if (from() === null) {
            <p data-testid="bind-no-exchange">
              There is no headers exchange on the canvas. Add one, and a binding to it can be made from here.
            </p>
          } @else {
            <form class="flex flex-col gap-3" (submit)="create($event)">
              @if (elsewhere(); as where) {
                <p class="text-muted" data-testid="bind-elsewhere">
                  This message was published to {{ where }}, which does not read headers. The binding is made on the
                  headers exchange you choose, and a message published there is checked by it.
                </p>
              }

              <table class="text-xs" data-testid="bind-headers">
                <caption class="sr-only">
                  Headers of the message, to tick as conditions
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="text-muted pr-2 text-left font-normal">Use</th>
                    <th scope="col" class="text-muted pr-3 text-left font-normal">Name</th>
                    <th scope="col" class="text-muted pr-3 text-left font-normal">Type</th>
                    <th scope="col" class="text-muted text-left font-normal">Value</th>
                  </tr>
                </thead>
                <tbody>
                  @for (header of rows(); track header.name) {
                    <tr>
                      <td class="pr-2">
                        <input
                          type="checkbox"
                          class="size-6"
                          data-testid="bind-tick"
                          [id]="tickId(header.name)"
                          [checked]="isTicked(header.name)"
                          [disabled]="header.name === reserved"
                          [attr.aria-label]="'Use the header ' + header.name + ' as a condition'"
                          [attr.aria-describedby]="header.name === reserved ? reservedId : null"
                          (change)="tick(header.name, $event)"
                        />
                      </td>
                      <td class="pr-3 font-mono break-all">{{ header.name }}</td>
                      <td class="pr-3">{{ header.type }}</td>
                      <td class="font-mono break-all">{{ header.value }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (hasReserved()) {
                <p class="text-muted text-xs" [id]="reservedId" data-testid="bind-reserved">{{ reservedText }}</p>
              }
              @if (notes().length > 0) {
                <ul class="text-muted flex flex-col gap-0.5 text-xs" data-testid="bind-notes">
                  @for (note of notes(); track note) {
                    <li>{{ note }}</li>
                  }
                </ul>
              }

              <div class="flex flex-col gap-1">
                <label class="font-medium" [for]="fromId">From the headers exchange</label>
                <select [id]="fromId" [class]="field" data-testid="bind-from" (change)="chooseFrom($event)">
                  @for (option of exchanges(); track option.id) {
                    <option [value]="option.name" [selected]="option.name === from()?.name">{{ option.name }}</option>
                  }
                </select>
              </div>

              <div class="flex flex-col gap-1">
                <label class="font-medium" [for]="toId">To</label>
                <select [id]="toId" [class]="field" data-testid="bind-to" (change)="chooseTo($event)">
                  @for (option of targets(); track option.key) {
                    <option [value]="option.key" [selected]="option.key === to()?.key">
                      {{ option.kind }} {{ option.name }}
                    </option>
                  }
                </select>
              </div>

              <div class="flex flex-col gap-1">
                <rmq-segmented legend="x-match" [options]="modes" [value]="xMatch()" (chosen)="chooseMode($event)" />
              </div>

              <p data-testid="bind-sentence">{{ report().sentence }}</p>
              @if (lint(); as warning) {
                <div
                  class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2"
                  data-testid="bind-lint"
                >
                  <p class="flex items-center gap-2 font-medium"><rmq-icon name="alert" [size]="16" /> Worth a look</p>
                  <p class="mt-1">{{ warning }}</p>
                </div>
              }

              <rmq-headers-live [headers]="report().headers" [exchange]="from()?.name ?? ''" />

              @if (line(); as text) {
                <p class="text-muted text-xs">
                  As a command: <code class="font-mono break-all" data-testid="bind-line">{{ text }}</code>
                </p>
              }
              @if (refusal(); as issue) {
                <div data-testid="bind-refusal"><rmq-refusal-notice [issue]="issue" /></div>
              }
              <button
                type="submit"
                class="bg-accent text-accent-fg self-start rounded-md px-3 py-1.5 font-medium hover:opacity-90"
                data-testid="bind-create"
              >
                Create binding
              </button>
            </form>
          }
        </div>
      }
    </section>
  `,
})
export class BindFromMessage {
  /** The number of the message, so that what was ticked and chosen is forgotten when another message is open. */
  readonly number = input.required<number>();
  readonly headers = input.required<readonly HeaderEntry<HeaderValue>[]>();
  /** The exchange that the message was published to: `''` is the default exchange. */
  readonly exchange = input.required<string>();
  /** The queues that did not get the message, by name: the first of them is where the binding starts out to go. */
  readonly unreached = input<readonly string[]>([]);

  private readonly store = inject(DocumentStore);
  private readonly bus = inject(CommandBus);
  private readonly selection = inject(SelectionStore);
  private readonly status = inject(StatusStore);

  private readonly uid = `rmq-bind-${nextPanel++}`;
  protected readonly titleId = `${this.uid}-title`;
  protected readonly bodyId = `${this.uid}-body`;
  protected readonly fromId = `${this.uid}-from`;
  protected readonly toId = `${this.uid}-to`;
  protected readonly reservedId = `${this.uid}-reserved`;
  protected readonly field = FIELD;
  protected readonly modes = MODES;
  protected readonly reserved = X_MATCH;
  protected readonly reservedText = reservedHeaderIssue('Choose the mode with the control below.').message;

  /** Everything the learner chose is for the message that is open, and is forgotten for another. */
  protected readonly open = linkedSignal<number, boolean>({ source: this.number, computation: () => false });
  /** The headers are the same array for every message that a producer sends while its message is not changed, so the ticks start again with the number of the message as well as with the headers. */
  private readonly ticked = linkedSignal<
    { readonly number: number; readonly headers: readonly HeaderEntry<HeaderValue>[] },
    ReadonlySet<string>
  >({
    source: () => ({ number: this.number(), headers: this.headers() }),
    computation: ({ headers }) => new Set(headers.map(({ key }) => key).filter((key) => key !== X_MATCH)),
  });
  private readonly chosenFrom = linkedSignal<number, string | null>({ source: this.number, computation: () => null });
  private readonly chosenTo = linkedSignal<number, string | null>({ source: this.number, computation: () => null });
  protected readonly xMatch = linkedSignal<number, XMatch>({ source: this.number, computation: () => 'all' });
  protected readonly refusal = linkedSignal<number, Issue | null>({ source: this.number, computation: () => null });

  protected readonly rows = computed(() => this.headers().map(headerRow));

  /** The headers exchanges of the canvas, in the order they were made. */
  protected readonly exchanges = computed(() =>
    Object.entries(this.store.document().exchanges)
      .filter(([, { type }]) => type === 'headers')
      .map(([id, { name }]) => ({ id, name })),
  );

  /** The exchange to bind from: the one that was chosen, else the one the message was published to if it reads headers, else the first. */
  protected readonly from = computed(() => {
    const list = this.exchanges();
    const chosen = this.chosenFrom();
    return (
      list.find(({ name }) => name === chosen) ?? list.find(({ name }) => name === this.exchange()) ?? list[0] ?? null
    );
  });

  /** What the rules allow a binding from that exchange to go to: always something, since an exchange may be bound to itself. */
  protected readonly targets = computed<readonly Target[]>(() => {
    const from = this.from();
    const document = this.store.document();
    if (from === null) {
      return [];
    }
    return allowedTargets(document, from.id).flatMap((id): Target[] => {
      const kind = kindOf(document, id);
      if (kind !== 'queue' && kind !== 'exchange') {
        return [];
      }
      const name = nameOf(document, kind, id) as string;
      return [{ id, kind, name, key: `${kind}:${name}` }];
    });
  });

  /** Where to bind to: the one that was chosen, else the first queue that did not get the message, else the first queue, else the first. */
  protected readonly to = computed(() => {
    const list = this.targets();
    const chosen = this.chosenTo();
    return (
      list.find(({ key }) => key === chosen) ??
      list.find(({ kind, name }) => kind === 'queue' && this.unreached().includes(name)) ??
      list.find(({ kind }) => kind === 'queue') ??
      list[0] ??
      null
    );
  });

  /** How the exchange that the message was published to is said, when it does not read headers. */
  protected readonly elsewhere = computed(() => {
    const name = this.exchange();
    if (name === '') {
      return 'the default exchange';
    }
    const published = Object.values(this.store.document().exchanges).find((found) => found.name === name);
    return published === undefined || published.type === 'headers' ? null : `the ${published.type} exchange ${name}`;
  });

  protected readonly hasReserved = computed(() => this.headers().some(({ key }) => key === X_MATCH));

  private readonly draft = computed(() => draftFromMessage(this.headers(), this.ticked(), this.xMatch()));
  protected readonly report = computed(() => reportDraft(this.draft()));

  /** The notes about the headers that are ticked, in the words of the editor: an `x-` header that the mode counts or ignores. */
  protected readonly notes = computed(() => this.report().rows.flatMap(({ notes }) => notes));

  private readonly command = computed<BindCommand | null>(() => {
    const [from, to] = [this.from(), this.to()];
    return from === null || to === null
      ? null
      : {
          type: 'bind',
          source: from.name,
          destination: { kind: to.kind, name: to.name },
          key: '',
          headers: this.report().headers,
        };
  });
  protected readonly line = computed(() => {
    const command = this.command();
    return command === null ? null : formatCommand(command, this.store.document());
  });
  protected readonly lint = computed(() => {
    const command = this.command();
    return command === null ? null : headersLint(command.source, command.destination.name, command.headers);
  });

  protected tickId(name: string): string {
    return `${this.uid}-tick-${name}`;
  }

  protected isTicked(name: string): boolean {
    return this.ticked().has(name);
  }

  protected tick(name: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.ticked.update((found) => {
      const next = new Set(found);
      if (on) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }

  protected chooseFrom(event: Event): void {
    this.chosenFrom.set((event.target as HTMLSelectElement).value);
    this.chosenTo.set(null);
  }

  protected chooseTo(event: Event): void {
    this.chosenTo.set((event.target as HTMLSelectElement).value);
  }

  protected chooseMode(value: string): void {
    this.xMatch.set(value as XMatch);
  }

  /** Makes the binding as the line says, through the bus, and selects its edge so that the inspector shows it. */
  protected create(event: Event): void {
    event.preventDefault();
    // The form is there only when there is an exchange to bind from and something to bind to.
    const command = this.command() as BindCommand;
    const from = this.from() as { readonly id: Id };
    const to = this.to() as { readonly id: Id };
    const before = this.store.document();
    const result = this.bus.apply(command, 'inspector');
    if (!result.ok) {
      // The reason is under the button, so it is not also on the status line, and the bus has said it aloud.
      this.status.clearRefusalFrom('inspector');
      this.refusal.set(result.error);
      return;
    }
    this.refusal.set(null);
    if (result.value === before) {
      this.bus.say('Already bound with those conditions.');
      return;
    }
    this.selection.select([], [edgeKey(from.id, to.id)]);
    this.open.set(false);
  }
}
