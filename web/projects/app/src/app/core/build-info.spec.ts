import { describe, expect, it } from 'vitest';
import { APP_SOURCE_URL } from './app-info';
import { readBuild } from './build-info';

const page = (head: string): Document =>
  new DOMParser().parseFromString(`<html><head>${head}</head></html>`, 'text/html');
const stamped = (content: string): Document => page(`<meta name="rmq-build" content="${content}">`);

describe('readBuild (ADR-0109)', () => {
  const HASH = '3f2a9c1d4e5b60718293a4b5c6d7e8f901234567';

  it('shows the first seven characters of the commit, and links to the commit in the repository', () => {
    expect(readBuild(stamped(HASH))).toEqual({
      commit: HASH,
      short: '3f2a9c1',
      url: `${APP_SOURCE_URL}/commit/${HASH}`,
    });
  });

  it('shows "local" for a build made outside CI, with no link, because it is no commit of the repository', () => {
    expect(readBuild(stamped('local'))).toEqual({ commit: 'local', short: 'local', url: null });
  });

  it('has no build when the page has none, as under ng serve', () => {
    expect(readBuild(page(''))).toBeNull();
  });

  it.each(['', '   ', 'main', 'abc12', '3f2a9c1; drop', 'G'.repeat(40), `${HASH}0`])(
    'has no build for a stamp that is neither a hash nor "local": %j',
    (content) => {
      expect(readBuild(stamped(content))).toBeNull();
    },
  );
});
