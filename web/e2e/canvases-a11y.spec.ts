import { emptyDocument } from '@rmq/domain';
import type { Page } from '@playwright/test';
import { CanvasesPage } from './pages/canvases-page';
import { skipWelcome } from './pages/editor-page';
import { expectNoAxeViolations } from './support/axe';
import { buildDocument, seedLibrary, type SeededCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * Accessibility of what S9 puts on the screen, in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best practices, in each new
 * state, with no rule switched off. A state is the workspace with its strip; the home, empty, full, searched, with canvases that cannot be opened and with each thing it can say
 * about keeping the canvases; a notice with an Undo, and one whose Undo did not work; and every dialog: the name, the question before a delete, the question before every canvas is
 * deleted, the reason a file could not be opened and the report of a backup that was put back.
 *
 * Every state here is a row of docs/accessibility.md (ADR-0085), and a state without a row fails tools/accessibility/accessibility.spec.ts.
 */

const DAY = 24 * 60 * 60 * 1000;
const LIGHT_ACCENT = 'rgb(29, 78, 216)';
const DARK_ACCENT = 'rgb(147, 197, 253)';

const small = () =>
  buildDocument([
    {
      type: 'declare-exchange',
      name: 'orders',
      exchangeType: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    },
    { type: 'declare-queue', name: 'billing', durable: true },
    { type: 'add-producer', name: 'sender' },
    { type: 'add-consumer', name: 'worker' },
    { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'k' },
    { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
    { type: 'subscribe', consumer: 'worker', queue: 'billing' },
  ]);

const FEW: readonly SeededCanvas[] = [
  { id: 'orders', name: 'Orders flow', document: small() },
  { id: 'logs', name: 'Logs', document: small() },
  { id: 'blank', name: 'Blank' },
  { id: 'long', name: 'A canvas with a very long name that does not fit on one line of a card at all' },
];

const NEWER: SeededCanvas = {
  id: 'newer',
  name: 'From a newer app',
  document: { ...emptyDocument(), schemaVersion: 99 } as never,
};

/** More canvases than a page of the home draws (48), so that the home offers to show more. */
const MANY: readonly SeededCanvas[] = Array.from({ length: 50 }, (_, index) => ({
  id: `many${index}`,
  name: `Canvas ${index + 1}`,
}));

interface State {
  readonly name: string;
  /** The browser keeps nothing, so the editor does not say that its changes are saved. */
  readonly inMemory?: boolean;
  /** Put in the browser before the app starts. */
  readonly before?: (page: Page) => Promise<void>;
  readonly canvases?: readonly SeededCanvas[];
  /** The strip that is kept and the canvas that was open last, when the state is not the one that a start makes. */
  readonly strip?: { readonly openCanvases: readonly string[]; readonly lastOpenCanvas: string };
  readonly enter: (canvases: CanvasesPage) => Promise<void>;
}

/** Deletes a canvas from its card, after the question. */
async function deleteCard(canvases: CanvasesPage, name: string): Promise<void> {
  await canvases.action(name, 'Delete').click();
  await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
}

const states: readonly State[] = [
  {
    name: 'in the workspace, on a first run, with the strip and the editor',
    enter: async () => undefined,
  },
  {
    name: 'in the workspace with several open canvases, one of them shown',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.newCanvas();
    },
  },
  {
    name: 'in the workspace with more open canvases than the strip holds, and the arrows that show the rest',
    canvases: MANY,
    strip: { openCanvases: MANY.slice(0, 24).map(({ id }) => id), lastOpenCanvas: 'many0' },
    enter: async (canvases) => {
      await expect(canvases.olderTabs).toBeVisible();
      await expect(canvases.newerTabs).toHaveCount(0);
      await canvases.olderTabs.click();
      await expect(canvases.newerTabs).toBeVisible();
      await expect(canvases.closeAllButton).toBeVisible();
    },
  },
  {
    name: 'on the home, with a card for each canvas, a drawing for each, and a name that is cut',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.card('Orders flow')).toBeVisible();
    },
  },
  {
    name: 'on the home, with nothing to show',
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Untitled canvas');
      await expect(canvases.home.getByText(/You have no canvases yet/)).toBeVisible();
    },
  },
  {
    name: 'on the home, with a search that matches no canvas',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.search.fill('zzz');
      await expect(canvases.home.getByText('No canvas has “zzz” in its name.')).toBeVisible();
    },
  },
  {
    name: 'on the home, sorted by name with a search that matches some',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.sort.selectOption('name');
      await canvases.search.fill('o');
    },
  },
  {
    name: 'on the home, with more canvases than a page of cards holds, and the button that shows more',
    canvases: MANY,
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByTestId('home-more')).toBeVisible();
    },
  },
  {
    name: 'on the home, scrolled to its foot: the disclaimer and the links to the source, the decisions and the progress',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      // The foot is below the window in the other states of the home, in the part that scrolls. Here it is in view, so that what axe reads is what a person sees.
      const footer = canvases.home.getByTestId('home-footer');
      await footer.scrollIntoViewIfNeeded();
      await expect(footer).toBeInViewport({ ratio: 1 });
      await expect(footer.getByRole('link')).toHaveCount(3);
    },
  },
  {
    name: 'on the home, with a canvas that cannot be opened beside the ones that can',
    canvases: [...FEW, NEWER],
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByTestId('home-unreadable')).toBeVisible();
    },
  },
  {
    name: 'on the home, with the reminder to make a backup and how much room the canvases take',
    canvases: [
      { id: 'old', name: 'Old', document: small(), createdAt: Date.now() - 20 * DAY, updatedAt: Date.now() - 20 * DAY },
    ],
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByRole('group', { name: 'Reminder to make a backup' })).toBeVisible();
      await expect(canvases.home.getByTestId('usage')).toBeVisible();
    },
  },
  {
    name: 'on the home, with the warning that the room is nearly gone and that the browser did not promise to keep the canvases',
    canvases: FEW,
    before: async (page) => {
      await page.addInitScript(() => {
        navigator.storage.estimate = async () => ({ usage: 850, quota: 1_000 });
        navigator.storage.persist = async () => false;
      });
    },
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByTestId('quota')).toBeVisible();
      await expect(canvases.home.getByTestId('persistence-note')).toBeVisible();
    },
  },
  {
    name: 'on the home, with the warning that almost no room is left',
    canvases: FEW,
    before: async (page) => {
      await page.addInitScript(() => {
        navigator.storage.estimate = async () => ({ usage: 970, quota: 1_000 });
      });
    },
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByTestId('quota')).toContainText('almost no room');
    },
  },
  {
    name: 'on the home, when the browser keeps nothing',
    inMemory: true,
    before: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', {
          configurable: true,
          value: {
            open() {
              throw new DOMException('The operation is insecure.', 'SecurityError');
            },
          },
        });
      });
    },
    enter: async (canvases) => {
      await canvases.showHome();
      await expect(canvases.home.getByTestId('memory-note')).toBeVisible();
    },
  },
  {
    name: 'on the home, with the problem that a backup could not be made',
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Untitled canvas');
      await canvases.home.getByRole('button', { name: 'Back up everything' }).click();
      await expect(canvases.home.getByTestId('home-problem')).toBeVisible();
    },
  },
  {
    name: 'with a notice that offers to take a delete back',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Logs');
      await expect(canvases.notices).toBeVisible();
    },
  },
  {
    name: 'with a notice whose Undo did not work, and says why',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Logs');
      await expect(canvases.notices).toBeVisible();
      // The canvas is taken out of the browser behind the app's back, as a purge would, so that the Undo finds nothing.
      await canvases.page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('rmq-playground');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const transaction = open.result.transaction('canvases', 'readwrite');
              transaction.objectStore('canvases').delete('logs');
              transaction.oncomplete = () => {
                open.result.close();
                resolve();
              };
            };
          }),
      );
      await canvases.notices.getByRole('button', { name: 'Undo' }).click();
      await expect(canvases.notices.getByTestId('toast-problem')).toBeVisible();
    },
  },
  {
    name: 'with the dialog that asks for a name',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.action('Logs', 'Rename').click();
      await expect(canvases.dialog).toBeVisible();
    },
  },
  {
    name: 'with the dialog that asks for a name, and says why the name cannot be used',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.action('Logs', 'Rename').click();
      await canvases.dialog.getByRole('textbox', { name: 'Name' }).fill('   ');
      await canvases.dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(canvases.dialog.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'with the question before a canvas is deleted',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.action('Logs', 'Delete').click();
      await expect(canvases.confirmation).toBeVisible();
    },
  },
  {
    name: 'with the question before every canvas is deleted',
    canvases: [...FEW, NEWER],
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
      await expect(canvases.confirmation).toBeVisible();
    },
  },
  {
    name: 'with the question before every canvas is deleted, after a backup was saved',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
      await canvases.downloaded(() =>
        canvases.confirmation.getByRole('button', { name: 'Export a backup first' }).click(),
      );
      await expect(canvases.confirmation.getByTestId('backup-status')).toContainText('Backed up');
    },
  },
  {
    name: 'with the question before every canvas is deleted, when the backup that it offers could not be made',
    canvases: [NEWER],
    enter: async (canvases) => {
      // The one canvas that the first run made is deleted, so that what is left is a canvas that this version cannot open, which a backup cannot hold.
      await canvases.showHome();
      await deleteCard(canvases, 'Untitled canvas');
      await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
      await canvases.confirmation.getByRole('button', { name: 'Export a backup first' }).click();
      await expect(canvases.confirmation.getByTestId('backup-problem')).toContainText('There is nothing to back up');
    },
  },
  {
    name: 'with the dialog that says why a file could not be opened',
    enter: async (canvases) => {
      await canvases.showHome();
      await canvases.choose('open-file', 'broken.json', 'this is not JSON');
      await expect(canvases.confirmation).toBeVisible();
    },
  },
  {
    name: 'with the report of a backup that was put back, and what could not be',
    enter: async (canvases) => {
      await canvases.showHome();
      const text = JSON.stringify({
        format: 'rmq-playground/backup',
        version: 1,
        exportedAt: 1,
        canvases: [
          { id: 'fine', name: 'Fine', createdAt: 1, updatedAt: 2, document: emptyDocument() },
          {
            id: 'newer',
            name: 'Broken',
            createdAt: 1,
            updatedAt: 2,
            document: { ...emptyDocument(), schemaVersion: 99 },
          },
        ],
      });
      await canvases.choose('restore-file', 'backup.json', text);
      await expect(canvases.page.getByRole('dialog', { name: 'Backup restored' })).toBeVisible();
    },
  },
  {
    name: 'with the report of a backup that was put back, and more that could not be than the report lists',
    enter: async (canvases) => {
      await canvases.showHome();
      // The report lists twenty of what could not be put back and counts the rest.
      const text = JSON.stringify({
        format: 'rmq-playground/backup',
        version: 1,
        exportedAt: 1,
        canvases: Array.from({ length: 22 }, (_, index) => ({
          id: `newer${index}`,
          name: `Broken ${index + 1}`,
          createdAt: 1,
          updatedAt: 2,
          document: { ...emptyDocument(), schemaVersion: 99 },
        })),
      });
      await canvases.choose('restore-file', 'backup.json', text);
      await expect(canvases.page.getByTestId('restore-more')).toHaveText('and 2 more.');
    },
  },
  {
    name: 'in the editor, with the notice after a clear',
    canvases: FEW,
    enter: async (canvases) => {
      await canvases.editor.add('Queue');
      await canvases.page.getByRole('button', { name: 'Clear canvas' }).click();
      await expect(canvases.notices).toBeVisible();
    },
  },
  {
    name: 'on the home, with three notices floating at the bottom right over its foot',
    canvases: MANY,
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Canvas 50');
      await deleteCard(canvases, 'Canvas 49');
      await deleteCard(canvases, 'Canvas 48');
      await expect(canvases.notices.getByTestId('toast')).toHaveCount(3);
      await canvases.home.evaluate((main) => main.scrollTo(0, main.scrollHeight));
    },
  },
  {
    name: 'in the editor, with three notices floating at the bottom right over the inspector',
    canvases: MANY,
    enter: async (canvases) => {
      await canvases.showHome();
      await deleteCard(canvases, 'Canvas 50');
      await deleteCard(canvases, 'Canvas 49');
      await deleteCard(canvases, 'Canvas 48');
      await canvases.open('Canvas 47');
      await canvases.editor.add('Producer');
      await expect(canvases.notices.getByTestId('toast')).toHaveCount(3);
    },
  },
  {
    name: 'in the editor, with the warning that the room is nearly gone and the note that the browser did not promise to keep the canvases',
    canvases: FEW,
    before: async (page) => {
      await page.addInitScript(() => {
        navigator.storage.estimate = async () => ({ usage: 850, quota: 1_000 });
        navigator.storage.persist = async () => false;
      });
    },
    enter: async (canvases) => {
      // The note comes a moment after the first change.
      await canvases.editor.add('Queue');
      await expect(canvases.page.getByTestId('persistence')).toBeVisible();
      await expect(canvases.page.getByTestId('quota')).toBeVisible();
    },
  },
  {
    name: 'in the editor, with the note that a canvas saved in this browser could not be opened',
    canvases: [...FEW, NEWER],
    enter: async (canvases) => {
      await expect(canvases.page.getByTestId('unreadable')).toBeVisible();
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the canvases in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const state of states) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const canvases = new CanvasesPage(page);
        await state.before?.(page);
        if (state.canvases !== undefined) {
          await seedLibrary(page, state.canvases, state.strip);
        }
        if (state.inMemory === true) {
          await page.goto('');
          await skipWelcome(page);
          await canvases.heading.waitFor();
          await expect(canvases.editor.saveState).toContainText('Not kept after you close this tab.');
        } else {
          await canvases.goto();
        }
        await state.enter(canvases);

        await expectNoAxeViolations(page);
      });
    }

    test('really is in the theme that it is tested in, so that the checks above are of this theme', async ({
      page,
    }) => {
      const canvases = new CanvasesPage(page);
      await canvases.goto();
      await canvases.showHome();

      const isDark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

      expect(isDark).toBe(colorScheme === 'dark');
      const primary = canvases.home.getByTestId('home-new');
      await expect(primary).toHaveCSS('background-color', colorScheme === 'dark' ? DARK_ACCENT : LIGHT_ACCENT);
    });
  });
}
