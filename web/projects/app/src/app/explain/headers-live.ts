import { Component, computed, inject, input } from '@angular/core';
import { exchangesLeadingTo, headersTable, toTopology, type HeadersTable, type TableCell } from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';
import { EventLog } from '../core/explain/event-log';
import { DocumentStore } from '../core/state/document-store';
import { Icon } from '../core/ui/icon';

/** How many recent messages the live table shows (ADR-0070). */
export const RECENT_LIMIT = 10;

let nextTable = 0;

const MARK = {
  pass: { icon: 'check', color: 'var(--rmq-explain-hit)' },
  fail: { icon: 'close', color: 'var(--rmq-explain-miss)' },
  ignored: { icon: 'info', color: 'var(--rmq-muted)' },
} as const;

/**
 * The live table of a headers binding (ADR-0070): the last messages that were published to its exchange, or to one that leads to it, against each condition, and the verdict of the binding for each. It is made by the
 * domain from the engine's matcher and the sentences of the message inspector, so it cannot say what they do not, and it follows the conditions that are being typed. It is worked out again when the conditions
 * change, when the canvas changes and once for each turn in which the log says something, with no timer, and only while it is on the screen. A cell is an icon and a word, and the whole sentence is its title; a row ends in
 * its verdict, in words. It needs the log, which needs the flags `simulation` and `explain`.
 */
@Component({
  selector: 'rmq-headers-live',
  imports: [Icon],
  template: `
    <section class="flex flex-col gap-1.5" data-testid="headers-live" [attr.aria-labelledby]="titleId">
      <h3 class="text-sm font-semibold" [id]="titleId">Recent messages</h3>
      @if (table().rows.length === 0) {
        <p class="text-muted text-xs" data-testid="headers-live-empty">
          No message has been published to {{ where() }} yet. Publish one from a producer, and it is checked here.
        </p>
      } @else {
        <div
          class="max-w-full overflow-x-auto"
          role="region"
          tabindex="0"
          data-testid="headers-live-scroll"
          [attr.aria-label]="'Recent messages against the conditions'"
        >
          <table class="w-full text-xs" data-testid="headers-live-table">
            <caption class="text-muted pb-1 text-left" data-testid="headers-live-caption">
              {{
                caption()
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col" class="text-muted pr-2 text-left font-normal">Message</th>
                @for (column of table().columns; track $index) {
                  <th scope="col" class="px-1 text-left font-mono font-normal">{{ column.text }}</th>
                }
                <th scope="col" class="text-muted pl-1 text-left font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              @for (row of table().rows; track row.message) {
                <tr class="border-line border-t" data-testid="headers-live-row" [attr.data-matched]="row.matched">
                  <th scope="row" class="py-1 pr-2 text-left align-top font-normal">
                    <span class="font-mono">#{{ row.message }}</span
                    >&ngsp;
                    <span class="text-muted block font-mono break-all">{{
                      row.headers === '' ? 'no headers' : row.headers
                    }}</span>
                  </th>
                  @for (cell of row.cells; track $index) {
                    <td
                      class="px-1 py-1 align-top"
                      data-testid="headers-live-cell"
                      [attr.data-outcome]="cell.outcome"
                      [attr.title]="cell.text"
                    >
                      <span class="flex items-center gap-0.5 whitespace-nowrap">
                        <rmq-icon [name]="mark(cell).icon" [size]="12" [style.color]="mark(cell).color" />{{
                          cell.word
                        }}
                      </span>
                    </td>
                  }
                  <td class="py-1 pl-1 align-top" data-testid="headers-live-result" [attr.title]="row.text">
                    <span class="flex items-center gap-0.5 font-medium whitespace-nowrap">
                      <rmq-icon
                        [name]="row.matched ? 'check' : 'close'"
                        [size]="12"
                        [style.color]="row.matched ? 'var(--rmq-explain-hit)' : 'var(--rmq-explain-miss)'"
                      />{{ row.result }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class HeadersLive {
  /** The conditions as they are being typed, or as the binding has them. */
  readonly headers = input<HeaderArguments | undefined>();
  /** The name of the exchange that the binding starts from. */
  readonly exchange = input.required<string>();

  private readonly log = inject(EventLog);
  private readonly store = inject(DocumentStore);
  protected readonly titleId = `rmq-headers-live-${nextTable++}`;

  /** The exchanges that a message can come to this one from, through bindings between exchanges. */
  private readonly leading = computed(() => exchangesLeadingTo(toTopology(this.store.document()), this.exchange()));

  /** What the log holds that was published to one of them. It is read again once for each turn in which something was said. */
  private readonly recent = computed(() => {
    this.log.changed();
    const leading = this.leading();
    return this.log.held.recent((held) => leading.has(held.info.exchange), RECENT_LIMIT);
  });

  protected readonly table = computed<HeadersTable>(() =>
    headersTable(
      this.headers(),
      this.recent().items.map(({ info }) => ({ id: info.id, headers: info.headers })),
    ),
  );

  protected readonly where = computed(() => (this.exchange() === '' ? 'the default exchange' : this.exchange()));

  protected readonly caption = computed(() => {
    const shown = this.table().rows.length;
    const total = this.recent().total;
    const of =
      total > shown
        ? `The last ${shown} of ${total} messages`
        : `${shown === 1 ? 'The message' : `The ${shown} messages`}`;
    return `${of} published to ${this.where()}${this.leading().size > 1 ? ' or to an exchange that leads to it' : ''}, newest first.`;
  });

  protected mark(cell: TableCell): (typeof MARK)[TableCell['outcome']] {
    return MARK[cell.outcome];
  }
}
