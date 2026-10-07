import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { lookup, type Id } from '@rmq/domain';
import { SimStats } from '../core/runtime/sim-stats';
import { DocumentStore } from '../core/state/document-store';
import { Help } from '../core/ui/help';
import { Fields, NumberField } from './fields';

/** How a consumer says that it is done with a message, as the learner is told it. */
const ACKS = [
  { value: 'auto', label: 'Automatically, as soon as it has the message' },
  { value: 'manual', label: 'By itself, when it has finished with the message' },
] as const;

/**
 * The settings of a consumer, in its inspector (ADR-0056): how it acknowledges, how many messages it may hold that it has not finished with, and how long it takes to
 * handle one, each a command (`set worker ack=… prefetch=… processing=…`, ADR-0025), with the refusal of the grammar under the field. Under them is what it holds now, in
 * words, which is what the slots on its node show as a picture.
 */
@Component({
  selector: 'rmq-consumer-settings',
  imports: [Help, NumberField],
  template: `
    @if (consumer(); as c) {
      <section class="flex flex-col gap-3" [attr.aria-labelledby]="fields.id('title')" data-testid="consumer-settings">
        <h3 class="text-sm font-semibold" [id]="fields.id('title')">How it consumes</h3>

        <div class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1">
            <label class="text-sm font-medium" [for]="fields.id('ack')">Acknowledges</label>
            <rmq-help topic="Acknowledges">
              A consumer that acknowledges automatically is done with a message the moment that the queue gives it, so a
              queue never holds a message for it. One that acknowledges after it has finished holds each message until
              then, and that is what the prefetch counts.
            </rmq-help>
          </div>
          <select
            class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
            [id]="fields.id('ack')"
            (change)="setAck($event, c.name)"
          >
            @for (choice of acks; track choice.value) {
              <option [value]="choice.value" [selected]="choice.value === c.ack">{{ choice.label }}</option>
            }
          </select>
        </div>

        <rmq-number-field
          label="Prefetch"
          help="How many messages it may hold that it has not acknowledged, for each queue that it consumes from. 0 is no limit. A queue gives it no more until it has acknowledged some."
          [value]="c.prefetch"
          [min]="0"
          [max]="65535"
          [problem]="problem('prefetch')"
          (given)="fields.number('prefetch', 'The prefetch', $event, c.prefetch, prefetchCommand(c.name))"
        />

        <rmq-number-field
          label="Milliseconds to handle a message"
          help="How long it takes to handle one message, in the simulation's time. It handles one at a time."
          [value]="c.processingMs"
          [min]="0"
          [problem]="problem('processing')"
          (given)="
            fields.number(
              'processing',
              'The time to handle a message',
              $event,
              c.processingMs,
              processingCommand(c.name)
            )
          "
        />

        <p class="text-sm" data-testid="consumer-holds">{{ holds() }}</p>
      </section>
    }
  `,
})
export class ConsumerSettings {
  /** The id of the consumer, which is the id of its node, and the name of its channel. */
  readonly id = input.required<Id>();

  private readonly store = inject(DocumentStore);
  private readonly stats = inject(SimStats);
  protected readonly fields = new Fields();
  protected readonly acks = ACKS;

  protected readonly consumer = computed(() => lookup(this.store.document().consumers, this.id()));

  /** What the consumer holds, in words, which is what the slots of its node say as a picture. */
  protected readonly holds = computed(() => {
    const stats = this.stats.of(this.id())();
    if (stats?.kind !== 'consumer') {
      return '';
    }
    const done = `It has finished with ${stats.finished} ${stats.finished === 1 ? 'message' : 'messages'}, and ${stats.waiting} ${stats.waiting === 1 ? 'is' : 'are'} waiting for its turn.`;
    if (stats.acksItself) {
      return `It acknowledges as soon as it has a message, so it holds none. ${done}`;
    }
    const may = stats.limit === 0 ? 'any number' : String(stats.limit);
    return `It holds ${stats.holds} of the ${may} that it may hold and has not acknowledged. ${done}`;
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

  /** There are two ways to acknowledge and both are always accepted, so the choice is the document's as soon as it is made. */
  protected setAck(event: Event, name: string): void {
    const ack = (event.target as HTMLSelectElement).value === 'manual' ? 'manual' : 'auto';
    this.fields.apply('ack', { type: 'set', kind: 'consumer', name, changes: { ack } });
  }

  protected prefetchCommand(name: string) {
    return (prefetch: number) => ({ type: 'set', kind: 'consumer', name, changes: { prefetch } }) as const;
  }

  protected processingCommand(name: string) {
    return (processingMs: number) => ({ type: 'set', kind: 'consumer', name, changes: { processingMs } }) as const;
  }
}
