import { Component, computed, effect, inject, input, linkedSignal, untracked } from '@angular/core';
import { lookup, problemAt, reportMessageRows, rowsOf, sameEntries, type DraftRow, type Id } from '@rmq/domain';
import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import { messageHeadersCommand } from '../core/state/header-commands';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { HeaderRows } from '../core/ui/header-rows';
import { Help } from '../core/ui/help';
import { Icon } from '../core/ui/icon';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { Switch } from '../core/ui/switch';
import { Fields, NumberField } from './fields';

/**
 * The composer of a producer, in its inspector (ADR-0056): the message that it sends, how many at a time, whether it goes on sending and how often, and the button that
 * sends it now. A field is the command that sets it (`set sender payload=… key=… burst=… every=… repeat=…`, ADR-0025), so a refusal is the grammar's, under the field, and the
 * log has the line that the learner could have typed. The button is `publish sender`.
 */
@Component({
  selector: 'rmq-producer-composer',
  imports: [HeaderRows, Help, Icon, NumberField, RefusalNotice, Switch],
  template: `
    @if (producer(); as p) {
      <section class="flex flex-col gap-3" [attr.aria-labelledby]="fields.id('title')" data-testid="producer-composer">
        <h3 class="text-sm font-semibold" [id]="fields.id('title')">What it sends</h3>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" [for]="fields.id('payload')">Payload</label>
          <textarea
            rows="2"
            class="border-border bg-surface rounded-md border px-2 py-1.5 font-mono text-sm"
            [id]="fields.id('payload')"
            [value]="p.message.payload"
            [attr.aria-invalid]="problem('payload') ? 'true' : null"
            [attr.aria-describedby]="problem('payload') ? fields.id('payload-problem') : null"
            (change)="setText('payload', $event, p.name, p.message.payload)"
          ></textarea>
          @if (problem('payload'); as issue) {
            <div [id]="fields.id('payload-problem')"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1">
            <label class="text-sm font-medium" [for]="fields.id('key')">Routing key</label>
            <rmq-help topic="Routing key">
              What the exchange looks at to decide which queues get the message. A direct exchange wants it to be the
              key of a binding, and a topic exchange matches it against the patterns of its bindings.
            </rmq-help>
          </div>
          <input
            type="text"
            class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
            [id]="fields.id('key')"
            [value]="p.message.key"
            [attr.aria-invalid]="problem('key') ? 'true' : null"
            [attr.aria-describedby]="keyDescription()"
            (change)="setText('key', $event, p.name, p.message.key)"
          />
          @if (keyIgnored()) {
            <p class="text-muted text-xs" [id]="fields.id('key-note')" data-testid="composer-key-note">
              Not used by this exchange; still carried for exchange-to-exchange hops and dead-lettering.
            </p>
          }
          @if (problem('key'); as issue) {
            <div [id]="fields.id('key-problem')"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </div>

        <div
          class="flex flex-col gap-1.5"
          role="group"
          [attr.aria-labelledby]="fields.id('headers-title')"
          data-testid="composer-headers-table"
        >
          <div class="flex flex-wrap items-center gap-1">
            <h4 class="text-sm font-medium" [id]="fields.id('headers-title')">Headers</h4>
            <rmq-help topic="Headers">
              A header has a name and a value, and a headers exchange compares them with the conditions of its bindings.
              A number is an integer: 1. With a point it is a float: 1.0. true and false are booleans, and a text in
              quotes is a string: "1" is not 1.
            </rmq-help>
          </div>
          <rmq-header-rows
            [rows]="rows()"
            [reports]="report().rows"
            noun="header"
            label="Headers"
            (rowsChange)="rows.set($event)"
            (commit)="commitHeaders(p.name, p.message.headers)"
          />
          @if (countProblem(); as issue) {
            <div data-testid="composer-headers-count"><rmq-refusal-notice [issue]="issue" /></div>
          }
          @if (problem('headers'); as issue) {
            <div data-testid="composer-headers-problem"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </div>

        <rmq-number-field
          label="Messages at a time"
          help="How many messages it sends each time that it sends: one, or a burst of up to a thousand."
          [value]="p.burst"
          [min]="1"
          [max]="1000"
          [problem]="problem('burst')"
          (given)="fields.number('burst', 'The burst', $event, p.burst, burstCommand(p.name))"
        />

        <div class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium" [id]="fields.id('repeat')">Keeps sending</span>
            <rmq-help topic="Keeps sending">
              A producer that keeps sending sends again and again, as often as the time below says, for as long as the
              simulation runs.
            </rmq-help>
            <span class="ml-auto">
              <rmq-switch
                [checked]="p.interval.on"
                [labelledBy]="fields.id('repeat')"
                (turn)="repeat($event, p.name)"
              />
            </span>
          </div>
        </div>

        <rmq-number-field
          label="Milliseconds between sends"
          help="How long it waits between one send and the next, in the simulation's time, when it keeps sending."
          [value]="p.interval.everyMs"
          [min]="1"
          [problem]="problem('every')"
          (given)="fields.number('every', 'The time between sends', $event, p.interval.everyMs, everyCommand(p.name))"
        />

        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-keyshortcuts="P"
            data-testid="publish"
            (click)="publish(p.name)"
          >
            <rmq-icon name="send" [size]="18" />
            Publish now
          </button>
          @if (problem('publish'); as issue) {
            <div data-testid="publish-problem"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </div>
      </section>
    }
  `,
})
export class ProducerComposer {
  /** The id of the producer, which is the id of its node. */
  readonly id = input.required<Id>();

  private readonly store = inject(DocumentStore);
  private readonly bus = inject(CommandBus);
  protected readonly fields = new Fields();

  protected readonly producer = computed(() => lookup(this.store.document().producers, this.id()));

  /**
   * The rows of the table: the headers of the message, and what is typed on the way to changing them. A row that is complete is applied when its control is left, and the rows keep what
   * is not finished through that; they start again from the message when its headers change from somewhere else (an undo, a typed command), and when another producer is shown (ADR-0069).
   */
  protected readonly rows = linkedSignal<
    { readonly id: Id; readonly headers: readonly HeaderEntry<HeaderValue>[] },
    readonly DraftRow[]
  >({
    source: () => ({ id: this.id(), headers: this.producer()?.message.headers ?? [] }),
    computation: (source, previous) =>
      previous !== undefined &&
      previous.source.id === source.id &&
      sameEntries(reportMessageRows(previous.value).entries, source.headers)
        ? previous.value
        : rowsOf(source.headers),
  });
  protected readonly report = computed(() => reportMessageRows(this.rows()));
  /** A problem of the whole table that no row has: too many headers. */
  protected readonly countProblem = computed(() => (problemAt(this.report()) === null ? this.report().problem : null));

  /** Whether the exchange that the producer publishes to does not read the routing key: a headers exchange (ADR-0009, ADR-0069). */
  protected readonly keyIgnored = computed(() => {
    const target = this.producer()?.target;
    return target?.kind === 'exchange' && lookup(this.store.document().exchanges, target.id)?.type === 'headers';
  });

  constructor() {
    // What was refused belongs to what was selected when it was refused.
    effect(() => {
      this.id();
      untracked(() => this.fields.reset());
    });
  }

  protected problem(field: string) {
    return this.fields.problems()[field];
  }

  /** What describes the routing key: the note about a headers exchange, and the refusal, if there is one. */
  protected keyDescription(): string | null {
    const ids = [
      ...(this.keyIgnored() ? [this.fields.id('key-note')] : []),
      ...(this.problem('key') ? [this.fields.id('key-problem')] : []),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  /**
   * A control of the table was left, a type was chosen or a row was taken off: the table is applied, as the commands that a learner could type, if it has no problem. A table that has one applies
   * nothing, and each row says its own (ADR-0068); the message keeps the headers it had, which are the ones that are sent.
   */
  protected commitHeaders(name: string, current: readonly HeaderEntry<HeaderValue>[]): void {
    const report = this.report();
    if (!report.ok) {
      return;
    }
    const command = messageHeadersCommand(name, current, report.entries);
    if (command === undefined) {
      this.fields.reset();
      return;
    }
    this.fields.apply('headers', command);
  }

  /** The payload and the key are text: what was typed is the value, and a refusal puts back what the document has. */
  protected setText(field: 'payload' | 'key', event: Event, name: string, current: string): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (input.value === current) {
      this.fields.reset();
      return;
    }
    const changes = field === 'payload' ? { payload: input.value } : { key: input.value };
    if (!this.fields.apply(field, { type: 'set', kind: 'producer', name, changes })) {
      input.value = current;
    }
  }

  protected burstCommand(name: string) {
    return (burst: number) => ({ type: 'set', kind: 'producer', name, changes: { burst } }) as const;
  }

  protected everyCommand(name: string) {
    return (everyMs: number) => ({ type: 'set', kind: 'producer', name, changes: { everyMs } }) as const;
  }

  /** Whether it goes on sending is a choice of two and is always accepted, so the switch is the document's as soon as it is turned. */
  protected repeat(on: boolean, name: string): void {
    this.fields.apply('repeat', { type: 'set', kind: 'producer', name, changes: { repeat: on } });
  }

  protected publish(name: string): void {
    const result = this.bus.run({ type: 'publish', from: { kind: 'producer', name } }, 'inspector');
    this.fields.keep('publish', result.ok ? undefined : result.error);
  }
}
