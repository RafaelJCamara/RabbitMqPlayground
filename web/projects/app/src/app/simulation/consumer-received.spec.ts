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
import { describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
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
import { ConsumerReceived, RECEIVED_PAGE } from './consumer-received';

/** An exchange that sends what has the key `new` to the queue `billing`, which the consumer `worker` takes from, acknowledging after a second. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: {
      C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1_000 }),
      D: consumerRecord('helper', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1_000 }),
    },
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
const delivered = (message: number, at: number, redelivered = false, channel = 'C'): EngineEvent => ({
  seq: 1,
  at,
  type: 'delivered',
  message,
  queue: 'billing',
  consumer: 'tag',
  channel,
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

    expect(screen.getAllByTestId('received-row')).toHaveLength(RECEIVED_PAGE);
    expect(screen.getByTestId('received-page')).toHaveTextContent('Page 1 of 10 · messages 1–10 of 100');
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

  describe('pages of ten (ADR-0105)', () => {
    /** Gives the consumer `count` messages, numbered from `from`, so that the newest is the highest. */
    const give = (inbox: ConsumerInbox, document: CanvasDocument, count: number, channel = 'C', from = 1) => {
      for (let id = from; id < from + count; id += 1) {
        inbox.apply([published(info(id, `p${id}`)), delivered(id, id * 10, false, channel)], document);
      }
    };
    const numbers = () =>
      screen.getAllByTestId('received-row').map((row) => /^[^#]*#(\d+)/.exec(row.textContent ?? '')?.[1]);
    const pager = () => screen.queryByTestId('received-pages');

    it('has no pages to go through while the list fits on one: ten rows are one page, and eleven are two', async () => {
      const { inbox, document, settle } = await renderSection();
      give(inbox, document, RECEIVED_PAGE);
      settle();

      expect(pager()).not.toBeInTheDocument();
      expect(screen.getAllByTestId('received-row')).toHaveLength(10);

      give(inbox, document, 1, 'C', 11);
      settle();

      expect(pager()).toBeInTheDocument();
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 1 of 2 · messages 1–10 of 11');
    });

    it('shows the newest ten on the first page, and goes to the next and back with Next and Previous', async () => {
      const { inbox, document, settle, user } = await renderSection();
      give(inbox, document, 25);
      settle();

      expect(numbers()).toEqual(['25', '24', '23', '22', '21', '20', '19', '18', '17', '16']);
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 1 of 3 · messages 1–10 of 25');

      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(numbers()).toEqual(['15', '14', '13', '12', '11', '10', '9', '8', '7', '6']);
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 2 of 3 · messages 11–20 of 25');

      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(numbers()).toEqual(['5', '4', '3', '2', '1']);
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 3 of 3 · messages 21–25 of 25');

      await user.click(screen.getByRole('button', { name: 'Previous' }));
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 2 of 3 · messages 11–20 of 25');
      expect(numbers()[0]).toBe('15');
    });

    it('disables Previous on the first page and Next on the last, and the buttons have the size of the buttons of the app', async () => {
      const { inbox, document, settle, user } = await renderSection();
      give(inbox, document, 15);
      settle();
      const previous = screen.getByRole('button', { name: 'Previous' });
      const next = screen.getByRole('button', { name: 'Next' });

      expect(previous).toBeDisabled();
      expect(next).toBeEnabled();
      await user.click(next);
      expect(previous).toBeEnabled();
      expect(next).toBeDisabled();
      for (const button of [previous, next, screen.getByRole('button', { name: 'Clear' })]) {
        expect(button.className).toContain('min-h-8');
      }
    });

    it('says the page aloud once when it changes, and not when the rows change under it, and the text of the pages is not a live region', async () => {
      const { inbox, document, settle, user } = await renderSection();
      const announce = vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
      give(inbox, document, 25);
      settle();
      expect(announce).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(announce).toHaveBeenCalledExactlyOnceWith('Page 2 of 3, messages 11–20 of 25.');

      give(inbox, document, 1, 'C', 26);
      settle();
      expect(announce).toHaveBeenCalledOnce();
      const nav = screen.getByTestId('received-pages');
      expect(nav.closest('[aria-live]')).toBeNull();
      expect(nav.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
      expect(nav).toHaveAccessibleName('Pages of what worker received');
    });

    it('keeps the focus on the button that was pressed, and moves it to the other one when the pressed one has no page left to go to', async () => {
      const { inbox, document, settle, user } = await renderSection();
      give(inbox, document, 25);
      settle();
      const next = screen.getByRole('button', { name: 'Next' });
      const previous = screen.getByRole('button', { name: 'Previous' });

      await user.click(next);
      expect(next).toHaveFocus();
      await user.click(next);
      settle();
      expect(next).toBeDisabled();
      expect(previous).toHaveFocus();
      await user.click(previous);
      await user.click(previous);
      settle();
      expect(previous).toBeDisabled();
      expect(next).toHaveFocus();
    });

    it('goes back to the first page when another consumer is chosen', async () => {
      const { inbox, document, settle, user, fixture } = await renderSection();
      give(inbox, document, 25);
      give(inbox, document, 25, 'D', 100);
      settle();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 2 of 3');

      fixture.componentRef.setInput('id', 'D');
      settle();

      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 1 of 3 · messages 1–10 of 25');
      expect(numbers()[0]).toBe('124');
      expect(screen.getByRole('list', { name: 'Messages received by helper' })).toBeInTheDocument();
    });

    it('does not change the page when new messages come, though the rows on it move down', async () => {
      const { inbox, document, settle, user } = await renderSection();
      give(inbox, document, 25);
      settle();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(numbers()[0]).toBe('15');

      give(inbox, document, 3, 'C', 26);
      settle();

      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 2 of 3 · messages 11–20 of 28');
      expect(numbers()[0]).toBe('18');
    });

    it('stays inside the pages that there are when the list gets shorter than the page that was asked for', async () => {
      const { inbox, document, settle, user } = await renderSection();
      give(inbox, document, 25);
      settle();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 3 of 3');

      inbox.clear('C');
      give(inbox, document, 12, 'C', 100);
      settle();

      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 2 of 2 · messages 11–12 of 12');
      expect(numbers()).toEqual(['101', '100']);
    });
  });

  describe('clearing the list (ADR-0105)', () => {
    it('has a Clear button beside the heading that is off while there is nothing to clear, and says why in its title', async () => {
      const { inbox, document, settle } = await renderSection();
      const clear = screen.getByRole('button', { name: 'Clear' });

      expect(clear).toBeDisabled();
      expect(clear).toHaveAttribute('title', 'There is nothing to clear: no messages have been received.');
      expect(clear.parentElement).toContainElement(screen.getByRole('heading', { level: 3, name: 'Received' }));

      inbox.apply([published(info(1, 'one')), delivered(1, 100)], document);
      settle();

      expect(clear).toBeEnabled();
      expect(clear).toHaveAttribute('title', 'Empties this list. The messages and the simulation are not changed.');
    });

    it('empties the list, says that there are no messages, says what it did aloud, and puts the cursor on the heading', async () => {
      const { inbox, document, settle, user } = await renderSection();
      const announce = vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
      inbox.apply([published(info(1, 'one')), delivered(1, 100)], document);
      settle();

      await user.click(screen.getByRole('button', { name: 'Clear' }));
      settle();

      expect(screen.queryByTestId('received-row')).not.toBeInTheDocument();
      expect(screen.getByTestId('received-empty')).toHaveTextContent('No messages received yet.');
      expect(announce).toHaveBeenCalledExactlyOnceWith('Cleared what worker received.');
      expect(screen.getByRole('heading', { level: 3, name: 'Received' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    });

    it('goes back to the first page, and what comes next starts a list again', async () => {
      const { inbox, document, settle, user } = await renderSection();
      for (let id = 1; id <= 25; id += 1) {
        inbox.apply([published(info(id, 'x')), delivered(id, id * 10)], document);
      }
      settle();
      await user.click(screen.getByRole('button', { name: 'Next' }));

      await user.click(screen.getByRole('button', { name: 'Clear' }));
      inbox.apply([published(info(30, 'after')), delivered(30, 400)], document);
      settle();

      expect(screen.queryByTestId('received-pages')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('received-row')).toHaveLength(1);
      expect(screen.getByTestId('received-payload')).toHaveTextContent('after');

      for (let id = 40; id < 65; id += 1) {
        inbox.apply([published(info(id, 'x')), delivered(id, id * 10)], document);
      }
      settle();

      expect(screen.getByTestId('received-page')).toHaveTextContent('Page 1 of 3 · messages 1–10 of 26');
    });

    it('leaves the list of another consumer, the document and the simulation as they were', async () => {
      const { inbox, document, settle, user } = await renderSection();
      inbox.apply([published(info(1, 'x')), delivered(1, 100), delivered(1, 100, false, 'D')], document);
      settle();

      await user.click(screen.getByRole('button', { name: 'Clear' }));

      expect(inbox.of('D')).toHaveLength(1);
      expect(TestBed.inject(DocumentStore).document()).toBe(document);
    });

    it('shows a row that Clear messages took out of the simulation as cleared', async () => {
      const { inbox, document, settle } = await renderSection();
      inbox.apply([published(info(1, 'x')), delivered(1, 100)], document);
      inbox.apply([{ seq: 1, at: 200, type: 'cleared', travelling: 1, ready: 0, unacked: 0, buffered: 0 }], document);
      settle();

      expect(screen.getByTestId('received-state')).toHaveTextContent(/^cleared$/);
    });
  });
});
