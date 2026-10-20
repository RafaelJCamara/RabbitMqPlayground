import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { EXPORT_TITLE_ID, ExportDialog, type ExportDialogData } from './export-dialog';
import { IMPORT_TITLE_ID, ImportDialog, type ImportDialogData } from './import-dialog';
import { SHARE_TITLE_ID, SharePanel, type SharePanelData } from './share-panel';

/** What every dialog of sharing is opened with: modal, with the dark backdrop that the overlay gives, the cursor on the first control, and the focus given back to what had it. */
const MODAL = {
  ariaModal: true,
  autoFocus: 'first-tabbable',
  restoreFocus: true,
} as const;

/** Opens the panel that makes a link, the dialog that exports for a broker and the one that imports from one (ADR-0078, ADR-0079, ADR-0111), one at a time. */
@Injectable({ providedIn: 'root' })
export class ShareDialogs {
  private readonly dialog = inject(Dialog);
  private isOpen = false;

  /** The panel that makes a link to a canvas. */
  share(data: SharePanelData): void {
    this.open(() =>
      this.dialog.open<void, SharePanelData, SharePanel>(SharePanel, {
        ...MODAL,
        data,
        ariaLabelledBy: SHARE_TITLE_ID,
      }),
    );
  }

  /** The dialog that exports a canvas as a definitions file. */
  exportDefinitions(data: ExportDialogData): void {
    this.open(() =>
      this.dialog.open<void, ExportDialogData, ExportDialog>(ExportDialog, {
        ...MODAL,
        data,
        ariaLabelledBy: EXPORT_TITLE_ID,
      }),
    );
  }

  /** The dialog that imports a definitions file into the canvas (ADR-0111). */
  importDefinitions(data: ImportDialogData): void {
    this.open(() =>
      this.dialog.open<void, ImportDialogData, ImportDialog>(ImportDialog, {
        ...MODAL,
        data,
        ariaLabelledBy: IMPORT_TITLE_ID,
      }),
    );
  }

  /** Opens one of them, unless one is open. */
  private open(make: () => { readonly closed: Observable<unknown> }): void {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    make().closed.subscribe(() => {
      this.isOpen = false;
    });
  }
}
