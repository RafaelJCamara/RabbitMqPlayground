import { computed, Injectable, signal } from '@angular/core';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import { Timeline } from './timeline';

/** Why the document is another one now. A listener that follows the engine does not care, and one that saves does. */
export type ChangeCause = 'apply' | 'undo' | 'redo' | 'load';
export type DocumentListener = (document: CanvasDocument, cause: ChangeCause) => void;

/** What undo or redo did, in words, for the status line and the live region. */
export interface Stepped {
  readonly label: string;
}

/**
 * The document that is open, and its timeline (ADR-0031). The document is immutable, so a change of document is a change of
 * reference, which is what the signals, `OnPush` and the autosave compare (ADR-0019). Only the command bus changes it: nothing
 * else calls `commit`.
 */
@Injectable()
export class DocumentStore {
  private readonly timeline = new Timeline();
  private readonly current = signal<CanvasDocument>(emptyDocument());
  private readonly steps = signal<{
    readonly undoLabel: string | undefined;
    readonly redoLabel: string | undefined;
  }>({ undoLabel: undefined, redoLabel: undefined });
  private readonly listeners = new Set<DocumentListener>();

  readonly document = this.current.asReadonly();
  /** What the next undo would take back, or `undefined` when there is nothing to undo. */
  readonly undoLabel = computed(() => this.steps().undoLabel);
  readonly redoLabel = computed(() => this.steps().redoLabel);
  readonly canUndo = computed(() => this.steps().undoLabel !== undefined);
  readonly canRedo = computed(() => this.steps().redoLabel !== undefined);

  /** Opens a document. It has no past: the timeline is cleared (ADR-0019). */
  load(document: CanvasDocument): void {
    this.timeline.clear();
    this.set(document, 'load');
  }

  /** Makes `next` the document, and keeps the one from before, with what the change did, to go back to. */
  commit(next: CanvasDocument, label: string): void {
    const previous = this.current();
    if (next === previous) {
      return;
    }
    this.timeline.push(previous, label);
    this.set(next, 'apply');
  }

  undo(): Stepped | undefined {
    const step = this.timeline.undo(this.current());
    if (step === undefined) {
      return undefined;
    }
    this.set(step.document, 'undo');
    return { label: step.label };
  }

  redo(): Stepped | undefined {
    const step = this.timeline.redo(this.current());
    if (step === undefined) {
      return undefined;
    }
    this.set(step.document, 'redo');
    return { label: step.label };
  }

  /** Is told of every change of document, after it. The function that it returns stops it. */
  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(document: CanvasDocument, cause: ChangeCause): void {
    this.current.set(document);
    this.steps.set({ undoLabel: this.timeline.undoLabel, redoLabel: this.timeline.redoLabel });
    for (const listener of [...this.listeners]) {
      listener(document, cause);
    }
  }
}
