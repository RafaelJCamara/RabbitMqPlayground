import type { CanvasDocument } from './document/schema';

/**
 * Undo and redo through the documents themselves (ADR-0019). The history keeps document references, and no patches and no
 * inverse commands: undo hands back the document from before, which is the very object that was there, and a command that
 * did not touch a branch left it shared, so keeping two hundred documents costs little. A batch is one command and so one
 * entry.
 *
 * History belongs to one open canvas and lives in memory. The app calls `push` with the document from before each
 * command that changed something, which is what an `apply` that returned another document means, and asks for `undo` and
 * `redo` with the document that is on the canvas now. Undo restores the design and not the simulation: queue contents are
 * the engine's, and a queue that undo brings back comes back empty.
 */

/** How many steps can be undone. The oldest goes first (ADR-0019). */
export const HISTORY_LIMIT = 200;

export class History {
  private undoStack: CanvasDocument[] = [];
  private redoStack: CanvasDocument[] = [];

  /** `limit` is how many steps are kept, `HISTORY_LIMIT` unless a spec wants a smaller number. */
  constructor(readonly limit: number = HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`A history keeps at least one step, not ${limit}.`);
    }
  }

  /** How many steps can be undone, and how many can be redone. */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Records the document from before a command that changed it. A new change ends what could have been redone. */
  push(previous: CanvasDocument): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /** The document from before the last change, or `undefined` when there is nothing to undo. `current` can be redone. */
  undo(current: CanvasDocument): CanvasDocument | undefined {
    const previous = this.undoStack.pop();
    if (previous !== undefined) {
      this.redoStack.push(current);
    }
    return previous;
  }

  /** The document that the last undo took away, or `undefined` when there is nothing to redo. `current` can be undone. */
  redo(current: CanvasDocument): CanvasDocument | undefined {
    const next = this.redoStack.pop();
    if (next !== undefined) {
      this.undoStack.push(current);
    }
    return next;
  }

  /** Forgets everything: for a canvas that was loaded, which has no past. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
