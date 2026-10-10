import { describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  QUOTA_CRITICAL_AT,
  QUOTA_LOW_AT,
  quotaWarning,
  readUsage,
  requestPersistence,
  type StorageManagerLike,
} from './storage-manager';

const MB = 1024 * 1024;

describe('requestPersistence', () => {
  it('asks the browser to keep the canvases, and says that it agreed', async () => {
    const manager: StorageManagerLike = { persisted: async () => false, persist: vi.fn(async () => true) };

    expect(await requestPersistence(manager)).toEqual({
      status: 'granted',
      message: 'The browser agreed to keep the canvases, and will not remove them when the device runs low on space.',
    });
    expect(manager.persist).toHaveBeenCalledOnce();
  });

  it('does not ask again when the browser has promised already', async () => {
    const manager: StorageManagerLike = { persisted: async () => true, persist: vi.fn(async () => true) };

    expect(await requestPersistence(manager)).toEqual({
      status: 'already',
      message:
        'The browser has promised to keep the canvases, and will not remove them when the device runs low on space.',
    });
    expect(manager.persist).not.toHaveBeenCalled();
  });

  it('says that the browser said no, and what that means, and what to do', async () => {
    const result = await requestPersistence({ persisted: async () => false, persist: async () => false });

    expect(result).toEqual({
      status: 'denied',
      message:
        'The browser did not promise to keep the canvases. It may remove them if the device runs low on space, and some browsers remove what a site keeps when it has not been visited for a week. Export a backup now and then.',
    });
  });

  it('asks without asking first when the browser cannot say whether it has promised', async () => {
    const persist = vi.fn(async () => true);

    expect(await requestPersistence({ persist })).toMatchObject({ status: 'granted' });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('says so when the browser cannot be asked, or there is no storage manager at all', async () => {
    const expected = {
      status: 'unsupported',
      message:
        'This browser cannot promise to keep the canvases, so it may remove them if the device runs low on space. Export a backup now and then.',
    };

    expect(await requestPersistence(undefined)).toEqual(expected);
    expect(await requestPersistence({})).toEqual(expected);
    expect(await requestPersistence({ persisted: async () => false })).toEqual(expected);
  });

  it('says that it could not ask, with the reason, when asking fails', async () => {
    const result = await requestPersistence({
      persisted: async () => false,
      persist: async () => {
        throw new DOMException('Persistence requires a secure context.', 'SecurityError');
      },
    });

    expect(result).toEqual({
      status: 'failed',
      message:
        'The browser could not be asked to keep the canvases (Persistence requires a secure context.). It may remove them if the device runs low on space. Export a backup now and then.',
    });
  });

  it('says it too when finding out whether the browser has promised fails', async () => {
    const result = await requestPersistence({
      persisted: () => Promise.reject(new Error('no')),
      persist: async () => true,
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toContain('(no)');
  });
});

describe('readUsage', () => {
  it('says how much the browser has used, how much it allows, and what fraction that is', async () => {
    const usage = await readUsage({ estimate: async () => ({ usage: 20 * MB, quota: 100 * MB }) });

    expect(usage).toEqual({ ok: true, value: { usage: 20 * MB, quota: 100 * MB, fraction: 0.2 } });
  });

  it('says it for a canvas app that has used nothing yet, which is a fraction of 0', async () => {
    expect(await readUsage({ estimate: async () => ({ usage: 0, quota: 5 }) })).toEqual({
      ok: true,
      value: { usage: 0, quota: 5, fraction: 0 },
    });
  });

  it('takes a quota of a single byte, which is not nothing', async () => {
    expect(await readUsage({ estimate: async () => ({ usage: 1, quota: 1 }) })).toEqual({
      ok: true,
      value: { usage: 1, quota: 1, fraction: 1 },
    });
  });

  it('keeps a fraction over 1, because a browser may say that it has used more than it allows', async () => {
    const usage = await readUsage({ estimate: async () => ({ usage: 12, quota: 10 }) });

    expect(usage.ok && usage.value.fraction).toBe(1.2);
  });

  it.each([
    ['there is no storage manager', undefined],
    ['it cannot estimate', {}],
  ])('says that the browser does not say, when %s', async (_why, manager) => {
    expect(await readUsage(manager)).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'This browser does not say how much room is left for canvases.' },
    });
  });

  it.each([
    ['a quota that is missing', { usage: 1 }],
    ['a usage that is missing', { quota: 10 }],
    ['a quota of nothing', { usage: 0, quota: 0 }],
    ['a negative usage', { usage: -1, quota: 10 }],
    ['an usage that is not a number', { usage: '1', quota: 10 }],
    ['an infinite quota', { usage: 1, quota: Infinity }],
    ['nothing at all', {}],
  ])('says that the browser does not say, for %s', async (_why, estimate) => {
    const result = await readUsage({ estimate: async () => estimate as never });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'This browser does not say how much room is left for canvases.' },
    });
  });

  it('says that something failed, with the words of the browser, when it cannot estimate', async () => {
    const result = await readUsage({ estimate: () => Promise.reject(new Error('not now')) });

    expect(result).toMatchObject({ ok: false, error: { kind: 'failed', detail: 'Error: not now' } });
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [0.4, '0 B'],
    [94.6, '95 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [MB, '1 MB'],
    [3.4 * MB, '3.4 MB'],
    [250 * MB, '250 MB'],
    [1024 * MB, '1 GB'],
    [2.25 * 1024 * MB, '2.3 GB'],
    [5000 * 1024 * MB, '5000 GB'],
  ])('writes %d as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('quotaWarning', () => {
  const at = (fraction: number) => quotaWarning({ usage: fraction * 100 * MB, quota: 100 * MB, fraction });
  /** The message of a warning, which a case of enough room does not have. */
  const said = (warning: ReturnType<typeof quotaWarning>): string =>
    'message' in warning ? warning.message : 'no message';

  it('warns at 80% and again at 95%', () => {
    expect(QUOTA_LOW_AT).toBe(0.8);
    expect(QUOTA_CRITICAL_AT).toBe(0.95);
  });

  it('is ok below 80%, and says nothing (ADR-0100)', () => {
    expect(at(0)).toStrictEqual({ level: 'ok' });
    expect(at(0.5)).toStrictEqual({ level: 'ok' });
    expect(at(0.7999)).toStrictEqual({ level: 'ok' });
  });

  it('is low from 80%, and says what to do', () => {
    expect(at(0.8)).toEqual({
      level: 'low',
      message:
        'The browser has used 80% of the room that it allows this app (80 MB of 100 MB). Export a backup, and delete the canvases that you no longer need, before it runs out.',
    });
    expect(at(0.9499).level).toBe('low');
  });

  it('is critical from 95%, and says that saving may fail', () => {
    expect(at(0.95)).toEqual({
      level: 'critical',
      message:
        'The browser has almost no room left for this app (95% of 100 MB is used). Saving may fail. Export a backup now, and delete the canvases that you no longer need.',
    });
    expect(at(1.5).level).toBe('critical');
    expect(said(at(1.5))).toContain('(100% of 100 MB is used)');
  });

  it('does not round up to the next warning, so that 94.99% does not read as 95%', () => {
    const low = quotaWarning({ usage: 9499, quota: 10_000, fraction: 0.9499 });

    expect(said(low)).toContain('used 94% of');
    expect(low.level).toBe('low');
  });

  it('writes a percent that floating point gets a hair wrong as what it is', () => {
    expect(said(quotaWarning({ usage: 29, quota: 100, fraction: 0.29 }))).toBe('no message');
    expect(said(quotaWarning({ usage: 87, quota: 100, fraction: 0.87 }))).toContain('used 87% of');
  });
});
