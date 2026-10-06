import type { Batch, DocumentCommand, SetCommand } from '@rmq/domain';

/**
 * What a command did, in words (ADR-0031): the sentence that the status line and the live region say after a change, and that
 * undo says when it takes the change back. It is written in the past tense and has no full stop, so that it fits both
 * (`Added queue billing.` and `Undid: added queue billing.`). It is not the equivalent command of the log (that is the
 * formatter of the domain, and it is S5's): this is for a person who listens or glances, and says kind and name.
 */

/** The attributes of a `set`, as a person would say them, in the order that they are said. */
const ATTRIBUTES: Readonly<Record<string, string>> = {
  exchangeType: 'the type',
  durable: 'the durable flag',
  autoDelete: 'the auto-delete flag',
  internal: 'the internal flag',
  payload: 'the payload',
  key: 'the routing key',
  burst: 'the burst',
  everyMs: 'the interval',
  repeat: 'the repeat setting',
  headers: 'the headers',
  ack: 'the acknowledgement',
  prefetch: 'the prefetch',
  processingMs: 'the processing time',
  showDefaultExchange: 'the default exchange setting',
  seed: 'the seed',
  publishMs: 'the publish time',
  brokerMs: 'the broker time',
  deliverMs: 'the delivery time',
};

const list = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

function describeSet(command: SetCommand): string {
  const attributes = Object.entries(command.changes)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => ATTRIBUTES[key] ?? key);
  const what = attributes.length === 0 ? '' : `${list(attributes)} of `;
  return command.kind === 'canvas' ? `changed ${what}the canvas` : `changed ${what}${command.kind} ${command.name}`;
}

const ADDS = new Set<DocumentCommand['type']>(['declare-exchange', 'declare-queue', 'add-producer', 'add-consumer']);
const REMOVALS = new Set<DocumentCommand['type']>(['delete', 'unbind', 'unlink', 'unsubscribe']);
const LINKS = new Set<DocumentCommand['type']>(['bind', 'link', 'subscribe']);

function describeBatch(batch: Batch): string {
  const { commands } = batch;
  const [only] = commands;
  if (commands.length === 1 && only !== undefined) {
    return describeCommand(only);
  }
  const adds = commands.filter((command) => ADDS.has(command.type));
  const [added] = adds;
  if (adds.length === 1 && added !== undefined && commands.every((c) => c === added || c.type === 'move')) {
    return describeCommand(added);
  }
  // A drop on nothing makes a node and joins it to where the link started, in one step (ADR-0042).
  const links = commands.filter((command) => LINKS.has(command.type));
  const [linked] = links;
  if (
    adds.length === 1 &&
    added !== undefined &&
    links.length === 1 &&
    linked !== undefined &&
    commands.every((c) => c === added || c === linked || c.type === 'move')
  ) {
    return `${describeCommand(added)} and ${describeCommand(linked)}`;
  }
  if (commands.every((command) => REMOVALS.has(command.type))) {
    return `deleted ${commands.length} items`;
  }
  return `${commands.length} changes`;
}

export function describeCommand(command: DocumentCommand): string {
  switch (command.type) {
    case 'declare-exchange':
      return `added ${command.exchangeType} exchange ${command.name}`;
    case 'declare-queue':
      return `added queue ${command.name}`;
    case 'add-producer':
      return `added producer ${command.name}`;
    case 'add-consumer':
      return `added consumer ${command.name}`;
    case 'bind':
      return `bound exchange ${command.source} to ${command.destination.kind} ${command.destination.name}`;
    case 'unbind':
      return `removed the binding from exchange ${command.source} to ${command.destination.kind} ${command.destination.name}`;
    case 'link':
      return `linked producer ${command.producer} to ${command.target.kind} ${command.target.name}`;
    case 'unlink':
      return `unlinked producer ${command.producer}`;
    case 'subscribe':
      return `subscribed consumer ${command.consumer} to queue ${command.queue}`;
    case 'unsubscribe':
      return `unsubscribed consumer ${command.consumer} from queue ${command.queue}`;
    case 'set':
      return describeSet(command);
    case 'unset':
      return `removed headers from producer ${command.name}`;
    case 'move':
      return `moved ${command.target.kind} ${command.target.name}`;
    case 'move-label':
      return 'moved the label of an edge';
    case 'rename':
      return `renamed ${command.target.kind} ${command.target.name} to ${command.name}`;
    case 'delete':
      return `deleted ${command.target.kind} ${command.target.name}`;
    case 'clear':
      return 'cleared the canvas';
    case 'layout':
      return 'arranged the canvas';
    case 'batch':
      return describeBatch(command);
  }
}

/** A sentence from a description: a capital letter first, and a full stop at the end. */
export function sentence(text: string): string {
  const trimmed = text.replace(/\.$/, '');
  return trimmed === '' ? '' : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}
