import type { Scenario } from '../scenario';
import { bindKey, declareExchange, declareQueue, publish, queue } from './helpers';

/**
 * The longest a name or a routing key may be: 255 bytes of UTF-8. AMQP 0-9-1 writes them as a short string, with a
 * one-byte length, so nothing longer can be sent, and a client library refuses before the broker sees it. The broker's
 * side of the limit is therefore only that 255 bytes are accepted, and that the limit counts bytes, not characters.
 */

/** 255 bytes in 128 characters: 127 characters of two bytes and an `a`. */
const TWO_BYTE_KEY = `${'é'.repeat(127)}a`;
const LONG_NAME = 'x'.repeat(255);

export const LIMIT_SCENARIOS: readonly Scenario[] = [
  {
    id: 'routing/names-and-keys-of-255-bytes-are-accepted',
    kind: 'routing',
    title:
      'An exchange name, a queue name and a routing key of 255 bytes are accepted, and the limit counts bytes, not characters (ADR-0008, rule 4)',
    steps: [
      declareExchange(LONG_NAME, 'direct'),
      declareExchange(TWO_BYTE_KEY, 'fanout'),
      declareQueue(LONG_NAME),
      declareQueue(TWO_BYTE_KEY),
      bindKey(LONG_NAME, queue(LONG_NAME), TWO_BYTE_KEY),
      bindKey(TWO_BYTE_KEY, queue(TWO_BYTE_KEY), ''),
      publish(LONG_NAME, TWO_BYTE_KEY, 'm1'),
      publish(LONG_NAME, `${'é'.repeat(127)}b`, 'm2'),
      publish(TWO_BYTE_KEY, '', 'm3'),
    ],
  },
];
