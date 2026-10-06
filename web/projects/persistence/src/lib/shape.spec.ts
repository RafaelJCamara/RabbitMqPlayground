import { describe, expect, it } from 'vitest';
import { CANVAS_ID_PATTERN, idIssues, isRecord, keyIssues, nameIssues, shapeIssue, timeIssues } from './shape';

describe('isRecord', () => {
  it('is an object that has fields, and nothing else', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    for (const other of [null, undefined, [], [1], 'x', 1, true, 1n, Symbol('s'), () => 1]) {
      expect(isRecord(other)).toBe(false);
    }
  });
});

describe('shapeIssue', () => {
  it('says where, then what, and keeps the path for a program', () => {
    expect(shapeIssue(['canvases', '2', 'id'], 'this is wrong.')).toEqual({
      kind: 'schema',
      message: 'canvases.2.id: this is wrong.',
      path: ['canvases', '2', 'id'],
    });
  });
});

describe('keyIssues', () => {
  it('finds nothing wrong with an object that has the keys it needs, and some it may have', () => {
    expect(keyIssues({ a: 1, b: 2 }, ['a'], ['b'], 'The file')).toEqual([]);
    expect(keyIssues({ a: 1 }, ['a'], ['b'], 'The file')).toEqual([]);
    expect(keyIssues({}, [], [], 'The file')).toEqual([]);
  });

  it('says which keys are missing, where each would be', () => {
    expect(keyIssues({ a: 1 }, ['a', 'b', 'c'], [], 'The file')).toEqual([
      { kind: 'schema', message: 'b: this is missing.', path: ['b'] },
      { kind: 'schema', message: 'c: this is missing.', path: ['c'] },
    ]);
  });

  it('counts a key that is there, even as undefined, as a key that is there', () => {
    expect(keyIssues({ a: undefined }, ['a'], [], 'The file')).toEqual([]);
  });

  it('names every key that it should not have, because the shape is strict', () => {
    expect(keyIssues({ a: 1, x: 2, y: 3 }, ['a'], [], 'The file')).toEqual([
      { kind: 'schema', message: 'The file: Unrecognized key: "x"', path: [] },
      { kind: 'schema', message: 'The file: Unrecognized key: "y"', path: [] },
    ]);
  });

  it('lists the missing keys first, and says where inside something bigger', () => {
    const issues = keyIssues({ x: 1 }, ['a'], ['b'], 'The canvas', ['canvases', '3']);

    expect(issues).toEqual([
      { kind: 'schema', message: 'canvases.3.a: this is missing.', path: ['canvases', '3', 'a'] },
      { kind: 'schema', message: 'canvases.3: Unrecognized key: "x"', path: ['canvases', '3'] },
    ]);
  });
});

describe('idIssues', () => {
  it.each(['a', '1', 'A', '3f2a9c10-6a1e-4a43-9d2c-1c9a7ad4bb11', 'a.b:c_d-e', 'x'.repeat(64)])('accepts %s', (id) => {
    expect(idIssues(id, ['id'])).toEqual([]);
    expect(CANVAS_ID_PATTERN.test(id)).toBe(true);
  });

  it.each([
    ['', '""'],
    ['a b', '"a b"'],
    ['-a', '"-a"'],
    ['.a', '".a"'],
    ['x'.repeat(65), `"${'x'.repeat(40)}…"`],
    ['é', '"é"'],
    ['a/b', '"a/b"'],
    ['a\n', '"a\\n"'],
    [5, '5'],
    [null, 'null'],
    [undefined, 'nothing'],
    [{}, 'an object'],
  ])('refuses %j, and says what an id is', (id, shown) => {
    expect(idIssues(id, ['id'])).toEqual([
      {
        kind: 'schema',
        message: `id: an id is 1 to 64 letters, digits, dots, colons, hyphens or underscores, and this is ${shown}.`,
        path: ['id'],
      },
    ]);
  });
});

describe('nameIssues', () => {
  it('accepts any text that is not blank', () => {
    for (const name of ['a', ' a ', 'Orders and billing', '日本語', '😀']) {
      expect(nameIssues(name, ['name'])).toEqual([]);
    }
  });

  it('refuses a name that is blank, as an empty name', () => {
    for (const name of ['', ' ', '\t\n  ']) {
      expect(nameIssues(name, ['name'])).toEqual([
        { kind: 'empty-name', message: 'name: A canvas needs a name.', path: ['name'] },
      ]);
    }
  });

  it('says where in what it is in, as a path of names with a dot between them', () => {
    expect(nameIssues('', ['canvases', '1', 'name'])).toEqual([
      { kind: 'empty-name', message: 'canvases.1.name: A canvas needs a name.', path: ['canvases', '1', 'name'] },
    ]);
  });

  it('refuses what is not text, and says what it is', () => {
    expect(nameIssues(5, ['name'])).toEqual([
      { kind: 'schema', message: 'name: a name is text, and this is 5.', path: ['name'] },
    ]);
    expect(nameIssues(null, ['canvases', '1', 'name'])[0]?.message).toBe(
      'canvases.1.name: a name is text, and this is null.',
    );
  });
});

describe('timeIssues', () => {
  it.each([0, 1, 1_791_273_384_000, 0.5])('accepts %j', (time) => {
    expect(timeIssues(time, ['createdAt'])).toEqual([]);
  });

  it.each([
    [-1, '-1'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    ['1', '"1"'],
    [null, 'null'],
    [undefined, 'nothing'],
    [new Date(0), 'an object'],
  ])('refuses %j, and says what a time is', (time, shown) => {
    expect(timeIssues(time, ['createdAt'])).toEqual([
      {
        kind: 'schema',
        message: `createdAt: a time is a number of milliseconds since 1970, from 0, and this is ${shown}.`,
        path: ['createdAt'],
      },
    ]);
  });
});
