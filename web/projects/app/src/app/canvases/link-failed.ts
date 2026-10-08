import { Component, computed, inject, input } from '@angular/core';
import type { ShareError } from '@rmq/persistence';
import { APP_DISCLAIMER, APP_NAME } from '../core/app-info';
import { LinkOpening } from '../core/share/link-opening';
import { PAGE_ADDRESS } from '../core/share/page-address';

/** What a refusal ends with when its own words do not say it: that the page was left as it was (ADR-0078). */
const NOTHING_CHANGED = 'Nothing was opened and nothing was changed.';

/**
 * The page of a link that cannot be opened (ADR-0078): the message of the codec, which says what is wrong with the link in the order of the checks (ADR-0077), that nothing was opened and nothing was changed, and a link that takes the learner
 * to the playground with the fragment taken off. It is plain text: the message may quote a name from the link, and it is shown as text.
 */
@Component({
  selector: 'rmq-link-failed',
  template: `
    <div class="bg-surface text-fg flex min-h-dvh flex-col">
      <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <h1 class="text-4xl font-semibold tracking-tight">{{ name }}</h1>
        <h2 class="text-2xl font-semibold">This link could not be opened</h2>
        <p
          class="border-danger bg-danger-bg text-danger rounded-lg border px-4 py-3"
          role="alert"
          data-testid="link-failed"
        >
          {{ text() }}
        </p>
        <p>
          <a
            class="text-link underline underline-offset-4"
            [href]="home"
            data-testid="link-home"
            (click)="leave($event)"
          >
            Go to the playground
          </a>
        </p>
      </main>
      <footer class="text-muted px-6 py-6 text-sm">
        <p class="mx-auto max-w-2xl">{{ disclaimer }}</p>
      </footer>
    </div>
  `,
})
export class LinkFailed {
  /** Why the link could not be opened. */
  readonly error = input.required<ShareError>();

  protected readonly name = APP_NAME;
  protected readonly disclaimer = APP_DISCLAIMER;
  /** The page without the link, with the query that the learner came with, which a click with the middle button opens in a tab. */
  protected readonly home = inject(PAGE_ADDRESS).home();
  private readonly link = inject(LinkOpening);

  protected readonly text = computed(() => {
    const { message } = this.error();
    return message.includes('nothing was changed') ? message : `${message} ${NOTHING_CHANGED}`;
  });

  /** A click takes the fragment off the address of this entry of the history and loads the page, so that going back does not return to the link. */
  protected leave(event: Event): void {
    event.preventDefault();
    this.link.leave();
  }
}
