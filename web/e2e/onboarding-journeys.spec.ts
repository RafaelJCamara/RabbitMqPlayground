import type { Page } from '@playwright/test';
import { OnboardingPage, ONBOARDING_PATH } from './pages/onboarding-page';
import { seedLibrary } from './support/seed';
import { expect, test } from './support/test';

/**
 * Journey 11 of the plan: onboarding (ADR-0081 to ADR-0083). A learner who has nothing is asked what to start with, and a template opens as a canvas that routes as the tutorial says; the tour
 * is taken on a canvas of its own and is ticked off by whichever way the learner links.
 */

/** Each template, and where a message goes when its producers publish once: how many copies come into each queue (ADR-0081). */
const PLAYS = [
  { name: 'Hello World', producers: ['sender'], enqueued: { hello: 1 } },
  { name: 'Work Queues', producers: ['dispatcher'], enqueued: { tasks: 6 } },
  { name: 'Pub/Sub', producers: ['emitter'], enqueued: { 'to-file': 1, 'to-screen': 1 } },
  { name: 'Routing', producers: ['app-errors', 'app-info'], enqueued: { errors: 1, everything: 2 } },
  { name: 'Topics', producers: ['zoo'], enqueued: { orange: 1, rabbits: 1 } },
  { name: 'Headers routing', producers: ['scanner'], enqueued: { 'pdf-reports': 1, flagged: 1 } },
] as const;

test.describe('journey 11: the first run and the templates', () => {
  test('asks what to start with before it makes a canvas, over the empty home, and the question welcomes and lists the six', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);

    await onboarding.firstRun();

    await expect(onboarding.dialog).toHaveAccessibleName('Welcome to RabbitMQ Playground');
    await expect(onboarding.dialog.getByRole('list', { name: 'Templates' }).getByRole('button')).toHaveText([
      /^Hello World/,
      /^Work Queues/,
      /^Pub\/Sub/,
      /^Routing/,
      /^Topics/,
      /^Headers routing/,
    ]);
    await expect(onboarding.scratch).toBeVisible();
    await expect(onboarding.tour).toBeVisible();
    await expect(onboarding.cancel).toHaveCount(0);
    // The dialog is modal, so the home behind it is hidden from the roles of the page; its words are not.
    await expect(page.getByTestId('home-empty')).toBeVisible();
    expect(await onboarding.canvases.stored(), 'nothing is made until it is answered').toEqual([]);
  });

  test('puts the cursor in the question, on the first template', async ({ page }) => {
    const onboarding = new OnboardingPage(page);

    await onboarding.firstRun();

    await expect(onboarding.template('Hello World')).toBeFocused();
  });

  for (const play of PLAYS) {
    test(`opens ${play.name} as a canvas of its own, and the message goes where the tutorial says`, async ({
      page,
    }) => {
      const onboarding = new OnboardingPage(page);
      await onboarding.firstRun();

      await onboarding.choose(play.name);

      expect(await onboarding.canvases.tabs()).toEqual(['My canvases', play.name]);
      expect(await onboarding.canvases.stored()).toEqual([play.name]);
      await expect(onboarding.canvases.notices.getByTestId('toast-message')).toContainText(`Opened “${play.name}”.`);
      const enqueued = await onboarding.play(play.producers);
      for (const queue of Object.keys(enqueued)) {
        expect(enqueued[queue], `the copies that came into ${queue}`).toBe(
          (play.enqueued as Record<string, number>)[queue] ?? 0,
        );
      }
      expect(Object.keys(enqueued).sort()).toEqual(Object.keys(play.enqueued).sort());
    });
  }

  test('builds from scratch, as it always did: a blank canvas called Untitled canvas, and no notice', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();

    await onboarding.scratch.click();
    await onboarding.canvases.editorReady();

    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Untitled canvas']);
    await expect(page.getByTestId('canvas-empty')).toBeVisible();
    await expect(onboarding.banner).toHaveCount(0);
  });

  test('means building from scratch when it is left with Escape, so that nobody is left without a canvas', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();

    await page.keyboard.press('Escape');
    await onboarding.canvases.editorReady();

    expect(await onboarding.canvases.stored()).toEqual(['Untitled canvas']);
    await expect(onboarding.dialog).toHaveCount(0);
  });

  test('does not ask a learner who has a canvas', async ({ page }) => {
    await seedLibrary(page, [{ id: 'mine', name: 'Mine' }]);
    const onboarding = new OnboardingPage(page);

    await onboarding.canvases.goto(ONBOARDING_PATH);
    await expect(onboarding.dialog).toHaveCount(0);
    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Mine']);
  });

  test('asks again from the home, with a way to say never mind, and a template there is one more canvas', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.scratch.click();
    await onboarding.canvases.editorReady();
    await onboarding.canvases.showHome();

    await onboarding.more.click();
    await expect(onboarding.dialog).toHaveAccessibleName('New canvas from a template');
    await expect(onboarding.cancel).toBeVisible();
    await onboarding.cancel.click();
    await expect(onboarding.dialog).toHaveCount(0);
    await expect(onboarding.more).toBeFocused();
    expect(await onboarding.canvases.stored(), 'never mind makes nothing').toEqual(['Untitled canvas']);

    await onboarding.more.click();
    await onboarding.choose('Topics');

    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Untitled canvas', 'Topics']);
    expect(await onboarding.canvases.stored()).toEqual(['Topics', 'Untitled canvas']);
  });

  test('gives a template that is opened again a name that nobody has', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.choose('Routing');
    await onboarding.canvases.showHome();

    await onboarding.more.click();
    await onboarding.choose('Routing');

    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Routing', 'Routing 2']);
  });

  test('keeps the template where the learner changed it: a reload brings back what they did', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.choose('Hello World');
    await onboarding.editor.add('Queue');
    await expect(onboarding.editor.saveState).toHaveText('All changes saved');

    await page.reload();
    await onboarding.canvases.editorReady();

    await expect(onboarding.dialog).toHaveCount(0);
    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Hello World']);
    await expect(onboarding.editor.node('Queue queue1')).toBeVisible();
  });
});

/** The ways to link a producer to an exchange that the tour takes, each ending in the same command (ADR-0041, ADR-0083). */
const WAYS: readonly [string, (page: Page, onboarding: OnboardingPage) => Promise<void>][] = [
  [
    'dragging from the dot of a node',
    async (_page, onboarding) => {
      const { editor } = onboarding;
      const from = await onboarding.idOf('Producer producer1');
      const to = await onboarding.idOf('Exchange exchange1');
      await editor.dragLinkTo(from, await editor.centre(editor.nodeById(to)));
    },
  ],
  [
    'clicking the dot and then the target',
    async (page, onboarding) => {
      const { editor } = onboarding;
      const out = await editor.centre(editor.handle(await onboarding.idOf('Producer producer1'), 'out'));
      await page.mouse.click(out.x, out.y);
      const target = await editor.centre(editor.handle(await onboarding.idOf('Exchange exchange1'), 'in'));
      await page.mouse.move(target.x, target.y, { steps: 6 });
      await page.mouse.click(target.x, target.y);
    },
  ],
  [
    'Link to… in the inspector',
    async (page, onboarding) => {
      await onboarding.editor.select('Producer producer1');
      await page.getByRole('button', { name: 'Link producer producer1 to…' }).click();
      await expect(page.getByRole('combobox', { name: 'Search the targets' })).toBeFocused();
      await page.keyboard.type('exchange');
      await page.keyboard.press('Enter');
    },
  ],
  [
    'Link to… in the menu of a node',
    async (page, onboarding) => {
      const { editor } = onboarding;
      await editor.rightClickMenuFirst(await editor.centre(editor.node('Producer producer1')));
      await page.getByRole('menuitem', { name: /Link to…/ }).click();
      await page.getByRole('option', { name: /exchange1/ }).click();
    },
  ],
  [
    'the key L',
    async (page, onboarding) => {
      await onboarding.editor.select('Producer producer1');
      await page.keyboard.press('l');
      await expect(page.locator('body > [role="status"][aria-live="polite"]')).toHaveText(/^Target 1 of \d+: exchange/);
      await page.keyboard.press('Enter');
    },
  ],
];

/** The tour, up to the step that links: asked for, and the three nodes it begins with added. */
async function toTheLinkingStep(page: Page): Promise<OnboardingPage> {
  const onboarding = new OnboardingPage(page);
  await onboarding.firstRun();
  await onboarding.tour.click();
  await onboarding.canvases.editorReady();
  await expect(onboarding.progress).toHaveText('Step 1 of 6');
  await onboarding.editor.add('Producer');
  await onboarding.editor.add('Direct exchange');
  await onboarding.editor.add('Queue');
  await expect(onboarding.progress).toHaveText('Step 2 of 6');
  return onboarding;
}

test.describe('journey 11: the tour', () => {
  test('is taken on a canvas of its own, a banner that covers nothing, and the card of the first run gives it its place', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();

    await onboarding.tour.click();
    await onboarding.canvases.editorReady();

    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'My first topology']);
    await expect(onboarding.banner).toBeVisible();
    await expect(onboarding.progress).toHaveText('Step 1 of 6');
    await expect(onboarding.title).toHaveText('Add a producer, an exchange and a queue');
    await expect(page.getByRole('region', { name: 'How to link' })).toHaveCount(0);
    await expect(onboarding.editor.node('Producer producer1')).toHaveCount(0);
  });

  test('adds a producer, an exchange and a queue, and moves on by itself when they are there', async ({ page }) => {
    const onboarding = await toTheLinkingStep(page);

    await expect(onboarding.title).toHaveText('Link the producer to the exchange');
    await expect(onboarding.ways).toHaveText([
      'Drag from the dot on the right of a node',
      'Click the dot, then click the target',
      'Press Link to… in the inspector',
      'Right-click a node and choose Link to…',
      'Select a node and press L',
    ]);
    await expect(onboarding.said).toContainText('Tour, step 2 of 6: Link the producer to the exchange.');
  });

  for (const [way, link] of WAYS) {
    test(`accepts ${way} as the link, and goes on to bind the exchange to the queue`, async ({ page }) => {
      const onboarding = await toTheLinkingStep(page);

      await link(page, onboarding);

      await expect(onboarding.progress).toHaveText('Step 3 of 6');
      await expect(onboarding.title).toHaveText('Bind the exchange to the queue');
      expect(await onboarding.editor.edges()).toEqual(['producer1 -> exchange1']);
    });
  }

  test('is taken all the way: bound by a typed command, a consumer given the queue, a message sent, and Finish', async ({
    page,
  }) => {
    const onboarding = await toTheLinkingStep(page);
    const { editor } = onboarding;
    await WAYS[0]?.[1](page, onboarding);
    await expect(onboarding.progress).toHaveText('Step 3 of 6');

    await editor.openCommandBar();
    await editor.runCommand('bind exchange1 -> queue1');
    await expect(onboarding.progress).toHaveText('Step 4 of 6');
    await editor.add('Consumer');
    const out = await editor.centre(editor.handle(await onboarding.idOf('Queue queue1'), 'out'));
    await page.mouse.click(out.x, out.y);
    const target = await editor.centre(editor.handle(await onboarding.idOf('Consumer consumer1'), 'in'));
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.click(target.x, target.y);
    await expect(onboarding.progress).toHaveText('Step 5 of 6');
    await expect(onboarding.title).toHaveText('Send a message');

    await editor.select('Producer producer1');
    await page.keyboard.press('p');

    await expect(onboarding.progress).toHaveText('Step 6 of 6');
    await expect(onboarding.title).toHaveText('That is the whole path');
    await expect(onboarding.end).toHaveCount(0);
    const before = await editor.edges();
    await onboarding.finish.click();
    await expect(onboarding.banner).toHaveCount(0);
    expect(await editor.edges(), 'the tour never changes the canvas').toEqual(before);
    expect(before).toEqual(['exchange1 -> queue1 key=', 'producer1 -> exchange1', 'consumer1 <- queue1'].sort());
  });

  test('can be skipped step by step, gone back in, and ended from any step', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.tour.click();
    await onboarding.canvases.editorReady();

    await expect(onboarding.next).toHaveText('Skip this step');
    await onboarding.next.click();
    await expect(onboarding.progress).toHaveText('Step 2 of 6');
    await onboarding.back.click();
    await expect(onboarding.progress).toHaveText('Step 1 of 6');
    await expect(onboarding.back).toHaveCount(0);
    await onboarding.next.click();
    await onboarding.end.click();

    await expect(onboarding.banner).toHaveCount(0);
    await expect(onboarding.said).toContainText('Tour ended.');
    expect(await onboarding.canvases.stored()).toEqual(['My first topology']);
  });

  test('waits for Next, and does not bounce, when a step is done already and the learner goes back to it', async ({
    page,
  }) => {
    const onboarding = await toTheLinkingStep(page);

    await onboarding.back.click();

    await expect(onboarding.progress).toHaveText('Step 1 of 6');
    await expect(onboarding.done).toHaveText('Done.');
    await expect(onboarding.next).toHaveText('Next');
    await page.waitForTimeout(300);
    await expect(onboarding.progress).toHaveText('Step 1 of 6');
  });

  test('is taken again from the home, on a new canvas, and is not there for a learner who went to build', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.scratch.click();
    await onboarding.canvases.editorReady();
    await expect(onboarding.banner).toHaveCount(0);
    await onboarding.canvases.showHome();

    await onboarding.more.click();
    await onboarding.tour.click();
    await onboarding.canvases.editorReady();

    await expect(onboarding.banner).toBeVisible();
    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Untitled canvas', 'My first topology']);
  });

  test('ends with the canvas, and a canvas that is opened afterwards has no tour', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.tour.click();
    await onboarding.canvases.editorReady();
    await expect(onboarding.banner).toBeVisible();

    await onboarding.canvases.newCanvas();

    await expect(onboarding.banner).toHaveCount(0);
    await onboarding.canvases.showCanvas('My first topology');
    await expect(onboarding.banner).toHaveCount(0);
  });
});

test.describe('the keyboard', () => {
  test('answers the question with the keys alone: Tab stays in the dialog, Enter on a template opens it, and the cursor is in the editor', async ({
    page,
  }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await expect(onboarding.template('Hello World')).toBeFocused();

    for (let presses = 0; presses < 12; presses += 1) {
      await page.keyboard.press('Tab');
      expect(await onboarding.dialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await onboarding.template('Routing').focus();
    await page.keyboard.press('Enter');

    await onboarding.canvases.editorReady();
    expect(await onboarding.canvases.tabs()).toEqual(['My canvases', 'Routing']);
  });

  test('moves the tour along with the keys, and Escape belongs to the canvas and does not end it', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.firstRun();
    await onboarding.tour.click();
    await onboarding.canvases.editorReady();

    await page.keyboard.press('Escape');
    await expect(onboarding.banner).toBeVisible();
    await onboarding.next.focus();
    await page.keyboard.press('Enter');

    await expect(onboarding.progress).toHaveText('Step 2 of 6');
  });
});
