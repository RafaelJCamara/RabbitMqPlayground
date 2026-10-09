import { TestBed } from '@angular/core/testing';
import { encodeShare, SHARE_KEY, SHARE_PREFIX, shareLink } from '@rmq/persistence';
import { sampleDocument } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_DECODER, LINK_PREFIX, LinkOpening, type LinkDecoder } from './link-opening';
import { PAGE_ADDRESS, type PageAddress } from './page-address';

/** The link in the address of the page (ADR-0078): when it is opened, what it opens as, and what it does when the fragment changes. */

function setup(options: { readonly hash: string }) {
  const listeners = new Set<() => void>();
  const address: PageAddress = {
    base: () => 'https://learner.test/app/',
    hash: () => options.hash,
    clearHash: vi.fn(),
    reload: vi.fn(),
    onHashChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  TestBed.configureTestingModule({
    providers: [{ provide: PAGE_ADDRESS, useValue: address }],
  });
  return { address, listeners, opening: TestBed.inject(LinkOpening) };
}

const payload = async (): Promise<string> => {
  const made = await encodeShare({ name: 'Orders', document: sampleDocument() });
  if (!made.ok) {
    throw new Error(made.error.message);
  }
  return made.value;
};

/**
 * Waits until the link is not being opened any more. The platform inflates it in a task of its own, and how long that takes is up to a machine that may be busy (the Nightly runs every property
 * 5,000 times beside it), so a wait of a fixed time is a wait for a machine that is not.
 */
async function settled(opening: LinkOpening): Promise<void> {
  const until = Date.now() + 10_000;
  do {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  } while (opening.state().kind === 'opening' && Date.now() < until);
}

/** A moment in which nothing is expected to happen, for a spec that says that nothing does. */
const quiet = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('LinkOpening', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('has nothing to open when the address has no link', () => {
    for (const hash of ['', '#', '#other', '#c', '#/c=v1.abc']) {
      TestBed.resetTestingModule();
      expect(setup({ hash }).opening.state(), hash).toEqual({ kind: 'none' });
    }
  });

  it('opens a link as a shared canvas: it is being opened at first, and then it is the canvas with the name it was sent with', async () => {
    const { opening } = setup({ hash: `#c=${await payload()}` });

    expect(opening.state()).toEqual({ kind: 'opening' });
    await settled(opening);

    const state = opening.state();
    expect(state.kind).toBe('shared');
    expect(state.kind === 'shared' && state.shared.name).toBe('Orders');
    expect(state.kind === 'shared' && state.shared.document).toEqual(sampleDocument());
  });

  it('fails in words for a link that is not one, and keeps what the codec said', async () => {
    const { opening } = setup({ hash: '#c=not-a-link' });

    await settled(opening);

    const state = opening.state();
    expect(state.kind).toBe('failed');
    expect(state.kind === 'failed' && state.error.kind).toBe('not-a-link');
    expect(state.kind === 'failed' && state.error.message).toContain(`does not start with “${SHARE_PREFIX}”`);
  });

  it('fails as a link from a newer app for a link of format 2, and as a link that is damaged for one that is cut', async () => {
    const newer = setup({ hash: '#c=v2.whatever' });
    await settled(newer.opening);
    expect(newer.opening.state()).toMatchObject({ kind: 'failed', error: { kind: 'newer-version', of: 'link' } });

    TestBed.resetTestingModule();
    const whole = await payload();
    const cut = setup({ hash: `#c=${whole.slice(0, whole.length - 9)}` });
    await settled(cut.opening);
    expect(cut.opening.state()).toMatchObject({ kind: 'failed', error: { kind: 'damaged' } });
  });

  it('looks for the fragment that the persistence library makes: the root cannot import its key, and this holds the two together', () => {
    expect(LINK_PREFIX).toBe(`#${SHARE_KEY}=`);
    expect(shareLink('https://learner.test/app/', 'v1.abc').slice('https://learner.test/app/'.length)).toBe(
      `${LINK_PREFIX}v1.abc`,
    );
  });

  it('gives the decoder what comes after the prefix, once, and no more than that', async () => {
    const decode = vi.fn<LinkDecoder>(async () => ({ ok: true, value: { name: 'Given', document: sampleDocument() } }));
    TestBed.configureTestingModule({ providers: [{ provide: LINK_DECODER, useValue: decode }] });

    const { opening } = setup({ hash: '#c=v1.abc=def' });
    await settled(opening);

    expect(decode).toHaveBeenCalledExactlyOnceWith('v1.abc=def');
    expect(opening.state()).toMatchObject({ kind: 'shared', shared: { name: 'Given' } });
  });

  it('does not ask the decoder at all when there is no link', async () => {
    const decode = vi.fn<LinkDecoder>();
    TestBed.configureTestingModule({ providers: [{ provide: LINK_DECODER, useValue: decode }] });

    setup({ hash: '#other' });
    await quiet();

    expect(decode).not.toHaveBeenCalled();
  });

  it('reads the fragment of an address that was made by shareLink', async () => {
    const address = shareLink('https://learner.test/app/', await payload());

    const { opening } = setup({ hash: new URL(address).hash });
    await settled(opening);

    expect(opening.state().kind).toBe('shared');
  });

  it('loads the page again when the fragment changes, each time, so that a link pasted over another opens as the first did', () => {
    const { address, listeners } = setup({ hash: '' });
    expect(listeners.size).toBe(1);

    [...listeners].forEach((listener) => listener());
    [...listeners].forEach((listener) => listener());

    expect(address.reload).toHaveBeenCalledTimes(2);
  });

  it('stops listening for the fragment when it goes', () => {
    const { listeners } = setup({ hash: '' });
    expect(listeners.size).toBe(1);

    TestBed.resetTestingModule();

    expect(listeners.size).toBe(0);
  });

  it('leaves by taking the link off the address, in the history, and then loading the page, and asks nothing', () => {
    const { opening, address } = setup({ hash: '#c=v1.x' });
    const order: string[] = [];
    vi.mocked(address.clearHash).mockImplementation(() => void order.push('clear'));
    vi.mocked(address.reload).mockImplementation(() => void order.push('reload'));

    opening.leave();

    expect(order).toEqual(['clear', 'reload']);
  });
});
