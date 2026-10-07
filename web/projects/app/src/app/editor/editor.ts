import {
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { kindOf, linkRules, type Id, type Issue } from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { buildCanvasVm, EMPTY_VM } from '../canvas/model/canvas-vm';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { lowerFirst } from '../canvas/model/labels';
import type { CanvasIntent, ContextTarget } from '../canvas/model/intents';
import { newNodeKey } from '../canvas/model/new-node';
import { popoverPosition, type Point, type Size } from '../canvas/model/transform';
import { MessageOverlay, type DrawnMarker } from '../canvas/overlay/overlay';
import { Announcer } from '../core/announcer';
import { DebugSources } from '../core/debug/debug-sources';
import { NO_EMPHASIS } from '../core/explain/emphasis';
import { EventLog } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { isVirtual } from '../core/state/default-exchange';
import type { CommandOrigin } from '../core/state/origin';
import { FeatureFlags } from '../core/flags/feature-flags';
import { DocumentStore } from '../core/state/document-store';
import { describeNode, edgeEnds } from '../core/state/refs';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { CommandBar } from '../command-bar/command-bar';
import { CommandLog } from '../core/state/command-log';
import { EventLogPanel } from '../explain/event-log-panel';
import { LogToggle } from '../explain/log-toggle';
import { MessageInspector } from '../explain/message-inspector';
import { WhatIfTester } from '../explain/what-if-tester';
import { WhyCard } from '../explain/why-card';
import { EditorActions, type ActionSurface } from './actions';
import { BindingConditions } from './binding-conditions';
import { BindingKey, type GiveUp } from './binding-key';
import { CheatSheetService } from './cheat-sheet';
import { contextItems, ContextMenu, type MenuChoice } from './context-menu';
import { HintBar } from './hint-bar';
import { HowToLink, HowToLinkCard } from './how-to-link';
import { Inspector } from './inspector';
import { IntentHandler, type IntentSurface } from './intents';
import { KeyboardService, keysFor } from './keyboard';
import { LabelCard } from './label-card';
import {
  LinkFlow,
  type ConditionsAsk,
  type CreateAsk,
  type KeyAsk,
  type LinkSurface,
  type TargetAsk,
} from './link-flow';
import { LinkPicker } from './link-picker';
import { NewNodeFocus } from './new-node-focus';
import { RenameField, type RenameBy } from './rename-field';
import { saveText } from './save-text';
import { SimulationBar } from '../simulation/simulation-bar';
import { StatusBar } from './status-bar';
import { Toolbox, TOOLBOX } from './toolbox';
import { TopBar } from './top-bar';

/** How many of the canvas's reports the end-to-end build keeps. */
const INTENT_LOG_LIMIT = 200;

/** How big the popover that asks for a key and the picker are, which is what keeps them inside the canvas. */
const KEY_SIZE: Size = { width: 288, height: 190 };
/** The popover of a topic key is taller with the tester of the key in it (ADR-0064), which is the keys that it matches and does not, a few of each. */
const KEY_TOPIC_SIZE: Size = { width: 288, height: 480 };
/** The popover of the conditions of a headers binding (ADR-0066) is wider than the one for a key, and as tall as the canvas lets it be: it scrolls inside itself when it is taller. */
const CONDITIONS_SIZE: Size = { width: 448, height: 480 };
const PICKER_SIZE: Size = { width: 320, height: 320 };

/** How long the card of a label waits, when the pointer has left the label, for the pointer to arrive on the card. */
const PEEK_GRACE_MS = 150;

/** A node that is being renamed, and where its field is. */
interface Renaming {
  readonly id: Id;
  readonly name: string;
  readonly label: string;
  readonly origin: CommandOrigin;
  readonly rect: Point & Size;
  /** Why the last name was refused, while the field stays open. */
  readonly error: Issue | null;
}

/** A label whose full text is shown, and where. */
interface Peek {
  readonly title: string;
  readonly items: readonly string[];
  readonly at: Point;
}

/**
 * The editor (ADR-0010, ADR-0030): a top bar, a toolbox on the left, the canvas in the middle, an inspector on the right and a status
 * strip at the bottom. It makes the state that it shares among its parts (ADR-0031), opens the one implicit canvas, and says
 * aloud what the learner needs to hear about keeping it. What the canvas lays over itself is its own: the field that renames a node, the
 * popover that asks for a key, the picker of "Link to…", the card of a label, and the two menus (ADR-0041, ADR-0042, ADR-0044).
 */
@Component({
  selector: 'rmq-editor',
  imports: [
    TopBar,
    SimulationBar,
    MessageOverlay,
    StatusBar,
    Toolbox,
    FlowCanvas,
    Inspector,
    RenameField,
    ContextMenu,
    HintBar,
    BindingKey,
    BindingConditions,
    LinkPicker,
    LabelCard,
    CommandBar,
    HowToLinkCard,
    EventLogPanel,
    LogToggle,
    MessageInspector,
    WhatIfTester,
    WhyCard,
  ],
  providers: [
    DocumentStore,
    SelectionStore,
    StatusStore,
    CommandBus,
    CanvasSession,
    FlowViewport,
    NewNodeFocus,
    LinkFlow,
    IntentHandler,
    CommandLog,
    HowToLink,
    EditorActions,
    KeyboardService,
    CheatSheetService,
    ...RUNTIME_SERVICES,
    ...EXPLAIN_SERVICES,
  ],
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <rmq-top-bar />
      @if (simulation.enabled) {
        <rmq-simulation-bar>
          @if (explain.enabled) {
            <rmq-log-toggle [keys]="logKeys" />
          }
        </rmq-simulation-bar>
      }
      <rmq-how-to-link />
      <div class="flex min-h-0 flex-1">
        <aside class="border-line bg-panel w-52 shrink-0 overflow-y-auto border-r p-3" aria-label="Toolbox">
          <rmq-toolbox (add)="intents.add($event, 'gesture')" />
        </aside>
        <main class="bg-canvas relative min-w-0 flex-1" aria-label="Canvas">
          @if (ready()) {
            <rmq-flow-canvas
              [model]="model()"
              [selection]="selection.selection()"
              [rules]="rules()"
              [emphasis]="emphasis()"
              (intent)="onIntent($event)"
            />
          } @else {
            <p class="text-muted p-6" data-testid="opening">Opening your canvas…</p>
          }
          @if (ready() && simulation.enabled) {
            <rmq-message-overlay [pressable]="markersPressable()" (pressed)="onMarkerPressed($event)" />
          }
          @if (ready() && explainTools) {
            <rmq-why-card />
          }
          @if (ready() && model().nodes.length === 0) {
            <p
              class="text-muted pointer-events-none absolute inset-0 grid place-items-center p-8 text-center"
              data-testid="canvas-empty"
            >
              <span>
                Your canvas is empty.<br />
                Click an item in the toolbox, or drag one here, to add it.
              </span>
            </p>
          }
          @if (renaming(); as rename) {
            <rmq-rename-field
              [rect]="rename.rect"
              [value]="rename.name"
              [label]="rename.label"
              [error]="rename.error"
              (commit)="onRename($event)"
              (cancelled)="endRename()"
            />
          }
          @if (keyAsk(); as open) {
            <rmq-binding-key
              [title]="open.ask.title"
              [help]="open.ask.help"
              [topicTest]="open.test"
              [position]="open.at"
              [error]="keyError()"
              (confirm)="onKeyGiven($event)"
              (cancelled)="onKeyGivenUp($event)"
            />
          }
          @if (conditionsAsk(); as open) {
            <rmq-binding-conditions
              purpose="new"
              [title]="open.ask.title"
              [exchange]="open.ask.exchange"
              [destination]="open.ask.destination"
              [placement]="open.at"
              [error]="conditionsError()"
              (confirm)="onConditionsGiven($event)"
              (cancelled)="onConditionsGivenUp($event)"
            />
          }
          @if (picker(); as open) {
            <rmq-link-picker
              [title]="open.ask.title"
              [options]="open.ask.options"
              [reason]="open.ask.reason"
              [position]="open.at"
              (chosen)="onPicked($event)"
              (cancelled)="onPickerGivenUp($event)"
            />
          }
          @if (peek(); as card) {
            <rmq-label-card
              [title]="card.title"
              [items]="card.items"
              [position]="card.at"
              (held)="onCardHeld($event)"
            />
          }
        </main>
        <aside class="border-line bg-panel w-80 shrink-0 overflow-y-auto border-l p-3" aria-label="Inspector">
          @if (explain.enabled) {
            <rmq-message-inspector />
          }
          <rmq-inspector />
          @if (explainTools) {
            <rmq-what-if />
          }
        </aside>
      </div>
      @if (explain.enabled && explain.logOpen()) {
        <rmq-event-log-panel />
      }
      <rmq-command-bar [keys]="commandKeys" />
      <rmq-hint-bar />
      <rmq-status-bar />
      <rmq-context-menu #contextMenu (act)="onMenuAction($event)" (dismissed)="viewport.focus()" />
      <rmq-context-menu #createMenu (act)="onCreateChoice($event)" (dismissed)="viewport.focus()" />
    </div>
  `,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Editor implements IntentSurface, ActionSurface, LinkSurface {
  private readonly session = inject(CanvasSession);
  private readonly announcer = inject(Announcer);
  private readonly store = inject(DocumentStore);
  private readonly status = inject(StatusStore);
  protected readonly viewport = inject(FlowViewport);
  protected readonly selection = inject(SelectionStore);
  protected readonly intents = inject(IntentHandler);
  protected readonly keys = inject(KeyboardService);
  protected readonly simulation = inject(Simulation);
  /** What the learner asks of the canvas with the explanation: the log, and what is lit and why (ADR-0061, ADR-0062). It needs the flags `explain` and `simulation`. */
  protected readonly explain = inject(ExplainState);
  /** With the flag `headers`, the chips and the label of a headers binding say its conditions (ADR-0069, ADR-0070). */
  private readonly conditionsUi = inject(FeatureFlags).isEnabled('headers');
  /** Whether the tools of the explanation that need no events are there: the what-if tester, the topic tester, and the card that says what the tester lights. They need the flag `explain` alone (ADR-0064). */
  protected readonly explainTools = inject(FeatureFlags).isEnabled('explain');
  private readonly eventLog = inject(EventLog);
  private readonly links = inject(LinkFlow);
  private readonly actions = inject(EditorActions);
  private readonly cheatSheet = inject(CheatSheetService);
  private readonly inspector = viewChild.required(Inspector);
  private readonly commandBar = viewChild.required(CommandBar);
  private readonly overlay = viewChild(MessageOverlay);
  /** The keys that open the command bar, as the table of shortcuts says them. */
  protected readonly commandKeys = keysFor(['commands', 'commands-anywhere']);
  /** The keys that show and hide the event log. */
  protected readonly logKeys = keysFor(['event-log']);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly page = inject(DOCUMENT);

  protected readonly ready = computed(() => this.session.save().kind !== 'opening');
  private drawn = EMPTY_VM;
  protected readonly model = computed(
    () => (this.drawn = buildCanvasVm(this.store.document(), this.drawn, { conditions: this.conditionsUi })),
  );
  protected readonly rules = computed(() => linkRules(this.store.document()));
  /** Whether a press on a message that is drawn on the canvas is taken: with the explanation, while the clock is stopped, which is when a message holds still (ADR-0063). */
  protected readonly markersPressable = computed(() => this.explain.enabled && !this.simulation.running());
  /** What Why? lights, which the canvas draws as a look on the edges and the nodes (ADR-0062). */
  protected readonly emphasis = computed(() => this.explain.shown()?.emphasis ?? NO_EMPHASIS);
  private readonly intentLog: CanvasIntent[] = [];
  private readonly contextMenu = viewChild.required<ContextMenu>('contextMenu');
  private readonly createMenu = viewChild.required<ContextMenu>('createMenu');
  protected readonly renaming = signal<Renaming | null>(null);

  /** The popover that asks for a key, the picker of "Link to…" and the card of a label, whichever is open. */
  protected readonly keyAsk = signal<{ readonly ask: KeyAsk; readonly at: Point; readonly test: boolean } | null>(null);
  protected readonly keyError = signal<Issue | null>(null);
  /** The popover that asks for the conditions of a headers binding (ADR-0066), and why the last ones were refused. */
  protected readonly conditionsAsk = signal<{ readonly ask: ConditionsAsk; readonly at: Point } | null>(null);
  protected readonly conditionsError = signal<Issue | null>(null);
  protected readonly picker = signal<{ readonly ask: TargetAsk; readonly at: Point } | null>(null);
  protected readonly peek = signal<Peek | null>(null);
  private peekTimer: ReturnType<typeof setTimeout> | undefined;
  private cardHeld = false;

  constructor() {
    // The log of equivalent commands listens to the bus from the start, so that nothing that the learner does is missing from it.
    inject(CommandLog);
    void this.session.open();
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.peekTimer);
      this.session.close();
    });
    this.intents.surface = this;
    this.actions.surface = this;
    this.links.surface = this;

    if (RMQ_E2E) {
      const detach = inject(DebugSources).attach({
        document: () => this.store.document(),
        selection: () => this.selection.selection(),
        drawnEdges: () => [...this.viewport.drawn()],
        intents: () => this.intentLog,
        viewport: () => this.viewport.live(),
        simulationState: () => (this.simulation.enabled ? this.simulation.debugState() : null),
        overlayFrame: () => this.overlay()?.lastFrame() ?? null,
        explainEventLog: () => (this.explain.enabled ? this.eventLog.debugState() : null),
        explainEmphasis: () => this.explain.debugState(),
      });
      inject(DestroyRef).onDestroy(detach);
    }

    // What concerns keeping the canvas is said aloud when it happens, and not each time that it is saved.
    effect(() => {
      const state = this.session.save();
      if (state.kind === 'failed') {
        this.announcer.announce(saveText(state).text, 'assertive');
      }
    });
    effect(() => {
      const warning = this.session.quota();
      if (warning !== null) {
        // A write that failed has just been said, assertively, and a warning that interrupted it would take its place.
        const failed = untracked(() => this.session.save().kind === 'failed');
        this.announcer.announce(warning.message, warning.level === 'critical' && !failed ? 'assertive' : 'polite');
      }
    });
    effect(() => {
      const note = this.session.persistence();
      if (note !== null) {
        this.announcer.announce(note.message);
      }
    });
  }

  /**
   * A key is the editor's when it goes to something in the editor, or to nowhere: the focus is on the page itself when the control
   * that had it is switched off, such as the Undo button that has nothing left to undo, and the keys must still work then (ADR-0035).
   * It is heard on the document, in the bubble phase, after the library on the canvas has had its turn. Escape also takes away the card of a
   * label, wherever the focus is (WCAG 1.4.13).
   */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.peek() !== null) {
      this.peek.set(null);
      // A pointer that is on the card never leaves it when the card is gone, so it is not held any more.
      this.cardHeld = false;
    }
    const target = event.target;
    if (target === this.page.body || (target instanceof Node && this.element.contains(target))) {
      this.keys.handle(event);
    }
  }

  /** A press on a message that is drawn on the canvas, while the clock is stopped: it opens that message, and a shape that stands for a crowd says that it does, and where to open one (ADR-0063). */
  protected onMarkerPressed(marker: DrawnMarker): void {
    if (marker.message !== null) {
      this.explain.openMessage(marker.message);
    } else {
      this.announcer.announce(
        `This shape stands for ${marker.count} messages. Open one from the event log or from the list of a queue.`,
      );
    }
  }

  protected onIntent(intent: CanvasIntent): void {
    if (RMQ_E2E) {
      this.intentLog.push(intent);
      if (this.intentLog.length > INTENT_LOG_LIMIT) {
        this.intentLog.shift();
      }
    }
    this.intents.handle(intent);
  }

  /**
   * The menu is for what was pointed at, and only that, so that is what is selected, and what the inspector shows. A node that has
   * gone from the canvas since it was pointed at has no menu, and nor has the default exchange, which is not the document's.
   */
  openMenu(target: ContextTarget, client: Point): void {
    if (target.kind === 'node') {
      const what = this.intents.describe(target.id);
      if (what !== undefined) {
        this.selection.select([target.id]);
        const canLink = kindOf(this.store.document(), target.id) !== 'consumer';
        this.contextMenu().open({
          title: `Actions for ${what}`,
          client,
          items: contextItems(target, canLink),
          context: target,
        });
      }
    } else if (!isVirtual(target.key)) {
      this.selection.select([], [target.key]);
      this.contextMenu().open({
        title: 'Actions for this edge',
        client,
        items: contextItems(target, false),
        context: target,
      });
    }
  }

  /** Opens the command bar with the cursor in its field, for the keys that are for it (ADR-0045). */
  openCommandBar(): void {
    this.commandBar().open();
  }

  /** Opens the cheat-sheet, for the key and the button that are for it (ADR-0047). */
  openCheatSheet(): void {
    this.cheatSheet.open();
  }

  /** Shows the event log, or hides it, and says which. It answers `false` when there is none, which needs both flags, so that the key is left for the page. */
  toggleEventLog(): boolean {
    if (!this.explain.enabled) {
      return false;
    }
    this.announcer.announce(this.explain.toggleLog() ? 'Event log shown.' : 'Event log hidden.');
    return true;
  }

  /** Gives the focus to the first field of the inspector, for the key that edits what is selected. */
  focusInspector(): boolean {
    return this.inspector().focusFirst();
  }

  /** Opens the field for a name over the node, with the name selected. The default exchange has no name to change. */
  startRename(id: Id, origin: CommandOrigin = 'gesture'): void {
    const node = this.model().nodes.find((candidate) => candidate.id === id);
    const rect = node && this.viewport.onHost(node);
    if (node === undefined || node.virtual === true || !rect) {
      return;
    }
    this.renaming.set({ id, name: node.name, label: `Rename ${lowerFirst(node.label)}`, origin, rect, error: null });
  }

  /** A name is given. A refusal keeps the field open with its reason when Enter gave it, and closes it when the field was left. */
  protected onRename({ name, by }: { readonly name: string; readonly by: RenameBy }): void {
    const renaming = this.renaming();
    if (renaming === null) {
      return;
    }
    if (name === renaming.name) {
      this.endRename();
      return;
    }
    const result = this.intents.rename(renaming.id, name, renaming.origin);
    if (result === undefined || result.ok) {
      this.endRename();
    } else if (by === 'enter') {
      // The reason is under the field, so it is not also on the status line, and the bus has said it aloud.
      this.status.clearRefusalFrom(renaming.origin);
      this.renaming.set({ ...renaming, error: result.error });
    } else {
      this.endRename(false);
    }
  }

  protected endRename(focusCanvas = true): void {
    this.renaming.set(null);
    if (focusCanvas) {
      this.viewport.focus();
    }
  }

  protected onMenuAction({ id, context }: MenuChoice): void {
    const target = context as ContextTarget;
    if (id === 'rename' && target.kind === 'node') {
      this.startRename(target.id, 'menu');
    } else if (id === 'link' && target.kind === 'node') {
      this.links.openPicker(target.id, 'menu');
    } else if (id === 'delete') {
      this.intents.deleteTarget(target, 'menu');
      this.viewport.focus();
    }
  }

  // The surface of LinkFlow (ADR-0041, ADR-0042): what is shown to ask the learner something while a link is being made.

  /** Opens the popover that asks for the key of a binding, by the node that it goes to, with the cursor in it. */
  askKey(ask: KeyAsk): void {
    this.closeAsks();
    this.keyError.set(null);
    // A topic key has wildcards, and the tester of it is under the field (ADR-0064), which makes the popover taller.
    const test = this.explainTools && ask.exchangeType === 'topic';
    this.keyAsk.set({ ask, at: this.placed(ask.anchor, test ? KEY_TOPIC_SIZE : KEY_SIZE), test });
  }

  /** Opens the popover that asks for the conditions of a headers binding, by the node that it goes to, with the cursor in the first row. */
  askConditions(ask: ConditionsAsk): void {
    this.closeAsks();
    this.conditionsError.set(null);
    this.conditionsAsk.set({ ask, at: this.placed(ask.anchor, CONDITIONS_SIZE) });
  }

  /** Opens the picker of "Link to…", by the node that the link starts from. */
  askTarget(ask: TargetAsk): void {
    this.closeAsks();
    this.picker.set({ ask, at: this.placed(ask.anchor, PICKER_SIZE) });
  }

  /** Opens the menu of what a link that was let go on nothing can make, at the point where it was let go. */
  askNew(ask: CreateAsk): void {
    this.closeAsks();
    this.createMenu().open({
      title: ask.title,
      client: ask.client,
      items: ask.nodes.map((node) => {
        const entry = TOOLBOX.find((candidate) => candidate.key === newNodeKey(node));
        return {
          id: newNodeKey(node),
          label: `New ${entry?.label.toLowerCase() ?? node.kind}`,
          icon: entry?.icon ?? node.kind,
        };
      }),
      context: ask,
    });
  }

  protected onCreateChoice({ id, context }: MenuChoice): void {
    const ask = context as CreateAsk;
    const node = ask.nodes.find((candidate) => newNodeKey(candidate) === id);
    if (node !== undefined) {
      ask.choose(node);
    }
  }

  /** A key was given: the binding is made, and the popover goes. A key that is refused keeps it open, with the reason under the field. */
  protected onKeyGiven(key: string): void {
    const open = this.keyAsk();
    if (open === null) {
      return;
    }
    const result = open.ask.submit(key);
    if (result.ok) {
      this.keyAsk.set(null);
      this.keyError.set(null);
      this.viewport.focus();
    } else {
      // The reason is under the field, so it is not also on the status line, and the bus has said it aloud.
      this.status.clearRefusalFrom(open.ask.origin);
      this.keyError.set(result.error);
    }
  }

  /** The conditions were given: the binding is made, and the popover goes. Arguments that are refused keep it open, with the reason. */
  protected onConditionsGiven(headers: HeaderArguments): void {
    const open = this.conditionsAsk();
    if (open === null) {
      return;
    }
    const result = open.ask.submit(headers);
    if (result.ok) {
      this.conditionsAsk.set(null);
      this.conditionsError.set(null);
      this.viewport.focus();
    } else {
      // The reason is in the popover, so it is not also on the status line, and the bus has said it aloud.
      this.status.clearRefusalFrom(open.ask.origin);
      this.conditionsError.set(result.error);
    }
  }

  /** The popover of the conditions was given up, as the one for a key is. */
  protected onConditionsGivenUp(how: GiveUp): void {
    const open = this.conditionsAsk();
    if (open === null) {
      return;
    }
    this.conditionsAsk.set(null);
    this.conditionsError.set(null);
    open.ask.cancel();
    if (how !== 'blur') {
      this.viewport.focus();
    }
  }

  /** The popover was given up. Escape and the button give the focus back to the canvas, and the focus going elsewhere leaves it where the learner put it. */
  protected onKeyGivenUp(how: GiveUp): void {
    const open = this.keyAsk();
    if (open === null) {
      return;
    }
    this.keyAsk.set(null);
    this.keyError.set(null);
    open.ask.cancel();
    if (how !== 'blur') {
      this.viewport.focus();
    }
  }

  protected onPicked(id: Id): void {
    const open = this.picker();
    if (open !== null) {
      this.picker.set(null);
      open.ask.choose(id);
    }
  }

  protected onPickerGivenUp(how: GiveUp): void {
    const open = this.picker();
    if (open === null) {
      return;
    }
    this.picker.set(null);
    open.ask.cancel();
    if (how !== 'blur') {
      this.viewport.focus();
    }
  }

  private closeAsks(): void {
    this.keyAsk.set(null);
    this.conditionsAsk.set(null);
    this.picker.set(null);
  }

  /** Where a popover goes that is by a node: just under it, or over it when there is no room, and inside the canvas. */
  private placed(anchor: Parameters<typeof popoverPosition>[0], size: Size): Point {
    return popoverPosition(anchor, size, this.viewport.hostSize() ?? { width: 800, height: 600 });
  }

  // The card of a label (ADR-0044).

  /** Shows the whole list of what a label says while a pointer is over it, and takes it away shortly after the pointer has left, unless it is on the card. */
  showPeek(key: string | null, rect?: Point & Size): void {
    clearTimeout(this.peekTimer);
    if (key === null || rect === undefined) {
      this.peekTimer = setTimeout(() => {
        if (!this.cardHeld) {
          this.peek.set(null);
        }
      }, PEEK_GRACE_MS);
      return;
    }
    const edge = this.model().edges.find(({ id }) => id === key);
    const ends = edgeEnds(key);
    const at = this.viewport.fromClient({ x: rect.x, y: rect.y + rect.height + 4 });
    if (edge === undefined || ends === undefined || at === null) {
      return;
    }
    const document = this.store.document();
    const from = describeNode(document, ends.from) ?? ends.from;
    const to = describeNode(document, ends.to) ?? ends.to;
    this.peek.set({ title: `Bindings from ${from} to ${to}`, items: edge.cards, at });
  }

  /** The pointer is on the card, which keeps it, or has left it, which takes it away shortly. */
  protected onCardHeld(held: boolean): void {
    this.cardHeld = held;
    if (!held) {
      this.showPeek(null);
    }
  }
}
