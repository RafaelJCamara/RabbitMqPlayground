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
import { beforeEach, describe, expect, it } from 'vitest';
import { FRAME_SOURCE } from '../runtime/frame-loop';
import { RUNTIME_SERVICES } from '../runtime/services';
import { CommandBus } from '../state/command-bus';
import { CommandLog } from '../state/command-log';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { StatusStore } from '../state/status-store';
import { ConsumerInbox } from './consumer-inbox';
import { EXPLAIN_SERVICES } from './services';

/** An exchange that sends what has the key `new` to the queue `billing`, which the consumers `worker` (acknowledging after a second) and `other` take from. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: {
      C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1_000 }),
      D: consumerRecord('other', [], { ack: 'auto' }),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const info = (id: number, payload = 'hello', key = 'new'): MessageInfo => ({
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
const delivered = (message: number, channel = 'C', redelivered = false, at = 200): EngineEvent => ({
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
const handled = (
  type: 'received' | 'processed' | 'acked' | 'requeued',
  message: number,
  channel = 'C',
  at = 300,
): EngineEvent => ({ seq: 1, at, type, message, queue: 'billing', consumer: 'tag', channel });

function setup() {
  TestBed.configureTestingModule({
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
  const inbox = TestBed.inject(ConsumerInbox);
  const store = TestBed.inject(DocumentStore);
  const bus = TestBed.inject(CommandBus);
  store.load(canvas());
  bus.run({ type: 'pause' }, 'toolbar');
  return { inbox, store, bus, document: store.document() };
}

describe('ConsumerInbox (ADR-0098)', () => {
  let harness: ReturnType<typeof setup>;
  beforeEach(() => {
    harness = setup();
  });

  describe('what a consumer was given', () => {
    it('is a row for each message that a queue gave it, newest first, with the payload and the key that were published', () => {
      const { inbox, document } = harness;

      inbox.apply([published(info(1, 'one')), published(info(2, 'two', 'old'))], document);
      inbox.apply([delivered(1, 'C', false, 200), delivered(2, 'C', false, 400)], document);

      const rows = inbox.of('C');
      expect(rows.map(({ message }) => message)).toEqual([2, 1]);
      expect(rows[0]).toMatchObject({
        message: 2,
        queue: 'billing',
        at: 400,
        redelivered: false,
        state: 'on its way',
        info: { payload: 'two', key: 'old', exchange: 'orders' },
      });
      expect(rows[1]?.info?.payload).toBe('one');
    });

    it('is a list for each consumer: what one is given is not what another is given', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), published(info(2))], document);

      inbox.apply([delivered(1, 'C'), delivered(2, 'D')], document);

      expect(inbox.of('C').map(({ message }) => message)).toEqual([1]);
      expect(inbox.of('D').map(({ message }) => message)).toEqual([2]);
      expect(inbox.of('nobody')).toEqual([]);
    });

    it('says nothing of a consumer that is not on the canvas, which the engine may still be talking about', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1))], document);

      inbox.apply([delivered(1, 'GONE')], document);

      expect(inbox.of('GONE')).toEqual([]);
    });

    it('has no payload for a message that was published before it was listening, and still has the row', () => {
      const { inbox, document } = harness;

      inbox.apply([delivered(7)], document);

      expect(inbox.of('C')).toHaveLength(1);
      expect(inbox.of('C')[0]).toMatchObject({ message: 7, info: null });
    });
  });

  describe('where a message is with the consumer', () => {
    it('moves from on its way to received, processed and acknowledged, as the engine says it does', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1)], document);
      const seen = [inbox.of('C')[0]?.state];

      for (const type of ['received', 'processed', 'acked'] as const) {
        inbox.apply([handled(type, 1)], document);
        seen.push(inbox.of('C')[0]?.state);
      }

      expect(seen).toEqual(['on its way', 'received', 'processed', 'acked']);
    });

    it('goes back to requeued when the message was put back in its queue, and the row stays', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1), handled('received', 1), handled('requeued', 1)], document);

      expect(inbox.of('C')).toHaveLength(1);
      expect(inbox.of('C')[0]?.state).toBe('requeued');
    });

    it('moves only the row of the consumer that the engine names, and the latest row of the message', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C'), delivered(1, 'D')], document);

      inbox.apply([handled('acked', 1, 'D')], document);

      expect(inbox.of('C')[0]?.state).toBe('on its way');
      expect(inbox.of('D')[0]?.state).toBe('acked');
    });

    it('is a new row, marked redelivered, when the message is given again, and the earlier row is left as it was', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1), handled('received', 1), handled('requeued', 1)], document);

      inbox.apply([delivered(1, 'C', true, 900), handled('received', 1, 'C', 1_000)], document);

      const rows = inbox.of('C');
      expect(rows.map(({ redelivered, state }) => [redelivered, state])).toEqual([
        [true, 'received'],
        [false, 'requeued'],
      ]);
      expect(rows[0]?.seq).toBeGreaterThan(rows[1]?.seq ?? 0);
    });

    it('does nothing for an event about a message that it has no row for', () => {
      const { inbox, document } = harness;
      const before = inbox.changed();

      inbox.apply([handled('acked', 99), handled('requeued', 99)], document);

      expect(inbox.of('C')).toEqual([]);
      expect(inbox.changed()).toBe(before);
    });
  });

  describe('what it keeps', () => {
    it('keeps the last hundred rows of a consumer, and no more of the older ones, without touching another consumer', () => {
      const { inbox, document } = harness;
      const total = 105;
      for (let id = 1; id <= total; id += 1) {
        inbox.apply([published(info(id, `payload ${id}`)), delivered(id, 'C')], document);
      }
      inbox.apply([published(info(1_000)), delivered(1_000, 'D')], document);

      const rows = inbox.of('C');
      expect(rows).toHaveLength(100);
      expect(rows[0]?.message).toBe(total);
      expect(rows[rows.length - 1]?.message).toBe(6);
      expect(rows[0]?.info?.payload).toBe(`payload ${total}`);
      expect(inbox.of('D')).toHaveLength(1);
    });

    it('keeps what was published for as many messages as the log keeps rows, and forgets the oldest after that', () => {
      const { inbox, document } = harness;
      for (let id = 1; id <= 5_001; id += 1) {
        inbox.apply([published(info(id))], document);
      }

      inbox.apply([delivered(1), delivered(2), delivered(5_001)], document);

      const byMessage = new Map(inbox.of('C').map((row) => [row.message, row.info]));
      expect(byMessage.get(1)).toBeNull();
      expect(byMessage.get(2)).not.toBeNull();
      expect(byMessage.get(5_001)).not.toBeNull();
    });

    it('starts again when a canvas is opened, and does not know the messages of the one before', () => {
      const { inbox, store, document } = harness;
      inbox.apply([published(info(1)), delivered(1)], document);
      expect(inbox.of('C')).toHaveLength(1);

      store.load(canvas());

      expect(inbox.of('C')).toEqual([]);
      inbox.apply([delivered(1)], store.document());
      expect(inbox.of('C')[0]?.info).toBeNull();
    });

    it('drops the rows of a consumer that is deleted, and keeps the rows of the others', () => {
      const { inbox, bus, document } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C'), delivered(1, 'D')], document);

      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'key');

      expect(inbox.of('C')).toEqual([]);
      expect(inbox.of('D')).toHaveLength(1);
    });

    it('goes on with the list of a consumer that was undone after a change that did not delete it', () => {
      const { inbox, bus, document } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C')], document);

      bus.apply({ type: 'declare-queue', name: 'extra', durable: true }, 'key');
      bus.undo('key');

      expect(inbox.of('C')).toHaveLength(1);
    });
  });

  describe('clearing the list of a consumer (ADR-0105)', () => {
    it('empties the list of that consumer and leaves the other consumers and the engine alone', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), published(info(2))], document);
      inbox.apply([delivered(1, 'C'), delivered(2, 'D')], document);

      inbox.clear('C');

      expect(inbox.of('C')).toEqual([]);
      expect(inbox.of('D').map(({ message }) => message)).toEqual([2]);
    });

    it('says that it changed, and says nothing for a list that was empty already', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C')], document);
      const before = inbox.changed();

      inbox.clear('D');
      expect(inbox.changed()).toBe(before);
      inbox.clear('C');
      expect(inbox.changed()).toBe(before + 1);
      inbox.clear('C');
      expect(inbox.changed()).toBe(before + 1);
    });

    it('starts a new list with what the consumer is given afterwards, and does not bring back what the engine says of a row that was cleared', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), published(info(2)), delivered(1, 'C')], document);
      inbox.clear('C');

      inbox.apply([handled('received', 1), handled('acked', 1)], document);
      expect(inbox.of('C')).toEqual([]);
      inbox.apply([delivered(2, 'C')], document);

      expect(inbox.of('C').map(({ message, state }) => [message, state])).toEqual([[2, 'on its way']]);
      expect(inbox.of('C')[0]?.info?.payload).toBe('hello');
    });

    it('is the view only: the document is the one that it was, and nothing is put on the undo stack', () => {
      const { inbox, document, store } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C')], document);

      inbox.clear('C');

      expect(store.document()).toBe(document);
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('what "Clear messages" took out of the simulation (ADR-0105)', () => {
    it('marks the rows that the consumer had not finished with as cleared, and leaves the finished ones as they were', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), published(info(2)), published(info(3)), published(info(4))], document);
      inbox.apply([delivered(1, 'C'), delivered(2, 'C'), delivered(3, 'D'), delivered(4, 'C')], document);
      inbox.apply([handled('received', 1), handled('processed', 1), handled('acked', 1)], document);
      inbox.apply([handled('received', 2)], document);
      inbox.apply([handled('requeued', 4)], document);

      inbox.apply([{ seq: 1, at: 900, type: 'cleared', travelling: 1, ready: 0, unacked: 1, buffered: 0 }], document);

      expect(inbox.of('C').map(({ message, state }) => [message, state])).toEqual([
        [4, 'requeued'],
        [2, 'cleared'],
        [1, 'acked'],
      ]);
      expect(inbox.of('D').map(({ message, state }) => [message, state])).toEqual([[3, 'cleared']]);
    });

    it('says that it changed only when a row was marked', () => {
      const { inbox, document } = harness;
      inbox.apply([published(info(1)), delivered(1, 'C'), handled('acked', 1)], document);
      const before = inbox.changed();

      inbox.apply([{ seq: 1, at: 900, type: 'cleared', travelling: 0, ready: 3, unacked: 0, buffered: 0 }], document);
      expect(inbox.changed()).toBe(before);

      inbox.apply([published(info(2)), delivered(2, 'C')], document);
      const added = inbox.changed();
      inbox.apply([{ seq: 1, at: 900, type: 'cleared', travelling: 1, ready: 0, unacked: 0, buffered: 0 }], document);
      expect(inbox.changed()).toBe(added + 1);
    });

    it('marks them when the simulation is asked to clear its messages', () => {
      const { inbox, bus } = harness;
      bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new', payload: 'Hello' }, 'toolbar');
      for (let step = 0; step < 40 && inbox.of('C').length === 0; step += 1) {
        bus.run({ type: 'step' }, 'toolbar');
      }
      expect(inbox.of('C')[0]?.state).toBe('on its way');

      bus.run({ type: 'clear-messages' }, 'toolbar');

      expect(inbox.of('C').map(({ state }) => state)).toEqual(['cleared']);
    });
  });

  describe('changing', () => {
    it('says that it changed when a row was added or moved on, once for each turn, and not for what only publishes', () => {
      const { inbox, document } = harness;
      const first = inbox.changed();

      inbox.apply([published(info(1))], document);
      expect(inbox.changed()).toBe(first);

      inbox.apply([delivered(1), handled('received', 1), handled('processed', 1)], document);
      expect(inbox.changed()).toBe(first + 1);
    });
  });

  describe('listening to the engine', () => {
    it('has a row, with the payload that was typed, that goes from on its way to acknowledged as the simulation runs', () => {
      const { inbox, bus } = harness;
      bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new', payload: 'Hello' }, 'toolbar');
      const seen: string[] = [];

      for (let step = 0; step < 40; step += 1) {
        bus.run({ type: 'step' }, 'toolbar');
        const state = inbox.of('C')[0]?.state;
        if (state !== undefined && seen[seen.length - 1] !== state) {
          seen.push(state);
        }
      }

      // The engine says that it was processed and acknowledged in one turn, so a look after each step sees the second of them.
      expect(seen[0]).toBe('on its way');
      expect(seen).toContain('received');
      expect(seen[seen.length - 1]).toBe('acked');
      expect(inbox.of('C')[0]).toMatchObject({
        message: 1,
        queue: 'billing',
        info: { payload: 'Hello', key: 'new', exchange: 'orders' },
      });
    });
  });
});
