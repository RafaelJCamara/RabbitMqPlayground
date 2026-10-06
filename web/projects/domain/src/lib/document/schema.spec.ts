import { headerValueIssue } from '@rmq/engine';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import {
  canvasDocumentSchema,
  DEFAULT_SEED,
  DEFAULT_TIMING,
  EDGE_KEY_PATTERN,
  emptyDocument,
  ID_PATTERN,
  LIMITS,
  type CanvasDocument,
} from './schema';

/** A document that uses every part of the schema. */
const full: CanvasDocument = documentOf({
  vhost: 'prod',
  exchanges: {
    ex1: exchangeRecord('orders', 'headers', { internal: true, autoDelete: true, durable: false }),
    ex2: exchangeRecord('audit', 'topic'),
  },
  queues: { q1: queueRecord('billing'), q2: queueRecord('amq.gen-x', { serverNamed: true }) },
  bindings: {
    b1: bindingRecord(
      'ex1',
      { kind: 'queue', id: 'q1' },
      '',
      headerArguments(
        'any-with-x',
        entry('s', { t: 'string', v: '1' }),
        entry('i', { t: 'integer', v: 1 }),
        entry('f', { t: 'float', v: 1 }),
        entry('b', { t: 'boolean', v: true }),
        entry('e', { t: 'exists' }),
      ),
    ),
    b2: bindingRecord('ex2', { kind: 'exchange', id: 'ex1' }, 'a.#'),
  },
  producers: {
    p1: producerRecord(
      'sender',
      { kind: 'exchange', id: 'ex2' },
      {
        message: {
          payload: 'hello',
          key: 'a.b',
          headers: [entry('n', { t: 'integer', v: 7 }), entry('x', { t: 'float', v: 7 })],
        },
        burst: 3,
        interval: { everyMs: 250, on: true },
      },
    ),
  },
  consumers: { c1: consumerRecord('worker', ['q1'], { ack: 'manual', prefetch: 5, processingMs: 100 }) },
  labels: { 'ex1>q1': { at: 0.25 } },
});

const roundTrip = (document: CanvasDocument): unknown => JSON.parse(JSON.stringify(document));
const issuesOf = (raw: unknown) => {
  const result = canvasDocumentSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};
/** A copy of `full` with the value at `path` replaced. */
function changed(path: readonly (string | number)[], value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(full)) as Record<string, unknown>;
  let at: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) {
    at = at[key] as Record<string, unknown>;
  }
  at[path.at(-1) as string] = value;
  return copy;
}

describe('emptyDocument', () => {
  it('is a canvas with nothing on it, for RabbitMQ 4.3 and the vhost /', () => {
    expect(emptyDocument()).toEqual({
      schemaVersion: 1,
      rabbitmqBaseline: '4.3',
      vhost: '/',
      exchanges: {},
      queues: {},
      bindings: {},
      producers: {},
      consumers: {},
      layout: { nodes: {}, labels: {} },
      settings: { showDefaultExchange: false, seed: 1, timing: { publishMs: 500, brokerMs: 300, deliverMs: 500 } },
    });
    expect(DEFAULT_SEED).toBe(1);
    expect(DEFAULT_TIMING).toEqual({ publishMs: 500, brokerMs: 300, deliverMs: 500 });
  });

  it('takes a vhost and a seed', () => {
    expect(emptyDocument({ vhost: 'prod', seed: 42 })).toMatchObject({ vhost: 'prod', settings: { seed: 42 } });
    expect(emptyDocument({ seed: 0 }).settings.seed).toBe(0);
  });

  it('is valid, and is a new object each time, so that no two canvases share a record', () => {
    expect(canvasDocumentSchema.safeParse(emptyDocument()).success).toBe(true);
    expect(emptyDocument()).not.toBe(emptyDocument());
    expect(emptyDocument().exchanges).not.toBe(emptyDocument().exchanges);
    expect(emptyDocument().settings.timing).not.toBe(DEFAULT_TIMING);
  });
});

describe('the document schema', () => {
  it('accepts a document that uses every part of it, and gives it back as it was', () => {
    expect(canvasDocumentSchema.parse(deepFreeze(structuredClone(full)))).toEqual(full);
  });

  it('survives JSON, which is how a document is saved and shared', () => {
    expect(canvasDocumentSchema.parse(roundTrip(full))).toEqual(full);
  });

  it('keeps the type of a header value, because JSON cannot tell 1 from 1.0 and a headers exchange can', () => {
    const parsed = canvasDocumentSchema.parse(roundTrip(full));
    const args = parsed.bindings['b1']?.headers?.args.map(({ value }) => value.t);

    expect(args).toEqual(['string', 'integer', 'float', 'boolean', 'exists']);
    expect(parsed.bindings['b1']?.headers?.args[1]?.value).toEqual({ t: 'integer', v: 1 });
    expect(parsed.bindings['b1']?.headers?.args[2]?.value).toEqual({ t: 'float', v: 1 });
  });

  it('accepts a binding without arguments, and a binding whose x-match is left out', () => {
    expect(issuesOf(changed(['bindings', 'b2', 'headers'], undefined))).toEqual([]);
    expect(issuesOf(changed(['bindings', 'b1', 'headers', 'xMatch'], null))).toEqual([]);
  });

  it('accepts every value of every enumeration: the exchange types, the modes of x-match, both kinds of target and of destination, both acknowledgements', () => {
    for (const type of ['direct', 'fanout', 'topic', 'headers']) {
      expect(issuesOf(changed(['exchanges', 'ex1', 'type'], type)), type).toEqual([]);
    }
    for (const mode of ['all', 'any', 'all-with-x', 'any-with-x', null]) {
      expect(issuesOf(changed(['bindings', 'b1', 'headers', 'xMatch'], mode)), String(mode)).toEqual([]);
    }
    for (const kind of ['exchange', 'queue']) {
      expect(issuesOf(changed(['producers', 'p1', 'target', 'kind'], kind)), kind).toEqual([]);
      expect(issuesOf(changed(['bindings', 'b2', 'dest', 'kind'], kind)), kind).toEqual([]);
    }
    for (const ack of ['auto', 'manual']) {
      expect(issuesOf(changed(['consumers', 'c1', 'ack'], ack)), ack).toEqual([]);
    }
  });

  describe('refuses', () => {
    it('a key that it does not know, at any depth, so that a typo or a newer file is not lost quietly', () => {
      expect(issuesOf({ ...full, extra: 1 })).toEqual([': Unrecognized key: "extra"']);
      expect(issuesOf(changed(['layout', 'extra'], {}))).toHaveLength(1);
      expect(issuesOf(changed(['exchanges', 'ex1', 'colour'], 'red'))).toHaveLength(1);
      expect(issuesOf(changed(['bindings', 'b1', 'dest', 'extra'], 1))).toHaveLength(1);
      expect(issuesOf(changed(['settings', 'timing', 'extra'], 1))).toHaveLength(1);
    });

    it('a version or a baseline that is not the one this schema is for', () => {
      expect(issuesOf(changed(['schemaVersion'], 2))).toHaveLength(1);
      expect(issuesOf(changed(['rabbitmqBaseline'], '4.2'))).toHaveLength(1);
    });

    it('something that is not a document', () => {
      for (const raw of [null, undefined, 5, 'x', [], { schemaVersion: 1 }]) {
        expect(canvasDocumentSchema.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
      }
    });

    it('an exchange type that RabbitMQ does not have, and a mode of x-match that it does not have', () => {
      expect(issuesOf(changed(['exchanges', 'ex1', 'type'], 'quorum'))).toHaveLength(1);
      expect(issuesOf(changed(['bindings', 'b1', 'headers', 'xMatch'], 'some'))).toHaveLength(1);
    });

    it('a field of the wrong type', () => {
      expect(issuesOf(changed(['exchanges', 'ex1', 'durable'], 'yes'))).toHaveLength(1);
      expect(issuesOf(changed(['queues', 'q1', 'name'], 5))).toHaveLength(1);
      expect(issuesOf(changed(['producers', 'p1', 'target'], undefined))).toHaveLength(1);
      expect(issuesOf(changed(['consumers', 'c1', 'queues'], 'q1'))).toHaveLength(1);
    });

    it('a header value with no type, or with a type that it does not know', () => {
      expect(issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: 7 }]))).toHaveLength(1);
      expect(
        issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: { t: 'long', v: 7 } }])),
      ).toHaveLength(1);
      expect(
        issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: { t: 'integer', v: '7' } }])),
      ).toHaveLength(1);
    });

    it('a message header that only asks for the header to be there, which is a condition and not a value', () => {
      expect(
        issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: { t: 'exists' } }])),
      ).toHaveLength(1);
    });

    it('an integer header that is not a safe integer, in the engine’s words (ADR-0023)', () => {
      const unsafe = Number.MAX_SAFE_INTEGER + 2;
      const expected = headerValueIssue({ t: 'integer', v: unsafe });
      const found = issuesOf(changed(['bindings', 'b1', 'headers', 'args', 0, 'value'], { t: 'integer', v: unsafe }));

      expect(found).toEqual([`bindings.b1.headers.args.0.value: ${expected}`]);
      expect(
        issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: { t: 'integer', v: 1.5 } }])),
      ).toHaveLength(1);
    });

    it('the largest safe integers are fine, and so is a float with a fraction', () => {
      const edge = [
        { key: 'a', value: { t: 'integer', v: Number.MAX_SAFE_INTEGER } },
        { key: 'b', value: { t: 'integer', v: Number.MIN_SAFE_INTEGER } },
        { key: 'c', value: { t: 'float', v: 0.1 } },
      ];

      expect(issuesOf(changed(['producers', 'p1', 'message', 'headers'], edge))).toEqual([]);
    });

    it('a float that is not finite, which JSON cannot write anyway', () => {
      for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(
          issuesOf(changed(['producers', 'p1', 'message', 'headers'], [{ key: 'n', value: { t: 'float', v } }])),
          String(v),
        ).toHaveLength(1);
      }
    });
  });

  describe('ids', () => {
    it.each([
      ['a letter', 'e', true],
      ['letters and digits', 'ex1', true],
      ['a UUID with a prefix', 'q-3f2504e0-4f89-11d3-9a0c-0305e82c3301', true],
      ['the characters . : - and _', 'a.b:c-d_e', true],
      ['a name that Object.prototype has', 'constructor', true],
      ['64 characters', `a${'b'.repeat(63)}`, true],
      ['65 characters', `a${'b'.repeat(64)}`, false],
      ['nothing', '', false],
      ['a digit first, which a JavaScript object would list before the others', '1a', false],
      ['a number', '12', false],
      ['an underscore first, which includes __proto__', '__proto__', false],
      ['a space', 'a b', false],
      ['a slash', 'a/b', false],
      ['a greater-than sign, which is for edges', 'a>b', false],
      ['non-ASCII letters', 'é', false],
    ])('has %s: %j is %s', (_what, id, valid) => {
      expect(ID_PATTERN.test(id)).toBe(valid);
    });

    it('is checked for the keys of every record, and for every reference', () => {
      expect(issuesOf(changed(['exchanges'], { '1a': full.exchanges['ex1'] }))).toHaveLength(1);
      expect(issuesOf(changed(['bindings', 'b1', 'source'], '1a'))).toHaveLength(1);
      expect(issuesOf(changed(['bindings', 'b1', 'dest', 'id'], '__proto__'))).toHaveLength(1);
      expect(issuesOf(changed(['producers', 'p1', 'target', 'id'], ''))).toHaveLength(1);
      expect(issuesOf(changed(['consumers', 'c1', 'queues'], ['q1', '1a']))).toHaveLength(1);
      expect(issuesOf(changed(['layout', 'nodes'], { '1a': { x: 0, y: 0 } }))).toHaveLength(1);
    });

    it('names an edge by the two ids that it joins', () => {
      expect(EDGE_KEY_PATTERN.test('ex1>q1')).toBe(true);
      expect(EDGE_KEY_PATTERN.test('ex1')).toBe(false);
      expect(EDGE_KEY_PATTERN.test('ex1>')).toBe(false);
      expect(EDGE_KEY_PATTERN.test('>q1')).toBe(false);
      expect(EDGE_KEY_PATTERN.test('1a>q1')).toBe(false);
      expect(EDGE_KEY_PATTERN.test('a>b>c')).toBe(false);
      expect(issuesOf(changed(['layout', 'labels'], { nope: { at: 0.5 } }))).toHaveLength(1);
    });

    it('keeps a record that has an id like `constructor` as an ordinary entry', () => {
      const parsed = canvasDocumentSchema.parse(changed(['exchanges'], { constructor: full.exchanges['ex1'] }));

      expect(Object.keys(parsed.exchanges)).toEqual(['constructor']);
      expect(Object.getPrototypeOf(parsed.exchanges)).toBe(Object.prototype);
    });
  });

  describe('the ranges of numbers', () => {
    const at = (path: (string | number)[], min: number, max: number) => {
      expect(issuesOf(changed(path, min)), `${path.join('.')} = ${min}`).toEqual([]);
      expect(issuesOf(changed(path, max)), `${path.join('.')} = ${max}`).toEqual([]);
      expect(issuesOf(changed(path, min - 1)), `${path.join('.')} = ${min - 1}`).toHaveLength(1);
      expect(issuesOf(changed(path, max + 1)), `${path.join('.')} = ${max + 1}`).toHaveLength(1);
    };

    it('holds for what a producer does', () => {
      at(['producers', 'p1', 'burst'], LIMITS.burst.min, LIMITS.burst.max);
      at(['producers', 'p1', 'interval', 'everyMs'], LIMITS.everyMs.min, LIMITS.everyMs.max);
    });

    it('holds for what a consumer does', () => {
      at(['consumers', 'c1', 'prefetch'], LIMITS.prefetch.min, LIMITS.prefetch.max);
      at(['consumers', 'c1', 'processingMs'], LIMITS.processingMs.min, LIMITS.processingMs.max);
    });

    it('holds for the settings', () => {
      at(['settings', 'seed'], LIMITS.seed.min, LIMITS.seed.max);
      at(['settings', 'timing', 'publishMs'], LIMITS.timingMs.min, LIMITS.timingMs.max);
      at(['settings', 'timing', 'brokerMs'], LIMITS.timingMs.min, LIMITS.timingMs.max);
      at(['settings', 'timing', 'deliverMs'], LIMITS.timingMs.min, LIMITS.timingMs.max);
    });

    it('holds for whole numbers: a fraction is refused where a count is meant', () => {
      for (const path of [
        ['producers', 'p1', 'burst'],
        ['producers', 'p1', 'interval', 'everyMs'],
        ['consumers', 'c1', 'prefetch'],
        ['consumers', 'c1', 'processingMs'],
        ['settings', 'seed'],
        ['settings', 'timing', 'publishMs'],
      ]) {
        expect(issuesOf(changed(path, 1.5)), path.join('.')).toHaveLength(1);
      }
    });

    it('holds for where a node is, which may be a fraction and may be negative', () => {
      const limit = LIMITS.coordinate;

      expect(issuesOf(changed(['layout', 'nodes', 'ex1'], { x: -limit, y: limit }))).toEqual([]);
      expect(issuesOf(changed(['layout', 'nodes', 'ex1'], { x: 12.5, y: -0.25 }))).toEqual([]);
      expect(issuesOf(changed(['layout', 'nodes', 'ex1'], { x: limit + 1, y: 0 }))).toHaveLength(1);
      expect(issuesOf(changed(['layout', 'nodes', 'ex1'], { x: 0, y: -limit - 1 }))).toHaveLength(1);
      expect(issuesOf(changed(['layout', 'nodes', 'ex1'], { x: 0 }))).toHaveLength(1);
    });

    it('holds for where a label is along its edge: from the start, 0, to the end, 1', () => {
      expect(issuesOf(changed(['layout', 'labels', 'ex1>q1', 'at'], 0))).toEqual([]);
      expect(issuesOf(changed(['layout', 'labels', 'ex1>q1', 'at'], 1))).toEqual([]);
      expect(issuesOf(changed(['layout', 'labels', 'ex1>q1', 'at'], -0.01))).toHaveLength(1);
      expect(issuesOf(changed(['layout', 'labels', 'ex1>q1', 'at'], 1.01))).toHaveLength(1);
    });
  });
});
