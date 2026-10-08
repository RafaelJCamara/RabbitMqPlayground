import { Component, DOCUMENT, inject } from '@angular/core';
import { BUTTON } from './buttons';
import { Icon } from './icon';
import { Toasts } from './toasts';

/**
 * Where the notices are drawn (ADR-0074): one region named "Notices", at the bottom of the screen and in the flow of the page, so that it takes room from what is above it and
 * covers nothing (a notice that floated over the corner of the page covered the button of the card under it), that is there only while there is a notice. It is not a live
 * region, because the service says each notice through the announcer, and one that was both would be said twice. The buttons are reached by Tab, and Escape on a
 * notice dismisses it.
 */
@Component({
  selector: 'rmq-toast-host',
  imports: [Icon],
  template: `
    @if (toasts.visible().length > 0) {
      <section
        aria-label="Notices"
        class="border-line bg-panel flex flex-col gap-2 border-t px-4 py-2"
        data-testid="notices"
      >
        @for (toast of toasts.visible(); track toast.id) {
          <div
            class="border-border bg-surface text-fg flex max-w-3xl flex-col gap-1 rounded-md border px-3 py-2"
            data-testid="toast"
            [attr.data-toast]="toast.id"
            (pointerenter)="toasts.pause(toast.id)"
            (pointerleave)="onPointerLeave($event, toast.id)"
            (focusin)="toasts.pause(toast.id)"
            (focusout)="onFocusOut($event, toast.id)"
          >
            <div class="flex items-start gap-3">
              <p class="flex-1" data-testid="toast-message">{{ toast.message }}</p>
              @if (toast.undo; as undo) {
                <button type="button" [class]="button" data-testid="toast-undo" (click)="toasts.undo(toast.id)">
                  {{ undo.label }}
                </button>
              }
              <button
                type="button"
                [class]="button"
                aria-label="Dismiss"
                data-testid="toast-dismiss"
                (click)="toasts.dismiss(toast.id)"
              >
                <rmq-icon name="close" [size]="14" />
              </button>
            </div>
            @if (toast.problem; as problem) {
              <p class="text-danger" role="alert" data-testid="toast-problem">{{ problem }}</p>
            }
          </div>
        }
      </section>
    }
  `,
  host: { class: 'block', '(document:keydown.escape)': 'onEscape()' },
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  protected readonly button = BUTTON;
  private readonly page = inject(DOCUMENT);

  /** Escape with the focus in a notice dismisses that notice, and does nothing elsewhere. */
  protected onEscape(): void {
    const id = this.page.activeElement?.closest('[data-toast]')?.getAttribute('data-toast');
    if (id !== undefined && id !== null) {
      this.toasts.dismiss(Number(id));
    }
  }

  /** The pointer left a notice, which starts its time again unless the focus is still in it. */
  protected onPointerLeave(event: PointerEvent, id: number): void {
    if (!(event.currentTarget as Element).contains(this.page.activeElement)) {
      this.toasts.resume(id);
    }
  }

  /** The focus left a notice for something outside it, which starts its time again; moving between its own buttons does not. */
  protected onFocusOut(event: FocusEvent, id: number): void {
    const notice = event.currentTarget as Element;
    if (!(event.relatedTarget instanceof Node && notice.contains(event.relatedTarget))) {
      this.toasts.resume(id);
    }
  }
}
