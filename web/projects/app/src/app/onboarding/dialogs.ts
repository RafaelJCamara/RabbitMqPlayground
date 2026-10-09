import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BLANK, CHOOSER_TITLE_ID, TemplateChooser, type Choice, type ChooserData } from './template-chooser';

/** Opens the chooser: modal, with the cursor on the first control and given back to what had it, as the other dialogs are. */
const MODAL = {
  ariaModal: true,
  autoFocus: 'first-tabbable',
  restoreFocus: true,
} as const;

/** Asks what to start with (ADR-0082), one question at a time. */
@Injectable({ providedIn: 'root' })
export class OnboardingDialogs {
  private readonly dialog = inject(Dialog);
  private isOpen = false;

  /**
   * Asks, and answers the choice. At the first run, leaving it by Escape, the backdrop or Cancel is "from scratch", so that the learner is never left without a canvas to build on; from
   * the home it is nothing (`undefined`), because they asked for a template and changed their mind. It answers nothing at once when it is already asking.
   */
  async choose(options: { readonly first: boolean }): Promise<Choice | undefined> {
    if (this.isOpen) {
      return undefined;
    }
    this.isOpen = true;
    const data: ChooserData = { first: options.first };
    const ref = this.dialog.open<Choice | undefined, ChooserData, TemplateChooser>(TemplateChooser, {
      ...MODAL,
      data,
      ariaLabelledBy: CHOOSER_TITLE_ID,
    });
    const chosen = await firstValueFrom(ref.closed);
    this.isOpen = false;
    return chosen ?? (options.first ? BLANK : undefined);
  }
}
