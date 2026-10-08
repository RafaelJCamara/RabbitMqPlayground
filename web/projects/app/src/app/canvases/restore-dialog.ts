import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import type { RestoreView } from './backup-words';
import { BUTTON_PRIMARY } from './buttons';

export const RESTORE_TITLE_ID = 'rmq-restore-title';

/** What the report of a restore needs (ADR-0075). */
export interface RestoreDialogData {
  readonly title: string;
  readonly view: RestoreView;
}

/**
 * What came of putting a backup back (ADR-0075), in the order of what happened: what was put back, what was left, what was added as a copy, and then, as a list, what could not
 * be read or written, with the reason of each. At most 20 are listed, and the rest are counted. It scrolls inside itself when it is taller than the window.
 */
@Component({
  selector: 'rmq-restore-dialog',
  template: `
    <div
      class="bg-panel text-fg border-border flex max-h-[85dvh] w-[min(36rem,92vw)] flex-col gap-3 overflow-y-auto rounded-lg border p-4 shadow-xl"
      data-testid="restore-dialog"
    >
      <h2 class="text-base font-semibold" [id]="titleId">{{ data.title }}</h2>
      @for (line of data.view.summary; track $index) {
        <p data-testid="restore-summary">{{ line }}</p>
      }
      @if (data.view.problems.length > 0) {
        <section aria-labelledby="rmq-restore-problems">
          <h3 class="font-semibold" id="rmq-restore-problems">What could not be put back</h3>
          <ul class="mt-1 list-disc pl-5" data-testid="restore-problems">
            @for (problem of data.view.problems; track $index) {
              <li>{{ problem }}</li>
            }
          </ul>
          @if (data.view.more > 0) {
            <p class="text-muted mt-1" data-testid="restore-more">and {{ data.view.more }} more.</p>
          }
        </section>
      }
      <div class="flex justify-end">
        <button type="button" cdkFocusInitial [class]="primary" (click)="ref.close()">OK</button>
      </div>
    </div>
  `,
})
export class RestoreDialog {
  protected readonly data = inject<RestoreDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  protected readonly titleId = RESTORE_TITLE_ID;
  protected readonly primary = BUTTON_PRIMARY;
}
