import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  EMPTY_ROW,
  retypeRow,
  rowType,
  VALUE_TYPES,
  withText,
  type DraftRow,
  type Issue,
  type RowReport,
  type RowType,
} from '@rmq/domain';
import { Announcer } from '../announcer';
import { Icon } from './icon';

let nextRows = 0;

/** What is expected in an empty value field, for each type that the learner may have chosen: an example of one, so that the type is on the screen. */
const PLACEHOLDER: Readonly<Record<RowType, string>> = {
  string: 'pdf',
  integer: '7',
  float: '1.5',
  boolean: 'true',
  exists: '',
};

const INPUT = 'border-border bg-surface min-h-8 w-full min-w-0 rounded-md border px-2 py-1 font-mono text-sm';

/**
 * The rows of a set of headers (ADR-0066, ADR-0067, ADR-0068, ADR-0069): a name, a type and a value for each, and what is wrong with each under it. It is the rows of the conditions of a binding, with
 * *exists* as a fifth type, and the rows of the headers of a message, without. It shows what it is given and says what the learner did through `rowsChange`: it keeps no rows of its own, so what the
 * owner holds is what is drawn. The type is the type of what is typed, and choosing another one rewrites the text so that it says it; a change that has no meaning is refused here, under the row, and the
 * select goes back. `commit` says that a control was left, a type was chosen or a row was taken off, for an owner that commits as it goes; one that commits as a whole ignores it.
 */
@Component({
  selector: 'rmq-header-rows',
  imports: [Icon],
  template: `
    <ul class="flex flex-col gap-2" [attr.aria-label]="label()" data-testid="header-rows">
      @for (row of rows(); track $index; let index = $index) {
        <li>
          <div
            class="border-line flex flex-col gap-1.5 rounded-md border p-2"
            role="group"
            data-testid="header-row"
            [attr.aria-label]="noun() + ' ' + (index + 1) + ' of ' + rows().length"
          >
            <div class="flex items-end gap-2">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <label class="text-muted text-xs" [for]="id(index, 'key')">Name</label>
                <input
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  data-testid="header-key"
                  [class]="input + (report(index).keyProblem ? ' border-danger' : '')"
                  [id]="id(index, 'key')"
                  [value]="row.key"
                  [attr.aria-label]="'Name of ' + noun() + ' ' + (index + 1)"
                  [attr.aria-invalid]="report(index).keyProblem ? 'true' : null"
                  [attr.aria-describedby]="keyDescription(index)"
                  (input)="typeKey(index, $event)"
                  (change)="commit.emit()"
                />
              </div>
              <button
                type="button"
                data-testid="header-remove"
                class="border-border hover:bg-canvas flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md border"
                [attr.aria-label]="'Remove ' + noun() + ' ' + (index + 1) + (row.key === '' ? '' : ', ' + row.key)"
                (click)="remove(index)"
              >
                <rmq-icon name="trash" [size]="16" />
              </button>
            </div>

            <div class="flex items-end gap-2">
              <div class="flex shrink-0 flex-col gap-0.5">
                <label class="text-muted text-xs" [for]="id(index, 'type')">Type</label>
                <select
                  data-testid="header-type"
                  class="border-border bg-surface min-h-8 rounded-md border px-1.5 py-1 text-sm"
                  [id]="id(index, 'type')"
                  [attr.aria-label]="'Type of ' + noun() + ' ' + (index + 1)"
                  [attr.aria-describedby]="retypeProblem(index) ? id(index, 'type-problem') : null"
                  [attr.aria-invalid]="retypeProblem(index) ? 'true' : null"
                  (change)="retype(index, $event)"
                >
                  @for (type of types(); track type) {
                    <option [value]="type" [selected]="type === report(index).type">{{ type }}</option>
                  }
                </select>
              </div>
              @if (report(index).type === 'exists') {
                <p class="text-muted min-h-8 flex-1 self-end py-1.5 text-xs" data-testid="header-exists">
                  Only has to be there, with any value.
                </p>
              } @else {
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <label class="text-muted text-xs" [for]="id(index, 'value')">Value</label>
                  <input
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    data-testid="header-value"
                    [class]="input + (report(index).valueProblem ? ' border-danger' : '')"
                    [id]="id(index, 'value')"
                    [value]="row.text"
                    [placeholder]="placeholder(index)"
                    [attr.aria-label]="'Value of ' + noun() + ' ' + (index + 1)"
                    [attr.aria-invalid]="report(index).valueProblem ? 'true' : null"
                    [attr.aria-describedby]="report(index).valueProblem ? id(index, 'value-problem') : null"
                    (input)="typeText(index, $event)"
                    (change)="commit.emit()"
                  />
                </div>
              }
            </div>

            @if (report(index).keyProblem; as problem) {
              <p
                class="text-danger flex items-start gap-1 text-xs"
                data-testid="header-key-problem"
                [id]="id(index, 'key-problem')"
              >
                <rmq-icon class="mt-0.5" name="alert" [size]="14" /><span>{{ problem.message }}</span>
              </p>
            }
            @if (report(index).valueProblem; as problem) {
              <p
                class="text-danger flex items-start gap-1 text-xs"
                data-testid="header-value-problem"
                [id]="id(index, 'value-problem')"
              >
                <rmq-icon class="mt-0.5" name="alert" [size]="14" /><span>{{ problem.message }}</span>
              </p>
            }
            @if (retypeProblem(index); as problem) {
              <p
                class="text-danger flex items-start gap-1 text-xs"
                data-testid="header-type-problem"
                [id]="id(index, 'type-problem')"
              >
                <rmq-icon class="mt-0.5" name="alert" [size]="14" /><span>{{ problem.message }}</span>
              </p>
            }
            @if (report(index).notes.length > 0) {
              <ul class="text-muted flex flex-col gap-0.5 text-xs" data-testid="header-notes" [id]="id(index, 'notes')">
                @for (note of report(index).notes; track note) {
                  <li class="flex items-start gap-1">
                    <rmq-icon class="mt-0.5" name="info" [size]="14" /><span>{{ note }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </li>
      }
    </ul>
    <button
      type="button"
      data-testid="header-add"
      class="border-border bg-surface hover:bg-canvas mt-2 flex min-h-8 items-center justify-center gap-2 rounded-md border px-3 py-1 text-sm font-medium"
      (click)="add()"
    >
      <rmq-icon name="plus" [size]="16" />
      Add {{ noun() }}
    </button>
  `,
})
export class HeaderRows {
  /** The rows, as the owner holds them. */
  readonly rows = input.required<readonly DraftRow[]>();
  /** What is wrong with each row, and what to know about it: one for each row. */
  readonly reports = input.required<readonly RowReport[]>();
  /** Whether a row may be an *exists* condition: the conditions of a binding may, and the headers of a message may not. */
  readonly allowExists = input(false);
  /** What a row is, in the singular, for the names of the controls: `condition`, `header`. */
  readonly noun = input('condition');
  /** What the list is, for its name. */
  readonly label = input('Conditions');

  /** The rows that the learner made: a name or a value typed, a type chosen, a row added or taken off. */
  readonly rowsChange = output<readonly DraftRow[]>();
  /** A control was left, a type was chosen, or a row was taken off. */
  readonly commit = output<void>();

  private readonly announcer = inject(Announcer);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly uid = `rmq-rows-${nextRows++}`;
  protected readonly input = INPUT;

  /** Why a type that was chosen could not be, by the row: it goes with the next change of the rows. */
  private readonly refused = signal<ReadonlyMap<number, Issue>>(new Map());

  protected readonly types = (): readonly RowType[] => (this.allowExists() ? [...VALUE_TYPES, 'exists'] : VALUE_TYPES);

  constructor() {
    effect(() => {
      this.rows();
      untracked(() => this.refused.set(new Map()));
    });
  }

  protected id(index: number, part: string): string {
    return `${this.uid}-${index}-${part}`;
  }

  protected report(index: number): RowReport {
    return this.reports()[index] as RowReport;
  }

  protected retypeProblem(index: number): Issue | undefined {
    return this.refused().get(index);
  }

  protected placeholder(index: number): string {
    return PLACEHOLDER[this.report(index).type];
  }

  /** What describes the name: its problem, and the notes, which are about the name. */
  protected keyDescription(index: number): string | null {
    const report = this.report(index);
    const ids = [
      ...(report.keyProblem === null ? [] : [this.id(index, 'key-problem')]),
      ...(report.notes.length === 0 ? [] : [this.id(index, 'notes')]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  private change(index: number, row: DraftRow): void {
    this.rowsChange.emit(this.rows().map((found, at) => (at === index ? row : found)));
  }

  protected typeKey(index: number, event: Event): void {
    this.change(index, { ...(this.rows()[index] as DraftRow), key: (event.target as HTMLInputElement).value });
  }

  protected typeText(index: number, event: Event): void {
    this.change(index, withText(this.rows()[index] as DraftRow, (event.target as HTMLInputElement).value));
  }

  /** A type was chosen. The text is rewritten to say it, or the change is refused with its cause, and the select goes back. */
  protected retype(index: number, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const row = this.rows()[index] as DraftRow;
    const type = select.value as RowType;
    const changed = retypeRow(row, type);
    if (!changed.ok) {
      this.refused.set(new Map([[index, changed.error]]));
      select.value = rowType(row);
      this.announcer.announce(changed.error.message, 'assertive');
      return;
    }
    this.change(index, changed.value);
    this.announcer.announce(this.nowText(index, changed.value));
    this.commit.emit();
  }

  /** What a row became when its type was chosen, in words: `Condition 2 is now a string: "1".` */
  private nowText(index: number, row: DraftRow): string {
    const name = `${this.noun().charAt(0).toUpperCase()}${this.noun().slice(1)} ${index + 1}`;
    if (row.exists) {
      return `${name} now only has to be there.`;
    }
    const type = rowType(row);
    return row.text.trim() === ''
      ? `${name} is now ${article(type)} ${type}, and has no value yet.`
      : `${name} is now ${article(type)} ${type}: ${row.text.trim()}.`;
  }

  protected add(): void {
    const index = this.rows().length;
    this.rowsChange.emit([...this.rows(), EMPTY_ROW]);
    this.announcer.announce(`${this.noun().charAt(0).toUpperCase()}${this.noun().slice(1)} ${index + 1} added.`);
    this.focus(index, 'key');
  }

  protected remove(index: number): void {
    const row = this.rows()[index] as DraftRow;
    const next = this.rows().filter((_, at) => at !== index);
    this.rowsChange.emit(next);
    this.announcer.announce(`Removed ${this.noun()} ${index + 1}${row.key === '' ? '' : `, ${row.key}`}.`);
    this.commit.emit();
    if (next.length === 0) {
      this.host.querySelector<HTMLElement>('[data-testid="header-add"]')?.focus();
    } else {
      this.focus(Math.min(index, next.length - 1), 'key');
    }
  }

  /** Puts the cursor in the name or the value of a row, once it is drawn if it is not yet: for a row that was just added, and for the first row that has a problem. */
  focus(index: number, field: 'key' | 'value'): void {
    const control = (): HTMLElement | null =>
      // A value that is not there (an *exists* row) has the name instead.
      this.host.querySelector<HTMLElement>(`#${this.id(index, field)}`) ??
      this.host.querySelector<HTMLElement>(`#${this.id(index, 'key')}`);
    const now = control();
    if (now === null) {
      afterNextRender(() => control()?.focus(), { injector: this.injector });
    } else {
      now.focus();
    }
  }
}

const article = (type: RowType): string => (type === 'integer' ? 'an' : 'a');
