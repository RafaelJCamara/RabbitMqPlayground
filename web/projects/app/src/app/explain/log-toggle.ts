import { Component, inject, input } from '@angular/core';
import { ExplainState } from '../core/explain/explain-state';
import { Icon } from '../core/ui/icon';

/**
 * The button of the event log (ADR-0061): it sits in the strip of the simulation, which projects it, and shows or hides the log. It says whether the log is open with `aria-expanded`, and names the keys
 * that do the same, which the editor gives it from the table of shortcuts, so that this has no list of keys of its own.
 */
@Component({
  selector: 'rmq-log-toggle',
  imports: [Icon],
  template: `
    <button
      type="button"
      class="border-border bg-surface hover:bg-canvas aria-expanded:bg-fg aria-expanded:text-surface flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1"
      data-testid="event-log-toggle"
      [attr.aria-expanded]="explain.logOpen()"
      [attr.aria-controls]="explain.logOpen() ? 'event-log' : null"
      [attr.aria-keyshortcuts]="keys()"
      [attr.title]="'Show or hide the event log (' + keys() + ')'"
      (click)="explain.toggleLog()"
    >
      <rmq-icon name="log" [size]="18" />
      <span>Event log</span>
    </button>
  `,
})
export class LogToggle {
  protected readonly explain = inject(ExplainState);
  /** The keys that show and hide the log, as the table of shortcuts says them. */
  readonly keys = input('E');
}
