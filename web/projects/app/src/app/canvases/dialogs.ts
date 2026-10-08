import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CONFIRM_BODY_ID, CONFIRM_TITLE_ID, ConfirmDialog, type ConfirmData } from './confirm-dialog';
import { DELETE_ALL_BODY_ID, DELETE_ALL_TITLE_ID, DeleteAllDialog, type DeleteAllData } from './delete-all-dialog';
import { MESSAGE_BODY_ID, MESSAGE_TITLE_ID, MessageDialog, type MessageData } from './message-dialog';
import { NAME_DIALOG_TITLE_ID, NameDialog, type NameDialogData } from './name-dialog';
import { RESTORE_TITLE_ID, RestoreDialog, type RestoreDialogData } from './restore-dialog';

/** What every dialog of the canvases is opened with: modal, with the dark backdrop that the overlay gives, the focus given back to what had it. */
const MODAL = {
  ariaModal: true,
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

  /** Asks before every canvas is deleted, and offers a backup first. The answer is `true` only if the learner pressed the button that deletes. */
  async deleteAll(data: DeleteAllData): Promise<boolean> {
    const ref = this.dialog.open<boolean, DeleteAllData, DeleteAllDialog>(DeleteAllDialog, {
      ...MODAL,
      data,
      role: 'alertdialog',
      ariaLabelledBy: DELETE_ALL_TITLE_ID,
      ariaDescribedBy: DELETE_ALL_BODY_ID,
    });
    return (await firstValueFrom(ref.closed)) === true;
  }

  /** Says why a file could not be opened or put back, and waits to be read. */
  async problem(data: MessageData): Promise<void> {
    const ref = this.dialog.open<void, MessageData, MessageDialog>(MessageDialog, {
      ...MODAL,
      data,
      role: 'alertdialog',
      ariaLabelledBy: MESSAGE_TITLE_ID,
      ariaDescribedBy: MESSAGE_BODY_ID,
    });
    await firstValueFrom(ref.closed);
  }

  /** Says what came of putting a backup back, and waits to be read. */
  async restored(data: RestoreDialogData): Promise<void> {
    const ref = this.dialog.open<void, RestoreDialogData, RestoreDialog>(RestoreDialog, {
      ...MODAL,
      data,
      ariaLabelledBy: RESTORE_TITLE_ID,
    });
    await firstValueFrom(ref.closed);
  }
}
