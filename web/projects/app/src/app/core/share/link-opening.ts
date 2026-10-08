import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import type { Outcome, Shared, ShareError } from '@rmq/persistence';
import { PAGE_ADDRESS } from './page-address';

/** What the address of the page says to open (ADR-0078). */
export type LinkState =
  /** The address has no link: the page is as it was. */
  | { readonly kind: 'none' }
  /** The link is being unpacked. */
  | { readonly kind: 'opening' }
  /** The link is a canvas, and this is it. */
  | { readonly kind: 'shared'; readonly shared: Shared }
  /** The link is not one that can be opened, and this is why, in words. */
  | { readonly kind: 'failed'; readonly error: ShareError };

/**
 * How a link is unpacked. The default loads the codec of the persistence library when there is a link to open and not before: this service is in the root of the page, and the library with everything it needs (the schemas
 * of the document, the engine) is the weight of the editor, which the first chunk of the page must not carry (ADR-0030, ADR-0080). A spec gives its own.
 */
export type LinkDecoder = (payload: string) => Promise<Outcome<Shared, ShareError>>;

export const LINK_DECODER = new InjectionToken<LinkDecoder>('LINK_DECODER', {
  providedIn: 'root',
  factory: () => async (payload) => (await import('@rmq/persistence')).decodeShare(payload),
});

/**
 * What the fragment of an address that holds a link starts with: `#c=`, and then the payload (ADR-0077). It is the fragment that `shareLink` of the persistence library makes, which the root cannot import to ask, because that
 * is the weight above; a spec holds this to it.
 */
export const LINK_PREFIX = '#c=';

/**
 * The link in the address of the page (ADR-0078, ADR-0077). A page whose address has `#c=` is a shared canvas. The
 * address is read once, when the page starts, and the page is loaded again when the fragment changes, so that a link pasted over another one opens as the first thing does and the code that opens a link runs once.
 */
@Injectable({ providedIn: 'root' })
export class LinkOpening {
  private readonly address = inject(PAGE_ADDRESS);
  private readonly current = signal<LinkState>({ kind: 'none' });

  readonly state = this.current.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(this.address.onHashChange(() => this.address.reload()));
    const hash = this.address.hash();
    if (!hash.startsWith(LINK_PREFIX)) {
      return;
    }
    this.current.set({ kind: 'opening' });
    void inject(LINK_DECODER)(hash.slice(LINK_PREFIX.length)).then((result) =>
      this.current.set(result.ok ? { kind: 'shared', shared: result.value } : { kind: 'failed', error: result.error }),
    );
  }

  /** Takes the link off the address and loads the page, which is then the learner's own. It asks nothing: nothing was saved, and the view said so from the start. */
  leave(): void {
    this.address.clearHash();
    this.address.reload();
  }
}
