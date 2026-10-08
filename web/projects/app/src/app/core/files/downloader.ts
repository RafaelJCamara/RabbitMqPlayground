import { DOCUMENT, inject, InjectionToken } from '@angular/core';

/**
 * How the app gives a file to the learner (ADR-0075): a `Blob` and a link with `download` that is clicked, which works in every browser and needs no permission. It is behind
 * a token so that a spec gives the library a downloader that records the name and the text, and a browser test waits for the real download and reads the file.
 */
export interface FileDownloader {
  /** Offers `text` to the learner as a file called `name`. */
  save(name: string, text: string): void;
}

/** How long the address of the file is kept after the click, so that the browser has taken it. */
const KEEP_MS = 1000;

export function browserDownloader(page: Document): FileDownloader {
  return {
    save(name, text) {
      const address = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = page.createElement('a');
      link.href = address;
      link.download = name;
      link.hidden = true;
      page.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(address), KEEP_MS);
    },
  };
}

export const FILE_DOWNLOADER = new InjectionToken<FileDownloader>('FILE_DOWNLOADER', {
  providedIn: 'root',
  factory: () => browserDownloader(inject(DOCUMENT)),
});
