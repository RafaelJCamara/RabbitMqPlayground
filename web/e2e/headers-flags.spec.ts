import { HeadersPage } from './pages/headers-page';
import { FILES_BOUND, FILES_UNBOUND } from './support/headers';
import { ORDERS, UNLINKED } from './support/orders';
import { expect, test } from './support/test';

/**
 * The three halves that ADR-0069 gave the flag `headers`, in a real browser, with what is there and what is not for each: the conditions (with the editor), the table of a producer's headers (with the
 * simulation), and the table of recent messages and the binding made from a message (with the simulation and the explanation). The flag is gone (ADR-0084), and what is left of the halves is the
 * simulation and the explanation, which are the flags that are still there.
 */

const CONDITIONS = 'editor';
const PRODUCER = 'editor,simulation';
const MESSAGES = 'editor,simulation';

test.describe('the conditions, with the editor (ADR-0069)', () => {
  test('has the popover, the editor in the inspector and the chips, and nothing that needs the simulation', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: CONDITIONS });
    const { editor } = headers;

    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);
    await headers.selectBinding('x1>q1');
    await expect(headers.conditions().scope).toBeVisible();
    await expect(headers.conditions().live.scope).toHaveCount(0);
    await expect(editor.inspector.getByRole('textbox', { name: 'Key' })).toHaveCount(0);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await expect(editor.page.getByRole('group', { name: /^Conditions for the binding/ })).toBeVisible();
  });

  test('does not ask for conditions for an exchange that is not a headers exchange, which still asks for its key', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, UNLINKED, { flags: CONDITIONS });
    const { editor } = headers;

    // `jobs` is the direct exchange, `x2`, and `errors` the queue, `q1`.
    await editor.dragLinkTo('x2', await editor.centre(editor.nodeById('q1')));

    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await expect(page.getByRole('group', { name: /^Conditions for the binding/ })).toHaveCount(0);
  });
});

test.describe('the conditions leave the bindings of the other exchanges as they were (ADR-0066)', () => {
  test('keeps the key field for the binding of a direct exchange, which reads the key', async ({ page }) => {
    const headers = await HeadersPage.open(page, ORDERS, { flags: CONDITIONS });

    await headers.selectBinding('x1>q1');

    await expect(headers.editor.inspector.getByRole('textbox', { name: 'Key' })).toHaveValue('order.new');
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(0);
    await expect(headers.chips('x1>q1')).toHaveText(['order.new']);
  });
});

test.describe('the producer table, with the simulation (ADR-0069)', () => {
  test('has the table of the headers of the message, and the editor of a binding', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: PRODUCER });

    await headers.editor.select('Producer sender');

    await expect(headers.composer.getByTestId('composer-headers-table')).toBeVisible();
    await expect(headers.table.rows).toHaveCount(2);
    await headers.selectBinding('x1>q1');
    await expect(headers.conditions().scope).toBeVisible();
  });
});

test.describe('the messages, with the simulation (ADR-0069)', () => {
  test('has the table of recent messages in the editor of a binding, and the panel that makes a binding from a message', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, { flags: MESSAGES });
    await headers.publish();
    await headers.simulation.step();
    await headers.openByKey();
    await headers.openFromRow('unroutable');

    await expect(headers.message.getByTestId('bind-from-message')).toBeVisible();
  });

  test('has no table of recent messages without the simulation, which is where the messages are, and no panel', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: 'editor' });

    await headers.selectBinding('x1>q1');

    await expect(headers.conditions().scope).toBeVisible();
    await expect(headers.conditions().live.scope).toHaveCount(0);
    await expect(page.getByTestId('bind-from-message')).toHaveCount(0);
  });
});
