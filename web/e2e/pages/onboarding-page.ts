import { expect, type Locator, type Page } from '@playwright/test';
import { CanvasesPage } from './canvases-page';
import { EditorPage } from './editor-page';
import { SimulationPage } from './simulation-page';

/** The flags that the first run, the templates and the tour need (ADR-0082). */
export const ONBOARDING_PATH = '?ff=editor';

/**
 * What a learner meets first (ADR-0081 to ADR-0083), behind the flags `editor`, `canvases` and `simulation`: the chooser that asks what to start with, the templates it
 * opens, and the tour, a banner in the editor. Paths are relative to the base path (`/RabbitMqPlayground/`).
 */
export class OnboardingPage {
  readonly canvases: CanvasesPage;
  readonly editor: EditorPage;
  readonly dialog: Locator;
  readonly scratch: Locator;
  readonly tour: Locator;
  readonly cancel: Locator;
  readonly banner: Locator;
  readonly progress: Locator;
  readonly title: Locator;
  readonly text: Locator;
  readonly ways: Locator;
  readonly done: Locator;
  readonly next: Locator;
  readonly back: Locator;
  readonly end: Locator;
  readonly finish: Locator;
  /** The button of the home that asks for a template. */
  readonly more: Locator;
  /** What the app says aloud politely, in the region that a screen reader listens to. */
  readonly said: Locator;

  constructor(readonly page: Page) {
    this.canvases = new CanvasesPage(page);
    this.editor = this.canvases.editor;
    this.dialog = page.getByRole('dialog', { name: /^(Welcome to RabbitMQ Playground|New canvas from a template)$/ });
    this.scratch = this.dialog.getByRole('button', { name: 'Build from scratch' });
    this.tour = this.dialog.getByRole('button', { name: 'Take the tour (about a minute)' });
    this.cancel = this.dialog.getByRole('button', { name: 'Cancel' });
    this.banner = page.getByRole('region', { name: 'Tour' });
    this.progress = this.banner.getByTestId('tour-progress');
    this.title = this.banner.getByTestId('tour-title');
    this.text = this.banner.getByTestId('tour-text');
    this.ways = this.banner.getByTestId('tour-ways').getByRole('listitem');
    this.done = this.banner.getByTestId('tour-done');
    this.next = this.banner.getByRole('button', { name: /^(Next|Skip this step)$/ });
    this.back = this.banner.getByRole('button', { name: 'Back' });
    this.end = this.banner.getByRole('button', { name: 'End tour' });
    this.finish = this.banner.getByRole('button', { name: 'Finish' });
    this.more = page.getByRole('button', { name: 'New from a template…' });
    this.said = page.locator('body > [role="status"][aria-live="polite"]');
  }

  /** Opens the app with nothing in the browser, and waits for the question that the first run asks. */
  async firstRun(path = ONBOARDING_PATH): Promise<void> {
    await this.page.goto(path);
    await expect(this.dialog).toBeVisible();
  }

  /** The button of a template in the chooser. */
  template(name: string): Locator {
    return this.dialog.getByRole('button', { name: new RegExp(`^${name.replace(/[/]/g, '\\/')}`) });
  }

  /** Chooses a template and waits until its canvas is open and saved. */
  async choose(name: string): Promise<void> {
    await this.template(name).click();
    await expect(this.dialog).toHaveCount(0);
    await this.canvases.editorReady();
  }

  /** The id of the node with this label, which the handles are found by. */
  async idOf(label: string): Promise<string> {
    const id = await this.editor.node(label).getAttribute('data-node-id');
    if (id === null) {
      throw new Error(`There is no node ${label}`);
    }
    return id;
  }

  /**
   * Plays a template once: the clock is stopped, each producer is selected and told to publish, and the engine runs until nothing is scheduled. It answers how many copies came into each queue,
   * which is the engine's word for where a message went.
   */
  async play(producers: readonly string[]): Promise<Readonly<Record<string, number>>> {
    const simulation = new SimulationPage(this.editor);
    await simulation.bar.waitFor();
    await simulation.stop();
    for (const producer of producers) {
      await this.editor.select(`Producer ${producer}`);
      await this.page.keyboard.press('p');
    }
    for (let turn = 0; turn < 300 && (await simulation.nextAt()) !== null; turn += 1) {
      await simulation.step();
    }
    expect(await simulation.nextAt(), 'the run ended').toBeNull();
    const queues = (await simulation.view()).queues;
    return Object.fromEntries(Object.entries(queues).map(([name, queue]) => [name, queue.enqueued]));
  }
}
