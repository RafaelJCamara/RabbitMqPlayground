import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { browserClipboard, TEXT_CLIPBOARD } from './clipboard';

/** The clipboard of the browser, as the share panel uses it (ADR-0078). */

const pageWith = (clipboard: unknown): Document =>
  ({ defaultView: { navigator: { clipboard } } }) as unknown as Document;

describe('browserClipboard', () => {
  it('writes the text to the clipboard of the browser, and says that it did', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    const done = await browserClipboard(pageWith({ writeText })).write('https://learner.test/#c=v1.abc');

    expect(done).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://learner.test/#c=v1.abc');
  });

  it('says that it could not when the browser refuses, which it does without a gesture, in some frames, and on an address that is not secure', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));

    expect(await browserClipboard(pageWith({ writeText })).write('x')).toBe(false);
  });

  it('says that it could not when the browser has no clipboard, or the page has no window', async () => {
    expect(await browserClipboard(pageWith(undefined)).write('x')).toBe(false);
    expect(await browserClipboard({ defaultView: null } as unknown as Document).write('x')).toBe(false);
  });
});

describe('TEXT_CLIPBOARD', () => {
  it('is the clipboard of the real page unless a spec gives it another', () => {
    expect(TestBed.inject(TEXT_CLIPBOARD).write).toBeTypeOf('function');
  });
});
