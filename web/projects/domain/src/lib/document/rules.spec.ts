import {
  internalExchangeReply,
  noExchangeReply,
  noQueueReply,
  topicWildcardsReply,
  transientQueueReply,
} from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import {
  duplicateNameIssue,
  internalExchangeIssue,
  missingEndIssue,
  topicKeyIssue,
  transientQueueIssue,
} from './rules';

describe('transientQueueIssue (ADR-0021, ADR-0024)', () => {
  const issue = transientQueueIssue('jobs');

  it('carries the 541 that the broker gave, word for word', () => {
    expect(issue.kind).toBe('transient-queue');
    expect(issue.refusal).toEqual(transientQueueReply());
    expect(issue.refusal?.code).toBe(541);
    expect(issue.refusal?.text.startsWith('INTERNAL_ERROR - Feature `transient_nonexcl_queues` is deprecated.')).toBe(
      true,
    );
  });

  it('says what is wrong at its root, in words that do not need the broker’s: why, and what to do', () => {
    expect(issue.message).toContain("Queue 'jobs' is not durable.");
    expect(issue.message).toContain('neither durable nor exclusive');
    expect(issue.message).toContain('deprecated feature');
    expect(issue.message).toContain('closes the connection');
    expect(issue.message).toContain('every queue has to be durable');
  });

  it('is not the same words as the broker’s, which say what happened and not why it did', () => {
    expect(issue.message).not.toContain('INTERNAL_ERROR');
    expect(issue.message).not.toBe(issue.refusal?.text);
  });
});

describe('topicKeyIssue (ADR-0022)', () => {
  it.each(['', '#', '#.#', 'a.#.b.#.c', '*.*.*.*', '##.#.#', 'a#.#.#'])(
    'accepts %j, which has at most two # words',
    (key) => {
      expect(topicKeyIssue(key)).toBeNull();
    },
  );

  it.each<[string, number]>([
    ['#.#.#', 3],
    ['a.#.b.#.c.#', 3],
    ['#.*.#.*.#', 3],
    ['#.#.a.#', 3],
    ['#.#.#.#', 4],
  ])('refuses %j, which has %i, with the 406 that the broker gave', (key, count) => {
    const issue = topicKeyIssue(key);

    expect(issue?.kind).toBe('topic-wildcards');
    expect(issue?.refusal).toEqual(topicWildcardsReply(key, count));
    expect(issue?.refusal?.code).toBe(406);
    expect(issue?.message).toContain(`'${key}' has ${count} '#' words`);
    expect(issue?.message).toContain('at most 2');
    expect(issue?.message).toContain("One '#' already matches any number of words");
  });
});

describe('internalExchangeIssue', () => {
  it('carries the 403 that the broker gave for a publish to an internal exchange, with the vhost', () => {
    const issue = internalExchangeIssue('hidden', 'prod');

    expect(issue.kind).toBe('internal-exchange');
    expect(issue.refusal).toEqual(internalExchangeReply('hidden', 'prod'));
    expect(issue.message).toBe(
      "Exchange 'hidden' is internal, so a client cannot publish to it. Another exchange can still route messages to it through a binding.",
    );
  });
});

describe('missingEndIssue', () => {
  it('carries the 404 that the broker gave, for an exchange and for a queue, with the vhost', () => {
    expect(missingEndIssue('exchange', 'nope', '/')).toEqual({
      kind: 'missing-exchange',
      message: "There is no exchange named 'nope'.",
      refusal: noExchangeReply('nope', '/'),
    });
    expect(missingEndIssue('queue', 'nope', 'prod')).toEqual({
      kind: 'missing-queue',
      message: "There is no queue named 'nope'.",
      refusal: noQueueReply('nope', 'prod'),
    });
  });
});

describe('duplicateNameIssue', () => {
  it('says that a name is taken, with the right article, and has no reply of the broker: it is the canvas’s rule', () => {
    expect(duplicateNameIssue('exchange', 'x')).toEqual({
      kind: 'duplicate-name',
      message: "There is already an exchange named 'x'. Names are unique within a kind.",
    });
    expect(duplicateNameIssue('queue', 'q').message).toContain('There is already a queue named');
    expect(duplicateNameIssue('producer', 'p').message).toContain('There is already a producer named');
    expect(duplicateNameIssue('consumer', 'c').message).toContain('There is already a consumer named');
    expect(duplicateNameIssue('queue', 'q').refusal).toBeUndefined();
  });
});
