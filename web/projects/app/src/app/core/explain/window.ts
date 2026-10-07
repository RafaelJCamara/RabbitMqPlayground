/**
 * The part of a long list that is in the page (ADR-0061): the rows that the scroll shows and a few over, and the space above and below that makes the scrollbar the size of the whole list. A function of the
 * count, the height of a row, how far the list is scrolled and how tall the viewport is, so that it is held by a spec and does not need a viewport that jsdom has not got.
 */

/** How many rows are drawn beyond the ones that show, at each end, so that a scroll that is quick finds them already there. */
export const OVERSCAN = 4;

export interface RowWindow {
  /** The rows from `start` up to, and not including, `end` are drawn. */
  readonly start: number;
  readonly end: number;
  /** The height, in pixels, of the rows before `start` and after `end`, which are a space. */
  readonly before: number;
  readonly after: number;
}

const clamp = (value: number, least: number, most: number): number => Math.min(most, Math.max(least, value));

/** The rows to draw. A row that has no height yet (nothing has been measured) is taken to be a pixel, so that a list that is not laid out draws its first rows and not all of them. */
export function windowOf(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
  overscan: number = OVERSCAN,
): RowWindow {
  const height = rowHeight > 0 ? rowHeight : 1;
  const first = Math.floor(Math.max(0, scrollTop) / height);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / height);
  const start = clamp(first - overscan, 0, count);
  const end = clamp(last + overscan, start, count);
  return { start, end, before: start * height, after: (count - end) * height };
}

/** The scroll that shows a row: where it is already, when the row shows, and else the least that brings it in at the edge that it is past. */
export function scrollFor(index: number, rowHeight: number, scrollTop: number, viewport: number): number {
  const top = index * rowHeight;
  if (top < scrollTop) {
    return top;
  }
  return top + rowHeight > scrollTop + viewport ? top + rowHeight - viewport : scrollTop;
}

/** Whether the list is scrolled to its end, to a couple of pixels, which is when it follows the newest row. */
export const atBottom = (count: number, rowHeight: number, scrollTop: number, viewport: number): boolean =>
  scrollTop + viewport >= count * rowHeight - 2;
