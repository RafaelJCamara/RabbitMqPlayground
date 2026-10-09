import { expect, type Locator, type Page } from '@playwright/test';
import { edgeKeys, type CanvasDocument } from '@rmq/domain';
import { seedCanvas } from '../support/seed';
import { EditorPage } from './editor-page';
import { LitCanvas } from './explain-page';

/**
 * The testers of the explanation in a real browser (ADR-0064): the what-if tester, in the region of the inspector, and the topic tester, in the popover that asks for a key and under the key fields of a binding.
 * They need the flag `explain` and not the simulation, so this page opens the editor with `editor,explain`, which has no strip and no log, and is made over any editor page, for the journeys that have the
 * simulation on as well.
 */
export class TesterPage extends LitCanvas {
  /** The section of the inspector region, whether it is shut or open. */
  readonly section: Locator;
  readonly toggle: Locator;
  readonly exchange: Locator;
  readonly message: Locator;
  readonly answer: Locator;
  readonly route: Locator;
  readonly line: Locator;
  readonly problem: Locator;

  constructor(readonly editor: EditorPage) {
    super(editor.page);
    this.section = this.page.getByRole('region', { name: 'What if…?' });
    this.toggle = this.section.getByRole('button', { name: 'What if…?' });
    this.exchange = this.section.getByRole('combobox', { name: 'Exchange' });
    this.message = this.section.getByRole('textbox', { name: 'Message' });
    this.answer = this.section.getByTestId('what-if-answer');
    this.route = this.section.getByTestId('what-if-route');
    this.line = this.section.getByTestId('what-if-line');
    this.problem = this.section.getByTestId('what-if-problem');
  }

  /** Opens the editor on this canvas. */
  static async open(page: Page, document: CanvasDocument): Promise<TesterPage> {
    await seedCanvas(page, document, 'Tested canvas');
    const editor = new EditorPage(page);
    await editor.goto();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length ?? 0)).toBe(edgeKeys(document).size);
    await editor.settled();
    return new TesterPage(editor);
  }

  /** Opens the tester with its button, and waits for what it has to be there. */
  async show(): Promise<void> {
    if ((await this.toggle.getAttribute('aria-expanded')) !== 'true') {
      await this.toggle.click();
    }
    await expect(this.toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(this.message).toBeVisible();
  }

  /** Writes a message to an exchange, as a learner does: opens the tester, chooses the exchange by what the list says, and types the message. The exchange that is there is the one that is asked when none is given. */
  async ask(message: string, exchange?: string): Promise<void> {
    await this.show();
    if (exchange !== undefined) {
      await this.exchange.selectOption({ label: exchange });
    }
    await this.message.fill(message);
  }

  /** The text of the options of the list of exchanges, as a person reads them. */
  async exchanges(): Promise<string[]> {
    return (await this.exchange.locator('option').allTextContents()).map((text) => text.trim());
  }

  /** What the document has, as the JSON that the debug handle gives, so that a test can say that nothing changed it. */
  async document(): Promise<string> {
    return JSON.stringify(await this.page.evaluate(() => window.__rmq?.document() ?? null));
  }

  /** What is selected, as the debug handle says it. */
  selection() {
    return this.page.evaluate(() => window.__rmq?.selection() ?? null);
  }

  /** The popover that asks for the key of a binding, from an exchange to a queue, by what a screen reader says of it. */
  keyPopover(from: string, to: string): Locator {
    return this.page.getByRole('group', { name: `Binding key from ${from} to ${to}` });
  }

  /** The tester of a topic key, wherever it is: in the popover or under a field. */
  get topicTester(): Locator {
    return this.page.getByRole('group', { name: 'What this key matches' });
  }
}
