import { Component, computed, inject } from '@angular/core';
import { kindOf } from '@rmq/domain';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { hintsFor } from './hints';
import type { SelectionFacts } from './keyboard';

/**
 * The hint bar (ADR-0010, ADR-0011, ADR-0035): a line under the canvas that says what the keys do now, for what is selected. It is for a
 * learner who has the canvas and does not know what to press. It is text, and not a live region, because it changes with every click
 * and a screen reader that read it each time would drown what matters.
 */
@Component({
  selector: 'rmq-hint-bar',
  template: `
    <section class="border-line bg-surface border-t px-4 py-1.5 text-xs" aria-label="Hints" data-testid="hints">
      <ul class="text-muted flex flex-wrap gap-x-4 gap-y-1">
        @for (hint of hints(); track hint.id) {
          <li>
            <kbd class="border-border text-fg rounded border px-1 font-mono">{{ hint.keys }}</kbd>
            {{ hint.label }}
          </li>
        }
      </ul>
    </section>
  `,
})
export class HintBar {
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);

  private readonly facts = computed<SelectionFacts>(() => {
    const { nodes, edges } = this.selection.selection();
    const [only] = nodes;
    const kind =
      nodes.length === 1 && edges.length === 0 && only !== undefined ? kindOf(this.store.document(), only) : undefined;
    return { nodes: nodes.length, edges: edges.length, kind };
  });

  protected readonly hints = computed(() => hintsFor(this.facts()));
}
