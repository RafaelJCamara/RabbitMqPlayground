import { HeadersPage } from './pages/headers-page';
import { FILES_BOUND, LONG_VALUE, MANY_CONDITIONS } from './support/headers';
import { expect, test } from './support/test';

/**
 * What the label of a headers binding says on the canvas (S8, ADR-0070): a chip with the mode and the first conditions, `+N more` inside it when there are more, the whole of it in the card behind the label and in the
 * name of the edge, and a mark on a condition that the mode does not count. They need the flag `editor`.
 */

test.describe('the label of a headers binding (ADR-0070)', () => {
  test('is a chip with the mode first and then the conditions as a command writes them', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);

    await expect(headers.chips('x1>q1')).toHaveText(['all · format=pdf · type=report']);
    await expect(headers.chips('x1>q2')).toHaveText(['any · format=tiff · dpi=300']);
  });

  test('is no wider than the line between two nodes that are laid out 160 apart, and goes on to the next line where its text is longer, so that it is never cut', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);

    const long = headers.chips('x1>q1').first();

    await expect(long).toHaveClass(/rmq-chip-conditions/);
    await expect(long).toHaveCSS('max-width', '118px');
    await expect(long).toHaveCSS('white-space', 'normal');
    const box = (await long.boundingBox())!;
    expect(box.width, 'no wider than 118').toBeLessThanOrEqual(118);
    expect(box.height, 'four lines of 16 and the room above and below them').toBeGreaterThan(60);
    expect(await long.evaluate((element) => element.scrollWidth <= element.clientWidth), 'nothing is cut').toBe(true);
  });

  test('is drawn between the nodes that its edge joins, and the labels of two edges are drawn clear of each other and of every node', async ({
    page,
  }) => {
    await HeadersPage.open(page, MANY_CONDITIONS);
    const boxes = async (selector: string) =>
      page.locator(selector).evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return {
            id: element.getAttribute('data-label') ?? element.getAttribute('data-node-id'),
            x,
            y,
            width,
            height,
          };
        }),
      );
    const meet = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    const labels = await boxes('[data-label]');
    const nodes = await boxes('[data-node-id]');

    expect(labels).toHaveLength(2);
    for (const label of labels) {
      for (const node of nodes) {
        expect(meet(label, node), `the label of ${label.id} is not under the node ${node.id}`).toBe(false);
      }
    }
    expect(meet(labels[0]!, labels[1]!), 'the two labels do not meet').toBe(false);
    // And each is in the middle of its edge: the library does not push it to one side to keep it off a node.
    for (const label of labels) {
      const edge = page.locator(`[data-edge="${label.id}"] path.f-connection-path`);
      const middle = await edge.evaluate((path: SVGPathElement) => {
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        return point.x * path.getScreenCTM()!.a + path.getScreenCTM()!.e;
      });
      expect(
        Math.abs(label.x + label.width / 2 - middle),
        `the label of ${label.id} is centred on its edge`,
      ).toBeLessThanOrEqual(3);
    }
  });

  test('says the first three conditions and then how many more there are, inside the chip, and writes out a mode that counts x- names', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);

    await expect(headers.chips('x1>q1')).toHaveText(['all-with-x · format=pdf · type=report · size=10 · +3 more']);
  });

  test('marks a condition that the mode does not count as ignored, and does not when the mode counts it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);

    await expect(headers.chips('x1>q2')).toHaveText(['all · format=tiff · x-region=eu (ignored)']);
    await expect(headers.chips('x1>q1')).not.toContainText('(ignored)');
  });

  test('keeps each dot with the word before it, and the count with its word, so that no line of a chip begins with a dot or with "more"', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);
    const space = String.fromCodePoint(0xa0);

    const text = await headers
      .chips('x1>q1')
      .first()
      .evaluate((chip) => chip.textContent);

    expect(text).toBe(`all-with-x${space}· format=pdf${space}· type=report${space}· size=10${space}· +3${space}more`);
  });

  test('breaks a value that has no space in it where the line ends, and does not let it out of the chip', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, LONG_VALUE);

    const chip = headers.chips('x1>q1').first();

    await expect(chip).toContainText('description=' + 'x'.repeat(40));
    const box = (await chip.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(118);
    expect(await chip.evaluate((element) => element.scrollWidth <= element.clientWidth), 'nothing is out of it').toBe(
      true,
    );
    await expect(chip).toHaveCSS('overflow-wrap', 'anywhere');
  });

  test('lists every condition in a card while the pointer is over a label that cuts them, which stays while the pointer is on it and goes on Escape', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);

    await headers.label('x1>q1').hover();

    await expect(headers.labelCard).toBeVisible();
    await expect(headers.labelCard).toHaveAccessibleName('Bindings from exchange files to queue pdfs');
    await expect(headers.labelCard.locator('li')).toHaveText([
      'all-with-x · format=pdf · type=report · size=10 · big=false · exists(author) · x-region=eu',
    ]);
    await headers.labelCard.hover();
    await expect(headers.labelCard).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(headers.labelCard).toHaveCount(0);
  });

  test('has no card when it says everything that it has, and so a label of a few short conditions is not covered', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND);

    await headers.label('x1>q1').hover();
    await headers.editor.settled();

    await expect(headers.labelCard).toHaveCount(0);
  });

  test('says the mode and the conditions in the name of the edge, for a screen reader, and the count is not the only thing it says', async ({
    page,
  }) => {
    await HeadersPage.open(page, MANY_CONDITIONS);

    await expect(page.locator('[data-edge="x1>q1"]')).toHaveAttribute(
      'aria-label',
      /x-match all-with-x: format=pdf, type=report, size=10, big=false, exists\(author\), x-region=eu/,
    );
    await expect(page.locator('[data-edge="x1>q2"]')).toHaveAttribute(
      'aria-label',
      /x-match all: format=tiff, x-region=eu \(ignored\)/,
    );
  });

  test('keeps the labels of two edges that start from one exchange apart, wide as they are', async ({ page }) => {
    const headers = await HeadersPage.open(page, MANY_CONDITIONS);

    const first = (await headers.label('x1>q1').boundingBox())!;
    const second = (await headers.label('x1>q2').boundingBox())!;

    const apart =
      first.x + first.width <= second.x ||
      second.x + second.width <= first.x ||
      first.y + first.height <= second.y ||
      second.y + second.height <= first.y;
    expect(apart, `the labels ${JSON.stringify(first)} and ${JSON.stringify(second)} do not overlap`).toBe(true);
  });
});
