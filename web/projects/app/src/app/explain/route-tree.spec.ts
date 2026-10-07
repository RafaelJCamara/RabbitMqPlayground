import { explainRoute } from '@rmq/domain';
import { bool, entry, exchange, headerArguments, message, str, toExchange, toQueue, topology } from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { RouteTree, topicCells } from './route-tree';

const logs = topology({
  exchanges: [exchange('logs', 'topic')],
  queues: ['errors', 'warnings', 'all'],
  bindings: [toQueue('logs', 'errors', '*.error'), toQueue('logs', 'warnings', '*.warn'), toQueue('logs', 'all', '#')],
});

/** The cells of a row of a table, each as its text, with a space between them, which is how a screen reader says them. */
const cellsOf = (row: HTMLElement): string =>
  [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()).join(' ');

async function draw(explanation: ReturnType<typeof explainRoute>) {
  return render(RouteTree, { inputs: { explanation } });
}

describe('RouteTree (ADR-0060, ADR-0063)', () => {
  it('says what became of the message in a sentence, and has the exchange that it was published to, with each binding that it met', async () => {
    await draw(explainRoute(logs, message('logs', 'app.error')));

    expect(screen.getByTestId('route-summary')).toHaveTextContent('Reached errors and all.');
    const exchange = screen.getByTestId('route-exchange');
    expect(within(exchange).getAllByText('Exchange logs (topic)')[0]).toBeVisible();
    const bindings = screen.getAllByTestId('route-binding');
    expect(bindings).toHaveLength(3);
    expect(bindings.map((binding) => binding.getAttribute('data-verdict'))).toEqual(['matched', 'missed', 'matched']);
  });

  it('says each verdict as a word and an icon, and the sentence that the explanation has for it, so that it is not a colour', async () => {
    await draw(explainRoute(logs, message('logs', 'app.error')));

    const [errors, warnings] = screen.getAllByTestId('route-binding');
    expect(errors).toHaveTextContent('Matched: queue errors ("*.error")');
    expect(warnings).toHaveTextContent('Did not match: queue warnings ("*.warn")');
    expect(within(warnings as HTMLElement).getByTestId('binding-text')).toHaveTextContent('error');
    expect(errors?.querySelector('rmq-icon svg')).not.toBeNull();
    expect(warnings?.querySelector('rmq-icon')?.getAttribute('style')).toContain('var(--rmq-explain-miss)');
    expect(errors?.querySelector('rmq-icon')?.getAttribute('style')).toContain('var(--rmq-explain-hit)');
  });

  it('lays a topic binding out word by word: the pattern, the words of the key that each took, and what became of each', async () => {
    await draw(explainRoute(logs, message('logs', 'app.error')));

    const [, warnings] = screen.getAllByTestId('route-binding');
    const table = within(warnings as HTMLElement).getByRole('table', { name: 'The pattern and the key, word by word' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map(cellsOf)).toEqual(['Pattern * warn', 'Key app error', 'Result matched differs']);
    expect(within(table).getByRole('rowheader', { name: 'Pattern' })).toBeVisible();
    expect(
      within(table)
        .getAllByRole('cell')
        .filter((cell) => cell.getAttribute('data-outcome') === 'differs'),
    ).toHaveLength(1);
  });

  it('says the key words that the pattern did not reach, as columns of their own', async () => {
    await draw(
      explainRoute(
        topology({ exchanges: [exchange('t', 'topic')], queues: ['q'], bindings: [toQueue('t', 'q', 'a.b')] }),
        message('t', 'a.b.c.d'),
      ),
    );

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').map(cellsOf)).toEqual([
      'Pattern a b - -',
      'Key a b c d',
      'Result matched matched extra extra',
    ]);
  });

  it('says that a word of the pattern had no word of the key to meet, in the row of results', async () => {
    await draw(
      explainRoute(
        topology({ exchanges: [exchange('t', 'topic')], queues: ['q'], bindings: [toQueue('t', 'q', 'a.b.c')] }),
        message('t', 'a.b'),
      ),
    );

    expect(within(screen.getByRole('table')).getAllByRole('row').map(cellsOf)).toEqual([
      'Pattern a b c',
      'Key a b -',
      'Result matched matched missing',
    ]);
  });

  it('names the default exchange as such, and not as an exchange of the canvas that has no name', async () => {
    await draw(explainRoute(topology({ queues: ['billing'] }), message('', 'billing')));

    const exchange = screen.getByTestId('route-exchange');
    expect(within(exchange).getAllByText('The default exchange')[0]).toBeVisible();
    expect(exchange).not.toHaveTextContent('Exchange  (');
  });

  it('has a line for each condition of a headers binding, with the reason, and a mark for those that held, those that did not, and those that are not counted', async () => {
    const headers = topology({
      exchanges: [exchange('h', 'headers')],
      queues: ['pdfs'],
      bindings: [
        toQueue(
          'h',
          'pdfs',
          '',
          headerArguments(
            'all-with-x',
            entry('format', str('pdf')),
            entry('x-note', str('a')),
            entry('big', bool(true)),
          ),
        ),
      ],
    });

    await draw(explainRoute(headers, message('h', '', [entry('format', str('pdf')), entry('big', bool(false))])));

    const list = screen.getByRole('list', { name: 'The conditions' });
    const lines = within(list).getAllByRole('listitem');
    expect(lines.map((line) => line.getAttribute('data-outcome'))).toEqual(['pass', 'fail', 'fail']);
    expect(lines[0]).toHaveTextContent('The header format is "pdf", as the binding asks.');
    expect(lines[1]).toHaveTextContent('The header x-note is missing from the message.');
    expect(lines[2]).toHaveTextContent('The header big is false, and the binding asks for true.');
  });

  it('marks an argument that is not counted with an icon of its own, and says why', async () => {
    const headers = topology({
      exchanges: [exchange('h', 'headers')],
      queues: ['q'],
      bindings: [toQueue('h', 'q', '', headerArguments('all', entry('format', str('pdf')), entry('x-note', str('a'))))],
    });

    await draw(explainRoute(headers, message('h', '', [entry('format', str('pdf'))])));

    const lines = within(screen.getByRole('list', { name: 'The conditions' })).getAllByRole('listitem');
    expect(lines.map((line) => line.getAttribute('data-outcome'))).toEqual(['pass', 'ignored']);
    expect(lines[1]).toHaveTextContent('is not counted');
  });

  it('draws the exchange that a binding took the message to under that binding, and so on down a chain', async () => {
    const chain = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'fanout'), exchange('c', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'k'), toExchange('b', 'c'), toQueue('c', 'q')],
    });

    await draw(explainRoute(chain, message('a', 'k')));

    const exchanges = screen.getAllByTestId('route-exchange');
    expect(exchanges.map((node) => node.getAttribute('data-exchange'))).toEqual(['a', 'b', 'c']);
    expect(exchanges[0]).toContainElement(exchanges[1] as HTMLElement);
    expect(exchanges[1]).toContainElement(exchanges[2] as HTMLElement);
  });

  it('says of a message that no queue got that it reached an exchange that has no bindings, and has no bindings to list', async () => {
    await draw(explainRoute(topology({ exchanges: [exchange('e', 'fanout')] }), message('e')));

    expect(screen.getByTestId('route-summary')).toHaveTextContent(
      'No queue got it: it reached e, which has no bindings.',
    );
    expect(screen.queryAllByTestId('route-binding')).toHaveLength(0);
    expect(within(screen.getByTestId('route-exchange')).queryByRole('list')).toBeNull();
  });

  it('says the cause first of a message that the broker refuses, and then what it replies, with no tree', async () => {
    await draw(explainRoute(topology({}), message('nope')));

    expect(screen.getByTestId('route-summary')).toHaveTextContent('There is no exchange called "nope"');
    expect(screen.getByTestId('route-reply')).toHaveTextContent(/^The broker replies: .*NOT_FOUND/);
    expect(screen.queryByTestId('route-exchange')).toBeNull();
  });

  it('says why a message that could not be sent could not, and has no reply and no tree', async () => {
    await draw(explainRoute(logs, message('logs', 'x'.repeat(300))));

    expect(screen.getByTestId('route-summary')).toHaveTextContent(
      'A routing key is at most 255 bytes of UTF-8, and this one is 300.',
    );
    expect(screen.queryByTestId('route-reply')).toBeNull();
    expect(screen.queryByTestId('route-exchange')).toBeNull();
  });
});

describe('topicCells', () => {
  it('has a column for each word of the pattern and one for each word of the key that it did not reach, and shows an empty word as two quotes', () => {
    const explanation = explainRoute(
      topology({ exchanges: [exchange('t', 'topic')], queues: ['q'], bindings: [toQueue('t', 'q', 'a.*')] }),
      message('t', 'a..z'),
    );
    if (explanation.outcome !== 'routed' && explanation.outcome !== 'unroutable') {
      throw new Error('the message is routed');
    }
    const detail = explanation.root.bindings[0]?.detail;
    if (detail?.kind !== 'topic') {
      throw new Error('the binding is a topic one');
    }

    expect(topicCells(detail)).toEqual([
      { pattern: 'a', took: 'a', outcome: 'matched' },
      { pattern: '*', took: '""', outcome: 'matched' },
      { pattern: '-', took: 'z', outcome: 'extra' },
    ]);
  });

  it('puts the words that a hash took together with a point between them, and a dash for the hash that took none', () => {
    const cellsFor = (pattern: string, key: string) => {
      const explanation = explainRoute(
        topology({ exchanges: [exchange('t', 'topic')], queues: ['q'], bindings: [toQueue('t', 'q', pattern)] }),
        message('t', key),
      );
      if (explanation.outcome !== 'routed' && explanation.outcome !== 'unroutable') {
        throw new Error('the message is routed');
      }
      const detail = explanation.root.bindings[0]?.detail;
      if (detail?.kind !== 'topic') {
        throw new Error('the binding is a topic one');
      }
      return topicCells(detail);
    };

    expect(cellsFor('a.#.z', 'a.x.y.z')).toEqual([
      { pattern: 'a', took: 'a', outcome: 'matched' },
      { pattern: '#', took: 'x.y', outcome: 'matched' },
      { pattern: 'z', took: 'z', outcome: 'matched' },
    ]);
    expect(cellsFor('a.#.z', 'a.z')[1]).toEqual({ pattern: '#', took: '-', outcome: 'matched' });
  });
});
