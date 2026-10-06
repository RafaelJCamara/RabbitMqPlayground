import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { utf8Length } from './keys';
import {
  defaultExchangeReply,
  internalExchangeReply,
  noExchangeReply,
  noQueueReply,
  RESERVED_NAME_PREFIX,
  reservedNameReply,
  topicWildcardsReply,
  transientQueueReply,
  type BrokerReply,
} from './refusal';

/**
 * The replies are the broker's words (ADR-0021, ADR-0022). The fixtures are what RabbitMQ 4.3.6 said, so every refusal
 * recorded there must be one of these replies, and each reply must be one that was recorded.
 */

const ROUTING = fileURLToPath(new URL('../../../../fixtures/conformance/4.3/routing/', import.meta.url));

interface Recorded {
  readonly fixture: string;
  readonly code: number;
  readonly text: string;
}

const recorded: Recorded[] = readdirSync(ROUTING)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap((name) => {
    const fixture = JSON.parse(readFileSync(`${ROUTING}${name}`, 'utf8')) as {
      id: string;
      observed: { refusals?: { code: number; text: string }[] };
    };
    return (fixture.observed.refusals ?? []).map(({ code, text }) => ({ fixture: fixture.id, code, text }));
  });

/** For each shape of recorded text, how the reply is made from what the text says. */
const BUILDERS: readonly [RegExp, (...captured: string[]) => BrokerReply][] = [
  [
    /^ACCESS_REFUSED - (exchange|queue) name '(.*)' contains reserved prefix 'amq\.\*'$/s,
    (kind, name) => reservedNameReply(kind as 'exchange' | 'queue', name as string),
  ],
  [/^ACCESS_REFUSED - operation not permitted on the default exchange$/, () => defaultExchangeReply()],
  [
    /^ACCESS_REFUSED - cannot publish to internal exchange '(.*)' in vhost '\/'$/s,
    (name) => internalExchangeReply(name as string, '/'),
  ],
  [/^NOT_FOUND - no exchange '(.*)' in vhost '\/'$/s, (name) => noExchangeReply(name as string, '/')],
  [/^NOT_FOUND - no queue '(.*)' in vhost '\/'$/s, (name) => noQueueReply(name as string, '/')],
  [
    /^PRECONDITION_FAILED - Topic binding key '(.*)' uses (\d+) '#' wildcards, at most 2 are allowed$/s,
    (key, count) => topicWildcardsReply(key as string, Number(count)),
  ],
  [/^INTERNAL_ERROR - Feature `transient_nonexcl_queues` is deprecated\./, () => transientQueueReply()],
];

const rebuild = (text: string): BrokerReply | undefined => {
  for (const [shape, build] of BUILDERS) {
    const found = shape.exec(text);
    if (found) {
      return build(...found.slice(1));
    }
  }
  return undefined;
};

describe('the broker replies', () => {
  it('make each refusal that the fixtures recorded, word for word, with the recorded code', () => {
    expect(recorded.length).toBeGreaterThan(20);

    for (const { fixture, code, text } of recorded) {
      expect(rebuild(text), `${fixture}: ${text}`).toEqual({ code, text });
    }
  });

  it('are all used by a recorded refusal, so that none is a guess', () => {
    const used = new Set(recorded.map(({ text }) => BUILDERS.findIndex(([shape]) => shape.test(text))));

    expect([...used].sort()).toEqual(BUILDERS.map((_, index) => index));
  });

  it('write the vhost that the topology has, in the replies that name one', () => {
    expect(noExchangeReply('x', 'prod').text).toBe("NOT_FOUND - no exchange 'x' in vhost 'prod'");
    expect(noQueueReply('q', 'prod').text).toBe("NOT_FOUND - no queue 'q' in vhost 'prod'");
    expect(internalExchangeReply('x', 'prod').text).toBe(
      "ACCESS_REFUSED - cannot publish to internal exchange 'x' in vhost 'prod'",
    );
  });

  it('give each refusal its code', () => {
    expect(reservedNameReply('exchange', 'amq.x').code).toBe(403);
    expect(reservedNameReply('queue', 'amq.x').code).toBe(403);
    expect(defaultExchangeReply().code).toBe(403);
    expect(internalExchangeReply('x', '/').code).toBe(403);
    expect(noExchangeReply('x', '/').code).toBe(404);
    expect(noQueueReply('x', '/').code).toBe(404);
    expect(topicWildcardsReply('#.#.#', 3).code).toBe(406);
    expect(transientQueueReply().code).toBe(541);
  });

  it('name the number of # words that the key has', () => {
    expect(topicWildcardsReply('a.#.b.#.c.#.#', 4).text).toBe(
      "PRECONDITION_FAILED - Topic binding key 'a.#.b.#.c.#.#' uses 4 '#' wildcards, at most 2 are allowed",
    );
  });

  it('keep the text of a transient queue within the 255 bytes that AMQP allows in a reply text', () => {
    expect(utf8Length(transientQueueReply().text)).toBeLessThanOrEqual(255);
    expect(transientQueueReply().text.endsWith('To...')).toBe(true);
  });

  it('reserve the prefix that the broker reserves, and no other', () => {
    expect(RESERVED_NAME_PREFIX).toBe('amq.');
  });
});
