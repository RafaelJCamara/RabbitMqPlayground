import { Component, inject } from '@angular/core';
import { ExplainState } from '../core/explain/explain-state';
import { QueueWhy } from './queue-why';

let nextSection = 0;

/**
 * "Why didn't it get here?" for the queue that is selected (ADR-0062, ADR-0063): while a message is chosen, the inspector of a queue says why that queue got a copy of it, or did not, in words, and the canvas shows it lit
 * (the card and the marks). It is in the inspector of the queue, above what the queue holds, and is not there when there is no message to ask about, or the flags are not on.
 */
@Component({
  selector: 'rmq-queue-asked',
  imports: [QueueWhy],
  template: `
    @if (explain.asked(); as asked) {
      <section class="flex flex-col gap-2" data-testid="queue-asked" [attr.aria-labelledby]="titleId">
        <h3 class="text-sm font-semibold" [id]="titleId" data-testid="queue-asked-title">
          Message {{ asked.message }} and this queue
        </h3>
        <rmq-queue-why [explanation]="asked.explanation" />
      </section>
    }
  `,
})
export class QueueAsked {
  protected readonly explain = inject(ExplainState);
  protected readonly titleId = `rmq-queue-asked-${nextSection++}`;
}
