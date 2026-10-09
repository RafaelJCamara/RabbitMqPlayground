import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAddress, PAGE_ADDRESS } from './page-address';

/** The address of the page, as the share link reads and changes it (ADR-0078). */

function fakePage(hash = '#c=v1.abc') {
  const location = {
    hash,
    origin: 'https://learner.test',
    pathname: '/RabbitMqPlayground/',
    search: '?ff=editor,share',
    reload: vi.fn(),
  };
  const history = { state: { n: 1 }, replaceState: vi.fn() };
  const view = { location, history, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { page: { defaultView: view } as unknown as Document, location, history, view };
}

describe('browserAddress', () => {
  it('says the page without its query and its fragment, which is what a link to it is built from', () => {
    expect(browserAddress(fakePage('#c=v1.abc').page).base()).toBe('https://learner.test/RabbitMqPlayground/');
  });

  it('says the fragment of the address, with its #, and nothing when there is none', () => {
    expect(browserAddress(fakePage('#c=v1.abc').page).hash()).toBe('#c=v1.abc');
    expect(browserAddress(fakePage('').page).hash()).toBe('');
  });

  it('takes the fragment off in the history entry that the page is in, and keeps the path and the state and not the query, which an old link may carry (ADR-0084)', () => {
    const { page, history, location } = fakePage();

    browserAddress(page).clearHash();

    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith({ n: 1 }, '', '/RabbitMqPlayground/');
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('loads the page again', () => {
    const { page, location } = fakePage();

    browserAddress(page).reload();

    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('listens for a change of the fragment until it is told to stop', () => {
    const { page, view } = fakePage();
    const listener = vi.fn();

    const stop = browserAddress(page).onHashChange(listener);

    expect(view.addEventListener).toHaveBeenCalledExactlyOnceWith('hashchange', listener);
    expect(view.removeEventListener).not.toHaveBeenCalled();
    stop();
    expect(view.removeEventListener).toHaveBeenCalledExactlyOnceWith('hashchange', listener);
  });

  it('has no address, and does nothing, in a document that has no window', () => {
    const address = browserAddress({ defaultView: null } as unknown as Document);
    const listener = vi.fn();

    expect(address.hash()).toBe('');
    expect(address.base()).toBe('');
    expect(() => {
      address.clearHash();
      address.reload();
      address.onHashChange(listener)();
    }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('PAGE_ADDRESS', () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    TestBed.resetTestingModule();
  });

  it('is the address of the real page unless a spec gives it another', () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#c=v1.real`);

    const address = TestBed.inject(PAGE_ADDRESS);

    expect(address.hash()).toBe('#c=v1.real');
    expect(address.base()).toBe(`${window.location.origin}${window.location.pathname}`);
    address.clearHash();
    expect(address.hash()).toBe('');
  });
});
