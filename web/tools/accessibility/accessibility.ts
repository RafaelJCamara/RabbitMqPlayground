import ts from 'typescript';

/**
 * ADR-0085: `docs/accessibility.md` lists the screens and states of the app, each with the test that runs axe on it in both themes, and a unit test holds the list to the code. These are the functions
 * of that test, and they take text and return the problems they find (an empty list is a document that is right), so that the test can run them on the repository and on text that it has made wrong.
 *
 * What the document has to be:
 *
 * - every component of the app (every `selector: 'rmq-…'` of a file that is not a spec) is in a row of a table, and the document names no component that is not in the app;
 * - a reference, written `` `e2e/name.spec.ts` · "words" ``, points to a spec that exists, and the words are in it;
 * - every state that an end-to-end spec runs axe on (an entry of an array of states, or a test that calls `expectNoAxeViolations`) is the words of a reference to its spec, so that a state with no row fails;
 * - every row of the tables of states has a reference.
 *
 * And what the specs have to be: a call of `expectNoAxeViolations` is inside a loop over the two themes, `for (const theme of ['light', 'dark'])`, that uses what it loops over, except where a spec says why not.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The document

/** A line of a table of the document. */
export interface Row {
  /** The number of the line in the document, from 1. */
  readonly line: number;
  /** The cells, without the bars and the spaces round them. */
  readonly cells: readonly string[];
  readonly text: string;
}

/** A table of the document: its head, and the rows under it. */
export interface Table {
  readonly head: Row;
  readonly rows: readonly Row[];
}

const isSeparator = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/** The tables of the document: runs of lines that begin with a bar, the first line the head, and the line of dashes under it left out. */
export function tablesOf(document: string): Table[] {
  const tables: Table[] = [];
  let current: { head: Row; rows: Row[] } | null = null;
  document.split(/\r?\n/).forEach((text, index) => {
    if (!text.startsWith('|')) {
      current = null;
      return;
    }
    const cells = text
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim());
    const row: Row = { line: index + 1, cells, text };
    if (current === null) {
      current = { head: row, rows: [] };
      tables.push(current);
    } else if (!isSeparator(cells)) {
      current.rows.push(row);
    }
  });
  return tables;
}

/** What the document says a test is: the spec, and words that are in it. */
export interface Reference {
  readonly spec: string;
  readonly words: string;
  /** The number of the line in the document, from 1. */
  readonly line: number;
}

/**
 * A reference is `` `e2e/name.spec.ts` · "the words" ``. The words end at the quote that is followed by `<br>` (another reference in the cell), by a bar (the end of the cell) or by the end of the line, so that the
 * words may have quotes in them, as the name of a state that is about "Link to…" has.
 */
const REFERENCE = /`([^`\s]+\.spec\.ts)` · "(.+?)"(?=<br>|\s*\||\s*$)/g;

/** Every reference in the text, in the order that they are written. */
export function referencesOf(document: string): Reference[] {
  const references: Reference[] = [];
  document.split(/\r?\n/).forEach((text, index) => {
    for (const match of text.matchAll(REFERENCE)) {
      references.push({ spec: match[1] as string, words: match[2] as string, line: index + 1 });
    }
  });
  return references;
}

/** The text of a section: from the line after its heading to the line before the next heading of the same level or above. `null` when there is no such heading. */
export function sectionOf(document: string, heading: string): string | null {
  const lines = document.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, '').trim() === heading);
  if (start < 0) {
    return null;
  }
  const level = (lines[start] as string).match(/^#+/)?.[0].length ?? 1;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = line.match(/^(#{1,6}) /)?.[1];
    return hashes !== undefined && hashes.length <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

const COMPONENT_IN_TEXT = /`(rmq-[a-z0-9-]+)`/g;

/** The components the document names in backticks: in the rows of its tables, and anywhere. */
export function componentsInDocument(document: string): {
  readonly inRows: Set<string>;
  readonly anywhere: Set<string>;
} {
  const inRows = new Set<string>();
  const anywhere = new Set<string>();
  document.split(/\r?\n/).forEach((text) => {
    for (const match of text.matchAll(COMPONENT_IN_TEXT)) {
      anywhere.add(match[1] as string);
      if (text.startsWith('|')) {
        inRows.add(match[1] as string);
      }
    }
  });
  return { inRows, anywhere };
}

// ---------------------------------------------------------------------------------------------------------------------
// The source

const parse = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const stringOf = (node: ts.Node | undefined): string | null =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** `x as const`, `(x)` and `x satisfies T` are `x`. */
function bare(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** The selectors, `rmq-…`, that the components of a file declare. */
export function selectorsOf(file: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'selector') {
      const value = stringOf(node.initializer);
      if (value !== null && value.startsWith('rmq-')) {
        found.push(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return found;
}

/** A state that a spec runs axe on: an entry of an array of states, or a test that calls `expectNoAxeViolations`. */
export interface AxeState {
  readonly name: string;
  readonly kind: 'state' | 'test';
}

const callsAxe = (node: ts.Node): boolean => {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'expectNoAxeViolations'
    ) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
};

/**
 * The states that a spec runs axe on, in the order that the file has them: the `name:` of the entries of the arrays called `states`, or something ending in `States`, and the titles of the tests that call
 * `expectNoAxeViolations`. A test whose title is made of a template (the tests that run once for each state) is the states, and not a state. A spec that does not call it has none.
 */
export function axeStatesOf(file: string, text: string): AxeState[] {
  if (!text.includes('expectNoAxeViolations')) {
    return [];
  }
  const states: AxeState[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /states$/i.test(node.name.text) &&
      node.initializer !== undefined
    ) {
      const list = bare(node.initializer);
      if (ts.isArrayLiteralExpression(list)) {
        for (const element of list.elements) {
          if (ts.isObjectLiteralExpression(element)) {
            const name = element.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'name',
            );
            const value = stringOf(name?.initializer);
            if (value !== null) {
              states.push({ name: value, kind: 'state' });
            }
          }
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test') {
      const title = stringOf(node.arguments[0]);
      if (title !== null && callsAxe(node)) {
        states.push({ name: title, kind: 'test' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return states;
}

/** A call of `expectNoAxeViolations`, where it is: the line, the test it is in, and whether a loop over the two themes holds it. */
export interface AxeCall {
  readonly line: number;
  /** The title of the test that the call is in, or `null` when the title is a template or there is no test. */
  readonly test: string | null;
  /** Inside `for (const x of ['light', 'dark'])`, a loop that uses `x`. */
  readonly inThemeLoop: boolean;
  /** Inside such a loop that does not use `x`, which runs the same theme twice. */
  readonly inLoopThatIgnoresItsTheme: boolean;
}

const isThemeList = (expression: ts.Expression): boolean => {
  const list = bare(expression);
  if (!ts.isArrayLiteralExpression(list) || list.elements.length !== 2) {
    return false;
  }
  return (
    list.elements
      .map((element) => stringOf(element))
      .sort()
      .join() === 'dark,light'
  );
};

/** Whether `name` is used in `node`, apart from where it is declared. */
function uses(node: ts.Node, name: string): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && child.text === name) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

export function axeCallsOf(file: string, text: string): AxeCall[] {
  const source = parse(file, text);
  const calls: AxeCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'expectNoAxeViolations'
    ) {
      let test: string | null = null;
      let inThemeLoop = false;
      let inLoopThatIgnoresItsTheme = false;
      for (let up: ts.Node | undefined = node.parent; up !== undefined; up = up.parent) {
        if (
          test === null &&
          ts.isCallExpression(up) &&
          ts.isIdentifier(up.expression) &&
          up.expression.text === 'test'
        ) {
          test = stringOf(up.arguments[0]);
        }
        if (ts.isForOfStatement(up) && isThemeList(up.expression)) {
          const declaration = ts.isVariableDeclarationList(up.initializer) ? up.initializer.declarations[0] : undefined;
          const variable =
            declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
          if (variable !== null && uses(up.statement, variable)) {
            inThemeLoop = true;
          } else {
            inLoopThatIgnoresItsTheme = true;
          }
        }
      }
      calls.push({
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        test,
        inThemeLoop,
        inLoopThatIgnoresItsTheme,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** Whether the words are in a spec: in its text, or in one of its strings once the escapes in them are read (a name written with `\'` has the quote in it). */
export function textHas(text: string, words: string, file = 'spec.ts'): boolean {
  if (text.includes(words)) {
    return true;
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    const value = stringOf(node);
    if (value !== null && value.includes(words)) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  };
  visit(parse(file, text));
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks

/** Every component of the app is in a row, and the document names no component that the app has not. */
export function checkComponents(document: string, selectors: ReadonlySet<string>): string[] {
  const { inRows, anywhere } = componentsInDocument(document);
  return [
    ...[...selectors]
      .sort()
      .flatMap((selector) =>
        inRows.has(selector)
          ? []
          : [`The component ${selector} is in no row of docs/accessibility.md: say in which state axe looks at it.`],
      ),
    ...[...anywhere]
      .sort()
      .flatMap((selector) =>
        selectors.has(selector)
          ? []
          : [`docs/accessibility.md names ${selector}, which is the selector of no component of the app.`],
      ),
  ];
}

/** Every reference points to a spec that exists, and the words are in it. `read` gives the text of a spec by its path from `web/`, or `null` when there is none. */
export function checkReferences(document: string, read: (spec: string) => string | null): string[] {
  return referencesOf(document).flatMap(({ spec, words, line }) => {
    const text = read(spec);
    if (text === null) {
      return [`docs/accessibility.md line ${line}: ${spec} is not a spec of the repository.`];
    }
    return textHas(text, words, spec) ? [] : [`docs/accessibility.md line ${line}: "${words}" is not in ${spec}.`];
  });
}

/** Every row of a table of states has a reference, and the words of none of them has a bar in it, which would cut the row. */
export function checkRows(document: string): string[] {
  const problems: string[] = [];
  for (const { head, rows } of tablesOf(document)) {
    if (head.cells[0] !== 'State') {
      continue;
    }
    for (const row of rows) {
      const references = referencesOf(row.text);
      if (references.length === 0) {
        problems.push(
          `docs/accessibility.md line ${row.line}: the row "${row.cells[0] ?? ''}" has no test that runs axe on it, written \`e2e/name.spec.ts\` · "words".`,
        );
      }
      if (row.cells.length !== head.cells.length) {
        problems.push(
          `docs/accessibility.md line ${row.line}: the row has ${row.cells.length} cells and the head has ${head.cells.length}.`,
        );
      }
    }
  }
  return problems;
}

/** Every state that a spec runs axe on is the words of a reference to that spec. `specs` has the text of the specs that call axe, by their path from `web/`. */
export function checkStates(document: string, specs: ReadonlyMap<string, string>): string[] {
  const written = new Set(referencesOf(document).map(({ spec, words }) => `${spec}\u0000${words}`));
  const problems: string[] = [];
  for (const [spec, text] of [...specs].sort(([a], [b]) => a.localeCompare(b))) {
    for (const { name } of axeStatesOf(spec, text)) {
      if (name.includes('|')) {
        problems.push(`${spec}: the name "${name}" has a bar in it, which cannot be written in a table. Take it out.`);
      } else if (!written.has(`${spec}\u0000${name}`)) {
        problems.push(
          `${spec} runs axe on "${name}" and docs/accessibility.md has no row for it: add one, with \`${spec}\` · "${name}".`,
        );
      }
    }
  }
  return problems;
}

/** A call of axe that is not in a loop over the two themes, and the reason that it need not be. */
export interface Exception {
  readonly spec: string;
  readonly test: string;
  readonly reason: string;
}

/**
 * Every call of `expectNoAxeViolations` in a spec is inside `for (const theme of ['light', 'dark'])`, a loop that uses `theme`, or is in a test that `exceptions` names with a reason. An exception whose test is not
 * in the spec any more fails, so that the list does not outlive what it excuses.
 */
export function checkThemes(specs: ReadonlyMap<string, string>, exceptions: readonly Exception[]): string[] {
  const problems: string[] = [];
  const excused = new Set<string>();
  for (const [spec, text] of [...specs].sort(([a], [b]) => a.localeCompare(b))) {
    for (const call of axeCallsOf(spec, text)) {
      if (call.inThemeLoop) {
        continue;
      }
      const exception = exceptions.find((candidate) => candidate.spec === spec && candidate.test === call.test);
      if (exception !== undefined) {
        excused.add(`${exception.spec}\u0000${exception.test}`);
      } else if (call.inLoopThatIgnoresItsTheme) {
        problems.push(
          `${spec} line ${call.line}: axe runs in a loop over the two themes that does not use the theme, so it runs the same one twice.`,
        );
      } else {
        problems.push(
          `${spec} line ${call.line}: axe runs outside a loop over the two themes (\`for (const colorScheme of ['light', 'dark'] as const)\`)${call.test === null ? '' : ` in "${call.test}"`}.`,
        );
      }
    }
  }
  for (const { spec, test, reason } of exceptions) {
    if (reason.trim() === '') {
      problems.push(`${spec}: the exception for "${test}" has no reason.`);
    }
    if (!excused.has(`${spec}\u0000${test}`)) {
      problems.push(
        `${spec}: the exception for "${test}" excuses nothing, because that test is not there or runs axe in the loop.`,
      );
    }
  }
  return problems;
}

/** The specs and files that the section "What machines check" has to name, from `web/`. */
export const MACHINE_CHECKS: readonly string[] = [
  'e2e/support/axe.ts',
  'e2e/keyboard-only.spec.ts',
  'e2e/targets.spec.ts',
  'e2e/focus-not-obscured.spec.ts',
  'e2e/smoke.spec.ts',
  'projects/app/src/app/canvas/overlay/overlay.spec.ts',
];

const MACHINE_SECTION = 'What machines check';

/** The tags that `expectNoAxeViolations` runs axe with, read from the helper's source. */
export function axeTagsOf(helper: string): string[] {
  const match = /\.withTags\(\s*\[([^\]]*)\]/.exec(helper);
  return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((tag) => tag[1] as string);
}

/**
 * The section "What machines check" names the specs that check what axe cannot (the keyboard alone, the size of the targets, a focus that is covered, the width of the page) and the tags that axe runs with, and
 * every file that it names is in the repository. `exists` says whether a path from `web/` is.
 */
export function checkMachines(document: string, exists: (path: string) => boolean, tags: readonly string[]): string[] {
  const section = sectionOf(document, MACHINE_SECTION);
  if (section === null) {
    return [`docs/accessibility.md has no section "${MACHINE_SECTION}".`];
  }
  const named = [...section.matchAll(/`((?:e2e|projects|tools)\/[^`\s]+\.ts)`/g)].map((match) => match[1] as string);
  return [
    ...MACHINE_CHECKS.filter((path) => !named.includes(path)).map(
      (path) => `The section "${MACHINE_SECTION}" does not name ${path}.`,
    ),
    ...[...new Set(named)]
      .filter((path) => !exists(path))
      .map((path) => `The section "${MACHINE_SECTION}" names ${path}, which is not in the repository.`),
    ...tags
      .filter((tag) => !section.includes(`\`${tag}\``))
      .map(
        (tag) =>
          `The section "${MACHINE_SECTION}" does not name the axe tag \`${tag}\`, which e2e/support/axe.ts runs with.`,
      ),
  ];
}
