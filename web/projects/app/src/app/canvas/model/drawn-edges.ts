/**
 * Telling when an edge has been drawn (ADR-0016, workaround 3). Foblex computes the geometry of a connection a moment after
 * the element appears: a debounce, a round trip to a Web Worker, and a few slices of a frame. An `<f-connection>` therefore
 * exists before its path does, and a test, or the overlay of a later slice, that asks for the path of an edge in that moment
 * gets none. A path is drawn when its `d` attribute is set, so this watches for that, and says which edges are drawn and which
 * are gone.
 *
 * An edge element carries `data-edge`, the key of the edge. When its path is drawn the element also gets `data-edge-id`, which
 * is how the end-to-end tests ask for "the edges that are drawn" in the page.
 */

export const EDGE_ATTRIBUTE = 'data-edge';
export const DRAWN_ATTRIBUTE = 'data-edge-id';

export interface DrawnReport {
  drawn(ids: string[]): void;
  gone(ids: string[]): void;
}

const isEdgePath = (element: Element): boolean => element.classList.contains('f-connection-path');

/** The edge that this path belongs to, and has drawn, or `null` when it is not the path of an edge, or has no `d` yet. */
function drawnEdgeOf(path: Element): { readonly element: Element; readonly id: string } | null {
  if (!isEdgePath(path) || (path.getAttribute('d') ?? '') === '') {
    return null;
  }
  const element = path.closest(`[${EDGE_ATTRIBUTE}]`);
  const id = element?.getAttribute(EDGE_ATTRIBUTE);
  return element === null || element === undefined || id === null || id === undefined ? null : { element, id };
}

/** The keys of the edges in a removed subtree: the element itself, or the elements below it. */
function removedEdges(node: Node): string[] {
  if (!(node instanceof Element)) {
    return [];
  }
  const elements = node.hasAttribute(EDGE_ATTRIBUTE) ? [node] : [];
  elements.push(...node.querySelectorAll(`[${EDGE_ATTRIBUTE}]`));
  return elements.flatMap((element) => element.getAttribute(EDGE_ATTRIBUTE) ?? []);
}

/**
 * Watches the container of the connections, and reports each edge as it is drawn and as it goes. The edges that are already
 * drawn when it starts are reported first. It answers the function that stops it.
 */
export function watchDrawnEdges(container: Element, report: DrawnReport): () => void {
  const mark = (path: Element): string | null => {
    const edge = drawnEdgeOf(path);
    if (edge === null) {
      return null;
    }
    if (!edge.element.hasAttribute(DRAWN_ATTRIBUTE)) {
      edge.element.setAttribute(DRAWN_ATTRIBUTE, edge.id);
    }
    return edge.id;
  };

  const existing = [...container.querySelectorAll('.f-connection-path')].flatMap((path) => mark(path) ?? []);
  if (existing.length > 0) {
    report.drawn(existing);
  }

  const observer = new MutationObserver((records) => {
    const drawn = new Set<string>();
    const gone = new Set<string>();
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        const id = mark(record.target);
        if (id !== null) {
          drawn.add(id);
          gone.delete(id);
        }
      }
      for (const removed of record.removedNodes) {
        for (const id of removedEdges(removed)) {
          gone.add(id);
          drawn.delete(id);
        }
      }
    }
    if (drawn.size > 0) {
      report.drawn([...drawn]);
    }
    if (gone.size > 0) {
      report.gone([...gone]);
    }
  });
  observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['d'], childList: true });
  return () => observer.disconnect();
}
