import {
  afterNextRender,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ElementKind, Id } from '@rmq/domain';
import type { Placement } from '../canvas/model/transform';
import { Icon } from '../core/ui/icon';
import type { GiveUp } from './binding-key';
import type { TargetOption } from './link-flow';

let nextPicker = 0;

const GROUPS: readonly { readonly kind: ElementKind; readonly label: string }[] = [
  { kind: 'exchange', label: 'Exchanges' },
  { kind: 'queue', label: 'Queues' },
  { kind: 'consumer', label: 'Consumers' },
];

/**
 * The picker of "Link to…" (ADR-0041): the nodes that the rules allow, grouped by kind and searchable, each with what the link would do, as a combobox: the field has the
 * focus and the arrow keys move through the list, which it points at with `aria-activedescendant`. It lists only valid targets, so the learner cannot choose a link
 * that would be refused, and when there are none it says why. It decides nothing: it says which node was chosen, or that it was given up (Escape, or the focus
 * leaving), and the owner makes the link.
 */
@Component({
  selector: 'rmq-link-picker',
  imports: [Icon],
  template: `
    <div
      class="border-border bg-panel text-fg absolute z-10 flex w-80 flex-col gap-2 rounded-md border p-3 text-sm shadow-lg"
      role="dialog"
      data-testid="link-picker"
      [attr.aria-labelledby]="titleId"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      [style.max-height]="'min(20rem, ' + position().maxHeight + 'px)'"
      (focusout)="leave($event)"
    >
      <h3 class="font-medium" [id]="titleId">{{ title() }}</h3>
      <input
        #field
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-label="Search the targets"
        aria-autocomplete="list"
        class="border-border bg-surface rounded-md border px-2 py-1.5"
        [attr.aria-expanded]="listed()"
        [attr.aria-controls]="listed() ? listId : null"
        [attr.aria-activedescendant]="activeId()"
        (input)="type($event)"
        (keydown)="onKey($event)"
      />
      @if (reason(); as why) {
        <p class="text-muted" data-testid="picker-reason">{{ why }}</p>
      } @else if (visible().length === 0) {
        <p class="text-muted" data-testid="picker-nothing">Nothing matches “{{ search() }}”.</p>
      } @else {
        <!-- A press in the list must not take the focus from the field, which would give the picker up before the click. -->
        <ul
          class="flex flex-col gap-2 overflow-y-auto"
          role="listbox"
          [id]="listId"
          (mousedown)="$event.preventDefault()"
        >
          @for (group of groups(); track group.kind) {
            <li role="presentation">
              <ul role="group" class="flex flex-col gap-0.5" [attr.aria-labelledby]="groupId(group.kind)">
                <li
                  role="presentation"
                  class="text-muted px-2 text-xs font-semibold tracking-wide uppercase"
                  [id]="groupId(group.kind)"
                >
                  {{ group.label }}
                </li>
                @for (option of group.options; track option.id) {
                  <li
                    role="option"
                    class="flex cursor-pointer flex-col rounded px-2 py-1"
                    [class]="isActive(option) ? 'bg-accent text-accent-fg' : 'hover:bg-canvas'"
                    [id]="optionId(option)"
                    [attr.aria-selected]="isActive(option)"
                    tabindex="-1"
                    (click)="chosen.emit(option.id)"
                    (keydown.enter)="chosen.emit(option.id)"
                  >
                    <span class="flex items-center gap-2">
                      <rmq-icon [name]="option.kind" [size]="16" />
                      <strong class="font-medium">{{ option.name }}</strong>
                    </span>
                    <span class="text-xs" [class.opacity-80]="isActive(option)">{{ option.summary }}</span>
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class LinkPicker {
  /** What is being linked: `Link exchange orders to…`. */
  readonly title = input.required<string>();
  readonly options = input.required<readonly TargetOption[]>();
  /** Why there is nothing to choose, in the words of the rule. `null` when there is something. */
  readonly reason = input<string | null>(null);
  /** Where it is, measured from the top left of the canvas, and how tall it may be there: its list scrolls inside it. */
  readonly position = input.required<Placement>();

  readonly chosen = output<Id>();
  readonly cancelled = output<GiveUp>();

  private readonly injector = inject(Injector);
  private readonly page = inject(DOCUMENT);
  private readonly uid = `rmq-link-picker-${nextPicker++}`;
  protected readonly titleId = `${this.uid}-title`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly search = signal('');
  private readonly active = signal(0);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** What the search leaves, by name or by kind, whatever the case. */
  protected readonly visible = computed(() => {
    const wanted = this.search().trim().toLowerCase();
    return this.options().filter(({ name, kind }) => name.toLowerCase().includes(wanted) || kind.includes(wanted));
  });

  /** The groups that have something, in the order of the kinds, and the targets in the order that they were given. */
  protected readonly groups = computed(() =>
    GROUPS.map(({ kind, label }) => ({
      kind,
      label,
      options: this.visible().filter((option) => option.kind === kind),
    })).filter(({ options }) => options.length > 0),
  );

  /**
   * Whether the list is drawn. When there is a reason, or the search leaves nothing, a sentence is drawn in its place, and the field must not say that it has expanded a list, nor point
   * at one that is not in the page (axe: aria-valid-attr-value).
   */
  protected readonly listed = computed(() => this.reason() === null && this.visible().length > 0);

  /** The targets in the order that they are listed, which is the order that the arrow keys go in. */
  private readonly flat = computed(() => this.groups().flatMap(({ options }) => options));
  protected readonly activeId = computed(() => {
    const option = this.flat()[this.active()];
    return option === undefined ? null : this.optionId(option);
  });

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
    // The option that the arrow keys are on stays in view, in a list that scrolls, which it does when the room is short (the popover is no taller than the room that it has).
    effect(() => {
      const id = this.activeId();
      if (id !== null) {
        afterNextRender(
          () => {
            // jsdom does not scroll, and has no way to say so.
            this.page.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
          },
          { injector: this.injector },
        );
      }
    });
  }

  protected optionId(option: TargetOption): string {
    return `${this.uid}-option-${option.id}`;
  }

  protected groupId(kind: ElementKind): string {
    return `${this.uid}-group-${kind}`;
  }

  protected isActive(option: TargetOption): boolean {
    return this.flat()[this.active()]?.id === option.id;
  }

  protected type(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.flat().length;
    switch (event.key) {
      case 'ArrowDown':
        this.move(event, count === 0 ? 0 : (this.active() + 1) % count);
        break;
      case 'ArrowUp':
        this.move(event, count === 0 ? 0 : (this.active() + count - 1) % count);
        break;
      case 'Home':
        this.move(event, 0);
        break;
      case 'End':
        this.move(event, Math.max(0, count - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = this.flat()[this.active()];
        if (option !== undefined) {
          this.chosen.emit(option.id);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.cancelled.emit('escape');
        break;
    }
  }

  private move(event: Event, to: number): void {
    event.preventDefault();
    this.active.set(to);
  }

  /** The focus going anywhere outside the picker gives up. */
  protected leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node && (event.currentTarget as HTMLElement).contains(next))) {
      this.cancelled.emit('blur');
    }
  }
}
