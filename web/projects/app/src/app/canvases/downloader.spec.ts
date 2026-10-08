import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDownloader, FILE_DOWNLOADER } from './downloader';

describe('browserDownloader (ADR-0075)', () => {
  const created: Blob[] = [];
  let revoked: string[];
  let clicked: { href: string; download: string; hidden: boolean; inPage: boolean }[];

  beforeEach(() => {
    created.length = 0;
    revoked = [];
    clicked = [];
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return `blob:file-${created.length}`;
      },
      revokeObjectURL: (address: string) => revoked.push(address),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({
        href: this.href,
        download: this.download,
        hidden: this.hidden === true,
        inPage: document.body.contains(this),
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicks a hidden link to the text with the name as its download, while the link is in the page', () => {
    browserDownloader(document).save('orders.rmq.json', '{"a": 1}\n');

    expect(clicked).toEqual([{ href: 'blob:file-1', download: 'orders.rmq.json', hidden: true, inPage: true }]);
  });

  it('makes the file of the text, as JSON', async () => {
    browserDownloader(document).save('b.json', '{"a": 1}\n');

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/json');
    await expect(created[0]?.text()).resolves.toBe('{"a": 1}\n');
  });

  it('takes the link out of the page at once, and lets go of the address a second later, and not before', () => {
    browserDownloader(document).save('b.json', 'x');

    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(999);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:file-1']);
  });

  it('gives each file an address of its own', () => {
    const downloader = browserDownloader(document);

    downloader.save('a.json', 'a');
    downloader.save('b.json', 'b');
    vi.advanceTimersByTime(1000);

    expect(clicked.map(({ href }) => href)).toEqual(['blob:file-1', 'blob:file-2']);
    expect(revoked).toEqual(['blob:file-1', 'blob:file-2']);
  });

  it('is what the app is given when nothing else is', () => {
    TestBed.configureTestingModule({});

    TestBed.inject(FILE_DOWNLOADER).save('c.json', 'c');

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('c.json');
  });
});
