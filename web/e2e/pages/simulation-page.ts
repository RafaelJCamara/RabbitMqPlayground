import { expect, type Locator, type Page } from '@playwright/test';
import type { CanvasDocument } from '@rmq/domain';
import { seedCanvas } from '../support/seed';
import { EditorPage } from './editor-page';

/** What the simulation says of itself, as the end-to-end build reads it (ADR-0056). */
export type SimulationState = NonNullable<Awaited<ReturnType<SimulationPage['state']>>>;

/** What the overlay drew in its last frame (ADR-0055). */
export type OverlayFrame = NonNullable<Awaited<ReturnType<SimulationPage['frame']>>>;

/** Where the pointer or a mark of the overlay is, from the top left of the host of the canvas. */
export interface Place {
  readonly x: number;
  readonly y: number;
}

/**
 * The simulation in a real browser (ADR-0054 to ADR-0056), behind the flags `editor` and `simulation`. A test drives it with the step control, and reads what the engine says and what
 * the overlay drew from the debug handle, so that nothing waits for a clock of the wall: the clock of the simulation moves when the test steps it.
 */
export class SimulationPage {
  readonly bar: Locator;
  readonly play: Locator;
  readonly pause: Locator;
  readonly stepButton: Locator;
  readonly readout: Locator;
  readonly statusText: Locator;

  constructor(readonly editor: EditorPage) {
    const page = editor.page;
    this.bar = page.getByRole('region', { name: 'Simulation' });
    this.play = this.bar.getByRole('button', { name: 'Play' });
    this.pause = this.bar.getByRole('button', { name: 'Pause' });
    this.stepButton = this.bar.getByRole('button', { name: 'Step' });
    this.readout = page.getByTestId('simulation-readout');
    this.statusText = page.getByTestId('status-message');
  }

  get page(): Page {
    return this.editor.page;
  }

  /**
   * Opens the editor with the simulation on, on this canvas, and stops the clock, so that nothing happens until the test says. A canvas that has a producer that repeats is not for
   * this: it starts to send as soon as it is opened.
   */
  static async open(
    page: Page,
    document: CanvasDocument,
    options: { readonly reducedMotion?: boolean; readonly theme?: 'light' | 'dark' } = {},
  ): Promise<SimulationPage> {
    if (options.reducedMotion === true) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    if (options.theme !== undefined) {
      await page.emulateMedia({
        colorScheme: options.theme,
        reducedMotion: options.reducedMotion === true ? 'reduce' : null,
      });
    }
    await seedCanvas(page, document, 'Simulated canvas');
    const editor = new EditorPage(page);
    await editor.goto('?ff=editor,simulation');
    const simulation = new SimulationPage(editor);
    await simulation.bar.waitFor();
    const edges =
      Object.keys(document.bindings).length +
      Object.values(document.producers).filter(({ target }) => target !== null).length +
      Object.values(document.consumers).reduce((sum, { queues }) => sum + queues.length, 0);
    await page.waitForFunction((count) => (window.__rmq?.drawnEdges().length ?? 0) >= count, edges, {
      timeout: 15_000,
    });
    await editor.settled();
    await simulation.stop();
    return simulation;
  }

  /** What the simulation says of itself. */
  state() {
    return this.page.evaluate(() => window.__rmq?.simulationState() ?? null);
  }

  /** What the overlay drew in its last frame. */
  frame() {
    return this.page.evaluate(() => window.__rmq?.overlayFrame() ?? null);
  }

  /** The engine's view, which a test reads for what the engine says is where. */
  async view() {
    const state = await this.state();
    if (state === null) {
      throw new Error('the simulation is not on');
    }
    return state.view;
  }

  /** Stops the clock, if it runs. */
  async stop(): Promise<void> {
    if ((await this.pause.count()) > 0) {
      await this.pause.click();
    }
    await expect(this.play).toBeVisible();
  }

  /** When the engine runs the next thing, or `null` when nothing is scheduled. It is the engine's word, and not the button's, which is drawn a moment after it. */
  async nextAt(): Promise<number | null> {
    return (await this.state())?.nextAt ?? null;
  }

  /** Runs the one thing that is next, with the button, as many times as is asked, and waits until the engine has done each. */
  async step(times = 1): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await expect.poll(() => this.nextAt(), { message: 'there is something to step to' }).not.toBeNull();
      const before = JSON.stringify(await this.state());
      // The click waits for the button to be enabled, which it is a moment after the engine has something scheduled.
      await this.stepButton.click();
      await expect.poll(async () => JSON.stringify(await this.state())).not.toBe(before);
    }
  }

  /**
   * Waits until the overlay has stopped moving: its last frame is the same in two reads that are a moment apart. After a step, the picture takes a quarter of a second to get to
   * where the clock is, and a test that measures it before that measures the middle of the move.
   */
  async settledFrame(): Promise<OverlayFrame> {
    let previous = '';
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await this.frame());
          const same = now === previous;
          previous = now;
          return same;
        },
        { intervals: [150], timeout: 10_000 },
      )
      .toBe(true);
    return JSON.parse(previous) as OverlayFrame;
  }

  /** The numbers that a node says of itself, as text, under it. */
  statsOf(id: string): Locator {
    return this.page.locator(`[data-node-id="${id}"] [data-testid="stats-text"]`);
  }

  /** Where the canvas's host is on the page. */
  async host(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.editor.flow.boundingBox();
    if (box === null) {
      throw new Error('the canvas is not on the page');
    }
    return box;
  }

  /** The middle of the path that the library drew for an edge, on the screen, from the top left of the host. */
  middleOf(edge: string): Promise<Place> {
    return this.page.evaluate((key) => {
      const path = document.querySelector<SVGPathElement>(`[data-edge="${key}"] path.f-connection-path`);
      const viewport = window.__rmq?.viewport();
      if (path === null || viewport === null || viewport === undefined) {
        throw new Error('the edge is not drawn');
      }
      const middle = path.getPointAtLength(path.getTotalLength() / 2);
      return { x: middle.x * viewport.zoom + viewport.x, y: middle.y * viewport.zoom + viewport.y };
    }, edge);
  }

  /** Steps until nothing is scheduled, as far as a bound says: a canvas with a producer that repeats never stops. */
  async stepThrough(bound = 200): Promise<void> {
    for (let steps = 0; steps < bound && (await this.nextAt()) !== null; steps += 1) {
      await this.step();
    }
    expect(await this.nextAt(), 'nothing is scheduled any more').toBeNull();
    await expect(this.stepButton).toBeDisabled();
  }

  /**
   * How far a point of the host is from the path that the library drew for an edge, in pixels of the screen: the path is sampled along its length, in the coordinates of the
   * canvas, and put on the screen with the transform that the canvas has. It is what says that a message is drawn on its edge and not near it.
   */
  distanceFromEdge(edge: string, at: Place): Promise<number> {
    return this.page.evaluate(
      ({ edge: key, at: point }) => {
        const path = document.querySelector<SVGPathElement>(`[data-edge="${key}"] path.f-connection-path`);
        const viewport = window.__rmq?.viewport();
        if (path === null || viewport === null || viewport === undefined) {
          return Number.POSITIVE_INFINITY;
        }
        const total = path.getTotalLength();
        let nearest = Number.POSITIVE_INFINITY;
        for (let step = 0; step <= 400; step += 1) {
          const sample = path.getPointAtLength((total * step) / 400);
          const x = sample.x * viewport.zoom + viewport.x;
          const y = sample.y * viewport.zoom + viewport.y;
          nearest = Math.min(nearest, Math.hypot(x - point.x, y - point.y));
        }
        return nearest;
      },
      { edge, at },
    );
  }
}
