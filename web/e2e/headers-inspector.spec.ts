import { HeadersPage } from './pages/headers-page';
import { FILES_BOUND, FILES_TWICE } from './support/headers';
import { expect, test } from './support/test';

/**
 * The editor of the conditions of a headers binding in the inspector, in a real browser (S8, ADR-0066, ADR-0068): it takes the place of the key field of a binding of a headers exchange, shows the mode and
 * the rows as the binding has them, changes the binding when it is told to, as one step of undo, and says what it did. The flags are `editor` and `headers`.
 */

test.describe('the conditions of a binding, in the inspector (ADR-0066)', () => {
  test('shows the mode and a row for each condition, as the binding has them, with the sentence of what it asks and the line that would make it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);

    await headers.selectBinding('x1>q1');

    const conditions = headers.conditions();
    await expect(conditions.scope).toBeVisible();
    await expect(conditions.mode('all')).toBeChecked();
    await expect(conditions.rows).toHaveCount(2);
    await expect(conditions.name(1)).toHaveValue('format');
    await expect(conditions.type(1)).toHaveValue('string');
    await expect(conditions.value(1)).toHaveValue('pdf');
    await expect(conditions.name(2)).toHaveValue('type');
    await expect(conditions.value(2)).toHaveValue('report');
    await expect(conditions.sentence).toHaveText(
      'x-match=all: a message matches when all 2 conditions hold (format and type).',
    );
    await expect(conditions.line).toHaveText('bind files -> pdfs x-match=all format=pdf type=report');
    await expect(conditions.submit).toHaveText('Apply');
    await expect(conditions.revert).toBeVisible();
    // The key is not read by a headers exchange, so there is no field for it.
    await expect(headers.editor.inspector.getByRole('textbox', { name: 'Key' })).toHaveCount(0);
  });

  test('shows the other binding of the same exchange with its own mode and rows, and the types as they are held', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);

    await headers.selectBinding('x1>q2');

    const conditions = headers.conditions();
    await expect(conditions.mode('any')).toBeChecked();
    await expect(conditions.name(1)).toHaveValue('format');
    await expect(conditions.value(1)).toHaveValue('tiff');
    await expect(conditions.name(2)).toHaveValue('dpi');
    await expect(conditions.type(2)).toHaveValue('integer');
    await expect(conditions.value(2)).toHaveValue('300');
  });

  test('changes the binding when Apply is pressed and not before, as one step of undo, and the label of the edge follows', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');
    const conditions = headers.conditions();
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);

    await conditions.choose('any');
    await conditions.fill(2, 'type', 'invoice');

    // Nothing is changed while it is typed: the document and the label still have the binding as it was.
    expect(await headers.bindings()).toContainEqual({
      from: 'files',
      to: 'pdfs',
      xMatch: 'all',
      args: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'type', value: { t: 'string', v: 'report' } },
      ],
    });
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);

    await conditions.submit.click();

    await expect(headers.chips('x1>q1')).toHaveText(['any · format=pdf · type=invoice']);
    expect((await headers.bindings()).find(({ to }) => to === 'pdfs')).toEqual({
      from: 'files',
      to: 'pdfs',
      xMatch: 'any',
      args: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'type', value: { t: 'string', v: 'invoice' } },
      ],
    });
    expect(await headers.editor.log()).toEqual([
      'unbind files -> pdfs x-match=all format=pdf type=report; bind files -> pdfs x-match=any format=pdf type=invoice',
    ]);
    // The edge is still selected, with the editor on the binding as it is now.
    await expect(conditions.mode('any')).toBeChecked();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('says that nothing changed when Apply is pressed on a binding that is as it was, and makes no command', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');
    const conditions = headers.conditions();

    await conditions.submit.click();

    await expect(headers.polite).toHaveText('No changes.');
    expect(await headers.editor.log()).toEqual([]);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('is never switched off in the inspector either: Apply with a row that is wrong says it aloud, puts the cursor in it, and changes nothing', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');
    const conditions = headers.conditions();
    await conditions.fill(2, 'format', 'tiff');

    await expect(conditions.submit).toBeEnabled();
    await conditions.submit.click();

    await expect(conditions.name(1)).toBeFocused();
    await expect(conditions.problem(1, 'key')).toContainText("The header 'format' is there twice");
    await expect(conditions.problem(2, 'key')).toContainText("The header 'format' is there twice");
    await expect(headers.assertive).toContainText("The header 'format' is there twice");
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);
  });

  test('gives back the binding as it is with Revert, and says so', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');
    const conditions = headers.conditions();
    await conditions.choose('any-with-x');
    await conditions.fill(1, 'format', 'png');
    await conditions.append('x-region', 'eu');
    await expect(conditions.rows).toHaveCount(3);

    await conditions.revert.click();

    await expect(conditions.mode('all')).toBeChecked();
    await expect(conditions.rows).toHaveCount(2);
    await expect(conditions.value(1)).toHaveValue('pdf');
    await expect(headers.polite).toHaveText('Reverted to the binding as it is.');
    expect(await headers.editor.log()).toEqual([]);
  });

  test('makes two bindings one when an edit makes them the same, and says so', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_TWICE);
    await headers.selectBinding('x1>q1');
    const first = headers.conditions(1);
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(2);

    await first.remove(2).click();
    await first.submit.click();

    await expect(headers.said).toHaveText(
      'That is the same as another binding between these nodes, so there is one now.',
    );
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(1);
    expect(await headers.bindings()).toEqual([
      {
        from: 'files',
        to: 'pdfs',
        xMatch: 'all',
        args: [{ key: 'format', value: { t: 'string', v: 'pdf' } }],
      },
    ]);
  });

  test('keeps the order of the bindings when one is edited: the edited one is the last of its edge', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_TWICE);
    await headers.selectBinding('x1>q1');
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report', 'all · format=pdf']);

    await headers.conditions(1).choose('any');
    await headers.conditions(1).submit.click();

    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf', 'any · format=pdf · type=report']);
  });

  test('adds another binding between the same two nodes through the same popover, and deletes one with its own button', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');

    await headers.editor.inspector.getByTestId('add-binding').click();

    const popover = headers.popover('exchange files', 'queue pdfs');
    await expect(popover.scope).toBeVisible();
    await expect(popover.name(1)).toBeFocused();
    await popover.fill(1, 'format', 'pdf');
    await popover.submit.click();
    await expect(popover.scope).toHaveCount(0);
    await headers.selectBinding('x1>q1');
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(2);
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report', 'all · format=pdf']);

    await headers.editor.inspector.getByRole('button', { name: 'Delete binding 1 of 2' }).click();

    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(1);
    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf']);
  });

  test('says that a binding that is already there is there, and makes nothing, when the popover is given the same conditions', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);
    await headers.selectBinding('x1>q1');
    await headers.editor.inspector.getByTestId('add-binding').click();
    const popover = headers.popover('exchange files', 'queue pdfs');
    await expect(popover.name(1)).toBeFocused();

    await popover.fill(1, 'type', 'report');
    await popover.append('format', 'pdf');
    await popover.submit.click();

    await expect(popover.scope).toHaveCount(0);
    await expect(headers.said).toHaveText('Already bound with those conditions.');
    expect((await headers.bindings()).filter(({ to }) => to === 'pdfs')).toHaveLength(1);
  });
});
