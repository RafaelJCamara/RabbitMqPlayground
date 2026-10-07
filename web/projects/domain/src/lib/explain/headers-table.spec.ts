import type { HeaderArguments, HeaderEntry, HeaderValue } from '@rmq/engine';
import { arbMessageFor, arbTopology, bool, entry, exists, float, headerArguments, int, str } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { headersLine, headersTable, type TableMessage } from './headers-table';
import { describeHeaders } from './headers-words';
import { explainRoute, isRouted } from './route';
import type { BindingNode, ExchangeNode } from './types';

const message = (id: number, ...headers: HeaderEntry<HeaderValue>[]): TableMessage => ({ id, headers });

describe('the live table of a headers binding (ADR-0070)', () => {
  const binding = headerArguments(
    'all',
    entry('format', str('pdf')),
    entry('n', int(1)),
    entry('s', str('1')),
    entry('seen', exists),
  );

  it('has a column for each condition, written as the grammar and the chip write it, so that `1`, `1.0` and `"1"` are apart', () => {
    const { columns } = headersTable(binding, []);

    expect(columns).toEqual([
      { key: 'format', text: 'format=pdf' },
      { key: 'n', text: 'n=1' },
      { key: 's', text: 's="1"' },
      { key: 'seen', text: 'exists(seen)' },
    ]);
    expect(headersTable(headerArguments('any', entry('f', float(1)), entry('key', int(2))), []).columns).toEqual([
      { key: 'f', text: 'f=1.0' },
      { key: 'key', text: '"key"=2' },
    ]);
    expect(headersTable(undefined, []).columns).toEqual([]);
  });

  it('has a row for each message, in the order given, with the number, the headers as a line and the cells', () => {
    const table = headersTable(binding, [
      message(7, entry('format', str('pdf')), entry('n', int(1)), entry('s', str('1')), entry('seen', bool(false))),
      message(6),
    ]);

    expect(table.rows.map(({ message: id, headers, matched, result }) => ({ id, headers, matched, result }))).toEqual([
      { id: 7, headers: 'format=pdf n=1 s="1" seen=false', matched: true, result: 'Matches' },
      { id: 6, headers: '', matched: false, result: 'Does not match' },
    ]);
  });

  it('says in a word what became of each condition: holds, missing, a value that differs, a type that differs', () => {
    const [row] = headersTable(binding, [
      message(1, entry('format', str('doc')), entry('n', float(1)), entry('s', int(1))),
    ]).rows;

    expect(row?.cells.map(({ outcome, word }) => [outcome, word])).toEqual([
      ['fail', 'differs'],
      ['fail', 'type differs'],
      ['fail', 'type differs'],
      ['fail', 'missing'],
    ]);
    const [held] = headersTable(binding, [
      message(2, entry('format', str('pdf')), entry('n', int(1)), entry('s', str('1')), entry('seen', int(0))),
    ]).rows;

    expect(held?.cells.map(({ outcome, word }) => [outcome, word])).toEqual([
      ['pass', 'holds'],
      ['pass', 'holds'],
      ['pass', 'holds'],
      ['pass', 'holds'],
    ]);
  });

  it('says in the words of the explanation what became of each condition, and of the binding', () => {
    const [row] = headersTable(binding, [
      message(1, entry('format', str('doc')), entry('n', float(1)), entry('s', str('1'))),
    ]).rows;

    expect(row?.cells.map(({ text }) => text)).toEqual([
      'The header format is "doc", and the binding asks for "pdf".',
      'The header n is 1.0, a float, and the binding asks for 1, an integer: values of different types are never equal.',
      'The header s is "1", as the binding asks.',
      'The header seen is missing from the message.',
    ]);
    expect(row?.text).toBe('x-match=all: every condition has to hold, and format, n and seen do not.');
  });

  it('says that a condition the mode does not count is not counted, and that one it counts is', () => {
    const asked = headerArguments('all', entry('x-trace', str('1')), entry('format', str('pdf')));
    const [ignored] = headersTable(asked, [message(1, entry('format', str('pdf')))]).rows;
    const [counted] = headersTable({ ...asked, xMatch: 'all-with-x' }, [message(1, entry('format', str('pdf')))]).rows;

    expect(ignored?.cells.map(({ outcome, word }) => [outcome, word])).toEqual([
      ['ignored', 'not counted'],
      ['pass', 'holds'],
    ]);
    expect(ignored?.matched).toBe(true);
    expect(counted?.cells.map(({ outcome, word }) => [outcome, word])).toEqual([
      ['fail', 'missing'],
      ['pass', 'holds'],
    ]);
    expect(counted?.matched).toBe(false);
  });

  it('has a row and no cell for a binding with nothing to match, which matches every message under `all` and none under `any`', () => {
    const every = headersTable(headerArguments('all'), [message(1, entry('a', int(1))), message(2)]);
    const none = headersTable(headerArguments('any'), [message(1)]);

    expect(every.columns).toEqual([]);
    expect(every.rows.map(({ cells, matched }) => [cells.length, matched])).toEqual([
      [0, true],
      [0, true],
    ]);
    expect(none.rows[0]?.matched).toBe(false);
    expect(none.rows[0]?.text).toBe('x-match=any and no condition counts, so it matches no message.');
    expect(headersTable(undefined, [message(1)]).rows[0]?.matched).toBe(true);
  });

  it('says what the binding asks, with the table, as a sentence', () => {
    const asked = headerArguments('any', entry('a', int(1)), entry('b', int(2)));

    expect(headersTable(asked, []).sentence).toBe(describeHeaders(asked));
    expect(headersTable(asked, []).sentence).toBe(
      'x-match=any: a message matches when at least one of the 2 conditions holds (a and b).',
    );
  });

  it('writes the headers of a message as a line, quoting a name that needs it and a string that looks like a number', () => {
    expect(
      headersLine([entry('a b', str('x y')), entry('n', str('1')), entry('f', float(1)), entry('x-a', int(2))]),
    ).toBe('"a b"="x y" n="1" f=1.0 x-a=2');
    expect(headersLine([])).toBe('');
  });
});

describe('the table says what the explanation says (ADR-0060, ADR-0070)', () => {
  /** Every binding node of a tree, whatever its depth. */
  function bindings(exchange: ExchangeNode): BindingNode[] {
    return exchange.bindings.flatMap((node) => [node, ...(node.next === null ? [] : bindings(node.next))]);
  }

  it('gives a headers binding the verdict, the cells and the words that `explainRoute` gives it, for any topology and any message', () => {
    fc.assert(
      fc.property(
        arbTopology.chain((topology) => fc.tuple(fc.constant(topology), arbMessageFor(topology))),
        ([topology, message]) => {
          const explanation = explainRoute(topology, message);
          if (!isRouted(explanation)) {
            return;
          }
          for (const node of bindings(explanation.root)) {
            if (node.detail.kind !== 'headers' || node.index === null) {
              continue;
            }
            const headers = topology.bindings[node.index]?.headers as HeaderArguments | undefined;
            const [row] = headersTable(headers, [{ id: 0, headers: message.headers }]).rows;

            expect(row?.matched).toBe(node.verdict === 'matched');
            expect(row?.cells.map(({ text }) => text)).toEqual(node.detail.conditions.map(({ text }) => text));
            expect(row?.cells.map(({ outcome }) => outcome)).toEqual(
              node.detail.conditions.map(({ outcome }) => outcome),
            );
            expect(node.text.startsWith(row?.text ?? '\u0000')).toBe(true);
          }
        },
      ),
    );
  });
});
