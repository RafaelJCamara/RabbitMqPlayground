/**
 * The longest a routing key may be: 255 bytes of UTF-8 (ADR-0008, rule 4; ADR-0021). AMQP 0-9-1 writes a routing key as
 * a short string, with a one-byte length, so no client can send more, and a client library refuses before the broker
 * sees it. That is why this is a rule for the input and not a refusal with a broker's code.
 */
export const ROUTING_KEY_MAX_BYTES = 255;

/**
 * How many bytes `text` takes in UTF-8. The engine reads no global, and `TextEncoder` is one, so this counts by hand.
 * A surrogate with no partner is written as the three-byte replacement character, which is what an encoder does.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      index += 1; // the low half of the pair
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Why `key` cannot be a routing key, or `null` when it can. */
export function routingKeyIssue(key: string): string | null {
  const bytes = utf8Length(key);
  return bytes > ROUTING_KEY_MAX_BYTES
    ? `A routing key is at most ${ROUTING_KEY_MAX_BYTES} bytes of UTF-8, and this one is ${bytes}`
    : null;
}
