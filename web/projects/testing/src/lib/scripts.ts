import {
  applyCommand,
  edgeKeys,
  emptyDocument,
  History,
  kindOf,
  nameOf,
  type ApplyContext,
  type CanvasChanges,
  type CanvasDocument,
  type ConsumerChanges,
  type DocumentCommand,
  type ElementKind,
  type ElementRef,
  type ExchangeChanges,
  type Issue,
  type ProducerChanges,
} from '@rmq/domain';
import type { HeaderArguments, HeaderCondition, HeaderEntry, HeaderValue, XMatch } from '@rmq/engine';
import * as fc from 'fast-check';
import { prefixedIds, sequentialIds } from './commands';
import { deepFreeze } from './topology';

/**
 * Scripts of commands for property tests (ADR-0015, ADR-0019). A script is a list of steps, each a command or an undo or a
 * redo or the load of a canvas, and it is played against a canvas with a `History`, one step after another. The commands are
 * not written out: a step is an *intent*, a few numbers and a flag, and `commandFor` reads it against the canvas that it
 * meets, picking elements that are there. So most commands are valid, which makes the interesting states reachable, a few
 * are not, which makes the refusals reachable, and a failing script shrinks to small numbers.
 */

export interface Intent {
  readonly verb: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly flag: boolean;
  /** 0 for a name that is odd, which takes a turn of the quoting. */
  readonly odd: number;
}

export const arbIntent: fc.Arbitrary<Intent> = fc.record({
  verb: fc.nat(10_000),
  a: fc.nat(10_000),
  b: fc.nat(10_000),
  c: fc.nat(10_000),
  d: fc.nat(10_000),
  flag: fc.boolean(),
  odd: fc.nat(11),
});

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
/** Names that are valid and are read as something else if they are not quoted, and a few that a broker refuses. */
const ODD_NAMES = [
  'my queue',
  'a;b',
  'queue:q',
  'exchange:',
  'a=b',
  'é',
  '日本',
  'x->y',
  'canvas',
  'true',
  '1',
  '1.0',
  'exists(a)',
  '"quoted"',
  'back\\slash',
  'header:h',
  'amq',
  'AMQ.x',
  'amq.gen',
  '',
  'k'.repeat(255),
  '\n',
  '\ud800',
] as const;
const KEYS = [
  '',
  'a',
  'a.b',
  'a.*',
  '#',
  '*.b',
  'a.#.b',
  '#.#',
  '#.#.#',
  'x y',
  'k=v',
  'é.日本',
  'a;b',
  'queue:k',
  '->',
] as const;
const MODES: readonly (XMatch | null)[] = [null, 'all', 'any', 'all-with-x', 'any-with-x'];
const HEADER_KEYS = ['a', 'b', 'x-c', 'key', 'my header', 'exists', 'k=v'] as const;
const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'] as const;
const VALUES: readonly HeaderValue[] = [
  { t: 'string', v: '1' },
  { t: 'string', v: 'pdf' },
  { t: 'string', v: '' },
  { t: 'string', v: 'a b' },
  { t: 'string', v: 'true' },
  { t: 'integer', v: 1 },
  { t: 'integer', v: 0 },
  { t: 'integer', v: -5 },
  { t: 'integer', v: Number.MAX_SAFE_INTEGER },
  { t: 'float', v: 1 },
  { t: 'float', v: 1.5 },
  { t: 'float', v: -0 },
  { t: 'float', v: 1e21 },
  { t: 'float', v: 5e-324 },
  { t: 'boolean', v: true },
  { t: 'boolean', v: false },
];

/** The item at `index`, going round, of a list that is not empty. */
const at = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

const nameFor = (i: Intent, salt: number): string => (i.odd === 0 ? at(ODD_NAMES, i.a + salt) : at(NAMES, i.a + salt));

const namesOfKind = (document: CanvasDocument, kind: ElementKind): string[] =>
  Object.values(
    kind === 'exchange'
      ? document.exchanges
      : kind === 'queue'
        ? document.queues
        : kind === 'producer'
          ? document.producers
          : document.consumers,
  ).map(({ name }) => name);

/** An element of the kind that is on the canvas, or, if there is none, a name for one that is not. */
function refOf(document: CanvasDocument, kind: ElementKind, index: number, i: Intent): ElementRef {
  const names = namesOfKind(document, kind);
  return { kind, name: names.length === 0 ? nameFor(i, index) : at(names, index) };
}

/** Any element, of any kind that has one. */
function anyRef(document: CanvasDocument, i: Intent): ElementRef {
  const all = (['exchange', 'queue', 'producer', 'consumer'] as const).flatMap((kind) =>
    namesOfKind(document, kind).map((name): ElementRef => ({ kind, name })),
  );
  return all.length === 0 ? { kind: 'queue', name: nameFor(i, 0) } : at(all, i.a);
}

const valueFor = (i: Intent, salt: number): HeaderValue => at(VALUES, i.c + salt);

/** Up to three headers with names that are all different, as a broker's table has. */
function headerKeysFor(i: Intent): string[] {
  return [...new Set(Array.from({ length: i.b % 4 }, (_, index) => at(HEADER_KEYS, i.d + index * 3)))];
}

function conditionsFor(i: Intent): HeaderEntry<HeaderCondition>[] {
  return headerKeysFor(i).map((key, index) => ({
    key,
    value: i.flag && index === 0 ? { t: 'exists' } : valueFor(i, index),
  }));
}

function headersFor(i: Intent): HeaderArguments | undefined {
  return i.flag || i.b % 3 === 0 ? { xMatch: at(MODES, i.c), args: conditionsFor(i) } : undefined;
}

/** Message headers: names that are different, with values and never `exists`. At least one. */
function messageHeadersFor(i: Intent): HeaderEntry<HeaderValue>[] {
  const keys = headerKeysFor(i);
  return (keys.length === 0 ? ['a'] : keys).map((key, index) => ({ key, value: valueFor(i, index) }));
}

const VERBS = [
  ...Array<string>(5).fill('declare-exchange'),
  ...Array<string>(5).fill('declare-queue'),
  'add-producer',
  'add-producer',
  'add-consumer',
  'add-consumer',
  ...Array<string>(9).fill('bind'),
  ...Array<string>(3).fill('unbind'),
  ...Array<string>(4).fill('link'),
  ...Array<string>(3).fill('unlink'),
  ...Array<string>(4).fill('subscribe'),
  ...Array<string>(3).fill('unsubscribe'),
  ...Array<string>(5).fill('set'),
  ...Array<string>(4).fill('unset'),
  ...Array<string>(2).fill('move'),
  'move-label',
  ...Array<string>(2).fill('rename'),
  ...Array<string>(2).fill('delete'),
  'layout',
  'batch',
];

/** The edges of a canvas as the elements at their two ends. */
function edgesOf(document: CanvasDocument): [ElementRef, ElementRef][] {
  const ref = (id: string): ElementRef | undefined => {
    const kind = kindOf(document, id);
    const name = kind === undefined ? undefined : nameOf(document, kind, id);
    return kind === undefined || name === undefined ? undefined : { kind, name };
  };
  return [...edgeKeys(document)].flatMap((key) => {
    const [from, to] = key.split('>').map(ref);
    return from === undefined || to === undefined ? [] : [[from, to] as [ElementRef, ElementRef]];
  });
}

/** A binding made up from the elements that are there, or from names for ones that are not. */
function madeUpBinding(document: CanvasDocument, i: Intent) {
  const toExchange = i.b % 3 === 0 || namesOfKind(document, 'queue').length === 0;
  const destination = refOf(document, toExchange ? 'exchange' : 'queue', i.c, i);
  const headers = headersFor(i);
  return {
    source: refOf(document, 'exchange', i.a, i).name,
    destination: { kind: toExchange ? ('exchange' as const) : ('queue' as const), name: destination.name },
    key: at(KEYS, i.d),
    ...(headers === undefined ? {} : { headers }),
  };
}

/** A binding that is on the canvas, as the two names, the key and the arguments that say it. */
function existingBinding(document: CanvasDocument, index: number) {
  const bindings = Object.values(document.bindings).flatMap((binding) => {
    const source = Object.hasOwn(document.exchanges, binding.source) ? document.exchanges[binding.source] : undefined;
    const ends = binding.dest.kind === 'queue' ? document.queues : document.exchanges;
    const destination = Object.hasOwn(ends, binding.dest.id) ? ends[binding.dest.id] : undefined;
    return source === undefined || destination === undefined
      ? []
      : [
          {
            source: source.name,
            destination: { kind: binding.dest.kind, name: destination.name },
            key: binding.key,
            ...(binding.headers === undefined ? {} : { headers: binding.headers }),
          },
        ];
  });
  return bindings.length === 0 ? undefined : at(bindings, index);
}

function setFor(document: CanvasDocument, i: Intent): DocumentCommand {
  // The kind of thing to set is one that the canvas has, and the canvas itself, except now and then.
  const present = (['exchange', 'queue', 'producer', 'consumer'] as const).filter(
    (kind) => namesOfKind(document, kind).length > 0,
  );
  const target = at(
    i.d % 8 === 0
      ? (['exchange', 'queue', 'producer', 'consumer', 'canvas'] as const)
      : [...present, 'canvas' as const],
    i.b,
  );
  if (target === 'canvas') {
    const changes: CanvasChanges[] = [
      { showDefaultExchange: i.flag },
      { seed: i.c },
      { publishMs: i.c % 1000 },
      { brokerMs: i.d % 1000, deliverMs: i.c % 1000 },
    ];
    return { type: 'set', kind: 'canvas', changes: at(changes, i.d) };
  }
  const { name } = refOf(document, target, i.a, i);
  switch (target) {
    case 'exchange': {
      const changes: ExchangeChanges[] = [
        { exchangeType: at(EXCHANGE_TYPES, i.c) },
        { durable: i.flag },
        { autoDelete: i.flag },
        { internal: i.flag },
        { durable: i.flag, autoDelete: !i.flag },
      ];
      return { type: 'set', kind: 'exchange', name, changes: at(changes, i.d) };
    }
    case 'queue':
      return { type: 'set', kind: 'queue', name, changes: { durable: i.flag || i.c % 7 !== 0 } };
    case 'producer': {
      const changes: ProducerChanges[] = [
        { payload: nameFor(i, 4) },
        { key: at(KEYS, i.c) },
        { burst: 1 + (i.c % 20) },
        { everyMs: 1 + (i.c % 5000) },
        { repeat: i.flag },
        { headers: messageHeadersFor(i) },
        { headers: messageHeadersFor({ ...i, b: i.b + 1 }) },
        { headers: messageHeadersFor({ ...i, b: i.b + 2 }) },
        { payload: 'x', burst: 1 + (i.d % 9), repeat: i.flag },
      ];
      return { type: 'set', kind: 'producer', name, changes: at(changes, i.d) };
    }
    case 'consumer': {
      const changes: ConsumerChanges[] = [
        { ack: i.flag ? 'manual' : 'auto' },
        { prefetch: i.c % 100 },
        { processingMs: i.c },
        { ack: 'manual', prefetch: i.d % 10 },
      ];
      return { type: 'set', kind: 'consumer', name, changes: at(changes, i.d) };
    }
  }
}

const CREATORS = [
  'declare-exchange',
  'declare-queue',
  'add-producer',
  'add-consumer',
  'declare-queue',
  'declare-exchange',
] as const;

/**
 * What a script does where a command has nothing to work on: a command that is about what the canvas does not have yet makes
 * something instead, and a command that takes something away puts it there first. `undefined` if the command has what it needs.
 */
function insteadOf(document: CanvasDocument, verb: string): string | undefined {
  const has = (kind: ElementKind) => namesOfKind(document, kind).length > 0;
  switch (verb) {
    case 'bind':
      return has('exchange') ? undefined : 'declare-exchange';
    case 'unbind':
      return !has('exchange') ? 'declare-exchange' : Object.keys(document.bindings).length === 0 ? 'bind' : undefined;
    case 'link':
      return !has('producer') || (!has('exchange') && !has('queue')) ? 'create' : undefined;
    case 'unlink':
      return !has('producer')
        ? 'add-producer'
        : Object.values(document.producers).some(({ target }) => target !== null)
          ? undefined
          : 'link';
    case 'unset':
      return !has('producer')
        ? 'add-producer'
        : Object.values(document.producers).some(({ message }) => message.headers.length > 0)
          ? undefined
          : 'set-headers';
    case 'subscribe':
      return !has('consumer') || !has('queue') ? 'create' : undefined;
    case 'unsubscribe':
      return !has('consumer') || !has('queue')
        ? 'create'
        : Object.values(document.consumers).some(({ queues }) => queues.length > 0)
          ? undefined
          : 'subscribe';
    case 'set':
    case 'move':
    case 'rename':
    case 'delete':
      return has('exchange') || has('queue') || has('producer') || has('consumer') ? undefined : 'create';
    default:
      return undefined;
  }
}

/**
 * What one step of a script says, read against the canvas that it is applied to. Never an empty `set`, `unset` or `move`.
 * A batch is never made inside a batch, and what stands where it would be is a `layout`.
 */
export function commandFor(document: CanvasDocument, i: Intent, insideBatch = false): DocumentCommand {
  const wanted = at(VERBS, i.verb);
  // Except now and then: a command that is refused for having nothing to work on is one of the cases to try.
  const instead = i.d % 8 === 0 ? undefined : insteadOf(document, wanted);
  const verb = instead === 'create' ? at(CREATORS, i.b) : (instead ?? wanted);
  if (insideBatch && verb === 'batch') {
    return { type: 'layout' };
  }
  switch (verb) {
    case 'declare-exchange':
      return {
        type: 'declare-exchange',
        name: nameFor(i, 0),
        exchangeType: at(EXCHANGE_TYPES, i.b),
        durable: i.c % 5 !== 0,
        autoDelete: i.c % 7 === 0,
        internal: i.d % 6 === 0,
      };
    case 'declare-queue':
      return { type: 'declare-queue', name: nameFor(i, 1), durable: i.b % 9 !== 0 };
    case 'add-producer':
      return { type: 'add-producer', name: nameFor(i, 2) };
    case 'add-consumer':
      return { type: 'add-consumer', name: nameFor(i, 3) };
    case 'bind':
      return { type: 'bind', ...madeUpBinding(document, i) };
    case 'unbind': {
      // Most unbindings take off a binding that is there, and some name one that is not.
      const existing = i.flag || i.d % 4 !== 0 ? existingBinding(document, i.a) : undefined;
      return { type: 'unbind', ...(existing ?? madeUpBinding(document, i)) };
    }
    case 'link': {
      const toExchange =
        i.b % 2 === 0 ? namesOfKind(document, 'exchange').length > 0 : namesOfKind(document, 'queue').length === 0;
      return {
        type: 'link',
        producer: refOf(document, 'producer', i.a, i).name,
        target: {
          kind: toExchange ? 'exchange' : 'queue',
          name: refOf(document, toExchange ? 'exchange' : 'queue', i.c, i).name,
        },
      };
    }
    case 'unlink': {
      const linked = Object.values(document.producers).filter(({ target }) => target !== null);
      const taking = linked.length > 0 && (i.flag || i.d % 4 !== 0);
      return { type: 'unlink', producer: taking ? at(linked, i.a).name : refOf(document, 'producer', i.a, i).name };
    }
    case 'subscribe':
      return {
        type: 'subscribe',
        consumer: refOf(document, 'consumer', i.a, i).name,
        queue: refOf(document, 'queue', i.b, i).name,
      };
    case 'unsubscribe': {
      const pairs = Object.values(document.consumers).flatMap((consumer) =>
        consumer.queues.flatMap((id) =>
          Object.hasOwn(document.queues, id)
            ? [{ consumer: consumer.name, queue: (document.queues[id] as { name: string }).name }]
            : [],
        ),
      );
      const pair = pairs.length > 0 && (i.flag || i.d % 4 !== 0) ? at(pairs, i.a) : undefined;
      return {
        type: 'unsubscribe',
        ...(pair ?? {
          consumer: refOf(document, 'consumer', i.a, i).name,
          queue: refOf(document, 'queue', i.b, i).name,
        }),
      };
    }
    case 'set':
      return setFor(document, i);
    case 'set-headers': {
      const { name } = refOf(document, 'producer', i.a, i);
      return { type: 'set', kind: 'producer', name, changes: { headers: messageHeadersFor(i) } };
    }
    case 'unset': {
      // A producer that has headers, most of the time, and a header that it has.
      const withHeaders = Object.values(document.producers).filter(({ message }) => message.headers.length > 0);
      const taking = withHeaders.length > 0 && (i.flag || i.d % 4 !== 0) ? at(withHeaders, i.a) : undefined;
      return taking === undefined
        ? { type: 'unset', kind: 'producer', name: refOf(document, 'producer', i.a, i).name, headers: ['a'] }
        : { type: 'unset', kind: 'producer', name: taking.name, headers: [at(taking.message.headers, i.b).key] };
    }
    case 'move': {
      const x = (i.c % 2000) - 1000 + (i.d % 4) * 0.25;
      const y = (i.b % 2000) - 1000;
      const coordinates = i.d % 3 === 0 ? { x, y } : i.d % 3 === 1 ? { x } : { y };
      return { type: 'move', target: anyRef(document, i), ...coordinates };
    }
    case 'move-label': {
      const edges = edgesOf(document);
      if (edges.length === 0) {
        return { type: 'layout' };
      }
      const [from, to] = at(edges, i.a);
      return { type: 'move-label', from, to, at: (i.c % 101) / 100 };
    }
    case 'rename':
      return { type: 'rename', target: anyRef(document, i), name: nameFor(i, 5) };
    case 'delete':
      return { type: 'delete', target: anyRef(document, i) };
    case 'layout':
      return { type: 'layout' };
    default:
      return batchFor(document, i);
  }
}

/** A batch of two or three commands, each of which applies to what the one before made. A batch that cannot be made is its first command. */
function batchFor(document: CanvasDocument, i: Intent): DocumentCommand {
  // The canvases that it steps through are thrown away, so their ids only have to be ones that the document does not have.
  const ids = prefixedIds('batch');
  let working = document;
  const commands: DocumentCommand[] = [];
  for (let step = 0; step < 3; step++) {
    const command = commandFor(
      working,
      { ...i, verb: (i.verb * 7 + step * 13 + 1) % 10_000, a: (i.a + step * 17) % 10_000 },
      true,
    );
    const result = applyCommand(working, command, ids);
    if (result.ok) {
      working = result.value;
      commands.push(command);
    }
  }
  return commands.length >= 2 ? { type: 'batch', commands } : (commands[0] ?? { type: 'layout' });
}

/** One step of a script. */
export type Step =
  | { readonly kind: 'command'; readonly intent: Intent }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  /** A canvas made somewhere else, built from nothing by these intents, put in place of the one that is open. */
  | { readonly kind: 'load'; readonly intents: readonly Intent[] };

export const arbStep: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: arbIntent.map((intent): Step => ({ kind: 'command', intent })), weight: 14 },
  { arbitrary: fc.constant<Step>({ kind: 'undo' }), weight: 3 },
  { arbitrary: fc.constant<Step>({ kind: 'redo' }), weight: 2 },
  { arbitrary: fc.array(arbIntent, { maxLength: 8 }).map((intents): Step => ({ kind: 'load', intents })), weight: 1 },
);

export const arbScript: fc.Arbitrary<Step[]> = fc.array(arbStep, { minLength: 8, maxLength: 40 });

/** What happened at one step: the canvas before, the canvas after, and how it came to be. */
export interface Transition {
  readonly via: 'command' | 'undo' | 'redo' | 'load';
  readonly before: CanvasDocument;
  readonly after: CanvasDocument;
  /** For a command: the command, and why it was refused if it was. */
  readonly command?: DocumentCommand;
  readonly refused?: Issue;
  /** The history, as it is after the step. */
  readonly history: History;
}

/** Applies the commands of intents to nothing, and keeps what applies. */
export function build(intents: readonly Intent[], context: ApplyContext = sequentialIds()): CanvasDocument {
  let document = deepFreeze(emptyDocument());
  for (const intent of intents) {
    const result = applyCommand(document, commandFor(document, intent), context);
    if (result.ok) {
      document = deepFreeze(result.value);
    }
  }
  return document;
}

/**
 * Plays a script against an empty canvas with a history, and yields each step. A command that is refused changes nothing,
 * and one that changes nothing is not put in the history. An undo with nothing to undo, and a redo with nothing to redo,
 * change nothing either. Every canvas is deeply frozen, so that a command that changes one throws.
 */
export function* playScript(steps: readonly Step[]): Generator<Transition> {
  const history = new History();
  const context = sequentialIds();
  let loads = 0;
  let document = deepFreeze(emptyDocument());

  for (const step of steps) {
    const before = document;
    if (step.kind === 'command') {
      const command = commandFor(document, step.intent);
      const result = applyCommand(document, command, context);
      if (result.ok) {
        document = deepFreeze(result.value);
        if (document !== before) {
          history.push(before);
        }
        yield { via: 'command', before, after: document, command, history };
      } else {
        yield { via: 'command', before, after: document, command, refused: result.error, history };
      }
    } else if (step.kind === 'undo') {
      document = history.undo(document) ?? document;
      yield { via: 'undo', before, after: document, history };
    } else if (step.kind === 'redo') {
      document = history.redo(document) ?? document;
      yield { via: 'redo', before, after: document, history };
    } else {
      // A canvas that is loaded has ids of its own, so that they never meet the ones that the commands go on to make.
      loads += 1;
      document = build(step.intents, prefixedIds(`L${loads}`));
      history.clear();
      yield { via: 'load', before, after: document, history };
    }
  }
}

/** The canvas that a script ends with, which is empty if it has no steps. */
export function finalDocument(steps: readonly Step[]): CanvasDocument {
  let last: CanvasDocument = deepFreeze(emptyDocument());
  for (const transition of playScript(steps)) {
    last = transition.after;
  }
  return last;
}

/** Canvases that commands made: every one is valid and deeply frozen, and they run from empty to quite full. */
export const arbDocument: fc.Arbitrary<CanvasDocument> = arbScript.map(finalDocument);
