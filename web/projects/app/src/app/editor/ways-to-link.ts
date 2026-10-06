/** One way to link, in two lengths: a few words for the card of the first run, which has little room, and the whole sentence for the cheat-sheet. */
export interface Way {
  readonly short: string;
  readonly full: string;
}

/**
 * The five ways to link (ADR-0041), as a learner is told them (ADR-0047): by the card that the first run shows, and by the cheat-sheet. They are written
 * in the words of what is on the screen, so that a learner can find each: the dot on the right of a node, "Link to…", the key `L`.
 */
export const WAYS_TO_LINK: readonly Way[] = [
  {
    short: 'Drag from the dot on the right of a node',
    full: 'Drag from the dot on the right of a node to the node that it goes to.',
  },
  {
    short: 'Click the dot, then click the target',
    full: 'Click the dot on the right of a node, then click the node that it goes to.',
  },
  {
    short: 'Press Link to… in the inspector',
    full: 'Press Link to… in the inspector, and choose the target in the list.',
  },
  {
    short: 'Right-click a node and choose Link to…',
    full: 'Right-click a node and choose Link to…, then choose the target in the list.',
  },
  {
    short: 'Select a node and press L',
    full: 'Select a node and press L, then choose the target with the arrow keys and press Enter.',
  },
];
