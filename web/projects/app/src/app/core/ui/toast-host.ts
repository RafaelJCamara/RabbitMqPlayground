import {
  afterNextRender,
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { BUTTON } from './buttons';
import { Icon } from './icon';
import { setPageLength, TOAST_GAP, TOAST_ROOM } from './toast-room';
import { Toasts } from './toasts';

/**
 * Where the notices are drawn (ADR-0074, ADR-0097): one region named "Notices", a stack of cards that floats at the bottom right of the page, 20 rem wide as the inspector is, the newest at
 * the bottom, and that is there only while there is a notice. Only the cards take the pointer, so that the stack does not stand between the pointer and what is around it. What floats
 * must leave room for what it would cover (ADR-0085), so the host measures its stack and publishes how much it takes (`--toast-room`) for a screen that scrolls to pad its foot with, and
 * the editor lifts the stack above its bars (`--toast-bottom`). It is not a live region, because the service says each notice through the announcer, and one that was both would be said twice. The buttons are reached by Tab, and Escape on a
 * notice dismisses it.
 */
@Component({
  selector: 'rmq-toast-host',
  imports: [Icon],
  template: `
    @if (toasts.visible().length > 0) {
      <section
        #stack
        aria-label="Notices"
        class="pointer-events-none fixed right-0 bottom-[calc(var(--toast-bottom,0px)+0.75rem)] z-40 flex w-80 max-w-full flex-col gap-2 px-3"
        data-testid="notices"
      >
        @for (toast of toasts.visible(); track toast.id) {
          <div
            class="border-border bg-surface text-fg pointer-events-auto flex flex-col gap-1 rounded-md border px-3 py-2 shadow-lg"
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
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  protected readonly button = BUTTON;
  private readonly page = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly stack = viewChild<ElementRef<HTMLElement>>('stack');

  constructor() {
    // The room that the stack takes is worked out again when a notice comes or goes, after it is drawn, and when the stack changes size, which a longer message or a problem does.
    // There is no observer in jsdom, which has no layout.
    effect((onCleanup) => {
      this.toasts.visible();
      afterNextRender(() => this.publish(), { injector: this.injector });
      const element = this.stack()?.nativeElement;
      if (element !== undefined && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.publish());
        observer.observe(element);
        onCleanup(() => observer.disconnect());
      }
    });
    inject(DestroyRef).onDestroy(() => setPageLength(this.page, TOAST_ROOM, 0));
  }

  /** Says how much of the bottom of the page the stack takes: its height and the space around it, or nothing when there is no stack. */
  private publish(): void {
    const height = this.stack()?.nativeElement.offsetHeight ?? 0;
    setPageLength(this.page, TOAST_ROOM, height > 0 ? height + 2 * TOAST_GAP : 0);
  }

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
