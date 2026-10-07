import { Component, computed, input } from '@angular/core';
import {
  isRouted,
  summaryOf,
  type BindingDetail,
  type BindingNode,
  type ExchangeNode,
  type RouteExplanation,
  type RoutedExplanation,
} from '@rmq/domain';
import { Icon } from '../core/ui/icon';

/** A column of the table of a topic binding (ADR-0059): a word of the pattern, the words of the key that it took, and what became of it. */
interface Cell {
  readonly pattern: string;
  readonly took: string;
  readonly outcome: 'matched' | 'differs' | 'missing' | 'extra';
}

/** An empty word is two quotes, so that it is seen. */
const word = (value: string): string => (value === '' ? '""' : value);

/** The columns of a topic binding: a column for each word of the pattern, and one for each word of the key that the pattern did not reach. */
export function topicCells(detail: Extract<BindingDetail, { kind: 'topic' }>): readonly Cell[] {
  const cells: Cell[] = detail.segments.map((segment) => ({
    pattern: word(segment.pattern),
    took: segment.words.length === 0 ? '-' : segment.words.map(word).join('.'),
    outcome: segment.outcome,
  }));
  if (detail.miss?.kind === 'key-has-extra-words') {
    for (const extra of detail.key.slice(detail.miss.keyIndex)) {
      cells.push({ pattern: '-', took: word(extra), outcome: 'extra' });
    }
  }
  return cells;
}

const RESULT: Readonly<Record<Cell['outcome'], string>> = {
  matched: 'matched',
  differs: 'differs',
  missing: 'missing',
  extra: 'extra',
};

/**
 * An exchange that a message reached, with every binding that starts from it (ADR-0063): the binding as a person says it, what it made of the message in a sentence, for a topic binding the pattern and the key word
 * by word, for a headers binding a line for each condition, and under a binding that took the message to an exchange that exchange, in the same way. A verdict is an icon and a word, and not a colour. It draws
 * itself for the exchange that a binding leads to, so a chain of exchanges is as deep as the canvas has them.
 */
@Component({
  selector: 'rmq-route-exchange',
  imports: [Icon],
  template: `
    <div class="flex flex-col gap-1.5" data-testid="route-exchange" [attr.data-exchange]="node().name">
      <p class="text-sm font-medium">{{ title() }}</p>
      <p class="text-muted text-xs">{{ node().text }}</p>
      @if (node().bindings.length > 0) {
        <ul class="border-line ml-1 flex flex-col gap-2.5 border-l-2 pl-3">
          @for (binding of node().bindings; track $index) {
            <li class="flex flex-col gap-1" data-testid="route-binding" [attr.data-verdict]="binding.verdict">
              <p class="flex items-start gap-1.5 text-sm">
                <rmq-icon
                  class="mt-0.5"
                  [name]="binding.verdict === 'matched' ? 'check' : 'close'"
                  [size]="14"
                  [style.color]="binding.verdict === 'matched' ? 'var(--rmq-explain-hit)' : 'var(--rmq-explain-miss)'"
                />
                <span>
                  <strong class="font-medium"
                    >{{ binding.verdict === 'matched' ? 'Matched' : 'Did not match' }}:</strong
                  >
                  {{ destination(binding) }} <span class="font-mono text-xs">({{ binding.label }})</span>
                </span>
              </p>
              <p class="text-muted text-xs" data-testid="binding-text">{{ binding.text }}</p>
              @if (topic(binding); as detail) {
                <table class="text-xs" data-testid="topic-table" aria-label="The pattern and the key, word by word">
                  <tbody>
                    <tr>
                      <th scope="row" class="text-muted pr-2 text-left font-normal">Pattern</th>
                      @for (cell of cells(detail); track $index) {
                        <td class="px-1 font-mono">{{ cell.pattern }}</td>
                      }
                    </tr>
                    <tr>
                      <th scope="row" class="text-muted pr-2 text-left font-normal">Key</th>
                      @for (cell of cells(detail); track $index) {
                        <td class="px-1 font-mono">{{ cell.took }}</td>
                      }
                    </tr>
                    <tr>
                      <th scope="row" class="text-muted pr-2 text-left font-normal">Result</th>
                      @for (cell of cells(detail); track $index) {
                        <td class="px-1" [attr.data-outcome]="cell.outcome">
                          <span class="flex items-center gap-0.5">
                            <rmq-icon
                              [name]="cell.outcome === 'matched' ? 'check' : 'close'"
                              [size]="12"
                              [style.color]="
                                cell.outcome === 'matched' ? 'var(--rmq-explain-hit)' : 'var(--rmq-explain-miss)'
                              "
                            />{{ result[cell.outcome] }}
                          </span>
                        </td>
                      }
                    </tr>
                  </tbody>
                </table>
              }
              @if (conditions(binding); as lines) {
                <ul class="flex flex-col gap-0.5 text-xs" data-testid="header-conditions" aria-label="The conditions">
                  @for (line of lines; track $index) {
                    <li class="flex items-start gap-1.5" [attr.data-outcome]="line.outcome">
                      <rmq-icon
                        class="mt-0.5"
                        [name]="line.outcome === 'pass' ? 'check' : line.outcome === 'fail' ? 'close' : 'info'"
                        [size]="12"
                        [style.color]="
                          line.outcome === 'pass'
                            ? 'var(--rmq-explain-hit)'
                            : line.outcome === 'fail'
                              ? 'var(--rmq-explain-miss)'
                              : 'var(--rmq-muted)'
                        "
                      />
                      <span>{{ line.text }}</span>
                    </li>
                  }
                </ul>
              }
              @if (binding.next; as next) {
                <rmq-route-exchange [node]="next" />
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class RouteExchange {
  readonly node = input.required<ExchangeNode>();

  protected readonly result = RESULT;
  protected readonly title = computed(() => {
    const { name, type } = this.node();
    return type === 'default' ? 'The default exchange' : `Exchange ${name} (${type})`;
  });

  protected destination(binding: BindingNode): string {
    return `${binding.to.kind} ${binding.to.name}`;
  }

  protected topic(binding: BindingNode): Extract<BindingDetail, { kind: 'topic' }> | null {
    return binding.detail.kind === 'topic' ? binding.detail : null;
  }

  protected cells(detail: Extract<BindingDetail, { kind: 'topic' }>): readonly Cell[] {
    return topicCells(detail);
  }

  protected conditions(binding: BindingNode) {
    return binding.detail.kind === 'headers' ? binding.detail.conditions : null;
  }
}

/**
 * The route of a message as the explanation says it (ADR-0060, ADR-0063): what became of it in a sentence, and under it the tree of exchanges and bindings that it met. A message that could not be sent, and one that
 * the broker refused, say the cause first and have no tree.
 */
@Component({
  selector: 'rmq-route-tree',
  imports: [RouteExchange],
  template: `
    @if (routed(); as tree) {
      <p class="text-sm" data-testid="route-summary">{{ tree.summary }}</p>
      <rmq-route-exchange [node]="tree.root" />
    } @else {
      <p class="text-sm" data-testid="route-summary">{{ summary() }}</p>
      @if (reply(); as reply) {
        <p class="text-muted text-xs" data-testid="route-reply">The broker replies: {{ reply }}</p>
      }
    }
  `,
  host: { class: 'flex flex-col gap-2' },
})
export class RouteTree {
  readonly explanation = input.required<RouteExplanation>();

  protected readonly routed = computed<RoutedExplanation | null>(() => {
    const explanation = this.explanation();
    return isRouted(explanation) ? explanation : null;
  });
  protected readonly summary = computed(() => summaryOf(this.explanation()));
  protected readonly reply = computed(() => {
    const explanation = this.explanation();
    return explanation.outcome === 'refused' ? explanation.reply : null;
  });
}
