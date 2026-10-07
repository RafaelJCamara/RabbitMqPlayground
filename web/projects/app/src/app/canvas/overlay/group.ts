import type { Marker } from './edges';

/**
 * What a crowd is drawn as (ADR-0055). A burst is one picture: the messages that are on the same edge, in the same place along it, are one shape with a count, so a
 * burst of twenty is one marker that says ×20. When there are more than `limit` shapes after that, which is a producer that sends fast, the messages are grouped by
 * edge and by thirty-second of the way, so that a thousand are never more than a few hundred shapes. It is a function of the markers, and the drawing is a few lines.
 */

export interface Sprite {
  readonly edge: string;
  /** Where along the edge it is drawn, from 0 to 1: the place of its messages, or the mean of the places of the messages in a dense group. */
  readonly at: number;
  /** How many messages it stands for. */
  readonly count: number;
  /** The routing key of its messages, when they share it, and `null` when they do not. */
  readonly key: string | null;
  /** Whether any of its messages is one that went back to its queue. */
  readonly redelivered: boolean;
  /** The number of its message when it stands for one, and `null` for a crowd, which no one message is the shape of (ADR-0063). */
  readonly message: number | null;
}

/** How many shapes a canvas is drawn with before a crowd is grouped by place. */
export const SHAPE_LIMIT = 500;

/** How many parts of an edge a dense group is made along it. */
export const DENSE_PARTS = 32;

/** Messages are in the same place when they are within a thousandth of the way of one another. */
const SAME_PLACE = 1_000;

function collect(markers: readonly Marker[], keyOf: (marker: Marker) => string): Sprite[] {
  const groups = new Map<
    string,
    { edge: string; at: number; count: number; key: string | null; redelivered: boolean; message: number | null }
  >();
  for (const marker of markers) {
    const key = keyOf(marker);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        edge: marker.edge,
        at: marker.at,
        count: 1,
        key: marker.key,
        redelivered: marker.redelivered,
        message: marker.message,
      });
    } else {
      group.at = (group.at * group.count + marker.at) / (group.count + 1);
      group.count += 1;
      group.key = group.key === marker.key ? group.key : null;
      group.redelivered ||= marker.redelivered;
      group.message = null;
    }
  }
  return [...groups.values()];
}

export function groupMarkers(markers: readonly Marker[], limit = SHAPE_LIMIT): Sprite[] {
  const sprites = collect(markers, ({ edge, at }) => `${edge}|${Math.round(at * SAME_PLACE)}`);
  return sprites.length <= limit
    ? sprites
    : collect(markers, ({ edge, at }) => `${edge}|${Math.min(DENSE_PARTS - 1, Math.floor(at * DENSE_PARTS))}`);
}
