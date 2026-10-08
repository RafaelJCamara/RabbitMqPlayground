import { TestBed } from '@angular/core/testing';
import type { CanvasDocument } from '@rmq/domain';
import { exportDefinitions } from '@rmq/persistence';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
import { FILE_DOWNLOADER, type FileDownloader } from '../core/files/downloader';
import { ShareDialogs } from './dialogs';
import { summaryText } from './export-dialog';

/** The dialog that exports a canvas for a broker (ADR-0079, ADR-0014). */

afterEach(() => {
  document.body.replaceChildren();
});

async function openDialog(document_: CanvasDocument = sampleDocument(), name = 'Orders flow') {
  const save = vi.fn<FileDownloader['save']>();
  TestBed.configureTestingModule({ providers: [{ provide: FILE_DOWNLOADER, useValue: { save } }] });
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  TestBed.inject(ShareDialogs).exportDefinitions({ name, document: document_ });
  const dialog = await screen.findByRole('dialog', { name: 'Export “Orders flow” for a broker' });
  return {
    dialog,
    opener,
    save,
    user: userEvent.setup(),
    announcer: TestBed.inject(Announcer),
    vhost: () => within(dialog).getByRole('textbox', { name: 'Virtual host' }) as HTMLInputElement,
    download: () => within(dialog).getByRole('button', { name: 'Download definitions' }),
  };
}

/** A canvas with an exchange, a queue and a binding, a producer, a consumer, and a binding that asks for a header to exist. */
const withWarnings = (): CanvasDocument =>
  documentOf({
    vhost: '/shop',
    exchanges: { E1: exchangeRecord('docs', 'headers'), E2: exchangeRecord('events', 'topic') },
    queues: { Q1: queueRecord('archive'), Q2: queueRecord('inbox') },
    bindings: {
      B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, '', {
        xMatch: 'all',
        args: [{ key: 'author', value: { t: 'exists' } }],
      }),
      B2: bindingRecord('E2', { kind: 'queue', id: 'Q2' }, 'doc.#'),
    },
    producers: { P1: producerRecord('sender') },
    consumers: { C1: consumerRecord('worker', ['Q2']) },
  });

describe('summaryText', () => {
  it.each([
    [{ exchanges: 3, queues: 2, bindings: 4 }, '3 exchanges, 2 queues and 4 bindings'],
    [{ exchanges: 1, queues: 1, bindings: 1 }, '1 exchange, 1 queue and 1 binding'],
    [{ exchanges: 0, queues: 0, bindings: 0 }, '0 exchanges, 0 queues and 0 bindings'],
  ])('says %j as %s', (summary, text) => {
    expect(summaryText(summary)).toBe(text);
  });
});

describe('the dialog that exports a canvas for a broker (ADR-0079)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('what it says', () => {
    it('is a modal dialog named for the canvas, which says what a definitions file is and how it is loaded', async () => {
      const { dialog } = await openDialog();

      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(
        within(dialog).getByRole('heading', { level: 2, name: 'Export “Orders flow” for a broker' }),
      ).toBeVisible();
      expect(dialog).toHaveTextContent('A definitions file loads into RabbitMQ through the management UI');
      expect(dialog).toHaveTextContent('rabbitmqctl import_definitions');
    });

    it('has the virtual host of the canvas in a field, and says what is in the file', async () => {
      const { vhost, dialog } = await openDialog(withWarnings());

      expect(vhost()).toHaveValue('/shop');
      expect(within(dialog).getByTestId('export-summary')).toHaveTextContent(
        '2 exchanges, 2 queues and 1 binding are in the file.',
      );
    });

    it('says that everything is in the file when there is nothing to leave out, and what a file never has', async () => {
      const { dialog } = await openDialog(
        documentOf({ exchanges: { E1: exchangeRecord('orders') }, queues: { Q1: queueRecord('billing') } }),
      );

      expect(within(dialog).getByTestId('export-all')).toHaveTextContent('Everything on the canvas is in the file.');
      expect(within(dialog).queryByTestId('export-warnings')).not.toBeInTheDocument();
      expect(within(dialog).getByTestId('export-never')).toHaveTextContent(
        'The layout, the seed and the latencies of the simulation are not in the file either: the canvas file keeps them.',
      );
    });

    it('lists what it leaves out, in a list, one sentence for each, before anything is downloaded', async () => {
      const { dialog, save } = await openDialog(withWarnings());

      const items = within(within(dialog).getByTestId('export-warnings')).getAllByRole('listitem');

      expect(items.map((item) => item.textContent)).toEqual([
        'The binding from the exchange “docs” to the queue “archive” is not in the file: it has a condition that a header exists, and RabbitMQ does not accept a header with no value in a definitions file.',
        'The producer “sender” and the consumer “worker” are not in the file: they are the simulator’s, and a broker has clients instead.',
      ]);
      expect(within(dialog).queryByTestId('export-all')).not.toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });

    it('says that there is nothing to put in a file, for a canvas that has nothing that a broker holds', async () => {
      const { dialog } = await openDialog(documentOf({ producers: { P1: producerRecord('sender') } }));

      expect(within(dialog).getByTestId('export-empty')).toHaveTextContent(
        'Nothing on the canvas can go in a definitions file',
      );
      expect(within(dialog).queryByTestId('export-summary')).not.toBeInTheDocument();
    });
  });

  describe('downloading it', () => {
    it('gives the file that the export makes, named for the canvas, and says so aloud, and closes', async () => {
      const { save, user, download, announcer, opener } = await openDialog(withWarnings());

      await user.click(download());

      expect(save).toHaveBeenCalledTimes(1);
      const [name, text] = save.mock.calls[0] ?? [];
      expect(name).toBe('orders-flow.definitions.json');
      const expected = exportDefinitions(withWarnings(), '/shop');
      expect(expected.ok && text).toBe(expected.ok && expected.value.text);
      expect(announcer.last()).toBe('Downloaded orders-flow.definitions.json.');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });

    it('is done by Enter in the field, and names the virtual host that was typed in the file', async () => {
      const { save, user, vhost } = await openDialog();

      await user.clear(vhost());
      await user.type(vhost(), '/orders{Enter}');

      const text = save.mock.calls[0]?.[1] ?? '';
      expect(JSON.parse(text).vhosts).toEqual([{ name: '/orders' }]);
    });

    it('says why a virtual host cannot be one, under its field, puts the cursor in it, and gives nothing', async () => {
      const { dialog, save, user, vhost, download } = await openDialog();
      await user.clear(vhost());

      await user.click(download());

      const alert = within(dialog).getByRole('alert');
      expect(alert).toHaveTextContent('A vhost needs a name. The broker’s own is “/”.');
      expect(vhost()).toHaveAttribute('aria-invalid', 'true');
      expect(vhost()).toHaveAccessibleDescription('A vhost needs a name. The broker’s own is “/”.');
      expect(vhost()).toHaveFocus();
      expect(save).not.toHaveBeenCalled();
      expect(download()).toBeEnabled();
    });

    it('says how many bytes a name that is too long has, and gives nothing', async () => {
      const { dialog, save, user, vhost, download } = await openDialog();
      await user.clear(vhost());
      await user.type(vhost(), 'é'.repeat(130));

      await user.click(download());

      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'A vhost name can be at most 255 bytes, and this one is 260.',
      );
      expect(save).not.toHaveBeenCalled();
    });

    it('takes the sentence away when the virtual host is mended and the file is asked for again', async () => {
      const { dialog, save, user, vhost, download } = await openDialog();
      await user.clear(vhost());
      await user.click(download());
      expect(within(dialog).getByRole('alert')).toBeVisible();

      await user.type(vhost(), '/fixed');
      await user.click(download());

      expect(save).toHaveBeenCalledTimes(1);
    });

    it('gives nothing, and says why, for a canvas that has nothing that a broker holds, and leaves the dialog open', async () => {
      const { dialog, save, user, download } = await openDialog(
        documentOf({ consumers: { C1: consumerRecord('worker') } }),
      );

      await user.click(download());

      expect(within(dialog).getByRole('alert')).toHaveTextContent('Nothing on the canvas can go in a definitions file');
      expect(save).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('closing it', () => {
    it('is closed by the Close button, and gives the focus back to what had it', async () => {
      const { dialog, user, opener } = await openDialog();

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });

    it('is closed by Escape', async () => {
      const { dialog } = await openDialog();
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('opens once, whatever the number of times that it is asked to', async () => {
      await openDialog();

      TestBed.inject(ShareDialogs).exportDefinitions({ name: 'Other', document: sampleDocument() });
      TestBed.inject(ShareDialogs).share({ name: 'Other', document: sampleDocument(), saveAsFile: vi.fn() });

      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('can be opened again after it has been closed', async () => {
      const { dialog, user } = await openDialog();
      await user.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      TestBed.inject(ShareDialogs).exportDefinitions({ name: 'Orders flow', document: sampleDocument() });

      expect(await screen.findByRole('dialog', { name: 'Export “Orders flow” for a broker' })).toBeInTheDocument();
    });
  });
});
