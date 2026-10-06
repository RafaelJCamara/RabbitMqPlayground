import { inject, Injectable } from '@angular/core';
import { applyCommand, type CanvasDocument, type Command, type DocumentCommand, type Result } from '@rmq/domain';
import { Announcer } from '../announcer';
import { describeCommand, sentence } from './describe';
import { DocumentStore } from './document-store';
import { createIdGenerator } from './ids';
import type { CommandOrigin } from './origin';
import { SelectionStore } from './selection-store';
import { speakRefusal, StatusStore } from './status-store';

/**
 * A command that was accepted, for whoever follows what the learner does: the log of equivalent commands, for one. An `undo` and a `redo` are told as
 * a command is, with the two documents that they went between (ADR-0046).
 */
export interface Applied {
  readonly command: Command;
  readonly origin: CommandOrigin;
  readonly before: CanvasDocument;
  readonly after: CanvasDocument;
}

export type AppliedListener = (applied: Applied) => void;

export interface ApplyOptions {
  /** Say what was done, on the status line and in the live region. It is `true` unless a caller has a reason, such as a key that the canvas already announced. */
  readonly say?: boolean;
}

/**
 * The one way that the document changes (ADR-0011, ADR-0031). A gesture, a key, the inspector, a button and a menu all come here
 * with the command that they mean and the origin that says which they are. A refusal changes nothing, is told to the learner
 * with its root cause first, and comes back as a result. A command that changes nothing leaves nothing to undo.
 */
@Injectable()
export class CommandBus {
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly status = inject(StatusStore);
  private readonly announcer = inject(Announcer);
  private readonly ids = createIdGenerator(() => this.store.document());
  private readonly listeners = new Set<AppliedListener>();

  apply(command: DocumentCommand, origin: CommandOrigin, options: ApplyOptions = {}): Result<CanvasDocument> {
    const before = this.store.document();
    const restoreIds = this.ids.mark();
    const result = applyCommand(before, command, this.ids);
    if (!result.ok) {
      restoreIds();
      this.status.refuse(result.error, origin);
      this.announcer.announce(speakRefusal(result.error), 'assertive');
      return result;
    }

    const after = result.value;
    if (after !== before) {
      const label = describeCommand(command);
      this.store.commit(after, label);
      this.selection.prune(after);
      if (options.say !== false) {
        this.tell(sentence(label));
      } else {
        this.status.clear();
      }
      this.notify({ command, origin, before, after });
    }
    return result;
  }

  /** Takes back the last change. It answers whether there was one. Undo restores the design, not the simulation (ADR-0019). */
  undo(origin: CommandOrigin): boolean {
    const before = this.store.document();
    const step = this.store.undo();
    this.tell(step === undefined ? 'Nothing to undo.' : sentence(`Undid: ${step.label}`));
    this.selection.prune(this.store.document());
    if (step !== undefined) {
      this.notify({ command: { type: 'undo' }, origin, before, after: this.store.document() });
    }
    return step !== undefined;
  }

  redo(origin: CommandOrigin): boolean {
    const before = this.store.document();
    const step = this.store.redo();
    this.tell(step === undefined ? 'Nothing to redo.' : sentence(`Redid: ${step.label}`));
    this.selection.prune(this.store.document());
    if (step !== undefined) {
      this.notify({ command: { type: 'redo' }, origin, before, after: this.store.document() });
    }
    return step !== undefined;
  }

  /** Opens a document that has no past, and forgets what was selected and said. */
  load(document: CanvasDocument): void {
    this.store.load(document);
    this.selection.prune(document);
    this.status.clear();
  }

  /** Is told of every command that was accepted and changed the canvas, and of every undo and redo that did. A load is told by the store. */
  onApplied(listener: AppliedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(applied: Applied): void {
    for (const listener of [...this.listeners]) {
      listener(applied);
    }
  }

  private tell(text: string): void {
    this.status.say(text);
    this.announcer.announce(text);
  }
}
