import { ExplainPage } from './pages/explain-page';
import { expectNoAxeViolations } from './support/axe';
import { WITH_ARCHIVE } from './support/orders';
import { expect, test } from './support/test';

/**
 * Accessibility of what the explanation puts on the screen (ADR-0061, ADR-0062), in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best
 * practices, in each new state, with no rule switched off. A state is the log open and empty, with a few rows, full, filtered and filtered to nothing; a row chosen; the Why? of a message on the
 * canvas, with a binding that missed and its reason on its label; and a queue asked about.
 */

const states: readonly {
  readonly name: string;
  readonly enter: (explain: ExplainPage) => Promise<void>;
  /** Whether the clock is left alone, so that the log has nothing in it. */
  readonly fresh?: boolean;
}[] = [
  {
    name: 'with the event log open and nothing in it',
    fresh: true,
    enter: async (explain) => {
      await explain.openByKey();
      await expect(explain.log.getByTestId('event-log-empty')).toBeVisible();
    },
  },
  {
    name: 'with the event log open and a few events in it',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step(2);
      await explain.openByKey();
      await expect(explain.rows).toHaveCount(8);
    },
  },
  {
    name: 'with the event log full, and the note of what it dropped',
    enter: async (explain) => {
      await explain.editor.openCommandBar();
      await explain.editor.runCommand('set sender burst=1000');
      await explain.page.keyboard.press('Escape');
      await explain.openByKey();
      for (let times = 0; times < 6; times += 1) {
        await explain.publish();
      }
      await expect(explain.log.getByTestId('event-log-dropped')).toBeVisible();
    },
  },
  {
    name: 'with the event log filtered to one kind of event',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step(2);
      await explain.openByKey();
      await explain.log.getByRole('button', { name: 'Commands' }).click();
      await explain.log.getByRole('button', { name: 'Publishing' }).click();
      await expect(explain.log.getByTestId('event-log-count')).toContainText('Showing');
    },
  },
  {
    name: 'with the event log filtered to nothing',
    enter: async (explain) => {
      await explain.publish();
      await explain.openByKey();
      await explain.log.getByLabel('Search').fill('no such sentence');
      await expect(explain.log.getByTestId('event-log-empty')).toContainText('No event matches the filters.');
    },
  },
  {
    name: 'with a row of the event log chosen, and what it is about lit on the canvas',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.openByKey();
      await explain.rowsOfKind('routed').click();
      await expect(explain.card).toHaveAttribute('data-source', 'row');
      await expect.poll(() => explain.nodeMark('q1')).toBe('reached');
    },
  },
  {
    name: 'with the Why? of a message on the canvas, a binding that missed and its reason on its label',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await expect(explain.card).toBeVisible();
      await expect.poll(() => explain.reasonOn('x1>q2')).toMatch(/^✗ /);
      // The lit look is reached by a transition of a tenth of a second, and axe reads the colours that the page has at the moment.
      await expect
        .poll(async () => (await explain.edgeLook('x1>q1')).stroke)
        .toBe(await explain.tokenColour('--rmq-explain-hit'));
    },
  },
  {
    name: 'with the Why? of a message on the canvas and the event log open beside it',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step(2);
      await explain.openByKey();
      await expect(explain.card).toBeVisible();
    },
  },
  {
    name: 'with a queue that did not get the message asked about',
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.editor.select('Queue archive');
      await expect(explain.card).toHaveAttribute('data-source', 'queue');
      await expect.poll(() => explain.nodeMark('q2')).toBe('asked');
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the explanation in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const state of states) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const explain = await ExplainPage.open(page, WITH_ARCHIVE, { stop: state.fresh !== true });
        await state.enter(explain);

        await expectNoAxeViolations(page);
      });
    }

    test('really is in the theme that it is tested in, so that the checks above are of this theme', async ({
      page,
    }) => {
      const explain = await ExplainPage.open(page, WITH_ARCHIVE);
      await explain.publish();
      await explain.simulation.step();
      await expect(explain.card).toBeVisible();

      const isDark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
      expect(isDark).toBe(colorScheme === 'dark');
      // What is lit is lit in the colour of this theme.
      expect(await explain.tokenColour('--rmq-explain-hit')).toBe(
        colorScheme === 'dark' ? 'rgb(110, 231, 183)' : 'rgb(4, 120, 87)',
      );
      await expect
        .poll(async () => (await explain.edgeLook('x1>q1')).stroke)
        .toBe(colorScheme === 'dark' ? 'rgb(110, 231, 183)' : 'rgb(4, 120, 87)');
    });
  });
}
