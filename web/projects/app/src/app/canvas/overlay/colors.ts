/**
 * The colour of a message is its routing key's (ADR-0055): one of eight that are told apart in both themes, held to 3:1 against the canvas by
 * tools/theme/tokens.spec.ts. Colour is never the only sign: a redelivered message has a ring, a crowd has its count, and the key is a word beside the message while
 * there are few of them. A message is the colour that the same key always gets, so a learner can follow one kind of message by it.
 */

/** The names of the eight colours, which are the ends of the tokens `--rmq-message-<name>` of styles.css. */
export const MESSAGE_COLORS = ['blue', 'orange', 'green', 'pink', 'gold', 'gray', 'violet', 'cyan'] as const;

export type MessageColor = (typeof MESSAGE_COLORS)[number];

/** The colour of a mixed crowd, whose messages do not share a key. */
export const MIXED = 'mixed';

/** The 32-bit FNV-1a hash of a text, which is the same in every browser and every run. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return value >>> 0;
}

/** The colour of a routing key. */
export function colorOf(key: string): MessageColor {
  return MESSAGE_COLORS[hash(key) % MESSAGE_COLORS.length] as MessageColor;
}

/** The tokens that the painter reads. */
export type PaintToken =
  | `--rmq-message-${MessageColor | typeof MIXED}`
  | '--rmq-message-outline'
  | '--rmq-warning'
  | '--rmq-fg'
  | '--rmq-canvas';

/** The name of the token for the colour of a crowd that shares a key, or does not (`null`). */
export const tokenFor = (key: string | null): PaintToken => `--rmq-message-${key === null ? MIXED : colorOf(key)}`;

/** The tokens that the painter reads, by name. */
export const PAINT_TOKENS: readonly PaintToken[] = [
  ...MESSAGE_COLORS.map((name): PaintToken => `--rmq-message-${name}`),
  `--rmq-message-${MIXED}`,
  '--rmq-message-outline',
  '--rmq-warning',
  '--rmq-fg',
  '--rmq-canvas',
];
