import type { EngineSnapshot } from '@rmq/engine';

/**
 * How many copies of messages the engine holds, each once (ADR-0078): in a queue, held by a consumer to be acknowledged, on their way to the broker, to a queue or to a consumer, and waiting in or being handled by the
 * channel of a consumer that acknowledges by itself. It is what a link "with its messages" carries, and the number the panel says. A copy that is on its way to a consumer that has to acknowledge it is already
 * among those the consumer holds, and is not counted again; the engine's own count of what is travelling is not this one, because it counts that copy as well.
 */
export function copiesIn(snapshot: EngineSnapshot): number {
  let copies = 0;
  for (const queue of snapshot.queues) {
    copies += queue.ready.length;
  }
  for (const tag of snapshot.tags) {
    copies += tag.unacked.length;
  }
  for (const channel of snapshot.channels) {
    copies += channel.waiting.filter(({ ack }) => ack === 'auto').length + (channel.working?.ack === 'auto' ? 1 : 0);
  }
  for (const { task } of snapshot.heap) {
    if (task.kind === 'arrive') {
      copies += 1;
    } else if (task.kind === 'enqueue') {
      copies += task.paths.length;
    } else if (task.kind === 'receive' && task.held.ack === 'auto') {
      copies += 1;
    }
  }
  return copies;
}
