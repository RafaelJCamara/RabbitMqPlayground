import type { EngineCommand } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import {
  consumerRecord,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  SAMPLE,
  sampleDocument,
} from './documents';
import {
  bindQueue,
  CANVAS_TIMING,
  consume,
  declareExchange,
  declareQueue,
  newEngine,
  openChannel,
  producer,
  publish,
  run,
  runAll,
  settle,
  ZERO_TIMING,
} from './engine';
import { documentHolds, engineHolds, type Held } from './held';

/** An engine that holds what `sampleDocument()` says, made by hand and not by `reconcile`, which is what these are the means to check. */
function sampleEngine() {
  const engine = newEngine(CANVAS_TIMING, 1);
  runAll(
    engine,
    declareExchange('orders', 'topic'),
    declareExchange('docs', 'headers'),
    declareExchange('hidden', 'fanout', { internal: true }),
    declareQueue('billing'),
    declareQueue('archive'),
    openChannel('C1', 3, 200),
    consume('C1', 'billing', 'C1/billing', 'manual'),
    producer('P1', {
      target: { kind: 'exchange', name: 'orders' },
      key: 'order.new',
      payload: 'hello',
      headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
      burst: 2,
      everyMs: 500,
      repeat: true,
    }),
  );
  return engine;
}

/** The parts of what is held that differ. */
const differences = (a: Held, b: Held): string[] =>
  (Object.keys(a) as (keyof Held)[]).filter((part) => JSON.stringify(a[part]) !== JSON.stringify(b[part]));

describe('documentHolds', () => {
  it('writes out what an engine should hold for a document, one string for each thing', () => {
    expect(documentHolds(sampleDocument())).toEqual({
      settings: 'seed 1, publish 500, broker 300, deliver 500',
      exchanges: ['docs|headers|true|false|false', 'hidden|fanout|true|false|true', 'orders|topic|true|false|false'],
      queues: ['archive|true', 'billing|true'],
      producers: ['P1|exchange orders|"order.new"|"hello"|[{"key":"n","value":{"t":"integer","v":1}}]|2|500|true'],
      channels: ['C1|3|200'],
      consumers: ['C1/billing|C1|billing|manual'],
    });
  });

  it('holds only the settings for a canvas with nothing on it', () => {
    expect(documentHolds(documentOf())).toEqual({
      settings: 'seed 1, publish 500, broker 300, deliver 500',
      exchanges: [],
      queues: [],
      producers: [],
      channels: [],
      consumers: [],
    });
  });

  it('puts the things in a fixed order, whatever order the document has them in', () => {
    const one = documentOf({
      exchanges: { A: exchangeRecord('b'), B: exchangeRecord('a') },
      queues: { Q: queueRecord('z'), R: queueRecord('y') },
      consumers: { C: consumerRecord('c', ['Q', 'R']), D: consumerRecord('d') },
    });

    expect(documentHolds(one).exchanges.map((line) => line.split('|')[0])).toEqual(['a', 'b']);
    expect(documentHolds(one).queues.map((line) => line.split('|')[0])).toEqual(['y', 'z']);
    expect(documentHolds(one).consumers).toEqual(['C/y|C|y|auto', 'C/z|C|z|auto']);
    expect(documentHolds(one).channels).toEqual(['C|0|500', 'D|0|500']);
  });

  it('says where a link or a subscription goes when it goes nowhere that is on the canvas, and does not leave it out', () => {
    const broken = documentOf({
      producers: {
        P1: producerRecord('a', { kind: 'queue', id: 'gone' }),
        P2: producerRecord('b', { kind: 'exchange', id: 'gone' }),
        P3: producerRecord('c'),
      },
      consumers: { C: consumerRecord('c', ['gone']) },
    });

    expect(documentHolds(broken).producers).toEqual([
      'P1|queue (no queue gone)|""|""|[]|1|1000|false',
      'P2|exchange (no exchange gone)|""|""|[]|1|1000|false',
      'P3|nowhere|""|""|[]|1|1000|false',
    ]);
    expect(documentHolds(broken).consumers).toEqual(['C/(no queue gone)|C|(no queue gone)|auto']);
  });

  it('takes a producer that sends to a queue by the name of the queue', () => {
    const document = documentOf({
      queues: { Q: queueRecord('inbox') },
      producers: { P: producerRecord('p', { kind: 'queue', id: 'Q' }) },
    });

    expect(documentHolds(document).producers).toEqual(['P|queue inbox|""|""|[]|1|1000|false']);
  });
});

describe('engineHolds', () => {
  it('reads from an engine the same strings that the document that it was made for gives', () => {
    expect(engineHolds(sampleEngine())).toEqual(documentHolds(sampleDocument()));
  });

  it('holds nothing but the settings when it is new', () => {
    expect(engineHolds(newEngine(CANVAS_TIMING, 1))).toEqual(documentHolds(documentOf()));
  });

  it('puts the things in a fixed order, whatever order the engine was given them in', () => {
    const engine = newEngine(ZERO_TIMING);
    runAll(engine, declareExchange('b'), declareExchange('a'), declareQueue('z'), declareQueue('y'));

    expect(engineHolds(engine).exchanges.map((line) => line.split('|')[0])).toEqual(['a', 'b']);
    expect(engineHolds(engine).queues.map((line) => line.split('|')[0])).toEqual(['y', 'z']);
  });

  it('does not count a consumer that was cancelled, though the engine keeps it while it holds a message', () => {
    const engine = newEngine(ZERO_TIMING);
    runAll(
      engine,
      declareExchange('x', 'fanout'),
      declareQueue('q'),
      bindQueue('x', 'q'),
      openChannel('c', 0, null),
      consume('c', 'q', 't', 'manual'),
      publish('x', '', 'm'),
    );
    settle(engine);
    run(engine, { op: 'basic.cancel', consumer: 't' });

    expect(engine.snapshot().tags).toHaveLength(1);
    expect(engineHolds(engine).consumers).toEqual([]);
  });

  describe('tells apart what differs, in the part that it differs in', () => {
    const document = sampleDocument();
    const settings = { seed: 1, timing: { publishMs: 500, brokerMs: 300, deliverMs: 500 } };
    const sampleProducer = {
      target: { kind: 'exchange', name: 'orders' } as const,
      key: 'order.new',
      payload: 'hello',
      headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] as const,
      burst: 2,
      everyMs: 500,
      repeat: true,
    };

    it('says that the engine and the document agree when nothing differs', () => {
      expect(differences(engineHolds(sampleEngine()), documentHolds(document))).toEqual([]);
    });

    it.each<[string, EngineCommand[], string]>([
      ['the seed', [{ op: 'sim.configure', ...settings, seed: 2 }], 'settings'],
      [
        'the time to publish',
        [{ op: 'sim.configure', ...settings, timing: { ...settings.timing, publishMs: 1 } }],
        'settings',
      ],
      [
        'the time in the broker',
        [{ op: 'sim.configure', ...settings, timing: { ...settings.timing, brokerMs: 1 } }],
        'settings',
      ],
      [
        'the time to deliver',
        [{ op: 'sim.configure', ...settings, timing: { ...settings.timing, deliverMs: 1 } }],
        'settings',
      ],
      [
        'the type of an exchange',
        [{ op: 'exchange.delete', name: 'docs' }, declareExchange('docs', 'direct')],
        'exchanges',
      ],
      [
        'a flag of an exchange',
        [{ op: 'exchange.delete', name: 'docs' }, declareExchange('docs', 'headers', { autoDelete: true })],
        'exchanges',
      ],
      ['a queue that is gone', [{ op: 'queue.delete', name: 'archive' }], 'queues'],
      [
        'where a producer sends',
        [producer('P1', { ...sampleProducer, target: { kind: 'queue', name: 'archive' } })],
        'producers',
      ],
      [
        'where a producer sends, when it sends nowhere',
        [producer('P1', { ...sampleProducer, target: null })],
        'producers',
      ],
      ['the key of a message', [producer('P1', { ...sampleProducer, key: 'other' })], 'producers'],
      ['the payload of a message', [producer('P1', { ...sampleProducer, payload: 'other' })], 'producers'],
      ['the headers of a message', [producer('P1', { ...sampleProducer, headers: [] })], 'producers'],
      ['the burst of a producer', [producer('P1', { ...sampleProducer, burst: 3 })], 'producers'],
      ['the interval of a producer', [producer('P1', { ...sampleProducer, everyMs: 501 })], 'producers'],
      ['whether a producer repeats', [producer('P1', { ...sampleProducer, repeat: false })], 'producers'],
      ['a producer that is gone', [{ op: 'producer.remove', producer: 'P1' }], 'producers'],
      ['the prefetch of a channel', [{ op: 'channel.set', channel: 'C1', prefetch: 4 }], 'channels'],
      ['the time that a channel takes', [{ op: 'channel.set', channel: 'C1', processingMs: 201 }], 'channels'],
      ['a consumer that was cancelled', [{ op: 'basic.cancel', consumer: 'C1/billing' }], 'consumers'],
      ['a consumer that was added', [consume('C1', 'archive', 'C1/archive', 'manual')], 'consumers'],
      [
        'how a consumer acknowledges',
        [{ op: 'basic.cancel', consumer: 'C1/billing' }, consume('C1', 'billing', 'C1/billing', 'auto')],
        'consumers',
      ],
    ])('tells apart %s', (_, commands, part) => {
      const engine = sampleEngine();
      runAll(engine, ...commands);

      expect(differences(engineHolds(engine), documentHolds(document))).toEqual([part]);
    });

    it('tells apart a queue that the document says is not durable, which an engine cannot be told to make', () => {
      const transient = documentOf({
        ...SAMPLE,
        queues: { Q1: queueRecord('billing'), Q2: queueRecord('archive', { durable: false }) },
      });

      expect(differences(engineHolds(sampleEngine()), documentHolds(transient))).toEqual(['queues']);
    });
  });
});
