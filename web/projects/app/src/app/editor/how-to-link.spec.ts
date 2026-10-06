import { TestBed } from '@angular/core/testing';
import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { HOW_TO_LINK_KEY, HowToLink, HowToLinkCard, readDismissed, writeDismissed } from './how-to-link';
import { WAYS_TO_LINK } from './ways-to-link';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
};

describe('readDismissed and writeDismissed (ADR-0047)', () => {
  it('give back whether the learner dismissed the card, which a browser that kept nothing says they did not', () => {
    const storage = memoryStorage();

    expect(readDismissed(storage)).toBe(false);
    writeDismissed(storage);
    expect(storage.items.get(HOW_TO_LINK_KEY)).toBe('dismissed');
    expect(readDismissed(storage)).toBe(true);
  });

  it('keep the choice under a name of their own, as a preference of the browser', () => {
    expect(HOW_TO_LINK_KEY).toBe('rmq.how-to-link');
  });

  it('take anything else that is stored for no, because only what this app wrote means yes', () => {
    for (const raw of ['true', '1', 'yes', '']) {
      expect(readDismissed(memoryStorage({ [HOW_TO_LINK_KEY]: raw }))).toBe(false);
    }
  });

  it('are not stopped by a storage that throws, nor by a browser that has none', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };

    expect(readDismissed(broken)).toBe(false);
    expect(() => writeDismissed(broken)).not.toThrow();
    expect(readDismissed(null)).toBe(false);
    expect(() => writeDismissed(null)).not.toThrow();
  });
});

const SHOP = documentOf({
  exchanges: { x1: exchangeRecord('orders', 'direct') },
  queues: { q1: queueRecord('billing') },
});

async function renderCard(document = SHOP) {
  const view = await render(HowToLinkCard, {
    providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, HowToLink],
  });
  TestBed.inject(DocumentStore).load(document);
  view.fixture.detectChanges();
  return {
    ...view,
    bus: TestBed.inject(CommandBus),
    store: TestBed.inject(DocumentStore),
    service: TestBed.inject(HowToLink),
    user: userEvent.setup(),
  };
}

describe('HowToLinkCard (ADR-0047)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('is a region with a name, which lists the five ways to link and says what the command bar does', async () => {
    await renderCard();

    const card = screen.getByRole('region', { name: 'How to link' });
    const ways = within(within(card).getByRole('list')).getAllByRole('listitem');
    expect(ways.map((way) => way.textContent?.trim())).toEqual(WAYS_TO_LINK.map((way) => way.short));
    expect(card).toHaveTextContent(
      'The command bar (/) does the same with a line, for example bind orders -> billing.',
    );
    expect(card).toHaveTextContent('Press ? for every key and command.');
  });

  it('takes no focus, because it is guidance that a learner may never need, and not a place to work', async () => {
    await renderCard();

    const card = screen.getByRole('region', { name: 'How to link' });
    expect(card.closest('[tabindex]')).toBeNull();
    expect(card.contains(document.activeElement)).toBe(false);
  });

  it('is shown while the canvas has no edge, and the learner has not dismissed it', async () => {
    await renderCard();

    expect(screen.getByRole('region', { name: 'How to link' })).toBeVisible();
  });

  it('is gone with its button, and the choice is kept in the browser, so that a later visit does not show it again', async () => {
    const { user } = await renderCard();

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(HOW_TO_LINK_KEY)).toBe('dismissed');
  });

  it('is not shown to a learner who dismissed it on an earlier visit', async () => {
    window.localStorage.setItem(HOW_TO_LINK_KEY, 'dismissed');

    await renderCard();

    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
  });

  it('is not shown for a canvas that has an edge already, and is not dismissed for good by that', async () => {
    const { store, service } = await renderCard(
      documentOf({
        exchanges: { x1: exchangeRecord('orders') },
        queues: { q1: queueRecord('billing') },
        bindings: { b1: { source: 'x1', dest: { kind: 'queue', id: 'q1' }, key: 'k' } },
      }),
    );
    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(HOW_TO_LINK_KEY)).toBeNull();

    store.load(SHOP);

    expect(service.visible()).toBe(true);
  });

  it('is dismissed for good by the first edge that the learner makes, by whatever way, because they have found one', async () => {
    const { bus, fixture } = await renderCard();
    expect(screen.getByRole('region', { name: 'How to link' })).toBeVisible();

    bus.apply({ type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'k' }, 'typed');
    fixture.detectChanges();

    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(HOW_TO_LINK_KEY)).toBe('dismissed');
  });

  it('is not dismissed by a change that is not an edge, such as a node that was added', async () => {
    const { bus, fixture } = await renderCard();

    bus.apply({ type: 'declare-queue', name: 'archive', durable: true }, 'gesture');
    fixture.detectChanges();

    expect(screen.getByRole('region', { name: 'How to link' })).toBeVisible();
    expect(window.localStorage.getItem(HOW_TO_LINK_KEY)).toBeNull();
  });

  it('does not come back when the edge is taken away, because it was dismissed for good', async () => {
    const { bus, fixture } = await renderCard();
    bus.apply({ type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'k' }, 'typed');

    bus.undo('toolbar');
    fixture.detectChanges();

    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
  });

  it('is still shown for the page when the browser will not keep the choice, and goes when it is dismissed', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { user } = await renderCard();

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
  });
});
