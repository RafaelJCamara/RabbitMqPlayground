import { Component, input, output } from '@angular/core';

/**
 * A switch (ADR-0032): a button with the role of a switch, whose state is what the document says and not what was last pressed. Pressing
 * it only asks, through `turn`, for the other state. The owner applies it, and if it is refused the switch stays as it was, which
 * is how the durable switch of a queue explains itself (ADR-0024). The state is also written, "On" or "Off", so that it
 * is not told by position and colour alone.
 */
@Component({
  selector: 'rmq-switch',
  template: `
    <button
      type="button"
      role="switch"
      class="flex min-h-6 items-center gap-2 rounded-full"
      [attr.aria-checked]="checked()"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-describedby]="describedBy() ?? null"
      (click)="turn.emit(!checked())"
    >
      <span
        class="border-border relative inline-block h-6 w-11 shrink-0 rounded-full border"
        [class]="checked() ? 'bg-accent border-accent' : 'bg-surface'"
        aria-hidden="true"
      >
        <span
          class="absolute top-0.5 left-0.5 size-4.5 rounded-full transition-transform"
          [class]="checked() ? 'bg-accent-fg translate-x-5' : 'bg-border'"
        ></span>
      </span>
      <span class="text-sm" aria-hidden="true">{{ checked() ? 'On' : 'Off' }}</span>
    </button>
  `,
})
export class Switch {
  readonly checked = input.required<boolean>();
  /** The id of the element that is the label of the switch. */
  readonly labelledBy = input.required<string>();
  /** The id of the element that describes it, such as a refusal that is shown under it. */
  readonly describedBy = input<string>();
  readonly turn = output<boolean>();
}
