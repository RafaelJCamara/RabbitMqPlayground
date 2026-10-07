import { expect, type Locator, type Page } from '@playwright/test';
import { edgeKeys, type CanvasDocument } from '@rmq/domain';
import { seedCanvas } from '../support/seed';
import { EditorPage } from './editor-page';
import { ExplainPage } from './explain-page';
import { SimulationPage } from './simulation-page';

/** A condition of a binding, or a header of a message, as the document holds it: its name and its tagged value. */
export interface Argument {
  readonly key: string;
  readonly value: { readonly t: string; readonly v?: string | number | boolean };
}

/** A binding of a headers exchange, as the document holds it, with the names of what it joins. */
export interface HeadersBinding {
  readonly from: string;
  readonly to: string;
  readonly xMatch: string | null;
  readonly args: readonly Argument[];
}

/**
 * The rows of a set of headers, wherever they are drawn (ADR-0066): the conditions of a binding, in the popover that asks for them and in the inspector, and the headers of a message, in the composer of a
 * producer. A row has a name, a type and a value, by the names that a screen reader says of them: `Name of condition 1`, `Type of header 2`.
 */
export class HeaderRows {
  constructor(
    readonly scope: Locator,
    /** What a row is called: `condition` for a binding, `header` for a message. */
    readonly noun: 'condition' | 'header',
  ) {}

  get rows(): Locator {
    return this.scope.getByTestId('header-row');
  }

  name(row: number): Locator {
    return this.scope.getByRole('textbox', { name: `Name of ${this.noun} ${row}` });
  }

  type(row: number): Locator {
    return this.scope.getByRole('combobox', { name: `Type of ${this.noun} ${row}` });
  }

  value(row: number): Locator {
    return this.scope.getByRole('textbox', { name: `Value of ${this.noun} ${row}` });
  }

  remove(row: number): Locator {
    return this.scope.getByRole('button', { name: new RegExp(`^Remove ${this.noun} ${row}\\b`) });
  }

  get add(): Locator {
    return this.scope.getByRole('button', { name: `Add ${this.noun}`, exact: true });
  }

  /** What is wrong with a row, in the place where it is said: under its name, under its value, or under its type. */
  problem(row: number, field: 'key' | 'value' | 'type'): Locator {
    return this.rows.nth(row - 1).getByTestId(`header-${field}-problem`);
  }

  /** What to know about a row that is not wrong: an `x-` name that the mode counts or does not, a duplicate. */
  notes(row: number): Locator {
    return this.rows.nth(row - 1).getByTestId('header-notes');
  }

  /** Types a name and a value into a row that is there. A value of `null` leaves the value as it is, for a row that only has to be there. */
  async fill(row: number, name: string, value: string | null = null): Promise<void> {
    await this.name(row).fill(name);
    if (value !== null) {
      await this.value(row).fill(value);
    }
  }

  /** Adds a row with the button, and types into it. The new row has the cursor in its name, so the test waits for that before it types. */
  async append(name: string, value: string | null = null): Promise<void> {
    const before = await this.rows.count();
    await this.add.click();
    await expect(this.rows).toHaveCount(before + 1);
    await expect(this.name(before + 1)).toBeFocused();
    await this.fill(before + 1, name, value);
  }
}

/**
 * The editor of the conditions of a headers binding (ADR-0066, ADR-0068): the mode of `x-match`, the rows, the sentence of what the binding asks, and what is said under them, whether it is in the popover
 * that asks for them when a link is made or in the inspector of a binding.
 */
export class Conditions extends HeaderRows {
  constructor(scope: Locator) {
    super(scope, 'condition');
  }

  /** One of the four choices of the mode, by its name: the radio button, whose state is read. */
  mode(name: 'all' | 'any' | 'all-with-x' | 'any-with-x'): Locator {
    return this.scope.getByRole('radio', { name, exact: true });
  }

  /** Chooses a mode as a person does, by pressing the words of the choice: the radio button itself is hidden, and its label is what a pointer meets. */
  async choose(name: 'all' | 'any' | 'all-with-x' | 'any-with-x'): Promise<void> {
    await this.modes
      .locator('label')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .click();
    await expect(this.mode(name)).toBeChecked();
  }

  get modes(): Locator {
    return this.scope.getByRole('group', { name: 'x-match' });
  }

  get modeHelp(): Locator {
    return this.scope.getByTestId('conditions-mode');
  }

  get sentence(): Locator {
    return this.scope.getByTestId('conditions-sentence');
  }

  get lint(): Locator {
    return this.scope.getByTestId('conditions-lint');
  }

  /** A problem of the whole set that no row owns: too many rows. */
  get problemOfAll(): Locator {
    return this.scope.getByTestId('conditions-problem');
  }

  /** Why the owner refused the arguments, which is shown until something is changed. */
  get refusal(): Locator {
    return this.scope.getByTestId('conditions-refusal');
  }

  get exportNote(): Locator {
    return this.scope.getByTestId('conditions-export');
  }

  get keyNote(): Locator {
    return this.scope.getByTestId('conditions-key');
  }

  get line(): Locator {
    return this.scope.getByTestId('conditions-line');
  }

  get submit(): Locator {
    return this.scope.getByTestId('conditions-submit');
  }

  get cancel(): Locator {
    return this.scope.getByTestId('conditions-cancel');
  }

  get revert(): Locator {
    return this.scope.getByTestId('conditions-revert');
  }

  /** The table of recent messages against the conditions, with the flags `simulation` and `explain`. */
  get live(): LiveTable {
    return new LiveTable(this.scope.getByTestId('headers-live'));
  }
}

/** The table of the last messages against the conditions of a binding (ADR-0070): a row for each message, a cell for each condition, and the verdict of the binding. */
export class LiveTable {
  constructor(readonly scope: Locator) {}

  get rows(): Locator {
    return this.scope.getByTestId('headers-live-row');
  }

  get empty(): Locator {
    return this.scope.getByTestId('headers-live-empty');
  }

  get caption(): Locator {
    return this.scope.getByTestId('headers-live-caption');
  }

  /** The row of the message with this number. */
  row(message: number): Locator {
    return this.rows.filter({ has: this.scope.page().locator(`th[scope="row"]`, { hasText: `#${message}` }) });
  }

  /** The words of the cells of a row, the verdict last: `['✓ matches', 'matched']`, as a person reads them. */
  async words(row: Locator): Promise<string[]> {
    return (await row.locator('td').allTextContents()).map((cell) => cell.replace(/\s+/g, ' ').trim());
  }
}

/**
 * "Bind from this message…" (ADR-0070), a section of the message inspector: the headers of the message with a tick for each, the exchange to bind from and what to bind to, the mode, what the binding asks
 * in a sentence, the table of recent messages and the line that "Create binding" makes.
 */
export class BindPanel {
  constructor(readonly scope: Locator) {}

  get toggle(): Locator {
    return this.scope.getByTestId('bind-toggle');
  }

  get body(): Locator {
    return this.scope.getByTestId('bind-body');
  }

  /** The tick of a header of the message, by the name of the header. */
  tick(name: string): Locator {
    return this.scope.getByRole('checkbox', { name: `Use the header ${name} as a condition` });
  }

  get ticks(): Locator {
    return this.scope.getByTestId('bind-tick');
  }

  get from(): Locator {
    return this.scope.getByTestId('bind-from');
  }

  get to(): Locator {
    return this.scope.getByTestId('bind-to');
  }

  /** The mode, which is the same control as the editor of a binding has. */
  get mode(): Conditions {
    return new Conditions(this.scope);
  }

  get sentence(): Locator {
    return this.scope.getByTestId('bind-sentence');
  }

  get line(): Locator {
    return this.scope.getByTestId('bind-line');
  }

  get lint(): Locator {
    return this.scope.getByTestId('bind-lint');
  }

  get notes(): Locator {
    return this.scope.getByTestId('bind-notes');
  }

  get reserved(): Locator {
    return this.scope.getByTestId('bind-reserved');
  }

  get noHeaders(): Locator {
    return this.scope.getByTestId('bind-no-headers');
  }

  get noExchange(): Locator {
    return this.scope.getByTestId('bind-no-exchange');
  }

  get elsewhere(): Locator {
    return this.scope.getByTestId('bind-elsewhere');
  }

  get refusal(): Locator {
    return this.scope.getByTestId('bind-refusal');
  }

  get create(): Locator {
    return this.scope.getByTestId('bind-create');
  }

  get live(): LiveTable {
    return new LiveTable(this.scope.getByTestId('headers-live'));
  }

  /** Opens the panel with its button, if it is shut, and waits for what is in it. */
  async show(): Promise<void> {
    if ((await this.toggle.getAttribute('aria-expanded')) !== 'true') {
      await this.toggle.click();
    }
    await expect(this.body).toBeVisible();
  }
}

/**
 * The conditions of a headers binding in a real browser (S8, ADR-0066 to ADR-0070). It opens the editor with the flags that a test asks for, and has the places where the conditions are drawn: the popover that
 * asks for them, the editor in the inspector, the chips on the label of an edge and the card behind them, the table of a producer's headers, and, with the explanation, the table of recent messages and the
 * panel that makes a binding from a message. It is an explanation page, so that what is lit and what the log says are read in the same way.
 */
export class HeadersPage extends ExplainPage {
  constructor(simulation: SimulationPage) {
    super(simulation);
  }

  /**
   * Opens the editor on this canvas with the flags that are asked for: `editor,headers` alone, the conditions only; with `simulation` the producer's table; with `explain` too the table of recent messages and
   * the binding made from a message. With the simulation the clock is stopped, as it is for every page of the simulation.
   */
  static override async open(
    page: Page,
    document: CanvasDocument,
    options: {
      readonly flags?: string;
      readonly theme?: 'light' | 'dark';
      readonly reducedMotion?: boolean;
      readonly stop?: boolean;
    } = {},
  ): Promise<HeadersPage> {
    const flags = options.flags ?? 'editor,headers';
    if (flags.split(',').includes('simulation')) {
      return new HeadersPage(await SimulationPage.open(page, document, { ...options, flags }));
    }
    if (options.theme !== undefined || options.reducedMotion === true) {
      await page.emulateMedia({
        colorScheme: options.theme ?? null,
        reducedMotion: options.reducedMotion === true ? 'reduce' : null,
      });
    }
    await seedCanvas(page, document, 'Headers canvas');
    const editor = new EditorPage(page);
    await editor.goto(`?ff=${flags}`);
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length ?? 0)).toBe(edgeKeys(document).size);
    await editor.settled();
    return new HeadersPage(new SimulationPage(editor));
  }

  /** The popover that asks for the conditions of a link that is being made, by what a screen reader says of it: `exchange files`, `queue pdfs`. */
  popover(from: string, to: string): Conditions {
    return new Conditions(this.page.getByRole('group', { name: `Conditions for the binding from ${from} to ${to}` }));
  }

  /** The editor of the conditions of the bindings of the edge that is selected, in the inspector: the first one, or the one that is asked for (counted from 1). */
  conditions(binding = 1): Conditions {
    return new Conditions(this.editor.inspector.getByTestId('binding-conditions').nth(binding - 1));
  }

  /** The chips of the bindings on the label of an edge, as they are drawn: not the reason that a lit canvas gives for a binding that missed, which is a chip of its own. */
  chips(edge: string): Locator {
    return this.page.locator(`[data-label="${edge}"] .rmq-chip:not(.rmq-reason)`);
  }

  /** The label of an edge, which is a part of the edge and moves with it. */
  label(edge: string): Locator {
    return this.page.locator(`[data-label="${edge}"]`);
  }

  /** The card that lists everything that a label says, while a pointer is over the label. */
  get labelCard(): Locator {
    return this.page.getByTestId('label-card');
  }

  /** The panel of the message inspector that makes a binding from the message that is open. */
  get bind(): BindPanel {
    return new BindPanel(this.message.getByTestId('bind-from-message'));
  }

  /** Publishes from the producer and runs everything that happens to the message, and opens it from the row of the log that says what became of it. */
  async openLastMessage(kind: string, producer = 'Producer sender'): Promise<void> {
    await this.publish(producer);
    await this.simulation.stepThrough();
    await this.openByKey();
    await this.rowsOfKind(kind).last().click();
    await expect(this.message).toBeVisible();
  }

  /** The composer of the selected producer, with the table of its headers. */
  get composer(): Locator {
    return this.page.getByTestId('producer-composer');
  }

  /** The table of the headers of the message that the selected producer sends (with the flag `headers`). */
  get table(): HeaderRows {
    return new HeaderRows(this.composer.getByTestId('composer-headers-table'), 'header');
  }

  /** What the bindings of headers exchanges are in the document, by the names of what they join, in the order that they were made. */
  bindings(): Promise<HeadersBinding[]> {
    return this.page.evaluate(() => {
      const document = window.__rmq?.document() as {
        exchanges: Record<string, { name: string; type: string }>;
        queues: Record<string, { name: string }>;
        bindings: Record<
          string,
          {
            source: string;
            dest: { kind: string; id: string };
            headers?: {
              xMatch: string | null;
              args: { key: string; value: { t: string; v?: string | number | boolean } }[];
            };
          }
        >;
      } | null;
      if (document === null || document === undefined) {
        return [];
      }
      return Object.values(document.bindings)
        .filter((binding) => document.exchanges[binding.source]?.type === 'headers')
        .map((binding) => ({
          from: document.exchanges[binding.source]?.name ?? binding.source,
          to:
            (binding.dest.kind === 'exchange' ? document.exchanges : document.queues)[binding.dest.id]?.name ??
            binding.dest.id,
          xMatch: binding.headers?.xMatch ?? null,
          args: binding.headers?.args ?? [],
        }));
    });
  }

  /** The headers of the message that a producer sends, as the document holds them. */
  producerHeaders(name = 'sender'): Promise<Argument[]> {
    return this.page.evaluate((producer) => {
      const document = window.__rmq?.document() as {
        producers: Record<string, { name: string; message: { headers: Argument[] } }>;
      } | null;
      const found = Object.values(document?.producers ?? {}).find(({ name: candidate }) => candidate === producer);
      return found?.message.headers ?? [];
    }, name);
  }

  /** The lines of the log of equivalent commands that the test made happen, oldest first: the one that stopped the clock, when the page was opened, is not one of them. */
  async commands(): Promise<string[]> {
    return (await this.editor.log()).filter((line) => line !== 'pause');
  }

  /** The words that the screen reader is told, politely, last. */
  get polite(): Locator {
    return this.page.locator('body > [role="status"][aria-live="polite"]');
  }

  /** The words that the screen reader is told, at once. */
  get assertive(): Locator {
    return this.page.locator('body > [role="alert"][aria-live="assertive"]');
  }

  /** What the bar at the foot of the page says the last thing was. */
  get said(): Locator {
    return this.page.getByTestId('status-message');
  }
}
