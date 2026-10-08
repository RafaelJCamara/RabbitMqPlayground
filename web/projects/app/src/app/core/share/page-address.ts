import { DOCUMENT, inject, InjectionToken } from '@angular/core';

/**
 * The address of the page, as much as a share link needs of it (ADR-0078): the fragment that holds the link, taking it off, loading the page again, and being told that the fragment
 * changed. It is behind a token so that a spec gives the link a page that records what is done to it, and a browser test reads the real address.
 */
export interface PageAddress {
  /** The fragment of the address, with its `#`, or `''` when it has none. */
  hash(): string;
  /** Takes the fragment off the address, in the history entry that the page is in, so that going back does not return to the link. It loads nothing. */
  clearHash(): void;
  /** Loads the page again. */
  reload(): void;
  /** Calls `listener` when the fragment of the address changes while the page is open. The function that comes back stops it. */
  onHashChange(listener: () => void): () => void;
}

/** The address of a page of a browser. A document with no window has no address. */
export function browserAddress(page: Document): PageAddress {
  const view = page.defaultView;
  if (view === null) {
    return { hash: () => '', clearHash: () => undefined, reload: () => undefined, onHashChange: () => () => undefined };
  }
  return {
    hash: () => view.location.hash,
    clearHash: () =>
      view.history.replaceState(view.history.state, '', `${view.location.pathname}${view.location.search}`),
    reload: () => view.location.reload(),
    onHashChange(listener) {
      view.addEventListener('hashchange', listener);
      return () => view.removeEventListener('hashchange', listener);
    },
  };
}

export const PAGE_ADDRESS = new InjectionToken<PageAddress>('PAGE_ADDRESS', {
  providedIn: 'root',
  factory: () => browserAddress(inject(DOCUMENT)),
});
