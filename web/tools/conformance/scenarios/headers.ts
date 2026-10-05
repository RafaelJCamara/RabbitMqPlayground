import type { HeaderCondition, HeaderEntry, HeaderValue, Scenario, Step, XMatch } from '../scenario';
import { bool, declareExchange, declareQueue, entry, exists, float, int, publish, queue, str } from './helpers';

/**
 * Headers exchanges (ADR-0009). Most of these are tables: one headers exchange `h`, one queue for every binding (named
 * after it, so the recording reads as "this message reached these bindings"), and one publish for every message.
 */

interface BindingCase {
  /** The queue that the binding goes to. Bindings with the same name go to the same queue. */
  readonly name: string;
  readonly xMatch: XMatch | null;
  readonly args: readonly HeaderEntry<HeaderCondition>[];
  /** Left out, the key is empty. A headers exchange does not look at it. */
  readonly key?: string;
}

interface MessageCase {
  readonly body: string;
  readonly key?: string;
  /** Left out, the message has no headers at all. `[]` is a message with an empty table of them. */
  readonly headers?: readonly HeaderEntry<HeaderValue>[];
}

function headersTable(
  id: string,
  title: string,
  bindings: readonly BindingCase[],
  messages: readonly MessageCase[],
): Scenario {
  const declared = new Set<string>();
  const steps: Step[] = [
    declareExchange('h', 'headers'),
    ...bindings.flatMap((binding) => {
      const declaration = declared.has(binding.name) ? [] : [declareQueue(binding.name)];
      declared.add(binding.name);
      return [
        ...declaration,
        {
          op: 'bind' as const,
          source: 'h',
          destination: queue(binding.name),
          key: binding.key ?? '',
          headers: { xMatch: binding.xMatch, args: binding.args },
        },
      ];
    }),
    ...messages.map((message) => publish('h', message.key ?? '', message.body, message.headers)),
  ];
  return { id: `routing/${id}`, kind: 'routing', title, steps };
}

// --- values of every type and width -------------------------------------------------------------------------------

interface ValueCase {
  readonly label: string;
  readonly value: HeaderValue;
}

/**
 * The same number as a string, as integers of each width, and as a float, and what a boolean is next to a number. An
 * integer without a width is sent in the smallest AMQP integer that holds it, which is what a JavaScript client does.
 */
const VALUES: readonly ValueCase[] = [
  { label: 'string 1', value: str('1') },
  { label: 'string 2', value: str('2') },
  { label: 'string empty', value: str('') },
  { label: 'string true', value: str('true') },
  { label: 'string 1.0', value: str('1.0') },
  { label: 'int 1', value: int(1) },
  { label: 'int8 1', value: int(1, 8) },
  { label: 'int16 1', value: int(1, 16) },
  { label: 'int32 1', value: int(1, 32) },
  { label: 'int64 1', value: int(1, 64) },
  { label: 'int 2', value: int(2) },
  { label: 'int 0', value: int(0) },
  { label: 'int -1', value: int(-1) },
  { label: 'int 128', value: int(128) },
  { label: 'int 70000', value: int(70_000) },
  { label: 'int32 70000', value: int(70_000, 32) },
  { label: 'int64 70000', value: int(70_000, 64) },
  { label: 'int64 2147483648', value: int(2_147_483_648, 64) },
  { label: 'float 1', value: float(1) },
  { label: 'float 1.5', value: float(1.5) },
  { label: 'float 0', value: float(0) },
  { label: 'float -1', value: float(-1) },
  { label: 'boolean true', value: bool(true) },
  { label: 'boolean false', value: bool(false) },
];

// --- every mode against sets of arguments --------------------------------------------------------------------------

const MODES: readonly { readonly label: string; readonly xMatch: XMatch | null }[] = [
  { label: 'omitted', xMatch: null },
  { label: 'all', xMatch: 'all' },
  { label: 'any', xMatch: 'any' },
  { label: 'all-with-x', xMatch: 'all-with-x' },
  { label: 'any-with-x', xMatch: 'any-with-x' },
];

const ARGUMENT_SETS: readonly { readonly label: string; readonly args: readonly HeaderEntry<HeaderCondition>[] }[] = [
  { label: 'nothing', args: [] },
  { label: 'a=1', args: [entry('a', int(1))] },
  { label: 'a=1 b=2', args: [entry('a', int(1)), entry('b', int(2))] },
  { label: 'x-foo=1', args: [entry('x-foo', int(1))] },
  { label: 'a=1 x-foo=1', args: [entry('a', int(1)), entry('x-foo', int(1))] },
  { label: 'x-foo=1 x-bar=2', args: [entry('x-foo', int(1)), entry('x-bar', int(2))] },
  { label: 'a exists', args: [entry('a', exists)] },
  { label: 'a=1 b exists', args: [entry('a', int(1)), entry('b', exists)] },
  { label: 'x-foo exists', args: [entry('x-foo', exists)] },
];

const MODE_MESSAGES: readonly { readonly label: string; readonly headers?: readonly HeaderEntry<HeaderValue>[] }[] = [
  { label: 'no headers' },
  { label: 'empty table', headers: [] },
  { label: 'a=1', headers: [entry('a', int(1))] },
  { label: 'b=2', headers: [entry('b', int(2))] },
  { label: 'a=1 b=2', headers: [entry('a', int(1)), entry('b', int(2))] },
  { label: 'a=2', headers: [entry('a', int(2))] },
  { label: 'x-foo=1', headers: [entry('x-foo', int(1))] },
  { label: 'x-foo=1 a=1', headers: [entry('x-foo', int(1)), entry('a', int(1))] },
  { label: 'x-foo=2 a=1', headers: [entry('x-foo', int(2)), entry('a', int(1))] },
  { label: 'x-foo=1 x-bar=2', headers: [entry('x-foo', int(1)), entry('x-bar', int(2))] },
  { label: 'a=1 b=3', headers: [entry('a', int(1)), entry('b', int(3))] },
  { label: 'a=1 x-bar=2', headers: [entry('a', int(1)), entry('x-bar', int(2))] },
  { label: 'a=string x-foo=string', headers: [entry('a', str('1')), entry('x-foo', str('1'))] },
];

export const HEADERS_SCENARIOS: readonly Scenario[] = [
  headersTable(
    'headers-every-type-and-width-of-a-value-against-every-other',
    'A binding value against a message value, for strings, integers of every width, floats and booleans: 1 is not "1", is not 1.0, is not true, and 1 is 1 whatever its width (ADR-0009)',
    [
      ...VALUES.map(({ label, value }) => ({
        name: `binding ${label}`,
        xMatch: 'all' as const,
        args: [entry('n', value)],
      })),
      { name: 'binding exists', xMatch: 'all', args: [entry('n', exists)] },
    ],
    [
      ...VALUES.map(({ label, value }) => ({ body: `message ${label}`, headers: [entry('n', value)] })),
      { body: 'message without n', headers: [entry('m', int(1))] },
      { body: 'message without headers' },
    ],
  ),
  headersTable(
    'headers-every-x-match-mode-against-sets-of-arguments',
    'The four modes and an omitted x-match against sets of arguments that include x- keys and exists: which arguments count, and what matches when none does (ADR-0009)',
    MODES.flatMap((mode) =>
      ARGUMENT_SETS.map((set) => ({ name: `${mode.label} | ${set.label}`, xMatch: mode.xMatch, args: set.args })),
    ),
    MODE_MESSAGES.map(({ label, headers }) => ({ body: `message ${label}`, headers })),
  ),
  headersTable(
    'headers-the-routing-key-is-ignored',
    'A headers exchange does not look at the routing key: any key on the binding or on the message, and the same message reaches a queue once per queue (ADR-0009)',
    [
      { name: 'key foo', xMatch: 'all', args: [entry('a', int(1))], key: 'foo' },
      { name: 'key bar', xMatch: 'all', args: [entry('a', int(1))], key: 'bar' },
      { name: 'no key', xMatch: 'all', args: [entry('a', int(1))] },
      { name: 'other args', xMatch: 'all', args: [entry('a', int(2))], key: 'foo' },
    ],
    [
      { body: 'key foo', key: 'foo', headers: [entry('a', int(1))] },
      { body: 'key bar', key: 'bar', headers: [entry('a', int(1))] },
      { body: 'no key', headers: [entry('a', int(1))] },
      { body: 'key foo, a=2', key: 'foo', headers: [entry('a', int(2))] },
      { body: 'key foo, no headers', key: 'foo' },
    ],
  ),
  headersTable(
    'headers-keys-are-case-sensitive-and-compared-exactly',
    'Header keys are compared exactly: case, trailing spaces and a composed against a decomposed é all count (ADR-0009)',
    [
      { name: 'a', xMatch: 'all', args: [entry('a', int(1))] },
      { name: 'A', xMatch: 'all', args: [entry('A', int(1))] },
      { name: 'a with a space', xMatch: 'all', args: [entry('a ', int(1))] },
      { name: 'composed e acute', xMatch: 'all', args: [entry('é', int(1))] },
      { name: 'decomposed e acute', xMatch: 'all', args: [entry('é', int(1))] },
      { name: 'x-A with x', xMatch: 'all-with-x', args: [entry('x-A', int(1))] },
    ],
    [
      { body: 'a', headers: [entry('a', int(1))] },
      { body: 'A', headers: [entry('A', int(1))] },
      { body: 'a with a space', headers: [entry('a ', int(1))] },
      { body: 'composed e acute', headers: [entry('é', int(1))] },
      { body: 'decomposed e acute', headers: [entry('é', int(1))] },
      { body: 'x-a', headers: [entry('x-a', int(1))] },
      { body: 'x-A', headers: [entry('x-A', int(1))] },
    ],
  ),
  headersTable(
    'headers-a-queue-bound-with-several-matching-bindings-gets-one-copy',
    'A queue that is bound with several bindings that all match, or with the same binding twice, still gets one copy (ADR-0008, rule 7)',
    [
      { name: 'one', xMatch: 'all', args: [entry('a', int(1))] },
      { name: 'one', xMatch: 'any', args: [entry('a', int(1)), entry('b', int(1))] },
      { name: 'one', xMatch: null, args: [] },
      { name: 'two', xMatch: 'all', args: [entry('a', int(1))] },
      { name: 'two', xMatch: 'all', args: [entry('a', int(1))] },
    ],
    [{ body: 'a=1', headers: [entry('a', int(1))] }, { body: 'b=1', headers: [entry('b', int(1))] }, { body: 'none' }],
  ),
];
