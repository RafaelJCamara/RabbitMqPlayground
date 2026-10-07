import { route } from '@rmq/engine';
import {
  deepFreeze,
  entry,
  exchange,
  headerArguments,
  int,
  message,
  str,
  toExchange,
  toQueue,
  topology,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { explainRoute, messageIssue, refusalText } from './route';
import type { BindingNode, ExchangeNode, RoutedExplanation } from './types';

const routed = (explanation: ReturnType<typeof explainRoute>): RoutedExplanation => {
  if (explanation.outcome !== 'routed' && explanation.outcome !== 'unroutable') {
    throw new Error(`the message was ${explanation.outcome}`);
  }
  return explanation;
};

/** Every binding of the tree, in the order that it is read: a binding, then the bindings of the exchange that it led to. */
function walk(root: ExchangeNode): BindingNode[] {
  const found: BindingNode[] = [];
  const stack = [...root.bindings].reverse();
  for (let binding = stack.pop(); binding !== undefined; binding = stack.pop()) {
    found.push(binding);
    if (binding.next !== null) {
      stack.push(...[...binding.next.bindings].reverse());
    }
  }
  return found;
}

const orders = topology({
  exchanges: [exchange('orders', 'topic'), exchange('payments', 'fanout'), exchange('hub', 'direct')],
  queues: ['billing', 'audit', 'archive'],
  bindings: [
    toQueue('orders', 'billing', 'order.*'),
    toExchange('orders', 'payments', 'order.#'),
    toQueue('orders', 'archive', 'archive.*'),
    toQueue('payments', 'audit'),
    toQueue('hub', 'archive', 'x'),
  ],
});

describe('explainRoute: a message that is routed (ADR-0060)', () => {
  const explanation = routed(explainRoute(orders, message('orders', 'order.created')));

  it('says what became of it: the queues that got a copy, in the order they were reached, and the ones that did not, in the order of the topology', () => {
    expect(explanation.outcome).toBe('routed');
    expect(explanation.queues).toEqual(['billing', 'audit']);
    expect(explanation.unreached).toEqual(['archive']);
    expect(explanation.summary).toBe('Reached billing and audit.');
    expect(explanation.message).toEqual(message('orders', 'order.created'));
    expect(explanation.paths.map(({ queue }) => queue)).toEqual(['billing', 'audit']);
  });

  it('is a tree: the exchange that it was published to, every binding that starts from it, and under a binding the exchange that it took the message to', () => {
    const { root } = explanation;

    expect(root).toMatchObject({ name: 'orders', type: 'topic' });
    expect(root.text).toBe(
      'orders is a topic exchange, and the message was published to it. 2 of its 3 bindings matched.',
    );
    expect(root.bindings.map(({ index, to, verdict }) => [index, to.name, verdict])).toEqual([
      [0, 'billing', 'matched'],
      [1, 'payments', 'matched'],
      [2, 'archive', 'missed'],
    ]);
    const [, toPayments] = root.bindings;
    expect(toPayments?.next).toMatchObject({ name: 'payments', type: 'fanout' });
    expect(toPayments?.next?.text).toBe(
      'payments is a fanout exchange, and the message came to it from orders. 1 of its 1 binding matched.',
    );
    expect(toPayments?.next?.bindings.map(({ to, verdict }) => [to.name, verdict])).toEqual([['audit', 'matched']]);
    // The exchanges that were not reached are not in the tree.
    expect(JSON.stringify(root)).not.toContain('"name":"hub"');
  });

  it('says for each binding whether it was followed, and what became of it', () => {
    const [toBilling, toPayments, toArchive] = explanation.root.bindings;

    expect(toBilling).toMatchObject({
      verdict: 'matched',
      followed: true,
      outcome: 'queue-first-copy',
      short: 'matches',
    });
    expect(toBilling?.text).toBe(
      'The pattern "order.*" matches the key "order.created": * took "created". The queue billing gets its first copy.',
    );
    expect(toPayments).toMatchObject({ verdict: 'matched', followed: true, outcome: 'exchange-visited-next' });
    expect(toPayments?.text).toBe(
      'The pattern "order.#" matches the key "order.created": # took "created". The message goes on to the exchange payments.',
    );
    expect(toArchive).toMatchObject({
      verdict: 'missed',
      followed: false,
      short: 'first word is "order", not "archive"',
    });
    expect(toArchive?.outcome).toBeUndefined();
    expect('outcome' in (toArchive as BindingNode)).toBe(false);
  });

  it('writes a binding as a person says it, and what it compared as data', () => {
    const [toBilling] = explanation.root.bindings;

    expect(toBilling?.label).toBe('"order.*"');
    expect(toBilling?.from).toBe('orders');
    expect(toBilling?.to).toEqual({ kind: 'queue', name: 'billing' });
    expect(toBilling?.detail).toMatchObject({
      kind: 'topic',
      pattern: ['order', '*'],
      key: ['order', 'created'],
      segments: [
        { pattern: 'order', words: ['order'], outcome: 'matched' },
        { pattern: '*', words: ['created'], outcome: 'matched' },
      ],
    });
    expect('miss' in (toBilling?.detail ?? {})).toBe(false);
    expect(explanation.root.bindings[2]?.detail).toMatchObject({
      kind: 'topic',
      miss: { kind: 'word-differs', patternIndex: 0, keyIndex: 0 },
    });
  });
});

describe('explainRoute: a queue that more than one binding reaches, and exchanges that are reached more than once', () => {
  const diamond = topology({
    exchanges: [exchange('top', 'fanout'), exchange('left', 'fanout'), exchange('right', 'fanout')],
    queues: ['shared'],
    bindings: [
      toExchange('top', 'left'),
      toExchange('top', 'right'),
      toQueue('top', 'shared'),
      toExchange('left', 'right'),
      toQueue('left', 'shared'),
      toQueue('right', 'shared'),
    ],
  });
  const explanation = routed(explainRoute(diamond, message('top')));

  it('gives the queue one copy, and says of the other bindings that they matched and were not followed', () => {
    const bindings = walk(explanation.root);

    expect(explanation.queues).toEqual(['shared']);
    const toShared = bindings.filter(({ to }) => to.name === 'shared').sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    expect(toShared.map(({ outcome, followed }) => [outcome, followed])).toEqual([
      ['queue-first-copy', true],
      ['queue-already-had-a-copy', false],
      ['queue-already-had-a-copy', false],
    ]);
    expect(toShared[1]?.text).toContain(
      'The queue shared had a copy already, and a queue gets one copy of a message however many bindings match.',
    );
    expect(bindings.every(({ verdict }) => verdict === 'matched')).toBe(true);
  });

  it('visits an exchange once: the second binding that reaches it is not followed, and has no exchange under it', () => {
    const toRight = walk(explanation.root)
      .filter(({ to }) => to.name === 'right')
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    expect(toRight.map(({ outcome, followed, next }) => [outcome, followed, next === null])).toEqual([
      ['exchange-visited-next', true, false],
      ['exchange-already-visited', false, true],
    ]);
    expect(toRight[1]?.text).toContain('The exchange right had been reached already, and an exchange is visited once.');
  });

  it('ends on a cycle, and on an exchange that is bound to itself', () => {
    const ring = topology({
      exchanges: [exchange('x', 'fanout'), exchange('y', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('x', 'y'), toExchange('y', 'x'), toExchange('x', 'x'), toQueue('y', 'q')],
    });
    const result = routed(explainRoute(ring, message('x')));

    expect(result.queues).toEqual(['q']);
    expect(walk(result.root).map(({ from, to, outcome }) => `${from}>${to.name}:${outcome}`)).toEqual([
      'x>y:exchange-visited-next',
      'y>x:exchange-already-visited',
      'y>q:queue-first-copy',
      'x>x:exchange-already-visited',
    ]);
  });
});

describe('explainRoute: a message that reaches no queue', () => {
  it('says that an exchange with no bindings has none', () => {
    const result = routed(
      explainRoute(topology({ exchanges: [exchange('e', 'fanout')], queues: ['q'] }), message('e')),
    );

    expect(result.outcome).toBe('unroutable');
    expect(result.queues).toEqual([]);
    expect(result.unreached).toEqual(['q']);
    expect(result.summary).toBe('No queue got it: it reached e, which has no bindings.');
    expect(result.root.text).toBe('e is a fanout exchange, and the message was published to it. It has no bindings.');
  });

  it('says that the bindings of the exchanges that it reached did not match, for one binding, one exchange and several', () => {
    const one = topology({ exchanges: [exchange('d', 'direct')], queues: ['q'], bindings: [toQueue('d', 'q', 'a')] });
    const several = topology({
      exchanges: [exchange('d', 'direct'), exchange('f', 'fanout')],
      queues: ['q', 'r'],
      bindings: [toQueue('d', 'q', 'a'), toQueue('d', 'r', 'b'), toExchange('d', 'f', 'k')],
    });

    expect(routed(explainRoute(one, message('d', 'x'))).summary).toBe(
      'No queue got it: it reached d, and its only binding did not match.',
    );
    expect(routed(explainRoute(several, message('d', 'x'))).summary).toBe(
      'No queue got it: it reached d, and none of its 3 bindings matched.',
    );
  });

  it('says that bindings matched and still led to no queue', () => {
    const t = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'direct'), exchange('c', 'direct')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'k'), toExchange('a', 'c', 'other'), toQueue('b', 'q', 'nope')],
    });
    const result = routed(explainRoute(t, message('a', 'k')));

    expect(result.outcome).toBe('unroutable');
    expect(result.summary).toBe(
      'No queue got it: it reached a and b, and 1 of their 3 bindings matched, but none of them led to a queue.',
    );
  });

  it('says so when a single exchange had a binding that matched and led to no queue', () => {
    const t = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'direct')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'k'), toQueue('b', 'q', 'nope')],
    });

    expect(routed(explainRoute(t, message('a', 'k'))).summary).toBe(
      'No queue got it: it reached a and b, and 1 of their 2 bindings matched, but none of them led to a queue.',
    );
  });
});

describe('explainRoute: a binding to something that is not there', () => {
  it('says that it matched and could not lead anywhere, which a canvas that is valid never has but the engine tolerates', () => {
    const t = topology({ exchanges: [exchange('e', 'fanout')], queues: ['q'], bindings: [toQueue('e', 'ghost')] });
    const result = routed(explainRoute(t, message('e')));
    const [binding] = result.root.bindings;

    expect(result.outcome).toBe('unroutable');
    expect(result.summary).toBe(
      'No queue got it: it reached e, and 1 of its 1 binding matched, but none of them led to a queue.',
    );
    expect(binding).toMatchObject({ verdict: 'matched', followed: false, outcome: 'destination-missing' });
    expect(binding?.text.endsWith('The queue ghost is not there.')).toBe(true);
  });
});

describe('explainRoute: the default exchange', () => {
  const t = topology({ queues: ['billing', 'audit'] });

  it('lists an implicit binding for every queue, and the one that the key names is the one that matched', () => {
    const result = routed(explainRoute(t, message('', 'audit')));

    expect(result.queues).toEqual(['audit']);
    expect(result.unreached).toEqual(['billing']);
    expect(result.summary).toBe('Reached audit.');
    expect(result.root).toMatchObject({ name: '', type: 'default' });
    expect(result.root.text).toBe(
      'The message was published to the default exchange, which sends it to the queue that is named by its key, "audit". 1 of its 2 bindings matched.',
    );
    expect(
      result.root.bindings.map(({ index, to, verdict, followed, label, short }) => [
        index,
        to.name,
        verdict,
        followed,
        label,
        short,
      ]),
    ).toEqual([
      [null, 'billing', 'missed', false, 'the queue that is named by the key', 'not named by the key'],
      [null, 'audit', 'matched', true, 'the queue that is named by the key', 'named by the key'],
    ]);
    expect(result.root.bindings[0]?.detail).toEqual({ kind: 'default', queue: 'billing', routingKey: 'audit' });
    expect(result.root.bindings[0]?.text).toBe(
      'The key is "audit", and the queue billing is named "billing": the default exchange only sends a message to the queue that is named by its key.',
    );
    expect(result.root.bindings[1]?.text).toBe(
      'The key is "audit", and the default exchange sends a message to the queue that has that name: audit. The queue audit gets its first copy.',
    );
  });

  it('says that no queue has the name of the key', () => {
    const result = routed(explainRoute(t, message('', 'other')));

    expect(result.outcome).toBe('unroutable');
    expect(result.summary).toBe(
      'No queue got it: the default exchange sends a message to the queue that is named by its key, and no queue is named "other".',
    );
    expect(result.root.bindings.every(({ verdict }) => verdict === 'missed')).toBe(true);
  });

  it('has nothing to list on a canvas with no queues', () => {
    const result = routed(explainRoute(topology({}), message('', 'x')));

    expect(result.root.bindings).toEqual([]);
    expect(result.root.text).toBe(
      'The message was published to the default exchange, which sends it to the queue that is named by its key, "x". It has no bindings.',
    );
  });

  it('agrees with what the engine routed, for each queue', () => {
    for (const key of ['billing', 'audit', 'nothing', '']) {
      const explained = routed(explainRoute(t, message('', key)));
      const result = route(t, message('', key));

      expect(result.ok && explained.queues).toEqual(result.ok && result.queues);
    }
  });
});

describe('explainRoute: a publish that the broker refuses, or that no client could send', () => {
  const t = topology({ exchanges: [exchange('hidden', 'fanout', true)], queues: ['q'] });

  it('says the cause first and the broker reply after it, for an exchange that is not there and for an internal one', () => {
    expect(explainRoute(t, message('open', 'k'))).toEqual({
      outcome: 'refused',
      message: message('open', 'k'),
      code: 404,
      reply: "NOT_FOUND - no exchange 'open' in vhost '/'",
      text: `There is no exchange called "open", so the broker refuses the publish. Its reply is 404 NOT_FOUND - no exchange 'open' in vhost '/'.`,
    });
    expect(explainRoute(t, message('hidden'))).toMatchObject({
      outcome: 'refused',
      code: 403,
      reply: "ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost '/'",
      text: "hidden is an internal exchange, which a client cannot publish to and only another exchange can send messages to, so the broker refuses the publish. Its reply is 403 ACCESS_REFUSED - cannot publish to internal exchange 'hidden' in vhost '/'.",
    });
  });

  it('gives the sentence for a refusal to whoever asks, so that a queue says it in the same words', () => {
    expect(refusalText('x', 404, "NOT_FOUND - no exchange 'x' in vhost '/'")).toBe(
      `There is no exchange called "x", so the broker refuses the publish. Its reply is 404 NOT_FOUND - no exchange 'x' in vhost '/'.`,
    );
  });

  it('does not throw for a key of more than 255 bytes, or for a header that is not exact: it says why', () => {
    const long = explainRoute(t, message('', 'x'.repeat(300)));
    const unsafe = explainRoute(t, message('', 'k', [entry('n', int(2 ** 60))]));

    expect(long).toEqual({
      outcome: 'invalid',
      message: message('', 'x'.repeat(300)),
      text: 'A routing key is at most 255 bytes of UTF-8, and this one is 300.',
    });
    expect(unsafe.outcome).toBe('invalid');
    expect(unsafe.outcome === 'invalid' && unsafe.text).toBe(
      'Header "n": An integer header must be a whole number from -9007199254740991 to 9007199254740991, because a JavaScript number cannot tell larger ones apart.',
    );
    expect(messageIssue(message('', 'k'))).toBeNull();
    expect(messageIssue(message('', 'x'.repeat(300)))).toBe(
      'A routing key is at most 255 bytes of UTF-8, and this one is 300',
    );
  });
});

describe('explainRoute: headers', () => {
  const t = topology({
    exchanges: [exchange('docs', 'headers')],
    queues: ['pdfs'],
    bindings: [toQueue('docs', 'pdfs', '', headerArguments('all', entry('format', str('pdf')), entry('n', int(1))))],
  });

  it('shows each condition of the binding with whether it held, and says the binding as the grammar writes it', () => {
    const result = routed(explainRoute(t, message('docs', '', [entry('format', str('pdf')), entry('n', str('1'))])));
    const [binding] = result.root.bindings;

    expect(binding?.label).toBe('x-match=all format=pdf n=1');
    expect(binding?.verdict).toBe('missed');
    expect(binding?.short).toBe('1 of 2 hold, all needed');
    expect(binding?.detail).toMatchObject({
      kind: 'headers',
      xMatch: 'all',
      omitted: false,
      counted: 2,
      passed: 1,
      conditions: [
        { key: 'format', outcome: 'pass' },
        { key: 'n', outcome: 'fail', wanted: '1', found: '"1"' },
      ],
    });
  });

  it('says a binding that has no arguments at all as an x-match that was left out', () => {
    const bare = topology({
      exchanges: [exchange('docs', 'headers')],
      queues: ['q'],
      bindings: [toQueue('docs', 'q')],
    });
    const [binding] = routed(explainRoute(bare, message('docs'))).root.bindings;

    expect(binding?.label).toBe('x-match=all');
    expect(binding?.verdict).toBe('matched');
  });
});

describe('explainRoute: a fanout and a direct exchange', () => {
  it('says that a fanout takes every message, and a direct exchange compares the whole key', () => {
    const t = topology({
      exchanges: [exchange('f', 'fanout'), exchange('d', 'direct')],
      queues: ['q', 'r'],
      bindings: [toQueue('f', 'q'), toExchange('f', 'd', 'k'), toQueue('d', 'r', 'k'), toQueue('d', 'q', 'other')],
    });
    const [toQueue1, toDirect] = routed(explainRoute(t, message('f', 'k'))).root.bindings;

    expect(toQueue1?.label).toBe('any key');
    expect(toQueue1?.short).toBe('fanout: always matches');
    expect(toQueue1?.detail).toEqual({ kind: 'fanout' });
    expect(toQueue1?.text).toBe(
      'A fanout exchange sends every message to every queue and exchange that is bound to it, whatever the key. The queue q gets its first copy.',
    );
    const [hit, miss] = toDirect?.next?.bindings ?? [];
    expect(hit).toMatchObject({
      label: '"k"',
      short: 'key matches',
      detail: { kind: 'direct', bindingKey: 'k', routingKey: 'k' },
    });
    expect(hit?.text).toBe('The key "k" is the binding key, letter for letter. The queue r gets its first copy.');
    expect(miss?.short).toBe('key is not "other"');
    expect(miss?.text).toBe(
      'The key is "k", and this binding wants "other": a direct exchange compares the whole key, letter for letter.',
    );
  });

  it('says the empty key in words', () => {
    const t = topology({ exchanges: [exchange('d', 'direct')], queues: ['q'], bindings: [toQueue('d', 'q', '')] });
    const [binding] = routed(explainRoute(t, message('d', 'x'))).root.bindings;

    expect(binding?.label).toBe('the empty key');
    expect(binding?.short).toBe('key is not the empty key');
  });
});

describe('explainRoute, as a function', () => {
  it('does not change what it is given, and gives plain data: the same every time, and the same after a trip through JSON', () => {
    const frozen = deepFreeze(structuredClone(orders));
    const m = deepFreeze(message('orders', 'order.created', [entry('a', str('1'))]));
    const explanation = explainRoute(frozen, m);

    expect(explainRoute(frozen, m)).toEqual(explanation);
    expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanation);
  });

  it('builds the tree of a chain of three thousand exchanges, which is as long as a canvas may hold, without recursion', () => {
    const length = 3000;
    const exchanges = Array.from({ length }, (_, index) => exchange(`e${index}`, 'fanout'));
    const bindings = exchanges.slice(1).map((_, index) => toExchange(`e${index}`, `e${index + 1}`));
    const chain = topology({ exchanges, queues: ['q'], bindings: [...bindings, toQueue(`e${length - 1}`, 'q')] });
    const result = routed(explainRoute(chain, message('e0')));

    expect(result.queues).toEqual(['q']);
    expect(walk(result.root)).toHaveLength(length);
  });
});
