import type { CanvasDocument, ProducerRecord } from '@rmq/domain';
import type { Engine } from '@rmq/engine';

/**
 * What an engine should hold for a canvas, said twice, by two readers that share no code with `reconcile` or with each other: `documentHolds` reads
 * the document, and `engineHolds` reads the engine's snapshot. A spec of `reconcile` compares them, so a command that `reconcile` forgets, or sends
 * with the wrong value, shows up as a difference between the two. The bindings are not here: `canonicalTopology` compares those.
 *
 * Everything is a string, one for each thing, in a fixed order, so that a failure shows the one that differs.
 */
export interface Held {
  readonly settings: string;
  /** `name|type|durable|autoDelete|internal` */
  readonly exchanges: readonly string[];
  /** `name|durable` */
  readonly queues: readonly string[];
  /** `id|target|key|payload|headers|burst|everyMs|repeat` */
  readonly producers: readonly string[];
  /** `id|prefetch|processingMs` */
  readonly channels: readonly string[];
  /** `tag|channel|queue|ack`, for the consumers that are not cancelled */
  readonly consumers: readonly string[];
}

const json = JSON.stringify;

const sorted = (lines: readonly string[]): string[] => [...lines].sort();

/** What the document says that an engine holds. */
export function documentHolds(document: CanvasDocument): Held {
  const { seed, timing } = document.settings;
  const queueName = (id: string): string => document.queues[id]?.name ?? `(no queue ${id})`;
  const targetOf = ({ target }: ProducerRecord): string => {
    if (target === null) {
      return 'nowhere';
    }
    const name = (target.kind === 'queue' ? document.queues : document.exchanges)[target.id]?.name;
    return `${target.kind} ${name ?? `(no ${target.kind} ${target.id})`}`;
  };
  return {
    settings: `seed ${seed}, publish ${timing.publishMs}, broker ${timing.brokerMs}, deliver ${timing.deliverMs}`,
    exchanges: sorted(
      Object.values(document.exchanges).map(
        ({ name, type, durable, autoDelete, internal }) => `${name}|${type}|${durable}|${autoDelete}|${internal}`,
      ),
    ),
    queues: sorted(Object.values(document.queues).map(({ name, durable }) => `${name}|${durable}`)),
    producers: sorted(
      Object.entries(document.producers).map(
        ([id, producer]) =>
          `${id}|${targetOf(producer)}|${json(producer.message.key)}|${json(producer.message.payload)}|${json(producer.message.headers)}|${producer.burst}|${producer.interval.everyMs}|${producer.interval.on}`,
      ),
    ),
    channels: sorted(
      Object.entries(document.consumers).map(([id, { prefetch, processingMs }]) => `${id}|${prefetch}|${processingMs}`),
    ),
    consumers: sorted(
      Object.entries(document.consumers).flatMap(([id, { queues, ack }]) =>
        queues.map((queue) => `${id}/${queueName(queue)}|${id}|${queueName(queue)}|${ack}`),
      ),
    ),
  };
}

/** What the engine holds. */
export function engineHolds(engine: Engine): Held {
  const snapshot = engine.snapshot();
  const { seed, timing } = snapshot;
  return {
    settings: `seed ${seed}, publish ${timing.publishMs}, broker ${timing.brokerMs}, deliver ${timing.deliverMs}`,
    exchanges: sorted(
      snapshot.exchanges.map(
        ({ name, type, durable, autoDelete, internal }) => `${name}|${type}|${durable}|${autoDelete}|${internal}`,
      ),
    ),
    queues: sorted(snapshot.queues.map(({ name, durable }) => `${name}|${durable}`)),
    producers: sorted(
      snapshot.producers.map(
        (producer) =>
          `${producer.id}|${producer.target === null ? 'nowhere' : `${producer.target.kind} ${producer.target.name}`}|${json(producer.key)}|${json(producer.payload)}|${json(producer.headers)}|${producer.burst}|${producer.everyMs}|${producer.repeat}`,
      ),
    ),
    channels: sorted(snapshot.channels.map(({ id, prefetch, processingMs }) => `${id}|${prefetch}|${processingMs}`)),
    consumers: sorted(
      snapshot.tags
        .filter(({ cancelled }) => !cancelled)
        .map(({ tag, channel, queue, ack }) => `${tag}|${channel}|${queue}|${ack}`),
    ),
  };
}
