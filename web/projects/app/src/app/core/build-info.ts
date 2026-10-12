import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { APP_SOURCE_URL } from './app-info';

/**
 * Which commit the page was built from (ADR-0109). The Pages build writes it in `index.html`, in `<meta name="rmq-build" content="…">`, so that it is in the same file as the
 * bundle that it names: a page that is served from a cache is served with its own commit, which `build-info.json` beside it cannot promise.
 */
export interface Build {
  /** What the build said: a full commit hash, or `local` for a build made outside CI. */
  readonly commit: string;
  /** What is shown: the first seven characters of a hash, or `local`. */
  readonly short: string;
  /** The page of the commit in the repository, or `null` for `local`, which is no commit of it. */
  readonly url: string | null;
}

const HASH = /^[0-9a-f]{7,40}$/;

/** The build of a page, or `null` when the page has none (`ng serve`, a spec) or says something that is neither a hash nor `local`: the stamp is then left out, and not shown wrong. */
export function readBuild(page: Document): Build | null {
  const commit = page.querySelector('meta[name="rmq-build"]')?.getAttribute('content')?.trim();
  if (commit === 'local') {
    return { commit, short: commit, url: null };
  }
  if (commit === undefined || !HASH.test(commit)) {
    return null;
  }
  return { commit, short: commit.slice(0, 7), url: `${APP_SOURCE_URL}/commit/${commit}` };
}

/** The build of this page. It is behind a token so that a spec gives the foot a build to show, and a page without one is the default. */
export const BUILD = new InjectionToken<Build | null>('BUILD', {
  providedIn: 'root',
  factory: () => readBuild(inject(DOCUMENT)),
});
