import { TestBed } from '@angular/core/testing';
import { emptyDocument, type Batch, type CanvasDocument } from '@rmq/domain';
import { failure, readDefinitions, succeed, type DefinitionsFile, type Outcome } from '@rmq/persistence';
import { sampleDocument } from '@rmq/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
import { ShareDialogs } from './dialogs';

/** The dialog that imports a definitions file into the canvas (ADR-0111). */

afterEach(() => {
  document.body.replaceChildren();
});

const exchange = (name: string, vhost = '/') => ({
  name,
  vhost,
  type: 'direct',
  durable: true,
  auto_delete: false,
  internal: false,
  arguments: {},
});
const queue = (name: string, vhost = '/', more: Record<string, unknown> = {}) => ({
  name,
  vhost,
  durable: true,
  auto_delete: false,
  arguments: {},
  ...more,
});

function read(data: unknown): Outcome<DefinitionsFile, string> {
  const result = readDefinitions(JSON.stringify(data));
  return result.ok ? succeed(result.value) : failure(result.error.message);
}

const ONE_VHOST = read({ vhosts: [{ name: '/' }], exchanges: [exchange('orders')], queues: [queue('billing')] });

async function openDialog(file: Outcome<DefinitionsFile, string>, onto: CanvasDocument = emptyDocument(), took = true) {
  const run = vi.fn<(batch: Batch) => boolean>(() => took);
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  TestBed.inject(ShareDialogs).importDefinitions({
    name: 'Orders flow',
    fileName: 'defs.json',
    document: onto,
    file,
    run,
  });
  const dialog = await screen.findByRole('dialog', { name: 'Import definitions into “Orders flow”' });
  return { dialog, opener, run, user: userEvent.setup(), announcer: TestBed.inject(Announcer) };
}

describe('ImportDialog (ADR-0111)', () => {
  it('says which file, what will be on the canvas and the vhost, and imports it on an empty canvas with one button', async () => {
    const { dialog, run, user } = await openDialog(ONE_VHOST);

    expect(within(dialog).getByTestId('import-file')).toHaveTextContent('defs.json');
    expect(within(dialog).getByTestId('import-summary')).toHaveTextContent(
      '1 exchange and 1 queue will be on the canvas.',
    );
    expect(within(dialog).getByTestId('import-vhost-only')).toHaveTextContent('Virtual host: /');
    expect(within(dialog).queryByTestId('import-replaces')).toBeNull();
    expect(within(dialog).queryByTestId('import-notes')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(run).toHaveBeenCalledOnce();
    const batch = run.mock.calls[0]?.[0];
    expect(batch?.commands.map(({ type }) => type)).toEqual([
      'clear',
      'set',
      'declare-exchange',
      'declare-queue',
      'layout',
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says that it replaces what is on the canvas, how much, and that Undo takes it back, and its button says so', async () => {
    const { dialog } = await openDialog(ONE_VHOST, sampleDocument());

    expect(within(dialog).getByTestId('import-replaces')).toHaveTextContent(
      /^This replaces everything that is on the canvas now \(\d+ elements and \d+ links\), producers and consumers too\. Undo takes the import back\.$/,
    );
    expect(within(dialog).getByRole('button', { name: 'Replace and import' })).toBeEnabled();
  });

  it('lists what it leaves out or changes, each with what it is', async () => {
    const { dialog } = await openDialog(
      read({
        vhosts: [{ name: '/' }],
        users: [{ name: 'guest' }],
        queues: [queue('billing', '/', { arguments: { 'x-queue-type': 'quorum' } })],
      }),
    );

    const items = within(within(dialog).getByTestId('import-notes')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Left out: The users (1) of the file are not imported: a canvas has exchanges, queues and bindings only.',
      'Changed: The queue “billing” is imported as a classic queue: its type is “quorum”, and the simulator models classic queues only.',
    ]);
  });

  it('asks which vhost to import when the file has several, starts at /, and imports the one that is chosen', async () => {
    const file = read({
      vhosts: [{ name: 'shop' }, { name: '/' }],
      queues: [queue('billing'), queue('checkout', 'shop'), queue('carts', 'shop')],
    });
    const { dialog, run, user } = await openDialog(file);

    const select = within(dialog).getByRole('combobox', { name: 'Virtual host' }) as HTMLSelectElement;
    expect(select.value).toBe('/');
    expect(within(dialog).getByTestId('import-summary')).toHaveTextContent('1 queue will be on the canvas.');

    await user.selectOptions(select, 'shop');
    expect(within(dialog).getByTestId('import-summary')).toHaveTextContent('2 queues will be on the canvas.');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(run.mock.calls[0]?.[0].commands).toContainEqual({ type: 'set', kind: 'canvas', changes: { vhost: 'shop' } });
  });

  it('says why a file cannot be imported, has only Close, and imports nothing', async () => {
    const { dialog, run } = await openDialog(failure('“defs.yaml” is not a JSON file.'));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('“defs.yaml” is not a JSON file.');
    expect(within(dialog).queryByRole('button', { name: 'Import' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(run).not.toHaveBeenCalled();
  });

  it('says why when nothing in the file can go on a canvas, with what it left out, and says it again when Import is pressed', async () => {
    const { dialog, run, user, announcer } = await openDialog(
      read({ vhosts: [{ name: '/' }], exchanges: [exchange('amq.direct')] }),
    );
    const announce = vi.spyOn(announcer, 'announce');

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/^Nothing in this file can go on a canvas/);
    expect(within(dialog).getByTestId('import-notes')).toHaveTextContent('amq.direct');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(run).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/^Nothing in this file can go on a canvas/),
      'assertive',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('stays open when the canvas does not take the import', async () => {
    const { run, user } = await openDialog(ONE_VHOST, emptyDocument(), false);

    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(run).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes with Cancel and gives the focus back to what opened it', async () => {
    const { opener, run, user } = await openDialog(ONE_VHOST);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(run).not.toHaveBeenCalled();
  });
});
