import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { decodeShare, payloadOf, type Shared, type ShareError } from '@rmq/persistence';
import { FeatureFlags } from '../flags/feature-flags';
import { PAGE_ADDRESS } from './page-address';

/** What the address of the page says to open (ADR-0078). */
export type LinkState =
  /** The address has no link, or the flags that open one are off: the page is as it was. */
  | { readonly kind: 'none' }
  /** The link is being unpacked. */
  | { readonly kind: 'opening' }
  /** The link is a canvas, and this is it. */
  | { readonly kind: 'shared'; readonly shared: Shared }
  /** The link is not one that can be opened, and this is why, in words. */
  | { readonly kind: 'failed'; readonly error: ShareError };

/**
 * The link in the address of the page (ADR-0078, ADR-0077). A page whose address has `#c=` is a shared canvas when the flags `share` and `editor` are on, and without them the fragment is ignored. The
 * address is read once, when the page starts, and the page is loaded again when the fragment changes, so that a link pasted over another one opens as the first thing does and the code that opens a link runs once.
 */
@Injectable({ providedIn: 'root' })
export class LinkOpening {
  private readonly address = inject(PAGE_ADDRESS);
  private readonly current = signal<LinkState>({ kind: 'none' });

  readonly state = this.current.asReadonly();

  constructor() {
    const flags = inject(FeatureFlags);
    if (!flags.isEnabled('share') || !flags.isEnabled('editor')) {
      return;
    }
    inject(DestroyRef).onDestroy(this.address.onHashChange(() => this.address.reload()));
    const payload = payloadOf(this.address.hash());
    if (payload === undefined) {
      return;
    }
    this.current.set({ kind: 'opening' });
    void decodeShare(payload).then((result) =>
      this.current.set(result.ok ? { kind: 'shared', shared: result.value } : { kind: 'failed', error: result.error }),
    );
  }

  /** Takes the link off the address and loads the page, which is then the learner's own. It asks nothing: nothing was saved, and the view said so from the start. */
  leave(): void {
    this.address.clearHash();
    this.address.reload();
  }
}
