import { describe, expect, it } from 'vitest';
import { refusalFrom } from './amqp-session';

/**
 * The AMQP adapter itself needs a broker, and is exercised by the live run. How it reads what the broker said is not
 * about a broker: amqplib turns a close frame into an Error whose `code` is the reply code and whose message carries
 * the reply text. These are the messages that RabbitMQ 4.3.6 produced for each way that a step can be refused (see the
 * refusal scenarios), so a change in how amqplib words them shows up here before it shows up as a confusing recording.
 */

const closedBy = (message: string, code?: number) =>
  Object.assign(new Error(message), code === undefined ? {} : { code });

describe('refusalFrom', () => {
  it('reads a channel that the broker closed, from the error event of the channel', () => {
    const error = closedBy(
      `Channel closed by server: 404 (NOT-FOUND) with message "NOT_FOUND - no exchange 'nope' in vhost 'v'"`,
      404,
    );

    expect(refusalFrom('channel', error)).toEqual({
      level: 'channel',
      code: 404,
      text: "NOT_FOUND - no exchange 'nope' in vhost 'v'",
    });
  });

  it('reads the error that fails the call which the broker refused, which says what it was doing', () => {
    const error = closedBy(
      `Operation failed: QueueBind; 403 (ACCESS-REFUSED) with message "ACCESS_REFUSED - operation not permitted on the default exchange"`,
      403,
    );

    expect(refusalFrom('channel', error)).toEqual({
      level: 'channel',
      code: 403,
      text: 'ACCESS_REFUSED - operation not permitted on the default exchange',
    });
  });

  it('reads a connection that the broker closed, and keeps its line breaks and the dots where it cut the text short', () => {
    const text =
      'INTERNAL_ERROR - Feature `transient_nonexcl_queues` is deprecated.\nBy default, this feature is not permitted anymore.\nTo...';
    const error = closedBy(`Connection closed: 541 (INTERNAL-ERROR) with message "${text}"`, 541);

    expect(refusalFrom('connection', error)).toEqual({ level: 'connection', code: 541, text });
  });

  it('keeps double quotes that are part of the reply text', () => {
    const text = `PRECONDITION_FAILED - inequivalent arg "durable" for queue 'q'`;

    expect(
      refusalFrom(
        'channel',
        closedBy(`Channel closed by server: 406 (PRECONDITION-FAILED) with message "${text}"`, 406),
      ),
    ).toEqual({
      level: 'channel',
      code: 406,
      text,
    });
  });

  it.each<[string, unknown]>([
    [
      'an error with no reply code, which the client raised itself',
      closedBy('Channel closed by server: with message "x"'),
    ],
    ['an error whose code is not a number, such as a socket error', closedBy('read ECONNRESET', undefined)],
    ['an error with a code but no reply text', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ['a numeric code but no reply text', closedBy('Heartbeat timeout', 320)],
    ['something that is not an error', 'Channel closed by server: 404 with message "x"'],
    ['nothing', undefined],
  ])('is not fooled by %s', (_name, error) => {
    expect(refusalFrom('channel', error)).toBeUndefined();
  });
});
