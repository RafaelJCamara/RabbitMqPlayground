import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { systemTimer, type AutosaveTimer, type Outcome } from '@rmq/persistence';
import { Announcer } from '../announcer';

/**
 * Notices with an action that can still be true (ADR-0074): "Deleted “Orders”. Undo". They are for what can be taken back, and say it once, aloud, and then wait
 * for the learner for a while: 30 seconds, which is inside the 60 that a tombstone lives (ADR-0028). The time stops while the pointer or the focus is on a
 * notice, a notice can be dismissed, and one whose action cannot work any more goes by itself.
 */

/** How long a notice waits, in milliseconds. A token, so that a spec and a browser test do not wait. */
export const TOAST_TTL_MS = new InjectionToken<number>('TOAST_TTL_MS', { providedIn: 'root', factory: () => 30_000 });

/** The timer that a notice waits with. A spec moves its own by hand. */
export const TOAST_TIMER = new InjectionToken<AutosaveTimer>('TOAST_TIMER', {
  providedIn: 'root',
  factory: () => systemTimer,
});

/** At most this many are on the screen; a fourth takes the place of the oldest. */
export const MAX_TOASTS = 3;

export interface ToastUndo {
  /** The words on the button: `Undo`. */
  readonly label: string;
  /** How a keyboard does it, when it can: `Ctrl+Z`. It is said aloud with the notice. */
  readonly keys?: string;
  /** Does it. A problem comes back in words, and the notice stays and says it. */
  readonly run: () => Promise<Outcome<void, string>>;
}

export interface ToastOptions {
  readonly message: string;
  readonly undo?: ToastUndo;
  /** The notice goes when this turns false. It reads signals, so that it is followed. */
  readonly stillTrue?: () => boolean;
}

export interface Toast extends ToastOptions {
  readonly id: number;
  /** Why the action did not work, when it did not. */
  readonly problem: string | null;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly announcer = inject(Announcer);
  private readonly ttl = inject(TOAST_TTL_MS);
  private readonly timer = inject(TOAST_TIMER);
  private readonly list = signal<readonly Toast[]>([]);
  private readonly handles = new Map<number, unknown>();
  private next = 1;

  /** The notices that are on the screen: those whose condition still holds, the oldest first. */
  readonly visible = computed(() => this.list().filter((toast) => toast.stillTrue?.() ?? true));

  /** Shows a notice, says it once and politely, and answers its id. */
  show(options: ToastOptions): number {
    const id = this.next++;
    const kept = [...this.list(), { ...options, id, problem: null }];
    for (const gone of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) {
      this.stop(gone.id);
    }
    this.list.set(kept.slice(-MAX_TOASTS));
    this.start(id);
    const keys = options.undo?.keys;
    this.announcer.announce(keys === undefined ? options.message : `${options.message} Press ${keys} to undo.`);
    return id;
  }

  dismiss(id: number): void {
    this.stop(id);
    this.list.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }

  /** The pointer or the focus is on the notice, so its time stops. */
  pause(id: number): void {
    this.stop(id);
  }

  /** The pointer and the focus have left the notice, so it waits again from the start. */
  resume(id: number): void {
    if (this.list().some((toast) => toast.id === id)) {
      this.start(id);
    }
  }

  /** Runs the action of a notice. The notice goes when it worked, and, when it did not, stays and says why, aloud as well. */
  async undo(id: number): Promise<void> {
    const toast = this.list().find((candidate) => candidate.id === id);
    if (toast?.undo === undefined) {
      return;
    }
    const done = await toast.undo.run();
    if (done.ok) {
      this.dismiss(id);
    } else {
      this.list.update((toasts) =>
        toasts.map((candidate) => (candidate.id === id ? { ...candidate, problem: done.error } : candidate)),
      );
      this.announcer.announce(done.error, 'assertive');
    }
  }

  /** The newest notice that has an action and is still true, or `undefined`. */
  latestUndo(): Toast | undefined {
    return this.visible().findLast((toast) => toast.undo !== undefined);
  }

  private start(id: number): void {
    this.stop(id);
    this.handles.set(
      id,
      this.timer.set(() => this.dismiss(id), this.ttl),
    );
  }

  private stop(id: number): void {
    if (this.handles.has(id)) {
      this.timer.clear(this.handles.get(id));
      this.handles.delete(id);
    }
  }
}
