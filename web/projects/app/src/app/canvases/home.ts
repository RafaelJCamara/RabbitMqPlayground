import { afterNextRender, Component, computed, ElementRef, inject, Injector, signal } from '@angular/core';
import { Icon } from '../core/ui/icon';
import { Toasts } from '../core/ui/toasts';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { restoreView } from './backup-words';
import { CanvasCard, elementsText } from './card';
import type { UnreadableCanvas } from '@rmq/persistence';
import { CanvasLibrary } from './library';
import { CanvasDialogs } from './dialogs';
import { HomeNotices } from './home-notices';
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
  imports: [CanvasCard, HomeNotices, Icon],
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
            <button type="button" [class]="button" data-testid="home-open-file" (click)="openPicker.click()">
              Open a file…
            </button>
            <button type="button" [class]="button" data-testid="home-restore" (click)="restorePicker.click()">
              Restore a backup…
            </button>
            <button type="button" [class]="button" data-testid="home-backup" (click)="library.exportBackup()">
              Back up everything
            </button>
            @if (library.canvases().length + library.unreadable().length > 0) {
              <button type="button" [class]="danger" data-testid="home-delete-all" (click)="deleteEverything()">
                Delete all…
              </button>
            }
          </div>
        </div>
        <input
          #openPicker
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="open-file"
          (change)="onOpenFile($event)"
        />
        <input
          #restorePicker
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="restore-file"
          (change)="onRestoreFile($event)"
        />

        <rmq-home-notices />

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
                    (save)="library.saveAsFile(canvas.id)"
                    (share)="library.share(canvas.id)"
                    (delete)="deleteCanvas(canvas)"
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

        @if (library.unreadable().length > 0) {
          <section class="flex flex-col gap-2" aria-labelledby="rmq-home-unreadable" data-testid="home-unreadable">
            <h2 id="rmq-home-unreadable" class="text-lg font-semibold">Canvases that could not be opened</h2>
            <p class="text-muted">
              These are in this browser, and this version of the app cannot read them. Nothing was changed. A backup
              cannot hold them either.
            </p>
            <ul class="flex flex-col gap-2" aria-label="Canvases that could not be opened">
              @for (item of library.unreadable(); track item.id) {
                <li class="border-border bg-surface flex flex-wrap items-start gap-3 rounded-md border p-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold">{{ item.name ?? item.id }}</h3>
                    <p class="text-muted text-sm">{{ item.error.message }}</p>
                  </div>
                  <button
                    type="button"
                    [class]="danger"
                    [attr.aria-label]="'Delete ' + (item.name ?? item.id)"
                    data-testid="unreadable-delete"
                    (click)="deleteUnreadable(item)"
                  >
                    <rmq-icon name="trash" [size]="16" />
                    <span>Delete</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    </main>
  `,
  host: { class: 'block h-full', '(document:keydown)': 'onKey($event)' },
})
export class Home {
  protected readonly library = inject(CanvasLibrary);
  private readonly dialogs = inject(CanvasDialogs);
  private readonly toasts = inject(Toasts);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  protected readonly field = FIELD;
  protected readonly danger = `${BUTTON} text-danger`;
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

  /**
   * Control or Command and Z take back the newest notice that has an Undo, the delete of a canvas, when the cursor is not in a field of text, which keeps its own Undo
   * (ADR-0074). In the editor the same keys are the document's Undo, and this is not heard there.
   */
  protected onKey(event: KeyboardEvent): void {
    const target = event.target;
    const inField =
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'z' &&
      !inField
    ) {
      const latest = this.toasts.latestUndo();
      if (latest !== undefined) {
        event.preventDefault();
        void this.toasts.undo(latest.id);
      }
    }
  }

  /** Asks once, and then deletes the canvas, which the notice that follows can bring back; the focus goes to the card that takes its place. */
  protected async deleteCanvas(canvas: CanvasSummary): Promise<void> {
    const sure = await this.dialogs.confirm({
      title: `Delete “${canvas.name}”?`,
      body: [`It has ${elementsText(canvas.elements)}.`, 'You can take this back for a short while after.'],
      confirm: 'Delete canvas',
    });
    if (sure) {
      await this.deleteAndMoveFocus(canvas.id, canvas.id);
    }
  }

  protected async deleteUnreadable(item: UnreadableCanvas): Promise<void> {
    const label = item.name ?? item.id;
    const sure = await this.dialogs.confirm({
      title: `Delete “${label}”?`,
      body: [
        'This version of the app cannot open it, so a backup could not have kept it.',
        'You can take this back for a short while after.',
      ],
      confirm: 'Delete canvas',
    });
    if (sure) {
      await this.deleteAndMoveFocus(item.id, undefined);
    }
  }

  /** Deletes a canvas, and puts the focus on what takes its place: the next card, or the one before, or the search, or the button that makes a canvas. */
  private async deleteAndMoveFocus(id: string, card: string | undefined): Promise<void> {
    const cards = this.visible();
    const at = cards.findIndex((canvas) => canvas.id === card);
    const neighbour = at < 0 ? undefined : (cards[at + 1] ?? cards[at - 1]);
    await this.library.delete(id);
    afterNextRender(
      () => {
        const open =
          neighbour === undefined
            ? null
            : this.element.querySelector<HTMLElement>(`[data-canvas="${neighbour.id}"] [data-testid="card-open"]`);
        const target =
          open ??
          this.element.querySelector<HTMLElement>('[data-testid="home-search"]') ??
          this.element.querySelector<HTMLElement>('[data-testid="home-new"]');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Opens the file that the learner chose as a new canvas. A file that cannot be opened is said in a dialog, with the reason, and nothing was added. */
  protected async onOpenFile(event: Event): Promise<void> {
    const file = this.chosen(event);
    if (file === undefined) {
      return;
    }
    const opened = await this.library.openFile(file);
    if (!opened.ok) {
      await this.dialogs.problem({ title: `“${file.name}” could not be opened`, body: [opened.error] });
    }
  }

  /** Puts the backup that the learner chose back, and says what came of it in a dialog, or why it could not be done. */
  protected async onRestoreFile(event: Event): Promise<void> {
    const file = this.chosen(event);
    if (file === undefined) {
      return;
    }
    const report = await this.library.restoreFile(file);
    if (!report.ok) {
      await this.dialogs.problem({ title: `“${file.name}” could not be put back`, body: [report.error] });
      return;
    }
    const changed = report.value.restored.length + report.value.copies.length > 0;
    await this.dialogs.restored({
      title: changed ? 'Backup restored' : 'Nothing was put back',
      view: restoreView(report.value),
    });
  }

  /** Asks once, offering a backup first, and then deletes every canvas, which the notice that follows can bring back. */
  protected async deleteEverything(): Promise<void> {
    const sure = await this.dialogs.deleteAll({
      readable: this.library.canvases().length,
      unreadable: this.library.unreadable().length,
      backup: () => this.library.exportBackup({ say: false }),
    });
    if (sure && (await this.library.deleteAll())) {
      afterNextRender(() => this.element.querySelector<HTMLElement>('[data-testid="home-new"]')?.focus(), {
        injector: this.injector,
      });
    }
  }

  /** The file that was chosen, if any. The field is emptied, so that choosing the same file again is a choice. */
  private chosen(event: Event): File | undefined {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    return file;
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
