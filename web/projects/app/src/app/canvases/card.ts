import { Component, computed, inject, input, output } from '@angular/core';
import { NOW } from '../core/session/canvas-session';
import { Icon } from '../core/ui/icon';
import { ago } from './ago';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import type { CanvasSummary } from './summary';
import { ThumbnailView } from './thumbnail-view';

/** "12 elements", "1 element". */
export const elementsText = (count: number): string => `${count} ${count === 1 ? 'element' : 'elements'}`;

/**
 * The card of a canvas on the home (ADR-0073): its drawing, its name, when it was edited and how much is on it, and the buttons that act on it. The drawing is
 * decoration, so everything it says is in words, and each button is named with the canvas (`Open Orders`), so that a list of them is not a list of "Open".
 *
 * A press on the drawing opens the canvas, and a double click on the name renames it (ADR-0095). Both are for a pointer: the drawing is a copy of **Open** that a
 * keyboard and a screen reader do not meet (it has no tab stop and is hidden from them), and the name has **Rename** beside it.
 */
@Component({
  selector: 'rmq-canvas-card',
  imports: [Icon, ThumbnailView],
  template: `
    <article
      class="border-border bg-surface flex h-full flex-col overflow-hidden rounded-lg border"
      [attr.data-canvas]="canvas().id"
    >
      <button
        type="button"
        class="bg-canvas border-line block aspect-[16/10] w-full cursor-pointer border-b p-2"
        tabindex="-1"
        aria-hidden="true"
        data-testid="card-drawing"
        (click)="open.emit()"
      >
        <rmq-thumbnail [thumbnail]="canvas().thumbnail" />
      </button>
      <div class="flex flex-1 flex-col gap-1 p-3">
        <h3
          class="truncate text-base font-semibold select-none"
          [title]="canvas().name + ' (double-click to rename)'"
          data-testid="card-name"
          (dblclick)="rename.emit()"
        >
          {{ canvas().name }}
        </h3>
        <p class="text-muted flex flex-wrap gap-x-3 text-sm">
          <time [attr.datetime]="iso()" [title]="exact()" data-testid="card-edited">Edited {{ edited() }}</time>
          <span data-testid="card-size">{{ size() }}</span>
        </p>
      </div>
      <div class="border-line flex flex-wrap gap-1.5 border-t p-2">
        <button
          type="button"
          [class]="primary"
          [attr.aria-label]="'Open ' + canvas().name"
          data-testid="card-open"
          (click)="open.emit()"
        >
          Open
        </button>
        <button
          type="button"
          [class]="button"
          [attr.aria-label]="'Rename ' + canvas().name"
          data-testid="card-rename"
          (click)="rename.emit()"
        >
          <rmq-icon name="rename" [size]="16" />
          <span>Rename</span>
        </button>
        <button
          type="button"
          [class]="button"
          [attr.aria-label]="'Duplicate ' + canvas().name"
          data-testid="card-duplicate"
          (click)="duplicate.emit()"
        >
          <rmq-icon name="plus" [size]="16" />
          <span>Duplicate</span>
        </button>
        <button
          type="button"
          [class]="button"
          aria-haspopup="dialog"
          [attr.aria-label]="'Share ' + canvas().name"
          data-testid="card-share"
          (click)="share.emit()"
        >
          <rmq-icon name="link" [size]="16" />
          <span>Share…</span>
        </button>
        <button
          type="button"
          [class]="button"
          [attr.aria-label]="'Save as file ' + canvas().name"
          data-testid="card-save"
          (click)="save.emit()"
        >
          <rmq-icon name="send" [size]="16" />
          <span>Save as file</span>
        </button>
        <button
          type="button"
          [class]="danger"
          [attr.aria-label]="'Delete ' + canvas().name"
          data-testid="card-delete"
          (click)="delete.emit()"
        >
          <rmq-icon name="trash" [size]="16" />
          <span>Delete</span>
        </button>
      </div>
    </article>
  `,
  host: { class: 'block' },
})
export class CanvasCard {
  readonly canvas = input.required<CanvasSummary>();

  readonly open = output();
  readonly rename = output();
  readonly duplicate = output();
  readonly save = output();
  /** The learner asked for a link to the canvas as it is saved (ADR-0078). */
  readonly share = output();
  readonly delete = output();

  private readonly now = inject(NOW);

  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  /** Deleting is a plain button in the colour of a warning, and it also says Delete in words (WCAG 1.4.1). */
  protected readonly danger = `${BUTTON} text-danger`;
  protected readonly edited = computed(() => ago(this.now(), this.canvas().updatedAt));
  protected readonly iso = computed(() => new Date(this.canvas().updatedAt).toISOString());
  protected readonly exact = computed(() => new Date(this.canvas().updatedAt).toLocaleString());
  protected readonly size = computed(() => elementsText(this.canvas().elements));
}
