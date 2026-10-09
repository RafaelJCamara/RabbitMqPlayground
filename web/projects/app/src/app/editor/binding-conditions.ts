import {
  afterNextRender,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import {
  formatCommand,
  draftOf,
  headersLint,
  newDraft,
  problemAt,
  reportDraft,
  sameHeaders,
  type BindCommand,
  type DraftRow,
  type HeadersDraft,
  type Issue,
} from '@rmq/domain';
import type { HeaderArguments, XMatch } from '@rmq/engine';
import { lowerFirst } from '../canvas/model/labels';
import type { Placement } from '../canvas/model/transform';
import { Announcer } from '../core/announcer';
import { DocumentStore } from '../core/state/document-store';
import { HeaderRows } from '../core/ui/header-rows';
import { Icon } from '../core/ui/icon';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { Segmented, type Segment } from '../core/ui/segmented';
import { HeadersLive } from '../explain/headers-live';
import type { GiveUp } from './binding-key';

let nextEditor = 0;

const MODES: readonly Segment[] = (['all', 'any', 'all-with-x', 'any-with-x'] as const).map((value) => ({
  value,
  label: value,
}));

/** What each mode does, in a sentence under the control (ADR-0009). */
const MODE_HELP: Readonly<Record<XMatch, string>> = {
  all: 'Every condition has to hold. Arguments that start with x- are not counted.',
  any: 'At least one condition has to hold. Arguments that start with x- are not counted.',
  'all-with-x': 'Every condition has to hold, and the arguments that start with x- count too.',
  'any-with-x': 'At least one condition has to hold, and the arguments that start with x- count too.',
};

const LEFT_OUT = ' This binding leaves x-match out, which a broker reads as all.';

const EXPORT_NOTE =
  'A condition that only asks for the header to be there cannot be written to definitions.json, because RabbitMQ rejects a JSON null as an argument value. The export will leave this binding out and list it.';

/**
 * The editor of the conditions of a headers binding (ADR-0066, ADR-0067, ADR-0068): the mode of `x-match`, and a row for each condition, with the type of each, what is wrong with it and what to know about it, the sentence of
 * what the binding asks, the lint, the table of recent messages, and the line that a learner would type. It holds a draft and changes nothing: "Bind", for a binding that is being made, and "Apply", for one that is there, say
 * the arguments through `confirm` if the draft has no problem, and say the first problem, and put the cursor in it, if it has. They are never switched off. As a popover (it is given a `placement`) it gives up on Escape, on "Cancel" and when
 * the focus leaves it, and its root takes the focus, so that a click on text inside it is not leaving. In the inspector it is a part of the page, and "Revert" gives back what the document has.
 */
@Component({
  selector: 'rmq-binding-conditions',
  imports: [HeaderRows, Segmented, RefusalNotice, Icon, HeadersLive],
  template: `
    <form class="flex flex-col gap-3" data-testid="conditions-form" (submit)="give($event)">
      @if (placement()) {
        <h2 class="text-sm font-semibold" data-testid="conditions-title">{{ title() }}</h2>
      }

      <div class="flex flex-col gap-1">
        <rmq-segmented
          legend="x-match"
          [options]="modes"
          [value]="xMatch()"
          [describedBy]="modeId"
          (chosen)="chooseMode($event)"
        />
        <p class="text-muted text-xs" [id]="modeId" data-testid="conditions-mode">{{ modeHelp() }}</p>
      </div>

      <rmq-header-rows
        [rows]="draft().rows"
        [reports]="report().rows"
        [allowExists]="true"
        noun="condition"
        label="Conditions"
        (rowsChange)="setRows($event)"
      />

      <p class="text-sm" data-testid="conditions-sentence">{{ report().sentence }}</p>

      @if (report().hasExists) {
        <p class="text-muted text-xs" data-testid="conditions-export">{{ exportNote }}</p>
      }
      @if (key() !== '') {
        <p class="text-muted text-xs" data-testid="conditions-key">
          Its key, {{ key() }}, is not read by a headers exchange.
        </p>
      }
      @if (lint(); as warning) {
        <div
          class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2 text-sm"
          data-testid="conditions-lint"
        >
          <p class="flex items-center gap-2 font-medium"><rmq-icon name="alert" [size]="16" /> Worth a look</p>
          <p class="mt-1">{{ warning }}</p>
        </div>
      }
      @if (countProblem(); as issue) {
        <div data-testid="conditions-problem"><rmq-refusal-notice [issue]="issue" /></div>
      }
      @if (refusal(); as issue) {
        <div data-testid="conditions-refusal"><rmq-refusal-notice [issue]="issue" /></div>
      }

      <rmq-headers-live [headers]="report().headers" [exchange]="exchange()" [about]="about()" />

      @if (line(); as text) {
        <p class="text-muted text-xs">
          As a command:
          <code class="font-mono break-all" data-testid="conditions-line">{{ text }}</code>
        </p>
      }

      <div class="flex gap-2">
        <button
          type="submit"
          class="bg-accent text-accent-fg rounded-md px-3 py-1.5 font-medium hover:opacity-90"
          data-testid="conditions-submit"
        >
          {{ purpose() === 'new' ? 'Bind' : 'Apply' }}
        </button>
        @if (purpose() === 'new') {
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas rounded-md border px-3 py-1.5"
            data-testid="conditions-cancel"
            (click)="cancelled.emit('button')"
          >
            Cancel
          </button>
        } @else {
          <button
            type="button"
            class="border-border bg-surface hover:bg-canvas rounded-md border px-3 py-1.5"
            data-testid="conditions-revert"
            (click)="revert()"
          >
            Revert
          </button>
        }
      </div>
    </form>
  `,
  host: {
    '[class]': 'hostClass()',
    '[style.left.px]': 'placement()?.x',
    '[style.top.px]': 'placement()?.y',
    '[style.max-height]': 'maxHeight()',
    '[attr.role]': "placement() ? 'group' : null",
    '[attr.aria-label]': 'placement() ? title() : null',
    '[attr.tabindex]': 'placement() ? -1 : null',
    'data-testid': 'binding-conditions',
    '(focusout)': 'leave($event)',
    '(keydown.escape)': 'escape($event)',
  },
})
export class BindingConditions {
  /** `new` is a binding that is being made, `edit` one that is there. */
  readonly purpose = input<'new' | 'edit'>('new');
  /** What it is for, in words: `Conditions for the binding from exchange docs to queue pdf`. */
  readonly title = input.required<string>();
  /** The arguments of the binding that is edited. A binding that is being made has none. */
  readonly headers = input<HeaderArguments | undefined>();
  /** The exchange that the binding starts from, and what it goes to, by name: for the table of messages, the lint and the line. */
  readonly exchange = input.required<string>();
  readonly destination = input.required<BindCommand['destination']>();
  /** The key of the binding, which a headers exchange does not read, and which the line then keeps. */
  readonly key = input('');
  /** Why the owner refused the arguments that were given, to show until something is changed. */
  readonly error = input<Issue | null>(null);
  /** Where the popover is, measured from the top left of the canvas, and how tall it may be there. Left out, it is a part of the page. */
  readonly placement = input<Placement | null>(null);

  /** The arguments, when the draft has no problem. */
  readonly confirm = output<HeaderArguments>();
  /** A popover was given up: with Escape or its button, or by the focus going elsewhere, which the learner may not have meant. */
  readonly cancelled = output<GiveUp>();

  private readonly store = inject(DocumentStore);
  private readonly announcer = inject(Announcer);
  private readonly rowsView = viewChild.required(HeaderRows);

  private readonly uid = `rmq-conditions-${nextEditor++}`;
  protected readonly modeId = `${this.uid}-mode`;
  protected readonly modes = MODES;
  protected readonly exportNote = EXPORT_NOTE;

  /** What is typed. It starts from the binding, and starts again when the binding changes. */
  protected readonly draft = linkedSignal<HeadersDraft>(() =>
    this.purpose() === 'new' ? newDraft() : draftOf(this.headers()),
  );
  protected readonly report = computed(() => reportDraft(this.draft()));
  /** What the table of recent messages is about, in the words of the title, which tell this binding from another one of the same edge: the title of an editor in the inspector says which one it is. */
  protected readonly about = computed(() => lowerFirst(this.title()));
  protected readonly xMatch = computed<XMatch>(() => this.draft().xMatch ?? 'all');
  protected readonly modeHelp = computed(
    () => `${MODE_HELP[this.xMatch()]}${this.draft().xMatch === null ? LEFT_OUT : ''}`,
  );
  protected readonly lint = computed(() =>
    headersLint(this.exchange(), this.destination().name, this.report().headers),
  );
  /** A problem of the whole draft that no row owns: too many rows. */
  protected readonly countProblem = computed(() => (problemAt(this.report()) === null ? this.report().problem : null));

  /** The line that the learner would type, when the draft has no problem. */
  protected readonly line = computed(() => {
    const report = this.report();
    if (!report.ok) {
      return null;
    }
    const command: BindCommand = {
      type: 'bind',
      source: this.exchange(),
      destination: this.destination(),
      key: this.key(),
      headers: report.headers,
    };
    return formatCommand(command, this.store.document());
  });

  /** The draft that was typed when the owner refused, so that a refusal is shown until something is changed, and not after. */
  private readonly refusedDraft = linkedSignal<HeadersDraft | null>(() => {
    this.error();
    return untracked(this.draft);
  });
  protected readonly refusal = computed(() => (this.refusedDraft() === this.draft() ? this.error() : null));

  protected readonly hostClass = computed(() =>
    this.placement() === null
      ? 'block'
      : 'border-border bg-panel text-fg absolute z-10 w-[28rem] max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border p-3 text-sm shadow-lg',
  );
  /** As tall as 32rem, and no taller than the room that is left under the popover: it scrolls inside itself when its rows are more. */
  protected readonly maxHeight = computed(() => {
    const placement = this.placement();
    return placement === null ? null : `min(32rem, ${placement.maxHeight}px)`;
  });

  constructor() {
    // A popover opens with the cursor in the name of its first row (ADR-0041).
    afterNextRender(() => {
      if (this.placement() !== null) {
        this.rowsView().focus(0, 'key');
      }
    });
  }

  protected chooseMode(value: string): void {
    this.draft.update((draft) => ({ ...draft, xMatch: value as XMatch }));
  }

  protected setRows(rows: readonly DraftRow[]): void {
    this.draft.update((draft) => ({ ...draft, rows }));
  }

  protected revert(): void {
    this.draft.set(draftOf(this.headers()));
    this.announcer.announce('Reverted to the binding as it is.');
  }

  /** "Bind" and "Apply" answer: the arguments, if the draft has no problem, and else the first problem, and the cursor is put in it. */
  protected give(event: Event): void {
    event.preventDefault();
    const report = this.report();
    if (!report.ok) {
      const at = problemAt(report);
      this.announcer.announce((report.problem as Issue).message, 'assertive');
      if (at !== null) {
        this.rowsView().focus(at.row, at.field);
      }
      return;
    }
    if (this.purpose() === 'edit' && sameHeaders(report.headers, this.headers())) {
      this.announcer.announce('No changes.');
      return;
    }
    this.confirm.emit(report.headers);
  }

  protected escape(event: Event): void {
    if (this.placement() !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit('escape');
    }
  }

  /** The focus going anywhere outside a popover gives up. Inside it, to its own controls or to its own text, it stays. */
  protected leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (this.placement() !== null && !(next instanceof Node && (event.currentTarget as HTMLElement).contains(next))) {
      this.cancelled.emit('blur');
    }
  }
}
