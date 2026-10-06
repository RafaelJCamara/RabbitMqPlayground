import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import { deepFreeze, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { SIZE_CAPS } from '../load/caps';
import { CANVAS_FILE_FORMAT, CANVAS_FILE_VERSION } from './formats';
import { parseCanvasFile, readCanvasFile, writeCanvasFile } from './canvas-file';

type Raw = Record<string, unknown>;

/** What some editors put at the start of a UTF-8 file. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A fixture as text with a line feed for a line ending, whatever the checkout has (OPEN_QUESTIONS 5). */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../fixtures/schema/v1/${name}`, import.meta.url)), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

/** The text of a value, one level in: what the file has between its braces. */
const indented = (text: string, spaces: number): string => text.trimEnd().replaceAll('\n', `\n${' '.repeat(spaces)}`);

/** The file of one canvas as version 1 of the format writes it, down to the last space. It is never to change. */
const GOLDEN = `{
  "format": "rmq-playground/canvas",
  "version": 1,
  "name": "Orders",
  "document": ${indented(fixture('empty.json'), 2)}
}
`;

const file = (change: Raw = {}): Raw => ({
  format: CANVAS_FILE_FORMAT,
  version: CANVAS_FILE_VERSION,
  name: 'Orders',
  document: JSON.parse(JSON.stringify(sampleDocument())),
  ...change,
});

const failedRead = (data: unknown) => {
  const result = readCanvasFile(data);
  if (result.ok) {
    throw new Error('expected a failure, and it was read');
  }
  return result.error;
};

describe('the file of one canvas', () => {
  describe('writing', () => {
    it('is JSON with two spaces of indentation and a final newline, in the order format, version, name, document', () => {
      expect(writeCanvasFile({ name: 'Orders', document: emptyDocument() })).toEqual({ ok: true, value: GOLDEN });
    });

    it('writes the same text for the same canvas, every time', () => {
      const canvas = { name: 'Orders', document: sampleDocument() };

      expect(writeCanvasFile(canvas)).toEqual(writeCanvasFile(canvas));
    });

    it('writes from a canvas that is frozen, and does not change it', () => {
      const canvas = deepFreeze({ name: 'Orders', document: sampleDocument() });

      expect(writeCanvasFile(canvas).ok).toBe(true);
      expect(canvas.document).toEqual(sampleDocument());
    });

    it('never writes a file that it would refuse to read, and says what it would have said', () => {
      const broken = { ...sampleDocument(), vhost: '' } as CanvasDocument;
      const result = writeCanvasFile({ name: 'Orders', document: broken });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toEqual(failedRead({ ...file(), document: broken }));
      expect(!result.ok && result.error.kind).toBe('invalid');
    });

    it('does not write a canvas that has no name, or a name that is too long', () => {
      expect(writeCanvasFile({ name: '  ', document: emptyDocument() })).toMatchObject({
        ok: false,
        error: { kind: 'invalid' },
      });
      expect(writeCanvasFile({ name: 'x'.repeat(SIZE_CAPS.name + 1), document: emptyDocument() })).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'name' },
      });
    });
  });

  describe('reading', () => {
    it('reads what it wrote, as the same canvas', () => {
      const canvas = { name: 'Orders ✓', document: sampleDocument() };
      const written = writeCanvasFile(canvas);

      expect(written.ok && parseCanvasFile(written.value)).toEqual({ ok: true, value: canvas });
    });

    it('reads the file as version 1 wrote it, and will read it in every later version', () => {
      expect(parseCanvasFile(GOLDEN)).toEqual({ ok: true, value: { name: 'Orders', document: emptyDocument() } });
    });

    it('reads a file with the line endings of Windows, and one that has a byte order mark', () => {
      expect(parseCanvasFile(GOLDEN.replaceAll('\n', '\r\n')).ok).toBe(true);
      expect(parseCanvasFile(`${BYTE_ORDER_MARK}${GOLDEN}`).ok).toBe(true);
    });

    it('reads data that is already parsed, which is how a link will give it', () => {
      expect(readCanvasFile(file()).ok).toBe(true);
    });

    it('reads every canvas of the schema fixtures, written in a file', () => {
      for (const name of ['empty.json', 'sample.json', 'typed-headers.json', 'unicode.json', 'limits.json']) {
        const document = JSON.parse(fixture(name)) as CanvasDocument;
        const written = writeCanvasFile({ name, document });

        expect(written.ok, name).toBe(true);
        expect(written.ok && parseCanvasFile(written.value), name).toEqual({ ok: true, value: { name, document } });
      }
    });
  });

  describe('text that is not a file', () => {
    it('is refused when it is not JSON, with the parser’s own reason', () => {
      const result = parseCanvasFile(GOLDEN.slice(0, 80));

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).toBe('not-json');
      expect(!result.ok && result.error.message).toMatch(
        /^This is not JSON, so it cannot be a canvas: .+\. The file may be cut off/,
      );
    });

    it.each(['', '   ', 'hello', '{', '{"a":}', 'undefined', '{"a":1}}'])('is refused when it is %j', (text) => {
      expect(parseCanvasFile(text)).toMatchObject({ ok: false, error: { kind: 'not-json' } });
    });

    it('is refused, before anything reads it, when it is longer than a file may be', () => {
      const result = parseCanvasFile('x'.repeat(SIZE_CAPS.file + 1));

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'file', found: SIZE_CAPS.file + 1, limit: SIZE_CAPS.file },
      });
    });

    it('is read when it is exactly as long as a file may be, and found not to be JSON, and not found too long', () => {
      expect(parseCanvasFile(' '.repeat(SIZE_CAPS.file))).toMatchObject({ ok: false, error: { kind: 'not-json' } });
    });

    it('says what it was given when it is not text', () => {
      const result = parseCanvasFile(5 as never);

      expect(result).toMatchObject({ ok: false, error: { kind: 'not-json' } });
      expect(!result.ok && result.error.message).toBe(
        'This is not JSON, so it cannot be a canvas: it is not text, it is 5. The file may be cut off, or it may not be a canvas file at all.',
      );
    });

    it('is refused when it is not text at all, because loading never throws', () => {
      for (const odd of [undefined, null, 5, {}, [], Symbol('s')]) {
        expect(parseCanvasFile(odd as never)).toMatchObject({ ok: false, error: { kind: 'not-json' } });
      }
    });

    it.each(['[]', '"text"', '5', 'null', 'true'])('is refused when it is JSON that is not an object: %s', (text) => {
      expect(parseCanvasFile(text)).toMatchObject({ ok: false, error: { kind: 'not-an-object' } });
    });
  });

  describe('an object that is not a canvas file', () => {
    it('says that it does not say what it is, and what a canvas file says', () => {
      expect(failedRead({ name: 'x' })).toEqual({
        kind: 'unknown-format',
        message:
          'This is not a canvas file of this app: it does not say what it is. A canvas file has "format": "rmq-playground/canvas" at the top.',
      });
    });

    it('says what it says that it is', () => {
      expect(failedRead(file({ format: 'something-else' })).message).toBe(
        'This is not a canvas file of this app: its format is "something-else". A canvas file has "format": "rmq-playground/canvas" at the top.',
      );
      expect(failedRead(file({ format: 5 })).message).toContain('its format is 5.');
    });

    it('is told to open a backup as a backup', () => {
      expect(failedRead(file({ format: 'rmq-playground/backup' }))).toEqual({
        kind: 'unknown-format',
        message: 'This is a backup of several canvases, and not the file of one canvas. Open it as a backup.',
      });
    });

    it('is a document that is not in an envelope, and has no format', () => {
      expect(failedRead(JSON.parse(JSON.stringify(sampleDocument()))).kind).toBe('unknown-format');
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
      expect(failedRead(file({ version }))).toEqual({
        kind: 'unknown-format',
        message: `This is not a canvas file of this app: its format version is ${shown}, and a format version is a whole number from 1.`,
      });
    });

    it('that is newer than the app’s is refused, with the version it has, the one the app reads, and what to do', () => {
      expect(failedRead(file({ version: 2 }))).toEqual({
        kind: 'newer-version',
        of: 'file',
        found: 2,
        understood: 1,
        message:
          'This file was saved by a newer version of this app. It is canvas file format 2, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      });
    });

    it('that is newer is refused before anything else is looked at, because the rest may mean something else', () => {
      expect(failedRead({ format: CANVAS_FILE_FORMAT, version: 9, whatever: [1, 2] }).kind).toBe('newer-version');
    });
  });

  describe('a file that is the wrong shape', () => {
    const problems = (data: unknown) => {
      const error = failedRead(data);
      return error.kind === 'invalid' ? error.issues.map(({ message }) => message) : error;
    };

    it('says which keys are missing, and which it should not have, because it is strict', () => {
      expect(problems({ format: CANVAS_FILE_FORMAT, version: 1 })).toEqual([
        'name: this is missing.',
        'document: this is missing.',
      ]);
      expect(problems(file({ colour: 'red' }))).toEqual(['The file: Unrecognized key: "colour"']);
    });

    it('says what is wrong with the name', () => {
      expect(problems(file({ name: '' }))).toEqual(['name: A canvas needs a name.']);
      expect(problems(file({ name: 5 }))).toEqual(['name: a name is text, and this is 5.']);
      expect(failedRead(file({ name: 'x'.repeat(201) })).kind).toBe('too-large');
    });

    it('has a sentence that says it is the file that is not valid', () => {
      expect(failedRead(file({ name: '' })).message).toBe('This file is not valid: name: A canvas needs a name.');
    });
  });

  describe('a file whose canvas is wrong', () => {
    it('says that the canvas is from a newer version, as the schema says it, and not the file', () => {
      const newer = { ...(file()['document'] as Raw), schemaVersion: 2 };

      expect(failedRead(file({ document: newer }))).toMatchObject({
        kind: 'newer-version',
        of: 'schema',
        found: 2,
      });
    });

    it('says where in the file each problem of the canvas is', () => {
      const broken = { ...(file()['document'] as Raw), vhost: 5 };
      const error = failedRead(file({ document: broken }));

      expect(error.kind === 'invalid' && error.issues.map(({ path }) => path?.join('.'))).toEqual(['document.vhost']);
    });

    it('says that a canvas is too big', () => {
      const big = {
        ...(file()['document'] as Raw),
        exchanges: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`e${i}`, {}])),
      };

      expect(failedRead(file({ document: big }))).toMatchObject({ kind: 'too-large', what: 'elements' });
    });

    it('says that there is no canvas, or that it is not one', () => {
      expect(failedRead(file({ document: null })).kind).toBe('not-an-object');
      expect(failedRead(file({ document: {} })).kind).toBe('unknown-format');
    });
  });
});
