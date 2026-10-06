import { formatCommand, type CanvasDocument, type DocumentCommand, type ExchangeRecord } from '@rmq/domain';

/** How many lines the bar suggests at most: enough to show the next few steps, and few enough to read at a glance. */
export const MAX_SUGGESTIONS = 5;

/** The key that a first binding of this kind of exchange can have: a direct one matches the name, a topic one everything. */
function keyFor(type: ExchangeRecord['type'], queue: string): string {
  return type === 'direct' ? queue : type === 'topic' ? '#' : '';
}

/**
 * What to do next on this canvas (ADR-0045), as lines that the bar can run as they are: the formatter writes each from a command, so each is read back by the
 * parser and accepted by the canvas. They go in the order of the work: what the canvas does not have yet, an exchange that nothing is bound from, a producer
 * that has no target, a consumer that has no queue. Once the canvas is wired from one end to the other there is nothing to say.
 */
export function nextSteps(document: CanvasDocument): string[] {
  const exchanges = Object.entries(document.exchanges);
  const queues = Object.values(document.queues);
  const producers = Object.values(document.producers);
  const consumers = Object.values(document.consumers);
  const [firstQueue] = queues;
  const commands: DocumentCommand[] = [];

  if (exchanges.length === 0) {
    commands.push({
      type: 'declare-exchange',
      name: 'orders',
      exchangeType: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    });
  }
  if (queues.length === 0) {
    commands.push({ type: 'declare-queue', name: 'billing', durable: true });
  }
  if (producers.length === 0) {
    commands.push({ type: 'add-producer', name: 'sender' });
  }
  if (consumers.length === 0) {
    commands.push({ type: 'add-consumer', name: 'worker' });
  }

  if (firstQueue !== undefined) {
    const boundFrom = new Set(Object.values(document.bindings).map(({ source }) => source));
    for (const [id, exchange] of exchanges) {
      if (!boundFrom.has(id)) {
        commands.push({
          type: 'bind',
          source: exchange.name,
          destination: { kind: 'queue', name: firstQueue.name },
          key: keyFor(exchange.type, firstQueue.name),
        });
      }
    }
  }

  const ordinary = exchanges.find(([, exchange]) => !exchange.internal)?.[1];
  const target =
    ordinary !== undefined
      ? ({ kind: 'exchange', name: ordinary.name } as const)
      : firstQueue === undefined
        ? undefined
        : ({ kind: 'queue', name: firstQueue.name } as const);
  if (target !== undefined) {
    for (const producer of producers) {
      if (producer.target === null) {
        commands.push({ type: 'link', producer: producer.name, target });
      }
    }
  }

  if (firstQueue !== undefined) {
    for (const consumer of consumers) {
      if (consumer.queues.length === 0) {
        commands.push({ type: 'subscribe', consumer: consumer.name, queue: firstQueue.name });
      }
    }
  }

  return commands.slice(0, MAX_SUGGESTIONS).map((command) => formatCommand(command, document));
}
