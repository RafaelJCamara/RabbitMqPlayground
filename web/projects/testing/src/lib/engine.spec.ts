import { describe, expect, it } from 'vitest';
import {
  bindQueue,
  CANVAS_TIMING,
  consume,
  declareExchange,
  declareQueue,
  newEngine,
  only,
  openChannel,
  producer,
  publish,
  run,
  runAll,
  settle,
  types,
  ZERO_TIMING,
} from './engine';

/**
 * The helpers that specs of the engine are written with. They are test code, so what they promise is small: a spec that is wrong should say so loudly, and the commands that
 * they make are the ones that a spec means.
 */

describe('newEngine', () => {
  it('has no latency and the seed 1, unless it is told otherwise', () => {
    expect(newEngine().view()).toMatchObject({ seed: 1, timing: ZERO_TIMING });
    expect(newEngine(CANVAS_TIMING, 7).view()).toMatchObject({ seed: 7, timing: CANVAS_TIMING });
  });
});

describe('run and runAll', () => {
  it('answer what a command said, and say it in the order that the commands were given', () => {
    const engine = newEngine();

    expect(types(run(engine, publish('', 'nowhere', 'a')))).toEqual(['published']);
    expect(types(runAll(engine, publish('', 'nowhere', 'b'), publish('', 'nowhere', 'c')))).toEqual([
      'published',
      'published',
    ]);
  });

  it('throw, saying what was refused and why, when a command is refused, so that a spec that expected otherwise fails where it went wrong', () => {
    const engine = newEngine();

    expect(() => run(engine, bindQueue('nope', 'q'))).toThrow(/^bind was refused: 404 NOT_FOUND/);
  });
});

describe('settle', () => {
  it('lets everything that is scheduled happen, and says what it did', () => {
    const engine = newEngine({ publishMs: 10, brokerMs: 10, deliverMs: 10 });
    runAll(engine, declareQueue('q'), openChannel('ch'), consume('ch', 'q', 'c'));
    run(engine, publish('', 'q', 'a'));

    const events = settle(engine);

    expect(types(events)).toEqual(['routed', 'enqueued', 'delivered', 'received']);
    expect(engine.nextAt()).toBeNull();
  });
});

describe('the makers of commands', () => {
  it('declare an exchange that is direct, durable, and not auto-delete or internal, unless they are told otherwise', () => {
    expect(declareExchange('e')).toStrictEqual({
      op: 'exchange.declare',
      name: 'e',
      type: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    });
    expect(declareExchange('e', 'topic', { internal: true, durable: false })).toMatchObject({
      type: 'topic',
      durable: false,
      internal: true,
    });
  });

  it('declare a queue that is durable', () => {
    expect(declareQueue('q')).toStrictEqual({ op: 'queue.declare', name: 'q', durable: true });
  });

  it('bind with an empty key and no headers, and say the headers only when there are some', () => {
    expect(bindQueue('e', 'q')).toStrictEqual({
      op: 'bind',
      source: 'e',
      destination: { kind: 'queue', name: 'q' },
      key: '',
    });
    expect(bindQueue('e', 'q', 'k', { xMatch: 'all', args: [] })).toStrictEqual({
      op: 'bind',
      source: 'e',
      destination: { kind: 'queue', name: 'q' },
      key: 'k',
      headers: { xMatch: 'all', args: [] },
    });
  });

  it('publish with an empty key and an empty body, unless they are given', () => {
    expect(publish('e')).toStrictEqual({ op: 'basic.publish', exchange: 'e', key: '', body: '' });
    expect(publish('e', 'k', 'b')).toStrictEqual({ op: 'basic.publish', exchange: 'e', key: 'k', body: 'b' });
  });

  it('open a channel that handles nothing by itself, with a prefetch only when there is one', () => {
    expect(openChannel('ch')).toStrictEqual({ op: 'channel.open', channel: 'ch', processingMs: null });
    expect(openChannel('ch', 3, 250)).toStrictEqual({
      op: 'channel.open',
      channel: 'ch',
      prefetch: 3,
      processingMs: 250,
    });
  });

  it('consume with an acknowledgement by the consumer itself, unless it is told to wait for one', () => {
    expect(consume('ch', 'q', 'c')).toStrictEqual({
      op: 'basic.consume',
      channel: 'ch',
      queue: 'q',
      consumer: 'c',
      ack: 'auto',
    });
    expect(consume('ch', 'q', 'c', 'manual')).toMatchObject({ ack: 'manual' });
  });

  it('set a producer that sends nothing, nowhere, once, unless it is told otherwise', () => {
    expect(producer('p')).toStrictEqual({
      op: 'producer.set',
      producer: 'p',
      target: null,
      key: '',
      payload: '',
      headers: [],
      burst: 1,
      everyMs: 1000,
      repeat: false,
    });
    expect(producer('p', { burst: 3, repeat: true })).toMatchObject({ burst: 3, repeat: true });
  });
});

describe('the readers of events', () => {
  it('pick the events of one type, and list the types', () => {
    const engine = newEngine();
    const events = runAll(engine, publish('', 'nowhere', 'a'), publish('', 'nowhere', 'b'));

    expect(only(events, 'published').map(({ message }) => message.payload)).toEqual(['a', 'b']);
    expect(only(events, 'routed')).toEqual([]);
    expect(types(events)).toEqual(['published', 'published']);
  });
});
