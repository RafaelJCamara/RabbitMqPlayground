import { describe, expect, it } from 'vitest';
import {
  FLAG_NAMES,
  FLAGS,
  FLAGS_QUERY_PARAM,
  FLAGS_STORAGE_KEY,
  type FlagName,
  parseFlagList,
  readFlagSources,
  resolveFlags,
} from './flags';

describe('the flag registry', () => {
  it('has every default off, so that main is always releasable (ADR-0004)', () => {
    for (const [name, flag] of Object.entries(FLAGS)) {
      expect(flag.default, `${name} must default to off`).toBe(false);
    }
  });

  it('turns every flag off when no source mentions it', () => {
    expect([...resolveFlags({ stored: null, query: null }).enabled]).toEqual([]);
  });

  it('names flags in lower case, and describes each one', () => {
    expect(FLAG_NAMES.length).toBeGreaterThan(0);
    for (const name of FLAG_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(FLAGS[name].description.length, name).toBeGreaterThan(10);
    }
  });

  it('keeps the flag names the M1 plan promises for its slices', () => {
    expect([...FLAG_NAMES].sort()).toEqual(['canvases', 'editor', 'simulation'].sort());
  });
});

describe('parseFlagList', () => {
  it.each([
    [null, []],
    [undefined, []],
    ['', []],
    ['   ', []],
    ['editor', ['editor']],
    ['editor,simulation', ['editor', 'simulation']],
    ['editor simulation', ['editor', 'simulation']],
    [' editor , simulation ,, ', ['editor', 'simulation']],
    ['Editor,SIMULATION', ['editor', 'simulation']],
    ['editor,editor,Editor', ['editor']],
    ['editor\nsimulation\theaders', ['editor', 'simulation', 'headers']],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseFlagList(raw)).toEqual(expected);
  });
});

describe('resolveFlags', () => {
  const enabled = (stored: string | null, query: string | null): FlagName[] =>
    [...resolveFlags({ stored, query }).enabled].sort();

  it('turns on the flags named in local storage', () => {
    expect(enabled('editor', null)).toEqual(['editor']);
  });

  it('turns on the flags named in the URL', () => {
    expect(enabled(null, 'simulation,canvases')).toEqual(['canvases', 'simulation']);
  });

  it('adds the two sources together', () => {
    expect(enabled('editor', 'simulation')).toEqual(['editor', 'simulation']);
    expect(enabled('editor', 'editor')).toEqual(['editor']);
  });

  it('reports names it does not know, once each, without turning anything on', () => {
    const resolved = resolveFlags({ stored: 'edtior,nope', query: 'nope,Nope' });

    expect([...resolved.enabled]).toEqual([]);
    expect(resolved.unknown).toEqual(['edtior', 'nope']);
  });

  it('does not mistake object properties for flags', () => {
    const resolved = resolveFlags({ stored: 'constructor,__proto__,tostring,hasownproperty', query: null });

    expect([...resolved.enabled]).toEqual([]);
    expect(resolved.unknown).toHaveLength(4);
  });
});

describe('readFlagSources', () => {
  const win = (search: string, store: Record<string, string> = {}) => ({
    localStorage: { getItem: (key: string) => store[key] ?? null },
    location: { search },
  });

  it('reads local storage and the URL', () => {
    expect(readFlagSources(win('?ff=simulation', { [FLAGS_STORAGE_KEY]: 'editor' }))).toEqual({
      stored: 'editor',
      query: 'simulation',
    });
  });

  it('reads the ff parameter among other parameters', () => {
    expect(readFlagSources(win(`?a=1&${FLAGS_QUERY_PARAM}=explain,headers&b=2`)).query).toBe('explain,headers');
  });

  it('reports nothing for a missing key or parameter', () => {
    expect(readFlagSources(win(''))).toEqual({ stored: null, query: null });
  });

  it('survives storage that throws, as it does when it is blocked', () => {
    const blocked = {
      localStorage: {
        getItem: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      },
      location: { search: '?ff=editor' },
    };

    expect(readFlagSources(blocked)).toEqual({ stored: null, query: 'editor' });
  });

  it('survives having no window at all', () => {
    expect(readFlagSources(null)).toEqual({ stored: null, query: null });
  });
});
