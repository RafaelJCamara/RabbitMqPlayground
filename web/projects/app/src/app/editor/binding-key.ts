import { afterNextRender, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import type { Issue } from '@rmq/domain';
import type { Point } from '../canvas/model/transform';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { TopicTester } from '../explain/topic-tester';

let nextPopover = 0;

/** How the popover was given up: with Escape or its button, which the learner asked for, or by the focus going elsewhere, which they may not have meant. */
export type GiveUp = 'escape' | 'button' | 'blur';

/**
 * The popover that asks for the key of a binding (ADR-0041): it opens by the node that the link was made to, with the cursor already in its field, and nothing is
 * made until Enter. It says what it is for, in one sentence for the type of the exchange, and the reason when a key is refused, under the field. For a topic key, with
 * the explanation on, the tester of the key is under the field and follows what is typed (ADR-0064). Escape gives up, so does the focus leaving it, and so does the button. It
 * decides nothing: the owner applies the command and answers with a refusal, which is kept open.
 */
@Component({
  selector: 'rmq-binding-key',
  imports: [RefusalNotice, TopicTester],
  template: `
    <div
      class="border-border bg-panel text-fg absolute z-10 w-72 rounded-md border p-3 text-sm shadow-lg"
      role="group"
      data-testid="binding-key"
      [attr.aria-label]="title()"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      (focusout)="leave($event)"
    >
      <form class="flex flex-col gap-2" (submit)="give($event)">
        <label class="font-medium" [for]="fieldId">Binding key</label>
        <input
          #field
          type="text"
          autocomplete="off"
          spellcheck="false"
          class="border-border bg-surface rounded-md border px-2 py-1.5"
          [id]="fieldId"
          [attr.aria-describedby]="error() ? helpId + ' ' + errorId : helpId"
          [attr.aria-invalid]="error() ? 'true' : null"
          (input)="typed.set(field.value)"
          (keydown.escape)="escape($event)"
        />
        <p class="text-muted text-xs" [id]="helpId">{{ help() }}</p>
        @if (topicTest()) {
          <rmq-topic-tester [pattern]="typed()" />
        }
        @if (error(); as issue) {
          <div [id]="errorId"><rmq-refusal-notice [issue]="issue" /></div>
        }
        <div class="flex gap-2">
          <button type="submit" class="bg-accent text-accent-fg rounded-md px-3 py-1.5 font-medium hover:opacity-90">
            Bind
          </button>
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas rounded-md border px-3 py-1.5"
            (click)="cancelled.emit('button')"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  `,
})
export class BindingKey {
  /** What it is for: `Binding key from exchange orders to queue billing`. */
  readonly title = input.required<string>();
  /** One sentence for the type of the exchange. */
  readonly help = input.required<string>();
  /** Where it is, measured from the top left of the canvas. */
  readonly position = input.required<Point>();
  /** Why the last key was refused, to show under the field. */
  readonly error = input<Issue | null>(null);
  /** Whether the tester of a topic key is under the field. */
  readonly topicTest = input(false);
  /** What is typed in the field, which the tester follows. */
  protected readonly typed = signal('');

  readonly confirm = output<string>();
  readonly cancelled = output<GiveUp>();

  private readonly uid = `rmq-binding-key-${nextPopover++}`;
  protected readonly fieldId = `${this.uid}-field`;
  protected readonly helpId = `${this.uid}-help`;
  protected readonly errorId = `${this.uid}-error`;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
  }

  protected give(event: Event): void {
    event.preventDefault();
    this.confirm.emit(this.field().nativeElement.value);
  }

  protected escape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancelled.emit('escape');
  }

  /** The focus going anywhere outside the popover gives up. To its own buttons it stays. */
  protected leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node && (event.currentTarget as HTMLElement).contains(next))) {
      this.cancelled.emit('blur');
    }
  }
}
