import { describe, expect, it } from 'vitest';
import { exchangeDifference, queueDifference, type ExchangeAttributes } from './declaration';

const base: ExchangeAttributes = { type: 'direct', durable: true, autoDelete: false, internal: false };

describe('exchangeDifference', () => {
  it('finds nothing when the declaration says the same', () => {
    expect(exchangeDifference(base, { ...base })).toBeNull();
  });

  it.each([
    ['type', { type: 'topic' as const }, 'topic', 'direct'],
    ['durable', { durable: false }, 'false', 'true'],
    ['auto_delete', { autoDelete: true }, 'true', 'false'],
    ['internal', { internal: true }, 'true', 'false'],
  ])(
    'names %s when only it differs, with what was received and what is there',
    (attribute, change, received, current) => {
      expect(exchangeDifference(base, { ...base, ...change })).toEqual({ attribute, received, current });
    },
  );

  it('names the first of the four when several differ: the type, then durable, then auto_delete, then internal', () => {
    const all = { type: 'fanout' as const, durable: false, autoDelete: true, internal: true };

    expect(exchangeDifference(base, all)?.attribute).toBe('type');
    expect(exchangeDifference(base, { ...all, type: 'direct' })?.attribute).toBe('durable');
    expect(exchangeDifference(base, { ...all, type: 'direct', durable: true })?.attribute).toBe('auto_delete');
    expect(exchangeDifference(base, { ...all, type: 'direct', durable: true, autoDelete: false })?.attribute).toBe(
      'internal',
    );
  });

  it('writes the values from the side of the exchange that has them: a flag that is on and one that is off', () => {
    expect(exchangeDifference({ ...base, autoDelete: true }, base)).toEqual({
      attribute: 'auto_delete',
      received: 'false',
      current: 'true',
    });
  });
});

describe('queueDifference', () => {
  it('finds nothing for a queue that is declared again as durable, and names durable when it is not', () => {
    expect(queueDifference({ durable: true }, { durable: true })).toBeNull();
    expect(queueDifference({ durable: true }, { durable: false })).toEqual({
      attribute: 'durable',
      received: 'false',
      current: 'true',
    });
  });
});
