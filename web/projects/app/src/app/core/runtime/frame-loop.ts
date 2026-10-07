import { DestroyRef, DOCUMENT, inject, Injectable, InjectionToken } from '@angular/core';

/** The page's frames, as far as the loop needs them. A spec gives its own, which run when the spec says. */
export interface FrameSource {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export const FRAME_SOURCE = new InjectionToken<FrameSource>('FRAME_SOURCE', {
  providedIn: 'root',
  factory: () => {
    const win = inject(DOCUMENT).defaultView;
    return {
      request: (callback) => win?.requestAnimationFrame(callback) ?? 0,
      cancel: (handle) => win?.cancelAnimationFrame(handle),
    };
  },
});

/**
 * The longest that a frame is taken to have lasted. A page that was in the background, or a machine that stopped for a moment, comes back with the time
 * of all of it in one frame, and the simulation would jump by that much. It goes slower for the one frame instead.
 */
export const MAX_FRAME_MS = 100;

/**
 * What runs in a frame. It is told how long the frame lasted and the time of the frame, both in real milliseconds, and answers whether it wants another
 * one: a frame is asked for again only while something does.
 */
export type Ticker = (elapsed: number, time: number) => boolean;

/**
 * The one loop of the frames that everything that moves shares (ADR-0055). It is outside change detection: a callback of a frame runs by itself, and what
 * it does to a signal is what asks for a pass of it. It asks for a frame when something says that it may have something to do (`wake`), and stops asking for
 * them when nothing wants one, so that a canvas at rest costs no frames.
 */
@Injectable()
export class FrameLoop {
  private readonly source = inject(FRAME_SOURCE);
  private readonly tickers = new Set<Ticker>();
  private handle: number | null = null;
  private last: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.handle !== null) {
        this.source.cancel(this.handle);
        this.handle = null;
      }
    });
  }

  /** Whether a frame is asked for. */
  get awake(): boolean {
    return this.handle !== null;
  }

  /** Adds something that runs in every frame. The function that it returns takes it away. */
  add(ticker: Ticker): () => void {
    this.tickers.add(ticker);
    return () => {
      this.tickers.delete(ticker);
    };
  }

  /** Asks for a frame, unless one is asked for. */
  wake(): void {
    if (this.handle === null) {
      this.handle = this.source.request((time) => this.frame(time));
    }
  }

  private frame(time: number): void {
    this.handle = null;
    // The first frame after a rest has no frame before it to measure from, so it lasts no time.
    const elapsed = this.last === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, time - this.last));
    this.last = time;
    let again = false;
    // A ticker may take itself away, or add another, while it runs.
    for (const ticker of [...this.tickers]) {
      again = ticker(elapsed, time) || again;
    }
    if (again) {
      this.wake();
    } else {
      this.last = null;
    }
  }
}
