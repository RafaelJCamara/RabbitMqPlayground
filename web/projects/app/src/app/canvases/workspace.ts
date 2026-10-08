import { Component, computed, inject } from '@angular/core';
import { APP_NAME } from '../core/app-info';
import { CANVAS_HOST } from '../core/session/canvas-host';
import { Icon } from '../core/ui/icon';
import { Editor } from '../editor/editor';
import { BUTTON, tabClass } from './buttons';
import { Home } from './home';
import { CanvasLibrary } from './library';

/**
 * The workspace (ADR-0072), which the flag `canvases` puts around the editor: the name of the product, the strip of open canvases, and the home or the editor. The
 * editor is made again for each canvas, by a `@for` over zero or one id that tracks it, so that the history, the selection, the view and the simulation of
 * a canvas that is left are gone and one Foblex canvas and one engine are alive at a time. It is the host that the editor's session asks which canvas to open.
 */
@Component({
  selector: 'rmq-workspace',
  imports: [Editor, Home, Icon],
  providers: [CanvasLibrary, { provide: CANVAS_HOST, useExisting: CanvasLibrary }],
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <header class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 class="text-base font-semibold tracking-tight">{{ name }}</h1>
        <nav aria-label="Open canvases">
          <ul class="flex flex-wrap items-center gap-1.5">
            <li>
              <button
                type="button"
                [class]="tab(home())"
                [attr.aria-current]="home() ? 'true' : null"
                data-testid="tab-home"
                (click)="library.show({ kind: 'home' })"
              >
                My canvases
              </button>
            </li>
            @for (item of library.tabs(); track item.id) {
              <li class="flex items-center gap-0.5" [attr.data-tab]="item.id">
                <button
                  type="button"
                  [class]="tab(shown() === item.id)"
                  [attr.aria-current]="shown() === item.id ? 'true' : null"
                  data-testid="tab"
                  (click)="library.show({ kind: 'canvas', id: item.id })"
                >
                  <span class="max-w-48 truncate">{{ item.name }}</span>
                </button>
                <button
                  type="button"
                  [class]="button"
                  [attr.aria-label]="'Close ' + item.name"
                  data-testid="tab-close"
                  (click)="library.closeTab(item.id)"
                >
                  <rmq-icon name="close" [size]="14" />
                </button>
              </li>
            }
            <li>
              <button type="button" [class]="button" data-testid="tab-new" (click)="library.create()">
                <rmq-icon name="plus" [size]="16" />
                <span>New canvas</span>
              </button>
            </li>
          </ul>
        </nav>
      </header>
      <div class="min-h-0 flex-1">
        @if (library.ready()) {
          @if (home()) {
            <rmq-home />
          } @else {
            @for (id of editors(); track id) {
              <rmq-editor class="block h-full" />
            }
          }
        } @else if (library.problem(); as problem) {
          <p class="border-danger bg-danger-bg text-danger m-4 rounded-md border px-3 py-2" role="alert">
            {{ problem }}
          </p>
        } @else {
          <p class="text-muted p-6" role="status" data-testid="opening-canvases">Opening your canvases…</p>
        }
      </div>
    </div>
  `,
})
export class Workspace {
  protected readonly name = APP_NAME;
  protected readonly library = inject(CanvasLibrary);
  protected readonly button = BUTTON;

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

  constructor() {
    void this.library.start();
  }

  protected tab(current: boolean): string {
    return tabClass(current);
  }
}
