import type { DocumentCommand } from '@rmq/domain';
import { ORDERS_COMMANDS } from './orders';
import { buildDocument } from './seed';

/**
 * Canvases for the tests of the conditions of a headers binding (S8, ADR-0066 to ADR-0070), made with the commands of the domain. A producer that repeats starts to send as soon as the canvas is
 * opened, so none of them has one: a test sends what it wants, with a key or a command, and the clock is stopped until it steps it.
 */

const headersExchange = (name: string): DocumentCommand => ({
  type: 'declare-exchange',
  name,
  exchangeType: 'headers',
  durable: true,
  autoDelete: false,
  internal: false,
});

const text = (key: string, v: string) => ({ key, value: { t: 'string', v } }) as const;
const integer = (key: string, v: number) => ({ key, value: { t: 'integer', v } }) as const;
const flag = (key: string, v: boolean) => ({ key, value: { t: 'boolean', v } }) as const;
const exists = (key: string) => ({ key, value: { t: 'exists' } }) as const;

/** A binding from a headers exchange to a queue, with the mode and the conditions it is given. */
const bindTo = (
  source: string,
  queue: string,
  xMatch: 'all' | 'any' | 'all-with-x' | 'any-with-x' | null,
  args: readonly (
    ReturnType<typeof text> | ReturnType<typeof integer> | ReturnType<typeof flag> | ReturnType<typeof exists>
  )[],
): DocumentCommand => ({
  type: 'bind',
  source,
  destination: { kind: 'queue', name: queue },
  key: '',
  headers: { xMatch, args },
});

/**
 * `sender` publishes to the headers exchange `files`, which has the queues `pdfs` and `scans` and nothing bound to them yet, for the tests that make the bindings. The ids are `p1`, `x1`, `q1` (`pdfs`) and
 * `q2` (`scans`), and the edge `p1>x1`.
 */
export const FILES = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'scans', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
]);

/**
 * `FILES`, and two bindings: `pdfs` asks for all of `format=pdf` and `type=report`, and `scans` for any of `format=tiff` and `dpi=300`. The edges are `x1>q1` and `x1>q2`. `sender` sends `format=pdf`
 * and `type=report`, which `pdfs` takes and `scans` does not.
 */
export const FILES_BOUND = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'scans', durable: true },
  bindTo('files', 'pdfs', 'all', [text('format', 'pdf'), text('type', 'report')]),
  bindTo('files', 'scans', 'any', [text('format', 'tiff'), integer('dpi', 300)]),
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
  {
    type: 'set',
    kind: 'producer',
    name: 'sender',
    changes: { payload: 'q3.pdf', headers: [text('format', 'pdf'), text('type', 'report')] },
  },
]);

/**
 * `FILES_BOUND`, and a second binding to `pdfs` that asks for `format=pdf` alone: the edge `x1>q1` has two bindings, one with two conditions and one with one, and the second binding is the one that
 * an edit of the first can come to be the same as.
 */
export const FILES_TWICE = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  bindTo('files', 'pdfs', 'all', [text('format', 'pdf'), text('type', 'report')]),
  bindTo('files', 'pdfs', 'all', [text('format', 'pdf')]),
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
]);

/**
 * One binding with so many conditions that its chip cuts them and its card has to list them: `files` to `pdfs`, all with `x-`, with `format`, `type`, `size`, `big`, `exists(author)` and `x-region`. A second
 * binding, `all` with `format` and an `x-` argument, to `scans`, whose chip says that the `x-` argument is not counted. The edges are `x1>q1` and `x1>q2`.
 */
export const MANY_CONDITIONS = buildDocument([
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'scans', durable: true },
  bindTo('files', 'pdfs', 'all-with-x', [
    text('format', 'pdf'),
    text('type', 'report'),
    integer('size', 10),
    flag('big', false),
    exists('author'),
    text('x-region', 'eu'),
  ]),
  bindTo('files', 'scans', 'all', [text('format', 'tiff'), text('x-region', 'eu')]),
]);

/**
 * `sender` publishes to the headers exchange `numbers`, which has the queues `ints` and `texts` and nothing bound and no headers in the message: the learner makes both bindings, one with `n=1` and one
 * with `n="1"`, and sends a message with `n` as a number and as a text. The ids are `p1`, `x1`, `q1` (`ints`) and `q2` (`texts`).
 */
export const NUMBERS = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('numbers'),
  { type: 'declare-queue', name: 'ints', durable: true },
  { type: 'declare-queue', name: 'texts', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'numbers' } },
]);

/**
 * `sender` sends `format=pdf` to the headers exchange `files`, which has one queue, `pdfs`, bound with all of `format=pdf` and `x-region=eu`: under `all` the `x-` argument is not counted, so the message
 * matches, and under `all-with-x` it is, and the message has no `x-region`, so it does not. The ids are `p1`, `x1` and `q1`.
 */
export const EXTRA_KEY = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  bindTo('files', 'pdfs', 'all', [text('format', 'pdf'), text('x-region', 'eu')]),
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
  { type: 'set', kind: 'producer', name: 'sender', changes: { payload: 'q3.pdf', headers: [text('format', 'pdf')] } },
]);

/**
 * A topic exchange `logs` in front of the headers exchange `files`, and `files` bound to `pdfs` with `format=pdf`: a message that `sender` publishes to `logs` gets to `files` by the binding between the two
 * exchanges, and the live table of the binding of `files` shows it. The ids are `p1`, `x1` (`logs`), `x2` (`files`) and `q1`.
 */
export const THROUGH_AN_EXCHANGE = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'logs',
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'bind', source: 'logs', destination: { kind: 'exchange', name: 'files' }, key: '#' },
  bindTo('files', 'pdfs', 'all', [text('format', 'pdf')]),
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'logs' } },
  { type: 'set', kind: 'producer', name: 'sender', changes: { key: 'app.new', headers: [text('format', 'pdf')] } },
]);

/**
 * `sender` publishes `format=pdf` and `type=report` to the headers exchange `files`, which has the queues `pdfs`, `reports` and `images` and no bindings, for the tests that make a binding from a message.
 * `images` is the queue that a binding made from the message goes to when the learner chooses it. The ids are `p1`, `x1`, `q1`, `q2` and `q3`.
 */
export const FILES_UNBOUND = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'reports', durable: true },
  { type: 'declare-queue', name: 'images', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
  {
    type: 'set',
    kind: 'producer',
    name: 'sender',
    changes: { payload: 'q3.pdf', headers: [text('format', 'pdf'), text('type', 'report')] },
  },
]);

/**
 * `FILES_UNBOUND`, with a message that also has `x-region` and `x-match`: the first starts with `x-` and is not counted by every mode, and the second is the mode of a binding and cannot be a condition.
 */
export const FILES_WITH_X = buildDocument([
  { type: 'add-producer', name: 'sender' },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'reports', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
  {
    type: 'set',
    kind: 'producer',
    name: 'sender',
    changes: { payload: 'q3.pdf', headers: [text('format', 'pdf'), text('x-region', 'eu'), text('x-match', 'any')] },
  },
]);

/**
 * The canvas of `orders.ts` that has a direct exchange, with the headers `format=pdf` in the message that `sender` sends to it, which the exchange does not read, and no headers exchange to make a binding
 * on. The ids are `p1`, `x1` (`orders`), `q1` (`billing`) and `c1`.
 */
export const DIRECT_WITH_HEADERS = buildDocument([
  ...ORDERS_COMMANDS,
  { type: 'set', kind: 'producer', name: 'sender', changes: { headers: [text('format', 'pdf')] } },
]);

/** `DIRECT_WITH_HEADERS`, and a headers exchange `files` with a queue `pdfs`, which the message did not go to, for a binding made from it. The ids are `x2` and `q2`. */
export const DIRECT_AND_HEADERS = buildDocument([
  ...ORDERS_COMMANDS,
  { type: 'set', kind: 'producer', name: 'sender', changes: { headers: [text('format', 'pdf')] } },
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
]);

/**
 * `files` has a binding to `pdfs` with x-match any and one argument, `x-region`, which `any` does not count: with nothing to match it matches no message, which is what the lint says. The second binding,
 * to `scans`, is as it should be. The edges are `x1>q1` and `x1>q2`.
 */
export const NEVER = buildDocument([
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'scans', durable: true },
  bindTo('files', 'pdfs', 'any', [text('x-region', 'eu')]),
  bindTo('files', 'scans', 'any', [text('format', 'tiff')]),
]);

/**
 * `files` has a binding to `pdfs` that was made with a key, `legacy`, which a headers exchange does not read, and one condition: the editor says so, and keeps the key when the conditions are changed. The
 * edge is `x1>q1`.
 */
export const KEYED = buildDocument([
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  {
    type: 'bind',
    source: 'files',
    destination: { kind: 'queue', name: 'pdfs' },
    key: 'legacy',
    headers: { xMatch: 'all', args: [text('format', 'pdf')] },
  },
]);

/** `files` has a binding to `pdfs` with a condition that has a value of forty characters and no space in it, which a chip has to break where the line ends. The edge is `x1>q1`. */
export const LONG_VALUE = buildDocument([
  headersExchange('files'),
  { type: 'declare-queue', name: 'pdfs', durable: true },
  bindTo('files', 'pdfs', 'all', [text('description', 'x'.repeat(40))]),
]);
