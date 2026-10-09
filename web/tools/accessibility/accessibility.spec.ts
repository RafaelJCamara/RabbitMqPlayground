import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  axeCallsOf,
  axeStatesOf,
  axeTagsOf,
  checkComponents,
  checkMachines,
  checkReferences,
  checkRows,
  checkStates,
  checkThemes,
  componentsInDocument,
  referencesOf,
  sectionOf,
  selectorsOf,
  tablesOf,
  textHas,
  type Exception,
} from './accessibility';

/**
 * ADR-0085: `docs/accessibility.md` lists the screens and states of the app, each with the test that runs axe on it in both themes, and this holds the list to the code. The first half runs the checks on the repository.
 * The second half runs each of them on text that has been made wrong, so that a check that cannot fail is found out here.
 */

const web = fileURLToPath(new URL('../../', import.meta.url));
const DOCUMENT_PATH = fileURLToPath(new URL('../../../docs/accessibility.md', import.meta.url));

/** The text of a file by its path from `web/`, or `null` when there is none. */
const read = (path: string): string | null =>
  existsSync(`${web}${path}`) ? readFileSync(`${web}${path}`, 'utf8') : null;
const document = readFileSync(DOCUMENT_PATH, 'utf8');

/** The files of the app that are not specs: where the components are. */
function sourcesOfTheApp(): Map<string, string> {
  const root = `${web}projects/app/src/app/`;
  const sources = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const path = entry.replaceAll('\\', '/');
    if (path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.d.ts')) {
      sources.set(path, readFileSync(`${root}${path}`, 'utf8'));
    }
  }
  return sources;
}

/** Every end-to-end spec, by its path from `web/`. */
function endToEndSpecs(): Map<string, string> {
  const specs = new Map<string, string>();
  for (const file of readdirSync(`${web}e2e`).filter((name) => name.endsWith('.spec.ts'))) {
    specs.set(`e2e/${file}`, readFileSync(`${web}e2e/${file}`, 'utf8'));
  }
  return specs;
}

/** The specs that call axe. */
const specsThatRunAxe = (specs: ReadonlyMap<string, string>): Map<string, string> =>
  new Map([...specs].filter(([, text]) => text.includes('expectNoAxeViolations')));

/**
 * The calls of axe that are not in a loop over the two themes, and why. `e2e/smoke.spec.ts` has two tests that choose the theme on the page itself, with `data-theme`, over a system setting of the other one,
 * to hold that the page's choice wins: the loop would set the system setting, which is what these tests set the other way on purpose.
 */
const EXCEPTIONS: readonly Exception[] = [
  {
    spec: 'e2e/smoke.spec.ts',
    test: 'data-theme="dark" wins over a light operating system setting, with no axe violations',
    reason:
      'It sets the system to light on purpose and chooses dark on the page, to hold that the page wins; the loop would set the system.',
  },
  {
    spec: 'e2e/smoke.spec.ts',
    test: 'data-theme="light" wins over a dark operating system setting, with no axe violations',
    reason:
      'It sets the system to dark on purpose and chooses light on the page, to hold that the page wins; the loop would set the system.',
  },
];

const specs = endToEndSpecs();
const axeSpecs = specsThatRunAxe(specs);
const selectors = new Set([...sourcesOfTheApp()].flatMap(([path, text]) => selectorsOf(path, text)));

describe('docs/accessibility.md', () => {
  it('has read the app, the specs and the document, so that the checks below look at something', () => {
    // A check that reads nothing passes. These are well under what the repository has, so that a reader that finds nothing is found out and a state that is removed is not.
    expect(selectors.size).toBeGreaterThanOrEqual(50);
    expect(axeSpecs.size).toBeGreaterThanOrEqual(8);
    expect([...axeSpecs].flatMap(([path, text]) => axeStatesOf(path, text)).length).toBeGreaterThanOrEqual(100);
    expect(referencesOf(document).length).toBeGreaterThanOrEqual(100);
    expect(tablesOf(document).length).toBeGreaterThanOrEqual(10);
  });

  it('has a row for every component of the app, and names no component that the app does not have', () => {
    expect(checkComponents(document, selectors)).toEqual([]);
  });

  it('points every test that it names to a spec that is in the repository and has the words', () => {
    expect(checkReferences(document, read)).toEqual([]);
  });

  it('has a row for every state that a spec runs axe on, so that a new state without a row fails', () => {
    expect(checkStates(document, axeSpecs)).toEqual([]);
  });

  it('gives every row of a table of states a test that runs axe on it', () => {
    expect(checkRows(document)).toEqual([]);
  });

  it('runs axe in both themes: every call is in a loop over light and dark that uses the theme, except the ones that say why', () => {
    expect(checkThemes(specs, EXCEPTIONS)).toEqual([]);
  });

  it('has the section of what machines check, with the specs that it names and the tags that axe runs with', () => {
    const helper = read('e2e/support/axe.ts') ?? '';

    expect(axeTagsOf(helper)).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);
    expect(checkMachines(document, (path) => read(path) !== null, axeTagsOf(helper))).toEqual([]);
  });

  it('ends with the manual pass with a screen reader, which is for a person', () => {
    const headings = document.split(/\r?\n/).filter((line) => line.startsWith('## '));

    expect(headings.at(-1)).toBe('## The manual pass with a screen reader');
    expect(sectionOf(document, 'The manual pass with a screen reader')).toContain('| 23 |');
  });
});

describe('the checks of the document can fail', () => {
  describe('on the components', () => {
    it('names a component that is in no row, even though its name is in the text', () => {
      const without = document
        .split('\n')
        .filter((line) => !line.includes('`rmq-link-failed`'))
        .join('\n');

      expect(checkComponents(without, selectors)).toEqual([
        'The component rmq-link-failed is in no row of docs/accessibility.md: say in which state axe looks at it.',
      ]);
    });

    it('does not count a component that is only named in a sentence', () => {
      const aSentence = document
        .split('\n')
        .map((line) => (line.includes('`rmq-link-failed`') ? '' : line))
        .join('\n')
        .concat('\nThe page of a link that cannot be opened is `rmq-link-failed`.\n');

      expect(componentsInDocument(aSentence).anywhere.has('rmq-link-failed')).toBe(true);
      expect(checkComponents(aSentence, selectors)).toHaveLength(1);
    });

    it('names a component that the document has and the app has not', () => {
      const invented = `${document}\n| Imaginary | \`rmq-imaginary\` | nothing |\n`;

      expect(checkComponents(invented, selectors)).toEqual([
        'docs/accessibility.md names rmq-imaginary, which is the selector of no component of the app.',
      ]);
    });

    it('finds the selectors of the components in the source, and not the ones that are not for a component', () => {
      const source = `
        @Component({ selector: 'rmq-one', template: '' })
        export class One {}
        @Directive({ selector: '[rmqDragSource]' })
        export class Two {}
        @Component({ selector: 'button[rmq-three]' })
        export class Three {}
      `;

      expect(selectorsOf('source.ts', source)).toEqual(['rmq-one']);
    });
  });

  describe('on the references', () => {
    it('reads a reference with quotes in its words, and several in a cell', () => {
      const line = '| A | `x` | `e2e/a.spec.ts` · "the picker of "Link to…" open"<br>`e2e/b.spec.ts` · "second one" |';

      expect(referencesOf(line)).toEqual([
        { spec: 'e2e/a.spec.ts', words: 'the picker of "Link to…" open', line: 1 },
        { spec: 'e2e/b.spec.ts', words: 'second one', line: 1 },
      ]);
    });

    it('names a spec that is not there', () => {
      const moved = document.replace('`e2e/smoke.spec.ts` ·', '`e2e/gone.spec.ts` ·');

      expect(checkReferences(moved, read)).toEqual([
        expect.stringMatching(/line \d+: e2e\/gone\.spec\.ts is not a spec of the repository\.$/),
      ]);
    });

    it('names words that are not in the spec, as when a state is renamed in the spec and not here', () => {
      const stale = document.replace('· "with nothing selected" |', '· "with nothing chosen" |');
      expect(stale).not.toBe(document);

      expect(checkReferences(stale, read)).toEqual([
        expect.stringMatching(/line \d+: "with nothing chosen" is not in e2e\/editor-a11y\.spec\.ts\.$/),
      ]);
    });

    it('finds words in a string that is written with an escape', () => {
      expect(textHas("const name = 'it\\'s a state';", "it's a state")).toBe(true);
      expect(textHas("const name = 'it\\'s a state';", 'it is a state')).toBe(false);
    });
  });

  describe('on the states', () => {
    const editor = specs.get('e2e/editor-a11y.spec.ts') ?? '';

    it('finds the states of a spec: its arrays of states, and its tests that call axe, and not the tests made once for each state', () => {
      const text = `
        const states = [{ name: 'with a thing', enter: async () => undefined }, { name: 'with another', enter: async () => undefined }];
        const testerStates = [{ name: 'with a tester', enter: async () => undefined }] as const;
        const things = [{ name: 'not this one' }];
        for (const state of states) {
          test(\`has no axe violations \${state.name}\`, async () => { await expectNoAxeViolations(page); });
        }
        test('a screen of its own', async () => { await expectNoAxeViolations(page); });
        test('a test that does not look', async () => { expect(1).toBe(1); });
      `;

      expect(axeStatesOf('e2e/x.spec.ts', text)).toEqual([
        { name: 'with a thing', kind: 'state' },
        { name: 'with another', kind: 'state' },
        { name: 'with a tester', kind: 'state' },
        { name: 'a screen of its own', kind: 'test' },
      ]);
      expect(axeStatesOf('e2e/y.spec.ts', "const states = [{ name: 'no axe in this one' }];")).toEqual([]);
    });

    it('fails for a state that a spec has and the document has not', () => {
      const added = editor.replace(
        "{ name: 'with nothing selected', enter: async () => undefined },",
        "{ name: 'with nothing selected', enter: async () => undefined },\n  { name: 'with a screen that is new', enter: async () => undefined },",
      );
      expect(added).not.toBe(editor);

      expect(checkStates(document, new Map([['e2e/editor-a11y.spec.ts', added]]))).toEqual([
        'e2e/editor-a11y.spec.ts runs axe on "with a screen that is new" and docs/accessibility.md has no row for it: add one, with `e2e/editor-a11y.spec.ts` · "with a screen that is new".',
      ]);
    });

    it('fails for a test that calls axe and the document has not', () => {
      const added = `${editor}\ntest('a new screen has no axe violations', async ({ page }) => { await expectNoAxeViolations(page); });\n`;

      expect(checkStates(document, new Map([['e2e/editor-a11y.spec.ts', added]]))).toEqual([
        expect.stringContaining('runs axe on "a new screen has no axe violations"'),
      ]);
    });

    it('fails for a state with the name of one that the document has for another spec', () => {
      const text = "test('has no axe violations', async () => { await expectNoAxeViolations(page); });";

      expect(checkStates(document, new Map([['e2e/new-a11y.spec.ts', text]]))).toEqual([
        expect.stringContaining('e2e/new-a11y.spec.ts runs axe on "has no axe violations"'),
      ]);
    });

    it('fails for a name that has a bar in it, which a table cannot hold', () => {
      const text = "const states = [{ name: 'a | b', enter: async () => undefined }]; expectNoAxeViolations(page);";

      expect(checkStates(document, new Map([['e2e/new-a11y.spec.ts', text]]))).toEqual([
        expect.stringContaining('has a bar in it'),
      ]);
    });
  });

  describe('on the rows', () => {
    it('fails for a row of a table of states that has no test', () => {
      const table = ['| State | Components | Axe test, both themes |', '|---|---|---|', '| A state | — | |'].join('\n');

      expect(checkRows(table)).toEqual([expect.stringContaining('the row "A state" has no test that runs axe on it')]);
    });

    it('fails for a row with more or fewer cells than the head, and leaves the tables that are not of states alone', () => {
      const table = [
        '| State | Components |',
        '|---|---|',
        '| A state | — | `e2e/editor-a11y.spec.ts` · "with nothing selected" |',
      ].join('\n');
      const other = ['| Part | Where |', '|---|---|', '| A part | nowhere |'].join('\n');

      expect(checkRows(table)).toEqual([expect.stringContaining('the row has 3 cells and the head has 2')]);
      expect(checkRows(other)).toEqual([]);
    });

    it('reads a table as its head and its rows, without the line of dashes', () => {
      const [table] = tablesOf('text\n| A | B |\n|---|:---:|\n| 1 | 2 |\n| 3 | 4 |\n\n| C |\n|---|\n| 5 |');

      expect(table?.head.cells).toEqual(['A', 'B']);
      expect(table?.rows.map((row) => row.cells)).toEqual([
        ['1', '2'],
        ['3', '4'],
      ]);
      expect(tablesOf('| A |\n|---|\n| 1 |\n\n| C |\n|---|\n| 5 |')).toHaveLength(2);
    });
  });

  describe('on the themes', () => {
    const inLoop = `
      for (const colorScheme of ['light', 'dark'] as const) {
        test.describe('in a theme', () => {
          test.use({ colorScheme });
          test('is held', async ({ page }) => { await expectNoAxeViolations(page); });
        });
      }
    `;

    it('accepts a call that is in a loop over the two themes, in either order, that uses the theme', () => {
      expect(checkThemes(new Map([['e2e/a.spec.ts', inLoop]]), [])).toEqual([]);
      expect(
        checkThemes(new Map([['e2e/a.spec.ts', inLoop.replace("['light', 'dark']", "['dark', 'light']")]]), []),
      ).toEqual([]);
    });

    it('fails for a call that is in no loop', () => {
      const alone = "test('is held in one theme', async ({ page }) => { await expectNoAxeViolations(page); });";

      expect(checkThemes(new Map([['e2e/a.spec.ts', alone]]), [])).toEqual([
        expect.stringContaining('e2e/a.spec.ts line 1: axe runs outside a loop over the two themes'),
      ]);
    });

    it('fails for a loop over one theme, or over more, or over something else', () => {
      for (const list of ["['light']", "['light', 'dark', 'dark']", "['light', 'blue']", 'THEMES']) {
        const loop = inLoop.replace("['light', 'dark']", list);

        expect(checkThemes(new Map([['e2e/a.spec.ts', loop]]), []), list).toHaveLength(1);
      }
    });

    it('fails for a loop that does not use the theme, which runs the same one twice', () => {
      const same = inLoop.replace('test.use({ colorScheme });', '');

      expect(checkThemes(new Map([['e2e/a.spec.ts', same]]), [])).toEqual([
        expect.stringContaining('does not use the theme, so it runs the same one twice'),
      ]);
    });

    it('finds where a call is, and the test it is in', () => {
      expect(axeCallsOf('e2e/a.spec.ts', inLoop)).toEqual([
        { line: 5, test: 'is held', inThemeLoop: true, inLoopThatIgnoresItsTheme: false },
      ]);
    });

    it('excuses a call with a reason, and fails when the excuse is for a test that is not there, or has no reason', () => {
      const alone = "test('chooses on the page', async ({ page }) => { await expectNoAxeViolations(page); });";
      const excuse: Exception = {
        spec: 'e2e/a.spec.ts',
        test: 'chooses on the page',
        reason: 'It sets the theme itself.',
      };

      expect(checkThemes(new Map([['e2e/a.spec.ts', alone]]), [excuse])).toEqual([]);
      expect(checkThemes(new Map([['e2e/a.spec.ts', alone.replace('chooses', 'does not choose')]]), [excuse])).toEqual([
        expect.stringContaining('axe runs outside a loop'),
        expect.stringContaining('the exception for "chooses on the page" excuses nothing'),
      ]);
      expect(checkThemes(new Map([['e2e/a.spec.ts', alone]]), [{ ...excuse, reason: ' ' }])).toEqual([
        'e2e/a.spec.ts: the exception for "chooses on the page" has no reason.',
      ]);
      expect(checkThemes(new Map([['e2e/a.spec.ts', inLoop]]), [excuse])).toEqual([
        expect.stringContaining('excuses nothing'),
      ]);
    });

    it('has both of the exceptions of the smoke spec, one for each theme, and fails when one is gone', () => {
      const smoke = specs.get('e2e/smoke.spec.ts') ?? '';
      const outside = axeCallsOf('e2e/smoke.spec.ts', smoke).filter((call) => !call.inThemeLoop);

      expect(outside.map((call) => call.test).sort()).toEqual(EXCEPTIONS.map(({ test }) => test).sort());
      expect(EXCEPTIONS.map(({ test }) => test.slice(0, 18)).sort()).toEqual([
        'data-theme="dark" ',
        'data-theme="light"',
      ]);

      const gone = smoke.replace(EXCEPTIONS[0]?.test ?? '', 'something else');
      expect(checkThemes(new Map([['e2e/smoke.spec.ts', gone]]), EXCEPTIONS)).toHaveLength(2);
    });
  });

  describe('on what machines check', () => {
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
    const exists = (path: string): boolean => read(path) !== null;

    it('needs the section', () => {
      const renamed = document.replace('## What machines check', '## What the machines check');

      expect(checkMachines(renamed, exists, tags)).toEqual([
        'docs/accessibility.md has no section "What machines check".',
      ]);
    });

    it('needs the section to name the specs that check what axe cannot', () => {
      const without = document.replaceAll('`e2e/targets.spec.ts`', 'the spec of the targets');

      expect(checkMachines(without, exists, tags)).toEqual([
        'The section "What machines check" does not name e2e/targets.spec.ts.',
      ]);
    });

    it('needs every file that the section names to be in the repository', () => {
      const moved = document.replace('`e2e/focus-not-obscured.spec.ts`', '`e2e/focus-covered.spec.ts`');

      expect(checkMachines(moved, exists, tags)).toEqual([
        'The section "What machines check" does not name e2e/focus-not-obscured.spec.ts.',
        'The section "What machines check" names e2e/focus-covered.spec.ts, which is not in the repository.',
      ]);
    });

    it('needs the section to name the tags that axe runs with', () => {
      const without = document.replace('`wcag22aa`', 'wcag22aa');

      expect(checkMachines(without, exists, tags)).toEqual([
        'The section "What machines check" does not name the axe tag `wcag22aa`, which e2e/support/axe.ts runs with.',
      ]);
      expect(axeTagsOf(".withTags(['a', 'b'])")).toEqual(['a', 'b']);
    });

    it('takes a section to the next heading of its level, and keeps the headings under it', () => {
      const text = '# T\n## One\nfirst\n### Under\nstill one\n## Two\nsecond\n';

      expect(sectionOf(text, 'One')).toBe('first\n### Under\nstill one');
      expect(sectionOf(text, 'Two')).toBe('second\n');
      expect(sectionOf(text, 'Three')).toBeNull();
    });
  });
});
