import { History, type CanvasDocument } from '@rmq/domain';

/** What a step of undo or redo gives back: the document, and what the step did, in words. */
export interface Step {
  readonly document: CanvasDocument;
  readonly label: string;
}

/**
 * The domain's `History`, with a sentence for each step (ADR-0031). The history keeps documents and nothing else
 * (ADR-0019), so the words that say what a step did are kept here, in step with it, and undo can say what it undid.
 */
export class Timeline {
  private readonly history: History;
  private undoLabels: string[] = [];
  private redoLabels: string[] = [];

  constructor(limit?: number) {
    this.history = new History(limit);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get undoDepth(): number {
    return this.history.undoDepth;
  }

  /** What the next undo would take back. */
  get undoLabel(): string | undefined {
    return this.undoLabels.at(-1);
  }

  /** What the next redo would bring back. */
  get redoLabel(): string | undefined {
    return this.redoLabels.at(-1);
  }

  /** Records the document from before a command that changed it, and what that command did. */
  push(previous: CanvasDocument, label: string): void {
    this.history.push(previous);
    this.undoLabels.push(label);
    if (this.undoLabels.length > this.history.undoDepth) {
      this.undoLabels.shift();
    }
    this.redoLabels = [];
  }

  undo(current: CanvasDocument): Step | undefined {
    const document = this.history.undo(current);
    const label = this.undoLabels.pop();
    if (document === undefined || label === undefined) {
      return undefined;
    }
    this.redoLabels.push(label);
    return { document, label };
  }

  redo(current: CanvasDocument): Step | undefined {
    const document = this.history.redo(current);
    const label = this.redoLabels.pop();
    if (document === undefined || label === undefined) {
      return undefined;
    }
    this.undoLabels.push(label);
    return { document, label };
  }

  clear(): void {
    this.history.clear();
    this.undoLabels = [];
    this.redoLabels = [];
  }
}
