import type {
  BasicConsume,
  Bind,
  ChannelOpen,
  EngineCommand,
  ExchangeDeclare,
  ProducerSet,
  QueueDeclare,
  SimConfigure,
  Unbind,
} from '@rmq/engine';
import { sameValue } from './commands/helpers';
import { lookup } from './document/elements';
import { bindingSignature, canonicalHeaders } from './document/headers';
import type { CanvasDocument } from './document/schema';

/**
 * Keeping the engine in step with the canvas (ADR-0019, ADR-0054). `reconcile(previous, next)` returns the commands that turn what the engine holds
 * for one document into what it holds for the other. It is the one path for every way that a document changes under the engine: a command, an undo,
 * a redo, a load and a clear alike, because it looks at two documents and never at what happened between them.
 *
 * What the engine holds of a canvas is its topology, its producers, its consumers and its settings. The exchanges and the queues are compared as the
 * broker sees them, by names, and not by ids. A rename is a delete and a declare, as it would be on a broker, which cannot rename or change an
 * exchange or a queue (ADR-0008, rule 27): so is a change of type or of any flag. What was bound to a name that is deleted goes with it, which the
 * broker does by itself, so nothing is unbound that is about to be deleted, and what the engine loses that way and the next document keeps is bound
 * again. The same goes for the consumers of a queue that is deleted: the engine cancels them, so they consume again if the next document says so.
 *
 * A producer and a consumer are not a broker's names, so they are compared by their ids, and a rename of one changes nothing in the engine. A
 * consumer is a channel with a consumer tag for each queue that it is subscribed to (ADR-0050), named `<id>/<queue>`. The ack mode is fixed when a
 * consumer starts consuming, so a change of it closes the channel and opens it again, and what the consumer held goes back to its queue.
 *
 * The commands come in an order in which each is valid for what the ones before it made: the settings, then what goes (unbinding while both ends stay,
 * producers, subscriptions and channels), then deleting, declaring and binding, then what comes (channels, subscriptions, producers). Layout and
 * labels are the canvas's and never reach the engine. The vhost does not change within a canvas.
 */

interface ConsumerSpec {
  readonly channel: ChannelOpen & { readonly processingMs: number };
  readonly ack: 'auto' | 'manual';
  /** The consume command of each queue that it is subscribed to, by the name of the queue. */
  readonly subscriptions: ReadonlyMap<string, BasicConsume>;
}

interface EngineView {
  readonly exchanges: ReadonlyMap<string, ExchangeDeclare>;
  readonly queues: ReadonlyMap<string, QueueDeclare>;
  /** By what a broker keeps about a binding, in the order they were made. */
  readonly bindings: ReadonlyMap<string, Bind>;
  /** By the id of the producer. */
  readonly producers: ReadonlyMap<string, ProducerSet>;
  /** By the id of the consumer, which is the name of its channel. */
  readonly consumers: ReadonlyMap<string, ConsumerSpec>;
  readonly settings: Omit<SimConfigure, 'op'>;
}

const EMPTY: Omit<EngineView, 'settings'> = {
  exchanges: new Map(),
  queues: new Map(),
  bindings: new Map(),
  producers: new Map(),
  consumers: new Map(),
};

/** What the engine holds for a document, as the commands that would make it. */
function viewOf(document: CanvasDocument): EngineView {
  const exchanges = new Map<string, ExchangeDeclare>();
  for (const { name, type, durable, autoDelete, internal } of Object.values(document.exchanges)) {
    exchanges.set(name, { op: 'exchange.declare', name, type, durable, autoDelete, internal });
  }
  const queues = new Map<string, QueueDeclare>();
  for (const { name, durable } of Object.values(document.queues)) {
    queues.set(name, { op: 'queue.declare', name, durable });
  }
  const bindings = new Map<string, Bind>();
  for (const binding of Object.values(document.bindings)) {
    const source = lookup(document.exchanges, binding.source);
    const destination = lookup(binding.dest.kind === 'queue' ? document.queues : document.exchanges, binding.dest.id);
    if (source !== undefined && destination !== undefined) {
      const headers = canonicalHeaders(binding.headers);
      const bind: Bind = {
        op: 'bind',
        source: source.name,
        destination: { kind: binding.dest.kind, name: destination.name },
        key: binding.key,
        ...(headers === undefined ? {} : { headers }),
      };
      bindings.set(
        bindingSignature(bind.source, bind.destination.kind, bind.destination.name, bind.key, headers),
        bind,
      );
    }
  }

  const producers = new Map<string, ProducerSet>();
  for (const [id, producer] of Object.entries(document.producers)) {
    const target =
      producer.target === null
        ? undefined
        : lookup(producer.target.kind === 'queue' ? document.queues : document.exchanges, producer.target.id);
    producers.set(id, {
      op: 'producer.set',
      producer: id,
      // A target that is not on the canvas is no target. A valid document has none.
      target:
        producer.target === null || target === undefined ? null : { kind: producer.target.kind, name: target.name },
      key: producer.message.key,
      payload: producer.message.payload,
      headers: producer.message.headers,
      burst: producer.burst,
      everyMs: producer.interval.everyMs,
      repeat: producer.interval.on,
    });
  }

  const consumers = new Map<string, ConsumerSpec>();
  for (const [id, consumer] of Object.entries(document.consumers)) {
    const subscriptions = new Map<string, BasicConsume>();
    for (const queueId of consumer.queues) {
      const queue = lookup(document.queues, queueId);
      if (queue !== undefined) {
        subscriptions.set(queue.name, {
          op: 'basic.consume',
          channel: id,
          queue: queue.name,
          consumer: `${id}/${queue.name}`,
          ack: consumer.ack,
        });
      }
    }
    consumers.set(id, {
      channel: { op: 'channel.open', channel: id, prefetch: consumer.prefetch, processingMs: consumer.processingMs },
      ack: consumer.ack,
      subscriptions,
    });
  }

  const { seed, timing } = document.settings;
  return { exchanges, queues, bindings, producers, consumers, settings: { seed, timing: { ...timing } } };
}

/** The names that the engine has to delete: gone from the next view, or declared in another way. */
function goneOrChanged<Declare extends ExchangeDeclare | QueueDeclare>(
  previous: ReadonlyMap<string, Declare>,
  next: ReadonlyMap<string, Declare>,
): Set<string> {
  return new Set([...previous].filter(([name, declare]) => !sameValue(declare, next.get(name))).map(([name]) => name));
}

/**
 * The commands that make the engine hold what `next` says, when it holds what `previous` says. `null` stands for an engine with nothing in it, which
 * is what a canvas that has just been loaded starts from: it is told the settings, and everything else.
 */
export function reconcile(previous: CanvasDocument | null, next: CanvasDocument): EngineCommand[] {
  if (previous === next) {
    return [];
  }
  const to = viewOf(next);
  const from = previous === null ? { ...EMPTY, settings: to.settings } : viewOf(previous);

  const deletedExchanges = goneOrChanged(from.exchanges, to.exchanges);
  const deletedQueues = goneOrChanged(from.queues, to.queues);
  const declaredExchanges = goneOrChanged(to.exchanges, from.exchanges);
  const declaredQueues = goneOrChanged(to.queues, from.queues);

  /** Whether a broker deletes the binding by itself, because one of its ends is deleted. */
  const loses = ({ source, destination }: Bind | Unbind): boolean =>
    deletedExchanges.has(source) ||
    (destination.kind === 'exchange' ? deletedExchanges : deletedQueues).has(destination.name);

  const commands: EngineCommand[] = [];

  // The settings first, so that what follows is sent with the latencies of the document.
  if (previous === null || !sameValue(from.settings, to.settings)) {
    commands.push({ op: 'sim.configure', ...to.settings });
  }

  // Unbind what is going, while both ends stay. What is on a name that is deleted goes with it.
  for (const [signature, bind] of from.bindings) {
    if (!to.bindings.has(signature) && !loses(bind)) {
      commands.push({ ...bind, op: 'unbind' });
    }
  }

  // The producers that go, and the consumers that go or start again, and the subscriptions that go: a queue that is deleted cancels its own.
  for (const id of from.producers.keys()) {
    if (!to.producers.has(id)) {
      commands.push({ op: 'producer.remove', producer: id });
    }
  }
  const reopened = new Set<string>();
  for (const [id, before] of from.consumers) {
    const after = to.consumers.get(id);
    if (after === undefined || after.ack !== before.ack) {
      commands.push({ op: 'channel.close', channel: id });
      reopened.add(id);
      continue;
    }
    for (const [queue, consume] of before.subscriptions) {
      if (!after.subscriptions.has(queue) && !deletedQueues.has(queue)) {
        commands.push({ op: 'basic.cancel', consumer: consume.consumer });
      }
    }
  }

  for (const name of deletedExchanges) {
    commands.push({ op: 'exchange.delete', name });
  }
  for (const name of deletedQueues) {
    commands.push({ op: 'queue.delete', name });
  }
  for (const [name, declare] of to.exchanges) {
    if (declaredExchanges.has(name)) {
      commands.push(declare);
    }
  }
  for (const [name, declare] of to.queues) {
    if (declaredQueues.has(name)) {
      commands.push(declare);
    }
  }
  // Bind what is new, and what the engine lost when it deleted one of its ends, which the next document keeps.
  for (const [signature, bind] of to.bindings) {
    if (!from.bindings.has(signature) || loses(bind)) {
      commands.push(bind);
    }
  }

  // The consumers that come, and the ones that were closed to change how they acknowledge; the subscriptions that come, and the ones that a
  // deleted queue took with it; what changed in a channel that goes on.
  for (const [id, after] of to.consumers) {
    const before = from.consumers.get(id);
    const open = before === undefined || reopened.has(id);
    if (open) {
      commands.push(after.channel);
    } else if (
      before.channel.prefetch !== after.channel.prefetch ||
      before.channel.processingMs !== after.channel.processingMs
    ) {
      commands.push({
        op: 'channel.set',
        channel: id,
        prefetch: after.channel.prefetch,
        processingMs: after.channel.processingMs,
      });
    }
    for (const [queue, consume] of after.subscriptions) {
      if (open || !before.subscriptions.has(queue) || deletedQueues.has(queue)) {
        commands.push(consume);
      }
    }
  }

  for (const [id, producer] of to.producers) {
    if (!sameValue(from.producers.get(id), producer)) {
      commands.push(producer);
    }
  }
  return commands;
}
