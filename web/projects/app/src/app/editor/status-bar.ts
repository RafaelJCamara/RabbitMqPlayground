import { Component, computed, inject } from '@angular/core';
import { CanvasSession } from '../core/session/canvas-session';
import { StatusStore } from '../core/state/status-store';
import { RefusalNotice } from '../core/ui/refusal-notice';

/**
 * The bottom of the editor (ADR-0010): what was done, or what was refused and why, and what concerns keeping the canvas. A
 * refusal that came from the inspector is shown there, next to the control that made it, and not here. The hint bar and the log
 * of events go in this strip when they exist.
 */
@Component({
  selector: 'rmq-status-bar',
  imports: [RefusalNotice],
  template: `
    <footer class="border-line bg-panel flex flex-col gap-2 border-t px-4 py-2 text-sm" aria-label="Status">
      @if (refusal(); as shown) {
        <rmq-refusal-notice [issue]="shown.issue" />
      } @else if (message(); as text) {
        <p data-testid="status-message">{{ text }}</p>
      }
      @if (session.quota(); as warning) {
        <p
          class="rounded-md border px-3 py-2"
          [class]="
            warning.level === 'critical'
              ? 'border-danger bg-danger-bg text-danger'
              : 'border-warning bg-warning-bg text-warning'
          "
          data-testid="quota"
        >
          {{ warning.message }}
        </p>
      }
      @if (session.unreadable() > 0) {
        <p class="text-muted" data-testid="unreadable">
          {{ unreadableText() }}
        </p>
      }
    </footer>
  `,
})
export class StatusBar {
  protected readonly session = inject(CanvasSession);
  private readonly status = inject(StatusStore);

  /** A refusal from the inspector is shown beside its control, and one from the command bar in the bar, so they are not repeated here. */
  protected readonly refusal = computed(() => {
    const refusal = this.status.refusal();
    return refusal !== null && refusal.origin !== 'inspector' && refusal.origin !== 'typed' ? refusal : null;
  });
  protected readonly message = computed(() => {
    const notice = this.status.notice();
    return notice?.kind === 'message' ? notice.text : null;
  });
  protected readonly unreadableText = computed(() => {
    const count = this.session.unreadable();
    return `${count} saved ${count === 1 ? 'canvas' : 'canvases'} in this browser could not be opened, for example because a newer version of the app saved ${count === 1 ? 'it' : 'them'}. Nothing was changed.`;
  });
}
