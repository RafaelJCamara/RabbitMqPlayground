import { inject, Injectable } from '@angular/core';
import {
  applyCommand,
  fail,
  ok,
  runtimeIssue,
  type CanvasDocument,
  type Command,
  type DocumentCommand,
  type Issue,
  type Result,
  type RuntimeCommand,
} from '@rmq/domain';
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

/** What running a command of the simulation did (ADR-0054). */
export interface RuntimeOutcome {
  /** Whether it changed the simulation, which is what puts a line in the log. */
  readonly changed: boolean;
  /** What to tell the learner, on the status line and aloud. */
  readonly said: string;
}

/** What the bus hands the commands of the simulation to: the simulation is it. Without one, they are refused. */
export interface RuntimeHost {
  execute(command: RuntimeCommand): RuntimeOutcome;
  /** How many messages the last change of the canvas took out of the simulation. It says each number once, and 0 until the canvas changes again. */
  takeLost(): number;
}

const SIMULATION_OFF: Issue = {
  kind: 'unsupported',
  message:
    'The simulation is not switched on yet, so there is nothing to run. It is still being built: add ?ff=simulation to the address to try it.',
};

/** What the learner is told when a change of the canvas took messages with it, after what was done. */
const lostWords = (count: number): string =>
  count === 0 ? '' : ` ${count === 1 ? '1 message was' : `${count} messages were`} lost.`;

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
  private host: RuntimeHost | null = null;

  apply(command: DocumentCommand, origin: CommandOrigin, options: ApplyOptions = {}): Result<CanvasDocument> {
    const before = this.store.document();
    const restoreIds = this.ids.mark();
    const result = applyCommand(before, command, this.ids);
    if (!result.ok) {
      restoreIds();
      this.refuse(result.error, origin);
      return result;
    }

    const after = result.value;
    if (after !== before) {
      const label = describeCommand(command);
      this.store.commit(after, label);
      this.selection.prune(after);
      const lost = this.host?.takeLost() ?? 0;
      if (options.say !== false) {
        this.tell(`${sentence(label)}${lostWords(lost)}`);
      } else if (lost > 0) {
        // The canvas has said what was done, and not what it cost.
        this.tell(lostWords(lost).trim());
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
    this.tell(
      step === undefined
        ? 'Nothing to undo.'
        : `${sentence(`Undid: ${step.label}`)}${lostWords(this.host?.takeLost() ?? 0)}`,
    );
    this.selection.prune(this.store.document());
    if (step !== undefined) {
      this.notify({ command: { type: 'undo' }, origin, before, after: this.store.document() });
    }
    return step !== undefined;
  }

  redo(origin: CommandOrigin): boolean {
    const before = this.store.document();
    const step = this.store.redo();
    this.tell(
      step === undefined
        ? 'Nothing to redo.'
        : `${sentence(`Redid: ${step.label}`)}${lostWords(this.host?.takeLost() ?? 0)}`,
    );
    this.selection.prune(this.store.document());
    if (step !== undefined) {
      this.notify({ command: { type: 'redo' }, origin, before, after: this.store.document() });
    }
    return step !== undefined;
  }

  /**
   * Runs a command of the simulation (ADR-0054): the one door of the runtime, as `apply` is of the document. It is checked against the canvas as it is, and a
   * refusal says the root cause first. What it did is told as a command is, and one that changed the simulation is told to the listeners, which is what writes
   * it in the log. One that changed nothing is not, and is still said, so that a key that did nothing is not silent.
   */
  run(command: RuntimeCommand, origin: CommandOrigin, options: ApplyOptions = {}): Result<RuntimeOutcome> {
    const document = this.store.document();
    const host = this.host;
    if (host === null) {
      return this.refused(SIMULATION_OFF, origin);
    }
    const issue = runtimeIssue(document, command);
    if (issue !== null) {
      return this.refused(issue, origin);
    }
    const outcome = host.execute(command);
    if (options.say !== false) {
      this.tell(outcome.said);
    } else {
      this.status.clear();
    }
    if (outcome.changed) {
      this.notify({ command, origin, before: document, after: document });
    }
    return ok(outcome);
  }

  private refused(issue: Issue, origin: CommandOrigin): Result<never> {
    this.refuse(issue, origin);
    return fail(issue);
  }

  /** The simulation says that it is the one that runs the commands of the runtime, until the function that it gets is called. */
  attach(host: RuntimeHost): () => void {
    this.host = host;
    return () => {
      if (this.host === host) {
        this.host = null;
      }
    };
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

  /** Tells a refusal that no command made, such as a link that a rule forbids, as a command that is refused is told: root cause first, aloud, assertively. */
  refuse(issue: Issue, origin: CommandOrigin): void {
    this.status.refuse(issue, origin);
    this.announcer.announce(speakRefusal(issue), 'assertive');
  }

  /** Says what was done, or not done, on the status line and aloud. */
  say(text: string): void {
    this.tell(text);
  }

  private tell(text: string): void {
    this.status.say(text);
    this.announcer.announce(text);
  }
}
