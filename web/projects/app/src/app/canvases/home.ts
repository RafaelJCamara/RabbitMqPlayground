import { Component, computed, ElementRef, inject, signal, afterNextRender, Injector } from '@angular/core';
import { Icon } from '../core/ui/icon';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { CanvasCard } from './card';
import { CanvasLibrary } from './library';
import { CanvasDialogs } from './name-dialog';
import { PAGE, searchSummaries, SORTS, sortSummaries, type CanvasSummary, type SortKey } from './summary';

const FIELD = 'border-border bg-surface rounded-md border px-2 py-1.5';

/** "7 canvases", "1 canvas". */
const canvasesText = (count: number): string => `${count} ${count === 1 ? 'canvas' : 'canvases'}`;

/**
 * "My canvases" (ADR-0073): every canvas of the browser as a card, with a search and a sort, and the actions that concern all of them. It reads what the library
 * knows, and draws 48 cards at a time. What is said about the result of a search is in a live region, so that typing is heard without the focus moving.
 */
@Component({
  selector: 'rmq-home',
  imports: [CanvasCard, Icon],
  template: `
    <main class="bg-surface text-fg h-full overflow-y-auto" aria-labelledby="rmq-home-title">
      <div class="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
        <div class="flex flex-wrap items-center gap-3">
          <h2 id="rmq-home-title" class="text-xl font-semibold">My canvases</h2>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" [class]="primary" data-testid="home-new" (click)="library.create()">
              <rmq-icon name="plus" [size]="16" />
              <span>New canvas</span>
            </button>
          </div>
        </div>

        @if (library.problem(); as problem) {
          <div
            class="border-danger bg-danger-bg text-danger flex items-start gap-3 rounded-md border px-3 py-2"
            role="alert"
            data-testid="home-problem"
          >
            <p class="flex-1">{{ problem }}</p>
            <button type="button" [class]="button" (click)="library.dismissProblem()">Dismiss</button>
          </div>
        }

        @if (library.canvases().length > 0) {
          <div class="flex flex-wrap items-end gap-3">
            <div class="flex flex-col gap-1" role="search">
              <label for="rmq-home-search" class="font-medium">Search canvases</label>
              <input
                id="rmq-home-search"
                type="search"
                autocomplete="off"
                class="min-w-64"
                [class]="field"
                [value]="query()"
                data-testid="home-search"
                (input)="onQuery($event)"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label for="rmq-home-sort" class="font-medium">Sort by</label>
              <select id="rmq-home-sort" [class]="field" data-testid="home-sort" (change)="onSort($event)">
                @for (choice of sorts; track choice.key) {
                  <option [value]="choice.key" [selected]="choice.key === sort()">{{ choice.label }}</option>
                }
              </select>
            </div>
            <p class="text-muted ml-auto text-sm" role="status" data-testid="home-count">{{ count() }}</p>
          </div>

          @if (found().length === 0) {
            <p data-testid="home-none">
              No canvas has “{{ query().trim() }}” in its name.
              <button type="button" class="text-link underline underline-offset-4" (click)="clearSearch()">
                Show all canvases
              </button>
            </p>
          } @else {
            <ul class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]" aria-label="Canvases">
              @for (canvas of visible(); track canvas.id) {
                <li>
                  <rmq-canvas-card
                    [canvas]="canvas"
                    (open)="library.openCanvas(canvas.id)"
                    (rename)="rename(canvas)"
                    (duplicate)="library.duplicate(canvas.id)"
                  />
                </li>
              }
            </ul>
            @if (visible().length < found().length) {
              <div>
                <button type="button" [class]="button" data-testid="home-more" (click)="showMore()">Show more</button>
              </div>
            }
          }
        } @else {
          <p class="text-muted" data-testid="home-empty">You have no canvases yet. Make one with “New canvas”.</p>
        }
      </div>
    </main>
  `,
  host: { class: 'block h-full' },
})
export class Home {
  protected readonly library = inject(CanvasLibrary);
  private readonly dialogs = inject(CanvasDialogs);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  protected readonly field = FIELD;
  protected readonly sorts = SORTS;

  protected readonly query = signal('');
  protected readonly sort = signal<SortKey>('edited');
  private readonly limit = signal(PAGE);

  /** The canvases that the search matches, in the order chosen. */
  protected readonly found = computed(() =>
    sortSummaries(searchSummaries(this.library.canvases(), this.query()), this.sort()),
  );
  /** The ones that are drawn: the first page, and one more for each press of "Show more". */
  protected readonly visible = computed(() => this.found().slice(0, this.limit()));
  protected readonly count = computed(() => {
    const all = this.library.canvases().length;
    const found = this.found().length;
    if (this.query().trim() === '') {
      return canvasesText(all);
    }
    return found === 0 ? 'No canvases match.' : `${found} of ${canvasesText(all)}`;
  });

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.limit.set(PAGE);
  }

  protected onSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as SortKey);
    this.limit.set(PAGE);
  }

  protected clearSearch(): void {
    this.query.set('');
    this.limit.set(PAGE);
  }

  /** Draws the next page, and, if that was the last, leaves the focus on the first card that it added, because the button it was on is gone. */
  protected showMore(): void {
    const first = this.found()[this.limit()];
    this.limit.update((limit) => limit + PAGE);
    if (this.limit() >= this.found().length && first !== undefined) {
      afterNextRender(
        () => this.element.querySelector<HTMLElement>(`[data-canvas="${first.id}"] [data-testid="card-open"]`)?.focus(),
        { injector: this.injector },
      );
    }
  }

  protected rename(canvas: CanvasSummary): void {
    this.dialogs.rename({
      title: 'Rename canvas',
      name: canvas.name,
      confirm: 'Rename',
      submit: (name) => this.library.rename(canvas.id, name),
    });
  }
}
