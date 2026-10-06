/**
 * Telling when an edge has been drawn (ADR-0016, workaround 3). Foblex computes the geometry of a connection a moment after
 * the element appears: a debounce, a round trip to a Web Worker, and a few slices of a frame. An `<f-connection>` therefore
 * exists before its path does, and a test, or the overlay of a later slice, that asks for the path of an edge in that moment
 * gets none. A path is drawn when its `d` attribute is set, so this watches for that, and says which edges are drawn and which
 * are gone.
 *
 * An edge element carries `data-edge`, the key of the edge. When its path is drawn the element also gets `data-edge-id`, which
 * is how the end-to-end tests ask for "the edges that are drawn" in the page.
 *
 * What is drawn is read from the page, and not worked out from what changed: the library moves the element of an edge to the top
 * when it is selected, which takes it out of the container and puts it back, and a report of what went away would say that an edge
 * is gone that is there.
 */

export const EDGE_ATTRIBUTE = 'data-edge';
export const DRAWN_ATTRIBUTE = 'data-edge-id';

export interface DrawnReport {
  drawn(ids: string[]): void;
  gone(ids: string[]): void;
}

const hasPath = (path: Element): boolean => (path.getAttribute('d') ?? '') !== '';

/**
 * Watches the container of the connections, and reports each edge as it is drawn and as it goes. The edges that are already
 * drawn when it starts are reported first. It answers the function that stops it.
 */
export function watchDrawnEdges(container: Element, report: DrawnReport): () => void {
  /** The keys of the edges that were said to be drawn, and have not been said to be gone. */
  let known = new Set<string>();

  /** The keys of the edges that are in the container and whose path is drawn. It marks the element of each. */
  const scan = (): Set<string> => {
    const drawn = new Set<string>();
    for (const element of container.querySelectorAll(`[${EDGE_ATTRIBUTE}]`)) {
      const id = element.getAttribute(EDGE_ATTRIBUTE);
      const path = element.querySelector('.f-connection-path');
      if (id !== null && path !== null && hasPath(path)) {
        drawn.add(id);
        element.setAttribute(DRAWN_ATTRIBUTE, id);
      }
    }
    return drawn;
  };

  const update = (): void => {
    const now = scan();
    const drawn = [...now].filter((id) => !known.has(id));
    const gone = [...known].filter((id) => !now.has(id));
    known = now;
    if (drawn.length > 0) {
      report.drawn(drawn);
    }
    if (gone.length > 0) {
      report.gone(gone);
    }
  };

  /** A path that gets another `d` is no news, and nor is anything that is not the path of an edge. It is news when it gets one, or loses it. */
  const changesWhatIsDrawn = (record: MutationRecord): boolean => {
    if (record.type === 'childList') {
      return true;
    }
    const path = record.target;
    if (!(path instanceof Element) || !path.classList.contains('f-connection-path')) {
      return false;
    }
    const id = path.closest(`[${EDGE_ATTRIBUTE}]`)?.getAttribute(EDGE_ATTRIBUTE);
    return id !== null && id !== undefined && hasPath(path) !== known.has(id);
  };

  update();
  const observer = new MutationObserver((records) => {
    if (records.some(changesWhatIsDrawn)) {
      update();
    }
  });
  observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['d'], childList: true });
  return () => observer.disconnect();
}
