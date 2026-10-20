import { Component, computed, inject, output } from '@angular/core';
import type { HomeNote } from '@rmq/persistence';
import { Announcer } from '../core/announcer';
import { Icon } from '../core/ui/icon';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { CanvasLibrary } from './library';

/**
 * What the home says about keeping the canvases (ADR-0075), above the search and in this order: that nothing is kept after the tab is closed, if the browser keeps nothing; that
 * the room is running out, if it is; that the browser has not promised to keep them, if it has not; and the reminder to make a backup, if it is due. How much room the canvases
 * take is not said (ADR-0100), but that they take room is: with no timer, when they are kept in the browser (ADR-0106). A warning is in words and in a colour, and the colour is not the only sign of it (WCAG 1.4.1).
 * Each note but the reminder has a button that closes it, and it stays closed in this browser (ADR-0110); a worse warning is a note of its own, so closing one never hides a worse one.
 */
@Component({
  selector: 'rmq-home-notices',
  imports: [Icon],
  template: `
    @if (memoryReason(); as reason) {
      <div
        class="border-warning bg-warning-bg text-warning flex items-start gap-3 rounded-md border px-3 py-2"
        data-testid="memory-note"
      >
        <p class="flex-1">
          <strong>Nothing here is kept after you close this tab.</strong>
          {{ reason }} Save a canvas as a file, or back up everything, to keep your work.
        </p>
        <button
          type="button"
          [class]="button"
          aria-label="Close the note that nothing is kept"
          data-testid="memory-note-close"
          (click)="close('memory')"
        >
          <rmq-icon name="close" [size]="14" />
        </button>
      </div>
    }
    @if (spaceShown()) {
      <div class="border-border bg-panel flex items-start gap-3 rounded-md border px-3 py-2" data-testid="space-note">
        <p class="flex-1">
          <strong>Your canvases take up space in this browser.</strong>
          They are stored on this device, so delete the ones you do not need, or save them as files and back up
          everything.
        </p>
        <button
          type="button"
          [class]="button"
          aria-label="Close the note that the canvases take up space"
          data-testid="space-note-close"
          (click)="close('space')"
        >
          <rmq-icon name="close" [size]="14" />
        </button>
      </div>
    }
    @if (quota(); as warning) {
      <div
        class="flex items-start gap-3 rounded-md border px-3 py-2"
        [class]="
          warning.level === 'critical'
            ? 'border-danger bg-danger-bg text-danger'
            : 'border-warning bg-warning-bg text-warning'
        "
        data-testid="quota"
      >
        <p class="flex-1">{{ warning.message }}</p>
        <button
          type="button"
          [class]="button"
          aria-label="Close the warning about the room"
          data-testid="quota-close"
          (click)="close(warning.note)"
        >
          <rmq-icon name="close" [size]="14" />
        </button>
      </div>
    }
    @if (persistence(); as said) {
      <div
        class="border-warning bg-warning-bg text-warning flex items-start gap-3 rounded-md border px-3 py-2"
        data-testid="persistence-note"
      >
        <p class="flex-1">{{ said.message }}</p>
        <button
          type="button"
          [class]="button"
          aria-label="Close the note that the browser did not promise to keep the canvases"
          data-testid="persistence-note-close"
          (click)="close(said.note)"
        >
          <rmq-icon name="close" [size]="14" />
        </button>
      </div>
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
  private readonly announcer = inject(Announcer);
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;

  /** A note was closed, so that the home can put the focus where the note was not. */
  readonly closed = output<void>();

  private readonly open = (note: HomeNote): boolean => !this.library.dismissedNotes().has(note);

  /** Why nothing is kept, when the canvases are in memory and the note has not been closed. */
  protected readonly memoryReason = computed(() => {
    const reason = this.library.memoryReason();
    return reason !== undefined && this.open('memory') ? reason : null;
  });

  /** The note that the canvases take room: only when they are kept in the browser, where the note that nothing is kept would contradict it (ADR-0106). */
  protected readonly spaceShown = computed(() => this.library.memoryReason() === undefined && this.open('space'));

  protected readonly quota = computed(() => {
    const warning = this.library.quota();
    if (warning === null) {
      return null;
    }
    const note: HomeNote = `quota:${warning.level}`;
    return this.open(note) ? { ...warning, note } : null;
  });

  protected readonly persistence = computed(() => {
    const said = this.library.persistence();
    if (said === null || said.status === 'granted' || said.status === 'already') {
      return null;
    }
    const note: HomeNote = `persistence:${said.status}`;
    return this.open(note) ? { ...said, note } : null;
  });

  /** The words of the reminder when it is due, and `null` when it is not. */
  protected readonly due = computed(() => {
    const reminder = this.library.reminder();
    return reminder.due ? reminder.text : null;
  });

  protected close(note: HomeNote): void {
    void this.library.dismissNote(note);
    this.announcer.announce('Note closed.');
    this.closed.emit();
  }
}
