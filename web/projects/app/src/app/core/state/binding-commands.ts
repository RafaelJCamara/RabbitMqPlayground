import {
  edgeKey,
  lookup,
  nameOf,
  type CanvasDocument,
  type DocumentCommand,
  type Id,
  type UnbindCommand,
} from '@rmq/domain';

/**
 * What the inspector does to the bindings of an edge (ADR-0044), as commands. A binding is named exactly as the document has it, by the names of its two ends, its key and
 * its arguments (ADR-0026), so each of these is a line that a learner could type: `unbind orders -> billing key=order.*`.
 */

/** One binding of an edge, for a row of the inspector. */
export interface BindingRow {
  readonly id: Id;
  readonly key: string;
  /** It has header arguments, which the inspector does not edit yet. */
  readonly hasArguments: boolean;
}

/** The bindings between the two ends of an edge, in the order that they were made. */
export function bindingRows(document: CanvasDocument, key: string): BindingRow[] {
  return Object.entries(document.bindings)
    .filter(([, binding]) => edgeKey(binding.source, binding.dest.id) === key)
    .map(([id, binding]) => ({ id, key: binding.key, hasArguments: binding.headers !== undefined }));
}

/** The `unbind` that takes one binding off, or nothing if the document has no such binding. */
export function unbindCommand(document: CanvasDocument, id: Id): UnbindCommand | undefined {
  const binding = lookup(document.bindings, id);
  if (binding === undefined) {
    return undefined;
  }
  const source = nameOf(document, 'exchange', binding.source);
  const destination = nameOf(document, binding.dest.kind, binding.dest.id);
  if (source === undefined || destination === undefined) {
    return undefined;
  }
  return {
    type: 'unbind',
    source,
    destination: { kind: binding.dest.kind, name: destination },
    key: binding.key,
    ...(binding.headers === undefined ? {} : { headers: binding.headers }),
  };
}

/**
 * Gives a binding another key: an `unbind` and a `bind` in one batch, so that it is one step of undo. Nothing for a binding that is not there, and for the key that it has,
 * which would change nothing.
 */
export function rebindCommand(document: CanvasDocument, id: Id, key: string): DocumentCommand | undefined {
  const unbind = unbindCommand(document, id);
  if (unbind === undefined || unbind.key === key) {
    return undefined;
  }
  const { source, destination, headers } = unbind;
  return {
    type: 'batch',
    commands: [unbind, { type: 'bind', source, destination, key, ...(headers === undefined ? {} : { headers }) }],
  };
}
