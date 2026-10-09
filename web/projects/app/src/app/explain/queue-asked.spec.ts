import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { MOTION_QUERY } from '../core/runtime/motion';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { QueueAsked } from './queue-asked';

/** A producer `sender` that sends a message with the key `new` to `orders`, which sends it to `billing` and not to `archive`. */
const traffic = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
      B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'old'),
    },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 1, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], {}) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderAsked() {
  const frames = manualFrames();
  const view = await render(QueueAsked, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      {
        provide: MOTION_QUERY,
        useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
      },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  const log = TestBed.inject(EventLog);
  TestBed.inject(CommandLog);
  TestBed.inject(Simulation);
  TestBed.inject(DocumentStore).load(traffic());
  frames.frame(0);
  const run = (command: RuntimeCommand): void => {
    bus.run(command, 'toolbar');
    log.flush();
    view.fixture.detectChanges();
  };
  return {
    ...view,
    run,
    explain: TestBed.inject(ExplainState),
    selection: TestBed.inject(SelectionStore),
    settle: () => view.fixture.detectChanges(),
  };
}

describe('QueueAsked (ADR-0062, ADR-0063)', () => {
  it('is not there when no message has been routed to ask about, or when what is selected is not a queue', async () => {
    const { selection, settle, run } = await renderAsked();
    selection.select(['A']);
    settle();
    expect(screen.queryByTestId('queue-asked')).toBeNull();

    run({ type: 'pause' });
    run({ type: 'publish', from: { kind: 'producer', name: 'sender' } });
    run({ type: 'step' });
    selection.select(['E']);
    settle();

    expect(screen.queryByTestId('queue-asked')).toBeNull();
  });

  it('says why the queue that is selected did not get the message that was routed last, as a section with a name, in words', async () => {
    const { selection, settle, run } = await renderAsked();
    run({ type: 'pause' });
    run({ type: 'publish', from: { kind: 'producer', name: 'sender' } });
    run({ type: 'step' });

    selection.select(['A']);
    settle();

    const section = screen.getByRole('region', { name: 'Message 1 and this queue' });
    expect(within(section).getByTestId('queue-why-text')).toHaveTextContent(
      'The queue archive did not get the message.',
    );
    expect(within(section).getAllByTestId('reason')[0]).toHaveAttribute('data-kind', 'binding-did-not-match');
  });

  it('says how the queue got a copy when it did, and follows the message that is open', async () => {
    const { selection, settle, run, explain } = await renderAsked();
    run({ type: 'pause' });
    run({ type: 'publish', from: { kind: 'producer', name: 'sender' } });
    run({ type: 'step' });
    selection.select(['Q']);
    settle();

    expect(screen.getByTestId('queue-why-text')).toHaveTextContent('The queue billing got a copy of the message.');

    explain.openMessage(1);
    settle();
    expect(screen.getByTestId('queue-asked-title')).toHaveTextContent('Message 1 and this queue');
  });
});
