import type { Bind, EngineCommand, ExchangeDeclare, QueueDeclare, Unbind } from '@rmq/engine';
import { sameValue } from './commands/helpers';
import { lookup } from './document/elements';
import { bindingSignature, canonicalHeaders } from './document/headers';
import type { CanvasDocument } from './document/schema';

/**
 * Keeping the engine in step with the canvas (ADR-0019). `reconcile(previous, next)` returns the commands that turn the
 * topology that the engine holds for one document into the topology of the other. It is the one path for every way that a
 * document changes under the engine: a command, an undo, a redo, a load and a clear alike, because it looks at two
 * documents and never at what happened between them.
 *
 * It compares the documents as the broker sees them, by names, and not by ids. A rename is a delete and a declare, as it
 * would be on a broker, which cannot rename or change an exchange or a queue (ADR-0008, rule 27): so is a change of type
 * or of any flag. What was bound to a name that is deleted goes with it, which the broker does by itself, so nothing is
 * unbound that is about to be deleted, and what the engine loses that way and the next document keeps is bound again.
 *
 * The commands come in an order in which each is valid for the topology that the ones before it made: unbinding what is
 * going while both ends stay, then deleting, then declaring, then binding.
 *
 * Only the topology is here: exchanges, queues and bindings. A producer and a consumer have no command yet, because the
 * engine cannot run one until the simulation arrives (slice S6), and the diff of them goes in beside this one. Layout,
 * labels and settings are the canvas's and never reach the engine. The vhost does not change within a canvas.
 */

interface EngineView {
  readonly exchanges: ReadonlyMap<string, ExchangeDeclare>;
  readonly queues: ReadonlyMap<string, QueueDeclare>;
  /** By what a broker keeps about a binding, in the order they were made. */
  readonly bindings: ReadonlyMap<string, Bind>;
}

const EMPTY: EngineView = { exchanges: new Map(), queues: new Map(), bindings: new Map() };

/** The topology of a document, as the commands that would build it. */
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
  return { exchanges, queues, bindings };
}

/** The names that the engine has to delete: gone from the next view, or declared in another way. */
function goneOrChanged<Declare extends ExchangeDeclare | QueueDeclare>(
  previous: ReadonlyMap<string, Declare>,
  next: ReadonlyMap<string, Declare>,
): Set<string> {
  return new Set([...previous].filter(([name, declare]) => !sameValue(declare, next.get(name))).map(([name]) => name));
}

/**
 * The commands that make the engine's topology that of `next`, when it is now that of `previous`. `null` stands for an
 * engine with nothing in it, which is what a canvas that has just been loaded starts from.
 */
export function reconcile(previous: CanvasDocument | null, next: CanvasDocument): EngineCommand[] {
  if (previous === next) {
    return [];
  }
  const from = previous === null ? EMPTY : viewOf(previous);
  const to = viewOf(next);

  const deletedExchanges = goneOrChanged(from.exchanges, to.exchanges);
  const deletedQueues = goneOrChanged(from.queues, to.queues);
  const declaredExchanges = goneOrChanged(to.exchanges, from.exchanges);
  const declaredQueues = goneOrChanged(to.queues, from.queues);

  /** Whether a broker deletes the binding by itself, because one of its ends is deleted. */
  const loses = ({ source, destination }: Bind | Unbind): boolean =>
    deletedExchanges.has(source) ||
    (destination.kind === 'exchange' ? deletedExchanges : deletedQueues).has(destination.name);

  const commands: EngineCommand[] = [];

  // Unbind what is going, while both ends stay. What is on a name that is deleted goes with it.
  for (const [signature, bind] of from.bindings) {
    if (!to.bindings.has(signature) && !loses(bind)) {
      commands.push({ ...bind, op: 'unbind' });
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
  return commands;
}
