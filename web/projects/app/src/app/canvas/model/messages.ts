import { nodeIdOf } from './connector-ids';
import { lowerFirst } from './labels';

/**
 * What a screen reader hears from the canvas, in our words (ADR-0017, section 5). It has the shape of the catalogue of messages
 * that Foblex's keyboard layer speaks, so the adapter hands it over as it is, and a spec holds it: a message that is wrong
 * is spoken at every key press. The labels that come in are our own (`Queue billing`), so a sentence reads on from them.
 *
 * The library speaks as it acts, before the editor has applied the command that the action means, so the messages that
 * end an action say what is being done, and the editor says what was done, or why it could not be.
 */
export interface A11yMessages {
  /** What the canvas is, for the role description of the widget that has the focus. */
  flow: string;
  node: string;
  group: string;
  connection: string;
  /** The standing instructions of the canvas: its keys. */
  instructions: string;
  connectionLabel(sourceId: string, targetId: string): string;
  nodeFocused(label: string, index: number, total: number): string;
  connectionFocused(label: string): string;
  allSelected(count: number): string;
  selectionCleared: string;
  itemsCount(count: number): string;
  grabbed(label: string): string;
  moved(x: number, y: number): string;
  dropped(label: string, x: number, y: number): string;
  moveCancelled(label: string): string;
  connectStarted(sourceLabel: string): string;
  connectTarget(label: string, index: number, total: number): string;
  connected(sourceLabel: string, targetLabel: string): string;
  connectCancelled: string;
  connectUnavailable: string;
  connectRequiresSingleNode: string;
  deleteRequested(count: number): string;
  zoom(percent: number): string;
}

const items = (count: number): string => `${count} ${count === 1 ? 'item' : 'items'}`;

export const RMQ_A11Y_MESSAGES: A11yMessages = {
  flow: 'topology editor',
  node: 'node',
  group: 'group',
  connection: 'connection',
  instructions:
    'Use the arrow keys to move between nodes and connections, and Shift with an arrow to select more than one. ' +
    'Control and an arrow follows a connection. M picks up the selection and the arrow keys move it, then M drops it, ' +
    'or Escape puts it back. L links the selected node: choose a target with the arrow keys and press Enter, or Escape to ' +
    'cancel. Delete removes the selection, F2 renames it, and Control and Z undoes the last change.',
  connectionLabel: (sourceId, targetId) => `Connection from ${nodeIdOf(sourceId)} to ${nodeIdOf(targetId)}`,
  nodeFocused: (label, index, total) => `${label}, ${index} of ${total}`,
  connectionFocused: (label) => label,
  allSelected: (count) => `Everything is selected: ${items(count)}`,
  selectionCleared: 'Selection cleared',
  itemsCount: items,
  grabbed: (label) =>
    `${label} picked up. The arrow keys move it, and Shift with an arrow moves it further. M drops it, and Escape puts it back.`,
  moved: (x, y) => `Moved to ${x}, ${y}`,
  dropped: (label, x, y) => `${label} dropped at ${x}, ${y}`,
  moveCancelled: (label) => `${label} put back`,
  connectStarted: (sourceLabel) => `Linking from ${lowerFirst(sourceLabel)}`,
  connectTarget: (label, index, total) => `Target ${index} of ${total}: ${lowerFirst(label)}`,
  connected: (sourceLabel, targetLabel) => `Linking ${lowerFirst(sourceLabel)} to ${lowerFirst(targetLabel)}`,
  connectCancelled: 'Link cancelled',
  connectUnavailable:
    'Nothing can be linked from here. A producer links to an exchange or a queue, an exchange to a queue or another exchange, and a queue to a consumer.',
  connectRequiresSingleNode: 'Select one node first, then press L to link it.',
  deleteRequested: (count) => `Deleting ${items(count)}`,
  zoom: (percent) => `Zoom ${percent} percent`,
};
