import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandHistory,
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  readHistory,
  remember,
  writeHistory,
} from './command-history';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
};

describe('the name that the history is kept under (ADR-0045)', () => {
  it('names the command bar, so that a canvas, a share link and the theme never carry it', () => {
    expect(HISTORY_STORAGE_KEY).toBe('rmq.command-history');
  });

  it('holds a hundred lines', () => {
    expect(HISTORY_LIMIT).toBe(100);
  });
});

describe('remember', () => {
  it('puts a line after the ones that were given before it, oldest first', () => {
    expect(remember(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('takes off the spaces around a line, and keeps nothing for a line that has only spaces', () => {
    expect(remember([], '  bind a -> b  ')).toEqual(['bind a -> b']);
    expect(remember(['a'], '   ')).toEqual(['a']);
    expect(remember(['a'], '')).toEqual(['a']);
  });

  it('does not keep a line twice in a row, and keeps it again when another came between', () => {
    expect(remember(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(remember(['a', 'b'], 'a')).toEqual(['a', 'b', 'a']);
  });

  it('forgets the oldest lines past the limit, and no others', () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => `line ${index}`);

    const next = remember(full, 'new');

    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe('line 1');
    expect(next.at(-1)).toBe('new');
  });

  it('leaves the list that it was given as it was', () => {
    const before = ['a'];

    remember(before, 'b');

    expect(before).toEqual(['a']);
  });
});

describe('readHistory and writeHistory', () => {
  it('give back what was kept, and nothing for a browser that has kept nothing', () => {
    const storage = memoryStorage();

    expect(readHistory(storage)).toEqual([]);
    writeHistory(storage, ['a', 'b']);
    expect(storage.items.get(HISTORY_STORAGE_KEY)).toBe('["a","b"]');
    expect(readHistory(storage)).toEqual(['a', 'b']);
  });

  it('read nothing from what is not a list: a text that is not JSON, an object, a number', () => {
    for (const raw of ['{', '{"a":1}', '3', 'null', '"a"', '']) {
      expect(readHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: raw }))).toEqual([]);
    }
  });

  it('read only the lines of a list that has other things in it, and not the empty ones', () => {
    const storage = memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(['a', 3, null, '', 'b', { x: 1 }]) });

    expect(readHistory(storage)).toEqual(['a', 'b']);
  });

  it('read the newest lines of a list that is longer than the limit', () => {
    const long = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => `line ${index}`);

    const read = readHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(long) }));

    expect(read).toHaveLength(HISTORY_LIMIT);
    expect(read[0]).toBe('line 5');
  });

  it('are not stopped by a storage that throws, nor by a browser that has none', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };

    expect(readHistory(broken)).toEqual([]);
    expect(() => writeHistory(broken, ['a'])).not.toThrow();
    expect(readHistory(null)).toEqual([]);
    expect(() => writeHistory(null, ['a'])).not.toThrow();
  });
});

describe('CommandHistory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('starts with what the browser kept', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(['declare queue a', 'bind x -> a']));

    expect(TestBed.inject(CommandHistory).lines()).toEqual(['declare queue a', 'bind x -> a']);
  });

  it('keeps a line that is given, in the browser, so that the next visit has it', () => {
    const history = TestBed.inject(CommandHistory);

    history.add('declare queue a');
    history.add('bind x -> a');

    expect(history.lines()).toEqual(['declare queue a', 'bind x -> a']);
    expect(JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? 'null')).toEqual([
      'declare queue a',
      'bind x -> a',
    ]);
  });

  it('does not write when the line was not kept, because it was empty or the same as the last', () => {
    const history = TestBed.inject(CommandHistory);
    history.add('a');
    const write = vi.spyOn(Storage.prototype, 'setItem');

    history.add('a');
    history.add('   ');

    expect(write).not.toHaveBeenCalled();
  });

  it('still has the history of the page when the browser will not keep it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const history = TestBed.inject(CommandHistory);

    history.add('a');
    history.add('b');

    expect(history.lines()).toEqual(['a', 'b']);
  });

  it('starts empty when the browser will not even say what it kept', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(TestBed.inject(CommandHistory).lines()).toEqual([]);
  });
});
