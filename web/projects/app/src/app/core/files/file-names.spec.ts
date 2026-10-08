import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  canvasFileName,
  CANVAS_FILE_EXTENSION,
  definitionsFileName,
  DEFINITIONS_FILE_EXTENSION,
  slug,
} from './file-names';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

describe('slug (ADR-0075)', () => {
  it.each([
    ['Orders flow', 'orders-flow'],
    ['  Orders   flow  ', 'orders-flow'],
    ['A/B:C?"D"', 'a-b-c-d'],
    ['..\\..\\evil', 'evil'],
    ['Café société', 'café-société'],
    ['日本語 キャンバス', '日本語-キャンバス'],
    ['Canvas 2', 'canvas-2'],
    ['', 'canvas'],
    ['   ', 'canvas'],
    ['***', 'canvas'],
    ['😀', 'canvas'],
  ])('writes %j as %j', (name, expected) => {
    expect(slug(name)).toBe(expected);
  });

  it('keeps at most 60 characters, and no hyphen at the end of what it keeps', () => {
    expect(slug('a'.repeat(100))).toBe('a'.repeat(60));
    expect(slug(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
    expect(slug(`${'a'.repeat(60)}b`)).toBe('a'.repeat(60));
  });

  it('does not cut a character in half', () => {
    const name = `${'a'.repeat(59)}𠀀 and more`;

    const text = slug(name);

    expect(Array.from(text)).toHaveLength(60);
    expect(text).toBe(`${'a'.repeat(59)}𠀀`);
  });

  it('is only letters, digits and hyphens, never begins or ends with a hyphen, and is never empty, for any name', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (name) => {
        const text = slug(name);

        expect(text).toMatch(/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u);
        expect(Array.from(text).length).toBeLessThanOrEqual(60);
      }),
    );
  });
});

describe('file names (ADR-0075)', () => {
  it('ends the file of a canvas in .rmq.json', () => {
    expect(canvasFileName('Orders flow')).toBe('orders-flow.rmq.json');
    expect(canvasFileName('')).toBe('canvas.rmq.json');
  });

  it('names a backup by the day that it was made, as the learner counts days', () => {
    expect(backupFileName(new Date(2026, 9, 8, 23, 59, 59).getTime())).toBe('rmq-playground-backup-2026-10-08.json');
    expect(backupFileName(new Date(2026, 0, 5, 0, 0, 1).getTime())).toBe('rmq-playground-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 11, 31, 12).getTime())).toBe('rmq-playground-backup-2026-12-31.json');
  });
});

describe('the name of a definitions file (ADR-0079)', () => {
  it('ends in .definitions.json, after the name of the canvas as the canvas file has it', () => {
    expect(definitionsFileName('Orders flow')).toBe('orders-flow.definitions.json');
    expect(definitionsFileName('')).toBe('canvas.definitions.json');
    expect(DEFINITIONS_FILE_EXTENSION).toBe('.definitions.json');
  });

  it('is never the name of the file of a canvas, for any name, because the extensions differ after the same slug', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (name) => {
        const definitions = definitionsFileName(name);
        const canvas = canvasFileName(name);

        expect(definitions).not.toBe(canvas);
        expect(definitions.endsWith(DEFINITIONS_FILE_EXTENSION)).toBe(true);
        expect(canvas.endsWith(CANVAS_FILE_EXTENSION)).toBe(true);
        expect(definitions.slice(0, -DEFINITIONS_FILE_EXTENSION.length)).toBe(slug(name));
        expect(definitions).toMatch(/\.json$/);
      }),
    );
  });
});
