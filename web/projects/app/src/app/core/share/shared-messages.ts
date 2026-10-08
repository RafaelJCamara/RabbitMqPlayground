import { InjectionToken } from '@angular/core';
import type { EngineSnapshot } from '@rmq/engine';

/**
 * The messages of a share link, as the simulation is given them (ADR-0078). The shared view provides this, and the simulation reads it when the document of the shared canvas first loads: it restores the snapshot,
 * paused, with the clock where the sender left it. If the engine does not take it, the canvas stays as it is without the messages, and the view is told, so that it can say so.
 */
export interface SharedMessages {
  readonly snapshot: EngineSnapshot;
  /** The engine did not take the snapshot, for this reason, and the canvas is without its messages. */
  failed(reason: string): void;
}

export const SHARED_MESSAGES = new InjectionToken<SharedMessages | null>('SHARED_MESSAGES', {
  providedIn: 'root',
  factory: () => null,
});
