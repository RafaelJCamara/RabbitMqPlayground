/**
 * The look of the buttons that the screens of the app share (ADR-0032): one string for each, so that the home, the strip, the dialogs and the notices have the same
 * ones. A button always has a name in words, and an icon beside it is decoration.
 */

const BASE =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-60';

/** An ordinary button. */
export const BUTTON = `${BASE} border-border bg-surface hover:bg-canvas`;

/** The button that most learners will want, on a screen that has one. */
export const BUTTON_PRIMARY = `${BASE} border-accent bg-accent text-accent-fg hover:opacity-90`;

/** A button that takes something away. It is also said in words, and the colour is not the only sign of it (WCAG 1.4.1). */
export const BUTTON_DANGER = `${BASE} border-danger bg-danger text-accent-fg hover:opacity-90`;
