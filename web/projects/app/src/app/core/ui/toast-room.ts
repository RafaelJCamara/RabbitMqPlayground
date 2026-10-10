/**
 * The two lengths that the notices and the screens agree on (ADR-0097), as custom properties of the page, because the notices float over the screens and a screen has to leave room for
 * what floats over it, or stay clear of it (ADR-0085).
 *
 * - `--toast-room` is how much the stack of notices takes from the bottom of a scrolling area at the right of the page, its height and the space around it, and `0px` when there is no notice. A screen
 *   that scrolls adds it as padding at its foot and as `scroll-padding`, so that its last control can always be scrolled above the stack and a control that gets the cursor is brought clear of it.
 * - `--toast-bottom` is how far the editor lifts the stack above the bars at its foot (the log, the command bar, the hints and the status), so that the stack floats over the inspector and never over the bars.
 */
export const TOAST_ROOM = '--toast-room';
export const TOAST_LIFT = '--toast-bottom';

/** The space under and over a stack of notices: a gap under the stack, and a gap between the stack and what is above it. */
export const TOAST_GAP = 12;

/** Sets a length of the page, or takes it away when it is none, so that the fallback of the style (`0px`) holds. */
export function setPageLength(page: Document, name: string, pixels: number): void {
  const style = page.documentElement.style;
  if (pixels > 0) {
    style.setProperty(name, `${Math.round(pixels)}px`);
  } else {
    style.removeProperty(name);
  }
}
