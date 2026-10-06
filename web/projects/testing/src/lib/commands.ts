import {
  applyCommand,
  History,
  type ApplyContext,
  type CanvasDocument,
  type DocumentCommand,
  type IdKind,
} from '@rmq/domain';
import type { Destination } from '@rmq/engine';

/**
 * Helpers for specs that apply commands. The ids that they hand out are the same every time, so that a spec can name them:
 * `x1` is the first exchange, `q2` the second queue, `p1` a producer, `c1` a consumer and `b3` the third binding.
 */

const PREFIX: Readonly<Record<IdKind, string>> = {
  exchange: 'x',
  queue: 'q',
  producer: 'p',
  consumer: 'c',
  binding: 'b',
};

/** A context whose ids count up from 1 for each kind of thing. */
export function sequentialIds(): ApplyContext {
  const counters = new Map<IdKind, number>();
  return {
    newId(kind) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${PREFIX[kind]}${next}`;
    },
  };
}

/** Applies commands in order, and throws, saying which and why, if one of them is refused. */
export function applyAll(
  document: CanvasDocument,
  commands: readonly DocumentCommand[],
  context: ApplyContext = sequentialIds(),
): CanvasDocument {
  return commands.reduce((current, command, index) => {
    const result = applyCommand(current, command, context);
    if (!result.ok) {
      throw new Error(`Command ${index + 1} (${JSON.stringify(command)}) was refused: ${result.error.message}`);
    }
    return result.value;
  }, document);
}

/** The two ends of a binding that a spec names most: a queue and an exchange. */
export const queueEnd = (name: string): Destination => ({ kind: 'queue', name });
export const exchangeEnd = (name: string): Destination => ({ kind: 'exchange', name });

/**
 * What undo and redo give back for a change from `before` to `after`: the very documents, with `===`, and a command that
 * changed nothing leaves nothing to undo. Returns the problems that it found, so that a spec can say `toEqual([])`.
 */
export function undoRedoProblems(before: CanvasDocument, after: CanvasDocument): string[] {
  const problems: string[] = [];
  const history = new History();
  if (after !== before) {
    history.push(before);
  }
  if (history.canUndo !== (after !== before)) {
    problems.push('the history did not take the change');
  }
  const undone = history.undo(after);
  if ((after !== before && undone !== before) || (after === before && undone !== undefined)) {
    problems.push('undo did not give back the document from before');
  }
  const redone = history.redo(undone ?? after);
  if ((after !== before && redone !== after) || (after === before && redone !== undefined)) {
    problems.push('redo did not give back the document from after');
  }
  return problems;
}
