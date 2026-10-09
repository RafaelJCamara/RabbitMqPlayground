import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { TEMPLATES, type TemplateId } from '@rmq/domain';
import { BUTTON, BUTTON_PRIMARY } from '../core/ui/buttons';

export const CHOOSER_TITLE_ID = 'rmq-chooser-title';

/** What the learner chose to start with (ADR-0082). */
export type Choice =
  { readonly kind: 'blank' } | { readonly kind: 'template'; readonly id: TemplateId } | { readonly kind: 'tour' };

/** Building from scratch, which is also what leaving the chooser at the first run means. */
export const BLANK: Choice = { kind: 'blank' };

/** What the chooser needs to be opened. */
export interface ChooserData {
  /** The first run: the library has no canvas, and the question is a welcome. */
  readonly first: boolean;
}

/**
 * The question of what to start with (ADR-0082): the six templates (ADR-0081), building from scratch, and the tour. It closes with the choice, and with nothing for Escape, the
 * backdrop and Cancel, which the service that opens it reads as "from scratch" at the first run and as "never mind" from the home.
 */
@Component({
  selector: 'rmq-template-chooser',
  template: `
    <div
      class="bg-panel text-fg border-border flex max-h-[90dvh] w-[min(42rem,94vw)] flex-col gap-3 overflow-y-auto rounded-lg border p-4 shadow-xl"
      data-testid="template-chooser"
    >
      <h2 class="text-base font-semibold" [id]="titleId">
        {{ data.first ? 'Welcome to RabbitMQ Playground' : 'New canvas from a template' }}
      </h2>
      <p class="text-muted">
        @if (data.first) {
          A canvas is where you draw how messages travel. Start from one of the tutorials of RabbitMQ, build your own
          from nothing, or take a short tour.
        } @else {
          Each one opens as a new canvas, with its own name.
        }
      </p>
      <ul class="grid gap-2 sm:grid-cols-2" aria-label="Templates">
        @for (template of templates; track template.id) {
          <li class="flex">
            <button
              type="button"
              class="border-border bg-surface hover:bg-canvas flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left"
              (click)="ref.close({ kind: 'template', id: template.id })"
            >
              <span class="font-semibold">{{ template.name }}</span>
              <span class="text-muted text-sm">{{ template.summary }}</span>
            </button>
          </li>
        }
      </ul>
      <div class="flex flex-wrap justify-end gap-2">
        @if (!data.first) {
          <button type="button" [class]="button" data-testid="choose-cancel" (click)="ref.close()">Cancel</button>
        }
        <button type="button" [class]="button" data-testid="choose-tour" (click)="ref.close({ kind: 'tour' })">
          Take the tour (about a minute)
        </button>
        <button type="button" [class]="primary" data-testid="choose-blank" (click)="ref.close(blank)">
          Build from scratch
        </button>
      </div>
    </div>
  `,
})
export class TemplateChooser {
  protected readonly data = inject<ChooserData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<Choice | undefined>>(DialogRef);
  protected readonly titleId = CHOOSER_TITLE_ID;
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  protected readonly templates = TEMPLATES;
  protected readonly blank = BLANK;
}
