import { Component, computed, inject, input } from '@angular/core';
import type { Id } from '@rmq/domain';
import { SimStats } from '../../core/runtime/sim-stats';
import type { ConsumerStats, ExchangeStats, NodeStats, ProducerStats, QueueStats } from '../../core/runtime/stats';
import { Icon } from '../../core/ui/icon';

/** How many small squares a stack, or places a row of slots, are drawn with before the rest is a number (ADR-0056). */
export const PICTURE_LIMIT = 8;

/** What a stack of a queue is drawn with: a square for each message that is ready, and a hollow one for each that a consumer holds, up to the limit. */
export function stackOf(queue: Pick<QueueStats, 'ready' | 'unacked'>): { full: number; hollow: number; more: number } {
  const full = Math.min(queue.ready, PICTURE_LIMIT);
  const hollow = Math.min(queue.unacked, PICTURE_LIMIT - full);
  return { full, hollow, more: queue.ready + queue.unacked - full - hollow };
}

/**
 * What the slots of a consumer are drawn with: a place for each message that it may hold, full for each that it holds, up to the limit. A consumer with no limit, and one that
 * acknowledges for itself, which holds nothing, have `∞` and no places.
 */
export function slotsOf(consumer: Pick<ConsumerStats, 'holds' | 'limit' | 'acksItself'>): {
  readonly places: number;
  readonly full: number;
  readonly unlimited: boolean;
  readonly more: number;
} {
  if (consumer.limit === 0 || consumer.acksItself) {
    return { places: 0, full: 0, unlimited: true, more: 0 };
  }
  const places = Math.min(consumer.limit, PICTURE_LIMIT);
  const full = Math.min(consumer.holds, places);
  return { places, full, unlimited: false, more: consumer.limit - places };
}

/** The words of a producer, which say what its picture says. */
export const producerWords = (stats: ProducerStats): string => `sent ${stats.sent}`;

/** The words of an exchange: what it routed, what no queue got, and what the broker refused, which is said only when something was. */
export const exchangeWords = (stats: ExchangeStats): string =>
  `routed ${stats.routed} · unroutable ${stats.unroutable}${stats.refused > 0 ? ` · refused ${stats.refused}` : ''}`;

/** The words of a queue. */
export const queueWords = (stats: QueueStats): string => `${stats.ready} ready · ${stats.unacked} unacked`;

/** The words of a consumer: how many it holds of how many it may, what it has finished with, and what waits for it, which is said only when something does. */
export function consumerWords(stats: ConsumerStats): string {
  const holds = stats.acksItself ? 'holds none' : `holds ${stats.holds} of ${stats.limit === 0 ? '∞' : stats.limit}`;
  return `${holds} · done ${stats.finished}${stats.waiting > 0 ? ` · ${stats.waiting} waiting` : ''}`;
}

/** The squares of a picture: the first `full` are full, and the rest, up to `total`, are not. */
const squares = (full: number, total: number): ('full' | 'empty')[] =>
  Array.from({ length: total }, (_, index) => (index < full ? 'full' : 'empty'));

/**
 * What a node says about itself while the simulation runs (ADR-0056): the counts of a producer and of an exchange, a stack of a queue with its ready and unacknowledged
 * messages, and the slots of a consumer with what it holds. It reads the signal of its own node and nothing else, so a burst of messages to one queue checks this
 * component of that queue and not the template of the adapter or the other nodes. It is drawn under the box of the node, and not in it, and takes no pointer. The picture
 * is `aria-hidden`: the words say it.
 */
@Component({
  selector: 'rmq-node-stats',
  imports: [Icon],
  template: `
    @if (present()) {
      <div
        class="text-fg pointer-events-none absolute top-full left-1/2 mt-1 flex -translate-x-1/2 flex-col items-center gap-0.5 text-xs whitespace-nowrap"
        data-testid="node-stats"
      >
        @if (producer(); as numbers) {
          <span class="flex items-center gap-1">
            @if (numbers.repeating) {
              <rmq-icon name="reset" [size]="12" />
            }
            <span data-testid="stats-text">{{ producerWords(numbers) }}</span>
          </span>
        }
        @if (exchange(); as numbers) {
          <span data-testid="stats-text">{{ exchangeWords(numbers) }}</span>
        }
        @if (queue(); as numbers) {
          @let stack = stackOf(numbers);
          <span class="flex items-end gap-px" aria-hidden="true" data-testid="stack">
            @for (square of squares(stack.full, stack.full + stack.hollow); track $index) {
              <span class="border-fg size-2 border" [class.bg-fg]="square === 'full'"></span>
            }
            @if (stack.more > 0) {
              <span class="pl-0.5" data-testid="stack-more">+{{ stack.more }}</span>
            }
          </span>
          <span data-testid="stats-text">{{ queueWords(numbers) }}</span>
        }
        @if (consumer(); as numbers) {
          @let slots = slotsOf(numbers);
          <span class="flex items-end gap-px" aria-hidden="true" data-testid="slots">
            @if (slots.unlimited) {
              <span>∞</span>
            } @else {
              @for (place of squares(slots.full, slots.places); track $index) {
                <span class="border-fg size-2 border" [class.bg-fg]="place === 'full'"></span>
              }
              @if (slots.more > 0) {
                <span class="pl-0.5" data-testid="slots-more">+{{ slots.more }}</span>
              }
            }
          </span>
          <span data-testid="stats-text">{{ consumerWords(numbers) }}</span>
        }
      </div>
    }
  `,
})
export class NodeStatsView {
  /** The id of the node. */
  readonly id = input.required<Id>();

  private readonly all = inject(SimStats);

  private readonly numbers = computed<NodeStats | null>(() => this.all.of(this.id())());
  protected readonly present = computed(() => this.numbers() !== null);
  protected readonly producer = computed(() => {
    const numbers = this.numbers();
    return numbers?.kind === 'producer' ? numbers : null;
  });
  protected readonly exchange = computed(() => {
    const numbers = this.numbers();
    return numbers?.kind === 'exchange' ? numbers : null;
  });
  protected readonly queue = computed(() => {
    const numbers = this.numbers();
    return numbers?.kind === 'queue' ? numbers : null;
  });
  protected readonly consumer = computed(() => {
    const numbers = this.numbers();
    return numbers?.kind === 'consumer' ? numbers : null;
  });

  // What the template says, which are the functions above: a kind that the node is not has nothing to compute.
  protected readonly producerWords = producerWords;
  protected readonly exchangeWords = exchangeWords;
  protected readonly queueWords = queueWords;
  protected readonly consumerWords = consumerWords;
  protected readonly stackOf = stackOf;
  protected readonly slotsOf = slotsOf;
  protected readonly squares = squares;
}
