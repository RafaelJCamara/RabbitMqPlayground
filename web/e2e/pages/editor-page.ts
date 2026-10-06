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
  node(label: string): Locator {
    return this.page.locator(`[data-node-id][aria-label="${label}"], [data-node-id][aria-label^="${label}, "]`);
  }

  /** The middle of an element on the page. */
  async centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error('the element is not on the page');
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
