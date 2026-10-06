import { afterNextRender, Component, computed, ElementRef, input, output, viewChild } from '@angular/core';
import type { Issue } from '@rmq/domain';
import type { Point, Size } from '../canvas/model/transform';
import { RefusalNotice } from '../core/ui/refusal-notice';

/** How a name was given: with Enter, which keeps the field open when the name is refused, or by leaving the field. */
export type RenameBy = 'enter' | 'blur';

/** A node is narrow at some zooms, and a name is not typed into a field that is narrower than this. */
const MIN_WIDTH = 160;
const FIELD_HEIGHT = 34;

let nextRename = 0;

/**
 * The field that renames a node where it is (ADR-0010, ADR-0035): it opens over the node, with the name selected, and Enter or leaving
 * it gives the name and Escape drops it. It does not decide anything. The owner applies the command, and if the name is refused the
 * owner gives the reason back, and the field stays open with it under it, so that the name can be changed and given again.
 */
@Component({
  selector: 'rmq-rename-field',
  imports: [RefusalNotice],
  template: `
    <div class="absolute z-10" [style.left.px]="rect().x" [style.top.px]="top()" [style.width.px]="width()">
      <input
        #field
        type="text"
        class="border-accent bg-surface text-fg w-full rounded-md border-2 px-2 py-1 text-sm shadow-lg"
        data-testid="rename-field"
        [value]="value()"
        [attr.aria-label]="label()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="error() ? errorId : null"
        (keydown.enter)="enter($event)"
        (keydown.escape)="escape($event)"
        (blur)="give('blur')"
      />
      @if (error(); as issue) {
        <div class="mt-1" [id]="errorId"><rmq-refusal-notice [issue]="issue" /></div>
      }
    </div>
  `,
})
export class RenameField {
  /** The node, on the host of the canvas, at the size that it is drawn. */
  readonly rect = input.required<Point & Size>();
  /** The name that it has now, which is what is selected when the field opens. */
  readonly value = input.required<string>();
  /** What the field is called for a screen reader: `Rename queue billing`. */
  readonly label = input.required<string>();
  /** Why the last name was refused, to show under the field. */
  readonly error = input<Issue | null>(null);

  readonly commit = output<{ readonly name: string; readonly by: RenameBy }>();
  readonly cancelled = output<void>();

  protected readonly errorId = `rmq-rename-error-${nextRename++}`;
  protected readonly width = computed(() => Math.max(this.rect().width, MIN_WIDTH));
  protected readonly top = computed(() => this.rect().y + Math.max(0, (this.rect().height - FIELD_HEIGHT) / 2));
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    afterNextRender(() => {
      const field = this.field().nativeElement;
      field.focus();
      field.select();
    });
  }

  protected enter(event: Event): void {
    event.preventDefault();
    this.give('enter');
  }

  protected escape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancelled.emit();
  }

  protected give(by: RenameBy): void {
    this.commit.emit({ name: this.field().nativeElement.value, by });
  }
}
