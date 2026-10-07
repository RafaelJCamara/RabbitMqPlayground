import type { Page } from '@playwright/test';
import { HeadersPage } from './pages/headers-page';
import { FILES } from './support/headers';
import { Finger } from './support/touch';
import { expect, test } from './support/test';

/**
 * What a learner does to give a headers binding its conditions, in a real browser (S8, ADR-0066, ADR-0067, ADR-0068): the popover that asks for them when a link is made, the rows with their types, and
 * what is said under a row that is wrong or that will surprise. The conditions are behind the flags `editor` and `headers`; the simulation is not needed. A test that says that something did not happen
 * waits two frames first, so that it is not true only because it looked too soon.
 */

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

/** Draws a link from the headers exchange `files` to the queue `pdfs`, which opens the popover that asks for the conditions, and returns it. */
async function askForConditions(headers: HeadersPage, queue = 'q1', name = 'pdfs') {
  const { editor } = headers;
  await editor.dragLinkTo('x1', await editor.centre(editor.nodeById(queue)));
  const popover = headers.popover('exchange files', `queue ${name}`);
  await expect(popover.scope).toBeVisible();
  await expect(popover.name(1)).toBeFocused();
  return popover;
}

test.describe('the popover that asks for the conditions of a link (ADR-0066)', () => {
  test('opens by the node that the link goes to with the cursor in the name of its first row, and makes nothing until it is told to', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);

    const popover = await askForConditions(headers);

    await expect(popover.rows).toHaveCount(1);
    await expect(popover.mode('all')).toBeChecked();
    await expect(popover.modeHelp).toHaveText(
      'Every condition has to hold. Arguments that start with x- are not counted.',
    );
    expect(await headers.editor.edges(), 'nothing is made until Bind').toEqual(['sender -> files']);
    expect(await headers.bindings()).toEqual([]);
  });

  test('makes one binding with the mode written out and the conditions as they were typed, and says so in one line of the log', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);

    await popover.fill(1, 'format', 'pdf');
    await popover.append('size', '10');
    await expect(popover.line).toHaveText('bind files -> pdfs x-match=all format=pdf size=10');
    await popover.submit.click();

    await expect(popover.scope).toHaveCount(0);
    await expect
      .poll(() => headers.bindings())
      .toEqual([
        {
          from: 'files',
          to: 'pdfs',
          xMatch: 'all',
          args: [
            { key: 'format', value: { t: 'string', v: 'pdf' } },
            { key: 'size', value: { t: 'integer', v: 10 } },
          ],
        },
      ]);
    expect(await headers.editor.log()).toEqual(['bind files -> pdfs x-match=all format=pdf size=10']);
    await expect(headers.said).toHaveText('Bound exchange files to queue pdfs.');
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · size=10']);
  });

  test('makes the binding with Enter in a field, which is a form that is sent', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);

    await popover.fill(1, 'format', 'pdf');
    await popover.value(1).press('Enter');

    await expect(popover.scope).toHaveCount(0);
    expect(await headers.editor.log()).toEqual(['bind files -> pdfs x-match=all format=pdf']);
  });

  test('is never switched off: Bind with a row that is not finished says the first problem aloud and puts the cursor in it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.name(1).fill('format');

    await expect(popover.submit).toBeEnabled();
    await popover.submit.click();

    await expect(popover.value(1)).toBeFocused();
    await expect(popover.value(1)).toHaveAttribute('aria-invalid', 'true');
    await expect(popover.problem(1, 'value')).toBeVisible();
    await expect(headers.assertive).toContainText('A header needs a value');
    await expect(popover.scope).toBeVisible();
    // Nothing was made (the log is read with the command bar, whose button takes the focus and so would give the popover up).
    expect(await headers.bindings()).toEqual([]);
  });

  test('is given up with Escape, which gives the canvas the keyboard and makes nothing, and says so', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'format', 'pdf');

    await page.keyboard.press('Escape');

    await expect(popover.scope).toHaveCount(0);
    await expect(headers.editor.flow).toBeFocused();
    await expect(headers.said).toHaveText('Link cancelled.');
    expect(await headers.bindings()).toEqual([]);
    expect(await headers.editor.log()).toEqual([]);
  });

  test('is given up with its Cancel button as well, and a second link opens it with nothing typed in it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'format', 'pdf');

    await popover.cancel.click();

    await expect(popover.scope).toHaveCount(0);
    expect(await headers.bindings()).toEqual([]);
    const again = await askForConditions(headers);
    await expect(again.name(1)).toHaveValue('');
    await expect(again.rows).toHaveCount(1);
  });

  test('is not given up by a click on its own text, and is given up when the focus goes elsewhere', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'format', 'pdf');

    await popover.sentence.click();
    await twoFrames(page);
    await expect(popover.scope).toBeVisible();
    await expect(popover.name(1)).toHaveValue('format');

    await headers.editor.toolbox.getByRole('button', { name: 'Queue', exact: true }).focus();

    await expect(popover.scope).toHaveCount(0);
    expect(await headers.bindings()).toEqual([]);
  });

  test('says in a sentence what the binding asks as the rows are typed, in the words of the explanation', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await expect(popover.sentence).toContainText('no condition counts, so it matches every message');

    await popover.fill(1, 'format', 'pdf');
    await expect(popover.sentence).toHaveText('x-match=all: a message matches when its one condition holds (format).');

    await popover.append('type', 'report');
    await popover.choose('any');
    await expect(popover.sentence).toHaveText(
      'x-match=any: a message matches when at least one of the 2 conditions holds (format and type).',
    );
    await expect(popover.modeHelp).toHaveText(
      'At least one condition has to hold. Arguments that start with x- are not counted.',
    );
  });
});

test.describe('every way of making a link asks for the conditions of a headers binding (ADR-0066)', () => {
  test('by "Link to…" in the inspector, which lists the targets and then asks, with the cursor in the first row', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    await headers.editor.select('Exchange files, headers');

    await page.getByRole('button', { name: 'Link exchange files to…' }).click();
    await expect(page.getByRole('combobox', { name: 'Search the targets' })).toBeFocused();
    await page.keyboard.type('scans');
    await page.keyboard.press('Enter');

    const popover = headers.popover('exchange files', 'queue scans');
    await expect(popover.scope).toBeVisible();
    await expect(popover.name(1)).toBeFocused();
    await popover.fill(1, 'format', 'tiff');
    await popover.value(1).press('Enter');
    await expect.poll(() => headers.bindings()).toHaveLength(1);
    expect(await headers.commands()).toEqual(['bind files -> scans x-match=all format=tiff']);
  });

  test('by the key L, which the library takes: the arrow keys choose the target and Enter asks', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES);
    await headers.editor.select('Exchange files, headers');

    await page.keyboard.press('l');
    await expect(headers.polite).toHaveText(/^(Linking from exchange files\.|Target \d+ of \d+)/);
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('group', { name: /^Conditions for the binding from exchange files to / }),
    ).toBeVisible();
  });

  test.describe('by touch', () => {
    test.use({ hasTouch: true });

    test('by dragging a finger from the dot of the exchange to a queue', async ({ page }) => {
      const headers = await HeadersPage.open(page, FILES);
      const { editor } = headers;
      const finger = await Finger.on(page);

      await finger.drag(await editor.centre(editor.handle('x1', 'out')), await editor.centre(editor.nodeById('q2')));

      const popover = headers.popover('exchange files', 'queue scans');
      await expect(popover.scope).toBeVisible();
      await expect(popover.name(1)).toBeFocused();
    });
  });

  test('by letting a link go on nothing, which makes a queue and asks for the conditions of its binding', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const { editor } = headers;
    const from = await editor.centre(editor.handle('x1', 'out'));

    await editor.dragLinkTo('x1', { x: from.x + 40, y: from.y + 200 });
    await page.getByRole('menuitem', { name: 'New queue' }).click();

    const popover = page.getByRole('group', { name: /^Conditions for the binding from exchange files to queue / });
    await expect(popover).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name of condition 1' })).toBeFocused();
    await page.keyboard.press('Escape');
    expect(await headers.bindings()).toEqual([]);
    expect(await editor.edges()).toEqual(['sender -> files']);
  });
});

test.describe('the rows of conditions: the type of what is typed, and what is said under a row (ADR-0067, ADR-0068)', () => {
  test('reads the type of what is typed, by the rule of the command line: a number is an integer, with a point it is a float, and text in quotes is a string', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    const cases: readonly (readonly [string, string])[] = [
      ['1', 'integer'],
      ['1.0', 'float'],
      ['"1"', 'string'],
      ['true', 'boolean'],
      ['"true"', 'string'],
      ['pdf', 'string'],
      ['-7', 'integer'],
    ];

    for (const [typed, type] of cases) {
      await popover.value(1).fill(typed);
      await expect(popover.type(1), `${typed} is read as ${type}`).toHaveValue(type);
    }
  });

  test('rewrites the text when another type is chosen so that it says the type, and says what it became', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'n', '1');

    await popover.type(1).selectOption('string');
    await expect(popover.value(1)).toHaveValue('"1"');
    await expect(popover.type(1)).toHaveValue('string');
    await expect(headers.polite).toHaveText('Condition 1 is now a string: "1".');

    await popover.type(1).selectOption('integer');
    await expect(popover.value(1)).toHaveValue('1');
    await expect(headers.polite).toHaveText('Condition 1 is now an integer: 1.');

    await popover.type(1).selectOption('float');
    await expect(popover.value(1)).toHaveValue('1.0');
    await expect(popover.line).toHaveText('bind files -> pdfs x-match=all n=1.0');
  });

  test('refuses a type that the text cannot have, under the row, with the cause first, and the select goes back to what it was', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'big', 'true');
    await expect(popover.type(1)).toHaveValue('boolean');

    await popover.type(1).selectOption('integer');

    await expect(popover.type(1)).toHaveValue('boolean');
    await expect(popover.problem(1, 'type')).toBeVisible();
    await expect(popover.type(1)).toHaveAttribute('aria-invalid', 'true');
    await expect(popover.value(1)).toHaveValue('true');
    await expect(headers.assertive).toHaveText(/\S/);
    // The refusal goes with the next change of the rows.
    await popover.value(1).fill('false');
    await expect(popover.problem(1, 'type')).toHaveCount(0);
  });

  test('keeps a type that is chosen while the value is empty, and shows an example of it in the field', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.name(1).fill('size');

    await popover.type(1).selectOption('integer');

    await expect(popover.type(1)).toHaveValue('integer');
    await expect(popover.value(1)).toHaveValue('');
    await expect(popover.value(1)).toHaveAttribute('placeholder', '7');
    await expect(headers.polite).toHaveText('Condition 1 is now an integer, and has no value yet.');
    await popover.value(1).fill('10');
    await expect(popover.type(1)).toHaveValue('integer');
  });

  test('flags a name that is there twice on both rows, and Bind says it and puts the cursor in the first of them', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'format', 'pdf');
    await popover.append('format', 'tiff');

    await expect(popover.problem(1, 'key')).toHaveText(/The header 'format' is there twice/);
    await expect(popover.problem(2, 'key')).toHaveText(/The header 'format' is there twice/);
    await expect(popover.name(1)).toHaveAttribute('aria-invalid', 'true');
    await expect(popover.name(2)).toHaveAttribute('aria-invalid', 'true');

    await popover.submit.click();

    await expect(popover.name(1)).toBeFocused();
    await expect(headers.assertive).toContainText("The header 'format' is there twice");
    expect(await headers.bindings()).toEqual([]);

    // Taking one off clears both, and the binding can be made.
    await popover.remove(2).click();
    await expect(popover.problem(1, 'key')).toHaveCount(0);
    await expect(popover.name(1)).toBeFocused();
    await popover.submit.click();
    await expect(popover.scope).toHaveCount(0);
    expect(await headers.editor.log()).toEqual(['bind files -> pdfs x-match=all format=pdf']);
  });

  test('says that an x- name is not counted by the modes that leave it out, counted by the ones that do not, and what the sentence makes of it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'x-region', 'eu');

    await expect(popover.notes(1)).toHaveText(
      'The header x-region is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.',
    );
    await expect(popover.sentence).toContainText('no condition counts, so it matches every message.');
    await expect(popover.sentence).toContainText('1 argument starts with "x-" and is not counted.');

    await popover.choose('all-with-x');

    await expect(popover.notes(1)).toHaveText('The header x-region is counted, because x-match is all-with-x.');
    await expect(popover.sentence).toHaveText(
      'x-match=all-with-x: a message matches when its one condition holds (x-region).',
    );
    await expect(popover.modeHelp).toHaveText(
      'Every condition has to hold, and the arguments that start with x- count too.',
    );
  });

  test('does not take the name x-match as a condition, because it is the mode, and says which control to use', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);

    await popover.fill(1, 'x-match', 'any');

    await expect(popover.problem(1, 'key')).toHaveText(
      "'x-match' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. Choose it with the x-match control.",
    );
    await popover.submit.click();
    await expect(popover.name(1)).toBeFocused();
    expect(await headers.bindings()).toEqual([]);
  });

  test('asks only for the header to be there with the type exists, which takes the value away, says that it cannot be exported, and makes a condition with no value', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.name(1).fill('author');
    await expect(popover.exportNote).toHaveCount(0);

    await popover.type(1).selectOption('exists');

    await expect(popover.value(1)).toHaveCount(0);
    await expect(popover.scope.getByTestId('header-exists')).toHaveText('Only has to be there, with any value.');
    await expect(popover.exportNote).toContainText('cannot be written to definitions.json');
    await expect(popover.line).toHaveText('bind files -> pdfs x-match=all exists(author)');
    await expect(headers.polite).toHaveText('Condition 1 now only has to be there.');

    await popover.submit.click();

    await expect(popover.scope).toHaveCount(0);
    await expect
      .poll(() => headers.bindings())
      .toEqual([{ from: 'files', to: 'pdfs', xMatch: 'all', args: [{ key: 'author', value: { t: 'exists' } }] }]);
  });

  test('keeps the mode that is chosen readable while the pointer is still on it, which a hover must not take the fill from', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);

    await popover.choose('any');

    const chosen = popover.modes.locator('input:checked + span');
    await expect(chosen).toHaveText('any');
    await expect(chosen).toHaveCSS('background-color', await headers.tokenColour('--rmq-accent'));
    await expect(chosen).toHaveCSS('color', await headers.tokenColour('--rmq-accent-fg'));
    // A segment that is not chosen is lit by the pointer, and is the surface of the page otherwise.
    const other = popover.modes.locator('label').filter({ hasText: /^all$/ }).locator('span');
    await other.hover();
    await expect(other).toHaveCSS('background-color', await headers.tokenColour('--rmq-canvas'));
  });

  test('tells a lint of the conditions while they are typed: any with nothing that counts matches no message, and a condition that counts takes it away', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await expect(popover.lint).toHaveCount(0);

    await popover.choose('any');
    await popover.fill(1, 'x-region', 'eu');

    await expect(popover.lint).toContainText('Worth a look');
    await expect(popover.lint).toContainText(
      "The binding from 'files' to 'pdfs' has x-match=any and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.",
    );
    await popover.append('format', 'pdf');
    await expect(popover.lint).toHaveCount(0);
    await popover.name(2).fill('x-other');
    await expect(popover.lint).toBeVisible();
    await popover.choose('any-with-x');
    await expect(popover.lint).toHaveCount(0);
  });

  test('chooses the mode with the arrow keys as a group of radio buttons does, and a mode that is chosen is written out', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES);
    const popover = await askForConditions(headers);
    await popover.fill(1, 'format', 'pdf');

    await popover.mode('all').focus();
    await page.keyboard.press('ArrowRight');
    await expect(popover.mode('any')).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(popover.mode('all-with-x')).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(popover.mode('any')).toBeChecked();
    await expect(popover.mode('all')).not.toBeChecked();
    await popover.value(1).press('Enter');

    await expect(popover.scope).toHaveCount(0);
    expect(await headers.editor.log()).toEqual(['bind files -> pdfs x-match=any format=pdf']);
  });
});
