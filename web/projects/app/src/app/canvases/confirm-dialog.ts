import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { BUTTON, BUTTON_DANGER } from './buttons';

export const CONFIRM_TITLE_ID = 'rmq-confirm-title';
export const CONFIRM_BODY_ID = 'rmq-confirm-body';

/** What a dialog that asks before something is taken away says (ADR-0074). */
export interface ConfirmData {
  /** The question, which is also what a screen reader says the dialog is: "Delete “Orders”?". */
  readonly title: string;
  /** What it will do and what can be done about it, one paragraph for each. */
  readonly body: readonly string[];
  /** The words on the button that does it: "Delete canvas". */
  readonly confirm: string;
}

/**
 * The dialog that asks before a canvas is deleted (ADR-0074): a question, what it does, and two buttons. The focus starts on Cancel, because the safe act is the one
 * that a key should reach first, and the button that does it is a danger and says what it does. It closes with `true` for that button and with nothing for any
 * other way out: Cancel, Escape and a press on the backdrop.
 */
@Component({
  selector: 'rmq-confirm-dialog',
  template: `
    <div
      class="bg-panel text-fg border-border flex w-[min(30rem,92vw)] flex-col gap-3 rounded-lg border p-4 shadow-xl"
      data-testid="confirm-dialog"
    >
      <h2 class="text-base font-semibold" [id]="titleId">{{ data.title }}</h2>
      <div class="flex flex-col gap-2" [id]="bodyId">
        @for (line of data.body; track $index) {
          <p>{{ line }}</p>
        }
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" cdkFocusInitial [class]="button" (click)="ref.close(false)">Cancel</button>
        <button type="button" [class]="danger" data-testid="confirm" (click)="ref.close(true)">
          {{ data.confirm }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly titleId = CONFIRM_TITLE_ID;
  protected readonly bodyId = CONFIRM_BODY_ID;
  protected readonly button = BUTTON;
  protected readonly danger = BUTTON_DANGER;
}
