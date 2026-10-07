import { explainQueue } from '@rmq/domain';
import { exchange, message, toExchange, toQueue, topology } from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { QueueWhy } from './queue-why';

const logs = topology({
  exchanges: [exchange('logs', 'topic')],
  queues: ['errors', 'warnings', 'lonely'],
  bindings: [toQueue('logs', 'errors', '*.error'), toQueue('logs', 'warnings', '*.warn')],
});

const draw = (explanation: ReturnType<typeof explainQueue>) => render(QueueWhy, { inputs: { explanation } });

describe('QueueWhy (ADR-0060, ADR-0063)', () => {
  it('says that a queue got a copy, and the bindings that took the message to it, in order', async () => {
    const chain = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'k'), toQueue('b', 'q')],
    });

    await draw(explainQueue(chain, message('a', 'k'), 'q'));

    expect(screen.getByTestId('queue-why-text')).toHaveTextContent('The queue q got a copy of the message.');
    const steps = within(screen.getByRole('list', { name: 'The bindings that took it there' })).getAllByRole(
      'listitem',
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('"k"');
    expect(screen.queryByTestId('queue-why-reasons')).toBeNull();
  });

  it('says why a queue did not get the message, cause first, with the binding that did not match as a sentence', async () => {
    await draw(explainQueue(logs, message('logs', 'app.error'), 'warnings'));

    expect(screen.getByTestId('queue-why-text')).toHaveTextContent('The queue warnings did not get the message.');
    const reasons = screen.getAllByTestId('reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveAttribute('data-kind', 'binding-did-not-match');
    expect(reasons[0]).toHaveTextContent('"*.warn"');
    expect(screen.queryByTestId('queue-why-path')).toBeNull();
  });

  it('nests what stopped the way to an exchange that was not reached under the way, so that the chain is read from the queue to the cause', async () => {
    const chain = topology({
      exchanges: [exchange('a', 'direct'), exchange('b', 'fanout')],
      queues: ['q'],
      bindings: [toExchange('a', 'b', 'x'), toQueue('b', 'q')],
    });

    await draw(explainQueue(chain, message('a', 'y'), 'q'));

    const outer = screen.getAllByTestId('reason')[0] as HTMLElement;
    expect(outer).toHaveAttribute('data-kind', 'exchange-not-reached');
    const inner = within(outer).getAllByTestId('reason')[0] as HTMLElement;
    expect(inner).toHaveAttribute('data-kind', 'binding-did-not-match');
    expect(outer).toContainElement(inner);
  });

  it('says that a queue that nothing is bound to has no way to be reached, and says so once', async () => {
    await draw(explainQueue(logs, message('logs', 'app.error'), 'lonely'));

    expect(screen.getByTestId('queue-why-text')).toHaveTextContent('did not get the message');
    const reasons = screen.getAllByTestId('reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveAttribute('data-kind', 'no-bindings');
  });

  it('says that there is no such queue as a reason of its own', async () => {
    await draw(explainQueue(logs, message('logs', 'app.error'), 'ghost'));

    expect(screen.getByTestId('queue-why-text')).toHaveTextContent('The queue ghost did not get the message.');
    const reasons = screen.getAllByTestId('reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveAttribute('data-kind', 'no-such-queue');
  });
});
