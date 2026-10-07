import { HeadersPage } from './pages/headers-page';
import { FILES, FILES_BOUND, FILES_UNBOUND } from './support/headers';
import { ORDERS, UNLINKED } from './support/orders';
import { expect, test } from './support/test';

/**
 * The flag `headers` in a real browser, in the three halves that ADR-0069 gives it, with what is there and what is not for each: the conditions (with the editor), the table of a producer's headers (with the
 * simulation), and the table of recent messages and the binding made from a message (with the simulation and the explanation). Without the flag nothing of S8 is there, and the app is what it was.
 */

const WITHOUT = 'editor';
const CONDITIONS = 'editor,headers';
const PRODUCER = 'editor,simulation,headers';
const MESSAGES = 'editor,simulation,explain,headers';

test.describe('without the flag headers (ADR-0004)', () => {
  test('a link to a queue from a headers exchange is made at once, with no conditions, as it was', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES, { flags: WITHOUT });
    const { editor } = headers;

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));

    await expect.poll(() => editor.edges()).toContain('files -> pdfs key=');
    await expect(headers.popover('exchange files', 'queue pdfs').scope).toHaveCount(0);
    expect(await editor.log()).toEqual(['bind files -> pdfs']);
  });

  test('a binding that has arguments has the field of its key, a note that says where its arguments are written, and the chip headers', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: WITHOUT });

    await expect(headers.chips('x1>q1')).toHaveText(['headers']);
    await expect(page.locator('[data-edge="x1>q1"]')).toHaveAttribute(
      'aria-label',
      'Binding from exchange files to queue pdfs, with header arguments',
    );
    await headers.selectBinding('x1>q1');

    await expect(headers.editor.inspector.getByRole('textbox', { name: 'Key' })).toBeVisible();
    await expect(headers.editor.inspector.getByTestId('binding-headers')).toHaveText(
      'This binding has header arguments, which are written with the command bar for now.',
    );
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(0);
  });

  test('the producer says how many headers its message has, and where the table to edit them is coming', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: 'editor,simulation' });

    await headers.editor.select('Producer sender');

    await expect(headers.composer.getByTestId('composer-headers')).toHaveText(
      'The message has 2 headers. The table to edit them is coming with the headers exchange.',
    );
    await expect(headers.composer.getByTestId('composer-headers-table')).toHaveCount(0);
    // The note about the routing key of a headers exchange is a part of the table, and is not there without it.
    await expect(headers.composer.getByTestId('composer-key-note')).toHaveCount(0);
  });

  test('a message that is open has no panel that makes a binding from it, and a binding has no table of recent messages', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: 'editor,simulation,explain' });
    await headers.publish();
    await headers.simulation.step();
    await headers.openByKey();
    await headers.openFromRow('routed');

    await expect(headers.message).toBeVisible();
    await expect(headers.message.getByTestId('bind-from-message')).toHaveCount(0);
    await headers.selectBinding('x1>q1');
    await expect(headers.editor.inspector.getByTestId('headers-live')).toHaveCount(0);
  });
});

test.describe('the conditions, with the flags editor and headers (ADR-0069)', () => {
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
  test('keeps the key field for the binding of a direct exchange, which reads the key, with the flag on', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, ORDERS, { flags: CONDITIONS });

    await headers.selectBinding('x1>q1');

    await expect(headers.editor.inspector.getByRole('textbox', { name: 'Key' })).toHaveValue('order.new');
    await expect(headers.editor.inspector.getByTestId('binding-conditions')).toHaveCount(0);
    await expect(headers.chips('x1>q1')).toHaveText(['order.new']);
  });
});

test.describe('the producer table, with the flags editor, simulation and headers (ADR-0069)', () => {
  test('has the table of the headers of the message, and no table of recent messages without the explanation', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: PRODUCER });

    await headers.editor.select('Producer sender');

    await expect(headers.composer.getByTestId('composer-headers-table')).toBeVisible();
    await expect(headers.composer.getByTestId('composer-headers')).toHaveCount(0);
    await expect(headers.table.rows).toHaveCount(2);
    await headers.selectBinding('x1>q1');
    await expect(headers.conditions().scope).toBeVisible();
    await expect(headers.conditions().live.scope).toHaveCount(0);
  });
});

test.describe('the messages, with the flags editor, simulation, explain and headers (ADR-0069)', () => {
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
    const headers = await HeadersPage.open(page, FILES_BOUND, { flags: 'editor,explain,headers' });

    await headers.selectBinding('x1>q1');

    await expect(headers.conditions().scope).toBeVisible();
    await expect(headers.conditions().live.scope).toHaveCount(0);
    await expect(page.getByTestId('bind-from-message')).toHaveCount(0);
  });
});
