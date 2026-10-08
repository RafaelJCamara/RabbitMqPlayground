import {
  applyCommand,
  emptyDocument,
  History,
  isDocumentCommand,
  parseCommand,
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

const LETTER: Readonly<Record<IdKind, string>> = {
  exchange: 'x',
  queue: 'q',
  producer: 'p',
  consumer: 'c',
  binding: 'b',
};

/** A context whose ids count up from 1 for each kind of thing, and start with `prefix`. */
export function prefixedIds(prefix: string): ApplyContext {
  const counters = new Map<IdKind, number>();
  return {
    newId(kind) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${prefix}${LETTER[kind]}${next}`;
    },
  };
}

/** A context whose ids count up from 1 for each kind of thing: `x1`, `x2`, `q1`. */
export const sequentialIds = (): ApplyContext => prefixedIds('');

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

/**
 * The canvas that these lines of the command language make, one command to a line, on an empty canvas or on `from`. A line that is blank or starts with `#` is a comment. It throws, saying which line and why,
 * when a line is not read, is not a command that changes the canvas, or is refused. It is how a fixture says what canvas it is about, in words that a person reads.
 */
export function canvasFromText(
  text: string,
  context: ApplyContext = sequentialIds(),
  from: CanvasDocument = emptyDocument(),
): CanvasDocument {
  let document = from;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const read = parseCommand(line, document);
    if (!read.ok) {
      throw new Error(`Line ${index + 1} (${line}) was not read: ${read.error.message}`);
    }
    if (!isDocumentCommand(read.value)) {
      throw new Error(`Line ${index + 1} (${line}) is not a command that changes the canvas`);
    }
    const result = applyCommand(document, read.value, context);
    if (!result.ok) {
      throw new Error(`Line ${index + 1} (${line}) was refused: ${result.error.message}`);
    }
    document = result.value;
  });
  return document;
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
