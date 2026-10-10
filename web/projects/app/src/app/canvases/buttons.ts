/** The buttons of the canvases are the app's (ADR-0032); the item of the strip of open canvases is the canvases' own. */
export { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '../core/ui/buttons';

const TAB = 'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 py-1';

/**
 * An item of the strip of open canvases: the one that is shown has a border in the colour of the accent and its name in bold, and is also `aria-current`, so that
 * the colour is not the only sign of it (WCAG 1.4.1).
 */
export const tabClass = (current: boolean): string =>
  `${TAB} ${current ? 'border-accent bg-surface font-semibold' : 'border-border bg-panel hover:bg-canvas'}`;

const TAB_BOX = 'inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-md border py-0.5 pr-1 pl-3';

/**
 * The box of the tab of an open canvas (ADR-0096): the border, the shape and the colours of an item of the strip, around two buttons that have none of their own, the name
 * and the close, so that the close is inside the box, at its right end. The colours are the same as `tabClass`.
 */
export const tabBoxClass = (current: boolean): string =>
  `${TAB_BOX} ${current ? 'border-accent bg-surface font-semibold' : 'border-border bg-panel hover:bg-canvas'}`;

/** The name inside the box of a tab: a button with no border, which is what is pressed to show the canvas and what is renamed. */
export const TAB_NAME = 'inline-flex min-h-6 items-center rounded-sm';

/** The close inside the box of a tab: 24 by 24 pixels at least (WCAG 2.5.8), with no border of its own. */
export const TAB_CLOSE = 'inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-border';
