import { inject, Injectable } from '@angular/core';
import {
  applyCommand,
  elements,
  findId,
  kindOf,
  linkCommand,
  linkVerdict,
  lookup,
  nameOf,
  type ApplyContext,
  type BindCommand,
  type CanvasDocument,
  type DocumentCommand,
  type ElementKind,
  type Id,
  type Result,
} from '@rmq/domain';
import type { ExchangeType, HeaderArguments } from '@rmq/engine';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { NewNode } from '../canvas/model/new-node';
import { frameOf } from '../canvas/model/shapes';
import type { Point, Size } from '../canvas/model/transform';
import { CommandBus } from '../core/state/command-bus';
import { DEFAULT_EXCHANGE_ID } from '../core/state/default-exchange';
import { DocumentStore } from '../core/state/document-store';
import type { CommandOrigin } from '../core/state/origin';
import { describeNode } from '../core/state/refs';
import { addNode } from './add-node';
import { createChoices } from './create-choices';
import { NewNodeFocus } from './new-node-focus';

/** A rectangle on the host of the canvas: where a node is, for a popover to be placed by it. */
export type HostRect = Point & Size;

/** What the editor shows to ask for the key of a binding (ADR-0041): a popover at a node, which answers by `submit` or by `cancel`. */
export interface KeyAsk {
  /** What it is for, in words: `Binding key from exchange orders to queue billing`. */
  readonly title: string;
  readonly exchangeType: ExchangeType;
  /** What started the link, so that a refusal that the popover shows is not also shown on the status line. */
  readonly origin: CommandOrigin;
  /** One sentence for the type of the exchange. */
  readonly help: string;
  readonly anchor: HostRect | null;
  /** Makes the binding with this key. An answer that is not `ok` keeps the popover open, with the reason. */
  readonly submit: (key: string) => Result<CanvasDocument>;
  readonly cancel: () => void;
}

/** What the editor shows to ask for the conditions of a headers binding (ADR-0066): a popover at a node, which answers by `submit` or by `cancel`. */
export interface ConditionsAsk {
  /** What it is for, in words: `Conditions for the binding from exchange docs to queue pdf`. */
  readonly title: string;
  /** The exchange that the binding starts from and what it goes to, by name. */
  readonly exchange: string;
  readonly destination: BindCommand['destination'];
  /** What started the link, so that a refusal that the popover shows is not also shown on the status line. */
  readonly origin: CommandOrigin;
  readonly anchor: HostRect | null;
  /** Makes the binding with these arguments. An answer that is not `ok` keeps the popover open, with the reason. */
  readonly submit: (headers: HeaderArguments) => Result<CanvasDocument>;
  readonly cancel: () => void;
}

/** One node that the picker offers: what it is, and what the link would do. */
export interface TargetOption {
  readonly id: Id;
  readonly kind: ElementKind;
  readonly name: string;
  readonly summary: string;
}

/** What the editor shows to choose where to link to (ADR-0041): the picker. */
export interface TargetAsk {
  readonly title: string;
  readonly options: readonly TargetOption[];
  /** Why there is nothing to choose, in the words of the rule. `null` when there is something. */
  readonly reason: string | null;
  readonly anchor: HostRect | null;
  readonly choose: (id: Id) => void;
  readonly cancel: () => void;
}

/** What the editor shows after a drop on nothing (ADR-0042): a menu of what could be made, at the point where the link was let go. */
export interface CreateAsk {
  readonly title: string;
  readonly client: Point;
  readonly nodes: readonly NewNode[];
  readonly choose: (node: NewNode) => void;
  readonly cancel: () => void;
}

/** What the editor shows on behalf of `LinkFlow`. */
export interface LinkSurface {
  askKey(ask: KeyAsk): void;
  askConditions(ask: ConditionsAsk): void;
  askTarget(ask: TargetAsk): void;
  askNew(ask: CreateAsk): void;
}

const KEY_HELP: Readonly<Partial<Record<ExchangeType, string>>> = {
  direct: 'A message is routed to this queue when its routing key is exactly this key.',
  topic:
    'A topic key is words separated by dots. * matches one word and # matches zero or more words, as in order.* or #.created.',
};

/** Only a direct and a topic exchange read the key of a binding. A fanout ignores it, and a headers exchange reads conditions, which have a popover of their own with the flag `headers` (ADR-0066). */
const keyMatters = (type: ExchangeType | undefined): boolean => type === 'direct' || type === 'topic';

/** The commands that a link makes. */
type LinkingCommand = Extract<DocumentCommand, { readonly type: 'bind' | 'link' | 'subscribe' }>;

/** What is said when a link changes nothing, because what it makes is there already. */
const NOTHING_NEW: Readonly<Record<LinkingCommand['type'], string>> = {
  bind: 'Already bound with that key.',
  link: 'That producer already publishes there.',
  subscribe: 'That consumer already consumes from that queue.',
};

/** What is said for a node that cannot be linked from, and has nothing to be linked to, in the words of what it needs. */
const NEEDS: Readonly<Record<ElementKind, string>> = {
  producer: 'Add an exchange or a queue first: a producer publishes to one of them.',
  exchange: 'Add a queue or another exchange first: an exchange is bound to those.',
  queue: 'Add a consumer first: a queue is consumed by consumers.',
  consumer: 'A consumer is where a message ends: it takes messages from queues, and nothing is linked from it.',
};

/** Ids for the canvas that a link is tried on before anything is made, which only have to be ones that the canvas does not have. */
function scratchIds(): ApplyContext {
  let count = 0;
  return { newId: (kind) => `scratch-${kind}-${(count += 1)}` };
}

/**
 * The one function that makes a link (ADR-0041). The five ways to link, a drag, a click, `L`, the picker of the inspector and the picker of the context menu, all end
 * in `request`, and a drop on nothing ends in `createAndLink`, so a rule or a message cannot differ between them. It asks the domain what the link is (`linkCommand`, which also
 * says why one cannot be made), asks the learner for the key where a binding has one (a direct or a topic exchange) before anything is made, and applies the command with
 * the origin that says which way it was. What the learner is shown, a popover, a picker and a menu, is the editor's, and comes through the surface.
 */
@Injectable()
export class LinkFlow {
  private readonly bus = inject(CommandBus);
  private readonly store = inject(DocumentStore);
  private readonly viewport = inject(FlowViewport);
  private readonly focus = inject(NewNodeFocus);

  /** Set by the editor, which owns the popover, the picker and the menu. */
  surface: LinkSurface | undefined;

  /** Links two nodes of the canvas, in whatever way the learner asked. A refusal is told, root cause first, and nothing else happens. */
  request(source: Id, target: Id, origin: CommandOrigin): void {
    const document = this.store.document();
    const made = linkCommand(document, source, target);
    if (!made.ok) {
      this.bus.refuse(made.error, origin);
      return;
    }
    const command = made.value;
    if (command.type === 'bind') {
      const type = lookup(document.exchanges, source)?.type;
      if (type === 'headers' && this.surface !== undefined) {
        this.askConditions(
          command,
          describeNode(document, source) as string,
          describeNode(document, target) as string,
          this.anchorOf(document, target),
          origin,
          (bound) => this.apply(bound, origin),
        );
        return;
      }
      if (type !== undefined && keyMatters(type) && this.surface !== undefined) {
        this.askKey(
          command,
          type,
          describeNode(document, source) as string,
          describeNode(document, target) as string,
          this.anchorOf(document, target),
          origin,
          (bound) => this.apply(bound, origin),
        );
        return;
      }
    }
    this.apply(command, origin);
  }

  /** What a drop on a node that the rules do not allow says: the sentence of the rule, or for the default exchange, which is not a node of the document, its own. */
  explainInvalid(source: Id, target: Id, origin: CommandOrigin): void {
    if (target === DEFAULT_EXCHANGE_ID) {
      this.bus.refuse(
        {
          kind: 'invalid-link',
          message:
            'Nothing is linked to the default exchange: it has no name to publish to. Link the producer to the queue itself, and it publishes through the default exchange, with the name of the queue as its routing key.',
        },
        origin,
      );
      return;
    }
    const made = linkCommand(this.store.document(), source, target);
    if (!made.ok) {
      this.bus.refuse(made.error, origin);
    }
  }

  /** Opens the picker for a node: the nodes that the rules allow, grouped, and what the link to each would do. */
  openPicker(source: Id, origin: CommandOrigin): void {
    const document = this.store.document();
    const from = describeNode(document, source);
    if (from === undefined) {
      return;
    }
    const options = elements(document).flatMap(({ kind, id, name }): TargetOption[] => {
      const verdict = linkVerdict(document, source, id);
      return verdict.ok ? [{ id, kind, name, summary: verdict.summary }] : [];
    });
    this.surface?.askTarget({
      title: `Link ${from} to…`,
      options,
      reason: options.length === 0 ? NEEDS[kindOf(document, source) as ElementKind] : null,
      anchor: this.anchorOf(document, source),
      choose: (id) => this.request(source, id, origin),
      cancel: () => this.bus.say('Link cancelled.'),
    });
  }

  /** A link that was let go on empty canvas: the menu of what could be made there, at the point where it was let go. */
  dropOnNothing(source: Id, at: Point, client: Point, origin: CommandOrigin): void {
    const document = this.store.document();
    const { nodes, reason } = createChoices(document, source);
    if (nodes.length === 0) {
      this.bus.refuse(
        // The choices say why they are none: each item of the toolbox that is not offered has its reason.
        { kind: 'invalid-link', message: reason as string },
        origin,
      );
      return;
    }
    this.surface?.askNew({
      title: `Create and link from ${describeNode(document, source) as string}`,
      client,
      nodes,
      choose: (node) => this.createAndLink(source, node, at, origin),
      cancel: () => undefined,
    });
  }

  /**
   * Makes a node where a link was let go, and the link, as one batch and so one step of undo (ADR-0042). The node goes where the toolbox puts one that is dropped, with its
   * middle at the point. The link is worked out on a copy of the canvas that has the node, so that it is the command that `request` would make.
   */
  createAndLink(source: Id, node: NewNode, at: Point, origin: CommandOrigin): void {
    const document = this.store.document();
    const addition = addNode(document, node, at);
    const added = applyCommand(document, addition.command, scratchIds());
    if (!added.ok) {
      this.bus.refuse(added.error, origin);
      return;
    }
    const target = findId(added.value, addition.kind, addition.name) as Id;
    const made = linkCommand(added.value, source, target);
    if (!made.ok) {
      this.bus.refuse(made.error, origin);
      return;
    }
    const steps: readonly DocumentCommand[] =
      addition.command.type === 'batch' ? addition.command.commands : [addition.command];
    const make = (link: DocumentCommand): Result<CanvasDocument> => {
      const result = this.bus.apply({ type: 'batch', commands: [...steps, link] }, origin);
      if (result.ok) {
        this.focus.show(addition.kind, addition.name);
      }
      return result;
    };
    if (made.value.type === 'bind') {
      const type = lookup(document.exchanges, source)?.type;
      if (type === 'headers' && this.surface !== undefined) {
        const { width, height } = frameOf(addition.kind, addition.name);
        this.askConditions(
          made.value,
          describeNode(document, source) as string,
          `${addition.kind} ${addition.name}`,
          this.viewport.onHost({ x: at.x - width / 2, y: at.y - height / 2, width, height }),
          origin,
          make,
        );
        return;
      }
      if (type !== undefined && keyMatters(type) && this.surface !== undefined) {
        const { width, height } = frameOf(addition.kind, addition.name);
        this.askKey(
          made.value,
          type,
          describeNode(document, source) as string,
          `${addition.kind} ${addition.name}`,
          this.viewport.onHost({ x: at.x - width / 2, y: at.y - height / 2, width, height }),
          origin,
          make,
        );
        return;
      }
    }
    make(made.value);
  }

  private askKey(
    command: BindCommand,
    type: ExchangeType,
    from: string,
    to: string,
    anchor: HostRect | null,
    origin: CommandOrigin,
    make: (command: BindCommand) => Result<CanvasDocument>,
  ): void {
    this.surface?.askKey({
      title: `Binding key from ${from} to ${to}`,
      exchangeType: type,
      origin,
      help: KEY_HELP[type] ?? '',
      anchor,
      submit: (key) => make({ ...command, key }),
      cancel: () => this.bus.say('Link cancelled.'),
    });
  }

  private askConditions(
    command: BindCommand,
    from: string,
    to: string,
    anchor: HostRect | null,
    origin: CommandOrigin,
    make: (command: BindCommand) => Result<CanvasDocument>,
  ): void {
    this.surface?.askConditions({
      title: `Conditions for the binding from ${from} to ${to}`,
      exchange: command.source,
      destination: command.destination,
      origin,
      anchor,
      submit: (headers) => make({ ...command, headers }),
      cancel: () => this.bus.say('Link cancelled.'),
    });
  }

  /** Applies a command, and says so when it changed nothing, because what it makes is there already, which would otherwise be silent. */
  private apply(command: LinkingCommand, origin: CommandOrigin): Result<CanvasDocument> {
    const before = this.store.document();
    const result = this.bus.apply(command, origin);
    if (result.ok && result.value === before) {
      this.bus.say(
        command.type === 'bind' && command.headers !== undefined
          ? 'Already bound with those conditions.'
          : NOTHING_NEW[command.type],
      );
    }
    return result;
  }

  /** Where a node is on the host of the canvas, at the size that it is drawn, which is where a popover goes that is about it. */
  private anchorOf(document: CanvasDocument, id: Id): HostRect | null {
    const position = lookup(document.layout.nodes, id);
    const kind = kindOf(document, id);
    if (position === undefined || kind === undefined) {
      return null;
    }
    const { width, height } = frameOf(kind, nameOf(document, kind, id) ?? '');
    return this.viewport.onHost({ x: position.x, y: position.y, width, height });
  }
}
