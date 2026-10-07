import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { lookup, nameOf, type Id } from '@rmq/domain';
import type { QueueMessage } from '@rmq/engine';
import { ExplainState } from '../core/explain/explain-state';
import { SimStats } from '../core/runtime/sim-stats';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { Icon } from '../core/ui/icon';

/** How many messages of a queue the inspector lists (ADR-0056). The count above the list says how many there are. */
export const LIST_LIMIT = 50;

/** How much of a payload the list shows. The payload is whole in the message inspector (ADR-0063). */
export const PAYLOAD_CUT = 40;

let nextSection = 0;

/**
 * What a queue holds, in the inspector of a queue (ADR-0056): how many messages are ready and how many consumers have and have not acknowledged, the first fifty with
 * their number, key and a cut of the payload, and what to do about them, which is to purge the ones that are ready. The same numbers are on the node, as a picture,
 * and the words here are for a keyboard and a screen reader. With the flag of the explanation each message is a button that opens it in the message inspector (ADR-0063), with what this list says of it, for the
 * case that the log has stopped holding it.
 */
@Component({
  selector: 'rmq-queue-messages',
  imports: [Icon, NgTemplateOutlet],
  template: `
    <ng-template #summary let-message>
      <span class="font-mono">#{{ message.id }}</span
      >&ngsp; <span class="font-mono">{{ message.key === '' ? '(no key)' : message.key }}</span
      >&ngsp;
      <span class="text-muted min-w-0 truncate">{{ cut(message.payload) }}</span>
      @if (message.redelivered) {
        &ngsp;<span class="border-warning text-warning rounded border px-1">redelivered</span>
      }
      @if (holder(message); as who) {
        &ngsp;<span class="text-muted">held by {{ who }}</span>
      }
    </ng-template>
    @if (queue(); as name) {
      <section class="flex flex-col gap-2" [attr.aria-labelledby]="titleId" data-testid="queue-messages">
        <h3 class="text-sm font-semibold" [id]="titleId">Messages</h3>
        <p class="text-sm" data-testid="queue-counts">{{ counts() }}</p>
        @if (messages().length > 0) {
          <ol
            class="border-line divide-line flex flex-col divide-y rounded-md border text-xs"
            [attr.aria-label]="'Messages in ' + name"
            data-testid="queue-message-list"
          >
            @for (message of messages(); track message.id) {
              <li data-testid="queue-message">
                @if (explain.enabled) {
                  <button
                    type="button"
                    class="hover:bg-canvas flex min-h-7 w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1 text-left"
                    data-testid="open-message"
                    [attr.title]="'Open message ' + message.id + ' in the inspector'"
                    [attr.aria-current]="explain.message() === message.id ? 'true' : null"
                    (click)="open(message, name)"
                  >
                    <ng-container *ngTemplateOutlet="summary; context: { $implicit: message }" />
                  </button>
                } @else {
                  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1">
                    <ng-container *ngTemplateOutlet="summary; context: { $implicit: message }" />
                  </div>
                }
              </li>
            }
          </ol>
          @if (more() > 0) {
            <p class="text-muted text-xs" data-testid="queue-more">and {{ more() }} more</p>
          }
        }
        <button
          type="button"
          class="border-border bg-surface hover:bg-canvas disabled:text-muted flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          [disabled]="ready() === 0"
          [attr.title]="ready() === 0 ? 'There are no ready messages to purge' : null"
          data-testid="purge"
          (click)="purge(name)"
        >
          <rmq-icon name="trash" [size]="18" />
          Purge the ready messages
        </button>
        <p class="text-muted text-xs">
          Purging takes the messages that are waiting in the queue. The ones that consumers hold stay with them.
        </p>
      </section>
    }
  `,
})
export class QueueMessages {
  /** The id of the queue, which is the id of its node. */
  readonly id = input.required<Id>();

  private readonly store = inject(DocumentStore);
  private readonly simulation = inject(Simulation);
  private readonly stats = inject(SimStats);
  private readonly bus = inject(CommandBus);
  protected readonly explain = inject(ExplainState);

  protected readonly titleId = `rmq-queue-messages-${nextSection++}`;
  /** The name of the queue, which the engine knows it by: what the learner calls it now. */
  protected readonly queue = computed(() => nameOf(this.store.document(), 'queue', this.id()) ?? null);

  private readonly numbers = computed(() => {
    const stats = this.stats.of(this.id())();
    return stats?.kind === 'queue' ? stats : null;
  });
  protected readonly ready = computed(() => this.numbers()?.ready ?? 0);
  private readonly unacked = computed(() => this.numbers()?.unacked ?? 0);

  protected readonly counts = computed(() => {
    const [ready, unacked] = [this.ready(), this.unacked()];
    return `${ready} ${ready === 1 ? 'message is' : 'messages are'} ready, and ${unacked} ${unacked === 1 ? 'is' : 'are'} held and not acknowledged.`;
  });

  /** What it holds, read again when the engine says something, since what it holds can change though how many it holds does not. */
  protected readonly messages = computed(() => {
    this.simulation.revision();
    this.numbers();
    const name = this.queue();
    return name === null ? [] : this.simulation.messages(name, LIST_LIMIT);
  });
  protected readonly more = computed(() => Math.max(0, this.ready() + this.unacked() - this.messages().length));

  protected cut(payload: string): string {
    return payload.length <= PAYLOAD_CUT ? payload : `${payload.slice(0, PAYLOAD_CUT - 1)}…`;
  }

  /** The consumer that holds a message, by its name on the canvas. */
  protected holder(message: QueueMessage): string | null {
    if (message.heldBy === null) {
      return null;
    }
    const document = this.store.document();
    // The channel of a consumer is its id.
    return lookup(document.consumers, message.heldBy.channel)?.name ?? message.heldBy.channel;
  }

  /** Opens the message in the inspector, with what the list says of it and which queue it was in. */
  protected open(message: QueueMessage, queue: string): void {
    const { id, producer, exchange, key, headers, payload } = message;
    this.explain.openMessage(id, { info: { id, producer, exchange, key, headers, payload }, queue });
  }

  protected purge(queue: string): void {
    this.bus.run({ type: 'purge', queue }, 'inspector');
  }
}
