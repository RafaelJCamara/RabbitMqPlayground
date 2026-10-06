import { expect, type Locator, type Page } from '@playwright/test';

/** The parts of a saved document that the tests read. */
export interface SavedDocument {
  readonly layout: { readonly nodes: Record<string, { x: number; y: number }> };
  readonly queues: Record<string, { name: string; durable: boolean }>;
  readonly exchanges: Record<string, { name: string; type: string }>;
}

/** The editor, behind the `editor` flag. Paths are relative to the base path (`/RabbitMqPlayground/`). */
export class EditorPage {
  readonly heading: Locator;
  readonly toolbox: Locator;
  readonly canvas: Locator;
  readonly inspector: Locator;
  readonly status: Locator;
  readonly saveState: Locator;
  readonly theme: Locator;
  readonly flow: Locator;
  readonly hints: Locator;
  readonly commandBar: Locator;
  readonly commandField: Locator;
  readonly howToLink: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.toolbox = page.getByRole('complementary', { name: 'Toolbox' });
    this.canvas = page.getByRole('main', { name: 'Canvas' });
    this.inspector = page.getByRole('complementary', { name: 'Inspector' });
    this.status = page.getByRole('contentinfo', { name: 'Status' });
    this.saveState = page.getByTestId('save-state');
    this.theme = page.getByRole('combobox', { name: 'Theme' });
    this.flow = page.locator('f-flow');
    this.hints = page.getByRole('region', { name: 'Hints' });
    this.commandBar = page.getByRole('region', { name: 'Command bar' });
    this.commandField = page.getByRole('combobox', { name: 'Command' });
    this.howToLink = page.getByRole('region', { name: 'How to link' });
  }

  /** Opens the editor, and waits until it has opened the canvas and says that its changes are saved. */
  async goto(path = '?ff=editor'): Promise<void> {
    await this.page.goto(path);
    await this.heading.waitFor();
    await expect(this.saveState).toHaveText('All changes saved');
  }

  /** The canvases that IndexedDB holds, read the way a browser keeps them: by the names that the app gave them. */
  canvasNames(): Promise<string[]> {
    return this.page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open('rmq-playground');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const all = database.transaction('canvases', 'readonly').objectStore('canvases').getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              database.close();
              resolve((all.result as { name: string }[]).map((record) => record.name));
            };
          };
        }),
    );
  }

  /** The document that IndexedDB holds for the canvas, which is what a reload would open, or `null` when there is none yet. */
  saved(): Promise<SavedDocument | null> {
    return this.page.evaluate(
      () =>
        new Promise<SavedDocument | null>((resolve, reject) => {
          const open = indexedDB.open('rmq-playground');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const all = database.transaction('canvases', 'readonly').objectStore('canvases').getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              database.close();
              resolve((all.result as { document: SavedDocument }[])[0]?.document ?? null);
            };
          };
        }),
    );
  }

  /** A button of the toolbox, which adds that when it is clicked: `Queue`, `Topic exchange`. */
  async add(item: string): Promise<void> {
    await this.page.getByRole('button', { name: item, exact: true }).click();
  }

  /**
   * A node on the canvas, by what a screen reader says of it: `Queue billing`. A node that has a lint says so after its label (`Exchange orders, topic, 1
   * warning`, ADR-0044), and it is the same node, so the label may be followed by `, ` and what else is said.
   */
  node(label: string, options: { exact?: boolean } = {}): Locator {
    return options.exact === true
      ? this.page.locator(`[data-node-id][aria-label="${label}"]`)
      : this.page.locator(`[data-node-id][aria-label="${label}"], [data-node-id][aria-label^="${label}, "]`);
  }

  /** A node by its id (`x1`), for the tests that say what the document has. */
  nodeById(id: string): Locator {
    return this.page.locator(`[data-node-id="${id}"]`);
  }

  /** The dot on the left (`in`) or on the right (`out`) of a node. */
  handle(id: string, which: 'in' | 'out'): Locator {
    return this.nodeById(id).locator(`[data-handle="${which}"]`);
  }

  /** Lets a link go on a point, from the dot on the right of a node: a pointer that is pressed, moved over the threshold of a drag, moved on, and released. */
  async dragLinkTo(id: string, to: { x: number; y: number }): Promise<void> {
    const from = await this.centre(this.handle(id, 'out'));
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
    await this.page.mouse.move(to.x, to.y, { steps: 8 });
    await this.page.mouse.up();
  }

  /** What the document has joined, by name and as the commands say it: `orders -> billing key=eu`, `sender -> orders`, `worker <- billing`. Sorted, so that a test can compare. */
  edges(): Promise<string[]> {
    return this.page.evaluate(() => {
      const document = window.__rmq?.document() as {
        exchanges: Record<string, { name: string }>;
        queues: Record<string, { name: string }>;
        producers: Record<string, { name: string; target: { kind: string; id: string } | null }>;
        consumers: Record<string, { name: string; queues: string[] }>;
        bindings: Record<string, { source: string; dest: { kind: string; id: string }; key: string }>;
      } | null;
      if (document === null || document === undefined) {
        return [];
      }
      const name = (kind: string, id: string): string =>
        (kind === 'exchange' ? document.exchanges : document.queues)[id]?.name ?? id;
      return [
        ...Object.values(document.bindings).map(
          (binding) =>
            `${name('exchange', binding.source)} -> ${name(binding.dest.kind, binding.dest.id)} key=${binding.key}`,
        ),
        ...Object.values(document.producers).flatMap((producer) =>
          producer.target === null ? [] : [`${producer.name} -> ${name(producer.target.kind, producer.target.id)}`],
        ),
        ...Object.values(document.consumers).flatMap((consumer) =>
          consumer.queues.map((queue) => `${consumer.name} <- ${name('queue', queue)}`),
        ),
      ].sort();
    });
  }

  /** Opens the command bar with the key that is for it, from the canvas, and waits for the cursor to be in its field. */
  async openCommandBar(): Promise<void> {
    await this.flow.focus();
    await this.page.keyboard.press('/');
    await expect(this.commandField).toBeFocused();
  }

  /** Types a line into the field of the command bar, as a person does, and runs it. */
  async runCommand(line: string): Promise<void> {
    await this.commandField.focus();
    await this.page.keyboard.insertText(line);
    await this.page.keyboard.press('Enter');
  }

  /** The lines of the log of equivalent commands, oldest first, with the bar opened to read them, and left as it was found. */
  async log(): Promise<string[]> {
    const wasOpen = (await this.commandField.count()) > 0;
    if (!wasOpen) {
      await this.commandBar.getByRole('button', { name: 'Commands' }).click();
      await this.commandField.waitFor();
    }
    const lines = await this.commandBar.getByTestId('command-log').locator('code').allTextContents();
    if (!wasOpen) {
      await this.commandBar.getByRole('button', { name: 'Commands' }).click();
    }
    return lines;
  }

  /**
   * The middle of an element on the page, once it has stopped moving: two reads of its box, a moment apart, that are the same. What a test measures is where the pointer
   * is going to go, and a canvas that is still being laid out (a card that has just gone, a note that has just come, a node that is being fitted) puts the element somewhere
   * else a moment later. Playwright's own actions wait for this; the mouse of a test does not, so it is waited for here.
   */
  async centre(locator: Locator): Promise<{ x: number; y: number }> {
    let box = await locator.boundingBox();
    for (let reads = 0; reads < 30; reads += 1) {
      if (box === null) {
        throw new Error('the element is not on the page');
      }
      await this.page.waitForTimeout(80);
      const next = await locator.boundingBox();
      if (
        next !== null &&
        next.x === box.x &&
        next.y === box.y &&
        next.width === box.width &&
        next.height === box.height
      ) {
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      box = next;
    }
    throw new Error('the element does not stop moving');
  }

  /**
   * A right click in the order that a browser on macOS or Linux sends it: `contextmenu` when the button goes down, and the release of
   * the button after it (`auxclick`; the Control click of a Mac ends in a `click` instead). Windows sends `contextmenu` after the
   * release, and the mouse of a test follows the system that it runs on, so here the events are sent one by one, as that order has them,
   * to see the menu on every system, and not only on the one that runs the tests.
   */
  async rightClickMenuFirst(at: { x: number; y: number }, release: 'auxclick' | 'click' = 'auxclick'): Promise<void> {
    await this.page.evaluate(
      ({ x, y, end }) => {
        const target = document.elementFromPoint(x, y);
        if (target === null) {
          throw new Error('there is nothing at the point');
        }
        const control = end === 'click';
        const init = (buttons: number): MouseEventInit => ({
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          button: control ? 0 : 2,
          buttons,
          ctrlKey: control,
        });
        const pointer = (type: string, buttons: number) =>
          target.dispatchEvent(new PointerEvent(type, { ...init(buttons), pointerType: 'mouse', isPrimary: true }));
        const mouse = (type: string, buttons: number) => target.dispatchEvent(new MouseEvent(type, init(buttons)));
        const down = control ? 1 : 2;
        pointer('pointerdown', down);
        mouse('mousedown', down);
        mouse('contextmenu', down);
        pointer('pointerup', 0);
        mouse('mouseup', 0);
        mouse(end, 0);
      },
      { ...at, end: release },
    );
  }

  /** Selects a node by clicking it, and waits until the editor has heard of it, so that what follows is for that node. */
  async select(label: string): Promise<void> {
    const at = await this.centre(this.node(label));
    await this.page.mouse.click(at.x, at.y);
    await expect(this.page.getByTestId('inspector-title')).not.toHaveText('Inspector');
  }

  /** Renames the node that is selected, with F2: waits for the field to have the focus before it types, as a person does. */
  async renameSelected(from: string, to: string): Promise<void> {
    await this.page.keyboard.press('F2');
    await expect(
      this.page.getByRole('textbox', { name: `Rename ${from.charAt(0).toLowerCase()}${from.slice(1)}` }),
    ).toBeFocused();
    await this.page.keyboard.type(to);
    await this.page.keyboard.press('Enter');
  }

  /** Waits until the canvas has stopped moving: its viewport is the same in two reads that are a moment apart. */
  async settled(): Promise<void> {
    let previous = '';
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await this.page.evaluate(() => window.__rmq?.viewport()));
          const same = now === previous;
          previous = now;
          return same;
        },
        { intervals: [250] },
      )
      .toBe(true);
  }

  /** The position of every node, by name, as the document has it. */
  layout(): Promise<Record<string, { x: number; y: number }>> {
    return this.page.evaluate(() => {
      const document = window.__rmq?.document() as {
        layout: { nodes: Record<string, { x: number; y: number }> };
        exchanges: Record<string, { name: string }>;
        queues: Record<string, { name: string }>;
        producers: Record<string, { name: string }>;
        consumers: Record<string, { name: string }>;
      } | null;
      if (document === null || document === undefined) {
        return {};
      }
      const names: Record<string, string> = {};
      for (const group of [document.exchanges, document.queues, document.producers, document.consumers]) {
        for (const [id, record] of Object.entries(group)) {
          names[id] = record.name;
        }
      }
      return Object.fromEntries(
        Object.entries(document.layout.nodes).map(([id, position]) => [names[id] ?? id, position]),
      );
    });
  }

  /** How far the canvas is zoomed, as the button of the top bar says it, as a number: 100 is 100%. */
  async zoomPercent(): Promise<number> {
    return Number.parseInt((await this.page.getByTestId('zoom-reset').innerText()).replace('%', ''), 10);
  }

  /** The editor's debug handle (e2e build only). */
  document(): Promise<{ queues: Record<string, { name: string }> } | null> {
    return this.page.evaluate(() => window.__rmq?.document() ?? null) as Promise<{
      queues: Record<string, { name: string }>;
    } | null>;
  }
}
