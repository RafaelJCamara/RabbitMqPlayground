import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { BUTTON_PRIMARY } from './buttons';

export const MESSAGE_TITLE_ID = 'rmq-message-title';
export const MESSAGE_BODY_ID = 'rmq-message-body';

/** What a dialog that says something and waits to be read needs (ADR-0075). */
export interface MessageData {
  /** What happened, which is also what a screen reader says the dialog is: "“orders.json” could not be opened". */
  readonly title: string;
  /** The root cause first, one paragraph for each sentence that is worth its own line. */
  readonly body: readonly string[];
}

/**
 * The dialog that says why a file could not be opened or put back (ADR-0075): what happened, and why, in the words of the loader, and one button. Nothing was changed, and the
 * body says so when the loader does. The cursor starts on the button, because there is nothing to type and nothing to choose.
 */
@Component({
  selector: 'rmq-message-dialog',
  template: `
    <div
      class="bg-panel text-fg border-border flex w-[min(32rem,92vw)] flex-col gap-3 rounded-lg border p-4 shadow-xl"
      data-testid="message-dialog"
    >
      <h2 class="text-base font-semibold" [id]="titleId">{{ data.title }}</h2>
      <div class="flex flex-col gap-2" [id]="bodyId">
        @for (line of data.body; track $index) {
          <p>{{ line }}</p>
        }
      </div>
      <div class="flex justify-end">
        <button type="button" cdkFocusInitial [class]="primary" (click)="ref.close()">OK</button>
      </div>
    </div>
  `,
})
export class MessageDialog {
  protected readonly data = inject<MessageData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  protected readonly titleId = MESSAGE_TITLE_ID;
  protected readonly bodyId = MESSAGE_BODY_ID;
  protected readonly primary = BUTTON_PRIMARY;
}
