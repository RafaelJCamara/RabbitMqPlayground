import { deepFreeze, sampleDocument, sequentialIds } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands/apply';
import { elements } from './document/elements';
import type { CanvasDocument } from './document/schema';
import { allowedTargets, explainLink, linkCommand, linkRules, linkVerdict } from './link-rules';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
// E1 orders (topic), E2 docs (headers), E3 hidden (fanout, internal), Q1 billing, Q2 archive, P1 sender, C1 worker.

describe('linkVerdict', () => {
  describe('from a producer', () => {
    it('allows an ordinary exchange, as a publish target', () => {
      expect(linkVerdict(sample(), 'P1', 'E1')).toEqual({
        ok: true,
        command: 'link',
        summary: "Publishes from producer 'sender' to exchange 'orders'.",
      });
    });

    it('allows a queue, which is a publish through the default exchange', () => {
      expect(linkVerdict(sample(), 'P1', 'Q1')).toEqual({
        ok: true,
        command: 'link',
        summary: "Publishes from producer 'sender' to queue 'billing', through the default exchange.",
      });
    });

    it('refuses an internal exchange, and says why', () => {
      expect(linkVerdict(sample(), 'P1', 'E3')).toEqual({
        ok: false,
        reason:
          "A client cannot publish to exchange 'hidden', because it is internal. Producers publish to ordinary exchanges, or to a queue.",
      });
    });

    it('refuses another producer and a consumer', () => {
      expect(linkVerdict(sample(), 'P1', 'C1')).toEqual({
        ok: false,
        reason: "A producer publishes to an exchange or to a queue, and consumer 'worker' is a consumer.",
      });
      expect(linkVerdict(sample(), 'P1', 'P1')).toMatchObject({ ok: false });
    });
  });

  describe('from an exchange', () => {
    it('allows a queue, and another exchange, as a binding', () => {
      expect(linkVerdict(sample(), 'E1', 'Q2')).toEqual({
        ok: true,
        command: 'bind',
        summary: "Binds exchange 'orders' to queue 'archive'.",
      });
      expect(linkVerdict(sample(), 'E1', 'E2')).toEqual({
        ok: true,
        command: 'bind',
        summary: "Binds exchange 'orders' to exchange 'docs'.",
      });
    });

    it('allows an internal exchange as the destination of a binding, which is how an internal exchange is reached', () => {
      expect(linkVerdict(sample(), 'E1', 'E3')).toMatchObject({ ok: true, command: 'bind' });
    });

    it('allows itself, which a broker accepts', () => {
      expect(linkVerdict(sample(), 'E1', 'E1')).toMatchObject({
        ok: true,
        command: 'bind',
        summary: "Binds exchange 'orders' to exchange 'orders'.",
      });
    });

    it('refuses a consumer, in the words of ADR-0011, and a producer', () => {
      expect(linkVerdict(sample(), 'E1', 'C1')).toEqual({
        ok: false,
        reason:
          'Consumers subscribe to queues, not exchanges. Bind the exchange to a queue, and subscribe the consumer to it.',
      });
      expect(linkVerdict(sample(), 'E1', 'P1')).toEqual({
        ok: false,
        reason: 'Nothing is bound to a producer: a producer publishes, and does not receive.',
      });
    });
  });

  describe('from a queue', () => {
    it('allows a consumer, as a subscription, which a consumer may have to several queues', () => {
      expect(linkVerdict(sample(), 'Q2', 'C1')).toEqual({
        ok: true,
        command: 'subscribe',
        summary: "Makes consumer 'worker' consume from queue 'archive'.",
      });
      expect(linkVerdict(sample(), 'Q1', 'C1')).toMatchObject({ ok: true });
    });

    it('refuses everything else, and says what a queue is for', () => {
      for (const target of ['E1', 'Q2', 'Q1', 'P1']) {
        const verdict = linkVerdict(sample(), 'Q1', target);

        expect(verdict.ok, target).toBe(false);
        expect(!verdict.ok && verdict.reason, target).toContain(
          'A queue is filled by the exchanges that are bound to it, and emptied by consumers.',
        );
      }
      expect(linkVerdict(sample(), 'Q1', 'E1')).toMatchObject({
        reason: expect.stringContaining('It is not linked to an exchange.'),
      });
      expect(linkVerdict(sample(), 'Q1', 'Q2')).toMatchObject({
        reason: expect.stringContaining('It is not linked to a queue.'),
      });
      expect(linkVerdict(sample(), 'Q1', 'P1')).toMatchObject({
        reason: expect.stringContaining('It is not linked to a producer.'),
      });
    });
  });

  describe('from a consumer', () => {
    it('refuses everything, because a message ends there', () => {
      for (const target of ['E1', 'Q1', 'P1', 'C1']) {
        expect(linkVerdict(sample(), 'C1', target)).toEqual({
          ok: false,
          reason: 'A consumer is where a message ends: it takes messages from queues, and nothing is linked from it.',
        });
      }
    });
  });

  it('says that there is nothing there when an id is not on the canvas, at either end', () => {
    const none = { ok: false, reason: 'There is nothing on the canvas with that id.' };

    expect(linkVerdict(sample(), 'nope', 'E1')).toEqual(none);
    expect(linkVerdict(sample(), 'E1', 'nope')).toEqual(none);
    expect(linkVerdict(sample(), 'toString', 'E1')).toEqual(none);
  });
});

describe('allowedTargets', () => {
  it('lists the nodes that a node may be linked to, in the order the canvas lists them', () => {
    expect(allowedTargets(sample(), 'P1')).toEqual(['E1', 'E2', 'Q1', 'Q2']);
    expect(allowedTargets(sample(), 'E1')).toEqual(['E1', 'E2', 'E3', 'Q1', 'Q2']);
    expect(allowedTargets(sample(), 'Q1')).toEqual(['C1']);
    expect(allowedTargets(sample(), 'C1')).toEqual([]);
  });

  it('lists nothing for a node that is not there', () => {
    expect(allowedTargets(sample(), 'nope')).toEqual([]);
  });

  it('is exactly the nodes that the verdict allows', () => {
    const document = sample();
    for (const { id: source } of elements(document)) {
      const allowed = new Set(allowedTargets(document, source));
      for (const { id: target } of elements(document)) {
        expect(allowed.has(target), `${source} to ${target}`).toBe(linkVerdict(document, source, target).ok);
      }
    }
  });
});

describe('explainLink', () => {
  it('says what a link would do, or why it cannot be made', () => {
    expect(explainLink(sample(), 'E1', 'Q1')).toBe("Binds exchange 'orders' to queue 'billing'.");
    expect(explainLink(sample(), 'E1', 'C1')).toBe(
      'Consumers subscribe to queues, not exchanges. Bind the exchange to a queue, and subscribe the consumer to it.',
    );
  });
});

describe('linkRules', () => {
  it('is the two questions that the editor asks, answered for one document', () => {
    const rules = linkRules(sample());

    expect(rules.allowedTargets('Q1')).toEqual(['C1']);
    expect(rules.explain('P1', 'E3')).toContain('internal');
  });
});

describe('linkCommand', () => {
  it('makes a binding with an empty key for an exchange and a queue, and for two exchanges', () => {
    expect(linkCommand(sample(), 'E1', 'Q2')).toEqual({
      ok: true,
      value: { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'archive' }, key: '' },
    });
    expect(linkCommand(sample(), 'E2', 'E3')).toEqual({
      ok: true,
      value: { type: 'bind', source: 'docs', destination: { kind: 'exchange', name: 'hidden' }, key: '' },
    });
  });

  it('makes a link for a producer, to an exchange and to a queue', () => {
    expect(linkCommand(sample(), 'P1', 'E2')).toEqual({
      ok: true,
      value: { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'docs' } },
    });
    expect(linkCommand(sample(), 'P1', 'Q2')).toEqual({
      ok: true,
      value: { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'archive' } },
    });
  });

  it('makes a subscription for a queue and a consumer, which goes from the queue to the consumer', () => {
    expect(linkCommand(sample(), 'Q2', 'C1')).toEqual({
      ok: true,
      value: { type: 'subscribe', consumer: 'worker', queue: 'archive' },
    });
  });

  it('says why for a link that cannot be made, as an issue', () => {
    expect(linkCommand(sample(), 'C1', 'Q1')).toEqual({
      ok: false,
      error: {
        kind: 'invalid-link',
        message: 'A consumer is where a message ends: it takes messages from queues, and nothing is linked from it.',
      },
    });
    expect(linkCommand(sample(), 'P1', 'nope')).toMatchObject({ ok: false, error: { kind: 'invalid-link' } });
  });

  it('makes a command that the canvas accepts, for every link that the rules allow', () => {
    const document = sample();
    let made = 0;
    for (const { id: source } of elements(document)) {
      for (const target of allowedTargets(document, source)) {
        const command = linkCommand(document, source, target);
        const applied = command.ok ? applyCommand(document, command.value, sequentialIds()) : command;

        expect(applied.ok, `${source} to ${target}`).toBe(true);
        made += 1;
      }
    }
    expect(made).toBeGreaterThan(10);
  });

  it('makes a command that the canvas refuses for no link that the rules refuse: the rules and the commands agree', () => {
    const document = sample();
    for (const { id: source } of elements(document)) {
      for (const { id: target } of elements(document)) {
        expect(linkVerdict(document, source, target).ok === linkCommand(document, source, target).ok).toBe(true);
      }
    }
  });
});
