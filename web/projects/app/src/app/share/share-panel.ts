import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { CanvasDocument } from '@rmq/domain';
import type { EngineSnapshot } from '@rmq/engine';
import { Announcer } from '../core/announcer';
import { FeatureFlags } from '../core/flags/feature-flags';
import { TEXT_CLIPBOARD } from '../core/share/clipboard';
import { PAGE_ADDRESS } from '../core/share/page-address';
import { BUTTON, BUTTON_PRIMARY } from '../core/ui/buttons';
import { Icon } from '../core/ui/icon';
import { fileInstead, LINK_MAKER, linkBase, type MadeLink } from './link-maker';

export const SHARE_TITLE_ID = 'rmq-share-title';

/** What the panel that makes a link needs (ADR-0078). */
export interface SharePanelData {
  /** The name of the canvas, which is the name of the link. */
  readonly name: string;
  /** The canvas as it is to be shared: on the screen for the editor, and as it is saved for a card of the home. */
  readonly document: CanvasDocument;
  /** The messages of the canvas, where there is a simulation to ask: how many there are, and a way to take them as they are when the choice is made. */
  readonly messages?: { readonly count: number; snapshot(): EngineSnapshot };
  /** Gives the canvas as a file (ADR-0075), which a link too long to send is replaced by. */
  readonly saveAsFile: () => void;
}

const NUMBER = new Intl.NumberFormat('en-US');

/**
 * The panel that makes a link to a canvas (ADR-0078, ADR-0013): what the link is, what to put in it, the link in a field that selects itself and a button that copies it, how long it is, and the file instead when it is too
 * long to send. The link is made when the panel opens and again when the choice changes. It is made by the compressor of the browser, so it takes a moment, and the panel says so.
 */
@Component({
  selector: 'rmq-share-panel',
  imports: [Icon],
  template: `
    <section
      class="bg-panel text-fg border-border flex max-h-[90dvh] w-[min(36rem,94vw)] flex-col gap-3 overflow-y-auto rounded-lg border p-4 shadow-xl"
      data-testid="share-panel"
    >
      <h2 class="text-base font-semibold" [id]="titleId">Share “{{ data.name }}”</h2>
      <p class="text-muted">
        Anyone who has the link can read the whole canvas, with every name in it. A link is a copy, so what you change
        later is not in it.
      </p>

      <fieldset class="flex flex-col gap-1.5">
        <legend class="font-medium">What to share</legend>
        <label class="flex items-center gap-2">
          <input
            type="radio"
            name="rmq-share-what"
            [checked]="!withMessages()"
            data-testid="share-choice-canvas"
            (change)="choose(false)"
          />
          <span>The canvas</span>
        </label>
        @if (data.messages; as messages) {
          <label class="flex items-center gap-2">
            <input
              type="radio"
              name="rmq-share-what"
              [checked]="withMessages()"
              [disabled]="messages.count === 0"
              [attr.aria-describedby]="messages.count === 0 ? noMessagesId : null"
              data-testid="share-choice-messages"
              (change)="choose(true)"
            />
            <span>The canvas and its {{ messages.count }} {{ messages.count === 1 ? 'message' : 'messages' }}</span>
          </label>
          @if (messages.count === 0) {
            <p [id]="noMessagesId" class="text-muted pl-6 text-sm" data-testid="share-no-messages">
              No message is on the canvas now, so there are none to share. Publish one, and open this again.
            </p>
          } @else if (withMessages()) {
            <p class="text-muted pl-6 text-sm">
              Whoever opens the link sees the messages where they are now, paused, and can play them on.
            </p>
          }
        }
      </fieldset>

      <div class="flex flex-col gap-1.5">
        <label class="font-medium" for="rmq-share-link">Link</label>
        <div class="flex flex-wrap gap-2">
          <input
            #field
            id="rmq-share-link"
            type="text"
            readonly
            spellcheck="false"
            class="border-border bg-surface min-w-0 flex-1 rounded-md border px-2 py-1.5 font-mono text-sm"
            [value]="address()"
            [attr.aria-describedby]="statusId"
            data-testid="share-link"
            (focus)="select()"
            (click)="select()"
          />
          <button
            type="button"
            [class]="primary"
            [disabled]="address() === ''"
            data-testid="share-copy"
            (click)="copy()"
          >
            <rmq-icon name="link" [size]="16" />
            <span>Copy link</span>
          </button>
        </div>
        <div [id]="statusId" role="status" class="text-muted text-sm" data-testid="share-status">
          @if (made(); as link) {
            @if (link.kind === 'ready') {
              @if (notice(); as said) {
                <p data-testid="share-notice">{{ said }}</p>
              }
              <p data-testid="share-length">The link is {{ length(link.length) }} characters long.</p>
            }
          } @else {
            <p data-testid="share-making">Making the link…</p>
          }
        </div>
      </div>

      @if (made(); as link) {
        @if (link.kind === 'ready' && link.long) {
          <div
            class="border-warning bg-warning-bg text-warning flex flex-col items-start gap-2 rounded-md border px-3 py-2"
            data-testid="share-long"
          >
            <p>
              This link is {{ length(link.length) }} characters long. Some chat apps and mail clients cut a link that
              long, and then it does not open. Send the canvas as a file instead.
            </p>
            <button type="button" [class]="button" data-testid="share-download" (click)="data.saveAsFile()">
              Download file
            </button>
          </div>
        } @else if (link.kind === 'failed') {
          <div
            class="border-danger bg-danger-bg text-danger flex flex-col items-start gap-2 rounded-md border px-3 py-2"
            role="alert"
            data-testid="share-error"
          >
            <p>{{ link.error.message }}</p>
            @if (offerFile(link)) {
              <button type="button" [class]="button" data-testid="share-download" (click)="data.saveAsFile()">
                Download file
              </button>
            }
          </div>
        }
      }

      <div class="flex justify-end">
        <button type="button" [class]="button" data-testid="share-close" (click)="ref.close()">Close</button>
      </div>
    </section>
  `,
})
export class SharePanel {
  protected readonly data = inject<SharePanelData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  private readonly announcer = inject(Announcer);
  private readonly clipboard = inject(TEXT_CLIPBOARD);
  private readonly page = inject(PAGE_ADDRESS);
  private readonly flags = inject(FeatureFlags);
  private readonly makeLink = inject(LINK_MAKER);

  protected readonly titleId = SHARE_TITLE_ID;
  protected readonly statusId = 'rmq-share-status';
  protected readonly noMessagesId = 'rmq-share-no-messages';
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;

  protected readonly withMessages = signal(false);
  /** What making the link came to, or `null` while it is being made. */
  protected readonly made = signal<MadeLink | null>(null);
  protected readonly notice = signal<string | null>(null);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  /** Counts the links that were asked for, so that one that comes back after another was asked for is not shown. */
  private turn = 0;

  constructor() {
    void this.make();
  }

  protected address(): string {
    const link = this.made();
    return link?.kind === 'ready' ? link.address : '';
  }

  protected length(count: number): string {
    return NUMBER.format(count);
  }

  protected offerFile(link: Extract<MadeLink, { kind: 'failed' }>): boolean {
    return fileInstead(link.error);
  }

  /** A radio button says `change` only when it is chosen and was not, so a choice is always another one. */
  protected choose(withMessages: boolean): void {
    this.withMessages.set(withMessages);
    void this.make();
  }

  protected select(): void {
    this.field().nativeElement.select();
  }

  protected async copy(): Promise<void> {
    const link = this.made();
    if (link?.kind !== 'ready') {
      return;
    }
    if (await this.clipboard.write(link.address)) {
      this.notice.set('Link copied.');
      this.announcer.announce('Link copied.');
      return;
    }
    this.notice.set(
      'The browser did not let this page copy the link. It is selected: press Ctrl+C, or Command+C on a Mac, to copy it.',
    );
    this.select();
  }

  /** Makes the link for the choice, as the canvas and its messages are now. */
  private async make(): Promise<void> {
    const turn = (this.turn += 1);
    this.made.set(null);
    this.notice.set(null);
    const { messages } = this.data;
    const simulation = this.withMessages() && messages !== undefined ? messages.snapshot() : undefined;
    const link = await this.makeLink(
      { name: this.data.name, document: this.data.document, ...(simulation === undefined ? {} : { simulation }) },
      linkBase(this.page, this.flags),
    );
    if (turn === this.turn) {
      this.made.set(link);
    }
  }
}
