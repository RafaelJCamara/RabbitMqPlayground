import { alignTopic } from '@rmq/engine';
import { entry, exchange, int, message, str, toExchange, toQueue, topology } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { explainQueue } from './queue';
import { explainRoute } from './route';
import { alignmentLines, explanationText } from './text';

const gridOf = (pattern: string, key: string): string[] => {
  const { segments, miss } = alignTopic(pattern, key);
  return alignmentLines(segments, key === '' ? [] : key.split('.'), miss);
};

describe('the alignment of a topic key as text (ADR-0059, ADR-0060)', () => {
  it.each<[string, string, string[]]>([
    ['order.*', 'order.created', ['pattern  order   | *', 'key      order ✓ | created ✓']],
    ['a.#.b', 'a.x.y.b', ['pattern  a   | #     | b', 'key      a ✓ | x.y ✓ | b ✓']],
    ['a.#.b', 'a.b', ['pattern  a   | #   | b', 'key      a ✓ | - ✓ | b ✓']],
    // Every word is judged on its own, so a word that is wrong is marked wherever it is.
    ['a.#.c', 'a.b.d', ['pattern  a   | #   | c', 'key      a ✓ | b ✓ | d ✗']],
    ['pay.#.done', 'order.created', ['pattern  pay     | #   | done', 'key      order ✗ | - ✓ | created ✗']],
    // A word that the key had no word left for has a dash.
    ['a.b.c', 'a.b', ['pattern  a   | b   | c', 'key      a ✓ | b ✓ | - ✗']],
    // A key that goes on after the pattern has its extra words after it.
    ['a.b', 'a.b.c.d', ['pattern  a   | b   | -   | -', 'key      a ✓ | b ✓ | c ✗ | d ✗']],
    // An empty word is two quotes, so that it is seen.
    ['a.*.b', 'a..b', ['pattern  a   | *    | b', 'key      a ✓ | "" ✓ | b ✓']],
    ['a..b', 'a.x.b', ['pattern  a   | ""  | b', 'key      a ✓ | x ✗ | b ✓']],
    ['', 'a', ['pattern  -', 'key      a ✗']],
    ['#', '', ['pattern  #', 'key      - ✓']],
    ['', '', ['pattern', 'key']],
  ])('lays pattern %j against key %j', (pattern, key, lines) => {
    expect(gridOf(pattern, key)).toEqual(lines);
  });
});

describe('explanationText (ADR-0060)', () => {
  const t = topology({
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
  const m = message('orders', 'order.created', [entry('format', str('pdf')), entry('n', int(1))]);

  it('writes a message that was routed as a tree, then the queues that it is asked about', () => {
    const queues = ['billing', 'archive'].map((queue) => explainQueue(t, m, queue));

    expect(explanationText(explainRoute(t, m), queues)).toBe(
      [
        'message: published to "orders" with key "order.created", headers format="pdf" n=1',
        'outcome: routed',
        'reached: billing, audit',
        'summary: Reached billing and audit.',
        '',
        'exchange orders (topic): orders is a topic exchange, and the message was published to it. 2 of its 3 bindings matched.',
        '  ✓ orders -> queue billing ("order.*") [matches]',
        '    The pattern "order.*" matches the key "order.created": * took "created". The queue billing gets its first copy.',
        '    pattern  order   | *',
        '    key      order ✓ | created ✓',
        '  ✓ orders -> exchange payments ("order.#") [matches]',
        '    The pattern "order.#" matches the key "order.created": # took "created". The message goes on to the exchange payments.',
        '    pattern  order   | #',
        '    key      order ✓ | created ✓',
        '    exchange payments (fanout): payments is a fanout exchange, and the message came to it from orders. 1 of its 1 binding matched.',
        '      ✓ payments -> queue audit (any key) [fanout: always matches]',
        '        A fanout exchange sends every message to every queue and exchange that is bound to it, whatever the key. The queue audit gets its first copy.',
        '  ✗ orders -> queue archive ("archive.*") [first word is "order", not "archive"]',
        '    The pattern "archive.*" does not match the key "order.created": the first word of the key is "order", and the pattern asks for "archive".',
        '    pattern  archive | *',
        '    key      order ✗ | created ✓',
        '',
        'queue billing: reached',
        '  ✓ orders -> queue billing ("order.*") [matches]',
        '    pattern  order   | *',
        '    key      order ✓ | created ✓',
        '',
        'queue archive: not reached',
        '  The queue archive did not get the message.',
        '  - The binding from orders to queue archive ("archive.*") was tried, and it did not match. The pattern "archive.*" does not match the key "order.created": the first word of the key is "order", and the pattern asks for "archive".',
        '    pattern  archive | *',
        '    key      order ✗ | created ✓',
        '  - hub is bound to queue archive ("x"), but the message never reached hub.',
        '    - Nothing is bound to the exchange hub, so nothing leads into it and the message cannot reach it.',
        '',
      ].join('\n'),
    );
  });

  it('writes the conditions of a headers binding, one line each, with a dash for one that is not counted', () => {
    const docs = topology({
      exchanges: [exchange('docs', 'headers')],
      queues: ['pdfs'],
      bindings: [
        {
          source: 'docs',
          destination: { kind: 'queue', name: 'pdfs' },
          key: '',
          headers: {
            xMatch: 'all',
            args: [entry('format', str('pdf')), entry('n', int(1)), entry('x-trace', str('1'))],
          },
        },
      ],
    });
    const text = explanationText(
      explainRoute(docs, message('docs', '', [entry('format', str('pdf')), entry('n', str('1'))])),
    );

    expect(text.split('\n').filter((line) => /^ {4}[✓✗-] /.test(line))).toEqual([
      '    ✓ The header format is "pdf", as the binding asks.',
      '    ✗ The header n is "1", a string, and the binding asks for 1, an integer: values of different types are never equal.',
      '    - The header x-trace is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.',
    ]);
    expect(text).toContain('outcome: unroutable');
    expect(text).toContain('reached: nothing');
  });

  it('writes the default exchange without the word exchange before its name', () => {
    const text = explanationText(explainRoute(topology({ queues: ['billing'] }), message('', 'billing')));

    expect(text).toContain('\nthe default exchange: The message was published to the default exchange');
    expect(text).toContain(
      '  ✓ the default exchange -> queue billing (the queue that is named by the key) [named by the key]',
    );
  });

  it('writes a message that was refused, or could not be sent, as its header lines alone', () => {
    expect(explanationText(explainRoute(topology({}), message('nope', 'k')))).toBe(
      [
        'message: published to "nope" with key "k"',
        'outcome: refused',
        'reached: nothing',
        `summary: There is no exchange called "nope", so the broker refuses the publish. Its reply is 404 NOT_FOUND - no exchange 'nope' in vhost '/'.`,
        '',
      ].join('\n'),
    );
    expect(explanationText(explainRoute(topology({}), message('', 'x'.repeat(256))))).toContain('outcome: invalid');
  });

  it('writes the empty key as such, and a message to the default exchange as published to it', () => {
    expect(explanationText(explainRoute(topology({}), message('', '')))).toMatch(
      /^message: published to the default exchange with key the empty key\n/,
    );
  });

  it('is the same every time, and has line feeds only, ending in one', () => {
    const text = explanationText(explainRoute(t, m), [explainQueue(t, m, 'archive')]);

    expect(explanationText(explainRoute(t, m), [explainQueue(t, m, 'archive')])).toBe(text);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('writes a chain of three thousand exchanges, which is as long as a canvas may hold, without recursion', () => {
    const length = 3000;
    const exchanges = Array.from({ length }, (_, index) => exchange(`e${index}`, 'fanout'));
    const chain = topology({
      exchanges,
      queues: ['q'],
      bindings: [
        ...exchanges.slice(1).map((_, index) => toExchange(`e${index}`, `e${index + 1}`)),
        toQueue(`e${length - 1}`, 'q'),
      ],
    });
    const text = explanationText(explainRoute(chain, message('e0')));

    expect(text.split('\n').filter((line) => /^ *exchange e\d+ \(fanout\)/.test(line))).toHaveLength(length);
  });
});
