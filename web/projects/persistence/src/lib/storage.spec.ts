import { describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, STORES } from './storage';

describe('storage names', () => {
  it('uses a plain lower-case database name', () => {
    expect(DB_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('starts the schema at a positive whole version', () => {
    expect(Number.isInteger(DB_VERSION)).toBe(true);
    expect(DB_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('gives every object store its own name', () => {
    const names = Object.values(STORES);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['canvases', 'meta']));
  });
});
