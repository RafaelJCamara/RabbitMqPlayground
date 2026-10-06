import { findId, lookup } from '../document/elements';
import { fail, ok, type Issue, type Result } from '../document/issue';
import { LIMITS, type CanvasDocument, type Id } from '../document/schema';
import { edgeKey, edgeKeys } from '../document/topology';
import { autoLayout } from '../layout';
import { defaultPosition, missingElementIssue, sameValue } from './helpers';
import type { Layout, Move, MoveLabel } from './types';

/**
 * Where things are drawn: a node, the label of an edge, or every node at once. None of it changes what the canvas does,
 * only how it looks, and it is in the document so that it is saved and undone with the rest.
 */

const outside = (what: string, value: number): Issue => ({
  kind: 'invalid-value',
  message: `The ${what} must be a number from -${LIMITS.coordinate} to ${LIMITS.coordinate}, and ${value} is not.`,
});

const isCoordinate = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= LIMITS.coordinate;

export function applyMove(document: CanvasDocument, command: Move): Result<CanvasDocument> {
  const { kind, name } = command.target;
  const id = findId(document, kind, name);
  if (id === undefined) {
    return fail(missingElementIssue(document, kind, name));
  }
  if (command.x === undefined && command.y === undefined) {
    return fail({ kind: 'nothing-to-change', message: 'Say where to move it, for example x=200 y=80.' });
  }
  if (command.x !== undefined && !isCoordinate(command.x)) {
    return fail(outside('x', command.x));
  }
  if (command.y !== undefined && !isCoordinate(command.y)) {
    return fail(outside('y', command.y));
  }

  const current = lookup(document.layout.nodes, id) ?? defaultPosition(document, kind);
  const next = { x: command.x ?? current.x, y: command.y ?? current.y };
  return ok(
    sameValue(current, next) && lookup(document.layout.nodes, id) !== undefined
      ? document
      : { ...document, layout: { ...document.layout, nodes: { ...document.layout.nodes, [id]: next } } },
  );
}

export function applyMoveLabel(document: CanvasDocument, command: MoveLabel): Result<CanvasDocument> {
  const from = findId(document, command.from.kind, command.from.name);
  if (from === undefined) {
    return fail(missingElementIssue(document, command.from.kind, command.from.name));
  }
  const to = findId(document, command.to.kind, command.to.name);
  if (to === undefined) {
    return fail(missingElementIssue(document, command.to.kind, command.to.name));
  }
  const key = edgeKey(from, to);
  if (!edgeKeys(document).has(key)) {
    return fail({
      kind: 'invalid-link',
      message: `There is no edge from '${command.from.name}' to '${command.to.name}' on the canvas, so there is no label to move.`,
    });
  }
  if (!(command.at >= 0 && command.at <= 1)) {
    return fail({
      kind: 'invalid-value',
      message: `A label sits from 0, at the start of its edge, to 1, at the end, and ${command.at} is not between them.`,
    });
  }
  if (lookup(document.layout.labels, key)?.at === command.at) {
    return ok(document);
  }
  return ok({
    ...document,
    layout: { ...document.layout, labels: { ...document.layout.labels, [key]: { at: command.at } } },
  });
}

/** Puts every node where `autoLayout` says. The labels stay where they are along their edges. */
export function applyLayout(document: CanvasDocument, _command: Layout): Result<CanvasDocument> {
  const placed = autoLayout(document);
  const nodes: Record<Id, { x: number; y: number }> = { ...document.layout.nodes, ...placed };
  return ok(
    sameValue(document.layout.nodes, nodes) ? document : { ...document, layout: { ...document.layout, nodes } },
  );
}
