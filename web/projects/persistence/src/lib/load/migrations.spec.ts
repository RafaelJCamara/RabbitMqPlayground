import { deepFreeze } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, runMigrations, type Migration } from './migrations';

/**
 * Only version 1 exists, so the registry is empty and the runner has nothing real to run. These specs prove the runner on a
 * chain that exists only here, with throwaway shapes, and hold the real registry to the real schema version (ADR-0027):
 *
 *     v1  { title }   →   v2  { name }   →   v3  { name, tags }
 */

type Doc = Readonly<Record<string, unknown>>;

const toV2: Migration = { from: 1, migrate: (document) => ({ name: document['title'] }) };
const toV3: Migration = { from: 2, migrate: (document) => ({ ...document, tags: [] }) };
const chain: readonly Migration[] = [toV2, toV3];

const run = (document: Doc, found: number, target = 3, steps = chain) => runMigrations(document, found, target, steps);

describe('the registry of migrations', () => {
  it('has exactly one migration for each version below the current one, in order, so that none is skipped or missing', () => {
    expect(MIGRATIONS).toHaveLength(CURRENT_SCHEMA_VERSION - 1);
    expect(MIGRATIONS.map(({ from }) => from)).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => i + 1),
    );
  });

  it('is for a schema version that is a whole number from 1', () => {
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('does nothing for a document that is already the current version', () => {
    const document = { schemaVersion: CURRENT_SCHEMA_VERSION };
    const result = runMigrations(document, CURRENT_SCHEMA_VERSION);

    expect(result).toEqual({ ok: true, value: document });
    expect(result.ok && result.value).toBe(document);
  });
});

describe('runMigrations, on a chain that exists only here', () => {
  it('runs each step in order, from the version that the document has to the one that is asked for', () => {
    const result = run({ schemaVersion: 1, title: 'orders' }, 1);

    expect(result).toEqual({ ok: true, value: { schemaVersion: 3, name: 'orders', tags: [] } });
  });

  it('starts at the version of the document, and not before it', () => {
    expect(run({ schemaVersion: 2, name: 'orders' }, 2)).toEqual({
      ok: true,
      value: { schemaVersion: 3, name: 'orders', tags: [] },
    });
  });

  it('stops at the version that is asked for', () => {
    expect(run({ schemaVersion: 1, title: 'orders' }, 1, 2)).toEqual({
      ok: true,
      value: { schemaVersion: 2, name: 'orders' },
    });
  });

  it('gives back the document it was given, and runs nothing, when there is nowhere to go', () => {
    const document = { schemaVersion: 3, name: 'orders', tags: [] };
    const result = run(document, 3);

    expect(result.ok && result.value).toBe(document);
  });

  it('sets the version itself, so that a step cannot forget it, or say the wrong one', () => {
    const forgetful: Migration = { from: 1, migrate: () => ({}) };
    const wrong: Migration = { from: 2, migrate: () => ({ schemaVersion: 99 }) };

    expect(runMigrations({ schemaVersion: 1 }, 1, 3, [forgetful, wrong])).toEqual({
      ok: true,
      value: { schemaVersion: 3 },
    });
  });

  it('never changes what it is given, and a step is given a document that is frozen', () => {
    const document = deepFreeze({ schemaVersion: 1, title: 'orders', nested: { list: [1, 2] } });
    const result = run(document, 1);

    expect(result.ok).toBe(true);
    expect(document).toEqual({ schemaVersion: 1, title: 'orders', nested: { list: [1, 2] } });
  });

  it('is a failure, with the step that failed, if a step changes what it is given', () => {
    const meddling: Migration = {
      from: 1,
      migrate: (document) => {
        (document as Record<string, unknown>)['title'] = 'changed';
        return document;
      },
    };
    const result = runMigrations(deepFreeze({ schemaVersion: 1, title: 'x' }), 1, 2, [meddling]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('migration-failed');
  });

  describe('a version that it has no way to bring up to date', () => {
    it('is refused when a step is missing in the middle', () => {
      const gap = [toV2, { from: 3, migrate: (document: Doc) => document }];
      const result = runMigrations({ schemaVersion: 1 }, 1, 4, gap);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: 'unsupported-version', found: 1 });
      expect(!result.ok && result.error.message).toContain('schema version 1');
      expect(!result.ok && result.error.message).toContain('to version 4');
    });

    it('is refused when the document is older than the first step', () => {
      const result = run({ schemaVersion: 0 }, 0);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: 'unsupported-version', found: 0 });
    });

    it('is refused when there are no steps at all and the document is older', () => {
      expect(run({ schemaVersion: 1 }, 1, 2, []).ok).toBe(false);
    });
  });

  describe('a step that goes wrong', () => {
    it('is a typed failure when it throws, with the step and the reason', () => {
      const throwing: Migration = {
        from: 2,
        migrate: () => {
          throw new TypeError("Cannot read properties of undefined (reading 'x')");
        },
      };
      const result = runMigrations({ schemaVersion: 1, title: 'a' }, 1, 3, [toV2, throwing]);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: 'migration-failed', from: 2 });
      expect(!result.ok && result.error.message).toBe(
        "This canvas uses schema version 2. Bringing it up to version 3 failed: Cannot read properties of undefined (reading 'x'). It is probably damaged. Nothing was loaded and nothing was changed.",
      );
    });

    it('is a typed failure when what it throws is not an error', () => {
      const throwing: Migration = {
        from: 1,
        migrate: () => {
          throw 'a string';
        },
      };
      const result = runMigrations({ schemaVersion: 1 }, 1, 2, [throwing]);

      expect(!result.ok && result.error.message).toContain('failed: a string.');
    });

    it.each([
      ['nothing', undefined],
      ['null', null],
      ['a list', []],
      ['text', 'x'],
      ['a number', 5],
    ])('is a typed failure when it gives back %s and not an object', (_what, value) => {
      const result = runMigrations({ schemaVersion: 1 }, 1, 2, [{ from: 1, migrate: () => value }]);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: 'migration-failed', from: 1 });
      expect(!result.ok && result.error.message).toBe(
        'This canvas uses schema version 1. Bringing it up to version 2 failed: the step did not give back an object. It is probably damaged. Nothing was loaded and nothing was changed.',
      );
    });

    it('stops at the first step that fails, and does not run the ones after it', () => {
      const ran: number[] = [];
      const steps: Migration[] = [
        { from: 1, migrate: (document) => (ran.push(1), document) },
        { from: 2, migrate: () => (ran.push(2), null) },
        { from: 3, migrate: (document) => (ran.push(3), document) },
      ];

      expect(runMigrations({ schemaVersion: 1 }, 1, 4, steps).ok).toBe(false);
      expect(ran).toEqual([1, 2]);
    });
  });

  describe('as a property', () => {
    it('runs the steps from where it starts to the end, each once, in order, for any length of chain', () => {
      const trace = (n: number): Migration => ({
        from: n,
        migrate: (document) => ({ ...document, trace: [...(document['trace'] as number[]), n] }),
      });

      fc.assert(
        fc.property(fc.integer({ min: 1, max: 12 }), fc.nat(11), (steps, offset) => {
          const start = 1 + (offset % steps);
          const target = steps + 1;
          const result = runMigrations(
            { schemaVersion: start, trace: [] },
            start,
            target,
            Array.from({ length: steps }, (_, i) => trace(i + 1)),
          );

          expect(result).toEqual({
            ok: true,
            value: {
              schemaVersion: target,
              trace: Array.from({ length: target - start }, (_, i) => start + i),
            },
          });
        }),
      );
    });
  });
});
