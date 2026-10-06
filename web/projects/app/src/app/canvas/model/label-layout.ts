import type { CanvasVm } from './canvas-vm';
import { estimateLabelSize, placeLabels, type LabelBox } from './label-placement';
import { polylineOf } from './path';

/**
 * The places of the labels of a view model (ADR-0044), from the paths that the library has drawn. `pathOf` answers the `d` of the path of an edge, or
 * `null` while the library has not drawn it, and an edge that has no path is left out, so that its label stays where it is until it has one. The
 * labels that the document puts somewhere are put down first, as things to keep away from, and the nodes are in the way too.
 */
export function labelPlaces(model: CanvasVm, pathOf: (key: string) => string | null): Map<string, number> {
  const boxes: LabelBox[] = [];
  for (const edge of model.edges) {
    const d = edge.chips.length === 0 ? null : pathOf(edge.id);
    const line = d === null ? null : polylineOf(d);
    if (line !== null) {
      boxes.push({
        key: edge.id,
        line,
        ...estimateLabelSize(edge.chips, edge.more.length),
        ...(edge.labelAt === undefined ? {} : { fixed: edge.labelAt }),
      });
    }
  }
  return placeLabels(
    boxes,
    model.nodes.map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
}

/** Whether two sets of places are the same, so that the same places are not set again, which would draw every label again. */
export function samePlaces(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([key, at]) => b.get(key) === at);
}
