import { Component, computed, DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { edgeCount } from '@rmq/domain';
import { localStorageOf } from '../core/browser-storage';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { WAYS_TO_LINK } from './ways-to-link';

/** Whether the learner has dismissed the card, or has linked, is a preference of the browser, as the theme is, and not part of any canvas. */
export const HOW_TO_LINK_KEY = 'rmq.how-to-link';

/** What is written when the card is dismissed. Anything else that is stored is not a yes. */
const DISMISSED = 'dismissed';

export function readDismissed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(HOW_TO_LINK_KEY) === DISMISSED;
  } catch {
    return false;
  }
}

/** A failure is not an error to show: the card goes for this visit anyway. */
export function writeDismissed(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(HOW_TO_LINK_KEY, DISMISSED);
  } catch {
    // The card is gone until the page is closed, which is all that can be done.
  }
}

/**
 * Whether the card of the first run is shown (ADR-0047): while the canvas has no edge, and the learner has neither dismissed it nor linked. The first edge that a
 * command makes dismisses it for good, by whatever way it was made, because that learner has found a way. A canvas that is opened with edges already does not.
 */
@Injectable()
export class HowToLink {
  private readonly store = inject(DocumentStore);
  private readonly storage = localStorageOf(inject(DOCUMENT));
  private readonly gone = signal(readDismissed(this.storage));

  readonly visible = computed(() => !this.gone() && edgeCount(this.store.document()) === 0);

  constructor() {
    const stop = inject(CommandBus).onApplied(({ before, after }) => {
      if (edgeCount(after) > edgeCount(before)) {
        this.dismiss();
      }
    });
    inject(DestroyRef).onDestroy(stop);
  }

  dismiss(): void {
    this.gone.set(true);
    writeDismissed(this.storage);
  }
}

/**
 * The card of the first run (ADR-0047): a banner under the top bar, and not over the canvas, that lists the five ways to link and says that the command bar does it
 * with a line. It is a region with a name, and takes no focus.
 */
@Component({
  selector: 'rmq-how-to-link',
  template: `
    @if (card.visible()) {
      <section
        class="border-line bg-panel border-b px-4 py-1.5 text-sm"
        aria-label="How to link"
        data-testid="how-to-link"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-4">
              <h2 class="font-semibold">How to link</h2>
              <p class="text-muted">
                The command bar (<kbd class="border-border text-fg rounded border px-1 font-mono">/</kbd>) does the same
                with a line, for example <code class="font-mono">bind orders -> billing</code>. Press
                <kbd class="border-border text-fg rounded border px-1 font-mono">?</kbd> for every key and command.
              </p>
            </div>
            <ol class="mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
              @for (way of ways; track way) {
                <li class="border-line rounded border px-2">{{ way }}</li>
              }
            </ol>
          </div>
          <button
            type="button"
            class="border-border hover:bg-canvas shrink-0 rounded-md border px-3 py-1 font-medium"
            (click)="card.dismiss()"
          >
            Got it
          </button>
        </div>
      </section>
    }
  `,
  host: { class: 'contents' },
})
export class HowToLinkCard {
  protected readonly card = inject(HowToLink);
  protected readonly ways = WAYS_TO_LINK.map((way) => way.short);
}
