import { COLUMN_X, emptyDocument, ROW_HEIGHT } from '@rmq/domain';
import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCHANGE_ID,
  defaultExchangePosition,
  implicitEdgeId,
  implicitEdgeKeys,
  isVirtual,
} from './default-exchange';

describe('the ids of the default exchange (ADR-0043)', () => {
  it('start with a tilde, which no id of a document does, and an implicit edge is the key of the exchange and the queue', () => {
    expect(DEFAULT_EXCHANGE_ID).toBe('~default');
    expect(implicitEdgeId('q1')).toBe('~default>q1');
    expect(isVirtual('~default')).toBe(true);
    expect(isVirtual('~default>q1')).toBe(true);
  });

  it('are the only ids that are virtual: a tilde anywhere else, or an id of a document, is not', () => {
    for (const id of ['x1', 'q1', 'p1', 'c1', 'x1>q1', 'a~', 'a~b', '']) {
      expect(isVirtual(id), `"${id}"`).toBe(false);
    }
  });
});

describe('defaultExchangePosition', () => {
  const orders = exchangeRecord('orders', 'direct');
  const events = exchangeRecord('events', 'topic');

  it('is in the column of the exchanges, a row above the highest exchange, and not above the others', () => {
    const document = documentOf({
      exchanges: { x1: orders, x2: events },
      nodes: { x1: { x: 0, y: 300 }, x2: { x: 0, y: 120 } },
    });

    expect(defaultExchangePosition(document)).toEqual({ x: COLUMN_X.exchange, y: 120 - ROW_HEIGHT });
    expect(defaultExchangePosition({ ...document, exchanges: { x1: orders } })).toEqual({
      x: COLUMN_X.exchange,
      y: 300 - ROW_HEIGHT,
    });
  });

  it('is a row above the top, where the first exchange would go, when there is no exchange', () => {
    expect(defaultExchangePosition(documentOf())).toEqual({ x: COLUMN_X.exchange, y: -ROW_HEIGHT });
    expect(defaultExchangePosition(documentOf({ queues: { q1: queueRecord('billing') } }))).toEqual({
      x: COLUMN_X.exchange,
      y: -ROW_HEIGHT,
    });
  });

  it('counts an exchange that has no place in the layout as at the top', () => {
    const document = documentOf({ exchanges: { x1: orders, x2: events }, nodes: { x2: { x: 0, y: 50 } } });

    expect(defaultExchangePosition(document)).toEqual({ x: COLUMN_X.exchange, y: -ROW_HEIGHT });
  });
});

describe('implicitEdgeKeys', () => {
  const queues = { q1: queueRecord('billing'), q2: queueRecord('archive') };

  it('is the edge of every queue while the default exchange is shown, and nothing while it is not', () => {
    const hidden = documentOf({ queues });
    const shown = { ...hidden, settings: { ...hidden.settings, showDefaultExchange: true } };

    expect([...implicitEdgeKeys(shown)]).toEqual(['~default>q1', '~default>q2']);
    expect(implicitEdgeKeys(hidden).size).toBe(0);
    expect(implicitEdgeKeys({ ...emptyDocument(), settings: shown.settings }).size).toBe(0);
  });
});
