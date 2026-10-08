import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { decodeShare, payloadOf, type ShareError } from '@rmq/persistence';
import { sampleDocument, snapshotAfter } from '@rmq/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { TEXT_CLIPBOARD, type TextClipboard } from '../core/share/clipboard';
import { PAGE_ADDRESS, type PageAddress } from '../core/share/page-address';
import { ShareDialogs } from './dialogs';
import { LINK_MAKER, makeLink, type MadeLink } from './link-maker';
import type { SharePanelData } from './share-panel';

/** The panel that makes a link (ADR-0078, ADR-0013). */

const BASE = 'https://learner.test/RabbitMqPlayground/';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Options {
  readonly base?: string;
  readonly flags?: string | null;
  readonly clipboard?: boolean;
  readonly messages?: SharePanelData['messages'];
  /** What the panel makes its links with, where a spec needs to hold one back or make one fail. */
  readonly maker?: typeof makeLink;
}

async function openPanel(options: Options = {}) {
  const written: string[] = [];
  const clipboard: TextClipboard = {
    write: async (text) => {
      written.push(text);
      return options.clipboard ?? true;
    },
  };
  const page = { base: () => options.base ?? BASE } as PageAddress;
  TestBed.configureTestingModule({
    providers: [
      { provide: TEXT_CLIPBOARD, useValue: clipboard },
      { provide: PAGE_ADDRESS, useValue: page },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? null } },
      ...(options.maker === undefined ? [] : [{ provide: LINK_MAKER, useValue: options.maker }]),
    ],
  });
  const saveAsFile = vi.fn();
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  const data: SharePanelData = {
    name: 'Orders',
    document: sampleDocument(),
    saveAsFile,
    ...(options.messages === undefined ? {} : { messages: options.messages }),
  };
  TestBed.inject(ShareDialogs).share(data);
  const dialog = await screen.findByRole('dialog', { name: 'Share “Orders”' });
  return {
    dialog,
    opener,
    written,
    saveAsFile,
    user: userEvent.setup(),
    announcer: TestBed.inject(Announcer),
    ready: () => within(dialog).findByTestId('share-length'),
    field: () => within(dialog).getByRole('textbox', { name: 'Link' }) as HTMLInputElement,
  };
}

const messagesOf = (count: number): NonNullable<SharePanelData['messages']> => ({
  count,
  snapshot: () => snapshotAfter(sampleDocument(), 1_000),
});

const payloadIn = (field: HTMLInputElement): string => payloadOf(new URL(field.value).hash) ?? '';

describe('the panel that makes a link (ADR-0078)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('what it says', () => {
    it('is a modal dialog named for the canvas, with two sentences on what a link is', async () => {
      const { dialog } = await openPanel();

      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(within(dialog).getByRole('heading', { level: 2, name: 'Share “Orders”' })).toBeVisible();
      expect(dialog).toHaveTextContent('Anyone who has the link can read the whole canvas, with every name in it.');
      expect(dialog).toHaveTextContent('A link is a copy, so what you change later is not in it.');
    });

    it('puts the cursor in the panel, and gives it back to what had it when it closes', async () => {
      const { dialog, opener, user } = await openPanel();
      // Which control has it is a matter of layout, which jsdom has none of: a browser test checks that it is the first.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });

    it('is closed by Escape', async () => {
      const { dialog } = await openPanel();
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      // The CDK reads the key code of the event, which a browser sets and user-event leaves empty for Escape.
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('opens once, whatever the number of times that it is asked to', async () => {
      await openPanel();

      TestBed.inject(ShareDialogs).share({ name: 'Other', document: sampleDocument(), saveAsFile: vi.fn() });

      // Not by what a screen reader finds: a modal dialog hides the one that it covers, so two would be one.
      expect(document.querySelectorAll('.cdk-dialog-container')).toHaveLength(1);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
  });

  describe('what to share', () => {
    it('offers only the canvas where there is no simulation to ask for messages', async () => {
      const { dialog } = await openPanel();

      expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
      expect(within(dialog).getByRole('radio', { name: 'The canvas' })).toBeChecked();
    });

    it('offers the canvas and its messages, and says how many there are', async () => {
      const { dialog } = await openPanel({ messages: messagesOf(3) });

      expect(within(dialog).getByRole('radio', { name: 'The canvas and its 3 messages' })).toBeEnabled();
      expect(within(dialog).getByRole('radio', { name: 'The canvas' })).toBeChecked();
      // What the messages will be is not said until they are chosen.
      expect(dialog).not.toHaveTextContent('Whoever opens the link sees the messages');
    });

    it('makes the two choices one group of radio buttons, so that the arrow keys go from one to the other and a screen reader counts them', async () => {
      const { dialog } = await openPanel({ messages: messagesOf(3) });

      const [canvas, messages] = within(dialog).getAllByRole<HTMLInputElement>('radio');

      expect(canvas?.name).not.toBe('');
      expect(messages?.name).toBe(canvas?.name);
      expect(within(dialog).getByRole('group', { name: 'What to share' })).toContainElement(canvas as HTMLElement);
    });

    it('moves the choice with the radio buttons themselves: choosing the messages unchecks the canvas, and choosing the canvas unchecks them', async () => {
      const { dialog, user } = await openPanel({ messages: messagesOf(3) });
      const canvas = within(dialog).getByRole('radio', { name: 'The canvas' });
      const messages = within(dialog).getByRole('radio', { name: 'The canvas and its 3 messages' });

      await user.click(messages);
      expect([canvas, messages].map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, true]);

      await user.click(canvas);
      expect([canvas, messages].map((radio) => (radio as HTMLInputElement).checked)).toEqual([true, false]);
    });

    it('says “message” for one, and does not switch the choice off', async () => {
      const { dialog } = await openPanel({ messages: messagesOf(1) });

      expect(within(dialog).getByRole('radio', { name: 'The canvas and its 1 message' })).toBeEnabled();
    });

    it('switches the messages off when there are none, and says why where the control is, so that it is read with it', async () => {
      const { dialog } = await openPanel({ messages: messagesOf(0) });

      const radio = within(dialog).getByRole('radio', { name: 'The canvas and its 0 messages' });
      expect(radio).toBeDisabled();
      expect(radio).toHaveAccessibleDescription(
        'No message is on the canvas now, so there are none to share. Publish one, and open this again.',
      );
    });

    it('says what the messages will be to whoever opens the link, once they are chosen', async () => {
      const { dialog, user } = await openPanel({ messages: messagesOf(2) });

      await user.click(within(dialog).getByRole('radio', { name: 'The canvas and its 2 messages' }));

      expect(dialog).toHaveTextContent('Whoever opens the link sees the messages where they are now, paused');
    });
  });

  describe('the link', () => {
    it('is in a field that can be read and not changed, built on the page, and opens as the canvas that is shared', async () => {
      const { field, ready } = await openPanel();
      await ready();

      expect(field()).toHaveAttribute('readonly');
      expect(field().value.startsWith(`${BASE}#c=v1.`)).toBe(true);
      const opened = await decodeShare(payloadIn(field()));
      expect(opened).toEqual({ ok: true, value: { name: 'Orders', document: sampleDocument() } });
    });

    it('carries the feature flags that are on, for as long as there are any', async () => {
      const { field, ready } = await openPanel({ flags: 'editor,share' });
      await ready();

      expect(field().value.startsWith(`${BASE}?ff=editor,share#c=v1.`)).toBe(true);
    });

    it('selects itself when it gets the cursor, so that it can be copied with the keys', async () => {
      const { field, ready } = await openPanel();
      await ready();
      field().setSelectionRange(2, 5);

      field().focus();

      expect([field().selectionStart, field().selectionEnd]).toEqual([0, field().value.length]);
    });

    it('selects itself again when it is pressed, though it has the cursor already and a part of it was selected', async () => {
      const { field, ready } = await openPanel();
      await ready();
      field().focus();
      field().setSelectionRange(2, 5);

      fireEvent.click(field());

      expect([field().selectionStart, field().selectionEnd]).toEqual([0, field().value.length]);
    });

    it('is described by what is said about it, which is its length, so that it is read with the field', async () => {
      const { dialog, field, ready } = await openPanel();
      await ready();

      expect(within(dialog).getByRole('status')).toHaveTextContent(/^The link is [\d,]+ characters long\.$/);
      expect(field()).toHaveAccessibleDescription(/^The link is [\d,]+ characters long\.$/);
    });

    it('asks for the canvas alone, with no simulation at all, and for the messages when they are chosen', async () => {
      const make = vi.fn(makeLink);
      const { dialog, ready, user } = await openPanel({ messages: messagesOf(2), maker: make });
      await ready();

      await user.click(within(dialog).getByRole('radio', { name: 'The canvas and its 2 messages' }));

      expect(make).toHaveBeenCalledTimes(2);
      expect(make.mock.calls[0]?.[0]).toStrictEqual({ name: 'Orders', document: sampleDocument() });
      expect(make.mock.calls[1]?.[0]).toStrictEqual({
        name: 'Orders',
        document: sampleDocument(),
        simulation: snapshotAfter(sampleDocument(), 1_000),
      });
      expect(make.mock.calls[1]?.[1]).toBe(BASE);
    });

    it('says what it is making, while it is being made, and has nothing to copy yet', async () => {
      let finish: (link: MadeLink) => void = () => undefined;
      const { dialog, field } = await openPanel({ maker: () => new Promise((resolve) => (finish = resolve)) });

      expect(within(dialog).getByText('Making the link…')).toBeVisible();
      expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeDisabled();
      expect(field().value).toBe('');

      finish({ kind: 'ready', address: `${BASE}#c=v1.x`, length: 1_266, long: false });

      expect(await within(dialog).findByText('The link is 1,266 characters long.')).toBeVisible();
      expect(within(dialog).queryByText('Making the link…')).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeEnabled();
    });

    it('is made again, with the messages in it, when they are chosen, and without them when they are not', async () => {
      const { dialog, field, ready, user } = await openPanel({ messages: messagesOf(2) });
      await ready();
      const without = field().value;

      await user.click(within(dialog).getByRole('radio', { name: 'The canvas and its 2 messages' }));
      await waitFor(() => expect(field().value).not.toBe(without));
      await ready();
      const withMessages = await decodeShare(payloadIn(field()));
      expect(withMessages.ok && withMessages.value.simulation).toEqual(snapshotAfter(sampleDocument(), 1_000));

      await user.click(within(dialog).getByRole('radio', { name: 'The canvas' }));
      await waitFor(() => expect(field().value).toBe(without));
    });

    it('does not make it again for a choice that is made already', async () => {
      const make = vi.fn(makeLink);
      const { dialog, ready, user } = await openPanel({ messages: messagesOf(2), maker: make });
      await ready();

      await user.click(within(dialog).getByRole('radio', { name: 'The canvas' }));

      expect(make).toHaveBeenCalledTimes(1);
    });

    it('shows the link for the choice that was made last, though an earlier one comes back later', async () => {
      const finishers: ((link: MadeLink) => void)[] = [];
      const { dialog, field, user } = await openPanel({
        messages: messagesOf(2),
        maker: () => new Promise((resolve) => finishers.push(resolve)),
      });
      await user.click(within(dialog).getByRole('radio', { name: 'The canvas and its 2 messages' }));
      expect(finishers).toHaveLength(2);

      finishers[1]?.({ kind: 'ready', address: `${BASE}#c=v1.second`, length: 10, long: false });
      await waitFor(() => expect(field().value).toBe(`${BASE}#c=v1.second`));
      finishers[0]?.({ kind: 'ready', address: `${BASE}#c=v1.first`, length: 11, long: false });
      // The page draws when a task of its own has run, which a promise does not wait for.
      await TestBed.inject(ApplicationRef).whenStable();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(field().value).toBe(`${BASE}#c=v1.second`);
      expect(within(dialog).getByTestId('share-length')).toHaveTextContent('The link is 10 characters long.');
    });
  });

  describe('its length', () => {
    it('is said quietly, with a comma between the thousands, when it is short enough to send', async () => {
      const { dialog, ready } = await openPanel();

      const length = await ready();

      expect(length).toHaveTextContent(/^The link is [\d,]+ characters long\.$/);
      expect(within(dialog).queryByTestId('share-long')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Download file' })).not.toBeInTheDocument();
    });

    it('becomes a warning above 8,000 characters, in words, with the file that a person can send instead', async () => {
      const { dialog, saveAsFile, user, field } = await openPanel({
        base: `https://learner.test/${'a'.repeat(8_000)}/`,
      });
      const warning = await within(dialog).findByTestId('share-long');

      expect(warning).toHaveTextContent(
        /This link is [\d,]+ characters long\. Some chat apps and mail clients cut a link that long/,
      );
      expect(warning).toHaveTextContent('Send the canvas as a file instead.');
      expect(field().value.length).toBeGreaterThan(8_000);

      await user.click(within(warning).getByRole('button', { name: 'Download file' }));

      expect(saveAsFile).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeEnabled();
    });
  });

  describe('copying it', () => {
    it('puts it on the clipboard, and says so in the panel and aloud', async () => {
      const { dialog, written, field, ready, user, announcer } = await openPanel();
      await ready();

      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));

      await waitFor(() => expect(within(dialog).getByTestId('share-notice')).toHaveTextContent('Link copied.'));
      expect(written).toEqual([field().value]);
      expect(announcer.last()).toBe('Link copied.');
    });

    it('says so, and leaves the link selected, when the browser does not let the page copy it', async () => {
      const { dialog, written, field, ready, user, announcer } = await openPanel({ clipboard: false });
      await ready();

      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));

      const notice = await within(dialog).findByTestId('share-notice');
      expect(notice).toHaveTextContent('The browser did not let this page copy the link. It is selected: press Ctrl+C');
      expect(written).toHaveLength(1);
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, field().value.length]);
      expect(announcer.last()).not.toBe('Link copied.');
    });

    it('does nothing while there is no link to copy', async () => {
      const { dialog, written } = await openPanel({ maker: () => new Promise(() => undefined) });

      const button = within(dialog).getByRole('button', { name: 'Copy link' });
      button.removeAttribute('disabled');
      button.click();

      expect(written).toEqual([]);
    });
  });

  describe('a link that cannot be made', () => {
    it('is told in the words of the codec, as an alert, with no file offered for a canvas that is not a canvas', async () => {
      const { dialog } = await openPanel({
        maker: async () => ({
          kind: 'failed',
          error: { kind: 'invalid', issues: [], message: 'This link is not valid: name: A canvas needs a name.' },
        }),
      });

      const alert = await within(dialog).findByRole('alert');

      expect(alert).toHaveTextContent('This link is not valid: name: A canvas needs a name.');
      expect(within(dialog).queryByRole('button', { name: 'Download file' })).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeDisabled();
    });

    it('is told with the file, which a canvas that is too big for a link is given as', async () => {
      const error: ShareError = {
        kind: 'too-large',
        what: 'link',
        found: 300_000,
        limit: 256_000,
        message: 'This link is 300,000 characters long. A canvas that big is sent as a file.',
      };
      const { dialog, saveAsFile, user } = await openPanel({ maker: async () => ({ kind: 'failed', error }) });

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('A canvas that big is sent as a file.');
      await user.click(within(alert).getByRole('button', { name: 'Download file' }));

      expect(saveAsFile).toHaveBeenCalledTimes(1);
    });
  });
});
