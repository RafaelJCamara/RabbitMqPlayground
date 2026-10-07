import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { EventLog, LOG_CAP } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
import { FAMILIES, infoOf, type Family } from '../core/explain/families';
import { isFiltering, nodeKey, type LogRow } from '../core/explain/log-row';
import { atBottom, scrollFor, windowOf } from '../core/explain/window';
import { DocumentStore } from '../core/state/document-store';
import { Icon } from '../core/ui/icon';

/** The height of a row before the first one is measured, in pixels: a line of text, and room round it (1.75rem). */
const ROW_HEIGHT = 28;

const FIELD = 'border-border bg-surface min-h-7 rounded-md border px-1.5 py-0.5';
/** A family that is shown has the thick border of the text, and one that is left out has the border of a control and the lighter text: the state is in the shape and in `aria-pressed`, and not in a colour. */
const FAMILY_BUTTON =
  'border-border bg-panel text-muted hover:bg-canvas aria-pressed:border-fg aria-pressed:bg-surface aria-pressed:text-fg flex min-h-7 items-center gap-1 rounded-md border-2 px-2 py-0';
const BUTTON = 'border-border bg-surface hover:bg-canvas flex min-h-7 items-center gap-1 rounded-md border px-2 py-0.5';
const ROW =
  'flex h-7 cursor-pointer items-center gap-2 border-l-4 border-transparent px-3 hover:bg-canvas aria-selected:border-accent aria-selected:bg-panel aria-selected:font-semibold data-[active=true]:group-focus-visible:outline-2 data-[active=true]:group-focus-visible:-outline-offset-2 data-[active=true]:group-focus-visible:outline-focus';

const rowId = (seq: number): string => `rmq-log-row-${seq}`;

/** A row, with its place in the list that is shown. */
interface Item {
  readonly row: LogRow;
  readonly index: number;
}

const KINDS: Readonly<Record<string, string>> = {
  exchange: 'Exchange',
  queue: 'Queue',
  producer: 'Producer',
  consumer: 'Consumer',
};

/**
 * The event log (ADR-0061): the events of the engine and the lines of the commands, in the order that they happened, each with its time, the mark and the colour of its family, the name of the event as a word and its
 * sentence. It is a region of the page with a name, at the bottom of the editor, and its list is one stop for the keyboard, a listbox that points at the row that the arrow keys are on with
 * `aria-activedescendant`. Only the rows that the scroll shows are in the page, and the spaces over and under them make the scrollbar the size of the whole list, so that a burst costs the work of the screen
 * and not of the log. It follows the newest row while the scroll is at the end, and stays where the learner scrolled to. It decides nothing about the canvas: choosing a row tells the state of the explanation, which
 * lights what the row is about and opens its message.
 */
@Component({
  selector: 'rmq-event-log-panel',
  imports: [Icon],
  template: `
    <section
      id="event-log"
      class="border-line bg-panel border-t text-sm"
      aria-labelledby="event-log-title"
      data-testid="event-log"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-1.5">
        <h2 #heading id="event-log-title" tabindex="-1" class="font-semibold">Event log</h2>
        <p class="text-muted tabular-nums" data-testid="event-log-count">{{ countText() }}</p>
        <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Kinds of events to show">
          @for (family of families; track family.id) {
            <button
              type="button"
              [class]="familyButton"
              [attr.aria-pressed]="isOn(family.id)"
              [attr.data-family]="family.id"
              (click)="toggleFamily(family.id)"
            >
              <rmq-icon [name]="family.icon" [size]="14" [style.color]="'var(' + family.token + ')'" />
              <span>{{ family.label }}</span>
            </button>
          }
        </div>
        <label class="flex items-center gap-1.5">
          <span class="text-muted">Node</span>
          <select [class]="field" data-testid="event-log-node" (change)="setNode($event)">
            <option value="" [selected]="filter().node === null">All nodes</option>
            @for (option of nodeOptions(); track option.key) {
              <option [value]="option.key" [selected]="option.key === filter().node">{{ option.label }}</option>
            }
          </select>
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-muted">Message</span>
          <input
            type="number"
            min="1"
            inputmode="numeric"
            placeholder="any"
            [class]="field + ' w-20'"
            data-testid="event-log-message"
            [value]="filter().message ?? ''"
            (input)="setMessage($event)"
            (change)="announceShown()"
          />
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-muted">Search</span>
          <input
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="words in the sentence"
            [class]="field + ' w-48'"
            data-testid="event-log-search"
            [value]="filter().text"
            (input)="setText($event)"
            (change)="announceShown()"
          />
        </label>
        @if (filtering()) {
          <button type="button" [class]="button" data-testid="event-log-clear" (click)="clearFilters()">
            Clear filters
          </button>
        }
        @if (!following() && rows().length > 0) {
          <button type="button" [class]="button" data-testid="event-log-latest" (click)="goToLatest()">
            Go to the newest
          </button>
        }
        <button type="button" [class]="button + ' ml-auto'" data-testid="event-log-close" (click)="close()">
          <rmq-icon name="close" [size]="14" />
          <span>Close</span>
        </button>
      </div>
      @if (log.dropped() > 0) {
        <p class="text-muted px-4 pb-1" data-testid="event-log-dropped">{{ droppedText() }}</p>
      }
      @if (rows().length > 0) {
        <div
          #list
          role="listbox"
          tabindex="0"
          aria-label="Events"
          class="group bg-surface border-line h-36 [overflow-anchor:none] overflow-y-auto border-t"
          data-testid="event-log-list"
          [attr.aria-activedescendant]="activeId()"
          (scroll)="onScroll()"
          (focus)="onFocus()"
          (keydown)="onKeydown($event)"
          (click)="onClick($event)"
        >
          <!-- The spaces over and under the rows that are drawn are the padding of what holds them and not of the list, because a list that has a height of its own is not smaller than its padding. -->
          <div
            role="presentation"
            data-testid="event-log-rows"
            [style.padding-top.px]="part().before"
            [style.padding-bottom.px]="part().after"
          >
            @for (item of visible(); track item.row.seq) {
              <div
                role="option"
                [class]="rowClass"
                [id]="rowId(item.row.seq)"
                [attr.aria-selected]="item.row.seq === explain.chosenRow()"
                [attr.aria-posinset]="item.index + 1"
                [attr.aria-setsize]="rows().length"
                [attr.data-active]="item.row.seq === active()"
                [attr.data-seq]="item.row.seq"
                [attr.data-family]="item.row.family"
                [attr.data-kind]="item.row.kind"
                data-testid="event-log-row"
              >
                <rmq-icon
                  [name]="info(item.row).icon"
                  [size]="14"
                  [style.color]="'var(' + info(item.row).token + ')'"
                />&ngsp;
                <span class="text-muted w-20 shrink-0 text-right tabular-nums">{{ time(item.row.at) }} s</span>&ngsp;
                <span class="w-32 shrink-0 font-mono text-xs">{{ item.row.kind }}</span
                >&ngsp;
                <span
                  class="min-w-0 flex-1 truncate"
                  [class.font-mono]="item.row.kind === 'command'"
                  [attr.title]="item.row.text"
                  >{{ item.row.text }}</span
                >
              </div>
            }
          </div>
        </div>
      } @else {
        <div
          class="bg-surface border-line text-muted flex h-36 flex-col items-center justify-center gap-2 border-t px-4 text-center"
          data-testid="event-log-empty"
        >
          @if (log.count() === 0) {
            <p>Nothing has happened yet. Publish a message from a producer, or play the simulation.</p>
          } @else {
            <p>No event matches the filters.</p>
            <button type="button" [class]="button + ' text-fg'" (click)="clearFilters()">Clear filters</button>
          }
        </div>
      }
    </section>
  `,
})
export class EventLogPanel {
  protected readonly log = inject(EventLog);
  protected readonly explain = inject(ExplainState);
  private readonly store = inject(DocumentStore);
  private readonly announcer = inject(Announcer);
  private readonly viewport = inject(FlowViewport);
  private readonly injector = inject(Injector);

  protected readonly families = FAMILIES;
  protected readonly field = FIELD;
  protected readonly familyButton = FAMILY_BUTTON;
  protected readonly button = BUTTON;
  protected readonly rowClass = ROW;
  protected readonly rowId = rowId;

  protected readonly filter = this.log.filter;
  protected readonly rows = this.log.shown;
  protected readonly filtering = computed(() => isFiltering(this.filter()));

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  /** How far the list is scrolled, how tall it is, and how tall a row is, as they were last read from the page. */
  private readonly scrolled = signal(0);
  private readonly height = signal(0);
  private readonly rowHeight = signal(ROW_HEIGHT);
  /** Whether the list follows the newest row, which it does while it is scrolled to its end. */
  protected readonly following = signal(true);
  /** The row that the learner put the arrow keys on, by its number, or `null` when they have not. */
  private readonly picked = signal<number | null>(null);
  /** The row that the arrow keys are on: the one that was picked, while it is in the list that is shown, and else the newest one while the list follows it. */
  protected readonly active = computed<number | null>(() => {
    const picked = this.picked();
    if (picked !== null && this.indexOf(picked) >= 0) {
      return picked;
    }
    const rows = this.rows();
    return this.following() ? (rows[rows.length - 1]?.seq ?? null) : null;
  });

  /** Where the list is scrolled to: the end, while it follows the newest row, and else where the learner left it. */
  private readonly top = computed(() =>
    this.following() ? Math.max(0, this.rows().length * this.rowHeight() - this.height()) : this.scrolled(),
  );
  protected readonly part = computed(() => windowOf(this.rows().length, this.rowHeight(), this.top(), this.height()));
  /** The rows that are in the page. */
  protected readonly visible = computed<readonly Item[]>(() => {
    const { start, end } = this.part();
    return this.rows()
      .slice(start, end)
      .map((row, offset) => ({ row, index: start + offset }));
  });
  /** The row that `aria-activedescendant` names, when it is in the page: a row that the scroll has left has no element to point at. */
  protected readonly activeId = computed(() => {
    const seq = this.active();
    return seq !== null && this.visible().some(({ row }) => row.seq === seq) ? rowId(seq) : null;
  });

  protected readonly countText = computed(() => {
    const total = this.log.count();
    if (total === 0) {
      return 'No events yet';
    }
    return this.filtering() ? `Showing ${count(this.rows().length)} of ${events(total)}` : events(total);
  });
  protected readonly droppedText = computed(
    () =>
      `${count(this.log.dropped())} earlier ${this.log.dropped() === 1 ? 'event was' : 'events were'} dropped: the log keeps the last ${count(LOG_CAP)}.`,
  );

  /** The nodes of the canvas that the filter can ask about, and the one that it asks about when it has since gone. */
  protected readonly nodeOptions = computed(() => {
    const document = this.store.document();
    const options: { key: string; label: string }[] = [
      ...Object.values(document.exchanges).map(({ name }) => ({
        key: nodeKey('exchange', name),
        label: `Exchange ${name}`,
      })),
      ...Object.values(document.queues).map(({ name }) => ({ key: nodeKey('queue', name), label: `Queue ${name}` })),
      ...Object.entries(document.producers).map(([id, { name }]) => ({
        key: nodeKey('producer', id),
        label: `Producer ${name}`,
      })),
      ...Object.entries(document.consumers).map(([id, { name }]) => ({
        key: nodeKey('consumer', id),
        label: `Consumer ${name}`,
      })),
    ];
    const asked = this.filter().node;
    if (asked !== null && !options.some(({ key }) => key === asked)) {
      const [kind = '', name = ''] = asked.split(/:(.*)/s);
      options.push({ key: asked, label: `${KINDS[kind] ?? kind} ${name} (not on the canvas now)` });
    }
    return options;
  });

  constructor() {
    // Opening the log gives the focus to its list, or to its name when there is nothing to list yet (ADR-0061).
    afterNextRender(() => (this.list() ?? this.heading()).nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
    // What the page says of the list, read after it is drawn: how tall it is and how tall a row is, so that a larger text is followed.
    afterRenderEffect({
      read: () => {
        this.visible();
        this.measure();
      },
    });
    // The list follows the newest row, after the rows that are new are drawn.
    afterRenderEffect({
      write: () => {
        this.rows();
        const list = this.list()?.nativeElement;
        if (this.following() && list !== undefined) {
          list.scrollTop = list.scrollHeight;
        }
      },
    });
  }

  protected info(row: LogRow): ReturnType<typeof infoOf> {
    return infoOf(row.family);
  }

  protected time(at: number): string {
    return (at / 1000).toFixed(3);
  }

  protected isOn(family: Family): boolean {
    return this.filter().families.has(family);
  }

  // The filters.

  protected toggleFamily(family: Family): void {
    const families = new Set(this.filter().families);
    if (!families.delete(family)) {
      families.add(family);
    }
    this.log.setFilter({ families });
    this.announceShown();
  }

  protected setNode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.log.setFilter({ node: value === '' ? null : value });
    this.announceShown();
  }

  protected setMessage(event: Event): void {
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    this.log.setFilter({ message: Number.isInteger(value) && value > 0 ? value : null });
  }

  protected setText(event: Event): void {
    this.log.setFilter({ text: (event.target as HTMLInputElement).value });
  }

  protected clearFilters(): void {
    this.log.clearFilter();
    this.announceShown();
  }

  /** Says how many events the filters show, once, when they were changed. */
  protected announceShown(): void {
    const total = this.log.count();
    const shown = this.rows().length;
    this.announcer.announce(
      total === 0
        ? 'There are no events yet.'
        : shown === 0
          ? 'No event matches the filters.'
          : `Showing ${count(shown)} of ${events(total)}.`,
    );
  }

  /** Closes the log, and gives the focus back to the canvas, which is where it came from. */
  protected close(): void {
    this.explain.closeLog();
    this.viewport.focus();
  }

  // The list.

  protected onScroll(): void {
    const list = this.list()?.nativeElement;
    if (list !== undefined) {
      this.scrolled.set(list.scrollTop);
      this.following.set(atBottom(this.rows().length, this.rowHeight(), list.scrollTop, list.clientHeight));
    }
  }

  /** The list has the focus: the arrow keys start from where they are, and from the row that was chosen, or else the first that shows, when the list is scrolled away from the newest. */
  protected onFocus(): void {
    if (this.active() !== null) {
      return;
    }
    const rows = this.rows();
    const chosen = this.explain.chosenRow();
    const at =
      chosen !== null && this.indexOf(chosen) >= 0
        ? this.indexOf(chosen)
        : Math.min(Math.floor(this.top() / this.rowHeight()), rows.length - 1);
    this.picked.set(rows[at]?.seq ?? null);
  }

  protected onClick(event: MouseEvent): void {
    const seq = (event.target as Element).closest('[data-seq]')?.getAttribute('data-seq');
    if (seq !== null && seq !== undefined) {
      this.choose(Number(seq));
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const page = Math.max(1, Math.floor(this.height() / this.rowHeight()) - 1);
    const last = this.rows().length - 1;
    switch (event.key) {
      case 'ArrowDown':
        this.moveBy(1);
        break;
      case 'ArrowUp':
        this.moveBy(-1);
        break;
      case 'PageDown':
        this.moveBy(page);
        break;
      case 'PageUp':
        this.moveBy(-page);
        break;
      case 'Home':
        this.moveTo(0);
        break;
      case 'End':
        this.moveTo(last);
        break;
      case 'Enter':
      case ' ':
        if (this.active() !== null) {
          this.choose(this.active() as number);
        }
        break;
      case 'Escape':
        this.escape();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Escape lets go of what a row lit, and when nothing is lit it closes the log. */
  private escape(): void {
    if (this.explain.focus() === null) {
      this.close();
    } else {
      this.explain.letGoOfWhat();
      this.announcer.announce('Let go of what the event showed.');
    }
  }

  private choose(seq: number): void {
    this.picked.set(seq);
    this.explain.chooseRow(seq);
  }

  private moveBy(delta: number): void {
    const from = this.active() === null ? -1 : this.indexOf(this.active() as number);
    this.moveTo(from < 0 ? (delta > 0 ? 0 : this.rows().length - 1) : from + delta);
  }

  /** Puts the arrow keys on the row at this place of the list that is shown, and scrolls to it if it does not show. */
  private moveTo(index: number): void {
    const rows = this.rows();
    const list = this.list()?.nativeElement;
    if (rows.length === 0 || list === undefined) {
      return;
    }
    const to = Math.min(rows.length - 1, Math.max(0, index));
    this.picked.set((rows[to] as LogRow).seq);
    const top = scrollFor(to, this.rowHeight(), list.scrollTop, list.clientHeight);
    if (top !== list.scrollTop) {
      list.scrollTop = top;
      this.onScroll();
    }
  }

  /** The place of a row in the list that is shown, or -1: the rows are in the order of their numbers. */
  private indexOf(seq: number): number {
    const rows = this.rows();
    let low = 0;
    let high = rows.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const found = (rows[middle] as LogRow).seq;
      if (found === seq) {
        return middle;
      }
      if (found < seq) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return -1;
  }

  protected goToLatest(): void {
    this.following.set(true);
    this.picked.set(null);
    this.list()?.nativeElement.focus({ preventScroll: true });
  }

  private measure(): void {
    const list = this.list()?.nativeElement;
    if (list === undefined) {
      return;
    }
    if (list.clientHeight !== this.height()) {
      this.height.set(list.clientHeight);
    }
    const row = list.querySelector<HTMLElement>('[role="option"]')?.offsetHeight ?? 0;
    if (row > 0 && row !== this.rowHeight()) {
      this.rowHeight.set(row);
    }
  }
}

const count = (n: number): string => n.toLocaleString('en-US');
const events = (n: number): string => (n === 1 ? '1 event' : `${count(n)} events`);
