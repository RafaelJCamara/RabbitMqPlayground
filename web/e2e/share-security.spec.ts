import { createHash } from 'node:crypto';
import { snapshotAfter } from '@rmq/testing';
import { SharedViewPage } from './pages/share-page';
import { SimulationPage } from './pages/simulation-page';
import { payloadFor } from './support/links';
import { buildDocument } from './support/seed';
import { expect, test } from './support/test';

/**
 * What a link may not do (ADR-0013, ADR-0078). A shared canvas is made of what a stranger wrote: every name in it is text on the screen, and nothing in it runs. The first wall is that the app shows
 * it with the text binding of Angular and has no way around that (the linter holds it); the second is the content security policy of the built page, which these tests read, and try.
 */

const IMAGE = '<img src=x onerror="window.pwned=1">';
const SCRIPT = '<script>window.pwned=2</script>';
const VECTOR = '<svg onload="window.pwned=3">';
const LOCATION = 'javascript:window.pwned=4';
const BREAKOUT = '"><b id="broken">x</b>';

/** A canvas with markup and code for every name and every text it has. */
const hostile = () =>
  buildDocument([
    { type: 'add-producer', name: LOCATION },
    {
      type: 'declare-exchange',
      name: SCRIPT,
      exchangeType: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    },
    { type: 'declare-queue', name: VECTOR, durable: true },
    { type: 'add-consumer', name: BREAKOUT },
    { type: 'bind', source: SCRIPT, destination: { kind: 'queue', name: VECTOR }, key: IMAGE },
    { type: 'link', producer: LOCATION, target: { kind: 'exchange', name: SCRIPT } },
    { type: 'subscribe', consumer: BREAKOUT, queue: VECTOR },
    { type: 'set', kind: 'producer', name: LOCATION, changes: { key: IMAGE, payload: SCRIPT } },
  ]);

/** What a script of the page's own could have set. */
const pwned = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Record<string, unknown>)['pwned']);

test.describe('plain text (ADR-0078)', () => {
  test('shows every name of a link as the text it was written as, and nothing runs, loads or is made of it', async ({
    visitor,
  }) => {
    const payload = await payloadFor({ name: IMAGE, document: hostile() });
    const other = await visitor();

    await other.goto(`#c=${payload}`);

    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.name).toHaveText(`Shared canvas “${IMAGE}”`);
    await expect(shared.editor.node(`Exchange ${SCRIPT}`)).toBeVisible();
    await expect(shared.editor.node(`Queue ${VECTOR}`)).toBeVisible();
    await expect(shared.editor.node(`Producer ${LOCATION}`)).toBeVisible();
    await expect(shared.editor.node(`Consumer ${BREAKOUT}`)).toBeVisible();
    // The text of the nodes is the text that was written, and not what a browser would make of it.
    const texts = await other.locator('[data-node-id]').evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(texts.join(' ')).toContain(SCRIPT);
    expect(texts.join(' ')).toContain(VECTOR);
    // Selecting a node says in the inspector what it is joined to, by name, as text too.
    await shared.editor.select(`Producer ${LOCATION}`);
    await expect(other.getByTestId('inspector-joins')).toContainText(SCRIPT);

    const found = await other.evaluate(() => ({
      images: document.querySelectorAll('img').length,
      handlers: document.querySelectorAll('[onload], [onerror], [onclick]').length,
      broken: document.getElementById('broken') === null,
      // The one script that is not a file is the one that the build puts in the page to turn a style sheet on.
      inlineScripts: [...document.scripts].filter((script) => script.src === '').length,
    }));
    expect(found).toEqual({ images: 0, handlers: 0, broken: true, inlineScripts: 1 });
    expect(await pwned(other)).toBeUndefined();
  });

  test('shows the messages of a link as text too: a payload and a key that are markup', async ({ visitor }) => {
    const document = hostile();
    const payload = await payloadFor({ name: 'Markup', document, simulation: snapshotAfter(document, 180) });
    const other = await visitor();

    await other.goto(`#c=${payload}`);

    const shared = new SharedViewPage(other);
    await shared.ready();
    const simulation = new SimulationPage(shared.editor);
    await simulation.bar.waitFor();
    await expect.poll(async () => (await simulation.state())?.running).toBe(false);
    expect((await simulation.view()).published).toBeGreaterThan(0);
    await expect(other.locator('img')).toHaveCount(0);
    expect(await pwned(other)).toBeUndefined();
  });

  test('shows the reason a link cannot be opened as text, whatever it quotes', async ({ visitor }) => {
    const other = await visitor();

    await other.goto(`#c=${encodeURIComponent(IMAGE)}`);

    await expect(other.getByTestId('link-failed')).toBeVisible();
    await expect(other.locator('img')).toHaveCount(0);
    expect(await pwned(other)).toBeUndefined();
  });
});

test.describe('the content security policy of the built page (ADR-0078)', () => {
  const META = 'meta[http-equiv="Content-Security-Policy"]';

  const directives = (policy: string): Map<string, string[]> =>
    new Map(
      policy.split('; ').map((directive) => {
        const [name = '', ...sources] = directive.split(' ');
        return [name, sources];
      }),
    );

  for (const [description, path] of [
    ['the page', ''],
    ['the page that Pages serves for a deep link (404.html)', 'some/deep/link'],
  ] as const) {
    test(`is in ${description}, right after the character set, before anything else can run`, async ({ page }) => {
      await page.goto(path);

      const order = await page.evaluate(() =>
        [...document.head.children]
          .slice(0, 2)
          .map((element) => element.getAttribute('charset') ?? element.getAttribute('http-equiv')),
      );
      expect(order).toEqual(['utf-8', 'Content-Security-Policy']);
      await expect(page.locator(META)).toHaveCount(1);
    });
  }

  test('lets only the files of the page, and the one inline script that the build made, run, and no text at all', async ({
    page,
  }) => {
    await page.goto('');

    const policy = directives((await page.locator(META).getAttribute('content')) ?? '');
    const inline = await page.evaluate(() =>
      [...document.scripts].filter((script) => script.src === '').map((script) => script.textContent ?? ''),
    );

    expect(inline).toHaveLength(1);
    const hash = `'sha256-${createHash('sha256')
      .update(inline[0] ?? '', 'utf8')
      .digest('base64')}'`;
    expect(policy.get('script-src')).toEqual(["'self'", hash]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    for (const [name, sources] of policy) {
      expect(sources, name).not.toContain("'unsafe-eval'");
      expect(sources, name).not.toContain('*');
      if (name === 'script-src') {
        expect(sources).not.toContain("'unsafe-inline'");
      }
    }
    // The inline script ran, under the policy: it is the one that turns the style sheet on.
    await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('media', 'all');
  });

  test('refuses what a page would have to run to be attacked: a script made of text, one from another origin, eval, a handler in markup, an image or a request from elsewhere', async ({
    context,
  }) => {
    // A page of its own, which the check for problems does not watch: it is made to break its policy.
    const page = await context.newPage();
    // What Playwright evaluates is let through by the browser, and so is everything that it calls, so eval is tried by a script of the page's own origin, which the policy lets run.
    await page.route('**/eval-probe.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: "try { new Function('return 1'); window.evalProbe = 'ran'; } catch (error) { window.evalProbe = error.name; }",
      }),
    );
    await page.goto('');

    const result = await page.evaluate(
      () =>
        new Promise<{ directives: string[]; ran: string[]; evalResult: unknown }>((resolve) => {
          const global = window as unknown as Record<string, unknown>;
          const directives: string[] = [];
          document.addEventListener('securitypolicyviolation', (event) => directives.push(event.violatedDirective));
          const inline = document.createElement('script');
          inline.textContent = 'window.ranInline = true';
          document.head.append(inline);
          const foreign = document.createElement('script');
          foreign.src = 'https://example.invalid/x.js';
          document.head.append(foreign);
          const probe = document.createElement('script');
          probe.src = 'eval-probe.js';
          document.head.append(probe);
          const button = document.createElement('button');
          button.setAttribute('onclick', 'window.ranHandler = true');
          document.body.append(button);
          button.click();
          new Image().src = 'https://example.invalid/x.png';
          fetch('https://example.invalid/data').catch(() => undefined);
          setTimeout(
            () =>
              resolve({
                directives,
                ran: ['ranInline', 'ranHandler'].filter((name) => global[name] !== undefined),
                evalResult: global['evalProbe'],
              }),
            500,
          );
        }),
    );

    expect(result.ran).toEqual([]);
    expect(result.evalResult).toBe('EvalError');
    expect(new Set(result.directives)).toEqual(
      new Set(['script-src-elem', 'script-src', 'script-src-attr', 'img-src', 'connect-src']),
    );
    await page.close();
  });
});
