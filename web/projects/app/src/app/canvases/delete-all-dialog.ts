import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal } from '@angular/core';
import type { Outcome } from '@rmq/persistence';
import { backupDone, type BackupDone } from './backup-words';
import { BUTTON, BUTTON_DANGER } from './buttons';

export const DELETE_ALL_TITLE_ID = 'rmq-delete-all-title';
export const DELETE_ALL_BODY_ID = 'rmq-delete-all-body';

/** What the dialog that asks before every canvas is deleted needs (ADR-0074). */
export interface DeleteAllData {
  /** How many canvases can be opened. */
  readonly readable: number;
  /** How many cannot be opened by this version of the app, which a backup cannot hold (ADR-0073). */
  readonly unreadable: number;
  /** Makes the backup and gives the file to the learner, without telling anyone: the dialog says what came of it. */
  readonly backup: () => Promise<Outcome<BackupDone, string>>;
}

/**
 * The dialog that asks before every canvas is deleted (ADR-0074): how many there are, what it does, and three buttons. "Export a backup first" is a button, and not a
 * checkbox or a step: it saves the file and says what it saved, and nothing else, so the file that the learner is asked to look after is not hidden, and a backup that failed
 * does not go unsaid. The cursor starts on Cancel. It closes with `true` for the button that deletes, and with nothing for any other way out.
 */
@Component({
  selector: 'rmq-delete-all-dialog',
  template: `
    <div
      class="bg-panel text-fg border-border flex w-[min(32rem,92vw)] flex-col gap-3 rounded-lg border p-4 shadow-xl"
      data-testid="delete-all-dialog"
    >
      <h2 class="text-base font-semibold" [id]="titleId">{{ title() }}</h2>
      <div class="flex flex-col gap-2" [id]="bodyId">
        <p>{{ what() }}</p>
        <p>Export a backup first, or take it back with Undo for a short while after.</p>
      </div>
      <p class="text-muted" role="status" data-testid="backup-status">{{ saved() }}</p>
      @if (problem(); as text) {
        <p class="text-danger" role="alert" data-testid="backup-problem">{{ text }}</p>
      }
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" [class]="button" data-testid="backup-first" (click)="backup()">
          Export a backup first
        </button>
        <button type="button" cdkFocusInitial [class]="button" (click)="ref.close(false)">Cancel</button>
        <button type="button" [class]="danger" data-testid="delete-all-confirm" (click)="ref.close(true)">
          {{ confirm() }}
        </button>
      </div>
    </div>
  `,
})
export class DeleteAllDialog {
  protected readonly data = inject<DeleteAllData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly titleId = DELETE_ALL_TITLE_ID;
  protected readonly bodyId = DELETE_ALL_BODY_ID;
  protected readonly button = BUTTON;
  protected readonly danger = BUTTON_DANGER;

  protected readonly saved = signal('');
  protected readonly problem = signal<string | null>(null);

  private readonly total = this.data.readable + this.data.unreadable;
  protected readonly title = computed(() =>
    this.total === 1 ? 'Delete 1 canvas?' : `Delete all ${this.total} canvases?`,
  );
  protected readonly confirm = computed(() =>
    this.total === 1 ? 'Delete 1 canvas' : `Delete all ${this.total} canvases`,
  );
  protected readonly what = computed(() => {
    const { readable, unreadable } = this.data;
    const opened = `${readable} that can be opened`;
    const closed =
      unreadable === 0
        ? ''
        : `, and ${unreadable} that this version of the app cannot open, which a backup cannot hold`;
    return `This deletes every canvas in this browser: ${opened}${closed}.`;
  });

  /** Saves the backup and says what it saved, or why not. It can be used again, and says what it did each time. */
  protected async backup(): Promise<void> {
    this.problem.set(null);
    const done = await this.data.backup();
    if (done.ok) {
      this.saved.set(backupDone(done.value));
    } else {
      this.saved.set('');
      this.problem.set(done.error);
    }
  }
}
