import { Component, input } from '@angular/core';
import type { Issue } from '@rmq/domain';
import { Icon } from './icon';

/**
 * A refusal, as a learner reads it (ADR-0024, ADR-0032): the root cause first, in plain words, and after it, set apart, what a broker
 * would answer, where one was recorded. It never shows the reply alone. It is not a live region: the command bus speaks a refusal
 * once, when it is made, so that a screen reader does not hear it twice.
 */
@Component({
  selector: 'rmq-refusal-notice',
  imports: [Icon],
  template: `
    <div class="border-danger bg-danger-bg rounded-md border p-3 text-sm" data-testid="refusal">
      <p class="text-danger flex items-start gap-2 font-medium">
        <rmq-icon name="alert" [size]="18" />
        <span data-testid="refusal-message">{{ issue().message }}</span>
      </p>
      @if (issue().refusal; as reply) {
        <div class="mt-2" data-testid="refusal-reply">
          <p class="text-muted text-xs font-medium tracking-wide uppercase">What RabbitMQ answers</p>
          <p class="mt-1 font-mono text-xs break-words whitespace-pre-wrap">
            <span data-testid="refusal-code">{{ reply.code }}</span> {{ reply.text }}
          </p>
        </div>
      }
    </div>
  `,
})
export class RefusalNotice {
  readonly issue = input.required<Issue>();
}
