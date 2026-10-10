import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { APP_NAME } from '../core/app-info';
import { CANVAS_HOST } from '../core/session/canvas-host';
import { Icon } from '../core/ui/icon';
import { ToastHost } from '../core/ui/toast-host';
import { Editor } from '../editor/editor';
import { BUTTON, tabBoxClass, TAB_CLOSE, TAB_NAME, tabClass } from './buttons';
import { CanvasDialogs } from './dialogs';
import { Home } from './home';
import { CanvasLibrary, type Tab } from './library';

/**
 * The workspace (ADR-0072), which the flag `canvases` puts around the editor: the name of the product, the strip of open canvases, and the home or the editor. The
 * editor is made again for each canvas, by a `@for` over zero or one id that tracks it, so that the history, the selection, the view and the simulation of
 * a canvas that is left are gone and one Foblex canvas and one engine are alive at a time. It is the host that the editor's session asks which canvas to open.
 *
 * The strip is one row, whatever the number of canvases that are open (ADR-0096): the name of the product (which shows My canvases), My canvases, New canvas and Close all
 * stay where they are, and only the tabs scroll, the newest first. Two buttons at the ends of the tabs show the ones that are out of sight, each only when there is one, and
 * a tab that gets the cursor, or is shown, is scrolled into view, so that every tab is reached with the keyboard too.
 */
@Component({
  selector: 'rmq-workspace',
  imports: [Editor, Home, Icon, ToastHost],
  providers: [CanvasLibrary, { provide: CANVAS_HOST, useExisting: CanvasLibrary }],
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <header class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 class="shrink-0 text-base font-semibold tracking-tight">
          <button
            type="button"
            class="hover:bg-canvas -mx-1.5 rounded-md px-1.5 py-0.5"
            title="Show My canvases"
            data-testid="brand"
            (click)="library.show({ kind: 'home' })"
          >
            {{ name }}
          </button>
        </h1>
        <nav aria-label="Open canvases" class="flex min-w-0 flex-1 basis-96 flex-wrap items-center gap-1.5">
          <button
            type="button"
            [class]="tab(home())"
            [attr.aria-current]="home() ? 'true' : null"
            data-testid="tab-home"
            (click)="library.show({ kind: 'home' })"
          >
            My canvases
          </button>
          <div class="flex min-w-48 flex-1 basis-48 items-center gap-1">
            @if (newer()) {
              <button
                type="button"
                [class]="arrow"
                aria-label="Show newer canvases"
                title="Show newer canvases"
                data-testid="tabs-newer"
                (click)="scroll(-1)"
              >
                <rmq-icon name="chevron-left" [size]="16" />
              </button>
            }
            <ul
              #tabs
              class="flex min-h-10 min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              data-testid="tabs"
              (scroll)="measure()"
            >
              @for (item of library.tabs(); track item.id) {
                <li [class]="box(shown() === item.id)" [attr.data-tab]="item.id">
                  <button
                    type="button"
                    [class]="tabName"
                    [attr.aria-current]="shown() === item.id ? 'true' : null"
                    title="Double-click or press F2 to rename"
                    aria-keyshortcuts="F2"
                    data-testid="tab"
                    (click)="library.show({ kind: 'canvas', id: item.id })"
                    (dblclick)="rename(item)"
                    (keydown.f2)="rename(item)"
                  >
                    <span class="max-w-48 truncate">{{ item.name }}</span>
                  </button>
                  <button
                    type="button"
                    [class]="tabClose"
                    [attr.aria-label]="'Close ' + item.name"
                    data-testid="tab-close"
                    (click)="close(item.id)"
                  >
                    <rmq-icon name="close" [size]="14" />
                  </button>
                </li>
              }
            </ul>
            @if (older()) {
              <button
                type="button"
                [class]="arrow"
                aria-label="Show older canvases"
                title="Show older canvases"
                data-testid="tabs-older"
                (click)="scroll(1)"
              >
                <rmq-icon name="chevron-right" [size]="16" />
              </button>
            }
          </div>
          <button type="button" [class]="button" data-testid="tab-new" (click)="library.create()">
            <rmq-icon name="plus" [size]="16" />
            <span>New canvas</span>
          </button>
          @if (library.tabs().length > 0) {
            <button
              type="button"
              [class]="button"
              aria-label="Close all tabs"
              title="Close all tabs. The canvases are kept."
              data-testid="tab-close-all"
              (click)="closeAll()"
            >
              <rmq-icon name="close" [size]="16" />
              <span>Close all</span>
            </button>
          }
        </nav>
      </header>
      <div class="min-h-0 flex-1">
        @if (library.ready()) {
          @if (home()) {
            <rmq-home />
          }
          @for (id of editors(); track id) {
            <rmq-editor class="block h-full" />
          }
        } @else if (library.problem(); as problem) {
          <p class="border-danger bg-danger-bg text-danger m-4 rounded-md border px-3 py-2" role="alert">
            {{ problem }}
          </p>
        } @else {
          <p class="text-muted p-6" role="status" data-testid="opening-canvases">Opening your canvases…</p>
        }
      </div>
      <rmq-toast-host />
    </div>
  `,
})
export class Workspace {
  protected readonly name = APP_NAME;
  protected readonly library = inject(CanvasLibrary);
  private readonly dialogs = inject(CanvasDialogs);
  protected readonly button = BUTTON;
  protected readonly arrow = `${BUTTON} min-w-8 shrink-0 px-1.5`;
  protected readonly tabName = TAB_NAME;
  protected readonly tabClose = TAB_CLOSE;

  protected readonly home = computed(() => this.library.view().kind === 'home');
  /** The id of the canvas that is shown, or `undefined` on the home. */
  protected readonly shown = computed(() => {
    const view = this.library.view();
    return view.kind === 'canvas' ? view.id : undefined;
  });
  /** A list of the one canvas that is shown, or of none: what the `@for` that makes the editor tracks. */
  protected readonly editors = computed(() => {
    const id = this.shown();
    return id === undefined ? [] : [id];
  });

  /** Whether there are tabs out of sight on the side of the newest, and on the side of the oldest (ADR-0096). */
  protected readonly newer = signal(false);
  protected readonly older = signal(false);

  private readonly list = viewChild<ElementRef<HTMLUListElement>>('tabs');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    void this.library.start();
    // What is out of sight changes when a tab is made, closed or renamed.
    effect(() => {
      this.library.tabs();
      afterNextRender(() => this.measure(), { injector: this.injector });
    });
    // The tab of the canvas that is shown is brought into view when the one that is shown changes, and not when something else does, so that the strip does not move under a
    // learner who has scrolled it.
    effect(() => {
      const shown = this.shown();
      afterNextRender(() => this.reveal(shown), { injector: this.injector });
    });
    // And what is out of sight changes when the window is made wider or narrower. There is no observer in jsdom, which has no layout.
    afterNextRender(() => {
      const list = this.list()?.nativeElement;
      if (list !== undefined && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.measure());
        observer.observe(list);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  /** Works out from where the tabs are scrolled which side has a tab out of sight. The arrow that has the cursor and goes away gives it to the tab at that end. */
  protected measure(): void {
    const list = this.list()?.nativeElement;
    const newer = list !== undefined && list.scrollLeft > 1;
    const older = list !== undefined && list.scrollLeft < list.scrollWidth - list.clientWidth - 1;
    if (list !== undefined) {
      const tabs = list.querySelectorAll<HTMLElement>('[data-testid="tab"]');
      if (!newer && this.newer() && document.activeElement === this.arrowOf('newer')) {
        tabs[0]?.focus();
      }
      if (!older && this.older() && document.activeElement === this.arrowOf('older')) {
        tabs[tabs.length - 1]?.focus();
      }
    }
    this.newer.set(newer);
    this.older.set(older);
  }

  /** Scrolls the tabs by about the width that is in sight, toward the newest (-1) or the oldest (1), and gently unless the learner asked for less motion. */
  protected scroll(direction: -1 | 1): void {
    const list = this.list()?.nativeElement;
    if (list === undefined) {
      return;
    }
    const left = direction * Math.max(list.clientWidth * 0.8, 96);
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof list.scrollBy === 'function') {
      list.scrollBy({ left, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      list.scrollLeft += left;
    }
  }

  protected box(current: boolean): string {
    return tabBoxClass(current);
  }

  /** Brings the tab of the canvas that is shown, or My canvases, into the part of the strip that is in sight, which is no change when it is already there. */
  private reveal(shown: string | undefined): void {
    const tabs = this.list()?.nativeElement.querySelectorAll<HTMLElement>('[data-tab]');
    const tab = [...(tabs ?? [])].find((item) => item.dataset['tab'] === shown);
    // jsdom does not scroll, and has no way to say so.
    tab?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }

  private arrowOf(side: 'newer' | 'older'): Element | null {
    return this.element.querySelector(`[data-testid="tabs-${side}"]`);
  }

  /** Asks for the new name of the canvas of a tab, from a double click or F2 on it (ADR-0072), as the card of the home does. */
  protected rename(tab: Tab): void {
    this.dialogs.rename({
      title: 'Rename canvas',
      name: tab.name,
      confirm: 'Rename',
      submit: (name) => this.library.rename(tab.id, name),
    });
  }

  /** Closes a tab, and puts the cursor on the item of the strip that is shown now, because the button that had it is gone. */
  protected async close(id: string): Promise<void> {
    await this.library.closeTab(id);
    afterNextRender(() => this.element.querySelector<HTMLElement>('nav [aria-current="true"]')?.focus(), {
      injector: this.injector,
    });
  }

  /** Closes every tab, which deletes no canvas (ADR-0096), and puts the cursor on My canvases, which is what is shown. */
  protected async closeAll(): Promise<void> {
    await this.library.closeAllTabs();
    afterNextRender(() => this.element.querySelector<HTMLElement>('[data-testid="tab-home"]')?.focus(), {
      injector: this.injector,
    });
  }

  protected tab(current: boolean): string {
    return tabClass(current);
  }
}
