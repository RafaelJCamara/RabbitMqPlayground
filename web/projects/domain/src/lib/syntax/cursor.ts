import type { HeaderCondition, HeaderEntry, HeaderValue } from '@rmq/engine';
import { didYouMean, joinList, namesOf } from '../commands/helpers';
import { findId } from '../document/elements';
import { headerKeyIssue, headerValueProblem } from '../document/headers';
import { A_KIND, ELEMENT_KINDS, KIND_LABEL, type ElementKind, type ElementRef, type Issue } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { suggest } from '../suggest';
import type { Atom, Word } from './tokenizer';
import { unknownCommand } from './unknown';
import { anyQuoted, parseExists, splitAssignment, splitQualifier, textOf, wordText } from './words';
import { parseValue } from './values';

/**
 * The reading head of a typed command (ADR-0025). A command's `parse` walks its words with a cursor that says what it
 * expects next, and that is all a command has to write: the cursor reads a name, resolves a reference against the
 * document, expects an arrow, reads the `name=value` words that follow, and explains what went wrong, with where in the
 * text it was and what was probably meant.
 *
 * The same walk answers autocomplete. Run on the words that are already typed with `probe` on, it does not fail when the
 * words run out: it says what it would have taken next, and the completer turns that into candidates. So a command cannot
 * be completed in a way that its parser would refuse, because there is only one description of it.
 */

/** What can be written as the value of an option. */
export type ValueSpec =
  | { readonly kind: 'text' }
  | {
      readonly kind: 'enum';
      readonly values: readonly string[];
      /** Values that are known and not allowed, with what to say instead of "must be one of". */
      readonly refused?: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'bool' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'number'; readonly min: number; readonly max: number };

/** An option of a command: `name=value`. */
export interface OptionSpec {
  readonly name: string;
  readonly value: ValueSpec;
  readonly summary: string;
  /** The command is not complete without it. */
  readonly required?: true;
}

/** What follows the names of a command: its options, and the free words that some commands take. */
export interface TailSpec {
  readonly options: readonly OptionSpec[];
  /** Words `name=value` that are not options are conditions on a header, and `exists(name)` asks for a header to be there. */
  readonly conditions?: true;
  /** Words `header:name=value` are headers to set on a message. */
  readonly messageHeaders?: true;
  /** Words `header:name` name a header. */
  readonly headerNames?: true;
}

/** What a command would have taken next, when its words ran out. */
export type Expected =
  | { readonly kind: 'ref'; readonly elements: readonly ElementKind[]; readonly label: string; readonly canvas?: true }
  | { readonly kind: 'name'; readonly label: string }
  | { readonly kind: 'arrow' }
  | { readonly kind: 'tail'; readonly spec: TailSpec; readonly used: readonly string[] }
  /** The name of a command, of which `words` are typed. */
  | { readonly kind: 'command'; readonly words: readonly string[] }
  /** A number that stands by itself, and the ones that are worth offering. */
  | { readonly kind: 'number'; readonly label: string; readonly suggestions: readonly string[] };

/** A refusal in the middle of a parse. It is caught where the parse started and becomes the result. */
export class Stop extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message);
    this.name = 'Stop';
  }
}

/** The words ran out while the command was being probed. */
export class Expectation extends Error {
  constructor(readonly expected: Expected) {
    super('expected something');
    this.name = 'Expectation';
  }
}

/** What the tail of a command said. */
export interface Tail {
  /** The value of each option that was given, by the option's name. */
  readonly options: Readonly<Record<string, unknown>>;
  readonly conditions: readonly HeaderEntry<HeaderCondition>[];
  readonly headers: readonly HeaderEntry<HeaderValue>[];
  readonly headerNames: readonly string[];
}

const range = (token: Atom) => ({ start: token.start, end: token.end });

/** How a value is written, for a message: `true or false`, `a whole number from 1 to 1000`. */
export function describeValue(spec: ValueSpec): string {
  switch (spec.kind) {
    case 'text':
      return 'text';
    case 'enum':
      return joinList(spec.values, 'or');
    case 'bool':
      return 'true or false';
    case 'int':
      return `a whole number from ${spec.min} to ${spec.max}`;
    case 'number':
      return `a number from ${spec.min} to ${spec.max}`;
  }
}

/** How a value is hinted in `name=…`, for the message that asks for a missing option. */
const hint = (spec: ValueSpec): string =>
  spec.kind === 'enum'
    ? spec.values.join('|')
    : spec.kind === 'bool'
      ? 'true|false'
      : spec.kind === 'text'
        ? '<text>'
        : '<number>';

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const WHOLE = /^-?\d+$/;

export class Cursor {
  private index = 0;

  /**
   * @param tokens the words of the command after its name
   * @param document what names are looked up in
   * @param probe say what is expected, instead of failing, when the words run out
   * @param end where the typed text ends, for an error about what is missing
   */
  constructor(
    private readonly tokens: readonly Atom[],
    readonly document: CanvasDocument,
    private readonly probe = false,
    private readonly end = tokens.at(-1)?.end ?? 0,
  ) {}

  private missing(expected: Expected, message: string): never {
    if (this.probe) {
      throw new Expectation(expected);
    }
    throw new Stop({ kind: 'missing-argument', message, at: { start: this.end, end: this.end } });
  }

  /** Refuses the command for what it says as a whole, which is something that the end of the text is where to point at. */
  stop(issue: Omit<Issue, 'at'>): never {
    throw new Stop({ ...issue, at: { start: this.end, end: this.end } });
  }

  /** The next word, which has to be there and has to be a word and not an arrow or a separator. */
  private word(expected: Expected, label: string): Word {
    const token = this.tokens[this.index];
    if (token === undefined) {
      return this.missing(expected, `Expected ${label}.`);
    }
    if (token.kind !== 'word') {
      throw new Stop({
        kind: 'syntax',
        message: `Expected ${label}, and not '->'.`,
        at: range(token),
      });
    }
    this.index += 1;
    return token;
  }

  /** The name of an existing element: a word, with a qualifier such as `queue:` where the kind is not clear. */
  ref(elements: readonly ElementKind[], label: string): ElementRef {
    const word = this.word({ kind: 'ref', elements, label }, label);
    const { kind, name } = splitQualifier(word);
    if (kind !== null) {
      if (!elements.includes(kind)) {
        throw new Stop({
          kind: 'syntax',
          message: `Here goes ${label}, and '${kind}:' says ${A_KIND[kind]}.`,
          at: range(word),
        });
      }
      return { kind, name };
    }
    const [only] = elements;
    if (elements.length === 1 && only !== undefined) {
      return { kind: only, name };
    }

    // In the order that the kinds are always listed in, and not in the order that this command takes them.
    const found = ELEMENT_KINDS.filter(
      (candidate) => elements.includes(candidate) && findId(this.document, candidate, name) !== undefined,
    );
    const [first] = found;
    if (found.length === 1 && first !== undefined) {
      return { kind: first, name };
    }
    if (found.length > 1) {
      const qualified = found.map((candidate) => `${candidate}:${wordText(name)}`);
      throw new Stop({
        kind: 'ambiguous-name',
        message: `'${name}' is ${joinList(
          found.map((candidate) => A_KIND[candidate]),
          'and',
        )}. Say which: ${joinList(qualified, 'or')}.`,
        suggestions: qualified,
        at: range(word),
      });
    }
    const suggestions = suggest(
      name,
      elements.flatMap((candidate) => namesOf(this.document, candidate)),
    );
    throw new Stop({
      kind: 'missing-element',
      message: `There is no ${joinList(
        elements.map((candidate) => KIND_LABEL[candidate]),
        'or',
      )} named '${name}'.${didYouMean(suggestions)}`,
      ...(suggestions.length === 0 ? {} : { suggestions }),
      at: range(word),
    });
  }

  /** The target of `set`: an element, or the word `canvas`, which is the canvas itself. */
  setTarget(): ElementRef | { readonly kind: 'canvas' } {
    const token = this.tokens[this.index];
    if (
      token?.kind === 'word' &&
      token.segments.length === 1 &&
      !token.segments[0]?.quoted &&
      token.text === 'canvas'
    ) {
      this.index += 1;
      return { kind: 'canvas' };
    }
    if (this.index >= this.tokens.length && this.probe) {
      throw new Expectation({ kind: 'ref', elements: ELEMENT_KINDS, label: 'an element or canvas', canvas: true });
    }
    return this.ref(ELEMENT_KINDS, 'an element or canvas');
  }

  /** A new name, which is any word. What a name may be is for the command to say when it is applied. */
  name(label: string): string {
    return this.word({ kind: 'name', label }, label).text;
  }

  arrow(): void {
    const token = this.tokens[this.index];
    if (token === undefined) {
      return this.missing({ kind: 'arrow' }, "Expected '->'.");
    }
    if (token.kind !== 'arrow') {
      throw new Stop({
        kind: 'syntax',
        message: `Expected '->' here, and not '${token.text}'.`,
        at: range(token),
      });
    }
    this.index += 1;
  }

  /** Reads a value as an option's value spec says. */
  private value(option: OptionSpec, word: Word, text: string): unknown {
    const spec = option.value;
    const fail = (message: string, suggestions: readonly string[] = []): never => {
      throw new Stop({
        kind: 'invalid-value',
        message: `${message}${didYouMean(suggestions)}`,
        ...(suggestions.length === 0 ? {} : { suggestions }),
        at: range(word),
      });
    };
    switch (spec.kind) {
      case 'text':
        return text;
      case 'enum': {
        const refusal =
          spec.refused === undefined || !Object.hasOwn(spec.refused, text) ? undefined : spec.refused[text];
        if (refusal !== undefined) {
          throw new Stop({ kind: 'unsupported', message: refusal, at: range(word) });
        }
        return spec.values.includes(text)
          ? text
          : fail(`${option.name} must be ${describeValue(spec)}, and '${text}' is not.`, suggest(text, spec.values));
      }
      case 'bool':
        return text === 'true' || text === 'false'
          ? text === 'true'
          : fail(`${option.name} must be true or false, and '${text}' is not.`, suggest(text, ['true', 'false']));
      case 'int': {
        const number = Number(text);
        return WHOLE.test(text) && number >= spec.min && number <= spec.max
          ? number + 0
          : fail(`${option.name} must be ${describeValue(spec)}, and '${text}' is not.`);
      }
      case 'number': {
        const number = Number(text);
        return NUMBER.test(text) && number >= spec.min && number <= spec.max
          ? number + 0
          : fail(`${option.name} must be ${describeValue(spec)}, and '${text}' is not.`);
      }
    }
  }

  /**
   * Reads every word that is left: the options in `spec`, then whatever else `spec` allows. An option may be given once,
   * in any order. A word that is none of them is refused, with the closest option as a suggestion.
   */
  options(spec: TailSpec): Tail {
    const options: Record<string, unknown> = {};
    const conditions: HeaderEntry<HeaderCondition>[] = [];
    const headers: HeaderEntry<HeaderValue>[] = [];
    const headerNames: string[] = [];
    const names = spec.options.map(({ name }) => name);

    for (; this.index < this.tokens.length; this.index += 1) {
      const token = this.tokens[this.index] as Atom;
      if (token.kind !== 'word') {
        throw new Stop({
          kind: 'syntax',
          message: `Unexpected '->' here.`,
          at: range(token),
        });
      }

      const exists = spec.conditions ? parseExists(token) : null;
      if (exists !== null) {
        const key = textOf(exists);
        const problem = headerKeyIssue(key);
        if (problem !== null) {
          throw new Stop({ ...problem, at: range(token) });
        }
        conditions.push({ key, value: { t: 'exists' } });
        continue;
      }

      const assignment = splitAssignment(token);
      if (assignment === null) {
        this.bareWord(spec, token, names, headerNames);
        continue;
      }

      const keyText = textOf(assignment.key);
      const option = anyQuoted(assignment.key) ? undefined : spec.options.find(({ name }) => name === keyText);
      if (option !== undefined) {
        if (Object.hasOwn(options, option.name)) {
          throw new Stop({ kind: 'syntax', message: `${option.name} is there twice. Give it once.`, at: range(token) });
        }
        options[option.name] = this.value(option, token, textOf(assignment.value));
        continue;
      }

      if (spec.messageHeaders && !anyQuoted(assignment.key.slice(0, 1)) && keyText.startsWith('header:')) {
        headers.push(this.header(token, keyText.slice('header:'.length), assignment.value));
        continue;
      }
      if (spec.conditions) {
        conditions.push(this.header(token, keyText, assignment.value));
        continue;
      }
      throw this.unknownOption(token, keyText, names);
    }

    if (this.probe) {
      throw new Expectation({ kind: 'tail', spec, used: Object.keys(options) });
    }
    const missing = spec.options.find((option) => option.required === true && !Object.hasOwn(options, option.name));
    if (missing !== undefined) {
      this.missing({ kind: 'tail', spec, used: Object.keys(options) }, `Add ${missing.name}=${hint(missing.value)}.`);
    }
    return { options, conditions, headers, headerNames };
  }

  /** A word with no `=` in the tail: `header:name` where that is how headers are named, and a mistake otherwise. */
  private bareWord(spec: TailSpec, word: Word, names: readonly string[], headerNames: string[]): void {
    if (spec.headerNames && !anyQuoted(word.segments.slice(0, 1)) && word.text.startsWith('header:')) {
      const key = word.text.slice('header:'.length);
      const problem = headerKeyIssue(key);
      if (problem !== null) {
        throw new Stop({ ...problem, at: range(word) });
      }
      headerNames.push(key);
      return;
    }
    // A word that is exactly an option's name is that option without its value, and `suggest` never offers what was typed.
    const closest = names.includes(word.text) ? [word.text] : suggest(word.text, names);
    const example = closest[0] ?? names[0];
    throw new Stop({
      kind: 'syntax',
      message:
        spec.headerNames === true
          ? `Write the name of a header as header:name, for example header:format, and not '${word.text}'.`
          : `Write '${word.text}' as name=value${example === undefined ? '' : `, for example ${example}=…`}.${didYouMean(closest.map((name) => `${name}=`))}`,
      ...(spec.headerNames === true || closest.length === 0 ? {} : { suggestions: closest.map((name) => `${name}=`) }),
      at: range(word),
    });
  }

  /** A header with its value read from the words after the `=`. */
  private header(word: Word, key: string, value: Word['segments']): HeaderEntry<HeaderValue> {
    const problem = headerKeyIssue(key);
    if (problem !== null) {
      throw new Stop({ ...problem, at: range(word) });
    }
    const parsed = parseValue(value);
    const unsafe = headerValueProblem(key, parsed);
    if (unsafe !== null) {
      throw new Stop({ ...unsafe, at: range(word) });
    }
    return { key, value: parsed };
  }

  private unknownOption(word: Word, key: string, names: readonly string[]): Stop {
    const suggestions = suggest(key, names);
    return new Stop({
      kind: 'unknown-option',
      message: `There is no option '${key}' here.${names.length === 0 ? ' It takes none.' : ` Its options are ${joinList(names, 'and')}.`}${didYouMean(suggestions)}`,
      ...(suggestions.length === 0 ? {} : { suggestions }),
      at: range(word),
    });
  }

  /**
   * The name of a command, which is one word or two, for `help`: every word that is left, or none, which is an answer too. A name that is not a
   * command is refused as a line that starts with it would be, with the names that were probably meant, and a word after the name of a command is
   * one word too many. While the words are still being typed, what would complete a name is what is expected, and that includes `move`, which is
   * a command and also the start of one.
   */
  commandName(names: readonly string[]): string | undefined {
    const rest = this.tokens.slice(this.index);
    this.index = this.tokens.length;
    const odd = rest.find((token) => token.kind !== 'word' || token.segments.some((segment) => segment.quoted));
    if (odd !== undefined) {
      throw new Stop({
        kind: 'syntax',
        message:
          'Write the name of a command as it is typed, with no quotes and no arrow, as in help bind or help declare queue.',
        at: range(odd),
      });
    }
    const words = rest as readonly Word[];
    const name = words.map(({ text }) => text).join(' ');
    if (this.probe && (words.length === 0 || names.some((candidate) => candidate.startsWith(`${name} `)))) {
      throw new Expectation({ kind: 'command', words: words.map(({ text }) => text) });
    }
    if (words.length === 0) {
      return undefined;
    }
    if (names.includes(name)) {
      return name;
    }
    const [first, second, third] = words as readonly [Word, Word?, Word?];
    const extra = names.includes(first.text)
      ? second
      : names.includes(`${first.text} ${second?.text}`)
        ? third
        : undefined;
    if (extra !== undefined) {
      throw new Stop({
        kind: 'syntax',
        message: `Unexpected '${extra.text}': help takes the name of one command, as in help bind or help declare queue.`,
        at: range(extra),
      });
    }
    throw new Stop(
      unknownCommand(
        words,
        words.map(({ text }) => text),
        names,
      ),
    );
  }

  /**
   * A number that stands by itself, for a command that has one thing to say and where `name=value` would only be longer: `speed 2`. It is read as an
   * option's number is, and the numbers that make sense are what completion offers.
   */
  number(
    label: string,
    spec: { readonly min: number; readonly max: number; readonly suggestions: readonly string[] },
  ): number {
    const word = this.word({ kind: 'number', label, suggestions: spec.suggestions }, label);
    const number = Number(word.text);
    if (!NUMBER.test(word.text) || number < spec.min || number > spec.max) {
      throw new Stop({
        kind: 'invalid-value',
        message: `${label} must be ${describeValue({ kind: 'number', min: spec.min, max: spec.max })}, and '${word.text}' is not.`,
        at: range(word),
      });
    }
    return number;
  }

  /** There must be nothing more. */
  finish(): void {
    const token = this.tokens[this.index];
    if (token !== undefined) {
      throw new Stop({
        kind: 'syntax',
        message: `Unexpected '${token.kind === 'word' ? token.text : '->'}': there is nothing more to say here.`,
        at: range(token),
      });
    }
  }
}
