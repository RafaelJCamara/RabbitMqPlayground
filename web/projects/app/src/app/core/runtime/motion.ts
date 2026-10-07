import { DestroyRef, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';

/** The part of a media query that the preference needs. A spec gives one that it can change. */
export interface MotionQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
}

/** The preference for less motion, or `null` where the page cannot say. */
export const MOTION_QUERY = new InjectionToken<MotionQuery | null>('MOTION_QUERY', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null,
});

/**
 * Whether the learner asked for less motion (ADR-0055), read when the page starts and again when it changes. It changes how the overlay draws a message, still
 * and not sliding, and nothing else: the simulation does not know it, so the times, the counts and the order of events are the same.
 */
@Injectable({ providedIn: 'root' })
export class MotionPreference {
  private readonly state = signal(false);
  readonly reduced = this.state.asReadonly();

  constructor() {
    const query = inject(MOTION_QUERY);
    if (query !== null) {
      this.state.set(query.matches);
      const listener = (event: { readonly matches: boolean }): void => this.state.set(event.matches);
      query.addEventListener('change', listener);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
    }
  }
}
