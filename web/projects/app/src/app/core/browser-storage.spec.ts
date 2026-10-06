import { describe, expect, it } from 'vitest';
import { localStorageOf } from './browser-storage';

describe('localStorageOf', () => {
  it('gives the storage of the window that the page is in', () => {
    expect(localStorageOf(document)).toBe(window.localStorage);
  });

  it('gives nothing for a page that has no window', () => {
    expect(localStorageOf({ defaultView: null } as unknown as Document)).toBeNull();
  });

  it('gives nothing when touching the storage throws, as it does in a private window and with blocked site data', () => {
    const blocked = {
      get defaultView(): Window {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    } as unknown as Document;

    expect(localStorageOf(blocked)).toBeNull();
  });
});
