import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { systemTimer, type AutosaveTimer, type Outcome } from '@rmq/persistence';
import { Announcer } from '../announcer';

/**
 * Notices with an action that can still be true (ADR-0074): "Deleted “Orders”. Undo". They are for what can be taken back, and say it once, aloud, and then wait
 * for the learner: 5 seconds, the same for every notice (ADR-0099). The time stops while the pointer or the focus is on a notice, a notice can be dismissed, and
 * one whose action cannot work any more goes by itself. The keys of an action outlive a notice that went by its time, for 50 seconds from when it was shown, which
 * is inside the 60 that a tombstone lives (ADR-0028).
 */

/**
 * How long a notice waits, in milliseconds: 5 for every notice (ADR-0099). A token, so that a spec does not wait, and a browser test of the `e2e` build can make it long before the page opens
 * (`window.__rmqToastMs`, e2e/support/hold-notices.ts); the deployed build has no such code.
 */
export const TOAST_TTL_MS = new InjectionToken<number>('TOAST_TTL_MS', {
  providedIn: 'root',
  factory: () => (RMQ_E2E ? (window.__rmqToastMs ?? 5_000) : 5_000),
});

/** How long, from when a notice was shown, the keys can still do its action after it went by its time. Inside the 60 seconds of a tombstone (ADR-0028). */
export const UNDO_KEEP_MS = 50_000;

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
  /** The 50-second time of each notice that has an action and is on the screen or kept, and the notices that went by their time and can still be undone. */
  private readonly keepHandles = new Map<number, unknown>();
  private readonly kept = new Map<number, Toast>();
  private next = 1;

  /** The notices that are on the screen: those whose condition still holds, the oldest first. */
  readonly visible = computed(() => this.list().filter((toast) => toast.stillTrue?.() ?? true));

  /** Shows a notice, says it once and politely, and answers its id. */
  show(options: ToastOptions): number {
    const id = this.next++;
    const kept = [...this.list(), { ...options, id, problem: null }];
    for (const gone of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) {
      this.stop(gone.id);
      this.retire(gone);
    }
    this.list.set(kept.slice(-MAX_TOASTS));
    this.start(id);
    if (options.undo !== undefined) {
      this.keepHandles.set(
        id,
        this.timer.set(() => this.forget(id), UNDO_KEEP_MS),
      );
    }
    const keys = options.undo?.keys;
    this.announcer.announce(keys === undefined ? options.message : `${options.message} Press ${keys} to undo.`);
    return id;
  }

  /** Takes a notice away, and its kept action with it: a notice that is closed is not asked for again. */
  dismiss(id: number): void {
    this.stop(id);
    this.forget(id);
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

  /**
   * Runs the action of a notice, on the screen or kept. The notice goes when it worked, and, when it did not, stays and says why, aloud as well. With no notice on
   * the screen the learner would hear nothing, so what happened is said aloud.
   */
  async undo(id: number): Promise<void> {
    const onScreen = this.list().find((candidate) => candidate.id === id);
    const toast = onScreen ?? this.kept.get(id);
    if (toast?.undo === undefined) {
      return;
    }
    const done = await toast.undo.run();
    if (done.ok) {
      this.dismiss(id);
      if (onScreen === undefined) {
        this.announcer.announce(`Undone: ${toast.message}`);
      }
    } else {
      this.list.update((toasts) =>
        toasts.map((candidate) => (candidate.id === id ? { ...candidate, problem: done.error } : candidate)),
      );
      if (onScreen === undefined) {
        this.kept.set(id, { ...toast, problem: done.error });
      }
      this.announcer.announce(done.error, 'assertive');
    }
  }

  /** The newest notice on the screen that has an action and is still true, or else the newest one that went by its time and can still be undone, or `undefined`. */
  latestUndo(): Toast | undefined {
    return (
      this.visible().findLast((toast) => toast.undo !== undefined) ??
      [...this.kept.values()].findLast((toast) => toast.stillTrue?.() ?? true)
    );
  }

  private start(id: number): void {
    this.stop(id);
    this.handles.set(
      id,
      this.timer.set(() => this.expire(id), this.ttl),
    );
  }

  /** The time of a notice is up: it goes, and its action is kept for the keys while the 50 seconds last (see `retire`). */
  private expire(id: number): void {
    const toast = this.list().find((candidate) => candidate.id === id);
    this.handles.delete(id);
    this.list.update((toasts) => toasts.filter((candidate) => candidate.id !== id));
    if (toast !== undefined) {
      this.retire(toast);
    }
  }

  /** A notice leaves the screen without the learner closing it, by its time or because a newer one took its place: its action is kept for the keys (`latestUndo` asks whether it can still be true). */
  private retire(toast: Toast): void {
    if (toast.undo !== undefined && this.keepHandles.has(toast.id)) {
      this.kept.set(toast.id, toast);
    } else {
      this.forget(toast.id);
    }
  }

  /** Lets go of what is kept for a notice: its 50-second time and its action. */
  private forget(id: number): void {
    if (this.keepHandles.has(id)) {
      this.timer.clear(this.keepHandles.get(id));
      this.keepHandles.delete(id);
    }
    this.kept.delete(id);
  }

  private stop(id: number): void {
    if (this.handles.has(id)) {
      this.timer.clear(this.handles.get(id));
      this.handles.delete(id);
    }
  }
}
