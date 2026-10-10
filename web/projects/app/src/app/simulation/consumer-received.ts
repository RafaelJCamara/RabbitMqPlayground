import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, linkedSignal } from '@angular/core';
import { lookup, type Id } from '@rmq/domain';
import { Announcer } from '../core/announcer';
import { ConsumerInbox, INBOX_ROWS, type ReceivedRow } from '../core/explain/consumer-inbox';
import { ExplainState } from '../core/explain/explain-state';
import { DocumentStore } from '../core/state/document-store';
import { BUTTON } from '../core/ui/buttons';

/** How much of a payload a row shows (ADR-0098). The payload is whole in the message inspector (ADR-0063). */
export const RECEIVED_CUT = 80;

/** How many rows a page of the list has (ADR-0105). */
export const RECEIVED_PAGE = 10;

let nextSection = 0;

/**
 * What a consumer was given, in its inspector (ADR-0098): the messages that the queues gave it, newest first, each with when, its number, its key, the payload in the face of code, and where it is with
 * the consumer (on its way, received, processed, acknowledged, or put back). Each row is a button that opens the message in the message inspector (ADR-0063), as a row of the list of a queue does. It is a
 * list that is read and not a live region, so that a screen reader is not read to for each message of a burst.
 *
 * It is in pages of ten, the newest on the first (ADR-0105), with Previous and Next and the words "Page 2 of 10 · messages 11–20 of 96"; a page that is changed is said aloud once, and the focus stays on the button that was
 * pressed (or goes to the other one when that one has no page left to go to). Clear empties the list of this consumer and only that: it is the view, and the messages and the simulation are not touched.
 */
@Component({
  selector: 'rmq-consumer-received',
  template: `
    @if (name(); as who) {
      <section class="flex flex-col gap-2" [attr.aria-labelledby]="titleId" data-testid="consumer-received">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold" [id]="titleId" tabindex="-1" data-testid="received-title">Received</h3>
          <button
            type="button"
            [class]="button"
            [disabled]="rows().length === 0"
            [attr.title]="
              rows().length === 0
                ? 'There is nothing to clear: no messages have been received.'
                : 'Empties this list. The messages and the simulation are not changed.'
            "
            data-testid="received-clear"
            (click)="clear(who)"
          >
            Clear
          </button>
        </div>
        @if (rows().length === 0) {
          <p class="text-muted text-sm" data-testid="received-empty">No messages received yet.</p>
        } @else {
          <ol
            class="border-line divide-line flex flex-col divide-y rounded-md border text-xs"
            [attr.aria-label]="'Messages received by ' + who"
            data-testid="received-list"
          >
            @for (row of shown(); track row.seq) {
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
          @if (pages() > 1) {
            <nav
              class="flex flex-wrap items-center gap-2 text-xs"
              [attr.aria-label]="'Pages of what ' + who + ' received'"
              data-testid="received-pages"
            >
              <button
                type="button"
                [class]="button"
                [disabled]="current() === 1"
                data-testid="received-previous"
                (click)="go(current() - 1, 'previous')"
              >
                Previous
              </button>
              <button
                type="button"
                [class]="button"
                [disabled]="current() === pages()"
                data-testid="received-next"
                (click)="go(current() + 1, 'next')"
              >
                Next
              </button>
              <span class="text-muted" data-testid="received-page">{{ where() }}</span>
            </nav>
          }
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
  private readonly announcer = inject(Announcer);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly explain = inject(ExplainState);

  protected readonly titleId = `rmq-consumer-received-${nextSection++}`;
  protected readonly limit = INBOX_ROWS;
  /** The name of the consumer, which is what the learner calls it now. */
  protected readonly name = computed(() => lookup(this.store.document().consumers, this.id())?.name ?? null);
  protected readonly rows = this.inbox.rowsOf(() => this.id());
  protected readonly button = BUTTON;

  /** The page that the learner asked for, from 1: it goes back to the first when another consumer is chosen or the list is cleared, and new messages do not change it. */
  private readonly page = linkedSignal<Id, number>({ source: () => this.id(), computation: () => 1 });
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.rows().length / RECEIVED_PAGE)));
  /** The page that is shown: the one asked for, kept inside the pages that there are, since the list can only get shorter by being cleared. */
  protected readonly current = computed(() => Math.min(this.page(), this.pages()));
  protected readonly shown = computed(() => {
    const from = (this.current() - 1) * RECEIVED_PAGE;
    return this.rows().slice(from, from + RECEIVED_PAGE);
  });
  /** "Page 2 of 10 · messages 11–20 of 96": text that is read, and not a live region (a page that is changed is announced instead). */
  protected readonly where = computed(() => this.say());

  private say(): string {
    const total = this.rows().length;
    const from = (this.current() - 1) * RECEIVED_PAGE + 1;
    const to = Math.min(total, this.current() * RECEIVED_PAGE);
    return `Page ${this.current()} of ${this.pages()} · messages ${from}–${to} of ${total}`;
  }

  /** Shows another page, says it once, and keeps the focus where the learner is: on the button that was pressed, or on the other one when that one has no page left to go to. */
  protected go(page: number, pressed: 'previous' | 'next'): void {
    this.page.set(Math.min(Math.max(1, page), this.pages()));
    this.announcer.announce(`${this.say().replace(' · messages', ', messages')}.`);
    const ends = pressed === 'previous' ? this.current() === 1 : this.current() === this.pages();
    if (ends) {
      // The other button is still switched off until the page has been drawn, and a switched off button cannot take the focus.
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>(`[data-testid="received-${pressed === 'previous' ? 'next' : 'previous'}"]`)
            ?.focus(),
        { injector: this.injector },
      );
    }
  }

  /** Empties the list of this consumer, says so, and gives the focus to the heading, since the button has nothing to do now. */
  protected clear(who: string): void {
    this.inbox.clear(this.id());
    this.page.set(1);
    this.announcer.announce(`Cleared what ${who} received.`);
    this.host.nativeElement.querySelector<HTMLElement>('[data-testid="received-title"]')?.focus();
  }

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
