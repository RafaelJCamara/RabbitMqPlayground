import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { LIST_LIMIT, PAYLOAD_CUT, QueueMessages } from './queue-messages';

/** An exchange that sends what has the key `new` to the queue `billing`, which has the consumer `worker`, one message at a time, a second for each. */
const canvas = (consumers: CanvasDocument['consumers'] = {}): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers,
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});
const withWorker = (ack: 'auto' | 'manual' = 'manual') => ({
  C: consumerRecord('worker', ['Q'], { ack, prefetch: 1, processingMs: 1_000 }),
});

async function renderSection(document: CanvasDocument = canvas(), id = 'Q') {
  const view = await render(QueueMessages, {
    inputs: { id },
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  TestBed.inject(DocumentStore).load(document);
  bus.run({ type: 'pause' }, 'toolbar');
  view.fixture.detectChanges();
  const send = (key = 'new', payload = 'hello') =>
    bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key, payload }, 'toolbar');
  const step = (times: number) => {
    for (let index = 0; index < times; index += 1) {
      bus.run({ type: 'step' }, 'toolbar');
    }
    view.fixture.detectChanges();
  };
  return {
    ...view,
    bus,
    send,
    step,
    status: TestBed.inject(StatusStore),
    log: TestBed.inject(CommandLog),
    user: userEvent.setup(),
    /** Gives the screen what the simulation changed. */
    settle: () => view.fixture.detectChanges(),
  };
}

describe('QueueMessages (ADR-0056)', () => {
  it('says that a queue holds nothing, and has nothing to purge, and says why', async () => {
    await renderSection();

    expect(screen.getByRole('heading', { name: 'Messages' })).toBeVisible();
    expect(screen.getByTestId('queue-counts')).toHaveTextContent(
      '0 messages are ready, and 0 are held and not acknowledged.',
    );
    expect(screen.queryByTestId('queue-message-list')).toBeNull();
    const purge = screen.getByRole('button', { name: 'Purge the ready messages' });
    expect(purge).toBeDisabled();
    expect(purge).toHaveAttribute('title', 'There are no ready messages to purge');
  });

  it('lists what it holds, each with its number, its key and the start of its payload, and counts them in words', async () => {
    const { send, step } = await renderSection();
    send('new', 'first');
    send('new', 'second');
    step(4);

    const list = screen.getByRole('list', { name: 'Messages in billing' });
    const items = within(list).getAllByTestId('queue-message');

    expect(screen.getByTestId('queue-counts')).toHaveTextContent(
      '2 messages are ready, and 0 are held and not acknowledged.',
    );
    expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '#1 new first',
      '#2 new second',
    ]);
  });

  it('says that a message has no key, and cuts a long payload, and says how many more there are than it lists', async () => {
    const { send, step } = await renderSection();
    send('new', 'x'.repeat(PAYLOAD_CUT + 30));
    step(2);
    const item = screen.getByTestId('queue-message');

    expect(item).toHaveTextContent(`#1 new ${'x'.repeat(PAYLOAD_CUT - 1)}…`);
    expect(screen.getByTestId('queue-counts')).toHaveTextContent('1 message is ready');
  });

  it('lists the first fifty, and counts the rest', async () => {
    const { send, step } = await renderSection();
    for (let sent = 0; sent < LIST_LIMIT + 3; sent += 1) {
      send();
    }
    step(2 * (LIST_LIMIT + 3));

    expect(screen.getAllByTestId('queue-message')).toHaveLength(LIST_LIMIT);
    expect(screen.getByTestId('queue-more')).toHaveTextContent('and 3 more');
    expect(screen.getByTestId('queue-counts')).toHaveTextContent(`${LIST_LIMIT + 3} messages are ready`);
  });

  it('says which consumer holds a message that it has been given and has not acknowledged, and after the ones that are ready', async () => {
    const { send, step } = await renderSection(canvas(withWorker()));
    send('new', 'one');
    send('new', 'two');
    step(5);

    const items = screen.getAllByTestId('queue-message').map((item) => item.textContent?.replace(/\s+/g, ' ').trim());

    expect(items).toEqual(['#2 new two', '#1 new one held by worker']);
    expect(screen.getByTestId('queue-counts')).toHaveTextContent(
      '1 message is ready, and 1 is held and not acknowledged.',
    );
  });

  it('says that a message is redelivered when it went back to its queue because its consumer was closed', async () => {
    const { send, step, bus, settle } = await renderSection(canvas(withWorker()));
    send('new', 'one');
    step(3);
    // The consumer goes, and what it held goes back, with nobody to give it to.
    bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'inspector');
    settle();

    expect(screen.getByTestId('queue-message')).toHaveTextContent('#1 new one redelivered');
  });

  it('purges what is ready, with the command, and says how many, and leaves what consumers hold', async () => {
    const { send, step, user, status, log, settle } = await renderSection(canvas(withWorker()));
    send('new', 'one');
    send('new', 'two');
    send('new', 'three');
    step(7);
    expect(screen.getByTestId('queue-counts')).toHaveTextContent('2 messages are ready, and 1 is held');

    await user.click(screen.getByRole('button', { name: 'Purge the ready messages' }));
    settle();

    expect(status.notice()).toEqual({ kind: 'message', text: 'Purged 2 messages from billing.' });
    expect(log.entries().at(-1)).toMatchObject({ origin: 'inspector', text: 'purge billing' });
    expect(screen.getByTestId('queue-counts')).toHaveTextContent('0 messages are ready, and 1 is held');
    expect(screen.getByRole('button', { name: 'Purge the ready messages' })).toBeDisabled();
    expect(screen.getAllByTestId('queue-message')).toHaveLength(1);
  });

  it('says what the learner calls the queue now, and says that a message that the consumers hold stays', async () => {
    const { bus, settle } = await renderSection();
    bus.apply({ type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'invoices' }, 'inspector');
    settle();

    expect(screen.getByRole('heading', { name: 'Messages' })).toBeVisible();
    expect(screen.getByText(/The ones that consumers hold stay with them/)).toBeVisible();
  });

  it('shows nothing for what is not a queue, or for one that is gone', async () => {
    const { container } = await renderSection(canvas(), 'P');

    expect(container.querySelector('[data-testid="queue-messages"]')).toBeNull();
  });
});
