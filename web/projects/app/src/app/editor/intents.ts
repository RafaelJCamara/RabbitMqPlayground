import { inject, Injectable } from '@angular/core';
import { findId, kindOf, linkCommand, linkRules, lookup, nameOf, type DocumentCommand, type Id } from '@rmq/domain';
import { Announcer } from '../core/announcer';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { removeEdgeCommands } from '../core/state/edge-commands';
import type { CommandOrigin } from '../core/state/origin';
import { refOf } from '../core/state/refs';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasIntent, ContextTarget, InputBy } from '../canvas/model/intents';
import type { NewNode } from '../canvas/model/new-node';
import type { Point } from '../canvas/model/transform';
import { frameOf } from '../canvas/model/shapes';
import { addNode } from './add-node';

/** What the editor shows as a result of an intent that is not a command: a menu that opens, a name that is being edited. */
export interface IntentSurface {
  openMenu(target: ContextTarget, client: Point): void;
  startRename(id: Id): void;
}

const originOf = (by: InputBy): CommandOrigin => (by === 'keyboard' ? 'key' : 'gesture');

/**
 * Turns what the canvas reports into commands (ADR-0031, ADR-0033). The canvas never changes what is on it: it says what the learner
 * did, in ids, and this is the one place that decides which commands that is, names the elements by kind and name, and
 * gives the bus the origin. What is refused is told to the learner by the bus, with its root cause first.
 */
@Injectable()
export class IntentHandler {
  private readonly bus = inject(CommandBus);
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly status = inject(StatusStore);
  private readonly announcer = inject(Announcer);
  private readonly viewport = inject(FlowViewport);

  /** Set by the editor, which owns the menu and the field for a name. */
  surface: IntentSurface | undefined;

  handle(intent: CanvasIntent): void {
    switch (intent.type) {
      case 'select':
        this.selection.select(intent.nodes, intent.edges);
        break;
      case 'move':
        this.move(intent.moves, originOf(intent.by));
        break;
      case 'delete':
        this.remove(intent.nodes, intent.edges, originOf(intent.by));
        break;
      case 'link':
        this.link(intent.source, intent.target, intent.via === 'keyboard' ? 'key' : 'gesture');
        break;
      case 'link-invalid':
        this.explainInvalidLink(intent.source, intent.target);
        break;
      case 'link-to-empty':
        this.say('There is nothing to link to where you let go. Drop the link on a node.');
        break;
      case 'context-menu':
        this.surface?.openMenu(intent.target, intent.client);
        break;
      case 'rename':
        this.surface?.startRename(intent.id);
        break;
      case 'drop-new':
        this.add(intent.node, 'gesture', intent.at);
        break;
    }
  }

  /** Adds a node from the toolbox, selects it, and brings it into view. */
  add(node: NewNode, origin: CommandOrigin, at?: Point): void {
    const addition = addNode(this.store.document(), node, at);
    if (this.bus.apply(addition.command, origin).ok) {
      this.showNew(addition.kind, addition.name);
    }
  }

  /** Deletes what is selected, which is the same as the Delete key does, for the menu and the inspector. */
  deleteSelected(origin: CommandOrigin): void {
    const { nodes, edges } = this.selection.selection();
    this.remove(nodes, edges, origin);
  }

  private showNew(kind: NewNode['kind'], name: string): void {
    const document = this.store.document();
    const id = findId(document, kind, name);
    if (id === undefined) {
      return;
    }
    this.selection.select([id]);
    const position = lookup(document.layout.nodes, id);
    if (position !== undefined) {
      const { width, height } = frameOf(kind);
      this.viewport.reveal({ id, x: position.x, y: position.y, width, height });
    }
  }

  private move(
    moves: readonly { readonly id: Id; readonly x: number; readonly y: number }[],
    origin: CommandOrigin,
  ): void {
    const document = this.store.document();
    const commands = moves.flatMap(({ id, x, y }): DocumentCommand[] => {
      const target = refOf(document, id);
      return target === undefined ? [] : [{ type: 'move', target, x, y }];
    });
    // What was moved is not announced: the canvas says where a node was dropped when a key drops it, and a pointer shows it.
    this.apply(commands, origin, false);
  }

  private remove(nodes: readonly Id[], edges: readonly string[], origin: CommandOrigin): void {
    const document = this.store.document();
    // The edges go first, while both of their ends are there, and then the nodes, which take what is left of theirs with them.
    const commands: DocumentCommand[] = [
      ...edges.flatMap((key) => removeEdgeCommands(document, key)),
      ...nodes.flatMap((id): DocumentCommand[] => {
        const target = refOf(document, id);
        return target === undefined ? [] : [{ type: 'delete', target }];
      }),
    ];
    this.apply(commands, origin, true);
  }

  private link(source: Id, target: Id, origin: CommandOrigin): void {
    const command = linkCommand(this.store.document(), source, target);
    if (command.ok) {
      this.bus.apply(command.value, origin);
    } else {
      this.explain(command.error.message);
    }
  }

  private explainInvalidLink(source: Id, target: Id): void {
    const rules = linkRules(this.store.document());
    this.explain(rules.explain(source, target));
  }

  /** A drop that cannot be made is a refusal, and says why in the words of the rule that forbids it. */
  private explain(message: string): void {
    this.status.refuse({ kind: 'invalid-link', message }, 'gesture');
    this.announcer.announce(message, 'assertive');
  }

  private say(text: string): void {
    this.status.say(text);
    this.announcer.announce(text);
  }

  /** One command applies as it is, several as one batch, which is one step of undo. */
  private apply(commands: readonly DocumentCommand[], origin: CommandOrigin, say: boolean): void {
    const [only] = commands;
    if (only === undefined) {
      return;
    }
    this.bus.apply(commands.length === 1 ? only : { type: 'batch', commands }, origin, { say });
  }

  /** The kind and the name of what a context menu or the inspector acts on, for the words of a button. */
  describe(id: Id): string | undefined {
    const document = this.store.document();
    const kind = kindOf(document, id);
    const name = kind === undefined ? undefined : nameOf(document, kind, id);
    return kind === undefined || name === undefined ? undefined : `${kind} ${name}`;
  }
}
