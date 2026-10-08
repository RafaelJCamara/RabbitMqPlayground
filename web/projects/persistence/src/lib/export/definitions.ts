import { lookup, type BindingRecord, type CanvasDocument, type ExchangeRecord, type QueueRecord } from '@rmq/domain';
import { utf8Length } from '@rmq/engine';
import { failure, succeed, type Outcome } from '../outcome';
import { Fields, Float, writeValue, type Value } from './json';

/**
 * The export (ADR-0014, ADR-0079): a definitions file of RabbitMQ for one vhost, with the exchanges, the queues and the bindings of a canvas, which loads through the management UI or `rabbitmqctl import_definitions`.
 * It leaves out what is not a broker object (the producers and the consumers, the layout, the seed and the latencies), and what a definitions file cannot say (a header that has to exist, a queue whose name a broker
 * chose), and it says so: the export warns about anything it cannot say, and a warning is a sentence that names the thing. The file is written in the order of the canvas, so that one canvas gives one file.
 */

export type WarningKind = 'exists' | 'simulator' | 'server-named';

export interface DefinitionsWarning {
  readonly kind: WarningKind;
  readonly message: string;
}

/** What is in the file. */
export interface DefinitionsSummary {
  readonly exchanges: number;
  readonly queues: number;
  readonly bindings: number;
}

/** What the file keeps out, whatever the canvas, for the dialog to say once. */
export const NOT_IN_THE_FILE =
  'The layout, the seed and the latencies of the simulation are not in the file either: the canvas file keeps them.';

/** What can be wrong with an export, before a file is made. */
export type ExportError =
  { readonly kind: 'vhost'; readonly message: string } | { readonly kind: 'empty'; readonly message: string };

/** A binding as the file has it: the names of its two ends, and its arguments. */
interface FileBinding {
  readonly source: string;
  readonly destination: string;
  readonly destinationType: BindingRecord['dest']['kind'];
  readonly key: string;
  readonly arguments: Fields;
}

/** What the canvas puts in the file, and what it leaves out. The vhost is the learner's choice at the time of the download, so it is not here. */
export interface DefinitionsPlan {
  readonly exchanges: readonly ExchangeRecord[];
  readonly queues: readonly QueueRecord[];
  readonly bindings: readonly FileBinding[];
  readonly summary: DefinitionsSummary;
  readonly warnings: readonly DefinitionsWarning[];
}

const quoted = (name: string): string => `“${name}”`;

/** “a”, “a” and “b”, or “a”, “b” and “c”: names in a sentence. More than five are counted. */
function listOf(names: readonly string[]): string {
  const shown = names.slice(0, 5).map(quoted);
  const more = names.length - shown.length;
  const all = more > 0 ? [...shown, `${more} more`] : shown;
  return all.length < 2 ? all.join('') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

const plural = (count: number, thing: string): string => `${count} ${thing}${count === 1 ? '' : 's'}`;

/** `the producer “a”`, `the producers “a” and “b”`, or nothing for none. */
const these = (thing: string, names: readonly string[]): string =>
  names.length === 0 ? '' : `the ${thing}${names.length === 1 ? '' : 's'} ${listOf(names)}`;

/**
 * The arguments of a binding: `x-match` when the canvas names a mode, then each condition, with the value it has. Only a headers exchange reads them, but a broker keeps them for a binding of any exchange, and two bindings
 * that differ only by them are two bindings, as they are on the canvas, so they are written whatever the exchange is. A binding with a condition that a header exists has no arguments to write, because RabbitMQ refuses a
 * header with no value, and the answer is `null`.
 */
function argumentsOf(record: BindingRecord): Fields | null {
  if (record.headers === undefined) {
    return new Fields([]);
  }
  const entries: (readonly [string, Value])[] =
    record.headers.xMatch === null ? [] : [['x-match', record.headers.xMatch]];
  for (const { key, value } of record.headers.args) {
    if (value.t === 'exists') {
      return null;
    }
    entries.push([key, value.t === 'float' ? new Float(value.v) : value.v]);
  }
  return new Fields(entries);
}

/** What the canvas puts in the file and what it leaves out, in the order of the canvas. */
export function planDefinitions(document: CanvasDocument): DefinitionsPlan {
  const queues = Object.values(document.queues);
  const namedByBroker = new Set(queues.filter(({ serverNamed }) => serverNamed).map(({ name }) => name));

  const bindings: FileBinding[] = [];
  const exists: DefinitionsWarning[] = [];
  const leftWithQueue = new Map<string, number>();
  for (const record of Object.values(document.bindings)) {
    const source = lookup(document.exchanges, record.source);
    const destination = lookup(record.dest.kind === 'queue' ? document.queues : document.exchanges, record.dest.id);
    if (source === undefined || destination === undefined) {
      continue;
    }
    if (record.dest.kind === 'queue' && namedByBroker.has(destination.name)) {
      leftWithQueue.set(destination.name, (leftWithQueue.get(destination.name) ?? 0) + 1);
      continue;
    }
    const args = argumentsOf(record);
    if (args === null) {
      exists.push({
        kind: 'exists',
        message: `The binding from the exchange ${quoted(source.name)} to the ${record.dest.kind} ${quoted(destination.name)} is not in the file: it has a condition that a header exists, and RabbitMQ does not accept a header with no value in a definitions file.`,
      });
    } else {
      bindings.push({
        source: source.name,
        destination: destination.name,
        destinationType: record.dest.kind,
        key: record.key,
        arguments: args,
      });
    }
  }

  const simulator: DefinitionsWarning[] = [];
  const producers = Object.values(document.producers).map(({ name }) => name);
  const consumers = Object.values(document.consumers).map(({ name }) => name);
  if (producers.length + consumers.length > 0) {
    const several = producers.length + consumers.length > 1;
    const subject = [these('producer', producers), these('consumer', consumers)]
      .filter((part) => part !== '')
      .join(' and ');
    simulator.push({
      kind: 'simulator',
      message: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${several ? 'are' : 'is'} not in the file: ${several ? 'they are' : 'it is'} the simulator’s, and a broker has clients instead.`,
    });
  }

  const serverNamed = [...namedByBroker].map((name): DefinitionsWarning => {
    const left = leftWithQueue.get(name) ?? 0;
    const bindingsLeft =
      left === 0
        ? ''
        : ` ${plural(left, 'binding')} that ${left === 1 ? 'ends' : 'end'} at it ${left === 1 ? 'is' : 'are'} left out with it.`;
    return {
      kind: 'server-named',
      message: `The queue ${quoted(name)} is not in the file: a broker chose its name, and a client cannot declare a name that starts with “amq.”.${bindingsLeft}`,
    };
  });

  const kept = queues.filter(({ serverNamed: named }) => !named);
  const exchanges = Object.values(document.exchanges);
  return {
    exchanges,
    queues: kept,
    bindings,
    summary: { exchanges: exchanges.length, queues: kept.length, bindings: bindings.length },
    warnings: [...exists, ...simulator, ...serverNamed],
  };
}

/** Why this cannot be the name of a vhost, or `null`. A vhost is not empty and is at most 255 bytes of UTF-8. */
export function vhostIssue(vhost: string): string | null {
  if (vhost === '') {
    return 'A vhost needs a name. The broker’s own is “/”.';
  }
  const bytes = utf8Length(vhost);
  return bytes > 255 ? `A vhost name can be at most 255 bytes, and this one is ${bytes}.` : null;
}

/** The text of the file for a plan, with two spaces of indentation and a final newline, like the other files of the app. */
export function definitionsText(plan: DefinitionsPlan, vhost: string): string {
  const file = new Fields([
    ['vhosts', [new Fields([['name', vhost]])]],
    [
      'exchanges',
      plan.exchanges.map(
        (exchange) =>
          new Fields([
            ['name', exchange.name],
            ['vhost', vhost],
            ['type', exchange.type],
            ['durable', exchange.durable],
            ['auto_delete', exchange.autoDelete],
            ['internal', exchange.internal],
            ['arguments', new Fields([])],
          ]),
      ),
    ],
    [
      'queues',
      plan.queues.map(
        (queue) =>
          new Fields([
            ['name', queue.name],
            ['vhost', vhost],
            ['durable', queue.durable],
            ['auto_delete', false],
            ['arguments', new Fields([])],
          ]),
      ),
    ],
    [
      'bindings',
      plan.bindings.map(
        (binding) =>
          new Fields([
            ['source', binding.source],
            ['vhost', vhost],
            ['destination', binding.destination],
            ['destination_type', binding.destinationType],
            ['routing_key', binding.key],
            ['arguments', binding.arguments],
          ]),
      ),
    ],
  ]);
  return `${writeValue(file)}\n`;
}

/** What an export gives: the text of the file, what is in it, and what is not. */
export interface ExportedDefinitions {
  readonly text: string;
  readonly summary: DefinitionsSummary;
  readonly warnings: readonly DefinitionsWarning[];
}

/** The definitions file of a canvas for a vhost. It fails, in words, for a vhost that cannot be one, and for a canvas that has nothing that a broker holds. */
export function exportDefinitions(document: CanvasDocument, vhost: string): Outcome<ExportedDefinitions, ExportError> {
  const issue = vhostIssue(vhost);
  if (issue !== null) {
    return failure({ kind: 'vhost', message: issue });
  }
  const plan = planDefinitions(document);
  const { exchanges, queues, bindings } = plan.summary;
  if (exchanges + queues + bindings === 0) {
    return failure({
      kind: 'empty',
      message:
        'Nothing on the canvas can go in a definitions file: it has no exchange, no queue and no binding that a broker could hold.',
    });
  }
  return succeed({ text: definitionsText(plan, vhost), summary: plan.summary, warnings: plan.warnings });
}
