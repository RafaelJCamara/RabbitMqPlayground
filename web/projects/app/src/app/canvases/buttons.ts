/**
 * The look of the buttons of the canvases (ADR-0032): one string for each, so that the home, the strip and the dialogs have the same ones. A button always has a
 * name in words, and an icon beside it is decoration.
 */

const BASE =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-60';

/** An ordinary button. */
export const BUTTON = `${BASE} border-border bg-surface hover:bg-canvas`;

/** The button that most learners will want, on a screen that has one. */
export const BUTTON_PRIMARY = `${BASE} border-accent bg-accent text-accent-fg hover:opacity-90`;

/** A button that takes something away. It is also said in words, and the colour is not the only sign of it (WCAG 1.4.1). */
export const BUTTON_DANGER = `${BASE} border-danger bg-danger text-accent-fg hover:opacity-90`;

const TAB = 'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 py-1';

/**
 * An item of the strip of open canvases: the one that is shown has a border in the colour of the accent and its name in bold, and is also `aria-current`, so that
 * the colour is not the only sign of it (WCAG 1.4.1).
 */
export const tabClass = (current: boolean): string =>
  `${TAB} ${current ? 'border-accent bg-surface font-semibold' : 'border-border bg-panel hover:bg-canvas'}`;
