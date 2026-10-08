import { Component, computed, effect, ElementRef, inject, signal, untracked } from '@angular/core';
import { KIND_LABEL, lookup, type DocumentCommand, type ExchangeChanges, type Issue } from '@rmq/domain';
import type { ExchangeType, HeaderArguments } from '@rmq/engine';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { EXCHANGE_TYPES } from '../canvas/model/new-node';
import { FeatureFlags } from '../core/flags/feature-flags';
import { rebindCommand, rebindHeadersCommand, unbindCommand, type BindingRow } from '../core/state/binding-commands';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { refOf } from '../core/state/refs';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { Help } from '../core/ui/help';
import { Icon } from '../core/ui/icon';
import { Switch } from '../core/ui/switch';
import { IntentHandler } from './intents';
import { BindingConditions } from './binding-conditions';
import { inspectorView, type EdgeView, type NodeView } from './inspector-view';
import { LinkFlow } from './link-flow';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { QueueAsked } from '../explain/queue-asked';
import { TopicTester } from '../explain/topic-tester';
import { ConsumerSettings } from '../simulation/consumer-settings';
import { ProducerComposer } from '../simulation/producer-composer';
import { QueueMessages } from '../simulation/queue-messages';

/** The fields that can be refused, each of which shows what it was refused for: a name such as `name` or `x`, or `binding:` and the id of a binding of an edge, which is a field of its own. */
type Field = string;

const EDGE_TITLE = {
  binding: 'Binding',
  link: 'Link from a producer',
  subscription: 'Subscription',
  implicit: 'Implicit binding',
} as const;
const EXCHANGE_TYPE_LABEL: Readonly<Record<ExchangeType, string>> = {
  direct: 'Direct',
  fanout: 'Fanout',
  topic: 'Topic',
  headers: 'Headers',
};

let nextInspector = 0;

/**
 * The inspector (ADR-0010, ADR-0032): what is selected, and the fields that change it. It shows what the document says and nothing else:
 * a change is a command, and a field that was refused goes back to the document's value and says why, under the field, in the words of
 * the refusal, with the broker's reply after them where there is one. The durable switch of a queue is the example: it cannot be
 * turned off, and it says why (ADR-0024).
 */
@Component({
  selector: 'rmq-inspector',
  imports: [
    Icon,
    Help,
    Switch,
    RefusalNotice,
    QueueAsked,
    TopicTester,
    BindingConditions,
    QueueMessages,
    ProducerComposer,
    ConsumerSettings,
  ],
  template: `
    <div class="flex flex-col gap-4" data-testid="inspector">
      @if (node(); as n) {
        <div class="flex items-center gap-2">
          <rmq-icon [name]="n.element" [size]="22" />
          <h2 class="text-base font-semibold capitalize" data-testid="inspector-title">{{ kindLabel[n.element] }}</h2>
        </div>

        <ul class="text-muted flex flex-col gap-0.5 text-sm" data-testid="inspector-joins">
          @for (line of n.joins; track line) {
            <li>{{ line }}</li>
          }
        </ul>

        @if (n.warnings.length > 0) {
          <div
            class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2 text-sm"
            data-testid="inspector-warnings"
          >
            <p class="flex items-center gap-2 font-medium"><rmq-icon name="alert" [size]="16" /> Worth a look</p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (warning of n.warnings; track warning) {
                <li>{{ warning }}</li>
              }
            </ul>
          </div>
        }

        @if (n.canLink) {
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
            data-testid="link-to"
            aria-keyshortcuts="L"
            [attr.aria-label]="'Link ' + kindLabel[n.element] + ' ' + n.name + ' to…'"
            (click)="linkFrom(n)"
          >
            <rmq-icon name="link" [size]="18" />
            Link to…
          </button>
        }

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" [for]="id('name')">Name</label>
          <input
            type="text"
            class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
            [id]="id('name')"
            [value]="n.name"
            [attr.aria-invalid]="problem('name') ? 'true' : null"
            [attr.aria-describedby]="problem('name') ? id('name-problem') : null"
            (change)="rename($event, n)"
          />
          @if (problem('name'); as issue) {
            <div [id]="id('name-problem')"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </div>

        <fieldset class="flex min-w-0 flex-col gap-1">
          <legend class="flex flex-wrap items-center gap-1 text-sm font-medium">
            Position
            <rmq-help topic="Position">
              Where the node is on the canvas. You can also drag it, or press M and use the arrow keys.
            </rmq-help>
          </legend>
          <div class="flex gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label class="text-muted text-xs" [for]="id('x')">X</label>
              <input
                type="number"
                step="10"
                class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
                [id]="id('x')"
                [value]="n.x"
                [attr.aria-invalid]="problem('x') ? 'true' : null"
                [attr.aria-describedby]="problem('x') ? id('x-problem') : null"
                (change)="place('x', $event, n)"
              />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label class="text-muted text-xs" [for]="id('y')">Y</label>
              <input
                type="number"
                step="10"
                class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
                [id]="id('y')"
                [value]="n.y"
                [attr.aria-invalid]="problem('y') ? 'true' : null"
                [attr.aria-describedby]="problem('y') ? id('y-problem') : null"
                (change)="place('y', $event, n)"
              />
            </div>
          </div>
          @if (problem('x'); as issue) {
            <div [id]="id('x-problem')"><rmq-refusal-notice [issue]="issue" /></div>
          }
          @if (problem('y'); as issue) {
            <div [id]="id('y-problem')"><rmq-refusal-notice [issue]="issue" /></div>
          }
        </fieldset>

        @if (n.exchange; as exchange) {
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-1">
              <label class="text-sm font-medium" [for]="id('type')">Type</label>
              <rmq-help topic="Type">
                How the exchange decides which queues get a message. Direct: the routing key has to match exactly.
                Fanout: every bound queue gets it. Topic: the key is matched against patterns with * and #. Headers: the
                message's headers are matched.
              </rmq-help>
            </div>
            <select
              class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
              [id]="id('type')"
              [attr.aria-invalid]="problem('type') ? 'true' : null"
              [attr.aria-describedby]="problem('type') ? id('type-problem') : null"
              (change)="setType($event, n, exchange.type)"
            >
              @for (type of exchangeTypes; track type) {
                <option [value]="type" [selected]="type === exchange.type">{{ typeLabel[type] }}</option>
              }
            </select>
            @if (problem('type'); as issue) {
              <div [id]="id('type-problem')"><rmq-refusal-notice [issue]="issue" /></div>
            }
          </div>

          @for (flag of flags; track flag.field) {
            <div class="flex flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium" [id]="id(flag.field)">{{ flag.label }}</span>
                <rmq-help [topic]="flag.label">{{ flag.help }}</rmq-help>
                <span class="ml-auto">
                  <rmq-switch
                    [checked]="exchange[flag.field]"
                    [labelledBy]="id(flag.field)"
                    [describedBy]="problem(flag.field) ? id(flag.field + '-problem') : undefined"
                    (turn)="setFlag(flag.field, $event, n)"
                  />
                </span>
              </div>
              @if (problem(flag.field); as issue) {
                <div [id]="id(flag.field + '-problem')"><rmq-refusal-notice [issue]="issue" /></div>
              }
            </div>
          }
        }

        @if (n.queue; as queue) {
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium" [id]="id('durable')">Durable</span>
              <span class="ml-auto">
                <rmq-switch
                  [checked]="queue.durable"
                  [labelledBy]="id('durable')"
                  [describedBy]="problem('durable') ? id('durable-problem') : id('durable-why')"
                  (turn)="setDurable($event, n)"
                />
              </span>
            </div>
            <p class="text-muted text-xs" [id]="id('durable-why')" data-testid="durable-why">
              It is on, and stays on: RabbitMQ 4.3 does not accept a queue that is not durable.
            </p>
            @if (problem('durable'); as issue) {
              <div [id]="id('durable-problem')" data-testid="durable-problem">
                <rmq-refusal-notice [issue]="issue" />
              </div>
            }
          </div>
        }

        @if (simulation) {
          @switch (n.element) {
            @case ('queue') {
              <rmq-queue-asked />
              <rmq-queue-messages [id]="n.id" />
            }
            @case ('producer') {
              <rmq-producer-composer [id]="n.id" />
            }
            @case ('consumer') {
              <rmq-consumer-settings [id]="n.id" />
            }
          }
        }

        <button
          type="button"
          class="border-danger text-danger hover:bg-danger-bg flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
          aria-keyshortcuts="Delete"
          [attr.aria-label]="'Delete ' + kindLabel[n.element] + ' ' + n.name"
          (click)="remove()"
        >
          <rmq-icon name="trash" [size]="18" />
          Delete
        </button>
      } @else if (isDefaultExchange()) {
        <div class="flex items-center gap-2">
          <rmq-icon name="exchange" [size]="22" />
          <h2 class="text-base font-semibold" data-testid="inspector-title">Default exchange</h2>
        </div>
        <p class="text-muted text-sm" data-testid="inspector-default">
          In RabbitMQ every virtual host has an exchange with no name. Every queue is bound to it, with the name of the
          queue as the key, so a producer that publishes to it with the key billing reaches the queue billing. The
          broker makes it and its bindings itself, so they cannot be changed or deleted.
        </p>
        <button
          type="button"
          class="border-border bg-surface hover:bg-canvas flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
          (click)="hideDefaultExchange()"
        >
          Hide the default exchange
        </button>
      } @else if (edge(); as e) {
        <div class="flex items-center gap-2">
          <rmq-icon name="link" [size]="22" />
          <h2 class="text-base font-semibold" data-testid="inspector-title">{{ edgeTitle[e.edge] }}</h2>
        </div>
        <p class="text-sm" data-testid="inspector-edge">{{ e.label }}</p>

        @if (e.edge === 'implicit') {
          <p class="text-muted text-sm" data-testid="inspector-default">
            RabbitMQ binds every queue to the default exchange, with the name of the queue as its key, so that a
            producer can publish straight to a queue. The broker makes this binding, so it cannot be changed or deleted.
          </p>
        } @else {
          @if (e.warnings.length > 0) {
            <div
              class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2 text-sm"
              data-testid="inspector-warnings"
            >
              <p class="flex items-center gap-2 font-medium"><rmq-icon name="alert" [size]="16" /> Worth a look</p>
              <ul class="mt-1 flex flex-col gap-1">
                @for (warning of e.warnings; track warning) {
                  <li>{{ warning }}</li>
                }
              </ul>
            </div>
          }

          @if (e.edge === 'binding') {
            <ul class="flex flex-col gap-3" data-testid="binding-rows">
              @for (row of e.bindings; track row.id; let index = $index) {
                <li>
                  <div
                    class="flex flex-col gap-1"
                    role="group"
                    [attr.aria-label]="'Binding ' + (index + 1) + ' of ' + e.bindings.length"
                  >
                    @if (conditionsEnds(); as ends) {
                      <rmq-binding-conditions
                        purpose="edit"
                        [title]="'Conditions of binding ' + (index + 1)"
                        [headers]="row.headers"
                        [exchange]="ends.exchange"
                        [destination]="ends.destination"
                        [key]="row.key"
                        [error]="problem('binding:' + row.id) ?? null"
                        (confirm)="applyConditions(row, $event)"
                      />
                      <button
                        type="button"
                        class="border-danger text-danger hover:bg-danger-bg flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
                        data-testid="delete-binding"
                        [attr.aria-label]="'Delete binding ' + (index + 1) + ' of ' + e.bindings.length"
                        (click)="unbind(row)"
                      >
                        <rmq-icon name="trash" [size]="18" />
                        Delete this binding
                      </button>
                    } @else {
                      <label class="text-muted text-xs" [for]="id('binding-' + row.id)">Key</label>
                      <div class="flex gap-2">
                        <input
                          type="text"
                          class="border-border bg-surface min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
                          [id]="id('binding-' + row.id)"
                          [value]="row.key"
                          [attr.aria-invalid]="problem('binding:' + row.id) ? 'true' : null"
                          [attr.aria-describedby]="
                            problem('binding:' + row.id) ? id('binding-' + row.id + '-problem') : null
                          "
                          (change)="rekey($event, row)"
                          (focus)="typing.set({ id: row.id, text: row.key })"
                          (input)="typeKey($event, row)"
                          (blur)="stopTyping(row.id)"
                        />
                        <button
                          type="button"
                          class="border-danger text-danger hover:bg-danger-bg flex items-center justify-center rounded-md border px-2"
                          [attr.aria-label]="
                            row.key === ''
                              ? 'Delete the binding with an empty key'
                              : 'Delete the binding with key ' + row.key
                          "
                          (click)="unbind(row)"
                        >
                          <rmq-icon name="trash" [size]="18" />
                        </button>
                      </div>
                      @if (row.hasArguments) {
                        <p class="text-muted text-xs" data-testid="binding-headers">
                          This binding has header arguments, which are written with the command bar for now.
                        </p>
                      }
                      @if (problem('binding:' + row.id); as issue) {
                        <div [id]="id('binding-' + row.id + '-problem')"><rmq-refusal-notice [issue]="issue" /></div>
                      }
                      @if (testsKeys(e) && typing()?.id === row.id) {
                        <rmq-topic-tester [pattern]="typing()?.text ?? ''" />
                      }
                    }
                  </div>
                </li>
              }
            </ul>
            <button
              type="button"
              class="border-border bg-surface hover:bg-canvas flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
              data-testid="add-binding"
              (click)="addBinding(e)"
            >
              <rmq-icon name="plus" [size]="18" />
              Add another binding
            </button>
          }

          @if (e.edge === 'link') {
            <button
              type="button"
              class="border-border bg-surface hover:bg-canvas flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
              data-testid="change-target"
              (click)="changeTarget(e)"
            >
              <rmq-icon name="link" [size]="18" />
              Change the target of this link…
            </button>
          }

          @if (e.movable) {
            <div class="flex flex-col gap-1">
              <div class="flex flex-wrap items-center gap-1">
                <label class="text-sm font-medium" [for]="id('label')">Label position (percent along the edge)</label>
                <rmq-help topic="Label position">
                  Where the label of this edge sits, from 0 at the start of the edge, where the message leaves, to 100
                  at its end. You can also drag the label along the edge. Left empty, the label is placed where it does
                  not meet another.
                </rmq-help>
              </div>
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
                [id]="id('label')"
                [value]="e.labelPercent === null ? '' : e.labelPercent"
                [attr.aria-invalid]="problem('label') ? 'true' : null"
                [attr.aria-describedby]="problem('label') ? id('label-problem') : null"
                (change)="moveLabel($event, e)"
              />
              @if (problem('label'); as issue) {
                <div [id]="id('label-problem')"><rmq-refusal-notice [issue]="issue" /></div>
              }
            </div>
          }

          <button
            type="button"
            class="border-danger text-danger hover:bg-danger-bg flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-keyshortcuts="Delete"
            [attr.aria-label]="'Delete this ' + edgeTitle[e.edge].toLowerCase()"
            (click)="remove()"
          >
            <rmq-icon name="trash" [size]="18" />
            Delete
          </button>
        }
      } @else if (several(); as count) {
        <h2 class="text-base font-semibold" data-testid="inspector-title">{{ count }} items selected</h2>
        <p class="text-muted text-sm">Select one node or one edge to change it here.</p>
        <button
          type="button"
          class="border-danger text-danger hover:bg-danger-bg flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium"
          aria-keyshortcuts="Delete"
          (click)="remove()"
        >
          <rmq-icon name="trash" [size]="18" />
          Delete {{ count }} items
        </button>
      } @else {
        <h2 class="text-base font-semibold" data-testid="inspector-title">Inspector</h2>
        <p class="text-muted text-sm" data-testid="inspector-empty">
          Nothing is selected. Click a node or an edge, or add something from the toolbox, to see it and change it here.
        </p>
      }
    </div>
  `,
  host: { '(keydown.escape)': 'leave($event)' },
})
export class Inspector {
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly status = inject(StatusStore);
  private readonly bus = inject(CommandBus);
  private readonly intents = inject(IntentHandler);
  private readonly links = inject(LinkFlow);
  private readonly viewport = inject(FlowViewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The parts of the inspector that the simulation adds are there only with its flag (ADR-0056). */
  protected readonly simulation = inject(FeatureFlags).isEnabled('simulation');
  /** The tester of a topic key, under the field that is typed in, needs the flag of the explanation alone (ADR-0064). */
  private readonly explainTools = inject(FeatureFlags).isEnabled('explain');
  /** The key field of a binding that is being typed in, and what is typed in it, which the tester follows before the key is changed (it is changed when the field is left). */
  protected readonly typing = signal<{ readonly id: string; readonly text: string } | null>(null);
  private readonly uid = `rmq-inspector-${nextInspector++}`;

  protected readonly kindLabel = KIND_LABEL;
  protected readonly edgeTitle = EDGE_TITLE;
  protected readonly typeLabel = EXCHANGE_TYPE_LABEL;
  protected readonly exchangeTypes = EXCHANGE_TYPES;
  protected readonly flags = [
    {
      field: 'durable',
      label: 'Durable',
      help: 'A durable exchange is still there after the broker restarts.',
    },
    {
      field: 'autoDelete',
      label: 'Auto-delete',
      help: 'The exchange goes away when the last queue or exchange is unbound from it.',
    },
    {
      field: 'internal',
      label: 'Internal',
      help: 'Producers cannot publish to an internal exchange. Only another exchange can send messages to it.',
    },
  ] as const;

  private readonly view = computed(() => inspectorView(this.store.document(), this.selection.selection()));
  protected readonly node = computed<NodeView | null>(() => {
    const view = this.view();
    return view.kind === 'node' ? view : null;
  });
  protected readonly edge = computed<EdgeView | null>(() => {
    const view = this.view();
    return view.kind === 'edge' ? view : null;
  });
  protected readonly isDefaultExchange = computed(() => this.view().kind === 'default-exchange');
  protected readonly several = computed(() => {
    const view = this.view();
    return view.kind === 'several' ? view.count : 0;
  });

  /**
   * The two ends of the bindings of the selected edge, by name, when they are edited with the editor of the conditions: the edge is a binding from a headers exchange. It is one object until the
   * document or the selection changes, because it is an input of the editor.
   */
  protected readonly conditionsEnds = computed(() => {
    const edge = this.edge();
    if (edge === null) {
      return null;
    }
    const document = this.store.document();
    const exchange = lookup(document.exchanges, edge.from);
    const to = refOf(document, edge.to);
    if (exchange?.type !== 'headers' || to === undefined) {
      return null;
    }
    return { exchange: exchange.name, destination: { kind: to.kind as 'queue' | 'exchange', name: to.name } };
  });

  /** What each field was refused for, until something else is selected or changed. */
  private readonly problems = signal<Readonly<Partial<Record<Field, Issue>>>>({});

  constructor() {
    // A refusal belongs to what was selected when it was made.
    effect(() => {
      this.selection.selection();
      untracked(() => {
        this.problems.set({});
        this.status.clearRefusalFrom('inspector');
      });
    });
  }

  protected id(part: string): string {
    return `${this.uid}-${part}`;
  }

  protected problem(field: Field): Issue | undefined {
    return this.problems()[field];
  }

  /** Puts the focus on the first control, for the key that edits the selection (ADR-0035). It answers whether there was one. */
  focusFirst(): boolean {
    // A field first, which is what the key means to edit, and a button when there is none.
    const control =
      this.host.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      this.host.querySelector<HTMLElement>('input, select') ??
      this.host.querySelector<HTMLElement>('button');
    control?.focus();
    return control !== null;
  }

  protected rename(event: Event, node: NodeView): void {
    const input = event.target as HTMLInputElement;
    if (input.value === node.name) {
      this.problems.set({});
      return;
    }
    const target = { kind: node.element, name: node.name };
    if (!this.apply('name', { type: 'rename', target, name: input.value })) {
      input.value = node.name;
    }
  }

  protected place(axis: 'x' | 'y', event: Event, node: NodeView): void {
    const input = event.target as HTMLInputElement;
    const text = input.value.trim();
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) {
      this.refuse(axis, `${axis.toUpperCase()} has to be a number. The node stays where it is.`);
      input.value = String(node[axis]);
      return;
    }
    if (value === node[axis]) {
      this.problems.set({});
      return;
    }
    const target = { kind: node.element, name: node.name };
    const command: DocumentCommand =
      axis === 'x' ? { type: 'move', target, x: value } : { type: 'move', target, y: value };
    if (!this.apply(axis, command)) {
      input.value = String(node[axis]);
    }
  }

  protected setType(event: Event, node: NodeView, current: ExchangeType): void {
    const select = event.target as HTMLSelectElement;
    const exchangeType = select.value as ExchangeType;
    if (!this.apply('type', { type: 'set', kind: 'exchange', name: node.name, changes: { exchangeType } })) {
      select.value = current;
    }
  }

  protected setFlag(field: 'durable' | 'autoDelete' | 'internal', value: boolean, node: NodeView): void {
    const changes: ExchangeChanges =
      field === 'durable' ? { durable: value } : field === 'autoDelete' ? { autoDelete: value } : { internal: value };
    this.apply(field, { type: 'set', kind: 'exchange', name: node.name, changes });
  }

  protected setDurable(value: boolean, node: NodeView): void {
    this.apply('durable', { type: 'set', kind: 'queue', name: node.name, changes: { durable: value } });
  }

  protected remove(): void {
    this.intents.deleteSelected('inspector');
  }

  /** Opens the picker for the node that is shown, which is the button that does what `L` does on the canvas (ADR-0041). */
  protected linkFrom(node: NodeView): void {
    this.links.openPicker(node.id, 'inspector');
  }

  /** Another binding between the same two ends: it goes through the one function that makes a link, so it asks for its key as the other ways do. */
  protected addBinding(edge: EdgeView): void {
    this.links.request(edge.from, edge.to, 'inspector');
  }

  /** A producer links again: to another target, through the picker. */
  protected changeTarget(edge: EdgeView): void {
    this.links.openPicker(edge.from, 'inspector');
  }

  /** Whether the tester of a topic key is offered for the bindings of this edge: with the flag, and when the edge starts from a topic exchange. */
  protected testsKeys(edge: EdgeView): boolean {
    return this.explainTools && lookup(this.store.document().exchanges, edge.from)?.type === 'topic';
  }

  protected typeKey(event: Event, row: BindingRow): void {
    this.typing.set({ id: row.id, text: (event.target as HTMLInputElement).value });
  }

  /** The field is left, so the tester under it goes, unless the learner has already gone to another field, which has its own. */
  protected stopTyping(id: string): void {
    if (this.typing()?.id === id) {
      this.typing.set(null);
    }
  }

  /** A binding gets another key, as an unbind and a bind in one step. A key that is refused puts the old one back and says why under the field. */
  protected rekey(event: Event, row: BindingRow): void {
    const input = event.target as HTMLInputElement;
    const command = rebindCommand(this.store.document(), row.id, input.value);
    if (command === undefined) {
      this.problems.set({});
      input.value = row.key;
      return;
    }
    if (!this.apply(`binding:${row.id}`, command)) {
      input.value = row.key;
    }
  }

  /** A binding gets other conditions, as an unbind and a bind in one step. A refusal is shown by the editor; two bindings that come to be the same are one, and the learner is told. */
  protected applyConditions(row: BindingRow, headers: HeaderArguments): void {
    const before = this.store.document();
    const command = rebindHeadersCommand(before, row.id, headers);
    if (command === undefined) {
      this.problems.set({});
      return;
    }
    if (this.apply('binding:' + row.id, command) && bindingCount(this.store.document()) < bindingCount(before)) {
      this.bus.say('That is the same as another binding between these nodes, so there is one now.');
    }
  }

  protected unbind(row: BindingRow): void {
    const command = unbindCommand(this.store.document(), row.id);
    if (command !== undefined) {
      this.apply(`binding:${row.id}`, command);
    }
  }

  /** The label of the edge is put somewhere along it, as a percentage of its length, which is how it is moved without dragging (WCAG 2.5.7). */
  protected moveLabel(event: Event, edge: EdgeView): void {
    const input = event.target as HTMLInputElement;
    const text = input.value.trim();
    const percent = Number(text);
    const back = edge.labelPercent === null ? '' : String(edge.labelPercent);
    if (text === '' || !Number.isFinite(percent)) {
      this.refuse('label', 'The place of a label has to be a number from 0 to 100. It stays where it is.');
      input.value = back;
      return;
    }
    const document = this.store.document();
    const from = refOf(document, edge.from);
    const to = refOf(document, edge.to);
    if (from === undefined || to === undefined) {
      return;
    }
    if (!this.apply('label', { type: 'move-label', from, to, at: percent / 100 })) {
      input.value = back;
    }
  }

  protected hideDefaultExchange(): void {
    this.bus.apply({ type: 'set', kind: 'canvas', changes: { showDefaultExchange: false } }, 'inspector');
  }

  /** Escape leaves the inspector for the canvas, and what was typed and not kept is dropped (ADR-0017). */
  protected leave(event: Event): void {
    event.preventDefault();
    this.problems.set({});
    this.viewport.focus();
  }

  /** Applies a command for a field. A refusal is kept for that field, and answers `false`. */
  private apply(field: Field, command: DocumentCommand): boolean {
    const result = this.bus.apply(command, 'inspector');
    this.problems.set(result.ok ? {} : { [field]: result.error });
    return result.ok;
  }

  private refuse(field: Field, message: string): void {
    this.problems.set({ [field]: { kind: 'invalid-value', message } });
  }
}

/** How many bindings the document has, which is how an edit that made two bindings one is known. */
const bindingCount = (document: ReturnType<DocumentStore['document']>): number => Object.keys(document.bindings).length;
