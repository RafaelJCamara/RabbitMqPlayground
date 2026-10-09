import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureFlags, FLAG_SOURCES } from './feature-flags';
import { FLAGS_STORAGE_KEY } from './flags';

function flagsFor(stored: string | null, query: string | null): FeatureFlags {
  TestBed.configureTestingModule({ providers: [{ provide: FLAG_SOURCES, useValue: { stored, query } }] });
  return TestBed.inject(FeatureFlags);
}

describe('FeatureFlags', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has every flag off by default', () => {
    const flags = flagsFor(null, null);

    expect(flags.enabled).toEqual([]);
    expect(flags.isEnabled('editor')).toBe(false);
  });

  it('turns on the flag that a source names, whichever source it is', () => {
    const stored = flagsFor('editor', null);
    expect(stored.isEnabled('editor')).toBe(true);
    expect([...stored.enabled]).toEqual(['editor']);

    TestBed.resetTestingModule();
    expect(flagsFor(null, 'editor').isEnabled('editor')).toBe(true);
  });

  it('warns once about a flag it does not know, and stays quiet otherwise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    flagsFor('editor', null);
    expect(warn).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    flagsFor('edtior', 'nope');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Unknown feature flag(s) ignored: edtior, nope');
  });

  describe('with the real window', () => {
    beforeEach(() => {
      window.localStorage.clear();
      window.history.replaceState(null, '', '/');
    });
    afterEach(() => {
      window.localStorage.clear();
      window.history.replaceState(null, '', '/');
    });

    it('reads local storage', () => {
      window.localStorage.setItem(FLAGS_STORAGE_KEY, 'editor');

      expect(TestBed.inject(FeatureFlags).isEnabled('editor')).toBe(true);
    });

    it('reads ?ff= from the address', () => {
      window.history.replaceState(null, '', '/?ff=editor');

      expect(TestBed.inject(FeatureFlags).isEnabled('editor')).toBe(true);
    });

    it('has nothing on when neither says anything', () => {
      expect(TestBed.inject(FeatureFlags).enabled).toEqual([]);
    });
  });
});
