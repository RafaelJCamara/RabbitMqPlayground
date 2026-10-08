import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import { deepFreeze, documentOf, queueRecord, sampleDocument, snapshotAfter } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, CANVAS_FILE_FORMAT, SHARE_FORMAT, SHARE_VERSION } from '../files/formats';
import { SIZE_CAPS } from '../load/caps';
import { readShare } from './share';

type Raw = Record<string, unknown>;

/** A fixture as text with a line feed for a line ending, whatever the checkout has (OPEN_QUESTIONS 5). */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../fixtures/schema/v1/${name}`, import.meta.url)), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

/** What a value is after it has been in a link: JSON text and back. */
const viaJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const link = (change: Raw = {}): Raw => ({
  format: SHARE_FORMAT,
  version: SHARE_VERSION,
  name: 'Orders',
  document: viaJson(sampleDocument()),
  ...change,
});

const failedRead = (data: unknown) => {
  const result = readShare(data);
  if (result.ok) {
    throw new Error('expected a failure, and it was read');
  }
  return result.error;
};

const problems = (data: unknown) => {
  const error = failedRead(data);
  return error.kind === 'invalid' ? error.issues.map(({ message }) => message) : error;
};

describe('the envelope of a link (ADR-0077)', () => {
  describe('reading', () => {
    it('reads a canvas by its name and its document, and nothing else', () => {
      const result = readShare(link());

      expect(result).toEqual({ ok: true, value: { name: 'Orders', document: sampleDocument() } });
      expect(result.ok && 'simulation' in result.value).toBe(false);
    });

    it('reads every canvas of the schema fixtures, as the canvas that the loader makes of it', () => {
      for (const name of ['empty.json', 'sample.json', 'typed-headers.json', 'unicode.json', 'limits.json']) {
        const document = JSON.parse(fixture(name)) as CanvasDocument;

        expect(readShare(link({ name, document })), name).toEqual({ ok: true, value: { name, document } });
      }
    });

    it('reads data that is frozen, and does not change it', () => {
      const data = deepFreeze(link());

      expect(readShare(data).ok).toBe(true);
      expect(data).toEqual(link());
    });

    it('keeps a name as the text that it is, whatever it looks like (ADR-0078)', () => {
      for (const name of [
        '<img src=x onerror=alert(1)>',
        '<script>alert(1)</script>',
        '“Orders” – 注文 😀',
        'a&b "c" \'d\'',
      ]) {
        expect(readShare(link({ name }))).toMatchObject({ ok: true, value: { name } });
      }
    });

    it('reads the document in the order of the schema, whatever order the link had', () => {
      const document = viaJson(sampleDocument()) as Raw;
      const shuffled = Object.fromEntries(Object.entries(document).reverse());

      const result = readShare(link({ document: shuffled }));

      expect(result.ok && Object.keys(result.value.document)).toEqual(Object.keys(sampleDocument()));
    });
  });

  describe('data that is not an envelope', () => {
    it.each([[[]], ['text'], [5], [null], [undefined], [true]])('is refused when it is %j', (data) => {
      expect(failedRead(data).kind).toBe('not-an-object');
    });

    it('says that it does not say what it is, and what a link says', () => {
      expect(failedRead({ name: 'x' })).toEqual({
        kind: 'unknown-format',
        message:
          'This is not a link of this app: it does not say what it is. A link has "format": "rmq-playground/share" at the top.',
      });
    });

    it('says what it says that it is', () => {
      expect(failedRead(link({ format: 'something-else' })).message).toBe(
        'This is not a link of this app: its format is "something-else". A link has "format": "rmq-playground/share" at the top.',
      );
      expect(failedRead(link({ format: 5 })).message).toContain('its format is 5.');
    });

    it('is told to open the file of a canvas as a file, and a backup as a backup', () => {
      expect(failedRead(link({ format: CANVAS_FILE_FORMAT }))).toEqual({
        kind: 'unknown-format',
        message: 'This is the file of one canvas, and not a link. Open it with “Open a file…” on the home.',
      });
      expect(failedRead(link({ format: BACKUP_FORMAT }))).toEqual({
        kind: 'unknown-format',
        message:
          'This is a backup of several canvases, and not a link. Put it back with “Restore a backup…” on the home.',
      });
    });

    it('is a document that is not in an envelope, and has no format', () => {
      expect(failedRead(viaJson(sampleDocument())).kind).toBe('unknown-format');
    });
  });

  describe('a version of the format', () => {
    it.each([
      [0, '0'],
      [-1, '-1'],
      [1.5, '1.5'],
      ['1', '"1"'],
      [null, 'null'],
      [undefined, 'nothing'],
    ])('is not one when it is %j', (version, shown) => {
      expect(failedRead(link({ version }))).toEqual({
        kind: 'unknown-format',
        message: `This is not a link of this app: its format version is ${shown}, and a format version is a whole number from 1.`,
      });
    });

    it('that is newer than the app’s is refused, with the version it has, the one the app reads, and what to do', () => {
      expect(failedRead(link({ version: 2 }))).toEqual({
        kind: 'newer-version',
        of: 'link',
        found: 2,
        understood: 1,
        message:
          'This link was made by a newer version of this app. It is link format 2, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      });
    });

    it('that is newer is refused before anything else is looked at, because the rest may mean something else', () => {
      expect(failedRead({ format: SHARE_FORMAT, version: 9, whatever: [1, 2] }).kind).toBe('newer-version');
    });
  });

  describe('an envelope that is the wrong shape', () => {
    it('says which keys are missing, and which it should not have, because it is strict', () => {
      expect(problems({ format: SHARE_FORMAT, version: 1 })).toEqual([
        'name: this is missing.',
        'document: this is missing.',
      ]);
      expect(problems(link({ colour: 'red' }))).toEqual(['The link: Unrecognized key: "colour"']);
    });

    it('says what is wrong with the name', () => {
      expect(problems(link({ name: '' }))).toEqual(['name: A canvas needs a name.']);
      expect(problems(link({ name: '   ' }))).toEqual(['name: A canvas needs a name.']);
      expect(problems(link({ name: 5 }))).toEqual(['name: a name is text, and this is 5.']);
    });

    it('says that a name is too long before it says anything else about the envelope', () => {
      expect(failedRead(link({ name: 'x'.repeat(SIZE_CAPS.name + 1), colour: 'red' }))).toMatchObject({
        kind: 'too-large',
        what: 'name',
        found: SIZE_CAPS.name + 1,
        limit: SIZE_CAPS.name,
      });
      expect(readShare(link({ name: 'x'.repeat(SIZE_CAPS.name) })).ok).toBe(true);
    });

    it('has a sentence that says it is the link that is not valid', () => {
      expect(failedRead(link({ name: '' })).message).toBe('This link is not valid: name: A canvas needs a name.');
      expect(failedRead({ format: SHARE_FORMAT, version: 1 }).message).toBe(
        'This link is not valid. The first of 2 problems: name: this is missing.',
      );
    });
  });

  describe('an envelope whose canvas is wrong', () => {
    it('says that the canvas is from a newer version, as the schema says it, and not the link', () => {
      const newer = { ...(link()['document'] as Raw), schemaVersion: 2 };

      expect(failedRead(link({ document: newer }))).toMatchObject({ kind: 'newer-version', of: 'schema', found: 2 });
    });

    it('says where in the link each problem of the canvas is', () => {
      const broken = { ...(link()['document'] as Raw), vhost: 5 };
      const error = failedRead(link({ document: broken }));

      expect(error.kind === 'invalid' && error.issues.map(({ path }) => path?.join('.'))).toEqual(['document.vhost']);
    });

    it('says that a canvas is too big, before it is read', () => {
      const big = {
        ...(link()['document'] as Raw),
        exchanges: Object.fromEntries(Array.from({ length: SIZE_CAPS.elements + 1 }, (_, i) => [`e${i}`, {}])),
      };

      expect(failedRead(link({ document: big }))).toMatchObject({ kind: 'too-large', what: 'elements' });
    });

    it('says that there is no canvas, or that it is not one', () => {
      expect(failedRead(link({ document: null })).kind).toBe('not-an-object');
      expect(failedRead(link({ document: {} })).kind).toBe('unknown-format');
    });

    it('refuses an x-match that is not one, and an integer that is not safe, which a hostile link would carry (question 3 of OPEN_QUESTIONS)', () => {
      const document = viaJson(sampleDocument()) as {
        bindings: Record<string, { headers: { xMatch: string } }>;
        producers: Raw;
      };
      const badMatch = structuredClone(document);
      badMatch.bindings['B2']!.headers.xMatch = 'bogus';
      expect(failedRead(link({ document: badMatch })).kind).toBe('invalid');

      const unsafe = structuredClone(document) as unknown as {
        producers: Record<string, { message: { headers: { key: string; value: { t: string; v: number } }[] } }>;
      };
      unsafe.producers['P1']!.message.headers = [{ key: 'n', value: { t: 'integer', v: 2 ** 60 } }];
      expect(failedRead(link({ document: unsafe })).kind).toBe('invalid');
    });
  });
});

describe('the messages of a link (ADR-0077)', () => {
  const document = sampleDocument();

  it.each([0, 300, 600, 1_000, 1_400, 2_500])(
    'are read as the snapshot that was sent, for a run of %i ms, with the canvas that they belong to',
    (until) => {
      const snapshot = snapshotAfter(document, until);

      const result = readShare(link({ simulation: viaJson(snapshot) }));

      expect(result).toEqual({ ok: true, value: { name: 'Orders', document, simulation: snapshot } });
    },
  );

  it('are left out of the reading when the link has none, which is a link of the topology only', () => {
    expect(readShare(link())).toEqual({ ok: true, value: { name: 'Orders', document } });
  });

  it('are refused, when they are not the snapshot of an engine, in words that say where', () => {
    const damaged = viaJson(snapshotAfter(document, 600)) as Raw;
    damaged['published'] = -1;

    const error = failedRead(link({ simulation: damaged }));

    expect(error.kind).toBe('invalid');
    expect(error.message).toMatch(
      /^This link is not valid: simulation: the messages that it carries cannot be restored, because published: /,
    );
    expect(error.kind === 'invalid' && error.issues[0]?.path).toEqual(['simulation']);
  });

  it.each([[null], ['text'], [5], [[]], [{}]])('are refused when they are %j', (simulation) => {
    const error = failedRead(link({ simulation }));

    expect(error.kind).toBe('invalid');
    expect(error.message).toContain('simulation: the messages that it carries cannot be restored');
  });

  it('are refused when they belong to another canvas, and the sentence says what differs', () => {
    const other = documentOf({ queues: { Q9: queueRecord('elsewhere') } });
    const foreign = viaJson(snapshotAfter(other, 600));

    const error = failedRead(link({ simulation: foreign }));

    expect(error.kind).toBe('invalid');
    expect(error.message).toContain('simulation: Its messages are not those of this canvas');
  });

  it('are refused when the snapshot contradicts itself, with the first thing that it says that cannot be', () => {
    const snapshot = viaJson(snapshotAfter(document, 1_400)) as { nextMessageId: number };
    snapshot.nextMessageId = 1;

    const error = failedRead(link({ simulation: snapshot }));

    expect(error.kind).toBe('invalid');
    expect(error.message).toMatch(/The number of the next message is 1, and a message is numbered [2-9]/);
  });

  it('are read after the canvas, so that a canvas that is wrong is what is reported', () => {
    const broken = { ...(link()['document'] as Raw), vhost: 5 };

    const error = failedRead(link({ document: broken, simulation: 'junk' }));

    expect(error.kind === 'invalid' && error.issues.map(({ path }) => path?.join('.'))).toEqual(['document.vhost']);
  });

  it('are read against the canvas of the link, which is a canvas with nothing in it, too', () => {
    const empty = emptyDocument();

    expect(readShare(link({ document: viaJson(empty), simulation: viaJson(snapshotAfter(empty, 0)) })).ok).toBe(true);
    expect(readShare(link({ document: viaJson(empty), simulation: viaJson(snapshotAfter(document, 600)) })).ok).toBe(
      false,
    );
  });

  it('never end a sentence twice', () => {
    const damaged = [
      { ...(viaJson(snapshotAfter(document, 600)) as Raw), published: -1 },
      { ...(viaJson(snapshotAfter(document, 600)) as Raw), colour: 1 },
      viaJson(snapshotAfter(documentOf({ queues: { Q9: queueRecord('elsewhere') } }), 0)),
      { ...(viaJson(snapshotAfter(document, 1_400)) as Raw), nextMessageId: 1 },
    ];

    for (const simulation of damaged) {
      expect(failedRead(link({ simulation })).message).not.toContain('..');
    }
  });
});
