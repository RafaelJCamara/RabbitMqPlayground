import type { CanvasDocument } from '@rmq/domain';
import { HeadersPage } from './pages/headers-page';
import { expectNoAxeViolations } from './support/axe';
import {
  DIRECT_WITH_HEADERS,
  FILES,
  FILES_BOUND,
  FILES_TWICE,
  FILES_UNBOUND,
  FILES_WITH_X,
  MANY_CONDITIONS,
  NUMBERS,
} from './support/headers';
import { expect, test } from './support/test';

/**
 * Accessibility of what S8 puts on the screen, in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best practices, in each new state, with no rule switched off.
 * A state is a popover with its rows empty, typed, with what is wrong with them and with what to know about them; the editor of a binding in the inspector; the chip, its card and the label of an edge; the table
 * of a producer's headers; the table of recent messages, empty and full; and the panel that makes a binding from a message, in each thing that it says.
 */

const CONDITIONS = 'editor';
const LIGHT_ACCENT = 'rgb(29, 78, 216)';
const DARK_ACCENT = 'rgb(147, 197, 253)';
const PRODUCER = 'editor,simulation';
const MESSAGES = 'editor,simulation,explain';

interface State {
  readonly name: string;
  readonly flags: string;
  readonly document: CanvasDocument;
  readonly enter: (headers: HeadersPage) => Promise<void>;
}

/** Draws the link from the headers exchange `files` to the queue `pdfs`, which opens the popover that asks for the conditions. */
async function askForConditions(headers: HeadersPage) {
  const { editor } = headers;
  await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
  const popover = headers.popover('exchange files', 'queue pdfs');
  await expect(popover.name(1)).toBeFocused();
  return popover;
}

/** Publishes a message from the producer and runs everything that happens to it, with the selection where it was. */
async function sendOne(headers: HeadersPage): Promise<void> {
  await headers.editor.openCommandBar();
  await headers.editor.runCommand('publish sender');
  await headers.page.keyboard.press('Escape');
  await headers.simulation.stepThrough();
}

const states: readonly State[] = [
  {
    name: 'with the popover that asks for conditions, empty',
    flags: CONDITIONS,
    document: FILES,
    enter: async (headers) => {
      await askForConditions(headers);
    },
  },
  {
    name: 'with the popover and a row of each type, the mode all-with-x and the sentence of what it asks',
    flags: CONDITIONS,
    document: FILES,
    enter: async (headers) => {
      const popover = await askForConditions(headers);
      await popover.fill(1, 'format', 'pdf');
      await popover.append('size', '10');
      await popover.append('ratio', '1.5');
      await popover.append('big', 'true');
      await popover.append('author');
      await popover.type(5).selectOption('exists');
      await popover.choose('all-with-x');
      await expect(popover.exportNote).toBeVisible();
      await expect(popover.line).toBeVisible();
    },
  },
  {
    name: 'with the popover saying what is wrong with its rows: a value that is missing, a name that is there twice, and x-match as a name',
    flags: CONDITIONS,
    document: FILES,
    enter: async (headers) => {
      const popover = await askForConditions(headers);
      await popover.fill(1, 'format');
      await popover.append('format', 'tiff');
      await popover.append('x-match', 'any');
      await popover.submit.click();
      await expect(popover.problem(1, 'value')).toBeVisible();
      await expect(popover.problem(2, 'key')).toBeVisible();
      await expect(popover.problem(3, 'key')).toBeVisible();
    },
  },
  {
    name: 'with the popover refusing a type that the text cannot have, under its row',
    flags: CONDITIONS,
    document: FILES,
    enter: async (headers) => {
      const popover = await askForConditions(headers);
      await popover.fill(1, 'big', 'true');
      await popover.type(1).selectOption('integer');
      await expect(popover.problem(1, 'type')).toBeVisible();
    },
  },
  {
    name: 'with the popover telling that an x- name is not counted and what the lint says of it',
    flags: CONDITIONS,
    document: FILES,
    enter: async (headers) => {
      const popover = await askForConditions(headers);
      await popover.choose('any');
      await popover.fill(1, 'x-region', 'eu');
      await expect(popover.notes(1)).toBeVisible();
      await expect(popover.lint).toBeVisible();
    },
  },
  {
    name: 'with the editor of a binding in the inspector',
    flags: CONDITIONS,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.selectBinding('x1>q1');
      await expect(headers.conditions().scope).toBeVisible();
    },
  },
  {
    name: 'with the editor of a binding in the inspector, changed and not applied, and what is wrong with it',
    flags: CONDITIONS,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.selectBinding('x1>q1');
      const conditions = headers.conditions();
      await conditions.choose('any-with-x');
      await conditions.append('x-region', 'eu');
      await conditions.fill(2, 'format', 'tiff');
      await conditions.submit.click();
      await expect(conditions.problem(2, 'key')).toBeVisible();
    },
  },
  {
    name: 'with the editors of the two bindings of an edge, one above the other',
    flags: CONDITIONS,
    document: FILES_TWICE,
    enter: async (headers) => {
      await headers.selectBinding('x1>q1');
      await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(2);
    },
  },
  {
    name: 'with the chips of two bindings on the canvas, which go on to more lines, and one that is not counted',
    flags: CONDITIONS,
    document: MANY_CONDITIONS,
    enter: async (headers) => {
      await expect(headers.chips('x1>q1')).toHaveCount(1);
      await expect(headers.chips('x1>q2')).toContainText('(ignored)');
    },
  },
  {
    name: 'with the card of a chip, listing every condition, while the pointer is over its label',
    flags: CONDITIONS,
    document: MANY_CONDITIONS,
    enter: async (headers) => {
      await headers.label('x1>q1').hover();
      await expect(headers.labelCard).toBeVisible();
    },
  },
  {
    name: 'with the table of the headers of a producer, and the note under its routing key',
    flags: PRODUCER,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.editor.select('Producer sender');
      await expect(headers.table.rows).toHaveCount(2);
      await expect(headers.composer.getByTestId('composer-key-note')).toBeVisible();
    },
  },
  {
    name: 'with the table of the headers of a producer saying what is wrong with two of its rows',
    flags: PRODUCER,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.editor.select('Producer sender');
      await headers.table.append('format', 'tiff');
      await headers.table.add.click();
      await headers.table.name(4).fill('size');
      await expect(headers.table.problem(1, 'key')).toBeVisible();
      await expect(headers.table.problem(4, 'value')).toBeVisible();
    },
  },
  {
    name: 'with the table of recent messages in the editor of a binding, with no message yet',
    flags: MESSAGES,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.selectBinding('x1>q1');
      await expect(headers.conditions().live.empty).toBeVisible();
    },
  },
  {
    name: 'with the table of recent messages in the editor of a binding, a message that holds and one that differs',
    flags: MESSAGES,
    document: FILES_BOUND,
    enter: async (headers) => {
      await headers.selectBinding('x1>q2');
      await sendOne(headers);
      await headers.editor.openCommandBar();
      await headers.editor.runCommand('set sender header:dpi=300');
      await headers.editor.runCommand('unset sender header:format');
      await headers.page.keyboard.press('Escape');
      await sendOne(headers);
      await expect(headers.conditions().live.rows).toHaveCount(2);
    },
  },
  {
    name: 'with the table of recent messages in the popover that asks for conditions',
    flags: MESSAGES,
    document: FILES_UNBOUND,
    enter: async (headers) => {
      await headers.openLastMessage('unroutable');
      const popover = await askForConditions(headers);
      await popover.fill(1, 'format', 'tiff');
      await expect(popover.live.rows).toHaveCount(1);
    },
  },
  {
    name: 'with "Bind from this message" open, the headers of the message ticked and the line that it makes',
    flags: MESSAGES,
    document: FILES_UNBOUND,
    enter: async (headers) => {
      await headers.openLastMessage('unroutable');
      await headers.bind.show();
      await expect(headers.bind.line).toBeVisible();
      await expect(headers.bind.live.rows).toHaveCount(1);
    },
  },
  {
    name: 'with "Bind from this message" open and an x- header and x-match among the headers',
    flags: MESSAGES,
    document: FILES_WITH_X,
    enter: async (headers) => {
      await headers.openLastMessage('unroutable');
      await headers.bind.show();
      await headers.bind.tick('format').uncheck();
      await expect(headers.bind.reserved).toBeVisible();
      await expect(headers.bind.notes).toBeVisible();
    },
  },
  {
    name: 'with "Bind from this message" open for a message that has no headers',
    flags: MESSAGES,
    document: NUMBERS,
    enter: async (headers) => {
      await headers.openLastMessage('unroutable');
      await headers.bind.show();
      await expect(headers.bind.noHeaders).toBeVisible();
    },
  },
  {
    name: 'with "Bind from this message" open on a canvas that has no headers exchange',
    flags: MESSAGES,
    document: DIRECT_WITH_HEADERS,
    enter: async (headers) => {
      await headers.openLastMessage('routed');
      await headers.bind.show();
      await expect(headers.bind.noExchange).toBeVisible();
    },
  },
  {
    name: 'with the binding that "Bind from this message" made selected, and its editor in the inspector',
    flags: MESSAGES,
    document: FILES_UNBOUND,
    enter: async (headers) => {
      await headers.openLastMessage('unroutable');
      await headers.bind.show();
      await headers.bind.create.click();
      await expect(headers.conditions().scope).toBeVisible();
      await expect(headers.conditions().live.rows).toHaveCount(1);
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the conditions of a headers binding in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const state of states) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const headers = await HeadersPage.open(page, state.document, { flags: state.flags });
        await state.enter(headers);

        await expectNoAxeViolations(page);
      });
    }

    test('really is in the theme that it is tested in, so that the checks above are of this theme', async ({
      page,
    }) => {
      const headers = await HeadersPage.open(page, FILES_BOUND, { flags: CONDITIONS });
      await headers.selectBinding('x1>q1');

      const isDark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

      expect(isDark).toBe(colorScheme === 'dark');
      // The segment that says which mode is chosen is the accent of this theme, whose value is not the other one's, and its words are the colour for words on it.
      const chosen = headers.conditions().modes.locator('input:checked + span');
      const accent = await headers.tokenColour('--rmq-accent');
      await expect(chosen).toHaveCSS('background-color', accent);
      await expect(chosen).toHaveCSS('color', await headers.tokenColour('--rmq-accent-fg'));
      expect(accent).toBe(colorScheme === 'dark' ? DARK_ACCENT : LIGHT_ACCENT);
    });
  });
}
