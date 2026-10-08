import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CONFIRM_BODY_ID, CONFIRM_TITLE_ID, ConfirmDialog, type ConfirmData } from './confirm-dialog';
import { NAME_DIALOG_TITLE_ID, NameDialog, type NameDialogData } from './name-dialog';

/** What every dialog of the canvases is opened with: modal, with a backdrop, the focus given back to what had it. */
const MODAL = {
  ariaModal: true,
  backdropClass: 'cdk-overlay-dark-backdrop',
  autoFocus: 'first-tabbable',
  restoreFocus: true,
} as const;

/** Opens the dialogs of the canvases, one at a time (ADR-0072, ADR-0074). */
@Injectable({ providedIn: 'root' })
export class CanvasDialogs {
  private readonly dialog = inject(Dialog);

  /** Asks for the new name of a canvas. */
  rename(data: NameDialogData): void {
    this.dialog.open(NameDialog, { ...MODAL, data, ariaLabelledBy: NAME_DIALOG_TITLE_ID });
  }

  /** Asks before something is taken away. The answer is `true` only if the learner pressed the button that does it. */
  async confirm(data: ConfirmData): Promise<boolean> {
    const ref = this.dialog.open<boolean, ConfirmData, ConfirmDialog>(ConfirmDialog, {
      ...MODAL,
      data,
      role: 'alertdialog',
      ariaLabelledBy: CONFIRM_TITLE_ID,
      ariaDescribedBy: CONFIRM_BODY_ID,
    });
    return (await firstValueFrom(ref.closed)) === true;
  }
}
