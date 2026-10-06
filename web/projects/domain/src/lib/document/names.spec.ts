import { defaultExchangeReply, reservedNameReply, utf8Length } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { ELEMENT_KINDS } from './issue';
import { hasReservedPrefix, KIND_LABEL, NAME_MAX_BYTES, nameIssue } from './names';

describe('nameIssue', () => {
  it('is 255 bytes, which is what AMQP can write in a short string (ADR-0021)', () => {
    expect(NAME_MAX_BYTES).toBe(255);
  });

  describe('accepts', () => {
    it.each([
      'orders',
      'order-events',
      'a.b.c',
      'a b',
      'Ünïcode',
      '日本語',
      'amq',
      'AMQ.upper',
      'amqp.x',
      'x.amq.y',
      '#',
      '*',
    ])('%j, as the name of any kind', (name) => {
      for (const kind of ELEMENT_KINDS) {
        expect(nameIssue(kind, name), `${kind} ${name}`).toBeNull();
      }
    });

    it('a name of 255 bytes, which can be fewer than 255 characters', () => {
      for (const kind of ELEMENT_KINDS) {
        expect(nameIssue(kind, 'a'.repeat(255))).toBeNull();
        expect(nameIssue(kind, `${'é'.repeat(127)}a`)).toBeNull();
      }
    });
  });

  describe('refuses', () => {
    it('a name of more than 255 bytes, counted in bytes and not in characters, and says how long it is', () => {
      for (const kind of ELEMENT_KINDS) {
        const bytes = `${'é'.repeat(128)}`;

        expect(utf8Length(bytes)).toBe(256);
        expect(nameIssue(kind, bytes)).toMatchObject({ kind: 'name-too-long' });
        expect(nameIssue(kind, bytes)?.message).toContain('this one is 256');
        expect(nameIssue(kind, 'a'.repeat(256))?.kind).toBe('name-too-long');
      }
    });

    it('a name that is too long with no reply of the broker, because no client can send it', () => {
      expect(nameIssue('queue', 'a'.repeat(300))?.refusal).toBeUndefined();
    });

    it('the empty name of an exchange, which is the default exchange, with the 403 that the broker gave', () => {
      const issue = nameIssue('exchange', '');

      expect(issue).toMatchObject({ kind: 'default-exchange', refusal: defaultExchangeReply() });
      expect(issue?.refusal).toEqual({
        code: 403,
        text: 'ACCESS_REFUSED - operation not permitted on the default exchange',
      });
      expect(issue?.message).toContain('default exchange');
      expect(issue?.message).toContain('built in');
    });

    it('the empty name of anything else, as a name that is missing', () => {
      expect(nameIssue('queue', '')).toEqual({ kind: 'empty-name', message: 'A queue needs a name.' });
      expect(nameIssue('producer', '')?.message).toBe('A producer needs a name.');
      expect(nameIssue('consumer', '')?.message).toBe('A consumer needs a name.');
    });

    it.each(['amq.mine', 'amq.', 'amq.gen-abc', 'amq.direct'])(
      'the name %j of an exchange or a queue, with the 403 that the broker gave',
      (name) => {
        expect(nameIssue('exchange', name)).toMatchObject({
          kind: 'reserved-name',
          refusal: reservedNameReply('exchange', name),
        });
        expect(nameIssue('queue', name)).toMatchObject({
          kind: 'reserved-name',
          refusal: reservedNameReply('queue', name),
        });
      },
    );

    it('says what the prefix is for and what to do, in its message', () => {
      const issue = nameIssue('queue', 'amq.mine');

      expect(issue?.message).toBe(
        "'amq.mine' starts with 'amq.', which RabbitMQ keeps for its own exchanges and queues. Choose a name that does not start with 'amq.'.",
      );
      expect(issue?.refusal?.text).toBe("ACCESS_REFUSED - queue name 'amq.mine' contains reserved prefix 'amq.*'");
    });

    it('checks the length before the prefix, because a client that cannot send the name never gets a reply', () => {
      expect(nameIssue('exchange', `amq.${'a'.repeat(300)}`)?.kind).toBe('name-too-long');
    });
  });

  describe('leaves the prefix alone', () => {
    it('for a producer and a consumer, which are not the broker’s', () => {
      expect(nameIssue('producer', 'amq.sender')).toBeNull();
      expect(nameIssue('consumer', 'amq.worker')).toBeNull();
    });

    it('for a queue that the broker named itself, which is how it makes `amq.gen-…`', () => {
      expect(nameIssue('queue', 'amq.gen-x', { serverNamed: true })).toBeNull();
      expect(nameIssue('queue', 'amq.gen-x', { serverNamed: false })?.kind).toBe('reserved-name');
      expect(nameIssue('queue', 'amq.gen-x', {})?.kind).toBe('reserved-name');
    });

    it('but not for an exchange, which a client always names', () => {
      expect(nameIssue('exchange', 'amq.gen-x', { serverNamed: true })?.kind).toBe('reserved-name');
    });

    it('and not for the length, which a server-named queue has too', () => {
      expect(nameIssue('queue', `amq.${'a'.repeat(300)}`, { serverNamed: true })?.kind).toBe('name-too-long');
    });
  });
});

describe('hasReservedPrefix', () => {
  it.each<[string, boolean]>([
    ['amq.x', true],
    ['amq.', true],
    ['amq', false],
    ['AMQ.x', false],
    ['amqp.x', false],
    ['xamq.x', false],
    [' amq.x', false],
    ['', false],
  ])('says that %j is %s', (name, reserved) => {
    expect(hasReservedPrefix(name)).toBe(reserved);
  });
});

describe('KIND_LABEL', () => {
  it('names each kind in a sentence', () => {
    expect(KIND_LABEL).toEqual({ exchange: 'exchange', queue: 'queue', producer: 'producer', consumer: 'consumer' });
  });
});
