import { Component, input, output } from '@angular/core';
import type { Point } from '../canvas/model/transform';

/**
 * The full list of what a label says (ADR-0044), shown while a pointer is over a label that has more than it shows ("+N more"). It is drawn by the editor, over the canvas and over
 * its nodes, and not inside the edge, where a list longer than the label would be covered by the node below it. It stays while the pointer is over it, so that it can be read
 * (WCAG 1.4.13), and the editor takes it away on Escape and when the pointer has left both. The same text is in the label of the edge and, for a keyboard and a touch, in the inspector.
 */
@Component({
  selector: 'rmq-label-card',
  template: `
    <div
      class="border-border bg-panel text-fg absolute z-20 flex max-h-72 max-w-xs flex-col gap-1 overflow-y-auto rounded-md border p-2 text-xs shadow-lg"
      role="group"
      data-testid="label-card"
      [attr.aria-label]="title()"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      (pointerenter)="held.emit(true)"
      (pointerleave)="held.emit(false)"
    >
      <p class="text-muted font-medium">{{ title() }}</p>
      <ul class="flex flex-col gap-0.5 font-mono">
        @for (item of items(); track $index) {
          <li class="break-all">{{ item }}</li>
        }
      </ul>
    </div>
  `,
})
export class LabelCard {
  /** Whose keys they are: `Bindings from exchange orders to queue billing`. */
  readonly title = input.required<string>();
  readonly items = input.required<readonly string[]>();
  /** Where it is, measured from the top left of the canvas. */
  readonly position = input.required<Point>();

  /** The pointer is over the card, or has left it. */
  readonly held = output<boolean>();
}
