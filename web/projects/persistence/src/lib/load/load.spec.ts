import { edgeCount, elementCount, emptyDocument, LIMITS, type CanvasDocument, type ParsedDocument } from '@rmq/domain';
import { bindingRecord, deepFreeze, documentOf, exchangeRecord, producerRecord, sampleDocument } from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import { notAnObject } from '../errors';
import { SIZE_CAPS } from './caps';
import { loadCanvas, loadWith, type Pipeline } from './load';
import { CURRENT_SCHEMA_VERSION, type Migration } from './migrations';

type Raw = Record<string, unknown>;

/** What a file or a database gives back: plain data that nothing vouches for. */
const plain = (document: unknown): Raw => JSON.parse(JSON.stringify(document)) as Raw;

const sample = (): Raw => plain(sampleDocument());

const failed = (raw: unknown) => {
  const result = loadCanvas(raw);
  if (result.ok) {
    throw new Error('expected a failure, and it loaded');
  }
  return result.error;
};

/** Every object and array that is inside a value, and the value itself. */
function containers(value: unknown, into = new Set<object>()): Set<object> {
  if (typeof value === 'object' && value !== null && !into.has(value)) {
    into.add(value);
    Object.values(value).forEach((inner) => containers(inner, into));
  }
  return into;
}

describe('loadCanvas', () => {
  describe('a canvas that is right', () => {
    it('loads an empty canvas, and says it is the current version', () => {
      const result = loadCanvas(plain(emptyDocument()));

      expect(result).toEqual({ ok: true, value: { document: emptyDocument(), from: CURRENT_SCHEMA_VERSION } });
    });

    it('loads a canvas that has a little of everything, as the same document', () => {
      const result = loadCanvas(sample());

      expect(result.ok && result.value.document).toEqual(sampleDocument());
    });

    it('keeps what makes a document what it is: the order of the entries, and the types of the header values', () => {
      const result = loadCanvas(sample());
      const document = result.ok ? result.value.document : undefined;

      expect(Object.keys(document?.exchanges ?? {})).toEqual(['E1', 'E2', 'E3']);
      expect(document?.producers['P1']?.message.headers).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
    });

    it('does not change what it is given, which can be frozen', () => {
      const raw = deepFreeze(sample());

      expect(loadCanvas(raw).ok).toBe(true);
      expect(raw).toEqual(sample());
    });

    it('gives back a document that shares nothing with what it was given, so that the caller may keep or change either', () => {
      const raw = sample();
      const inputs = containers(raw);
      const result = loadCanvas(raw);
      const outputs = result.ok ? containers(result.value.document) : new Set<object>();

      expect(outputs.size).toBeGreaterThan(10);
      expect([...outputs].filter((object) => inputs.has(object))).toEqual([]);
    });
  });

  describe('something that is not a canvas at all', () => {
    it.each([
      ['nothing', undefined],
      ['null', null],
      ['text', '{"schemaVersion":1}'],
      ['a number', 1],
      ['true', true],
      ['a list', [emptyDocument()]],
      ['a function', () => emptyDocument()],
    ])('is refused, whatever it is: %s', (_what, raw) => {
      expect(failed(raw)).toEqual(notAnObject(raw));
      expect(failed(raw).kind).toBe('not-an-object');
    });
  });

  describe('an object that does not say which version it is', () => {
    const message = (found: string) =>
      `This does not look like a canvas that this app made: ${found} Only a canvas that this app saved can be opened.`;

    it('is refused, with what it should have', () => {
      expect(failed({})).toEqual({
        kind: 'unknown-format',
        message: message('it does not say which schema version it has.'),
      });
      expect(failed({ ...sample(), schemaVersion: undefined })).toMatchObject({ kind: 'unknown-format' });
    });

    it.each([
      [0, '0'],
      [-1, '-1'],
      [1.5, '1.5'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      ['1', '"1"'],
      [null, 'null'],
      [true, 'true'],
      [[1], 'a list'],
      [{}, 'an object'],
    ])('is refused when the version is %j', (version, shown) => {
      expect(failed({ ...sample(), schemaVersion: version })).toEqual({
        kind: 'unknown-format',
        message: message(`its schema version is ${shown}, and a schema version is a whole number from 1.`),
      });
    });
  });

  describe('a canvas from a newer version of the app', () => {
    it('is refused, with the version that it has, the one the app understands, and what to do', () => {
      const error = failed({ ...sample(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });

      expect(error).toEqual({
        kind: 'newer-version',
        of: 'schema',
        found: CURRENT_SCHEMA_VERSION + 1,
        understood: CURRENT_SCHEMA_VERSION,
        message:
          'This canvas was saved by a newer version of this app. It uses schema version 2, and this version understands up to 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      });
    });

    it('is refused before anything else is looked at, because the rest of it may mean something that this version does not know', () => {
      const nothingLikeADocument = { schemaVersion: 7, exchanges: 'x', queues: { q: { whatever: [] } }, surprise: 1 };
      const huge = {
        schemaVersion: 2,
        exchanges: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`e${i}`, {}])),
      };

      expect(failed(nothingLikeADocument).kind).toBe('newer-version');
      expect(failed(huge).kind).toBe('newer-version');
    });
  });

  describe('a canvas that commands could make (ADR-0029)', () => {
    it('loads when it holds as much as the commands allow, which is the loader’s own cap', () => {
      const range = (count: number) => Array.from({ length: count }, (_, index) => index);
      const document = documentOf({
        exchanges: Object.fromEntries(
          range(LIMITS.elements - 1).map((i) => [`E${i}`, exchangeRecord(`e${i}`, 'headers')]),
        ),
        producers: {
          P: producerRecord('p', null, {
            message: {
              payload: 'x'.repeat(LIMITS.textLength),
              key: '',
              headers: range(LIMITS.headerEntries).map((i) => ({
                key: `h${i}`,
                value: { t: 'string' as const, v: 'y'.repeat(LIMITS.textLength) },
              })),
            },
          }),
        },
        bindings: Object.fromEntries(
          range(LIMITS.edges).map((i) => [
            `B${i}`,
            bindingRecord('E0', { kind: 'exchange', id: `E${(i % (LIMITS.elements - 2)) + 1}` }, `key.${i}`),
          ]),
        ),
      });

      expect(elementCount(document)).toBe(SIZE_CAPS.elements);
      expect(edgeCount(document)).toBe(SIZE_CAPS.edges);
      expect(loadCanvas(plain(document))).toEqual({ ok: true, value: { document, from: CURRENT_SCHEMA_VERSION } });
    });

    it('is refused for one more, by the same numbers that the commands refuse at', () => {
      expect([SIZE_CAPS.elements, SIZE_CAPS.edges, SIZE_CAPS.headers, SIZE_CAPS.text]).toEqual([
        LIMITS.elements,
        LIMITS.edges,
        LIMITS.headerEntries,
        LIMITS.textLength,
      ]);
    });
  });

  describe('a canvas that is too big', () => {
    it('is refused with what is too big, how much it is, and how much is allowed, before the schema reads it', () => {
      const exchanges = Object.fromEntries(
        Array.from({ length: SIZE_CAPS.elements + 1 }, (_, i) => [`e${i}`, 'not even an exchange']),
      );
      const error = failed({ ...emptyDocument(), exchanges });

      expect(error).toMatchObject({
        kind: 'too-large',
        what: 'elements',
        found: SIZE_CAPS.elements + 1,
        limit: SIZE_CAPS.elements,
      });
    });

    it('is allowed up to the cap, and then it is the schema’s to say what is wrong', () => {
      const exchanges = Object.fromEntries(
        Array.from({ length: SIZE_CAPS.elements }, (_, i) => [`e${i}`, 'not even an exchange']),
      );
      const error = failed({ ...emptyDocument(), exchanges });

      expect(error.kind).toBe('invalid');
    });
  });

  describe('a canvas that is not valid', () => {
    it('is refused, with every problem that was found and a sentence that names the first', () => {
      const raw = sample();
      (raw['queues'] as Record<string, Raw>)['Q1'] = { name: 5, serverNamed: false, durable: true };
      (raw['layout'] as Raw)['extra'] = 1;
      const error = failed(raw);

      expect(error.kind).toBe('invalid');
      expect(error.kind === 'invalid' && error.issues.map(({ path }) => path?.join('.'))).toEqual([
        'queues.Q1.name',
        'layout',
      ]);
      expect(error.message).toBe(
        'This canvas is not valid. The first of 2 problems: queues.Q1.name: Invalid input: expected string, received number',
      );
    });

    it('says what is wrong with the data itself, so that a file that is cut off or edited says where', () => {
      const raw = sample();
      delete raw['settings'];

      expect(failed(raw).message).toBe(
        'This canvas is not valid: settings: Invalid input: expected object, received undefined',
      );
    });

    it('refuses a key that it does not know, because the document is strict', () => {
      expect(failed({ ...sample(), extra: 1 }).message).toBe(
        'This canvas is not valid: The document: Unrecognized key: "extra"',
      );
    });

    it('refuses what the broker would refuse, with the broker’s reply, even in a file', () => {
      const raw = sample();
      (raw['queues'] as Record<string, Raw>)['Q1'] = { name: 'billing', serverNamed: false, durable: false };
      const error = failed(raw);

      expect(error.kind === 'invalid' && error.issues[0]).toMatchObject({
        kind: 'transient-queue',
        path: ['queues', 'Q1', 'durable'],
        refusal: { code: 541 },
      });
    });

    it('refuses a reference to something that is not there', () => {
      const raw = sample();
      (raw['bindings'] as Record<string, Raw>)['B1'] = { source: 'E1', dest: { kind: 'queue', id: 'nope' }, key: 'k' };
      const error = failed(raw);

      expect(error.kind === 'invalid' && error.issues.map(({ kind }) => kind)).toContain('missing-queue');
    });
  });

  describe('data that cannot even be read', () => {
    it('is a typed error, because loading never throws', () => {
      const hostile = {
        get schemaVersion(): number {
          throw new Error('no, you may not');
        },
      };
      const error = failed(hostile);

      expect(error.kind).toBe('invalid');
      expect(error.message).toBe('This canvas is not valid: The data could not be read: no, you may not');
      expect(error.kind === 'invalid' && error.issues).toEqual([
        { kind: 'schema', message: 'The data could not be read: no, you may not' },
      ]);
    });

    it('is a typed error when it is a later step that cannot read it', () => {
      const hostile = {
        schemaVersion: 1,
        get exchanges(): unknown {
          throw new RangeError('deep inside');
        },
      };

      expect(failed(hostile)).toMatchObject({ kind: 'invalid' });
      expect(failed(hostile).message).toContain('deep inside');
    });

    it('is a typed error for a proxy that throws at every question', () => {
      const proxy = new Proxy(
        {},
        {
          get() {
            throw new Error('trap');
          },
          ownKeys() {
            throw new Error('trap');
          },
        },
      );

      expect(failed(proxy).kind).toBe('invalid');
    });
  });
});

describe('the order in which a load goes, with steps that a spec chooses', () => {
  /** v1 { title } → v2 { name } → v3 { name, tags }; the parser is a stand-in, since only version 1 is a document. */
  const steps: readonly Migration[] = [
    { from: 1, migrate: (document) => ({ name: document['title'] }) },
    { from: 2, migrate: (document) => ({ ...document, tags: [] }) },
  ];
  const accepting = (): Pipeline & { parse: ReturnType<typeof vi.fn> } => ({
    current: 3,
    migrations: steps,
    parse: vi.fn((raw: unknown): ParsedDocument => ({ ok: true, value: raw as CanvasDocument })),
  });

  it('checks the version, migrates, checks the caps, and then lets the schema read what came out', () => {
    const pipeline = accepting();
    const result = loadWith({ schemaVersion: 1, title: 'orders' }, pipeline);

    expect(result).toEqual({ ok: true, value: { document: { schemaVersion: 3, name: 'orders', tags: [] }, from: 1 } });
    expect(pipeline.parse).toHaveBeenCalledOnce();
    expect(pipeline.parse).toHaveBeenCalledWith({ schemaVersion: 3, name: 'orders', tags: [] });
  });

  it('says which version the data had before it was brought up to date', () => {
    expect(loadWith({ schemaVersion: 2, name: 'x' }, accepting())).toMatchObject({ ok: true, value: { from: 2 } });
    expect(loadWith({ schemaVersion: 3, name: 'x', tags: [] }, accepting())).toMatchObject({
      ok: true,
      value: { from: 3 },
    });
  });

  it('refuses a newer version before it migrates anything, and does not call the schema', () => {
    const pipeline = accepting();
    const migrate = vi.fn();
    const error = loadWith({ schemaVersion: 4 }, { ...pipeline, migrations: [{ from: 3, migrate }] });

    expect(error).toMatchObject({ ok: false, error: { kind: 'newer-version', found: 4, understood: 3 } });
    expect(migrate).not.toHaveBeenCalled();
    expect(pipeline.parse).not.toHaveBeenCalled();
  });

  it('looks at the caps in what the migrations made, and not in what they were given', () => {
    const pipeline = accepting();
    const grow: Migration = {
      from: 1,
      migrate: () => ({
        exchanges: Object.fromEntries(Array.from({ length: SIZE_CAPS.elements + 1 }, (_, i) => [`e${i}`, {}])),
      }),
    };
    const result = loadWith({ schemaVersion: 1 }, { ...pipeline, current: 2, migrations: [grow] });

    expect(result).toMatchObject({ ok: false, error: { kind: 'too-large', what: 'elements' } });
    expect(pipeline.parse).not.toHaveBeenCalled();
  });

  it('is told that a step failed, and says which, and does not call the schema', () => {
    const pipeline = accepting();
    const boom: Migration = {
      from: 2,
      migrate: () => {
        throw new Error('boom');
      },
    };
    const result = loadWith(
      { schemaVersion: 1, title: 'x' },
      { ...pipeline, migrations: [steps[0] as Migration, boom] },
    );

    expect(result).toMatchObject({ ok: false, error: { kind: 'migration-failed', from: 2 } });
    expect(pipeline.parse).not.toHaveBeenCalled();
  });

  it('is told that a version has no way forward', () => {
    const pipeline = accepting();
    const result = loadWith({ schemaVersion: 1, title: 'x' }, { ...pipeline, migrations: [] });

    expect(result).toMatchObject({ ok: false, error: { kind: 'unsupported-version', found: 1 } });
    expect(pipeline.parse).not.toHaveBeenCalled();
  });

  it('reports what the schema found, as it found it', () => {
    const issues = [{ kind: 'schema' as const, message: 'name: no' }];
    const result = loadWith({ schemaVersion: 3 }, { ...accepting(), parse: () => ({ ok: false, issues }) });

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid', issues } });
  });
});
