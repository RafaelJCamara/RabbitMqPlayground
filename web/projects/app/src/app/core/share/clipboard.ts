import { DOCUMENT, inject, InjectionToken } from '@angular/core';

/**
 * The clipboard of the browser, as the share panel uses it (ADR-0078): it writes text, and says whether it could. A browser refuses without a gesture, in a frame that is not allowed to, and on an address that is
 * not secure, and the panel says so and leaves the link selected, for the learner to copy with the keys. It is behind a token so that a spec records what is written.
 */
export interface TextClipboard {
  write(text: string): Promise<boolean>;
}

export function browserClipboard(page: Document): TextClipboard {
  return {
    async write(text) {
      const clipboard = page.defaultView?.navigator.clipboard;
      if (clipboard === undefined) {
        return false;
      }
      try {
        await clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const TEXT_CLIPBOARD = new InjectionToken<TextClipboard>('TEXT_CLIPBOARD', {
  providedIn: 'root',
  factory: () => browserClipboard(inject(DOCUMENT)),
});
