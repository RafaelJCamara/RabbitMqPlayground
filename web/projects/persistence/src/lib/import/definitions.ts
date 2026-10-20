import {
  applyCommand,
  emptyDocument,
  type ApplyContext,
  type Batch,
  type BindCommand,
  type CanvasDocument,
  type DeclareExchange,
  type DeclareQueue,
  type DocumentCommand,
  type IdKind,
} from '@rmq/domain';
import type { ExchangeType, HeaderArguments, HeaderCondition, HeaderEntry, XMatch } from '@rmq/engine';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import { vhostIssue, type DefinitionsSummary } from '../export/definitions';
import { isJsonObject, JsonNumber, readJson, type JsonObject, type JsonValue } from './json';

/**
 * The import of a RabbitMQ definitions file into the canvas that is open (ADR-0014, ADR-0111). It reads the exchanges, the queues and the bindings
 * of one vhost, and turns them into the commands that a learner could have typed, so that the canvas gets them the one way that it changes: the
 * commands check every name and rule, and what they refuse is said and left out, and never breaks the import. Everything else in the file (users,
 * permissions, policies, parameters, other vhosts, arguments the simulator does not model) is left out too, and the report says what, in words.
 */

/** What the import says about what it left out or changed. */
export type ImportNoteKind = 'left-out' | 'changed' | 'refused';

export interface ImportNote {
  readonly kind: ImportNoteKind;
  readonly message: string;
}

/** Why a file cannot be imported at all. */
export type ImportError =
  | { readonly kind: 'not-json'; readonly message: string }
  | { readonly kind: 'too-large'; readonly message: string }
  | { readonly kind: 'not-definitions'; readonly message: string }
  | { readonly kind: 'vhost'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string; readonly notes: readonly ImportNote[] };

/** A definitions file as it was read: its vhosts, and the entries of the three lists that a canvas can hold, not yet checked. */
export interface DefinitionsFile {
  /** The vhosts that the file names, in the order in which it names them first. An export of one vhost from the management UI names none. */
  readonly vhosts: readonly string[];
  readonly exchanges: readonly JsonValue[];
  readonly queues: readonly JsonValue[];
  readonly bindings: readonly JsonValue[];
  /** The other lists of the file that have something in them, with how many: users, permissions, policies and so on. */
  readonly others: readonly { readonly section: string; readonly count: number }[];
}

/** What an import will do: the commands that make the canvas, what they make, and what was left out or changed. */
export interface ImportPlan {
  /** The vhost that the canvas takes, or `null` when the file names none and the canvas keeps its own. */
  readonly vhost: string | null;
  readonly commands: readonly DocumentCommand[];
  readonly summary: DefinitionsSummary;
  readonly notes: readonly ImportNote[];
}

const LISTS = ['exchanges', 'queues', 'bindings'] as const;
/**
 * The other lists of a definitions file that hold what a broker has: they are left out, and the report says so. The rest of a file says where it came
 * from (`rabbitmq_version`, `explanation`, `metadata` and the like, and `global_parameters`, which name the cluster) and is not left out of anything,
 * so it is not said.
 */
const OTHER_SECTIONS = ['users', 'permissions', 'topic_permissions', 'policies', 'parameters', 'limits'] as const;
const EXCHANGE_TYPES: readonly ExchangeType[] = ['direct', 'fanout', 'topic', 'headers'];
const X_MATCH: readonly XMatch[] = ['all', 'any', 'all-with-x', 'any-with-x'];
/** What `x-queue-type` can say of a queue that the simulator holds as it is. */
const CLASSIC = 'classic';
/** What some editors put at the start of a UTF-8 file. It is not a part of the JSON. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const quoted = (name: string): string => `“${name}”`;
const plural = (count: number, thing: string): string => `${count} ${thing}${count === 1 ? '' : 's'}`;

/** “a”, “a” and “b”, or “a”, “b” and “c”: words in a sentence. More than five are counted. */
function listOf(words: readonly string[]): string {
  const shown = words.slice(0, 5);
  const more = words.length - shown.length;
  const all = more > 0 ? [...shown, `${more} more`] : shown;
  return all.length < 2 ? all.join('') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

const NOT_DEFINITIONS =
  'This is not a RabbitMQ definitions file: it has no list of "exchanges", "queues" or "bindings". A broker writes one with "Export definitions" in its management UI, or with `rabbitmqctl export_definitions`.';

/** Reads a definitions file. It fails, in words, for text that is too long, is not JSON, or is not a definitions file; it says nothing yet about what is inside the lists. */
export function readDefinitions(text: string): Outcome<DefinitionsFile, ImportError> {
  if (text.length > SIZE_CAPS.file) {
    return failure({
      kind: 'too-large',
      message: `This file is too large to import: it has ${text.length} characters, and a file can have at most ${SIZE_CAPS.file}.`,
    });
  }
  const read = readJson(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
  if (!read.ok) {
    return failure({ kind: 'not-json', message: `This file is not JSON: ${read.error}.` });
  }
  const data = read.value;
  if (!isJsonObject(data)) {
    return failure({ kind: 'not-definitions', message: NOT_DEFINITIONS });
  }
  const format = data.get('format');
  if (typeof format === 'string' && format.startsWith('rmq-playground/')) {
    return failure({
      kind: 'not-definitions',
      message:
        'This is a file of this app, not a RabbitMQ definitions file. Open a canvas file or a backup from My canvases.',
    });
  }
  if (!LISTS.some((list) => data.has(list))) {
    return failure({ kind: 'not-definitions', message: NOT_DEFINITIONS });
  }
  const lists: Record<(typeof LISTS)[number], readonly JsonValue[]> = { exchanges: [], queues: [], bindings: [] };
  for (const list of LISTS) {
    const value = data.get(list);
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      return failure({
        kind: 'not-definitions',
        message: `This definitions file cannot be read: "${list}" has to be a list, and it is not.`,
      });
    }
    lists[list] = value as readonly JsonValue[];
  }

  const vhosts: string[] = [];
  const named = (vhost: JsonValue | undefined): void => {
    if (typeof vhost === 'string' && !vhosts.includes(vhost)) {
      vhosts.push(vhost);
    }
  };
  const declared = data.get('vhosts');
  if (Array.isArray(declared)) {
    for (const vhost of declared as readonly JsonValue[]) {
      named(isJsonObject(vhost) ? vhost.get('name') : undefined);
    }
  }
  for (const list of LISTS) {
    for (const entry of lists[list]) {
      named(isJsonObject(entry) ? entry.get('vhost') : undefined);
    }
  }

  const others = OTHER_SECTIONS.filter((section) => data.has(section)).flatMap((section) => {
    const value = data.get(section);
    const count = Array.isArray(value) ? value.length : isJsonObject(value) ? value.size : 0;
    return count === 0 ? [] : [{ section, count }];
  });
  return succeed({ vhosts, ...lists, others });
}

/** The vhost to import when the learner has not chosen one: the only one that the file names, or none when it names none. With several, the learner chooses. */
export function defaultVhost(file: DefinitionsFile): string | null | undefined {
  return file.vhosts.length === 0 ? null : file.vhosts.length === 1 ? file.vhosts[0] : undefined;
}

/** Ids that count up from 1 for each kind of thing, for the canvas on which the commands are tried. */
function counting(): ApplyContext {
  const counters = new Map<IdKind, number>();
  return {
    newId(kind) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind.charAt(0)}${next}`;
    },
  };
}

const flag = (entry: JsonObject, key: string, otherwise: boolean): boolean | undefined => {
  const value = entry.get(key);
  return value === undefined ? otherwise : typeof value === 'boolean' ? value : undefined;
};

const argumentsOf = (entry: JsonObject): JsonObject | undefined => {
  const value = entry.get('arguments');
  return value === undefined || value === null ? new Map() : isJsonObject(value) ? value : undefined;
};

/** A header value of a binding, as the canvas holds it, or why it cannot be one. */
function conditionOf(value: JsonValue): HeaderCondition | string {
  if (typeof value === 'string') {
    return { t: 'string', v: value };
  }
  if (typeof value === 'boolean') {
    return { t: 'boolean', v: value };
  }
  if (value instanceof JsonNumber) {
    return value.float ? { t: 'float', v: value.value } : { t: 'integer', v: value.value };
  }
  return value === null ? 'it has no value' : Array.isArray(value) ? 'it is a list' : 'it is a table';
}

/** The arguments of a binding as the canvas holds them: `undefined` when it has none, or why the canvas cannot hold them. */
function headersOf(args: JsonObject): HeaderArguments | undefined | string {
  let xMatch: XMatch | null = null;
  const entries: HeaderEntry<HeaderCondition>[] = [];
  for (const [key, value] of args) {
    if (key === 'x-match') {
      if (typeof value !== 'string' || !(X_MATCH as readonly string[]).includes(value)) {
        return `its x-match is not one of ${listOf(X_MATCH.map(quoted))}`;
      }
      xMatch = value as XMatch;
      continue;
    }
    const condition = conditionOf(value);
    if (typeof condition === 'string') {
      return `its argument ${quoted(key)} cannot be held by the simulator: ${condition}`;
    }
    entries.push({ key, value: condition });
  }
  return xMatch === null && entries.length === 0 ? undefined : { xMatch, args: entries };
}

/** The entries of a list that are of the vhost being imported: those that name it, and those that name none, which is how a file of one vhost is written. */
const ofVhost = (entries: readonly JsonValue[], vhost: string | null) =>
  entries.filter((entry) => {
    if (!isJsonObject(entry)) {
      return true;
    }
    const named = entry.get('vhost');
    return named === undefined || vhost === null || named === vhost;
  });

/**
 * What importing the file would do for a vhost: the commands, tried one by one on an empty canvas so that what the canvas refuses is said and left
 * out, what they make, and the notes. `vhost` is one that the file names, or `null` for a file that names none.
 */
export function planImport(file: DefinitionsFile, vhost: string | null): Outcome<ImportPlan, ImportError> {
  if (vhost === null ? file.vhosts.length > 0 : !file.vhosts.includes(vhost)) {
    return failure({
      kind: 'vhost',
      message:
        vhost === null
          ? `Choose which vhost to import: this file has ${listOf(file.vhosts.map(quoted))}.`
          : `This file has no vhost ${quoted(vhost)}. It has ${listOf(file.vhosts.map(quoted))}.`,
    });
  }
  const issue = vhost === null ? null : vhostIssue(vhost);
  if (issue !== null) {
    return failure({ kind: 'vhost', message: `The vhost of this file cannot be the vhost of a canvas. ${issue}` });
  }
  const notes: ImportNote[] = [];
  const leftOut = (message: string) => notes.push({ kind: 'left-out', message });
  const changed = (message: string) => notes.push({ kind: 'changed', message });

  if (file.others.length > 0) {
    const parts = file.others.map(({ section, count }) => `${section.replaceAll('_', ' ')} (${count})`);
    leftOut(`The ${listOf(parts)} of the file are not imported: a canvas has exchanges, queues and bindings only.`);
  }
  const elsewhere = LISTS.map((list) => [list, file[list].length - ofVhost(file[list], vhost).length] as const).filter(
    ([, count]) => count > 0,
  );
  if (elsewhere.length > 0) {
    leftOut(
      `The ${listOf(elsewhere.map(([list, count]) => `${list} (${count})`))} of the other vhosts of the file are not imported: a canvas is one vhost.`,
    );
  }

  const malformed = new Map<string, number>();
  const notAnEntry = (list: string) => malformed.set(list, (malformed.get(list) ?? 0) + 1);
  /** Exchanges that are not imported, and why, so that their bindings can say so. */
  const notImported = new Map<string, string>();
  const builtIn: string[] = [];

  const exchanges: DeclareExchange[] = [];
  for (const entry of ofVhost(file.exchanges, vhost)) {
    const name = isJsonObject(entry) ? entry.get('name') : undefined;
    if (!isJsonObject(entry) || typeof name !== 'string') {
      notAnEntry('exchanges');
      continue;
    }
    if (name === '') {
      continue;
    }
    if (name.startsWith('amq.')) {
      builtIn.push(quoted(name));
      notImported.set(name, 'a broker makes it itself');
      continue;
    }
    const type = entry.get('type');
    if (typeof type !== 'string' || !(EXCHANGE_TYPES as readonly string[]).includes(type)) {
      const why =
        typeof type === 'string'
          ? `its type ${quoted(type)} is not one of the four that the simulator has: direct, fanout, topic and headers`
          : 'it does not say its type';
      leftOut(`The exchange ${quoted(name)} is not imported: ${why}.`);
      notImported.set(name, 'it is not imported');
      continue;
    }
    const durable = flag(entry, 'durable', true);
    const autoDelete = flag(entry, 'auto_delete', false);
    const internal = flag(entry, 'internal', false);
    const args = argumentsOf(entry);
    if (durable === undefined || autoDelete === undefined || internal === undefined || args === undefined) {
      notAnEntry('exchanges');
      notImported.set(name, 'it is not imported');
      continue;
    }
    if (args.size > 0) {
      changed(
        `The exchange ${quoted(name)} is imported without its arguments (${listOf([...args.keys()].map(quoted))}): the simulator does not model them.`,
      );
    }
    exchanges.push({
      type: 'declare-exchange',
      name,
      exchangeType: type as ExchangeType,
      durable,
      autoDelete,
      internal,
    });
  }
  if (builtIn.length > 0) {
    leftOut(
      `The exchanges that a broker makes itself (${listOf(builtIn)}) are not imported: every broker has them, and a canvas cannot declare a name that starts with “amq.”.`,
    );
  }

  const queues: DeclareQueue[] = [];
  for (const entry of ofVhost(file.queues, vhost)) {
    const name = isJsonObject(entry) ? entry.get('name') : undefined;
    if (!isJsonObject(entry) || typeof name !== 'string') {
      notAnEntry('queues');
      continue;
    }
    const durable = flag(entry, 'durable', true);
    const autoDelete = flag(entry, 'auto_delete', false);
    const args = argumentsOf(entry);
    if (durable === undefined || autoDelete === undefined || args === undefined) {
      notAnEntry('queues');
      continue;
    }
    // A broker writes the type in the arguments, and RabbitMQ 4.3 writes it beside them too.
    const queueType = args.get('x-queue-type') ?? entry.get('type');
    const rest = [...args.keys()].filter((key) => key !== 'x-queue-type');
    if (queueType !== undefined && queueType !== CLASSIC) {
      changed(
        `The queue ${quoted(name)} is imported as a classic queue: its type is ${typeof queueType === 'string' ? quoted(queueType) : 'not a name'}, and the simulator models classic queues only.`,
      );
    }
    if (rest.length > 0) {
      changed(
        `The queue ${quoted(name)} is imported without its arguments (${listOf(rest.map(quoted))}): the simulator does not model them.`,
      );
    }
    if (autoDelete) {
      changed(`The queue ${quoted(name)} is imported as one that is not auto-delete: the simulator does not model it.`);
    }
    queues.push({ type: 'declare-queue', name, durable });
  }

  const bindings: BindCommand[] = [];
  for (const entry of ofVhost(file.bindings, vhost)) {
    if (!isJsonObject(entry)) {
      notAnEntry('bindings');
      continue;
    }
    const source = entry.get('source');
    const destination = entry.get('destination');
    const destinationType = entry.get('destination_type');
    const key = entry.get('routing_key') ?? '';
    const args = argumentsOf(entry);
    if (
      typeof source !== 'string' ||
      typeof destination !== 'string' ||
      (destinationType !== 'queue' && destinationType !== 'exchange') ||
      typeof key !== 'string' ||
      args === undefined
    ) {
      notAnEntry('bindings');
      continue;
    }
    const what = `The binding from ${source === '' ? 'the default exchange' : `the exchange ${quoted(source)}`} to the ${destinationType} ${quoted(destination)}`;
    if (source === '') {
      leftOut(`${what} is not imported: a broker makes the bindings of the default exchange itself.`);
      continue;
    }
    const missing = [source, ...(destinationType === 'exchange' ? [destination] : [])].find((name) =>
      notImported.has(name),
    );
    if (missing !== undefined) {
      leftOut(
        `${what} is not imported: the exchange ${quoted(missing)} is not on the canvas, since ${notImported.get(missing) ?? ''}.`,
      );
      continue;
    }
    const headers = headersOf(args);
    if (typeof headers === 'string') {
      leftOut(`${what} is not imported: ${headers}.`);
      continue;
    }
    bindings.push({
      type: 'bind',
      source,
      destination: { kind: destinationType, name: destination },
      key,
      ...(headers === undefined ? {} : { headers }),
    });
  }

  for (const [list, count] of malformed) {
    leftOut(
      `${plural(count, `item`)} of the list of ${list} ${count === 1 ? 'is' : 'are'} not imported: ${count === 1 ? 'it does' : 'they do'} not have the fields that a definitions file has, of the right kinds.`,
    );
  }

  // Each command is tried on a canvas of its own, in the order of the file, so that what the canvas refuses is said and the rest goes in.
  const context = counting();
  let document: CanvasDocument = emptyDocument({ vhost: vhost ?? '/' });
  const accepted: DocumentCommand[] = [];
  const summary = { exchanges: 0, queues: 0, bindings: 0 };
  const tried: readonly (readonly [DocumentCommand, string, keyof typeof summary])[] = [
    ...exchanges.map((command) => [command, `The exchange ${quoted(command.name)}`, 'exchanges'] as const),
    ...queues.map((command) => [command, `The queue ${quoted(command.name)}`, 'queues'] as const),
    ...bindings.map(
      (command) =>
        [
          command,
          `The binding from the exchange ${quoted(command.source)} to the ${command.destination.kind} ${quoted(command.destination.name)}`,
          'bindings',
        ] as const,
    ),
  ];
  for (const [command, what, counted] of tried) {
    const result = applyCommand(document, command, context);
    if (!result.ok) {
      notes.push({ kind: 'refused', message: `${what} is not imported: ${result.error.message}` });
      continue;
    }
    if (result.value !== document) {
      summary[counted]++;
      accepted.push(command);
      document = result.value;
    }
  }

  if (accepted.length === 0) {
    return failure({
      kind: 'empty',
      message: `Nothing in this file can go on a canvas${vhost === null ? '' : ` for the vhost ${quoted(vhost)}`}: it has no exchange, no queue and no binding that the simulator can hold.`,
      notes,
    });
  }
  return succeed({ vhost, commands: accepted, summary, notes });
}

/** “3 exchanges, 2 queues and 4 bindings”: what an import makes, in words. */
export function importSummaryText(summary: DefinitionsSummary): string {
  return listOf(
    [
      plural(summary.exchanges, 'exchange'),
      plural(summary.queues, 'queue'),
      plural(summary.bindings, 'binding'),
    ].filter((part) => !part.startsWith('0 ')),
  );
}

/**
 * The one change that an import makes to the canvas (ADR-0111): it takes everything off, as `clear` does, gives the canvas the vhost of the file, makes what
 * the plan makes, and lays it out. It is one batch, so it all applies or none does, and one undo takes it back.
 */
export function importBatch(plan: ImportPlan): Batch {
  return {
    type: 'batch',
    label: `imported ${importSummaryText(plan.summary)} from a definitions file`,
    commands: [
      { type: 'clear' },
      ...(plan.vhost === null ? [] : [{ type: 'set', kind: 'canvas', changes: { vhost: plan.vhost } } as const]),
      ...plan.commands,
      { type: 'layout' },
    ],
  };
}
