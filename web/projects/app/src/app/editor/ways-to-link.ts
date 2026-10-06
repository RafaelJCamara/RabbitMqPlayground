/**
 * The five ways to link (ADR-0041), as a learner is told them (ADR-0047): by the card that the first run shows, and by the cheat-sheet. They are written
 * in the words of what is on the screen, so that a learner can find each: the dot on the right of a node, "Link to…", the key `L`.
 */
export const WAYS_TO_LINK: readonly string[] = [
  'Drag from the dot on the right of a node to the node that it goes to.',
  'Click the dot on the right of a node, then click the node that it goes to.',
  'Press Link to… in the inspector, and choose the target in the list.',
  'Right-click a node and choose Link to…, then choose the target in the list.',
  'Select a node and press L, then choose the target with the arrow keys and press Enter.',
];
