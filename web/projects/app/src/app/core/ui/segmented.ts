import { Component, input, output } from '@angular/core';

let nextGroup = 0;

/** One choice of a segmented control: what it stands for, and what it says. */
export interface Segment {
  readonly value: string;
  readonly label: string;
}

/**
 * A segmented control (ADR-0066): a group of radio buttons, drawn side by side, of which one is chosen. It is a group of real radio buttons under a legend, so that the arrow keys, the name of the
 * group and the state of each are the browser's, and what it shows is what the owner says (`value`), and not what was last pressed: pressing one only asks, through `chosen`, for it. The chosen one is
 * not told by colour alone: it has a border that is thicker, as well as the fill.
 */
@Component({
  selector: 'rmq-segmented',
  template: `
    <fieldset class="flex min-w-0 flex-col gap-1" [attr.aria-describedby]="describedBy() ?? null">
      <legend class="text-sm font-medium">{{ legend() }}</legend>
      <div class="flex flex-wrap gap-1.5">
        @for (option of options(); track option.value) {
          <label class="relative">
            <input
              type="radio"
              class="peer sr-only"
              [name]="group"
              [value]="option.value"
              [checked]="option.value === value()"
              (change)="chosen.emit(option.value)"
            />
            <span
              class="border-border bg-surface hover:bg-canvas peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-focus flex min-h-8 cursor-pointer items-center rounded-md border px-3 text-sm font-medium peer-checked:border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
              >{{ option.label }}</span
            >
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class Segmented {
  /** What the group is: its legend, and so its name. */
  readonly legend = input.required<string>();
  readonly options = input.required<readonly Segment[]>();
  /** The `value` of the one that is chosen. */
  readonly value = input.required<string>();
  /** The id of the element that describes the group, such as the sentence about the mode that is chosen. */
  readonly describedBy = input<string>();
  /** A segment was pressed, or reached with the arrow keys: the `value` that is asked for. */
  readonly chosen = output<string>();

  protected readonly group = `rmq-segmented-${nextGroup++}`;
}
