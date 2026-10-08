import { Component, computed, inject, signal } from '@angular/core';
import { explainQueue, isRouted, lookup, toTopology, type QueueExplanation } from '@rmq/domain';
import type { QueueMessage } from '@rmq/engine';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { ExplainState } from '../core/explain/explain-state';
import { placesOf, placeText, type Place } from '../core/explain/where';
import { Simulation } from '../core/runtime/simulation';
import { DocumentStore } from '../core/state/document-store';
import { Icon } from '../core/ui/icon';
import { BindFromMessage } from './bind-from-message';
import { headerRow } from './header-row';
import { QueueWhy } from './queue-why';
import { RouteTree } from './route-tree';

let nextInspector = 0;

const BUTTON =
  'border-border bg-surface hover:bg-canvas flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5';

/**
 * The message inspector (ADR-0063): one message, in the inspector region above what is selected, so that a message can stay open while a queue is selected, which is how a learner asks why it did not get there. It says
 * what the message is (the exchange and the key, who sent it, when, its payload whole and its headers), where it is now, which is worked out from the engine and not from the log, and its route as the explanation says it,
 * with a button for each queue that did not get it that opens the reasons in place. It is read in its place, and is closed with its button or with Escape. A message that the log no longer holds is explained again, with the
 * canvas as it is, and says so; one that nothing knows of says that it is not kept.
 */
@Component({
  selector: 'rmq-message-inspector',
  imports: [Icon, RouteTree, QueueWhy, BindFromMessage],
  template: `
    @if (explain.message(); as number) {
      <section
        class="border-border bg-panel mb-4 flex flex-col gap-3 rounded-md border p-3 text-sm"
        data-testid="message-inspector"
        [attr.aria-labelledby]="titleId"
      >
        <div class="flex items-center gap-2">
          <rmq-icon name="send" [size]="18" />
          <h2 class="text-base font-semibold" [id]="titleId" data-testid="message-title">Message {{ number }}</h2>
          <button
            type="button"
            [class]="button + ' ml-auto'"
            data-testid="message-close"
            [attr.aria-label]="'Close message ' + number"
            (click)="close()"
          >
            <rmq-icon name="close" [size]="14" />
            Close
          </button>
        </div>
        @if (opened(); as message) {
          <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1" data-testid="message-facts">
            <dt class="text-muted">Published to</dt>
            <dd data-testid="message-exchange">{{ exchangeText() }}</dd>
            <dt class="text-muted">Routing key</dt>
            <dd class="font-mono break-all" data-testid="message-key">{{ keyText() }}</dd>
            <dt class="text-muted">Sent by</dt>
            <dd data-testid="message-sender">{{ sender() }}</dd>
            <dt class="text-muted">Published at</dt>
            <dd data-testid="message-time">{{ publishedAt() }}</dd>
            @if (facts().redelivered !== null) {
              <dt class="text-muted">Redelivered</dt>
              <dd data-testid="message-redelivered">{{ facts().redelivered ? 'Yes' : 'No' }}</dd>
            }
          </dl>

          <section class="flex flex-col gap-1" [attr.aria-labelledby]="titleId + '-where'">
            <h3 class="font-semibold" [id]="titleId + '-where'">Where it is</h3>
            <ul class="flex flex-col gap-1" data-testid="message-places">
              @for (place of places(); track $index) {
                <li [attr.data-place]="place.kind">{{ placeSentence(place) }}</li>
              }
            </ul>
          </section>

          <section class="flex flex-col gap-1" [attr.aria-labelledby]="titleId + '-payload'">
            <h3 class="font-semibold" [id]="titleId + '-payload'">Payload</h3>
            <textarea
              readonly
              rows="3"
              class="border-border bg-surface w-full resize-y rounded-md border p-2 font-mono text-xs"
              [attr.aria-label]="'Payload of message ' + number"
              data-testid="message-payload"
              [value]="message.info.payload"
            ></textarea>
          </section>

          <section class="flex flex-col gap-1" [attr.aria-labelledby]="titleId + '-headers'">
            <h3 class="font-semibold" [id]="titleId + '-headers'">Headers</h3>
            @if (headers().length === 0) {
              <p class="text-muted" data-testid="message-no-headers">No headers.</p>
            } @else {
              <table class="text-xs" data-testid="message-headers">
                <thead>
                  <tr>
                    <th scope="col" class="text-muted pr-3 text-left font-normal">Name</th>
                    <th scope="col" class="text-muted pr-3 text-left font-normal">Type</th>
                    <th scope="col" class="text-muted text-left font-normal">Value</th>
                  </tr>
                </thead>
                <tbody>
                  @for (header of headers(); track $index) {
                    <tr>
                      <td class="pr-3 font-mono break-all">{{ header.name }}</td>
                      <td class="pr-3">{{ header.type }}</td>
                      <td class="font-mono break-all">{{ header.value }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <rmq-bind-from-message
            [number]="number"
            [headers]="message.info.headers"
            [exchange]="message.info.exchange"
            [unreached]="unreached()"
          />

          <section class="flex flex-col gap-2" [attr.aria-labelledby]="titleId + '-route'">
            <h3 class="font-semibold" [id]="titleId + '-route'">Route</h3>
            @if (basisText(); as why) {
              <p class="text-muted" data-testid="message-basis">{{ why }}</p>
            }
            <rmq-route-tree [explanation]="message.explanation" />
          </section>

          @if (unreached().length > 0) {
            <section class="flex flex-col gap-2" [attr.aria-labelledby]="titleId + '-not'">
              <h3 class="font-semibold" [id]="titleId + '-not'">Queues that did not get it</h3>
              <ul class="flex flex-col gap-2" data-testid="message-unreached">
                @for (queue of unreached(); track queue) {
                  <li class="flex flex-col gap-1" data-testid="message-unreached-queue" [attr.data-queue]="queue">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium">{{ queue }}</span>
                      <button
                        type="button"
                        [class]="button"
                        data-testid="why-not"
                        [attr.aria-expanded]="isOpen(queue)"
                        [attr.aria-controls]="whyId(queue)"
                        (click)="toggleWhy(queue)"
                      >
                        Why didn’t it get to {{ queue }}?
                      </button>
                    </div>
                    @if (isOpen(queue)) {
                      <div [id]="whyId(queue)" class="border-line ml-1 border-l-2 pl-3" data-testid="why-not-reasons">
                        <rmq-queue-why [explanation]="whyNot(queue)" />
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          }

          <button type="button" [class]="button + ' self-start'" data-testid="show-on-canvas" (click)="show(number)">
            <rmq-icon name="fit" [size]="14" />
            Show it on the canvas
          </button>
        } @else {
          <p data-testid="message-gone">
            Message {{ number }} is not kept any more: the log keeps the last 2,000 messages, and no queue that is on
            the canvas holds this one.
          </p>
        }
      </section>
    }
  `,
  // Escape in it closes it, from whatever of it has the keyboard: the host hears it, and not an element of the template, which is no control.
  host: { '(keydown.escape)': 'close()' },
})
export class MessageInspector {
  protected readonly explain = inject(ExplainState);
  private readonly simulation = inject(Simulation);
  private readonly store = inject(DocumentStore);
  private readonly viewport = inject(FlowViewport);

  protected readonly titleId = `rmq-message-inspector-${nextInspector++}`;
  protected readonly button = BUTTON;
  protected readonly opened = this.explain.openedMessage;

  /** The queues whose reasons are open, by name. */
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly exchangeText = computed(() => {
    const exchange = this.opened()?.info.exchange;
    return exchange === '' ? 'the default exchange' : `exchange ${exchange}`;
  });
  protected readonly keyText = computed(() => {
    const key = this.opened()?.info.key;
    return key === '' ? 'the empty key' : (key ?? '');
  });
  /** The producer by the name that the canvas that it was sent from gives it, and else the canvas as it is. */
  protected readonly sender = computed(() => {
    const opened = this.opened();
    const producer = opened?.info.producer ?? null;
    if (opened === null || producer === null) {
      return 'a command, with no producer';
    }
    return (
      lookup(this.store.document().producers, producer)?.name ??
      lookup(opened.document.producers, producer)?.name ??
      producer
    );
  });
  protected readonly publishedAt = computed(() => {
    const at = this.opened()?.held?.publishedAt;
    return at === undefined ? 'not known: the log does not hold it' : `${(at / 1000).toFixed(3)} s`;
  });
  protected readonly headers = computed(() => (this.opened()?.info.headers ?? []).map(headerRow));

  /**
   * Where the message is, and whether it was redelivered, worked out from the engine and read again when it says something. The lists that the queues hold are asked for in full, because a place in the queue is a
   * place among all that are ready.
   */
  protected readonly facts = computed(() => {
    this.simulation.revision();
    const opened = this.opened();
    if (opened === null) {
      return { places: [] as Place[], redelivered: null as boolean | null };
    }
    const view = this.simulation.view();
    const lists = new Map<string, readonly QueueMessage[]>(
      opened.queues.map((queue) => {
        const counts = view.queues[queue];
        return [queue, this.simulation.messages(queue, (counts?.ready ?? 0) + (counts?.unacked ?? 0))];
      }),
    );
    const places = placesOf(opened.number, opened.queues, this.simulation.flights(), (queue) => lists.get(queue) ?? []);
    // A copy that is on its way to a consumer is still in the list of its queue, as one that is not acknowledged, so the lists say whether it was redelivered.
    const copies = [...lists.values()].flatMap((list) => list.filter(({ id }) => id === opened.number));
    const redelivered = copies.length === 0 ? null : copies.some((copy) => copy.redelivered);
    return { places, redelivered };
  });
  protected readonly places = computed(() => this.facts().places);

  /** The queues that did not get the message, which each have a button for the reasons. */
  protected readonly unreached = computed(() => {
    const explanation = this.opened()?.explanation;
    return explanation !== undefined && isRouted(explanation) ? explanation.unreached : [];
  });

  /** What the route is of: the one that the broker made, or where the message would go on the canvas as it is. */
  protected readonly basisText = computed(() => {
    switch (this.opened()?.basis) {
      case 'would':
        return 'It has not got to the broker yet. This is where it would go on the canvas as it is now, which is what the broker will use when it arrives.';
      case 'again':
        return 'Its route is not kept any more. This is where it would go on the canvas as it is now.';
      default:
        return null;
    }
  });

  protected placeSentence(place: Place): string {
    return placeText(place, (channel) => lookup(this.store.document().consumers, channel)?.name ?? channel);
  }

  protected isOpen(queue: string): boolean {
    return this.open().has(queue);
  }

  protected whyId(queue: string): string {
    return `${this.titleId}-why-${queue}`;
  }

  protected toggleWhy(queue: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(queue)) {
        next.add(queue);
      }
      return next;
    });
  }

  /** Why one queue did not get the message, with the canvas that the route was made with. */
  protected whyNot(queue: string): QueueExplanation {
    const opened = this.opened();
    if (opened === null) {
      throw new Error('there is no message open');
    }
    const { info, document } = opened;
    return explainQueue(toTopology(document), { exchange: info.exchange, key: info.key, headers: info.headers }, queue);
  }

  protected show(message: number): void {
    this.explain.showWhy(message);
  }

  /** Closes the message, and gives the keyboard to the canvas, where it was before the learner came to read it. */
  protected close(): void {
    this.explain.closeMessage();
    this.viewport.focus();
  }
}
