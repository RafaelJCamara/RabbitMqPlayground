import { HeadersPage } from './pages/headers-page';
import { EXTRA_KEY, NUMBERS } from './support/headers';
import { expect, test } from './support/test';

/**
 * The two journeys that the plan names for S8, from the first click to what a learner is told, in a real browser with every flag on (`editor`, `simulation`, `explain` and `headers`): a binding that asks for the
 * number 1 and one that asks for the text "1" take different messages, and the table of recent messages says why; and an argument that starts with `x-` is not counted by `all` and is counted by `all-with-x`.
 * Nothing sets the app into a state: the bindings are made in the popover, the message is made in the table of the producer, and what the engine did is read from what the page shows.
 */

const FLAGS = 'editor,simulation,explain';

test.describe('"1" is not 1 (ADR-0009, ADR-0067)', () => {
  test('a binding for the number and a binding for the text take different messages, which the table of recent messages says in words', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, NUMBERS, { flags: FLAGS });
    const { editor, simulation } = headers;

    // A learner makes the two bindings in the popover, and the type of what is typed is told at once: 1 is an integer, and "1" is a string.
    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    const numeric = headers.popover('exchange numbers', 'queue ints');
    await numeric.fill(1, 'n', '1');
    await expect(numeric.type(1)).toHaveValue('integer');
    await numeric.submit.click();
    await expect(numeric.scope).toHaveCount(0);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q2')));
    const textual = headers.popover('exchange numbers', 'queue texts');
    await textual.fill(1, 'n', '"1"');
    await expect(textual.type(1)).toHaveValue('string');
    await textual.submit.click();
    await expect(textual.scope).toHaveCount(0);

    // The two chips say which is which, as the line that makes them does.
    await expect(headers.chips('x1>q1')).toHaveText(['all · n=1']);
    await expect(headers.chips('x1>q2')).toHaveText(['all · n="1"']);
    expect(await headers.bindings()).toEqual([
      { from: 'numbers', to: 'ints', xMatch: 'all', args: [{ key: 'n', value: { t: 'integer', v: 1 } }] },
      { from: 'numbers', to: 'texts', xMatch: 'all', args: [{ key: 'n', value: { t: 'string', v: '1' } }] },
    ]);

    // The producer sends the number 1, which only the first binding takes.
    await editor.select('Producer sender');
    await headers.table.append('n', '1');
    await headers.table.value(1).press('Tab');
    await expect(headers.table.type(1)).toHaveValue('integer');
    await headers.composer.getByRole('button', { name: 'Publish now' }).click();
    await simulation.stepThrough();
    expect((await simulation.view()).queues['ints']?.enqueued).toBe(1);
    expect((await simulation.view()).queues['texts']?.enqueued).toBe(0);

    // The same header as a text, which the select does by writing it in quotes, is taken by the other.
    await headers.table.type(1).selectOption('string');
    await expect(headers.table.value(1)).toHaveValue('"1"');
    await expect.poll(() => headers.producerHeaders()).toEqual([{ key: 'n', value: { t: 'string', v: '1' } }]);
    await headers.composer.getByRole('button', { name: 'Publish now' }).click();
    await simulation.stepThrough();
    expect((await simulation.view()).queues['ints']?.enqueued).toBe(1);
    expect((await simulation.view()).queues['texts']?.enqueued).toBe(1);
    expect(await headers.texts()).toEqual(
      expect.arrayContaining(['Numbers routed message 1 to ints', 'Numbers routed message 2 to texts']),
    );

    // The table of the first binding says why the second message was not taken by it: its type differs, and nothing else does.
    await headers.selectBinding('x1>q1');
    const live = headers.conditions().live;
    await expect(live.rows).toHaveCount(2);
    await expect(live.row(2)).toHaveAttribute('data-matched', 'false');
    expect(await live.words(live.row(2))).toEqual(['type differs', 'Does not match']);
    await expect(live.row(1)).toHaveAttribute('data-matched', 'true');
    expect(await live.words(live.row(1))).toEqual(['holds', 'Matches']);
    // The whole of the reason is the title of the cell, in the words of the message inspector.
    await expect(live.row(2).getByTestId('headers-live-cell')).toHaveAttribute(
      'title',
      'The header n is "1", a string, and the binding asks for 1, an integer: values of different types are never equal.',
    );
  });

  test('follows the conditions as they are typed, before they are applied: the table of the binding for the number says what it would say for the text', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, NUMBERS, { flags: FLAGS });
    const { editor, simulation } = headers;
    await editor.openCommandBar();
    await editor.runCommand('bind numbers -> ints n=1');
    await editor.runCommand('set sender header:n="1"');
    await page.keyboard.press('Escape');
    await headers.publish();
    await simulation.stepThrough();
    await headers.selectBinding('x1>q1');
    const live = headers.conditions().live;
    expect(await live.words(live.row(1))).toEqual(['type differs', 'Does not match']);

    await headers.conditions().value(1).fill('"1"');

    // The type is read from what is typed, and the verdict follows it; nothing is applied until Apply.
    await expect(headers.conditions().type(1)).toHaveValue('string');
    await expect(live.row(1)).toHaveAttribute('data-matched', 'true');
    expect(await live.words(live.row(1))).toEqual(['holds', 'Matches']);
    await expect(headers.chips('x1>q1')).toHaveText(['all · n=1']);

    await headers.conditions().revert.click();

    await expect(live.row(1)).toHaveAttribute('data-matched', 'false');
    expect(await live.words(live.row(1))).toEqual(['type differs', 'Does not match']);
  });
});

test.describe('an argument that starts with x- (ADR-0009, ADR-0068)', () => {
  test('is not counted under all and is counted under all-with-x, which the table and the sentence say before the mode is applied, and the message follows it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, EXTRA_KEY, { flags: FLAGS });
    const { simulation } = headers;
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · x-region=eu (ignored)']);

    // Under all the x- argument is not counted, so the message that has format=pdf and no x-region is taken.
    await headers.publish();
    await simulation.stepThrough();
    expect((await simulation.view()).queues['pdfs']?.enqueued).toBe(1);

    await headers.selectBinding('x1>q1');
    const conditions = headers.conditions();
    const live = conditions.live;
    await expect(conditions.mode('all')).toBeChecked();
    await expect(conditions.notes(2)).toContainText('The header x-region is not counted');
    await expect(conditions.sentence).toContainText('1 argument starts with "x-" and is not counted.');
    expect(await live.words(live.row(1))).toEqual(['holds', 'not counted', 'Matches']);

    // Choosing all-with-x changes the sentence, the note and the table, and not yet the binding or its chip.
    await conditions.choose('all-with-x');
    await expect(conditions.notes(2)).toHaveText('The header x-region is counted, because x-match is all-with-x.');
    await expect(conditions.sentence).toHaveText(
      'x-match=all-with-x: a message matches when all 2 conditions hold (format and x-region).',
    );
    await expect(live.row(1)).toHaveAttribute('data-matched', 'false');
    expect(await live.words(live.row(1))).toEqual(['holds', 'missing', 'Does not match']);
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · x-region=eu (ignored)']);

    await conditions.submit.click();

    await expect(headers.chips('x1>q1')).toHaveText(['all-with-x · format=pdf · x-region=eu']);
    expect(await headers.bindings()).toEqual([
      {
        from: 'files',
        to: 'pdfs',
        xMatch: 'all-with-x',
        args: [
          { key: 'format', value: { t: 'string', v: 'pdf' } },
          { key: 'x-region', value: { t: 'string', v: 'eu' } },
        ],
      },
    ]);

    // Now the same message is not taken: the queue still has the first one, and the log says why for the second.
    await headers.publish();
    await simulation.stepThrough();
    expect((await simulation.view()).queues['pdfs']?.enqueued).toBe(1);
    await expect.poll(() => headers.texts()).toContain('Message 2 reached files and found no queue to go to');
    // The mode was changed with one line, which a learner could have typed, and it is one step of undo.
    expect(await headers.commands()).toContain(
      'unbind files -> pdfs x-match=all format=pdf x-region=eu; bind files -> pdfs x-match=all-with-x format=pdf x-region=eu',
    );
  });
});
