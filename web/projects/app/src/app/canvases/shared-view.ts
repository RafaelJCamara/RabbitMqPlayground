import { Component, inject, input, type OnInit } from '@angular/core';
import type { Shared } from '@rmq/persistence';
import { APP_NAME } from '../core/app-info';
import { ToastHost } from '../core/ui/toast-host';
import { Editor } from '../editor/editor';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { SHARED_CANVAS_PROVIDERS, SharedCanvas } from './shared-canvas';

/**
 * The page that a link opens (ADR-0078): the editor, over a storage that keeps nothing, with a banner. It is what the workspace is to the canvases of the browser, and it is made in the same way (ADR-0072): it provides the host
 * that the editor's session asks which canvas to open, and a storage of its own in memory that hides the page's from the editor, so the editor, its autosave, its undo and its simulation work as they do anywhere and what the
 * learner does here never reaches their canvases. The banner is the one heading of the page, says that this is a shared canvas and that nothing here is saved, and has the two ways out: **Save a copy to my canvases**, and
 * **Leave**. The messages of the link are given to the simulation by a token that this provides.
 */
@Component({
  selector: 'rmq-shared-view',
  imports: [Editor, ToastHost],
  providers: SHARED_CANVAS_PROVIDERS,
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <header class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 class="text-base font-semibold tracking-tight">{{ name }}</h1>
        <p class="min-w-0 flex-1" data-testid="shared-banner">
          <strong class="font-semibold" data-testid="shared-name">Shared canvas “{{ canvas.name() }}”</strong>
          <span class="text-muted"> You can look around, change things and play. Nothing here is saved.</span>
        </p>
        <button
          type="button"
          [class]="primary"
          [disabled]="!canvas.ready() || canvas.saving()"
          data-testid="shared-save"
          (click)="canvas.saveCopy()"
        >
          Save a copy to my canvases
        </button>
        <button type="button" [class]="button" data-testid="shared-leave" (click)="canvas.leave()">Leave</button>
      </header>
      @if (canvas.problem(); as problem) {
        <p
          class="border-danger bg-danger-bg text-danger mx-4 mt-2 rounded-md border px-3 py-2"
          role="alert"
          data-testid="shared-problem"
        >
          {{ problem }}
        </p>
      }
      @if (canvas.notice(); as notice) {
        <p
          class="border-warning bg-warning-bg text-warning mx-4 mt-2 rounded-md border px-3 py-2"
          role="status"
          data-testid="shared-notice"
        >
          {{ notice }}
        </p>
      }
      <div class="min-h-0 flex-1">
        @if (canvas.ready()) {
          <rmq-editor class="block h-full" />
        } @else if (canvas.failure(); as failure) {
          <p class="border-danger bg-danger-bg text-danger m-4 rounded-md border px-3 py-2" role="alert">
            {{ failure }}
          </p>
        } @else {
          <p class="text-muted p-6" role="status" data-testid="opening-shared">Opening the shared canvas…</p>
        }
      </div>
      <rmq-toast-host />
    </div>
  `,
})
export class SharedView implements OnInit {
  /** What the link carried. */
  readonly shared = input.required<Shared>();

  protected readonly name = APP_NAME;
  protected readonly canvas = inject(SharedCanvas);
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;

  ngOnInit(): void {
    void this.canvas.open(this.shared());
  }
}
