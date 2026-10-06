import { Component, input, signal } from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

/**
 * Help that opens (ADR-0032): a small button beside a label that shows a sentence under it, and hides it when it is pressed again.
 * It works with a keyboard and a touch, stays until it is closed, and a screen reader reads it as text. It is not a tooltip. The
 * button is 24 by 24 pixels (WCAG 2.5.8). Put it in a row that wraps, so that the sentence has a line of its own.
 */
@Component({
  selector: 'rmq-help',
  imports: [Icon],
  template: `
    <button
      type="button"
      class="text-muted hover:text-fg inline-flex size-6 items-center justify-center rounded-full"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="id"
      [attr.aria-label]="'Help: ' + topic()"
      (click)="open.set(!open())"
    >
      <rmq-icon name="help" [size]="16" />
    </button>
    @if (open()) {
      <p class="text-muted basis-full text-xs" [id]="id" data-testid="help-text"><ng-content /></p>
    }
  `,
  host: { class: 'contents' },
})
export class Help {
  /** What the help is about, in the name of the button: `Help: Durable`. */
  readonly topic = input.required<string>();

  protected readonly id = `rmq-help-${nextId++}`;
  protected readonly open = signal(false);
}
