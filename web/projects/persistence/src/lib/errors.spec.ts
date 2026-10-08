import { describe, expect, it } from 'vitest';
import {
  classifyStorageError,
  existsError,
  invalidError,
  migrationFailed,
  newerVersion,
  notAnObject,
  notFound,
  notJson,
  reasonOf,
  StorageFailure,
  summarise,
  thousands,
  tooLarge,
  unknownFormat,
  unsupportedVersion,
} from './errors';
import { failure, succeed } from './outcome';

describe('an outcome', () => {
  it('is a value that says it is one, or an error that says what went wrong', () => {
    expect(succeed(3)).toEqual({ ok: true, value: 3 });
    expect(failure({ kind: 'x' })).toEqual({ ok: false, error: { kind: 'x' } });
  });
});

describe('thousands', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [12_345, '12,345'],
    [50_000_000, '50,000,000'],
    [1_234_567, '1,234,567'],
  ])('writes %i as %s, the same in every locale', (value, text) => {
    expect(thousands(value)).toBe(text);
  });
});

describe('the errors of a load', () => {
  it('says what the data is when it is not an object, in words', () => {
    const said = (value: unknown) => notAnObject(value).message;

    expect(notAnObject('x')).toMatchObject({ kind: 'not-an-object' });
    expect(said('x')).toBe('This is not a canvas. A canvas is an object with fields in it, and this is text.');
    expect(said(null)).toContain('and this is nothing (null).');
    expect(said(undefined)).toContain('and this is nothing (undefined).');
    expect(said([])).toContain('and this is a list.');
    expect(said(4)).toContain('and this is a number.');
    expect(said(4n)).toContain('and this is a number.');
    expect(said(true)).toContain('and this is true or false.');
    expect(said(() => 1)).toContain('and this is a function.');
    expect(said(Symbol('s'))).toContain('and this is a symbol.');
    expect(said({})).toContain('and this is an object.');
  });

  it('says that the text is not JSON, with the parser’s own reason', () => {
    const error = notJson('Unexpected end of JSON input');

    expect(error.kind).toBe('not-json');
    expect(error.message).toBe(
      'This is not JSON, so it cannot be a canvas: Unexpected end of JSON input. The file may be cut off, or it may not be a canvas file at all.',
    );
  });

  it('says what it could not make of a format', () => {
    const error = unknownFormat('This is not one of this app’s canvas files.');

    expect(error).toEqual({ kind: 'unknown-format', message: 'This is not one of this app’s canvas files.' });
  });

  describe('a version that is newer than this app', () => {
    it('says which version it is, which one the app understands, and what to do, for a document', () => {
      const error = newerVersion('schema', 3, 1);

      expect(error).toMatchObject({ kind: 'newer-version', of: 'schema', found: 3, understood: 1 });
      expect(error.message).toBe(
        'This canvas was saved by a newer version of this app. It uses schema version 3, and this version understands up to 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      );
    });

    it('says it for a file of one canvas', () => {
      expect(newerVersion('file', 2, 1).message).toBe(
        'This file was saved by a newer version of this app. It is canvas file format 2, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      );
    });

    it('says it for a backup', () => {
      expect(newerVersion('backup', 5, 1).message).toBe(
        'This backup was saved by a newer version of this app. It is backup format 5, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      );
    });
  });

  it('says that a version has no way forward, and which versions the app reads', () => {
    const error = unsupportedVersion(2, 4);

    expect(error).toMatchObject({ kind: 'unsupported-version', found: 2 });
    expect(error.message).toBe(
      'This canvas uses schema version 2, and this version of the app has no way to bring it up to date to version 4. Nothing was loaded and nothing was changed.',
    );
  });

  it('says which step failed, and why', () => {
    const error = migrationFailed(1, 2, 'x is not a function');

    expect(error).toMatchObject({ kind: 'migration-failed', from: 1 });
    expect(error.message).toBe(
      'This canvas uses schema version 1. Bringing it up to version 2 failed: x is not a function. It is probably damaged. Nothing was loaded and nothing was changed.',
    );
  });

  describe('data that is too big', () => {
    it('says what, how much, how much is allowed, why, and what to do', () => {
      const error = tooLarge('elements', 2301, 2000);

      expect(error).toMatchObject({ kind: 'too-large', what: 'elements', found: 2301, limit: 2000 });
      expect(error.message).toBe(
        'This canvas has 2,301 elements (exchanges, queues, producers and consumers), and one canvas can have at most 2,000. It was not opened, so that a damaged or hostile file cannot make the page run out of memory. If the file is genuine, split it into smaller canvases.',
      );
    });

    it.each([
      [
        'edges',
        'This canvas has 5,001 edges (bindings, producer links and consumer subscriptions), and one canvas can have at most 5,000. ',
        'split it into smaller canvases.',
      ],
      [
        'positions',
        'This canvas keeps 5,001 positions, and one canvas can have at most 5,000, one for each element. ',
        'remove the positions of what is not on the canvas.',
      ],
      [
        'labels',
        'This canvas keeps 5,001 labels for its edges, and one canvas can have at most 5,000, one for each edge. ',
        'remove the labels of what is not on the canvas.',
      ],
      [
        'headers',
        'A message or a binding in this canvas has 5,001 header entries, and one can have at most 5,000. ',
        'remove some of the headers.',
      ],
      [
        'text',
        'A payload or a header value in this canvas has 5,001 characters, and one can have at most 5,000. ',
        'shorten it.',
      ],
      [
        'file',
        'This file has 5,001 characters of text, and a file can have at most 5,000. ',
        'make the file smaller or split it.',
      ],
      [
        'canvases',
        'This backup has 5,001 canvases, and one backup can have at most 5,000. ',
        'split the backup into several files.',
      ],
    ] as const)('says it for %s', (what, start, remedy) => {
      const { message } = tooLarge(what, 5001, 5000);

      expect(message).toBe(
        `${start}It was not opened, so that a damaged or hostile file cannot make the page run out of memory. If the file is genuine, ${remedy}`,
      );
    });

    it.each([
      [
        'link',
        'This link is 256,001 characters long, and a link that this app opens can be at most 256,000. ',
        'A canvas that big is sent as a file.',
      ],
      [
        'inflated',
        'This link holds more than 2,000,000 bytes of text once it is opened, which is more than a canvas can be. ',
        'A canvas that big is sent as a file.',
      ],
    ] as const)('says it for a %s, in words that a person who was sent it can act on', (what, start, remedy) => {
      const { message } = what === 'link' ? tooLarge(what, 256_001, 256_000) : tooLarge(what, 2_000_001, 2_000_000);

      expect(message).toBe(
        `${start}It was not opened, so that a damaged or hostile link cannot make the page run out of memory. ${remedy}`,
      );
    });

    it('says it of a name without the talk of files, because someone typed it', () => {
      expect(tooLarge('name', 201, 200).message).toBe(
        'The name has 201 characters, and a name can have at most 200. Shorten the name.',
      );
    });
  });

  describe('data that is not valid', () => {
    const issue = (message: string) => ({ kind: 'schema' as const, message });

    it('names the problem when there is one', () => {
      const error = invalidError([issue('queues.q1.name: Invalid input: expected string, received number')]);

      expect(error.kind).toBe('invalid');
      expect(error.issues).toHaveLength(1);
      expect(error.message).toBe(
        'This canvas is not valid: queues.q1.name: Invalid input: expected string, received number',
      );
    });

    it('names the first, and counts the rest', () => {
      const issues = [issue('one.'), issue('two.'), issue('three.')];

      expect(invalidError(issues).message).toBe('This canvas is not valid. The first of 3 problems: one.');
      expect(invalidError(issues.slice(0, 2)).message).toBe('This canvas is not valid. The first of 2 problems: one.');
    });

    it('keeps every issue, as it was found', () => {
      const issues = [issue('one.'), issue('two.')];

      expect(invalidError(issues).issues).toEqual(issues);
    });

    it('says that it could not be read when there is nothing to say', () => {
      expect(invalidError([]).message).toBe('This canvas is not valid: it could not be read.');
    });

    it('can say what it is that is not valid', () => {
      expect(invalidError([issue('x')], 'This file').message).toBe('This file is not valid: x');
    });
  });
});

describe('the errors of a repository', () => {
  it('says which canvas is not there', () => {
    expect(notFound('abc')).toEqual({
      kind: 'not-found',
      id: 'abc',
      message: 'There is no canvas with the id "abc". It may have been deleted.',
    });
  });

  it('says which canvas is already there', () => {
    expect(existsError('abc')).toEqual({
      kind: 'exists',
      id: 'abc',
      message: 'There is already a canvas with the id "abc", so a new one could not be made with it.',
    });
  });
});

describe('reasonOf', () => {
  it('gives the words of whatever was thrown, and never throws', () => {
    expect(reasonOf(new Error('x is not a function'))).toBe('x is not a function');
    expect(reasonOf({ message: 'from another realm' })).toBe('from another realm');
    expect(reasonOf('just text')).toBe('just text');
    for (const odd of [undefined, null, 5, { message: 5 }, Object.create(null), Symbol('s')]) {
      expect(reasonOf(odd)).toBe('something that is not an error was thrown');
    }
  });
});

describe('summarise', () => {
  it('shows a value in a few characters that never throw', () => {
    expect(summarise('abc')).toBe('"abc"');
    expect(summarise('x'.repeat(100))).toBe(`"${'x'.repeat(40)}…"`);
    expect(summarise(1.5)).toBe('1.5');
    expect(summarise(-0)).toBe('-0');
    expect(summarise(null)).toBe('null');
    expect(summarise(undefined)).toBe('nothing');
    expect(summarise(true)).toBe('true');
    expect(summarise(10n)).toBe('10');
    expect(summarise([1])).toBe('a list');
    expect(summarise({ a: 1 })).toBe('an object');
    expect(summarise(() => 1)).toBe('a function');
    expect(summarise(Symbol('s'))).toBe('a symbol');
  });

  it('shows up to 40 characters of text as they are, and cuts what is longer at 40, with an ellipsis', () => {
    expect(summarise('x'.repeat(40))).toBe(`"${'x'.repeat(40)}"`);
    expect(summarise('x'.repeat(41))).toBe(`"${'x'.repeat(40)}…"`);
  });
});

describe('StorageFailure', () => {
  it('is an error that carries what the browser refused, and says so by its name', () => {
    const thrown = new StorageFailure({ kind: 'blocked', message: 'Close the other tabs.' });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe('StorageFailure');
    expect(thrown.message).toBe('Close the other tabs.');
    expect(thrown.error).toEqual({ kind: 'blocked', message: 'Close the other tabs.' });
  });
});

describe('classifyStorageError', () => {
  const named = (name: string, message = 'boom') => Object.assign(new Error(message), { name });

  it('says that the browser has no room, however it words it', () => {
    for (const error of [
      named('QuotaExceededError'),
      named('NS_ERROR_DOM_QUOTA_REACHED'),
      Object.assign(new Error('x'), { code: 22 }),
    ]) {
      expect(classifyStorageError(error, 'use')).toMatchObject({ kind: 'quota-exceeded' });
      expect(classifyStorageError(error, 'open')).toMatchObject({ kind: 'quota-exceeded' });
    }
    expect(classifyStorageError(named('QuotaExceededError'), 'use').message).toBe(
      'The browser has no room left to keep this canvas. Nothing was saved. Export a backup, delete canvases you no longer need, or free some space on the device, then try again.',
    );
  });

  it('says that another tab is in the way', () => {
    const error = classifyStorageError(named('BlockedError'), 'open');

    expect(error.kind).toBe('blocked');
    expect(error.message).toBe(
      'Another tab of this app still has the saved canvases open in an older version, so this tab cannot open them yet. Close the other tabs of the app, then try again.',
    );
  });

  it('says that the database is newer than the app', () => {
    const error = classifyStorageError(named('VersionError'), 'open');

    expect(error.kind).toBe('newer-database');
    expect(error.message).toBe(
      'The canvases in this browser were saved by a newer version of this app than the one on this page. Reload the page to get the newest version. Nothing was changed.',
    );
  });

  it('says that the browser does not let the site keep data, when it cannot be opened', () => {
    for (const error of [
      named('SecurityError'),
      named('InvalidStateError'),
      new TypeError("Cannot read properties of undefined (reading 'open')"),
      new ReferenceError('indexedDB is not defined'),
      named('UnknownError'),
      'a string that was thrown',
    ]) {
      expect(classifyStorageError(error, 'open').kind).toBe('unavailable');
    }
    expect(classifyStorageError(named('SecurityError'), 'open').message).toBe(
      'The browser does not let this site keep canvases here. That usually means a private window, or site data that is blocked in the browser’s settings. You can still build a canvas and save it as a file, but nothing will be kept automatically.',
    );
  });

  it('says that something failed, with the browser’s own words, when it was in use', () => {
    const error = classifyStorageError(named('UnknownError', 'disk on fire'), 'use');

    expect(error).toEqual({
      kind: 'failed',
      message:
        'The browser failed to read or save canvases (UnknownError: disk on fire). Try again, and if it keeps happening, export a backup.',
      detail: 'UnknownError: disk on fire',
    });
  });

  it('reports a name and a message together, and calls it unknown when it has less than that', () => {
    const detail = (thrown: unknown) => classifyStorageError(thrown, 'use').detail;

    expect(detail({ name: 'Odd', message: 'm' })).toBe('Odd: m');
    expect(detail({ name: 'Odd' })).toBe('unknown');
    expect(detail({ message: 'm' })).toBe('unknown');
    expect(detail({ name: 'Odd', message: 5 })).toBe('unknown');
    expect(detail({ name: 5, message: 'm' })).toBe('unknown');
  });

  it('copes with what is not an error at all', () => {
    expect(classifyStorageError('boom', 'use')).toMatchObject({ kind: 'failed', detail: 'boom' });
    expect(classifyStorageError(undefined, 'use')).toMatchObject({ kind: 'failed', detail: 'unknown' });
    expect(classifyStorageError({ name: 5 }, 'use')).toMatchObject({ kind: 'failed', detail: 'unknown' });
    expect(classifyStorageError(null, 'open').kind).toBe('unavailable');
  });
});
