import type { Page } from '@playwright/test';
import { HeadersPage } from './pages/headers-page';
import { FILES_BOUND } from './support/headers';
import { ORDERS } from './support/orders';
import { expect, test } from './support/test';

/**
 * The table of the headers of a producer's message, in a real browser (S8, ADR-0069): the rows of its composer, applied as the learner leaves a control, row by row, as the lines that a learner could type
 * (`set sender header:size=10`, `unset sender header:type`), and not at all while the table has something wrong in it. It needs the flags `editor` and `simulation`.
 */

const FLAGS = 'editor';

async function open(page: Page, document = FILES_BOUND): Promise<HeadersPage> {
  const headers = await HeadersPage.open(page, document, { flags: FLAGS });
  await headers.editor.select('Producer sender');
  await expect(headers.composer).toBeVisible();
  return headers;
}

test.describe('the table of the headers of a message (ADR-0069)', () => {
  test('shows each header of the message as a row, with its name, its type and its value', async ({ page }) => {
    const headers = await open(page);
    const { table } = headers;

    await expect(table.rows).toHaveCount(2);
    await expect(table.name(1)).toHaveValue('format');
    await expect(table.type(1)).toHaveValue('string');
    await expect(table.value(1)).toHaveValue('pdf');
    await expect(table.name(2)).toHaveValue('type');
    await expect(table.value(2)).toHaveValue('report');
    // A message has no condition, so a row has no type that is exists, and no mode to choose.
    await expect(table.type(1).locator('option')).toHaveText(['string', 'integer', 'float', 'boolean']);
    await expect(headers.composer.getByRole('group', { name: 'x-match' })).toHaveCount(0);
  });

  test('applies a row when it is left and it is complete, as the line that a learner could type, and one step of undo takes it off', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;

    await table.append('size', '10');
    await table.value(3).press('Tab');

    await expect
      .poll(() => headers.producerHeaders())
      .toEqual([
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'type', value: { t: 'string', v: 'report' } },
        { key: 'size', value: { t: 'integer', v: 10 } },
      ]);
    expect(await headers.commands()).toEqual(['set sender header:size=10']);

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect.poll(() => headers.producerHeaders()).toHaveLength(2);
    await expect(table.rows).toHaveCount(2);
  });

  test('applies nothing while a row is not finished, and says what is missing under it, in the words of the rows of a binding', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;

    await table.add.click();
    await table.name(3).fill('size');
    await table.name(3).press('Tab');

    await expect(table.problem(3, 'value')).toBeVisible();
    await expect(table.value(3)).toHaveAttribute('aria-invalid', 'true');
    expect(await headers.producerHeaders()).toHaveLength(2);

    await table.value(3).fill('10');
    await table.value(3).press('Tab');

    await expect.poll(() => headers.producerHeaders()).toHaveLength(3);
    await expect(table.problem(3, 'value')).toHaveCount(0);
  });

  test('applies nothing at all while the table has a problem anywhere, and all of it when the problem is gone, as one step', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;
    await table.append('format', 'tiff');

    // The same name is there twice: both rows say so, and nothing is applied, not even what is complete in the other.
    await expect(table.problem(1, 'key')).toContainText("The header 'format' is there twice");
    await expect(table.problem(3, 'key')).toContainText("The header 'format' is there twice");
    await table.value(2).fill('invoice');
    await table.value(2).press('Tab');
    await expect(table.value(2)).toHaveValue('invoice');
    expect(await headers.producerHeaders()).toEqual([
      { key: 'format', value: { t: 'string', v: 'pdf' } },
      { key: 'type', value: { t: 'string', v: 'report' } },
    ]);

    await table.remove(3).click();

    await expect
      .poll(() => headers.producerHeaders())
      .toEqual([
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'type', value: { t: 'string', v: 'invoice' } },
      ]);
  });

  test('takes a header off with its button, as the line that a learner could type, and the cursor goes to the row that is next', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;

    await table.remove(1).click();

    await expect.poll(() => headers.producerHeaders()).toEqual([{ key: 'type', value: { t: 'string', v: 'report' } }]);
    await expect(table.rows).toHaveCount(1);
    await expect(table.name(1)).toBeFocused();
    await expect(table.name(1)).toHaveValue('type');
    await table.remove(1).click();
    await expect.poll(() => headers.producerHeaders()).toEqual([]);
    await expect(table.add).toBeFocused();
    // The log is read last, with the command bar, which takes the focus.
    expect(await headers.commands()).toEqual(['unset sender header:format', 'unset sender header:type']);
  });

  test('changes the type of a value by rewriting its text, and sends it with that type', async ({ page }) => {
    const headers = await open(page);
    const { table } = headers;
    await table.append('n', '1');
    await table.value(3).press('Tab');
    await expect
      .poll(async () => (await headers.producerHeaders()).at(-1))
      .toEqual({ key: 'n', value: { t: 'integer', v: 1 } });

    await table.type(3).selectOption('string');

    await expect(table.value(3)).toHaveValue('"1"');
    await expect
      .poll(async () => (await headers.producerHeaders()).at(-1))
      .toEqual({ key: 'n', value: { t: 'string', v: '1' } });

    // A number that is text can be a float, and the text says it.
    await table.type(3).selectOption('float');
    await expect(table.value(3)).toHaveValue('1.0');
    await expect
      .poll(async () => (await headers.producerHeaders()).at(-1))
      .toEqual({ key: 'n', value: { t: 'float', v: 1 } });

    // A float is not a boolean, and the select says so and goes back, with the cause under it.
    await table.type(3).selectOption('boolean');
    await expect(table.type(3)).toHaveValue('float');
    await expect(table.problem(3, 'type')).toBeVisible();
    expect((await headers.producerHeaders()).at(-1)).toEqual({ key: 'n', value: { t: 'float', v: 1 } });
  });

  test('has no row that is exists, and a name that starts with x- is a header like any other, with no note about a mode', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;

    await table.append('x-region', 'eu');
    await table.value(3).press('Tab');

    await expect
      .poll(async () => (await headers.producerHeaders()).at(-1))
      .toEqual({ key: 'x-region', value: { t: 'string', v: 'eu' } });
    await expect(table.notes(3)).toHaveCount(0);
    await expect(table.problem(3, 'key')).toHaveCount(0);
  });

  test('starts again from the message when its headers are changed from somewhere else, as a typed command is', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;
    await table.add.click();
    await table.name(3).fill('half');
    await expect(table.rows).toHaveCount(3);

    await headers.editor.openCommandBar();
    await headers.editor.runCommand('set sender header:size=7');

    await expect.poll(() => headers.producerHeaders()).toHaveLength(3);
    await expect(table.rows).toHaveCount(3);
    await expect(table.name(3)).toHaveValue('size');
    await expect(table.type(3)).toHaveValue('integer');
    await expect(table.value(3)).toHaveValue('7');
  });

  test('applies a name that is changed when the name is left, as the header that went and the header that came, in one step', async ({
    page,
  }) => {
    const headers = await open(page);
    const { table } = headers;

    await table.name(2).fill('kind');
    await table.name(2).press('Tab');

    await expect
      .poll(() => headers.producerHeaders())
      .toEqual([
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'kind', value: { t: 'string', v: 'report' } },
      ]);
    expect(await headers.commands()).toEqual(['unset sender header:type; set sender header:kind=report']);
  });

  test('is another table for another producer that has the very same headers, and what was typed in the first is not carried over', async ({
    page,
  }) => {
    const headers = await open(page);
    await headers.editor.openCommandBar();
    await headers.editor.runCommand('add producer twin');
    await headers.editor.runCommand('set twin header:format=pdf header:type=report');
    await page.keyboard.press('Escape');
    await headers.editor.select('Producer sender');
    const { table } = headers;
    await table.add.click();
    await table.name(3).fill('half');
    await expect(table.rows).toHaveCount(3);

    await headers.editor.select('Producer twin');

    await expect(table.rows).toHaveCount(2);
    await expect(table.name(1)).toHaveValue('format');
  });

  test('is the table of the producer that is selected, and what was typed in the table of another is not carried over', async ({
    page,
  }) => {
    const headers = await open(page);
    await headers.editor.add('Producer');
    await headers.editor.select('Producer sender');
    const { table } = headers;
    await table.add.click();
    await table.name(3).fill('half');

    await headers.editor.select('Producer producer1');

    await expect(table.rows).toHaveCount(0);
    await headers.editor.select('Producer sender');
    await expect(table.rows).toHaveCount(2);
  });
});

test.describe('the routing key of a producer that publishes to a headers exchange (ADR-0069)', () => {
  test('says that the exchange does not read it, and that it is still carried, and the field is described by that note', async ({
    page,
  }) => {
    const headers = await open(page);

    const note = headers.composer.getByTestId('composer-key-note');

    await expect(note).toHaveText(
      'Not used by this exchange; still carried for exchange-to-exchange hops and dead-lettering.',
    );
    await expect(headers.composer.getByRole('textbox', { name: 'Routing key' })).toHaveAttribute(
      'aria-describedby',
      (await note.getAttribute('id'))!,
    );
  });

  test('says nothing of it to a producer that publishes to a direct exchange, which reads it', async ({ page }) => {
    const headers = await open(page, ORDERS);

    await expect(headers.composer.getByTestId('composer-key-note')).toHaveCount(0);
    await expect(headers.composer.getByRole('textbox', { name: 'Routing key' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});
