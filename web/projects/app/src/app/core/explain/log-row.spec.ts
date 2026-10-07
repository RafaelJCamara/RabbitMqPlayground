import type { EngineEvent, MessageInfo } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import type { Names } from '../runtime/sentences';
import { FAMILIES, FAMILY_IDS, familyOf, infoOf } from './families';
import { draftOfEvent, draftOfLine, isFiltering, matchesFilter, NO_FILTER, nodeKey, type LogRow } from './log-row';
import { logSentence } from './log-text';

const names: Names = {
  producer: (id) => (id === null ? null : id === 'P' ? 'sender' : id),
  consumer: (channel) => (channel === 'C' ? 'worker' : channel),
};

const at = { seq: 1, at: 500 };
const info: MessageInfo = {
  id: 3,
  producer: 'P',
  exchange: 'orders',
  key: 'order.created',
  headers: [],
  payload: 'hi',
};

/** One event of every type, so that a spec that says what each is about cannot leave one out. */
const EVENTS: Record<EngineEvent['type'], EngineEvent> = {
  published: { ...at, type: 'published', message: info, arrivesAt: 1000 },
  routed: {
    ...at,
    type: 'routed',
    message: 3,
    exchange: 'orders',
    queues: ['billing', 'audit'],
    paths: [],
    trace: { exchange: 'orders', visits: [] },
    enqueueAt: 800,
  },
  unroutable: { ...at, type: 'unroutable', message: 3, exchange: 'orders', trace: { exchange: 'orders', visits: [] } },
  refused: {
    ...at,
    type: 'refused',
    message: 3,
    exchange: 'nope',
    code: 404,
    text: "NOT_FOUND - no exchange 'nope' in vhost '/'",
  },
  enqueued: { ...at, type: 'enqueued', message: 3, queue: 'billing', depth: 2 },
  dropped: { ...at, type: 'dropped', message: 3, queue: 'billing' },
  delivered: {
    ...at,
    type: 'delivered',
    message: 3,
    queue: 'billing',
    consumer: 'C/billing',
    channel: 'C',
    redelivered: false,
    autoAck: false,
    arrivesAt: 700,
  },
  received: { ...at, type: 'received', message: 3, queue: 'billing', consumer: 'C/billing', channel: 'C' },
  processed: { ...at, type: 'processed', message: 3, queue: 'billing', consumer: 'C/billing', channel: 'C' },
  acked: { ...at, type: 'acked', message: 3, queue: 'billing', consumer: 'C/billing', channel: 'C' },
  requeued: { ...at, type: 'requeued', message: 3, queue: 'billing', consumer: 'C/billing', channel: 'C' },
  'consumer.cancelled': {
    ...at,
    type: 'consumer.cancelled',
    consumer: 'C/billing',
    channel: 'C',
    queue: 'billing',
    reason: 'cancelled',
  },
  'channel.closed': { ...at, type: 'channel.closed', channel: 'C', reason: { kind: 'closed' }, requeued: 2 },
  'queue.purged': { ...at, type: 'queue.purged', queue: 'billing', count: 4 },
  'queue.deleted': { ...at, type: 'queue.deleted', queue: 'billing', ready: 1, unacked: 2 },
  cleared: { ...at, type: 'cleared', travelling: 1, ready: 2, unacked: 3, buffered: 0 },
  'counters.reset': { ...at, type: 'counters.reset' },
};

describe('the families of the log (ADR-0061)', () => {
  it('are eight, each with a colour that a token holds, a mark of its own and a label', () => {
    expect(FAMILY_IDS).toEqual([
      'commands',
      'publishing',
      'routing',
      'problems',
      'queues',
      'delivery',
      'consumers',
      'simulation',
    ]);
    expect(new Set(FAMILIES.map(({ icon }) => icon)).size).toBeGreaterThanOrEqual(7);
    for (const family of FAMILIES) {
      expect(family.token).toMatch(/^--rmq-[a-z-]+$/);
      expect(family.label).not.toBe('');
      expect(infoOf(family.id)).toBe(family);
    }
  });

  it('give every event a family, and the events of a problem are the ones that went wrong', () => {
    for (const type of Object.keys(EVENTS) as EngineEvent['type'][]) {
      expect(FAMILY_IDS).toContain(familyOf(type));
    }
    expect(['unroutable', 'refused', 'dropped'].map((type) => familyOf(type as EngineEvent['type']))).toEqual([
      'problems',
      'problems',
      'problems',
    ]);
    expect(familyOf('published')).toBe('publishing');
    expect(familyOf('routed')).toBe('routing');
    expect(familyOf('enqueued')).toBe('queues');
    expect(familyOf('queue.purged')).toBe('queues');
    expect(familyOf('queue.deleted')).toBe('queues');
    expect(
      ['delivered', 'received', 'processed', 'acked', 'requeued'].map((type) => familyOf(type as EngineEvent['type'])),
    ).toEqual(Array(5).fill('delivery'));
    expect(familyOf('consumer.cancelled')).toBe('consumers');
    expect(familyOf('channel.closed')).toBe('consumers');
    expect(familyOf('cleared')).toBe('simulation');
    expect(familyOf('counters.reset')).toBe('simulation');
  });
});

describe('the sentence of an event in the log (ADR-0061)', () => {
  it.each<[EngineEvent['type'], string]>([
    ['published', 'Sender published message 3 to orders with key "order.created"'],
    ['routed', 'Orders routed message 3 to billing and audit'],
    ['unroutable', 'Message 3 reached orders and found no queue to go to'],
    ['refused', "Message 3 was refused at nope (404 NOT_FOUND - no exchange 'nope' in vhost '/')"],
    ['enqueued', 'Message 3 is in billing, which has 2 ready'],
    ['dropped', 'Message 3 was dropped, because billing is gone'],
    ['delivered', 'Billing gave message 3 to worker'],
    ['received', 'Worker received message 3'],
    ['processed', 'Worker finished message 3'],
    ['acked', 'Worker acknowledged message 3'],
    ['requeued', 'Message 3 went back to billing'],
    ['consumer.cancelled', 'Worker stopped consuming from billing'],
    ['channel.closed', 'Worker was closed, and 2 messages went back to their queues'],
    ['queue.purged', '4 messages were purged from billing'],
    ['queue.deleted', 'Billing was deleted with 3 messages in it'],
    ['cleared', 'The messages were cleared'],
    ['counters.reset', 'The counters were reset'],
  ])('says %s', (type, text) => {
    expect(logSentence(EVENTS[type], names)).toBe(text);
  });

  it('says that a message that no producer sent was published by you, with no key and to the default exchange', () => {
    const event: EngineEvent = {
      ...at,
      type: 'published',
      message: { ...info, producer: null, exchange: '', key: '' },
      arrivesAt: 1000,
    };

    expect(logSentence(event, names)).toBe('You published message 3 to the default exchange with no key');
    expect(logSentence({ ...EVENTS.routed, exchange: '' } as EngineEvent, names)).toBe(
      'The default exchange routed message 3 to billing and audit',
    );
  });

  it('says a single queue, and a message that is given again, as the step does', () => {
    expect(logSentence({ ...EVENTS.routed, queues: ['billing'] } as EngineEvent, names)).toBe(
      'Orders routed message 3 to billing',
    );
    expect(logSentence({ ...EVENTS.routed, queues: ['a', 'b', 'c'] } as EngineEvent, names)).toBe(
      'Orders routed message 3 to a, b and c',
    );
    expect(logSentence({ ...EVENTS.delivered, redelivered: true } as EngineEvent, names)).toBe(
      'Billing gave message 3 to worker again',
    );
  });
});

describe('the row of an event (ADR-0061)', () => {
  const draft = (type: EngineEvent['type']) => draftOfEvent(EVENTS[type], names);

  it('has the time, the family, the name of the event, the sentence, and the message that it is about', () => {
    expect(draft('routed')).toMatchObject({
      at: 500,
      family: 'routing',
      kind: 'routed',
      text: 'Orders routed message 3 to billing and audit',
      message: 3,
    });
  });

  it('names the nodes that it concerns: the producer and the exchange of a publish, the exchange and the queues of a routing', () => {
    expect(draft('published').nodes).toEqual(['producer:P', 'exchange:orders']);
    expect(draft('routed').nodes).toEqual(['exchange:orders', 'queue:billing', 'queue:audit']);
    expect(draft('unroutable').nodes).toEqual(['exchange:orders']);
    expect(draft('refused').nodes).toEqual(['exchange:nope']);
    expect(draft('enqueued').nodes).toEqual(['queue:billing']);
    expect(draft('dropped').nodes).toEqual(['queue:billing']);
    expect(draft('delivered').nodes).toEqual(['queue:billing', 'consumer:C']);
    expect(draft('acked').nodes).toEqual(['queue:billing', 'consumer:C']);
    expect(draft('consumer.cancelled').nodes).toEqual(['queue:billing', 'consumer:C']);
    expect(draft('channel.closed').nodes).toEqual(['consumer:C']);
    expect(draft('queue.purged').nodes).toEqual(['queue:billing']);
    expect(draft('queue.deleted').nodes).toEqual(['queue:billing']);
    expect(draft('cleared').nodes).toEqual([]);
    expect(draft('counters.reset').nodes).toEqual([]);
  });

  it('leaves out the default exchange, which is not a node of the canvas, and a producer that no producer sent', () => {
    const event: EngineEvent = {
      ...at,
      type: 'published',
      message: { ...info, producer: null, exchange: '' },
      arrivesAt: 1000,
    };

    expect(draftOfEvent(event, names).nodes).toEqual([]);
    expect(draftOfEvent({ ...EVENTS.routed, exchange: '' } as EngineEvent, names).nodes).toEqual([
      'queue:billing',
      'queue:audit',
    ]);
  });

  it('says what choosing it lights: the producer, the route of a message, a copy in a queue, a subscription, or nodes', () => {
    expect(draft('published').subject).toEqual({ kind: 'publish', message: 3 });
    expect(draft('routed').subject).toEqual({ kind: 'route', message: 3 });
    expect(draft('unroutable').subject).toEqual({ kind: 'route', message: 3 });
    expect(draft('refused').subject).toEqual({ kind: 'route', message: 3 });
    expect(draft('enqueued').subject).toEqual({ kind: 'copy', message: 3, queue: 'billing' });
    expect(draft('dropped').subject).toEqual({ kind: 'copy', message: 3, queue: 'billing' });
    for (const type of ['delivered', 'received', 'processed', 'acked', 'requeued', 'consumer.cancelled'] as const) {
      expect(draft(type).subject, type).toEqual({ kind: 'delivery', queue: 'billing', channel: 'C' });
    }
    expect(draft('channel.closed').subject).toEqual({ kind: 'nodes', queues: [], channels: ['C'] });
    expect(draft('queue.purged').subject).toEqual({ kind: 'nodes', queues: ['billing'], channels: [] });
    expect(draft('queue.deleted').subject).toEqual({ kind: 'nodes', queues: ['billing'], channels: [] });
    expect(draft('cleared').subject).toBeNull();
    expect(draft('counters.reset').subject).toBeNull();
  });

  it('is about no message when it is about a queue, a consumer or the simulation', () => {
    for (const type of [
      'consumer.cancelled',
      'channel.closed',
      'queue.purged',
      'queue.deleted',
      'cleared',
      'counters.reset',
    ] as const) {
      expect(draft(type).message, type).toBeNull();
    }
    for (const type of [
      'published',
      'routed',
      'unroutable',
      'refused',
      'enqueued',
      'dropped',
      'delivered',
      'received',
      'processed',
      'acked',
      'requeued',
    ] as const) {
      expect(draft(type).message, type).toBe(3);
    }
  });

  it('makes the row of every kind of event, so that none is left out', () => {
    for (const event of Object.values(EVENTS)) {
      const row = draftOfEvent(event, names);

      expect(row.kind).toBe(event.type);
      expect(row.text.length).toBeGreaterThan(0);
      expect(row.text.charAt(0)).toBe(row.text.charAt(0).toUpperCase());
    }
  });
});

describe('the row of a line of the log of commands', () => {
  it('has the command as the learner would type it, what they used, the time of the clock, and no message or node', () => {
    expect(draftOfLine({ id: 7, origin: 'typed', text: 'publish sender' }, 1500)).toEqual({
      at: 1500,
      family: 'commands',
      kind: 'command',
      text: 'publish sender',
      message: null,
      nodes: [],
      subject: null,
      origin: 'typed',
    });
  });
});

describe('the filter of the log (ADR-0061)', () => {
  const row = (changes: Partial<LogRow> = {}): LogRow => ({
    ...draftOfEvent(EVENTS.routed, names),
    seq: 12,
    ...changes,
  });

  it('shows every row when it is left as it begins, and says that it is not filtering', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    for (const event of Object.values(EVENTS)) {
      expect(matchesFilter({ ...draftOfEvent(event, names), seq: 1 }, NO_FILTER)).toBe(true);
    }
    expect(matchesFilter({ ...draftOfLine({ id: 1, origin: 'key', text: 'step' }, 0), seq: 2 }, NO_FILTER)).toBe(true);
  });

  it('shows the rows of the families that are on, and none of the others', () => {
    const only = (...families: LogRow['family'][]) => ({ ...NO_FILTER, families: new Set(families) });

    expect(matchesFilter(row(), only('routing'))).toBe(true);
    expect(matchesFilter(row(), only('delivery', 'queues'))).toBe(false);
    expect(matchesFilter(row(), only())).toBe(false);
    expect(isFiltering(only('routing'))).toBe(true);
  });

  it('shows the rows that concern a node, which is a key, and the rows of any node when none is chosen', () => {
    const node = (key: string | null) => ({ ...NO_FILTER, node: key });

    expect(matchesFilter(row(), node(nodeKey('queue', 'billing')))).toBe(true);
    expect(matchesFilter(row(), node(nodeKey('queue', 'other')))).toBe(false);
    expect(matchesFilter(row(), node(nodeKey('exchange', 'billing')))).toBe(false);
    expect(matchesFilter(row(), node(null))).toBe(true);
    expect(isFiltering(node(nodeKey('queue', 'billing')))).toBe(true);
  });

  it('shows the rows of a message by its number, and the rows that are about none are not of any', () => {
    const message = (number: number | null) => ({ ...NO_FILTER, message: number });

    expect(matchesFilter(row(), message(3))).toBe(true);
    expect(matchesFilter(row(), message(4))).toBe(false);
    expect(matchesFilter(row({ message: null }), message(3))).toBe(false);
    expect(matchesFilter(row({ message: null }), message(null))).toBe(true);
    expect(isFiltering(message(0))).toBe(true);
  });

  it('shows the rows that have the text in their sentence, in any case, and ignores the spaces around it', () => {
    const text = (value: string) => ({ ...NO_FILTER, text: value });

    expect(matchesFilter(row(), text('ROUTED'))).toBe(true);
    expect(matchesFilter(row(), text('  billing and audit '))).toBe(true);
    expect(matchesFilter(row(), text('delivered'))).toBe(false);
    expect(matchesFilter(row(), text('   '))).toBe(true);
    expect(isFiltering(text('x'))).toBe(true);
    expect(isFiltering(text('  '))).toBe(false);
  });

  it('shows what all four say at once: a row that fails one is not shown', () => {
    const filter = {
      families: new Set(['routing' as const]),
      node: nodeKey('queue', 'audit'),
      message: 3,
      text: 'routed',
    };

    expect(matchesFilter(row(), filter)).toBe(true);
    expect(matchesFilter(row(), { ...filter, families: new Set(['queues' as const]) })).toBe(false);
    expect(matchesFilter(row(), { ...filter, node: nodeKey('queue', 'none') })).toBe(false);
    expect(matchesFilter(row(), { ...filter, message: 9 })).toBe(false);
    expect(matchesFilter(row(), { ...filter, text: 'other' })).toBe(false);
  });
});
