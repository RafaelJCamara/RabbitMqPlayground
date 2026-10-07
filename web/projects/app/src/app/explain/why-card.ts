import { Component, computed, inject } from '@angular/core';
import { ExplainState } from '../core/explain/explain-state';

/** What each look means, in the words that the card uses. The look of a line is a shape as well as a colour: thick for where a message went, dimmed and dashed for where it did not, dotted for what is asked about. */
interface Legend {
  readonly id: 'hit' | 'miss' | 'asked';
  readonly text: string;
}

/**
 * The card of Why? (ADR-0062): over the canvas, in its corner, while something is lit, it says what it is in words, what the lines mean, and how many parts of what was chosen are not on the canvas any more, and has a
 * button to let it go. It is a labelled group inside the region of the canvas, and it is there only while something is lit. It does not speak: what was chosen was said, once, when it was chosen.
 */
@Component({
  selector: 'rmq-why-card',
  template: `
    @if (explain.shown(); as shown) {
      <div
        role="group"
        aria-labelledby="rmq-why-title"
        class="border-border bg-panel text-fg absolute top-3 left-3 z-10 flex max-w-sm flex-col gap-1.5 rounded-md border p-3 text-sm shadow-lg"
        data-testid="why-card"
        [attr.data-source]="shown.source"
      >
        <h2 id="rmq-why-title" class="font-semibold" data-testid="why-card-title">{{ shown.title }}</h2>
        <p data-testid="why-card-text">{{ shown.text }}</p>
        @if (shown.emphasis.gone > 0) {
          <p class="text-muted" data-testid="why-card-gone">{{ gone(shown.emphasis.gone) }}</p>
        }
        @if (legend(); as items) {
          <ul class="text-muted flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="What the lines mean">
            @for (item of items; track item.id) {
              <li class="flex items-center gap-1.5" [attr.data-legend]="item.id">
                <svg width="24" height="8" aria-hidden="true" focusable="false">
                  @switch (item.id) {
                    @case ('hit') {
                      <line x1="1" y1="4" x2="23" y2="4" stroke="var(--rmq-explain-hit)" stroke-width="4" />
                    }
                    @case ('miss') {
                      <line
                        x1="1"
                        y1="4"
                        x2="23"
                        y2="4"
                        stroke="var(--rmq-explain-miss)"
                        stroke-width="2"
                        stroke-dasharray="4 3"
                        stroke-opacity="0.6"
                      />
                    }
                    @default {
                      <line
                        x1="2"
                        y1="4"
                        x2="22"
                        y2="4"
                        stroke="var(--rmq-explain-asked)"
                        stroke-width="4"
                        stroke-dasharray="1 7"
                        stroke-linecap="round"
                      />
                    }
                  }
                </svg>
                <span>{{ item.text }}</span>
              </li>
            }
          </ul>
        }
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas flex min-h-7 items-center rounded-md border px-2 py-0.5"
            data-testid="why-card-let-go"
            (click)="explain.letGoOfWhat()"
          >
            {{ buttonFor(shown.source) }}
          </button>
        </div>
      </div>
    }
  `,
})
export class WhyCard {
  protected readonly explain = inject(ExplainState);

  /** What the lines on the canvas mean now, for the looks that are there, or `null` when none is. */
  protected readonly legend = computed<readonly Legend[] | null>(() => {
    const shown = this.explain.shown();
    if (shown === null) {
      return null;
    }
    const edges = [...shown.emphasis.edges.values()].map(({ mark }) => mark);
    const nodes = [...shown.emphasis.nodes.values()];
    const items: Legend[] = [];
    if (
      edges.some((mark) => mark === 'path' || mark === 'matched') ||
      nodes.some((mark) => mark === 'reached' || mark === 'visited')
    ) {
      items.push({ id: 'hit', text: 'went this way, or got a copy' });
    }
    if (edges.includes('missed') || nodes.includes('missed')) {
      items.push({ id: 'miss', text: 'did not match, and why' });
    }
    if (edges.includes('asked') || nodes.includes('asked')) {
      items.push({ id: 'asked', text: 'asked about' });
    }
    return items.length === 0 ? null : items;
  });

  /** What the button says, for what it does: a queue that is asked about is let go of by asking no more, and the tester by shutting it. */
  protected buttonFor(source: string): string {
    return source === 'queue' ? 'Stop asking' : source === 'what-if' ? 'Close the tester' : 'Let go';
  }

  protected gone(count: number): string {
    return count === 1
      ? 'One part of this is not on the canvas any more.'
      : `${count} parts of this are not on the canvas any more.`;
  }
}
