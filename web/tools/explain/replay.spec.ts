import { describe, expect, it } from 'vitest';
import type { Fixture } from '../conformance/fixtures';
import { OUTSIDE_THE_MODEL, publishesOf } from './replay';

/** A routing fixture, made by hand, with what the broker would have recorded. */
const fixture = (steps: Fixture['steps'], observed: Fixture['observed']): Fixture => ({
  id: 'routing/made-by-hand',
  kind: 'routing',
  title: 'made by hand',
  steps,
  observed,
});

describe('the publishes of a routing fixture (ADR-0060)', () => {
  const steps: Fixture['steps'] = [
    { op: 'exchange.declare', name: 'e', type: 'direct' },
    { op: 'queue.declare', name: 'inbox' },
    { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'inbox' }, key: 'k' },
    { op: 'basic.publish', exchange: 'e', key: 'k', body: 'm1' },
    { op: 'unbind', source: 'e', destination: { kind: 'queue', name: 'inbox' }, key: 'k' },
    { op: 'basic.publish', exchange: 'e', key: 'k', body: 'm2' },
  ];
  const observed: Fixture['observed'] = {
    routes: [
      { body: 'm1', returned: false, queues: ['inbox'] },
      { body: 'm2', returned: true, queues: [] },
    ],
  };

  it('has the topology that each publish met: a binding that was taken away is not there for the next', () => {
    const [first, second] = publishesOf(fixture(steps, observed));

    expect(first?.topology.bindings).toHaveLength(1);
    expect(second?.topology.bindings).toHaveLength(0);
    expect(first?.topology.queues).toEqual(['inbox']);
    expect(first?.topology.exchanges).toEqual([{ name: 'e', type: 'direct', internal: false }]);
  });

  it('numbers the publishes, says which step each is, and has the message, as a client sent it, with the body as its name', () => {
    const publishes = publishesOf(fixture(steps, observed));

    expect(publishes.map(({ number, of, step, body }) => [number, of, step, body])).toEqual([
      [1, 2, 4, 'm1'],
      [2, 2, 6, 'm2'],
    ]);
    expect(publishes[0]?.message).toEqual({ exchange: 'e', key: 'k', headers: [] });
  });

  it('has what the broker recorded beside each publish', () => {
    const [first, second] = publishesOf(fixture(steps, observed));

    expect(first?.recorded).toEqual({ kind: 'routed', returned: false, queues: ['inbox'] });
    expect(second?.recorded).toEqual({ kind: 'routed', returned: true, queues: [] });
  });

  it('has a refusal where the broker refused the publish, and a step that was refused changes nothing', () => {
    const refusing: Fixture['steps'] = [
      { op: 'bind', source: 'nope', destination: { kind: 'queue', name: 'q' }, key: 'k', refused: true },
      { op: 'basic.publish', exchange: 'nope', key: 'k', body: 'm1', refused: true },
    ];
    const [publish] = publishesOf(
      fixture(refusing, {
        routes: [],
        refusals: [
          { step: 1, level: 'channel', code: 404, text: "NOT_FOUND - no exchange 'nope' in vhost '/'" },
          { step: 2, level: 'channel', code: 404, text: "NOT_FOUND - no exchange 'nope' in vhost '/'" },
        ],
      }),
    );

    expect(publish?.recorded).toEqual({
      kind: 'refused',
      code: 404,
      text: "NOT_FOUND - no exchange 'nope' in vhost '/'",
    });
    expect(publish?.topology.bindings).toEqual([]);
  });

  it('reads typed headers and the arguments of a binding, and leaves out the width of an integer, which the model does not need', () => {
    const [publish] = publishesOf(
      fixture(
        [
          { op: 'exchange.declare', name: 'h', type: 'headers' },
          { op: 'queue.declare', name: 'q' },
          {
            op: 'bind',
            source: 'h',
            destination: { kind: 'queue', name: 'q' },
            headers: {
              xMatch: 'any',
              args: [
                { key: 'n', value: { t: 'integer', v: 1, width: 8 } },
                { key: 'seen', value: { t: 'exists' } },
              ],
            },
          },
          {
            op: 'basic.publish',
            exchange: 'h',
            body: 'm1',
            headers: [{ key: 'n', value: { t: 'integer', v: 1, width: 64 } }],
          },
        ],
        { routes: [{ body: 'm1', returned: false, queues: ['q'] }] },
      ),
    );

    expect(publish?.message.headers).toStrictEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
    expect(publish?.topology.bindings[0]?.headers).toStrictEqual({
      xMatch: 'any',
      args: [
        { key: 'n', value: { t: 'integer', v: 1 } },
        { key: 'seen', value: { t: 'exists' } },
      ],
    });
  });

  it('declares an exchange with the flags that the step has, and the defaults that the broker has', () => {
    const [publish] = publishesOf(
      fixture(
        [
          { op: 'exchange.declare', name: 'a', type: 'fanout', internal: true },
          { op: 'exchange.declare', name: 'b', type: 'topic', durable: true, autoDelete: true },
          { op: 'basic.publish', exchange: 'b', body: 'm1' },
        ],
        { routes: [{ body: 'm1', returned: true, queues: [] }] },
      ),
    );

    expect(publish?.topology.exchanges).toEqual([
      { name: 'a', type: 'fanout', internal: true },
      { name: 'b', type: 'topic', internal: false },
    ]);
  });

  it('refuses to guess: a publish that the fixture has nothing recorded for is an error, and so is a step that is not a routing step', () => {
    expect(() => publishesOf(fixture([{ op: 'basic.publish', exchange: 'e', body: 'm1' }], { routes: [] }))).toThrow(
      'routing/made-by-hand, step 1: the fixture has nothing recorded for this publish',
    );
    expect(() =>
      publishesOf(fixture([{ op: 'basic.publish', exchange: 'e', body: 'm1', refused: true }], { routes: [] })),
    ).toThrow('the fixture has nothing recorded for this publish');
    expect(() => publishesOf(fixture([{ op: 'channel.open', channel: 'c' }], { routes: [] }))).toThrow(
      'a routing fixture has a step that is not a routing step: channel.open',
    );
  });

  it('leaves out the one fixture that the model cannot say, and gives the reason', () => {
    expect(Object.keys(OUTSIDE_THE_MODEL)).toEqual([
      'routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive',
    ]);
  });
});
