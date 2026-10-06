import { inject, Injectable } from '@angular/core';
import { type CanvasDocument, type DocumentCommand, type Id, type Result } from '@rmq/domain';
import { CommandBus } from '../core/state/command-bus';
import { isVirtual } from '../core/state/default-exchange';
import { DocumentStore } from '../core/state/document-store';
import { removeEdgeCommands } from '../core/state/edge-commands';
import type { CommandOrigin } from '../core/state/origin';
import { describeNode, edgeEnds, refOf } from '../core/state/refs';
import { SelectionStore } from '../core/state/selection-store';
import type { CanvasIntent, ContextTarget, InputBy, LinkVia } from '../canvas/model/intents';
import type { NewNode } from '../canvas/model/new-node';
import type { Point, Size } from '../canvas/model/transform';
import { addNode } from './add-node';
import { LinkFlow } from './link-flow';
import { NewNodeFocus } from './new-node-focus';

/** What the editor shows as a result of an intent that is not a command: a menu that opens, a name that is being edited, the full text of a label. */
export interface IntentSurface {
  openMenu(target: ContextTarget, client: Point): void;
  startRename(id: Id, origin?: CommandOrigin): void;
  /** A pointer is over the label of an edge, at `rect` on the page, or has left it (`key` is `null`). */
  showPeek(key: string | null, rect?: Point & Size): void;
}

const originOf = (by: InputBy): CommandOrigin => (by === 'keyboard' ? 'key' : 'gesture');

/** A link that was dragged or clicked is a gesture, and one that the keyboard made is a key. */
const linkOrigin = (via: LinkVia): CommandOrigin => (via === 'keyboard' ? 'key' : 'gesture');

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
  private readonly links = inject(LinkFlow);
  private readonly focus = inject(NewNodeFocus);

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
      // Every way to link ends in one function (ADR-0041), and a link that is let go on nothing in the menu that offers something to link to (ADR-0042).
      case 'link':
        this.links.request(intent.source, intent.target, linkOrigin(intent.via));
        break;
      case 'link-invalid':
        this.links.explainInvalid(intent.source, intent.target, linkOrigin(intent.via));
        break;
      case 'link-to-empty':
        this.links.dropOnNothing(intent.source, intent.at, intent.client, linkOrigin(intent.via));
        break;
      case 'move-label':
        this.moveLabel(intent.key, intent.at);
        break;
      case 'peek':
        this.surface?.showPeek(intent.key, intent.rect);
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
      this.focus.show(addition.kind, addition.name);
    }
  }

  /**
   * Renames a node. It answers what the bus answered, so that a field that is open can say why a name was refused, and `undefined`
   * when the node is not on the canvas any more.
   */
  rename(id: Id, name: string, origin: CommandOrigin): Result<CanvasDocument> | undefined {
    const target = refOf(this.store.document(), id);
    return target === undefined ? undefined : this.bus.apply({ type: 'rename', target, name }, origin);
  }

  /** Deletes what a menu was opened on, whether or not it is selected. */
  deleteTarget(target: ContextTarget, origin: CommandOrigin): void {
    if (target.kind === 'node') {
      this.remove([target.id], [], origin);
    } else {
      this.remove([], [target.key], origin);
    }
  }

  /** Deletes what is selected, which is the same as the Delete key does, for the menu and the inspector. */
  deleteSelected(origin: CommandOrigin): void {
    const { nodes, edges } = this.selection.selection();
    this.remove(nodes, edges, origin);
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

  /** The label of an edge was dragged along it: where it is let go is the place that the document keeps, as one `move label`. */
  private moveLabel(key: string, at: number): void {
    const ends = edgeEnds(key);
    const document = this.store.document();
    const from = ends === undefined ? undefined : refOf(document, ends.from);
    const to = ends === undefined ? undefined : refOf(document, ends.to);
    if (from !== undefined && to !== undefined) {
      this.bus.apply({ type: 'move-label', from, to, at }, 'gesture');
    }
  }

  private remove(nodes: readonly Id[], edges: readonly string[], origin: CommandOrigin): void {
    // The default exchange and its implicit bindings are RabbitMQ's, and are not in the document, so there is nothing to delete (ADR-0043).
    if ([...nodes, ...edges].some(isVirtual)) {
      this.bus.refuse(
        {
          kind: 'unsupported',
          message: 'RabbitMQ makes the default exchange and its bindings itself, so they cannot be deleted or changed.',
        },
        origin,
      );
      return;
    }
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
    return describeNode(this.store.document(), id);
  }
}
