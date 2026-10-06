import type { CDPSession, Page } from '@playwright/test';

/** A point of the page, in CSS pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Real touch events, sent through the DevTools protocol (ADR-0046): Playwright's touchscreen can tap and cannot drag, and a finger on the canvas is the
 * library's `touchstart` and `touchmove`, not a mouse. This is the one place of the tests that talks to the protocol for that. The context of the test
 * has to be made with `hasTouch`.
 */
export class Finger {
  private constructor(private readonly session: CDPSession) {}

  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  /** Puts a finger down, and lifts it again: a tap. */
  async tap(at: Point): Promise<void> {
    await this.down(at);
    await this.up();
  }

  /** Puts a finger down at `from`, moves it to `to` in steps, and lifts it: a drag, with a first move that is over the threshold of one. */
  async drag(from: Point, to: Point, steps = 10): Promise<void> {
    await this.down(from);
    await this.move({ x: from.x + 12, y: from.y + 6 });
    for (let step = 1; step <= steps; step += 1) {
      await this.move({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
    }
    await this.up();
  }

  async down(at: Point): Promise<void> {
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  }

  async move(at: Point): Promise<void> {
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] });
  }

  async up(): Promise<void> {
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
