import { kindOf, lookup, nameOf, type CanvasDocument, type DocumentCommand } from '@rmq/domain';
import { edgeEnds } from './refs';

/**
 * The commands that take an edge off the canvas. An edge is what the canvas draws between two nodes (ADR-0011): a producer's
 * link, a consumer's subscription, or the bindings between two exchanges or an exchange and a queue, which are one edge
 * however many there are. A learner selects the edge, and the commands that do it are these, in the words of ADR-0026: each
 * names an element by kind and name, and an `unbind` says the binding exactly as the document has it, key and arguments.
 */
export function removeEdgeCommands(document: CanvasDocument, key: string): DocumentCommand[] {
  const ends = edgeEnds(key);
  if (ends === undefined) {
    return [];
  }
  const { from, to } = ends;
  const fromKind = kindOf(document, from);
  const toKind = kindOf(document, to);
  const fromName = fromKind === undefined ? undefined : nameOf(document, fromKind, from);
  const toName = toKind === undefined ? undefined : nameOf(document, toKind, to);
  if (fromName === undefined || toName === undefined) {
    return [];
  }

  switch (fromKind) {
    case 'producer':
      return lookup(document.producers, from)?.target?.id === to ? [{ type: 'unlink', producer: fromName }] : [];
    case 'queue':
      return toKind === 'consumer' && lookup(document.consumers, to)?.queues.includes(from)
        ? [{ type: 'unsubscribe', consumer: toName, queue: fromName }]
        : [];
    case 'exchange':
      return Object.values(document.bindings)
        .filter((binding) => binding.source === from && binding.dest.id === to)
        .map((binding): DocumentCommand => ({
          type: 'unbind',
          source: fromName,
          destination: { kind: binding.dest.kind, name: toName },
          key: binding.key,
          ...(binding.headers === undefined ? {} : { headers: binding.headers }),
        }));
    default:
      return [];
  }
}
