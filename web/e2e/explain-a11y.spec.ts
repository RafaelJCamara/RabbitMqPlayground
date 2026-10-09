import { ExplainPage } from './pages/explain-page';
import { TesterPage } from './pages/tester-page';
import { expectNoAxeViolations } from './support/axe';
import type { CanvasDocument } from '@rmq/domain';
import { HEADERS, TOPICS, UNLINKED, WITH_ARCHIVE } from './support/orders';
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
  /** The canvas that the state is on, which is the one with a queue that is missed unless it says another. */
  readonly document?: CanvasDocument;
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
    name: 'with a message open, its route laid out word by word, and the queue that did not get it',
    document: TOPICS,
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.openByKey();
      await explain.openFromRow('routed');
      await expect(
        explain.message.getByRole('table', { name: 'The pattern and the key, word by word' }).first(),
      ).toBeVisible();
    },
  },
  {
    name: 'with a message open, and the conditions of a headers binding, each held or not',
    document: HEADERS,
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.openByKey();
      await explain.openFromRow('routed');
      await expect(explain.message.getByTestId('header-conditions').first()).toBeVisible();
      await expect(explain.message.getByTestId('message-headers')).toBeVisible();
    },
  },
  {
    name: 'with a message open, and the reasons that a queue did not get it',
    document: TOPICS,
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.openByKey();
      await explain.openFromRow('routed');
      await explain.message.getByRole('button', { name: 'Why didn’t it get to warnings?' }).click();
      await expect(explain.message.getByTestId('why-not-reasons')).toBeVisible();
    },
  },
  {
    name: 'with a message that has not got to the broker open, and what would happen to it',
    document: TOPICS,
    enter: async (explain) => {
      await explain.publish();
      await explain.openByKey();
      await explain.openFromRow('published');
      await expect(explain.message.getByTestId('message-basis')).toBeVisible();
    },
  },
  {
    name: 'with a message open and a queue selected, whose inspector says why it did not get the message',
    document: TOPICS,
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step();
      await explain.openByKey();
      await explain.openFromRow('routed');
      await explain.editor.select('Queue warnings');
      await expect(explain.page.getByTestId('queue-asked')).toBeVisible();
    },
  },
  {
    name: 'with the messages of a queue as buttons, and one of them open',
    document: TOPICS,
    enter: async (explain) => {
      await explain.publish();
      await explain.simulation.step(2);
      await explain.editor.select('Queue errors');
      await explain.page.getByTestId('open-message').click();
      await expect(explain.message).toBeVisible();
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

/**
 * The testers (ADR-0064), which need the flag `explain` and not the simulation, so they are opened without it unless a state says that it has the log beside it: the what-if tester shut, open, with
 * an answer that lights the canvas and puts a card in it, with an answer that says that nothing would get the message, with its route open, with a message that cannot be read and with headers; the
 * topic tester in the popover that asks for a key, empty, with keys that match and keys that do not, and with a key that cannot be one; and under the key field of a binding in the inspector.
 */
const testerStates: readonly {
  readonly name: string;
  readonly enter: (tester: TesterPage) => Promise<void>;
  readonly document?: CanvasDocument;
  /** The feature flags, as the address says them: the explanation alone unless a state says more. */
  readonly flags?: string;
}[] = [
  {
    name: 'with the what-if tester shut',
    enter: async (tester) => {
      await expect(tester.toggle).toHaveAttribute('aria-expanded', 'false');
    },
  },
  {
    name: 'with the what-if tester open and nothing written in it',
    enter: async (tester) => {
      await tester.show();
    },
  },
  {
    name: 'with the what-if tester saying which queue would get a message, the canvas lit and its card in it',
    enter: async (tester) => {
      await tester.ask('key=order.new', 'orders (direct)');
      await expect(tester.card).toBeVisible();
      await expect.poll(() => tester.reasonOn('x1>q2')).toMatch(/^✗ /);
      // The lit look is reached by a transition of a tenth of a second, and axe reads the colours that the page has at the moment.
      await expect
        .poll(async () => (await tester.edgeLook('x1>q1')).stroke)
        .toBe(await tester.tokenColour('--rmq-explain-hit'));
    },
  },
  {
    name: 'with the what-if tester saying that no queue would get the message',
    enter: async (tester) => {
      await tester.ask('key=nobody.wants.this', 'orders (direct)');
      await expect(tester.answer).toHaveText('No queue would get it.');
      await expect(tester.card).toBeVisible();
    },
  },
  {
    name: 'with the what-if tester and the route of its answer open',
    enter: async (tester) => {
      await tester.ask('key=order.new', 'orders (direct)');
      await tester.route.getByText('The route').click();
      await expect(tester.route.getByTestId('route-summary')).toBeVisible();
    },
  },
  {
    name: 'with the what-if tester saying that a message cannot be read',
    enter: async (tester) => {
      await tester.ask('keyy=order.new', 'orders (direct)');
      await expect(tester.problem).toBeVisible();
    },
  },
  {
    name: 'with the what-if tester answering a message with headers, and the route of a headers exchange open',
    document: HEADERS,
    enter: async (tester) => {
      await tester.ask('header:format=pdf header:big=false', 'files (headers)');
      await tester.route.getByText('The route').click();
      await expect(tester.route.getByTestId('header-conditions').first()).toBeVisible();
    },
  },
  {
    name: 'with the what-if tester answering, and the event log open beside it, with the simulation on',
    flags: 'editor',
    enter: async (tester) => {
      await tester.ask('key=order.new', 'orders (direct)');
      await tester.editor.flow.focus();
      await tester.page.keyboard.press('e');
      await expect(tester.page.getByRole('region', { name: 'Event log' })).toBeVisible();
      await expect(tester.card).toBeVisible();
    },
  },
  {
    name: 'with the topic tester in the popover that asks for a key, inviting one to be typed',
    document: UNLINKED,
    enter: async (tester) => {
      await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));
      await expect(tester.topicTester.getByTestId('topic-tester-empty')).toBeVisible();
    },
  },
  {
    name: 'with the topic tester in the popover listing the keys that a key matches and the keys that it does not',
    document: UNLINKED,
    enter: async (tester) => {
      await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));
      await expect(tester.page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
      await tester.page.keyboard.type('*.error');
      await expect(tester.topicTester.getByTestId('topic-missing')).toBeVisible();
      await expect(tester.topicTester.getByTestId('topic-note')).toBeVisible();
    },
  },
  {
    name: 'with the topic tester in the popover saying that a key cannot be a binding key',
    document: UNLINKED,
    enter: async (tester) => {
      await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));
      await expect(tester.page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
      await tester.page.keyboard.type('a.#.b.#.c.#');
      await expect(tester.topicTester.getByTestId('topic-tester-refusal')).toBeVisible();
    },
  },
  {
    name: 'with the topic tester and the refusal of the binding together, under the field of the popover',
    document: UNLINKED,
    enter: async (tester) => {
      await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));
      await expect(tester.page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
      await tester.page.keyboard.type('a.#.b.#.c.#');
      await tester.page.keyboard.press('Enter');
      await expect(tester.keyPopover('exchange logs', 'queue errors').getByTestId('refusal-message')).toBeVisible();
    },
  },
  {
    name: 'with the topic tester under the key field of a binding in the inspector, with keys that match and keys that do not',
    document: TOPICS,
    enter: async (tester) => {
      await tester.selectBinding('x1>q1');
      await tester.page.getByRole('group', { name: 'Binding 1 of 1' }).getByRole('textbox', { name: 'Key' }).click();
      await expect(tester.topicTester.getByTestId('topic-missing')).toBeVisible();
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the explanation in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const state of states) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const explain = await ExplainPage.open(page, state.document ?? WITH_ARCHIVE, { stop: state.fresh !== true });
        await state.enter(explain);

        await expectNoAxeViolations(page);
      });
    }

    for (const state of testerStates) {
      test(`has no axe violations ${state.name}`, async ({ page }) => {
        const tester = await TesterPage.open(page, state.document ?? WITH_ARCHIVE, {
          ...(state.flags === undefined ? {} : { flags: state.flags }),
        });
        await state.enter(tester);

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
