import {
  defaultExchangeReply,
  headerValueIssue,
  internalExchangeReply,
  reservedNameReply,
  topicWildcardsReply,
  transientQueueReply,
} from '@rmq/engine';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  exists,
  headerArguments,
  int,
  producerRecord,
  queueRecord,
  str,
  type DocumentParts,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canvasDocumentSchema, emptyDocument, type CanvasDocument } from './schema';
import { parseDocument, validateDocument } from './validate';

/** A document with a little of everything, and nothing wrong with it. */
const valid: DocumentParts = {
  exchanges: {
    ex1: exchangeRecord('orders', 'topic'),
    ex2: exchangeRecord('docs', 'headers'),
    ex3: exchangeRecord('hidden', 'fanout', { internal: true }),
  },
  queues: { q1: queueRecord('billing'), q2: queueRecord('archive') },
  bindings: {
    b1: bindingRecord('ex1', { kind: 'queue', id: 'q1' }, 'order.*'),
    b2: bindingRecord('ex2', { kind: 'queue', id: 'q2' }, '', headerArguments('any', entry('format', str('pdf')))),
    b3: bindingRecord('ex1', { kind: 'exchange', id: 'ex3' }, '#'),
  },
  producers: {
    p1: producerRecord(
      'sender',
      { kind: 'exchange', id: 'ex1' },
      {
        message: { payload: 'x', key: 'order.new', headers: [entry('n', int(1))] },
        burst: 1,
        interval: { everyMs: 500, on: false },
      },
    ),
  },
  consumers: { c1: consumerRecord('worker', ['q1']) },
  labels: { 'ex1>q1': { at: 0.5 } },
};
/** `valid` with something changed. Its label is for an edge that a change may remove, so it goes unless it is given. */
const documentWith = (change: DocumentParts): CanvasDocument => documentOf({ ...valid, labels: {}, ...change });

const found = (document: CanvasDocument) =>
  validateDocument(document).map((issue) => ({ kind: issue.kind, path: issue.path?.join('.') }));

describe('validateDocument', () => {
  it('finds nothing wrong with an empty canvas, and with a canvas that is right', () => {
    expect(validateDocument(emptyDocument())).toEqual([]);
    expect(validateDocument(deepFreeze(documentOf(valid)))).toEqual([]);
  });

  describe('the vhost', () => {
    it('needs a name of at most 255 bytes', () => {
      expect(found(documentOf({ vhost: '' }))).toEqual([{ kind: 'empty-name', path: 'vhost' }]);
      expect(found(documentOf({ vhost: 'v'.repeat(256) }))).toEqual([{ kind: 'name-too-long', path: 'vhost' }]);
      expect(found(documentOf({ vhost: 'v'.repeat(255) }))).toEqual([]);
      expect(found(documentOf({ vhost: `${'é'.repeat(128)}` }))).toEqual([{ kind: 'name-too-long', path: 'vhost' }]);
    });
  });

  describe('names', () => {
    it('are refused when a broker would refuse them, with the broker’s reply, and say where the name is', () => {
      const document = documentWith({
        exchanges: { ...valid.exchanges, ex9: exchangeRecord('amq.mine') },
        queues: { ...valid.queues, q9: queueRecord('amq.mine') },
      });

      expect(validateDocument(document)).toMatchObject([
        {
          kind: 'reserved-name',
          path: ['exchanges', 'ex9', 'name'],
          refusal: reservedNameReply('exchange', 'amq.mine'),
        },
        { kind: 'reserved-name', path: ['queues', 'q9', 'name'], refusal: reservedNameReply('queue', 'amq.mine') },
      ]);
    });

    it('are refused when they are empty: the empty exchange is the default exchange, which has its own 403', () => {
      const document = documentWith({
        exchanges: { ...valid.exchanges, ex9: exchangeRecord('') },
        queues: { ...valid.queues, q9: queueRecord('') },
        producers: { p9: producerRecord('') },
        consumers: { c9: consumerRecord('') },
      });
      const issues = validateDocument(document);

      expect(issues.map(({ kind, path }) => [kind, path?.join('.')])).toEqual([
        ['default-exchange', 'exchanges.ex9.name'],
        ['empty-name', 'queues.q9.name'],
        ['empty-name', 'producers.p9.name'],
        ['empty-name', 'consumers.c9.name'],
      ]);
      expect(issues[0]?.refusal).toEqual(defaultExchangeReply());
    });

    it('are refused when they are longer than 255 bytes', () => {
      const long = 'x'.repeat(256);

      expect(found(documentWith({ queues: { ...valid.queues, q9: queueRecord(long) } }))).toEqual([
        { kind: 'name-too-long', path: 'queues.q9.name' },
      ]);
    });

    it('are allowed to be taken by a queue that the broker named, which may start with amq.', () => {
      expect(
        found(documentWith({ queues: { ...valid.queues, q9: queueRecord('amq.gen-x', { serverNamed: true }) } })),
      ).toEqual([]);
    });

    it('are unique within a kind, and may be shared between kinds', () => {
      const shared = documentWith({
        exchanges: { ...valid.exchanges, ex9: exchangeRecord('billing') },
        producers: { p1: producerRecord('billing'), p2: producerRecord('worker') },
        consumers: { c1: consumerRecord('billing'), c2: consumerRecord('worker') },
      });

      expect(found(shared)).toEqual([]);

      const taken = documentWith({
        exchanges: { ...valid.exchanges, ex9: exchangeRecord('orders') },
        queues: { ...valid.queues, q9: queueRecord('billing') },
        producers: { p1: producerRecord('sender'), p2: producerRecord('sender') },
        consumers: { c1: consumerRecord('worker'), c2: consumerRecord('worker') },
      });

      expect(found(taken)).toEqual([
        { kind: 'duplicate-name', path: 'exchanges.ex9.name' },
        { kind: 'duplicate-name', path: 'queues.q9.name' },
        { kind: 'duplicate-name', path: 'producers.p2.name' },
        { kind: 'duplicate-name', path: 'consumers.c2.name' },
      ]);
    });

    it('are compared whole and by case, so that two names that differ in either are two names', () => {
      const document = documentWith({
        queues: { q1: queueRecord('Billing'), q2: queueRecord('billing'), q3: queueRecord('billing ') },
        bindings: {},
        consumers: {},
      });

      expect(found(document)).toEqual([]);
    });
  });

  describe('a queue that is not durable (ADR-0021, ADR-0024)', () => {
    it('is refused with the 541 that the broker gave, and says where it is', () => {
      const document = documentWith({ queues: { ...valid.queues, q9: queueRecord('jobs', { durable: false }) } });
      const [issue, ...rest] = validateDocument(document);

      expect(rest).toEqual([]);
      expect(issue).toMatchObject({
        kind: 'transient-queue',
        path: ['queues', 'q9', 'durable'],
        refusal: transientQueueReply(),
      });
      expect(issue?.message).toContain("Queue 'jobs' is not durable.");
    });

    it('is refused for each such queue', () => {
      const document = documentWith({
        queues: {
          q1: queueRecord('a', { durable: false }),
          q2: queueRecord('b'),
          q3: queueRecord('c', { durable: false }),
        },
        bindings: {},
        consumers: {},
      });

      expect(found(document)).toEqual([
        { kind: 'transient-queue', path: 'queues.q1.durable' },
        { kind: 'transient-queue', path: 'queues.q3.durable' },
      ]);
    });

    it('is not a thing for an exchange, which may be transient', () => {
      expect(
        found(
          documentWith({
            exchanges: { ...valid.exchanges, ex9: exchangeRecord('t', 'direct', { durable: false, autoDelete: true }) },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('bindings', () => {
    const toQueue = (key = '', headers?: ReturnType<typeof headerArguments>, source = 'ex1') =>
      bindingRecord(source, { kind: 'queue', id: 'q1' }, key, headers);

    it('must start from an exchange that is there, and end at a queue or an exchange that is there', () => {
      const document = documentWith({
        bindings: {
          ...valid.bindings,
          noSource: bindingRecord('gone', { kind: 'queue', id: 'q1' }),
          noQueue: bindingRecord('ex1', { kind: 'queue', id: 'gone' }),
          noExchange: bindingRecord('ex1', { kind: 'exchange', id: 'gone' }),
          wrongKind: bindingRecord('ex1', { kind: 'exchange', id: 'q1' }),
          queueAsSource: bindingRecord('q1', { kind: 'queue', id: 'q2' }),
        },
      });

      expect(found(document)).toEqual([
        { kind: 'missing-exchange', path: 'bindings.noSource.source' },
        { kind: 'missing-queue', path: 'bindings.noQueue.dest' },
        { kind: 'missing-exchange', path: 'bindings.noExchange.dest' },
        { kind: 'missing-exchange', path: 'bindings.wrongKind.dest' },
        { kind: 'missing-exchange', path: 'bindings.queueAsSource.source' },
      ]);
    });

    it('may start from and end at the same exchange, and may go round in a cycle', () => {
      const document = documentWith({
        bindings: {
          self: bindingRecord('ex1', { kind: 'exchange', id: 'ex1' }, 'a'),
          there: bindingRecord('ex1', { kind: 'exchange', id: 'ex2' }, 'a'),
          back: bindingRecord('ex2', { kind: 'exchange', id: 'ex1' }, ''),
        },
      });

      expect(found(document)).toEqual([]);
    });

    it('may have a key of 255 bytes and no more', () => {
      expect(found(documentWith({ bindings: { b: toQueue('k'.repeat(255)) } }))).toEqual([]);
      expect(found(documentWith({ bindings: { b: toQueue('k'.repeat(256)) } }))).toEqual([
        { kind: 'routing-key', path: 'bindings.b.key' },
      ]);
    });

    it('may have at most two # words in the key of a topic binding, and is refused with the 406 that the broker gave', () => {
      const document = documentWith({ bindings: { b: toQueue('#.#.#') } });
      const [issue, ...rest] = validateDocument(document);

      expect(rest).toEqual([]);
      expect(issue).toMatchObject({
        kind: 'topic-wildcards',
        path: ['bindings', 'b', 'key'],
        refusal: topicWildcardsReply('#.#.#', 3),
      });
      expect(found(documentWith({ bindings: { b: toQueue('a.#.b.#.c') } }))).toEqual([]);
      expect(found(documentWith({ bindings: { b: toQueue('##.#.#') } }))).toEqual([]);
    });

    it('may have as many # words as it likes when the exchange is not a topic exchange, which does not read the key as one', () => {
      const document = documentWith({
        exchanges: {
          ex1: exchangeRecord('d', 'direct'),
          ex2: exchangeRecord('f', 'fanout'),
          ex3: exchangeRecord('h', 'headers'),
        },
        bindings: {
          b1: toQueue('#.#.#', undefined, 'ex1'),
          b2: toQueue('#.#.#', undefined, 'ex2'),
          b3: toQueue('#.#.#', undefined, 'ex3'),
        },
        producers: {},
      });

      expect(found(document)).toEqual([]);
    });

    it('may carry arguments on any exchange, as a broker takes them, and says what is wrong with arguments that it would not take', () => {
      expect(
        found(documentWith({ bindings: { b: toQueue('', headerArguments('all', entry('a', int(1))), 'ex1') } })),
      ).toEqual([]);
      expect(
        found(
          documentWith({ bindings: { b: toQueue('', headerArguments('all', entry('x-match', str('any'))), 'ex2') } }),
        ),
      ).toEqual([{ kind: 'header', path: 'bindings.b.headers' }]);
      expect(
        found(
          documentWith({
            bindings: { b: toQueue('', headerArguments('all', entry('a', exists), entry('a', exists)), 'ex2') },
          }),
        ),
      ).toEqual([{ kind: 'header', path: 'bindings.b.headers' }]);
    });

    it('is refused when it is the same binding twice: the same ends, key and arguments, in whatever order', () => {
      const a = headerArguments('all', entry('a', int(1)), entry('b', exists));
      const b = headerArguments('all', entry('b', exists), entry('a', int(1)));
      const document = documentWith({
        bindings: {
          one: toQueue('', a, 'ex2'),
          other: toQueue('', headerArguments('all', entry('a', int(2))), 'ex2'),
          two: toQueue('', b, 'ex2'),
          keyed: toQueue('k', a, 'ex2'),
        },
      });

      expect(found(document)).toEqual([{ kind: 'duplicate-edge', path: 'bindings.two' }]);
    });
  });

  describe('producers', () => {
    const publishingTo = (target: ReturnType<typeof producerRecord>['target']) =>
      documentWith({ producers: { p: producerRecord('sender', target) } });

    it('may publish to an exchange or a queue that is there, and may have no target', () => {
      expect(found(publishingTo(null))).toEqual([]);
      expect(found(publishingTo({ kind: 'exchange', id: 'ex1' }))).toEqual([]);
      expect(found(publishingTo({ kind: 'queue', id: 'q1' }))).toEqual([]);
    });

    it('may not publish to something that is not there, or to an internal exchange, which has the broker’s 403 with the vhost', () => {
      expect(found(publishingTo({ kind: 'exchange', id: 'gone' }))).toEqual([
        { kind: 'missing-element', path: 'producers.p.target' },
      ]);
      expect(found(publishingTo({ kind: 'queue', id: 'ex1' }))).toEqual([
        { kind: 'missing-element', path: 'producers.p.target' },
      ]);
      expect(found(publishingTo({ kind: 'exchange', id: 'q1' }))).toEqual([
        { kind: 'missing-element', path: 'producers.p.target' },
      ]);

      const [issue] = validateDocument(publishingTo({ kind: 'exchange', id: 'ex3' }));

      expect(issue).toMatchObject({ kind: 'internal-exchange', refusal: internalExchangeReply('hidden', '/') });
    });

    it('may publish to a queue that is called like an internal exchange, because that is a queue', () => {
      const document = documentWith({
        exchanges: { ...valid.exchanges },
        queues: { ...valid.queues, q3: queueRecord('hidden') },
        producers: { p: producerRecord('sender', { kind: 'queue', id: 'q3' }) },
      });

      expect(found(document)).toEqual([]);
    });

    it('may have a routing key of 255 bytes and no more, and headers that a broker takes', () => {
      const message = (key: string, headers: ReturnType<typeof producerRecord>['message']['headers']) => ({
        payload: '',
        key,
        headers,
      });

      expect(
        found(documentWith({ producers: { p: producerRecord('s', null, { message: message('k'.repeat(255), []) }) } })),
      ).toEqual([]);
      expect(
        found(documentWith({ producers: { p: producerRecord('s', null, { message: message('k'.repeat(256), []) }) } })),
      ).toEqual([{ kind: 'routing-key', path: 'producers.p.message.key' }]);
      expect(
        found(
          documentWith({
            producers: {
              p: producerRecord('s', null, { message: message('', [entry('a', int(1)), entry('a', int(2))]) }),
            },
          }),
        ),
      ).toEqual([{ kind: 'header', path: 'producers.p.message.headers' }]);
    });
  });

  describe('consumers', () => {
    it('may consume from queues that are there, each once', () => {
      expect(found(documentWith({ consumers: { c: consumerRecord('w', ['q1', 'q2']) } }))).toEqual([]);
    });

    it('may not consume from a queue that is not there, or from the same queue twice', () => {
      expect(found(documentWith({ consumers: { c: consumerRecord('w', ['q1', 'gone']) } }))).toEqual([
        { kind: 'missing-queue', path: 'consumers.c.queues' },
      ]);
      expect(found(documentWith({ consumers: { c: consumerRecord('w', ['ex1']) } }))).toEqual([
        { kind: 'missing-queue', path: 'consumers.c.queues' },
      ]);
      expect(found(documentWith({ consumers: { c: consumerRecord('w', ['q1', 'q2', 'q1']) } }))).toEqual([
        { kind: 'duplicate-edge', path: 'consumers.c.queues' },
      ]);
    });
  });

  describe('ids', () => {
    it('are used once across every collection, because a position is kept by id', () => {
      const document = documentWith({
        queues: { ...valid.queues, ex1: queueRecord('clash') },
        consumers: { c1: consumerRecord('worker', ['q1']), q2: consumerRecord('other') },
      });

      expect(found(document).filter(({ kind }) => kind === 'duplicate-id')).toEqual([
        { kind: 'duplicate-id', path: 'queues.ex1' },
        { kind: 'duplicate-id', path: 'consumers.q2' },
      ]);
      expect(validateDocument(document).find(({ kind }) => kind === 'duplicate-id')?.message).toBe(
        "The id 'ex1' is used twice, in exchanges and in queues. An id belongs to one element.",
      );
    });
  });

  describe('the layout', () => {
    it('keeps a position for every element and for nothing else', () => {
      const missing = documentWith({ nodes: { ex1: { x: 0, y: 0 } } });

      expect(found(missing).map(({ kind, path }) => `${kind} ${path}`)).toEqual([
        'layout layout.nodes.ex2',
        'layout layout.nodes.ex3',
        'layout layout.nodes.q1',
        'layout layout.nodes.q2',
        'layout layout.nodes.p1',
        'layout layout.nodes.c1',
      ]);

      const extra = documentOf({ ...valid, nodes: { ...documentOf(valid).layout.nodes, gone: { x: 0, y: 0 } } });

      expect(found(extra)).toEqual([{ kind: 'layout', path: 'layout.nodes.gone' }]);
      expect(validateDocument(extra)[0]?.message).toBe("A position is kept for 'gone', which is not on the canvas.");
    });

    it('keeps a label only for an edge that is there', () => {
      expect(
        found(
          documentWith({
            labels: { 'ex1>q1': { at: 0.1 }, 'p1>ex1': { at: 1 }, 'q1>c1': { at: 0 }, 'ex1>ex3': { at: 0.5 } },
          }),
        ),
      ).toEqual([]);

      const document = documentWith({ labels: { 'q1>ex1': { at: 0.5 }, 'ex1>q2': { at: 0.5 } } });

      expect(found(document)).toEqual([
        { kind: 'layout', path: 'layout.labels.q1>ex1' },
        { kind: 'layout', path: 'layout.labels.ex1>q2' },
      ]);
    });
  });

  it('says everything that is wrong at once, in the order that it checks', () => {
    const document = documentOf({
      vhost: '',
      exchanges: { ex1: exchangeRecord('amq.x', 'topic') },
      queues: { q1: queueRecord('q', { durable: false }) },
      bindings: { b1: bindingRecord('ex1', { kind: 'queue', id: 'q1' }, '#.#.#') },
      producers: { p1: producerRecord('p', { kind: 'exchange', id: 'gone' }) },
      consumers: { c1: consumerRecord('c', ['gone']) },
      nodes: {},
    });

    expect(found(document).map(({ kind }) => kind)).toEqual([
      'empty-name',
      'reserved-name',
      'transient-queue',
      'topic-wildcards',
      'missing-element',
      'missing-queue',
      'layout',
      'layout',
      'layout',
      'layout',
    ]);
  });

  it('does not change the document, and is the same every time', () => {
    const document = deepFreeze(
      documentWith({ queues: { ...valid.queues, q9: queueRecord('amq.x', { durable: false }) } }),
    );

    expect(validateDocument(document)).toEqual(validateDocument(document));
  });

  it('has a message and a path for every issue it finds, whatever is wrong', () => {
    const document = documentOf({
      vhost: '',
      exchanges: { ex1: exchangeRecord('amq.x', 'topic'), ex2: exchangeRecord('') },
      queues: { q1: queueRecord('q', { durable: false }), q2: queueRecord('q') },
      bindings: {
        b1: bindingRecord('ex1', { kind: 'queue', id: 'q1' }, '#.#.#'),
        b2: bindingRecord('nope', { kind: 'queue', id: 'q1' }),
      },
      nodes: {},
    });

    for (const issue of validateDocument(document)) {
      expect(issue.message.length, issue.kind).toBeGreaterThan(10);
      expect(issue.path?.length, issue.kind).toBeGreaterThan(0);
    }
  });
});

describe('parseDocument', () => {
  const asJson = (document: CanvasDocument): unknown => JSON.parse(JSON.stringify(document));

  it('reads a document that is right, as it was saved, and gives a new object', () => {
    const raw = asJson(documentOf(valid));
    const result = parseDocument(raw);

    expect(result.ok && result.value).toEqual(documentOf(valid));
    expect(result.ok && result.value).not.toBe(raw);
  });

  it('refuses a document that has the wrong shape, and says where, one issue for each problem', () => {
    const raw = asJson(documentOf(valid)) as Record<string, unknown>;
    const result = parseDocument({ ...raw, schemaVersion: 2, extra: true });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map(({ kind }) => kind)).toEqual(['schema', 'schema']);
    expect(!result.ok && result.issues.map(({ path }) => path)).toEqual([['schemaVersion'], []]);
    expect(!result.ok && result.issues[1]?.message).toBe('The document: Unrecognized key: "extra"');
  });

  it('refuses a document that has the right shape and is wrong, in the words of a command', () => {
    const raw = asJson(documentWith({ queues: { ...valid.queues, q9: queueRecord('jobs', { durable: false }) } }));
    const result = parseDocument(raw);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toMatchObject([{ kind: 'transient-queue', refusal: { code: 541 } }]);
  });

  it('names the path of a problem in a header, with the engine’s words', () => {
    const raw = asJson(documentOf(valid)) as { producers: { p1: { message: { headers: unknown[] } } } };
    raw.producers.p1.message.headers = [{ key: 'n', value: { t: 'integer', v: 2 ** 53 + 2 } }];
    const result = parseDocument(raw);

    expect(!result.ok && result.issues[0]?.path).toEqual(['producers', 'p1', 'message', 'headers', '0', 'value']);
    expect(!result.ok && result.issues[0]?.message).toBe(
      `producers.p1.message.headers.0.value: ${headerValueIssue({ t: 'integer', v: 2 ** 53 + 2 })}`,
    );
  });

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const result = parseDocument(raw);

        expect(typeof result.ok).toBe('boolean');
      }),
    );
  });

  it('never throws for a document that is nearly right, with any one part damaged', () => {
    const base = asJson(documentOf(valid)) as Record<string, unknown>;
    const keys = Object.keys(base);

    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.anything(), (key, value) => {
        const damaged = { ...base, [key]: value };

        expect(() => parseDocument(damaged)).not.toThrow();
        if (!canvasDocumentSchema.safeParse(damaged).success) {
          expect(parseDocument(damaged).ok).toBe(false);
        }
      }),
    );
  });
});
