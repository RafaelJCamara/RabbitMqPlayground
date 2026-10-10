import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import type { EngineEvent, MessageInfo } from '@rmq/engine';
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
import { ConsumerInbox, INBOX_ROWS } from '../core/explain/consumer-inbox';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { ConsumerReceived } from './consumer-received';

/** An exchange that sends what has the key `new` to the queue `billing`, which the consumer `worker` takes from, acknowledging after a second. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1_000 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const info = (id: number, payload: string, key = 'new'): MessageInfo => ({
  id,
  producer: 'sender',
  exchange: 'orders',
  key,
  headers: [],
  payload,
});
const published = (message: MessageInfo): EngineEvent => ({
  seq: 1,
  at: 0,
  type: 'published',
  message,
  arrivesAt: 100,
});
const delivered = (message: number, at: number, redelivered = false): EngineEvent => ({
  seq: 1,
  at,
  type: 'delivered',
  message,
  queue: 'billing',
  consumer: 'tag',
  channel: 'C',
  redelivered,
  autoAck: false,
  arrivesAt: at + 100,
});
const acked = (message: number): EngineEvent => ({
  seq: 1,
  at: 900,
  type: 'acked',
  message,
  queue: 'billing',
  consumer: 'tag',
  channel: 'C',
});

async function renderSection(id = 'C') {
  const view = await render(ConsumerReceived, {
    inputs: { id },
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  const inbox = TestBed.inject(ConsumerInbox);
  TestBed.inject(DocumentStore).load(canvas());
  bus.run({ type: 'pause' }, 'toolbar');
  view.fixture.detectChanges();
  return {
    ...view,
    bus,
    inbox,
    explain: TestBed.inject(ExplainState),
    document: TestBed.inject(DocumentStore).document(),
    user: userEvent.setup(),
    settle: () => view.fixture.detectChanges(),
  };
}

describe('ConsumerReceived (ADR-0098)', () => {
  it('has a heading, and says that nothing has been received while nothing has', async () => {
    await renderSection();

    expect(screen.getByRole('heading', { level: 3, name: 'Received' })).toBeInTheDocument();
    expect(screen.getByTestId('received-empty')).toHaveTextContent('No messages received yet.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('is a list named for the consumer, with a row for each message that the queue gave it, newest first', async () => {
    const { inbox, document, settle } = await renderSection();

    inbox.apply(
      [published(info(1, 'one')), published(info(2, 'two')), delivered(1, 1_250), delivered(2, 2_500)],
      document,
    );
    settle();

    const list = screen.getByRole('list', { name: 'Messages received by worker' });
    const rows = within(list).getAllByTestId('received-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('#2');
    expect(rows[1]).toHaveTextContent('#1');
    expect(screen.queryByTestId('received-empty')).not.toBeInTheDocument();
  });

  it('says when, the number, the key, the payload and where it is, and that it was redelivered', async () => {
    const { inbox, document, settle } = await renderSection();

    inbox.apply([published(info(5, 'Hello', 'orders.new')), delivered(5, 1_250, true), acked(5)], document);
    settle();

    const row = screen.getByTestId('received-row');
    expect(row).toHaveTextContent('1.250 s');
    expect(row).toHaveTextContent('#5');
    expect(row).toHaveTextContent('orders.new');
    expect(screen.getByTestId('received-payload')).toHaveTextContent(/^Hello$/);
    expect(screen.getByTestId('received-state')).toHaveTextContent(/^acked$/);
    expect(row).toHaveTextContent('redelivered');
  });

  it('says that there is no key, and that the payload is empty, in words, and in the colour of text that is muted', async () => {
    const { inbox, document, settle } = await renderSection();

    inbox.apply([published(info(1, '', '')), delivered(1, 100)], document);
    settle();

    const row = screen.getByTestId('received-row');
    expect(row).toHaveTextContent('(no key)');
    expect(screen.getByTestId('received-payload')).toHaveTextContent('(empty payload)');
    expect(screen.getByTestId('received-payload').className).toContain('text-muted');
  });

  it('cuts a long payload at eighty characters with an ellipsis, and shows a payload of eighty whole', async () => {
    const { inbox, document, settle } = await renderSection();
    const eighty = 'x'.repeat(80);
    const longer = `${eighty}y`;

    inbox.apply(
      [published(info(1, longer)), published(info(2, eighty)), delivered(1, 100), delivered(2, 200)],
      document,
    );
    settle();

    const [second, first] = screen.getAllByTestId('received-payload');
    expect(second).toHaveTextContent(/^x{80}$/);
    expect(first).toHaveTextContent(/^x{79}…$/);
  });

  it('says that the payload is not kept any more for a message that the inbox does not hold', async () => {
    const { inbox, document, settle } = await renderSection();

    inbox.apply([delivered(1, 100)], document);
    settle();

    expect(screen.getByTestId('received-payload')).toHaveTextContent('(payload no longer kept)');
  });

  it('opens the message in the message inspector, with what the row says of it, when its row is pressed', async () => {
    const { inbox, document, settle, user, explain } = await renderSection();
    inbox.apply([published(info(3, 'Hi', 'new')), delivered(3, 100)], document);
    settle();

    const button = screen.getByRole('button', { name: /#3/ });
    expect(button).toHaveAttribute('title', 'Open message 3 in the inspector');
    await user.click(button);
    settle();

    expect(explain.message()).toBe(3);
    expect(explain.openedMessage()).toMatchObject({ number: 3, info: { payload: 'Hi', key: 'new' } });
    expect(button).toHaveAttribute('aria-current', 'true');
  });

  it('is not a live region, so that a screen reader is not read to for each message of a burst', async () => {
    const { inbox, document, settle } = await renderSection();
    inbox.apply([published(info(1, 'one')), delivered(1, 100)], document);
    settle();

    const section = screen.getByTestId('consumer-received');
    expect(section.closest('[aria-live]')).toBeNull();
    expect(section.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });

  it('says that the last hundred are kept when it holds that many', async () => {
    const { inbox, document, settle } = await renderSection();
    for (let id = 1; id <= INBOX_ROWS; id += 1) {
      inbox.apply([published(info(id, `p${id}`)), delivered(id, id * 10)], document);
    }
    settle();

    expect(screen.getAllByTestId('received-row')).toHaveLength(INBOX_ROWS);
    expect(screen.getByTestId('received-limit')).toHaveTextContent('The last 100 are kept.');
  });

  it('has nothing for a node that is not a consumer, or is gone', async () => {
    await renderSection('NOBODY');

    expect(screen.queryByTestId('consumer-received')).not.toBeInTheDocument();
  });

  it('shows what the simulation gives the consumer, with the payload that was typed, as it runs', async () => {
    const { bus, settle } = await renderSection();
    bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new', payload: 'Hello' }, 'toolbar');

    for (let step = 0; step < 40; step += 1) {
      bus.run({ type: 'step' }, 'toolbar');
    }
    settle();

    expect(screen.getByTestId('received-payload')).toHaveTextContent(/^Hello$/);
    expect(screen.getByTestId('received-state')).toHaveTextContent(/^acked$/);
  });
});
