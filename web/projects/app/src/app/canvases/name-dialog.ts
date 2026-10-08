import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { afterNextRender, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { Outcome } from '@rmq/persistence';
import { BUTTON, BUTTON_PRIMARY } from './buttons';
import { nameProblem } from './names';

export const NAME_DIALOG_TITLE_ID = 'rmq-name-dialog-title';

/** What the dialog that asks for a name needs (ADR-0072). */
export interface NameDialogData {
  /** The title, which is also what a screen reader says the dialog is: "Rename canvas". */
  readonly title: string;
  /** The name to start from, which is selected. */
  readonly name: string;
  /** The words on the button that does it: "Rename". */
  readonly confirm: string;
  /** Does it. A problem comes back in words, and keeps the dialog open with the reason under the field. */
  readonly submit: (name: string) => Promise<Outcome<void, string>>;
}

/**
 * The dialog that asks for a name (ADR-0072): a field with the name selected, and a button that is never switched off. A name that cannot be used is said under the
 * field, root cause first, and the cursor goes back into it, as the field of a binding's key does (ADR-0041).
 */
@Component({
  selector: 'rmq-name-dialog',
  template: `
    <form
      class="bg-panel text-fg border-border flex w-[min(28rem,92vw)] flex-col gap-3 rounded-lg border p-4 shadow-xl"
      novalidate
      data-testid="name-dialog"
      (submit)="onSubmit($event)"
    >
      <h2 class="text-base font-semibold" [id]="titleId">{{ data.title }}</h2>
      <label class="flex flex-col gap-1">
        <span class="font-medium">Name</span>
        <input
          #field
          type="text"
          class="border-border bg-surface rounded-md border px-2 py-1.5"
          autocomplete="off"
          spellcheck="false"
          [value]="text()"
          [attr.aria-invalid]="error() === null ? null : 'true'"
          [attr.aria-describedby]="error() === null ? null : errorId"
          (input)="onInput($event)"
        />
      </label>
      @if (error(); as message) {
        <p [id]="errorId" class="text-danger" role="alert" data-testid="name-error">{{ message }}</p>
      }
      <div class="flex justify-end gap-2">
        <button type="button" [class]="button" (click)="ref.close()">Cancel</button>
        <button type="submit" [class]="primary">{{ data.confirm }}</button>
      </div>
    </form>
  `,
})
export class NameDialog {
  protected readonly data = inject<NameDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  protected readonly titleId = NAME_DIALOG_TITLE_ID;
  protected readonly errorId = 'rmq-name-dialog-error';
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;

  protected readonly text = signal(this.data.name);
  protected readonly error = signal<string | null>(null);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    afterNextRender(() => this.field().nativeElement.select());
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.text().trim();
    const problem = nameProblem(name);
    if (problem !== null) {
      this.refuse(problem);
      return;
    }
    const done = await this.data.submit(name);
    if (done.ok) {
      this.ref.close();
    } else {
      this.refuse(done.error);
    }
  }

  private refuse(problem: string): void {
    this.error.set(problem);
    this.field().nativeElement.focus();
  }
}
