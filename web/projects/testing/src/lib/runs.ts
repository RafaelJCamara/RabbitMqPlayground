import { reconcile, type CanvasDocument } from '@rmq/domain';
import { createEngine, type Engine, type EngineSnapshot } from '@rmq/engine';

/**
 * Runs of a canvas, for the specs of whatever keeps an engine's state: the engine that the app makes for a document, and a snapshot of it after a while. They are test code, so
 * a command that the engine refuses throws, with the reply.
 */

/** The engine that the app makes for a document (`reconcile`, ADR-0054), with the clock and the seed that the document says. */
export function engineFor(document: CanvasDocument): Engine {
  const engine = createEngine({
    seed: document.settings.seed,
    timing: document.settings.timing,
    vhost: document.vhost,
  });
  for (const command of reconcile(null, document)) {
    const result = engine.dispatch(command);
    if (!result.ok) {
      throw new Error(`The engine refused ${JSON.stringify(command)}: ${result.text}`);
    }
  }
  return engine;
}

/**
 * The snapshot of the engine of a document after every producer has published once and the clock has run for `until` milliseconds. With the latencies of a new canvas that is
 * messages on their way at 300, in queues at 1,000, and held by a consumer after that, so a few values of `until` give a snapshot with something in each of its places.
 */
export function snapshotAfter(document: CanvasDocument, until: number): EngineSnapshot {
  const engine = engineFor(document);
  for (const id of Object.keys(document.producers)) {
    engine.dispatch({ op: 'producer.publish', producer: id });
  }
  engine.advanceTo(until);
  return engine.snapshot();
}
