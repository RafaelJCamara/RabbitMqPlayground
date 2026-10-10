import { Component, computed, inject, input } from '@angular/core';
import { lookup, type Id } from '@rmq/domain';
import { ConsumerInbox, INBOX_ROWS, type ReceivedRow } from '../core/explain/consumer-inbox';
import { ExplainState } from '../core/explain/explain-state';
import { DocumentStore } from '../core/state/document-store';

/** How much of a payload a row shows (ADR-0098). The payload is whole in the message inspector (ADR-0063). */
export const RECEIVED_CUT = 80;

let nextSection = 0;

/**
 * What a consumer was given, in its inspector (ADR-0098): the messages that the queues gave it, newest first, each with when, its number, its key, the payload in the face of code, and where it is with
 * the consumer (on its way, received, processed, acknowledged, or put back). Each row is a button that opens the message in the message inspector (ADR-0063), as a row of the list of a queue does. It is a
 * list that is read and not a live region, so that a screen reader is not read to for each message of a burst.
 */
@Component({
  selector: 'rmq-consumer-received',
  template: `
    @if (name(); as who) {
      <section class="flex flex-col gap-2" [attr.aria-labelledby]="titleId" data-testid="consumer-received">
        <h3 class="text-sm font-semibold" [id]="titleId">Received</h3>
        @if (rows().length === 0) {
          <p class="text-muted text-sm" data-testid="received-empty">No messages received yet.</p>
        } @else {
          <ol
            class="border-line divide-line flex flex-col divide-y rounded-md border text-xs"
            [attr.aria-label]="'Messages received by ' + who"
            data-testid="received-list"
          >
            @for (row of rows(); track row.seq) {
              <li data-testid="received-row">
                <button
                  type="button"
                  class="hover:bg-canvas flex min-h-7 w-full flex-col gap-0.5 px-2 py-1 text-left"
                  data-testid="open-received"
                  [attr.title]="'Open message ' + row.message + ' in the inspector'"
                  [attr.aria-current]="explain.message() === row.message ? 'true' : null"
                  (click)="open(row)"
                >
                  <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span class="text-muted">{{ time(row.at) }}</span>
                    <span class="font-mono">#{{ row.message }}</span>
                    @if (row.info; as info) {
                      <span class="font-mono">{{ info.key === '' ? '(no key)' : info.key }}</span>
                    }
                    <span class="border-border rounded border px-1" data-testid="received-state">{{ row.state }}</span>
                    @if (row.redelivered) {
                      <span class="border-warning text-warning rounded border px-1">redelivered</span>
                    }
                  </span>
                  <span
                    class="min-w-0 font-mono break-all"
                    [class.text-muted]="row.info === null || row.info.payload === ''"
                    data-testid="received-payload"
                    >{{ payload(row) }}</span
                  >
                </button>
              </li>
            }
          </ol>
          @if (rows().length >= limit) {
            <p class="text-muted text-xs" data-testid="received-limit">The last {{ limit }} are kept.</p>
          }
        }
      </section>
    }
  `,
})
export class ConsumerReceived {
  /** The id of the consumer, which is the id of its node. */
  readonly id = input.required<Id>();

  private readonly store = inject(DocumentStore);
  private readonly inbox = inject(ConsumerInbox);
  protected readonly explain = inject(ExplainState);

  protected readonly titleId = `rmq-consumer-received-${nextSection++}`;
  protected readonly limit = INBOX_ROWS;
  /** The name of the consumer, which is what the learner calls it now. */
  protected readonly name = computed(() => lookup(this.store.document().consumers, this.id())?.name ?? null);
  protected readonly rows = this.inbox.rowsOf(() => this.id());

  /** The virtual time of the row, in seconds as the log says it. */
  protected time(at: number): string {
    return `${(at / 1000).toFixed(3)} s`;
  }

  /** What the row says of the payload: a cut of it, or that there was none, or that it is not held any more. */
  protected payload(row: ReceivedRow): string {
    if (row.info === null) {
      return '(payload no longer kept)';
    }
    const text = row.info.payload;
    if (text === '') {
      return '(empty payload)';
    }
    return text.length <= RECEIVED_CUT ? text : `${text.slice(0, RECEIVED_CUT - 1)}…`;
  }

  /** Opens the message in the inspector, with what is known of it here, for the case that the log has stopped holding it. */
  protected open(row: ReceivedRow): void {
    this.explain.openMessage(row.message, row.info === null ? undefined : { info: row.info, queue: row.queue });
  }
}
