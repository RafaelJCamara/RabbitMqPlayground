import { EditorPage } from './pages/editor-page';
import { seedCanvas } from './support/seed';
import { TOPOLOGY } from './support/topology';
import { expect, test } from './support/test';

/**
 * The inspector in a real browser (ADR-0024, ADR-0032). The fields and the refusals are also tested as components, with the stores;
 * what is here is what only a browser shows: the order on the page, what a screen reader is told, and that a refused change does not
 * reach the saved document.
 */

async function open(page: import('@playwright/test').Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  return editor;
}

test.describe('the durable switch of a queue (ADR-0024)', () => {
  test('is on, and says why, so that it reads as an explanation and not as a switch that is broken', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');

    const durable = page.getByRole('switch', { name: 'Durable' });
    await expect(durable).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('durable-why')).toHaveText(
      'It is on, and stays on: RabbitMQ 4.3 does not accept a queue that is not durable.',
    );
    await expect(durable).toHaveAttribute(
      'aria-describedby',
      (await page.getByTestId('durable-why').getAttribute('id'))!,
    );
  });

  test('is refused when it is turned off: the root cause first, the broker’s reply after it, and the queue stays durable', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    const durable = page.getByRole('switch', { name: 'Durable' });

    await durable.click();

    const block = page.getByTestId('durable-problem');
    const message = block.getByTestId('refusal-message');
    const reply = block.getByTestId('refusal-reply');
    await expect(message).toContainText("Queue 'queue1' is not durable.");
    await expect(message).toContainText('RabbitMQ 4.3 no longer allows a queue that is neither durable nor exclusive');
    await expect(block.getByTestId('refusal-code')).toHaveText('541');
    await expect(reply).toContainText('transient_nonexcl_queues');

    // On the page the sentence comes first and the reply after it, set apart and labelled.
    const where = { message: (await message.boundingBox())!, reply: (await reply.boundingBox())! };
    expect(where.message.y + where.message.height).toBeLessThanOrEqual(where.reply.y);
    await expect(reply).toContainText('What RabbitMQ answers');

    // The switch did not move, and a screen reader is pointed at the refusal that is under it.
    await expect(durable).toHaveAttribute('aria-checked', 'true');
    await expect(durable).toHaveAttribute('aria-describedby', (await block.getAttribute('id'))!);
  });

  test('is refused once, aloud, with the sentence first, and is not shown a second time on the status line', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');

    await page.getByRole('switch', { name: 'Durable' }).click();

    // The bus says it once, assertively, in one sentence with the broker's reply after it.
    await expect(page.locator('body > [role="alert"][aria-live="assertive"]')).toContainText(
      /^Queue 'queue1' is not durable\..*RabbitMQ would answer 541 /,
    );
    // And the refusal is under the switch only: the status line, which would be a second copy, does not have it.
    await expect(page.getByTestId('refusal')).toHaveCount(1);
    await expect(editor.status.getByTestId('refusal')).toHaveCount(0);
  });

  test('stays durable in what is kept, so that a reload opens it durable', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await page.getByRole('switch', { name: 'Durable' }).click();
    await expect(page.getByTestId('durable-problem')).toBeVisible();
    await expect.poll(async () => (await editor.saved())?.queues['q1']?.durable).toBe(true);

    await page.reload();
    await editor.heading.waitFor();
    await editor.select('Queue queue1');

    await expect(page.getByRole('switch', { name: 'Durable' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('durable-problem')).toHaveCount(0);
  });

  test('goes away when something else is selected, and does not come back with it', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Queue');
    await editor.select('Queue queue1');
    await page.getByRole('switch', { name: 'Durable' }).click();
    await expect(page.getByTestId('durable-problem')).toBeVisible();

    await editor.select('Queue queue2');
    await expect(page.getByTestId('durable-problem')).toHaveCount(0);
    await editor.select('Queue queue1');

    await expect(page.getByTestId('durable-problem')).toHaveCount(0);
  });
});

test.describe('the fields of the inspector', () => {
  test('says why a name is refused, under the field, and puts back the name that the node has', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Queue');
    await editor.select('Queue queue2');
    const name = page.getByRole('textbox', { name: 'Name' });

    await name.fill('queue1');
    await name.press('Tab');

    await expect(name).toHaveValue('queue2');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('refusal-message')).toContainText('queue1');
    await expect(editor.node('Queue queue2')).toBeVisible();
  });

  test('says what is wrong with a position that is not a number, and keeps the node where it is', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    const before = (await editor.layout())['queue1']!;
    const x = page.getByRole('spinbutton', { name: 'X' });

    await x.fill('');
    await x.press('Tab');

    await expect(page.getByTestId('refusal-message')).toHaveText('X has to be a number. The node stays where it is.');
    await expect(x).toHaveValue(String(before.x));
    expect((await editor.layout())['queue1']).toEqual(before);
  });

  test('changes the type of an exchange, which is drawn in its badge, and its flags with switches', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Direct exchange');
    await expect(editor.node('Exchange exchange1, direct')).toContainText('direct');

    await page.getByRole('combobox', { name: 'Type' }).selectOption('fanout');
    await expect(editor.node('Exchange exchange1, fanout')).toContainText('fanout');

    const autoDelete = page.getByRole('switch', { name: 'Auto-delete' });
    await expect(autoDelete).toHaveAttribute('aria-checked', 'false');
    await autoDelete.click();
    await expect(autoDelete).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await editor.saved())?.exchanges['x1']?.type).toBe('fanout');
  });

  test('opens a sentence of help under its label, from a button, and closes it again', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Direct exchange');
    const help = page.getByRole('button', { name: 'Help: Internal' });

    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Producers cannot publish to an internal exchange.')).toBeVisible();

    await help.click();
    await expect(page.getByText('Producers cannot publish to an internal exchange.')).toHaveCount(0);
  });

  test('says what a selected edge is, and deletes it', async ({ page }) => {
    await seedCanvas(page, TOPOLOGY);
    const editor = new EditorPage(page);
    await editor.goto();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(4);

    // An edge is selected by clicking the line that was drawn for it.
    const line = page.locator('[data-edge="x1>q1"] path.f-connection-path');
    const at = await line.evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM()!;
      return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f };
    });
    await page.mouse.click(at.x, at.y);

    await expect(page.getByTestId('inspector-title')).toHaveText('Binding');
    await expect(page.getByTestId('inspector-edge')).toHaveText(
      'Binding from exchange orders to queue billing, key order.*',
    );
    await page.getByRole('button', { name: 'Delete this binding' }).click();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(3);
  });
});
