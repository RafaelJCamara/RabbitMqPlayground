import type { Page } from '@playwright/test';
import type { CanvasDocument } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { expectNoAxeViolations } from './support/axe';
import { buildDocument, seedCanvas } from './support/seed';
import { EDGES, TOPOLOGY } from './support/topology';
import { expect, test } from './support/test';

/**
 * Accessibility of every screen of the editor, in the light theme and in the dark one (ADR-0036, journey 2 of the plan): axe, with every
 * rule for WCAG 2.0 to 2.2 at A and AA and the best practices, on a canvas that has something on it, in each state that it can be in.
 * No rule is switched off. The page that is empty is in editor-shell.spec.ts.
 *
 * Every state here is a row of docs/accessibility.md (ADR-0085), and a state without a row fails tools/accessibility/accessibility.spec.ts.
 */

/** Opens the editor on a canvas with one of each kind of node and an edge of each kind (unless the state brings another), once it is drawn. */
async function open(
  page: Page,
  document: CanvasDocument = TOPOLOGY,
  edges: number = EDGES.length,
): Promise<EditorPage> {
  await seedCanvas(page, document);
  const editor = new EditorPage(page);
  await editor.goto();
  await page.locator('rmq-flow-canvas[data-ready]').waitFor();
  await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(edges);
  await editor.settled();
  return editor;
}

/** Selects an edge with a click on its line, a part of the way along it, and waits for the inspector to say what it is. */
async function selectEdge(page: Page, edge: string, title: string, fraction = 0.5): Promise<void> {
  const at = await page
    .locator(`[data-edge="${edge}"] path.f-connection-path`)
    .evaluate((path: SVGPathElement, along: number) => {
      const point = path.getPointAtLength(path.getTotalLength() * along);
      const matrix = path.getScreenCTM()!;
      return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f };
    }, fraction);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('inspector-title')).toHaveText(title);
}

/** A canvas with a producer and nothing else, which has nothing to be linked to. */
const LONE_PRODUCER = buildDocument([{ type: 'add-producer', name: 'sender' }]);

/** A producer linked to a queue, and a second queue, which is what the default exchange draws an implicit binding to. */
const PRODUCER_TO_QUEUE = buildDocument([
  { type: 'add-producer', name: 'sender' },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'declare-queue', name: 'archive', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'billing' } },
]);

/** Names that fill a node (30 characters) and a name that is cut (48), on a producer, an exchange, a queue and a consumer that are linked (ADR-0093). */
const LONG_NAMES = buildDocument([
  { type: 'add-producer', name: 'orders-events-eu-west-payments' },
  {
    type: 'declare-exchange',
    name: 'orders-events-eu-west-payments-fanout',
    exchangeType: 'fanout',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  { type: 'declare-queue', name: 'orders-events-eu-west-payments-and-the-retries', durable: true },
  { type: 'add-consumer', name: 'orders-events-eu-west-payments-worker' },
]);

const states: readonly {
  readonly name: string;
  /** The canvas that the state is on, which is the one with a node of each kind unless it says another. */
  readonly document?: CanvasDocument;
  /** How many edges the canvas draws, when it is not the usual one. */
  readonly edges?: number;
  readonly enter: (page: Page, editor: EditorPage) => Promise<void>;
}[] = [
  { name: 'with nothing selected', enter: async () => undefined },
  {
    name: 'with names that fill a node and a name that is cut',
    document: LONG_NAMES,
    edges: 0,
    enter: async (_, editor) => {
      await expect(editor.node('Queue orders-events-eu-west-payments-and-the-retries')).toBeVisible();
    },
  },
  { name: 'with a producer selected', enter: (_, editor) => editor.select('Producer sender') },
  { name: 'with an exchange selected', enter: (_, editor) => editor.select('Exchange orders, topic') },
  { name: 'with an internal exchange selected', enter: (_, editor) => editor.select('Exchange hidden, fanout') },
  { name: 'with a queue selected', enter: (_, editor) => editor.select('Queue billing') },
  { name: 'with a consumer selected', enter: (_, editor) => editor.select('Consumer worker') },
  {
    name: 'with an edge selected',
    enter: (page) => selectEdge(page, 'x1>q1', 'Binding'),
  },
  {
    name: 'with a link from a producer selected, and the button that changes its target',
    enter: async (page) => {
      await selectEdge(page, 'p1>x1', 'Link from a producer');
      await expect(page.getByTestId('change-target')).toBeVisible();
    },
  },
  {
    name: 'with a subscription selected',
    enter: (page) => selectEdge(page, 'q1>c1', 'Subscription'),
  },
  {
    name: 'with the implicit binding of the default exchange selected',
    document: PRODUCER_TO_QUEUE,
    edges: 1,
    enter: async (page) => {
      await page.getByRole('switch', { name: 'Default exchange' }).click();
      await expect.poll(() => page.evaluate(() => [...(window.__rmq?.drawnEdges() ?? [])])).toContain('~default>q1');
      // Near its target, where it is apart from the others that start at the same exchange.
      await selectEdge(page, '~default>q1', 'Implicit binding', 0.8);
    },
  },
  {
    name: 'with everything selected',
    enter: async (page, editor) => {
      await editor.select('Queue billing');
      await page.keyboard.press('Control+a');
      await expect(page.getByTestId('inspector-title')).toHaveText(/^[0-9]+ items selected$/);
    },
  },
  {
    name: 'with a refusal shown under the durable switch',
    enter: async (page, editor) => {
      await editor.select('Queue billing');
      await page.getByRole('switch', { name: 'Durable' }).click();
      await expect(page.getByTestId('durable-problem')).toBeVisible();
    },
  },
  {
    name: 'with a refusal shown under a name',
    enter: async (page, editor) => {
      await editor.select('Queue billing');
      const name = page.getByRole('textbox', { name: 'Name' });
      // A name that begins with amq. is the broker's own (ADR-0008), so it is refused for its name.
      await name.fill('amq.billing');
      await name.press('Tab');
      await expect(page.getByTestId('refusal')).toBeVisible();
    },
  },
  {
    name: 'with the help of a field open',
    enter: async (page, editor) => {
      await editor.select('Exchange orders, topic');
      await page.getByRole('button', { name: 'Help: Type' }).click();
      await expect(page.getByRole('button', { name: 'Help: Type' })).toHaveAttribute('aria-expanded', 'true');
    },
  },
  {
    name: 'with the context menu of a node open',
    enter: async (page, editor) => {
      const at = await editor.centre(editor.node('Queue billing'));
      await page.mouse.click(at.x, at.y, { button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'with the field that renames a node open',
    enter: async (page, editor) => {
      await editor.select('Queue billing');
      await page.keyboard.press('F2');
      await expect(page.getByRole('textbox', { name: 'Rename queue billing' })).toBeFocused();
    },
  },
  {
    name: 'with the field that renames a node open and a name refused',
    enter: async (page, editor) => {
      await editor.select('Queue billing');
      await editor.renameSelected('Queue billing', 'amq.billing');
      await expect(page.getByTestId('rename-field')).toHaveAttribute('aria-invalid', 'true');
    },
  },
  {
    name: 'with the link of a node being chosen from the keyboard',
    enter: async (page, editor) => {
      await editor.select('Exchange orders, topic');
      await page.keyboard.press('l');
      await expect(page.locator('body > [role="status"][aria-live="polite"]')).toHaveText(
        /^(Linking from|Target \d+ of \d+)/,
      );
    },
  },
  {
    name: 'with the command bar open',
    enter: (_, editor) => editor.openCommandBar(),
  },
  {
    name: 'with the command bar listing what could be typed',
    enter: async (page, editor) => {
      await editor.openCommandBar();
      await page.keyboard.type('bind ');
      await expect(page.getByRole('listbox', { name: 'Completions' })).toBeVisible();
    },
  },
  {
    name: 'with a line that the command bar could not read, and what was meant',
    enter: async (page, editor) => {
      await editor.openCommandBar();
      await editor.runCommand('bnd orders -> billing');
      await expect(page.getByRole('group', { name: 'Did you mean' })).toBeVisible();
    },
  },
  {
    name: 'with a refusal in the command bar, and the broker answer after it',
    enter: async (page, editor) => {
      await editor.openCommandBar();
      await editor.runCommand('declare exchange amq.mine type=direct');
      await expect(page.getByTestId('command-answer').getByTestId('refusal-reply')).toBeVisible();
    },
  },
  {
    name: 'with the help of the command bar shown',
    enter: async (page, editor) => {
      await editor.openCommandBar();
      await editor.runCommand('help bind');
      await expect(page.getByRole('region', { name: 'Help: bind' })).toBeVisible();
    },
  },
  {
    name: 'with the cheat-sheet open',
    enter: async (page, editor) => {
      await editor.flow.focus();
      await page.keyboard.press('Shift+?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts and commands' })).toBeVisible();
    },
  },
  {
    name: 'with the picker of "Link to…" open',
    enter: async (page, editor) => {
      await editor.select('Exchange orders, topic');
      await page.getByRole('button', { name: 'Link exchange orders to…' }).click();
      await expect(page.getByRole('dialog', { name: 'Link exchange orders to…' })).toBeVisible();
    },
  },
  {
    name: 'with the picker of "Link to…" open and nothing that matches what was typed',
    enter: async (page, editor) => {
      await editor.select('Exchange orders, topic');
      await page.getByRole('button', { name: 'Link exchange orders to…' }).click();
      const picker = page.getByRole('dialog', { name: 'Link exchange orders to…' });
      await picker.getByRole('combobox', { name: 'Search the targets' }).fill('zzz');
      await expect(picker.getByTestId('picker-nothing')).toBeVisible();
    },
  },
  {
    name: 'with the picker of "Link to…" open and the reason that there is nothing to link to',
    document: LONE_PRODUCER,
    edges: 0,
    enter: async (page, editor) => {
      await editor.select('Producer sender');
      await page.getByRole('button', { name: 'Link producer sender to…' }).click();
      await expect(page.getByTestId('picker-reason')).toBeVisible();
    },
  },
  {
    name: 'with the key of a binding being asked',
    enter: async (page, editor) => {
      await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
      await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    },
  },
  {
    name: 'with the key of a binding refused under its field',
    enter: async (page, editor) => {
      await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
      await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
      await page.keyboard.type('#.#.#');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('group', { name: /^Binding key from/ }).getByTestId('refusal-message')).toBeVisible();
    },
  },
  {
    name: 'with the menu of what a link that was let go on nothing can make',
    enter: async (page, editor) => {
      const flow = (await editor.flow.boundingBox())!;
      await editor.dragLinkTo('x1', { x: flow.x + flow.width / 2, y: flow.y + flow.height - 40 });
      await expect(page.getByRole('menu', { name: /Create and link from/ })).toBeVisible();
    },
  },
  {
    name: 'with the card of a label that has more keys than it shows',
    enter: async (page, editor) => {
      await editor.openCommandBar();
      for (const key of ['a', 'b', 'c', 'd']) {
        await editor.runCommand(`bind orders -> billing key=${key}`);
      }
      await page.keyboard.press('Escape');
      await page.locator('[data-label="x1>q1"]').hover();
      await expect(page.getByTestId('label-card')).toBeVisible();
    },
  },
  {
    name: 'with the default exchange shown and selected',
    enter: async (page, editor) => {
      await page.getByRole('switch', { name: 'Default exchange' }).click();
      await editor.select('Default exchange');
      await expect(page.getByTestId('inspector-title')).toHaveText('Default exchange');
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the editor in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const state of states) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const editor = await open(page, state.document, state.edges);
        await state.enter(page, editor);

        await expectNoAxeViolations(page);
      });
    }

    test('really is in the theme that it is tested in, so that the checks above are of this theme', async ({
      page,
    }) => {
      await open(page);

      const isDark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
      expect(isDark).toBe(colorScheme === 'dark');
      const background = await page
        .locator('rmq-editor > div')
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background).toBe(colorScheme === 'dark' ? 'rgb(11, 16, 32)' : 'rgb(255, 255, 255)');
    });
  });
}
