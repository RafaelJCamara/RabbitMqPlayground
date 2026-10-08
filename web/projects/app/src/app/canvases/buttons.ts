/** The buttons of the canvases are the app's (ADR-0032); the item of the strip of open canvases is the canvases' own. */
export { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '../core/ui/buttons';

const TAB = 'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 py-1';

/**
 * An item of the strip of open canvases: the one that is shown has a border in the colour of the accent and its name in bold, and is also `aria-current`, so that
 * the colour is not the only sign of it (WCAG 1.4.1).
 */
export const tabClass = (current: boolean): string =>
  `${TAB} ${current ? 'border-accent bg-surface font-semibold' : 'border-border bg-panel hover:bg-canvas'}`;
