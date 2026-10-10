import { CanvasesPage } from './pages/canvases-page';
import { seedLibrary, buildDocument, type SeededCanvas } from './support/seed';
import { expect, test } from './support/test';

const HOUR = 3_600_000;

/** A document with a queue and an exchange bound to it, so that the card has something to count and to draw. */
const small = () =>
  buildDocument([
    {
      type: 'declare-exchange',
      name: 'orders',
      exchangeType: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    },
    { type: 'declare-queue', name: 'billing', durable: true },
    { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'k' },
  ]);

test.describe('several canvases, behind the flag canvases (ADR-0072)', () => {
  test('opens with the strip of open canvases, the one heading and the editor of a first canvas', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await expect(canvases.heading).toHaveCount(1);
    await expect(canvases.heading).toHaveText('RabbitMQ Playground');
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas']);
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas']);
    await expect(canvases.editor.toolbox).toBeVisible();
    await expect(canvases.editor.canvas).toBeVisible();
    await expect.poll(() => canvases.stored()).toEqual(['Untitled canvas']);
  });

  test('makes another canvas with New canvas, and shows it in a tab of its own', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await canvases.newCanvas();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas 2', 'Untitled canvas']);
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas 2']);
    await expect.poll(() => canvases.stored()).toEqual(['Untitled canvas', 'Untitled canvas 2']);
  });

  test('keeps the strip and the canvas that was shown, and what was built in it, across a reload', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.newCanvas();
    await canvases.editor.add('Queue');
    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
    await expect(canvases.editor.saveState).toHaveText('All changes saved');

    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas 2', 'Untitled canvas']);
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas 2']);
    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
  });

  test('writes what was done in a canvas before it is left, and finds it there when the canvas is opened again', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');

    // At once, without the half second that the autosave waits: leaving a canvas is what writes it.
    await canvases.showHome();
    await canvases.open('Untitled canvas');

    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
  });

  test('makes the editor again for each canvas, so a canvas that is opened has no history to undo', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');
    await expect(page.getByTestId('undo')).toBeEnabled();

    await canvases.showHome();
    await canvases.open('Untitled canvas');

    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
    await expect(page.getByTestId('undo')).toBeDisabled();
  });

  test('fills the window under the strip, and the page itself does not scroll', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    const { height, scrollHeight } = await page.evaluate(() => ({
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    const status = await canvases.editor.status.boundingBox();

    expect(scrollHeight).toBeLessThanOrEqual(height);
    expect(Math.round((status?.y ?? 0) + (status?.height ?? 0))).toBe(height);
  });

  test('shows on the card what was built in the canvas when the home is shown again', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');

    await canvases.showHome();

    await expect(canvases.card('Untitled canvas').getByTestId('card-size')).toHaveText('1 element');
  });

  test('shows the home with My canvases and a canvas again with its tab, and the strip is there throughout', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await canvases.showHome();
    await expect.poll(() => canvases.current()).toEqual(['My canvases']);
    await expect(canvases.editor.toolbox).toHaveCount(0);
    await expect(canvases.heading).toHaveCount(1);

    await canvases.showCanvas('Untitled canvas');
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas']);
    await expect(canvases.home).toHaveCount(0);
  });

  test('renames the canvas of a tab with a double click, and with F2 when the tab has the cursor', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await canvases.tab('Untitled canvas').dblclick();
    const field = canvases.dialog.getByRole('textbox', { name: 'Name' });
    await expect(canvases.dialog).toHaveAccessibleName('Rename canvas');
    await expect(field).toHaveValue('Untitled canvas');
    await field.fill('Orders');
    await page.keyboard.press('Enter');
    await expect(canvases.dialog).toHaveCount(0);
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Orders']);

    await canvases.tab('Orders').focus();
    await page.keyboard.press('F2');
    await expect(canvases.dialog).toBeVisible();
    await page.keyboard.type('Billing');
    await page.keyboard.press('Enter');
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Billing']);
    await expect(canvases.tab('Billing')).toHaveAttribute('title', 'Double-click or press F2 to rename');
    expect(await canvases.stored()).toEqual(['Billing']);
  });

  test('closes a tab without deleting the canvas, which is on the home and can be opened again', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.newCanvas();

    await canvases.closeTab('Untitled canvas 2');

    await canvases.editorReady();
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas']);
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas']);
    await expect.poll(() => canvases.stored()).toEqual(['Untitled canvas', 'Untitled canvas 2']);
    await canvases.showHome();
    await canvases.open('Untitled canvas 2');
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas 2', 'Untitled canvas']);
  });

  test('shows the home when the last tab is closed, and the strip is kept as it is', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await canvases.closeTab('Untitled canvas');

    await expect(canvases.home).toBeVisible();
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases']);
    await expect.poll(() => canvases.storedStrip()).toEqual([]);
    await expect.poll(() => canvases.stored()).toEqual(['Untitled canvas']);
  });

  test('brings back the strip that was kept, in its order, and shows the canvas that was open last', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(
      page,
      [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
        { id: 'gamma', name: 'Gamma' },
      ],
      { openCanvases: ['gamma', 'alpha'], lastOpenCanvas: 'alpha' },
    );

    await canvases.goto();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Gamma', 'Alpha']);
    await expect.poll(() => canvases.current()).toEqual(['Alpha']);
  });

  test('drops from the strip a canvas that has gone, and does not mind', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [{ id: 'alpha', name: 'Alpha' }], {
      openCanvases: ['gone', 'alpha'],
      lastOpenCanvas: 'gone',
    });

    await canvases.goto();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Alpha']);
    await expect.poll(() => canvases.storedStrip()).toEqual(['alpha']);
  });
});

test.describe('the home, My canvases (ADR-0073)', () => {
  test('has a card for each canvas, with its name, when it was edited and how much is on it, the one edited last first', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    const now = Date.now();
    await seedLibrary(page, [
      { id: 'old', name: 'Old one', updatedAt: now - 5 * HOUR },
      { id: 'busy', name: 'Busy one', document: small(), updatedAt: now - 3 * HOUR },
      { id: 'new', name: 'New one', updatedAt: now - 60_000 },
    ]);
    await canvases.goto();

    await canvases.showHome();

    await expect.poll(() => canvases.cardNames()).toEqual(['New one', 'Busy one', 'Old one']);
    await expect(canvases.card('Busy one')).toContainText('Edited 3 hours ago');
    await expect(canvases.card('Busy one')).toContainText('2 elements');
    await expect(canvases.card('New one')).toContainText('Edited 1 minute ago');
    await expect(canvases.card('Old one')).toContainText('0 elements');
    await expect(canvases.count).toHaveText('3 canvases');
  });

  test('draws a canvas on its card from the layout, and says "Empty" for one that has nothing on it', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'busy', name: 'Busy', document: small() },
      { id: 'blank', name: 'Blank' },
    ]);
    await canvases.goto();
    await canvases.showHome();

    const drawing = canvases.card('Busy').getByTestId('thumbnail');
    await expect(drawing).toBeVisible();
    await expect(drawing.locator('path')).toHaveCount(2);
    await expect(drawing.locator('line')).toHaveCount(1);
    await expect(canvases.card('Blank').getByTestId('thumbnail-empty')).toHaveText('Empty');
  });

  test('scrolls the home and not the page when there are many canvases, so that the strip stays in view', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(
      page,
      Array.from({ length: 60 }, (_, index) => ({
        id: `c${String(index).padStart(2, '0')}`,
        name: `Canvas ${String(index).padStart(2, '0')}`,
      })),
    );
    await canvases.goto();

    await canvases.showHome();

    await expect(canvases.home.getByRole('article')).toHaveCount(48);
    const { page: pageOverflow, home: homeOverflow } = await page.evaluate(() => {
      const home = document.querySelector('main[aria-labelledby="rmq-home-title"]') as HTMLElement;
      return {
        page: document.documentElement.scrollHeight - window.innerHeight,
        home: home.scrollHeight - home.clientHeight,
      };
    });
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(homeOverflow).toBeGreaterThan(0);
    await expect(canvases.strip).toBeInViewport();
  });

  test('opens a canvas from its card, in a tab of its own', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.open('One');

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'One', 'Two']);
    await expect.poll(() => canvases.current()).toEqual(['One']);
  });

  test('opens a canvas when its drawing is pressed, and renames it when its name is double-clicked, and only then', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    await canvases.goto();
    await canvases.showHome();
    // The drawing is a pointer's copy of Open: a keyboard and a screen reader meet six buttons on a card, and one of them is Open.
    await expect(canvases.card('One').getByRole('button')).toHaveCount(6);
    await expect(canvases.card('One').getByRole('button', { name: /^Open / })).toHaveCount(1);

    await canvases.card('One').getByRole('heading', { level: 3, name: 'One', exact: true }).click();
    await expect(canvases.home).toBeVisible();
    await expect(canvases.dialog).toHaveCount(0);

    await canvases.card('One').getByTestId('card-drawing').click();
    await canvases.editorReady();
    await expect.poll(() => canvases.current()).toEqual(['One']);
    await expect(canvases.home).toHaveCount(0);

    await canvases.showHome();
    await canvases.card('Two').getByRole('heading', { level: 3, name: 'Two', exact: true }).dblclick();
    await expect(canvases.dialog).toHaveAccessibleName('Rename canvas');
    await expect(canvases.dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Two');
    await canvases.dialog.getByRole('textbox', { name: 'Name' }).fill('Second');
    await page.keyboard.press('Enter');
    await expect(canvases.dialog).toHaveCount(0);

    await expect.poll(async () => (await canvases.cardNames()).sort()).toEqual(['One', 'Second']);
    await expect.poll(() => canvases.stored().then((names) => [...names].sort())).toEqual(['One', 'Second']);
    await expect(canvases.home).toBeVisible();
  });

  test('renames a canvas in a dialog that has the cursor in the field, with the name selected, and the tab follows', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await canvases.action('Untitled canvas', 'Rename').click();
    const field = canvases.dialog.getByRole('textbox', { name: 'Name' });

    await expect(canvases.dialog).toHaveAccessibleName('Rename canvas');
    await expect(field).toBeFocused();
    expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
      0,
      'Untitled canvas'.length,
    ]);
    await page.keyboard.type('Orders flow');
    await page.keyboard.press('Enter');
    await expect(canvases.dialog).toHaveCount(0);

    await expect.poll(() => canvases.cardNames()).toEqual(['Orders flow']);
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Orders flow']);
    await expect.poll(() => canvases.stored()).toEqual(['Orders flow']);
    await expect(canvases.action('Orders flow', 'Rename')).toBeFocused();
  });

  test('says why a name that is blank cannot be used, in the dialog, and keeps it open with the cursor in the field', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await canvases.action('Untitled canvas', 'Rename').click();
    const field = canvases.dialog.getByRole('textbox', { name: 'Name' });
    await field.fill('   ');
    await canvases.dialog.getByRole('button', { name: 'Rename', exact: true }).click();

    await expect(canvases.dialog.getByRole('alert')).toHaveText(
      'A canvas needs a name, and this one is blank. Type a name.',
    );
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Escape');
    await expect(canvases.dialog).toHaveCount(0);
    await expect.poll(() => canvases.stored()).toEqual(['Untitled canvas']);
  });

  test('keeps a new name across a reload', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    await canvases.rename('Untitled canvas', 'Kept');

    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Kept']);
  });

  test('makes a copy of a canvas as it is saved, opens it, and names it', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [{ id: 'busy', name: 'Busy', document: small() }]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.action('Busy', 'Duplicate').click();
    await canvases.editorReady();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Busy (copy)', 'Busy']);
    await expect.poll(() => canvases.current()).toEqual(['Busy (copy)']);
    await expect(canvases.editor.node('Exchange orders, direct')).toBeVisible();
    await expect.poll(() => canvases.stored()).toEqual(['Busy', 'Busy (copy)']);
  });

  test('searches by name as it is typed, without minding case or accents, and says how many', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'a', name: 'Orders flow' },
      { id: 'b', name: 'Café société' },
      { id: 'c', name: 'Fan-out' },
      { id: 'd', name: 'orders' },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.search.fill('ORD');
    await expect.poll(async () => (await canvases.cardNames()).sort()).toEqual(['Orders flow', 'orders']);
    await expect(canvases.count).toHaveText('2 of 4 canvases');

    await canvases.search.fill('societe');
    await expect.poll(() => canvases.cardNames()).toEqual(['Café société']);

    await canvases.search.fill('zzz');
    await expect(canvases.home.getByText('No canvas has “zzz” in its name.')).toBeVisible();
    await expect(canvases.count).toHaveText('No canvases match.');
    await canvases.home.getByRole('button', { name: 'Show all canvases' }).click();
    await expect.poll(() => canvases.cardNames()).toHaveLength(4);
    await expect(canvases.search).toHaveValue('');
  });

  test('sorts by last edited, created, name and size', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    const now = Date.now();
    await seedLibrary(page, [
      { id: 'a', name: 'banana', createdAt: now - 30 * HOUR, updatedAt: now - HOUR },
      { id: 'b', name: 'Apple', createdAt: now - 10 * HOUR, updatedAt: now - 3 * HOUR, document: small() },
      { id: 'c', name: 'cherry', createdAt: now - 20 * HOUR, updatedAt: now - 2 * HOUR },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await expect.poll(() => canvases.cardNames()).toEqual(['banana', 'cherry', 'Apple']);
    await canvases.sort.selectOption('created');
    await expect.poll(() => canvases.cardNames()).toEqual(['Apple', 'cherry', 'banana']);
    await canvases.sort.selectOption('name');
    await expect.poll(() => canvases.cardNames()).toEqual(['Apple', 'banana', 'cherry']);
    await canvases.sort.selectOption('size');
    await expect.poll(() => canvases.cardNames()).toEqual(['Apple', 'banana', 'cherry']);
  });

  test('draws 48 cards at a time, and shows 48 more on a button', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    const now = Date.now();
    const many: SeededCanvas[] = Array.from({ length: 60 }, (_, index) => ({
      id: `c${String(index).padStart(2, '0')}`,
      name: `Canvas ${String(index).padStart(2, '0')}`,
      updatedAt: now - index * 1000,
    }));
    await seedLibrary(page, many);
    await canvases.goto();
    await canvases.showHome();

    await expect.poll(() => canvases.cardNames()).toHaveLength(48);
    await expect(canvases.count).toHaveText('60 canvases');
    await canvases.home.getByRole('button', { name: 'Show more' }).click();

    await expect.poll(() => canvases.cardNames()).toHaveLength(60);
    await expect(canvases.home.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(canvases.action('Canvas 48', 'Open')).toBeFocused();
  });
});
