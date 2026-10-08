import { InjectionToken } from '@angular/core';
import { encodeShare, SHARE_WARN_AT, shareLink, type Shared, type ShareError } from '@rmq/persistence';
import type { FeatureFlags } from '../core/flags/feature-flags';
import type { PageAddress } from '../core/share/page-address';

/** What making a link came to (ADR-0077, ADR-0078): the address, how long it is and whether that is longer than chat apps keep, or why there is none. */
export type MadeLink =
  | { readonly kind: 'ready'; readonly address: string; readonly length: number; readonly long: boolean }
  | { readonly kind: 'failed'; readonly error: ShareError };

/**
 * The page that a link is built on: the page without its fragment, and, for as long as there are feature flags, the flags that are on, so that a link opens for whoever is sent it as it does for whoever made it. A page
 * with no flags is the page alone, and that is what every link is once the flags are gone.
 */
export function linkBase(address: Pick<PageAddress, 'base'>, flags: Pick<FeatureFlags, 'enabled'>): string {
  return `${address.base()}${flags.enabled.length === 0 ? '' : `?ff=${flags.enabled.join(',')}`}`;
}

/** The link to a canvas, built on `base`. It is made from the canvas as it is given, which is as it is on the screen. */
export async function makeLink(shared: Shared, base: string): Promise<MadeLink> {
  const made = await encodeShare(shared);
  if (!made.ok) {
    return { kind: 'failed', error: made.error };
  }
  const address = shareLink(base, made.value);
  return { kind: 'ready', address, length: address.length, long: address.length > SHARE_WARN_AT };
}

/** How the panel makes a link. It is behind a token so that a spec holds a link back, to see the panel while it waits, and gives it a link that fails in a way that a canvas cannot be made to fail. */
export const LINK_MAKER = new InjectionToken<typeof makeLink>('LINK_MAKER', {
  providedIn: 'root',
  factory: () => makeLink,
});

/** Whether a canvas that has no link can still be given as a file: it is too big for a link, or the browser cannot make one. */
export const fileInstead = (error: ShareError): boolean =>
  error.kind === 'unsupported' || (error.kind === 'too-large' && (error.what === 'link' || error.what === 'inflated'));
