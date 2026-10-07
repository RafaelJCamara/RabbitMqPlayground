import { expect, type Locator, type Page } from '@playwright/test';
import type { CanvasDocument } from '@rmq/domain';
import { EditorPage } from './editor-page';
import { SimulationPage } from './simulation-page';

/** What the event log holds, as the end-to-end build reads it (ADR-0061). */
export type EventLogState = NonNullable<Awaited<ReturnType<ExplainPage['eventLog']>>>;

/** What Why? lights, as the end-to-end build reads it (ADR-0062). */
export type EmphasisState = NonNullable<Awaited<ReturnType<ExplainPage['emphasis']>>>;

/**
 * What is lit on the canvas and said in the card (ADR-0062), as a person sees it and as the debug handle says it, whichever of the tools of the explanation lit it: a row of the log, the Why? of a message, a queue that is asked
 * about, or the what-if tester. Everything that a test needs to know of what is lit it reads from the page itself, from the attribute and the style that a person sees it by.
 */
export class LitCanvas {
  /** The card in the canvas that says what is lit and why. */
  readonly card: Locator;

  constructor(readonly page: Page) {
    this.card = page.getByTestId('why-card');
  }

  /** What is lit on the canvas, and what the card says of it, or `null` when nothing is. */
  emphasis() {
    return this.page.evaluate(() => window.__rmq?.explainEmphasis() ?? null);
  }

  /**
   * Waits until a node is lit as this, or is not lit when `mark` is `null`. What is lit is set on the page a moment after what chose it, when the page is drawn, so a test that reads it at once finds what was
   * there before; this waits for what it says, and a test that says that something stays unlit waits two frames first.
   */
  async expectNodeMark(id: string, mark: string | null): Promise<void> {
    const node = this.page.locator(`[data-node-id="${id}"]`);
    if (mark === null) {
      await expect(node).not.toHaveAttribute('data-emphasis', /.+/);
    } else {
      await expect(node).toHaveAttribute('data-emphasis', mark);
    }
  }

  /** The same for an edge, by its key. */
  async expectEdgeMark(key: string, mark: string | null): Promise<void> {
    const edge = this.page.locator(`[data-edge="${key}"]`);
    if (mark === null) {
      await expect(edge).not.toHaveAttribute('data-emphasis', /.+/);
    } else {
      await expect(edge).toHaveAttribute('data-emphasis', mark);
    }
  }

  /** How an edge is lit, by the attribute that the canvas sets on it, or `null`. */
  edgeMark(key: string): Promise<string | null> {
    return this.page.locator(`[data-edge="${key}"]`).getAttribute('data-emphasis');
  }

  /** How a node is lit, by the attribute that the canvas sets on it, or `null`. */
  nodeMark(id: string): Promise<string | null> {
    return this.page.locator(`[data-node-id="${id}"]`).getAttribute('data-emphasis');
  }

  /** The stroke and the width of the path that the library drew for an edge, as the browser computes them. */
  edgeLook(key: string): Promise<{ stroke: string; width: string; opacity: string; dasharray: string }> {
    return this.page.locator(`[data-edge="${key}"] path.f-connection-path`).evaluate((path) => {
      const style = getComputedStyle(path);
      return {
        stroke: style.stroke,
        width: style.strokeWidth,
        opacity: style.strokeOpacity,
        dasharray: style.strokeDasharray,
      };
    });
  }

  /** The stroke and the width of the outline of a node, as the browser computes them. */
  nodeLook(id: string): Promise<{ stroke: string; width: string; opacity: string; dasharray: string }> {
    return this.page.locator(`[data-node-id="${id}"] .rmq-node-outline`).evaluate((outline) => {
      const style = getComputedStyle(outline);
      return {
        stroke: style.stroke,
        width: style.strokeWidth,
        opacity: style.strokeOpacity,
        dasharray: style.strokeDasharray,
      };
    });
  }

  /** The reason that is written on the label of an edge that missed, or `null` when it has none. */
  async reasonOn(key: string): Promise<string | null> {
    const reason = this.page.locator(`[data-edge="${key}"] [data-testid="edge-reason"]`);
    return (await reason.count()) === 0 ? null : ((await reason.textContent()) ?? '').trim();
  }

  /** A point of an edge, at a fraction of its length, on the screen. */
  private onEdge(key: string, fraction: number): Promise<{ x: number; y: number }> {
    return this.page
      .locator(`[data-edge="${key}"] path.f-connection-path`)
      .evaluate((path: SVGPathElement, at: number) => {
        const point = path.getPointAtLength(path.getTotalLength() * at);
        const matrix = path.getScreenCTM()!;
        return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f };
      }, fraction);
  }

  /** Selects an edge by pressing on its line, near its target, where the edges that start from one exchange are apart, and waits for the inspector to say that it is a binding. */
  async selectBinding(key: string): Promise<void> {
    const at = await this.onEdge(key, 0.8);
    await this.page.mouse.click(at.x, at.y);
    await expect(this.page.getByTestId('inspector-title')).toHaveText('Binding');
  }

  /** A colour of the stylesheet, as the browser computes it in the theme that is on, read through an element that has it as its colour. */
  tokenColour(token: string): Promise<string> {
    return this.page.evaluate((name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, token);
  }
}

/**
 * The explanation in a real browser (ADR-0059 to ADR-0064), behind the flags `editor`, `simulation` and `explain`: the event log, what is lit on the canvas and the card that says why,
 * and what a message is in the inspector. The clock moves when the test steps it, as it does for the simulation, and what the page does not show (the rows that the scroll does not draw)
 * is read from the debug handle.
 */
export class ExplainPage extends LitCanvas {
  readonly toggle: Locator;
  readonly log: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  /** The message that is open, in the region of the inspector. */
  readonly message: Locator;

  constructor(readonly simulation: SimulationPage) {
    super(simulation.page);
    this.toggle = simulation.bar.getByRole('button', { name: 'Event log' });
    this.log = this.page.getByRole('region', { name: 'Event log' });
    this.list = this.log.getByRole('listbox', { name: 'Events' });
    this.rows = this.log.getByTestId('event-log-row');
    this.message = this.page.getByTestId('message-inspector');
  }

  get editor(): EditorPage {
    return this.simulation.editor;
  }

  /** Opens the editor with the simulation and the explanation on, on this canvas, with the clock stopped. */
  static async open(
    page: Page,
    document: CanvasDocument,
    options: { readonly reducedMotion?: boolean; readonly theme?: 'light' | 'dark'; readonly stop?: boolean } = {},
  ): Promise<ExplainPage> {
    const simulation = await SimulationPage.open(page, document, { ...options, flags: 'editor,simulation,explain' });
    return new ExplainPage(simulation);
  }

  /** What the event log holds: how many rows, how many went, and each row as it was said. */
  eventLog() {
    return this.page.evaluate(() => window.__rmq?.explainEventLog() ?? null);
  }

  /** The sentences of the rows of the log, oldest first, which are what a learner reads. */
  async texts(): Promise<string[]> {
    return ((await this.eventLog())?.rows ?? []).map(({ text }) => text);
  }

  /** Opens the log with the key that is for it, from the canvas, and waits for the list to have the keyboard. */
  async openByKey(): Promise<void> {
    await this.editor.flow.focus();
    await this.page.keyboard.press('e');
    await expect(this.log).toBeVisible();
  }

  /** Publishes from the producer with the key that is for it. */
  async publish(producer = 'Producer sender'): Promise<void> {
    await this.editor.select(producer);
    await this.page.keyboard.press('p');
  }

  /** The row of the log with this number, as a locator. */
  row(seq: number): Locator {
    return this.rows.and(this.page.locator(`[data-seq="${seq}"]`));
  }

  /** The rows of the log that are of this kind of event, as they are drawn. */
  rowsOfKind(kind: string): Locator {
    return this.log.locator(`[data-testid="event-log-row"][data-kind="${kind}"]`);
  }

  /** Chooses the row of the log that is about this kind of event, which opens its message. */
  async openFromRow(kind: string): Promise<void> {
    await this.rowsOfKind(kind).first().click();
  }

  /**
   * The middle of the shape that the overlay drew for a message, on the page, once it has stopped moving, or the first shape when there is no message given. A press there is a press on the message that it
   * stands for.
   */
  async shapeOf(message?: number): Promise<{ x: number; y: number; count: number }> {
    const frame = await this.simulation.settledFrame();
    const marker = frame.markers.find((shape) => message === undefined || shape.message === message);
    if (marker === undefined) {
      throw new Error('no shape is drawn for that message');
    }
    const host = await this.simulation.host();
    return { x: host.x + marker.x, y: host.y + marker.y, count: marker.count };
  }
}
