import { Component, computed, input } from '@angular/core';
import type { BindingNode, QueueExplanation, ReasonNode } from '@rmq/domain';

/** The reasons that a queue did not get a message, each as a sentence, and under a way that was not followed the reasons that the exchange at the end of it was not reached. */
@Component({
  selector: 'rmq-reason-list',
  template: `
    <ul class="flex flex-col gap-1" data-testid="reasons">
      @for (reason of reasons(); track $index) {
        <li class="flex flex-col gap-1" data-testid="reason" [attr.data-kind]="reason.kind">
          <span>{{ reason.text }}</span>
          @if (inner(reason); as because) {
            <rmq-reason-list class="border-line ml-1 border-l-2 pl-3" [reasons]="because" />
          }
        </li>
      }
    </ul>
  `,
})
export class ReasonList {
  readonly reasons = input.required<readonly ReasonNode[]>();

  protected inner(reason: ReasonNode): readonly ReasonNode[] | null {
    return reason.kind === 'exchange-not-reached' && reason.because.length > 0 ? reason.because : null;
  }
}

/**
 * Why a queue got a copy of a message, or did not (ADR-0060, ADR-0063): one sentence, cause first, and for a queue that did not, every way that it could have been reached and what stopped each; for a queue that
 * did, the bindings that took the message to it, in order. It is the explanation as the domain makes it, and it says nothing of its own.
 */
@Component({
  selector: 'rmq-queue-why',
  imports: [ReasonList],
  template: `
    <p class="text-sm" data-testid="queue-why-text">{{ explanation().text }}</p>
    @if (explanation().reached) {
      @if (path().length > 0) {
        <ol
          class="flex flex-col gap-1 text-xs"
          data-testid="queue-why-path"
          aria-label="The bindings that took it there"
        >
          @for (step of path(); track $index) {
            <li>{{ step.text }}</li>
          }
        </ol>
      }
    } @else if (explanation().because.length > 0) {
      <div class="text-xs" data-testid="queue-why-reasons">
        <rmq-reason-list [reasons]="explanation().because" />
      </div>
    }
  `,
  host: { class: 'flex flex-col gap-2' },
})
export class QueueWhy {
  readonly explanation = input.required<QueueExplanation>();

  protected readonly path = computed<readonly BindingNode[]>(() => this.explanation().path);
}
