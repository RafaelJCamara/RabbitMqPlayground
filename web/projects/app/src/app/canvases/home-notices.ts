import { Component, computed, inject } from '@angular/core';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { CanvasLibrary } from './library';

/**
 * What the home says about keeping the canvases (ADR-0075), above the search and in this order: that nothing is kept after the tab is closed, if the browser keeps nothing; that
 * the room is running out, if it is; that the browser has not promised to keep them, if it has not; and the reminder to make a backup, if it is due. How much room the canvases
 * take is not said (ADR-0100). A warning is in words and in a colour, and the colour is not the only sign of it (WCAG 1.4.1).
 */
@Component({
  selector: 'rmq-home-notices',
  template: `
    @if (library.memoryReason(); as reason) {
      <div class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2" data-testid="memory-note">
        <p>
          <strong>Nothing here is kept after you close this tab.</strong>
          {{ reason }} Save a canvas as a file, or back up everything, to keep your work.
        </p>
      </div>
    }
    @if (library.quota(); as warning) {
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
    @if (library.persistence(); as note) {
      <p class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2" data-testid="persistence-note">
        {{ note.message }}
      </p>
    }
    @if (due(); as text) {
      <div
        class="border-border bg-panel flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
        role="group"
        aria-label="Reminder to make a backup"
        data-testid="reminder"
      >
        <p class="min-w-64 flex-1">{{ text }}</p>
        <button type="button" [class]="primary" data-testid="reminder-backup" (click)="library.exportBackup()">
          Back up everything
        </button>
        <button type="button" [class]="button" data-testid="reminder-later" (click)="library.snoozeReminder()">
          Remind me in a week
        </button>
      </div>
    }
  `,
  host: { class: 'flex flex-col gap-3' },
})
export class HomeNotices {
  protected readonly library = inject(CanvasLibrary);
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;

  /** The words of the reminder when it is due, and `null` when it is not. */
  protected readonly due = computed(() => {
    const reminder = this.library.reminder();
    return reminder.due ? reminder.text : null;
  });
}
