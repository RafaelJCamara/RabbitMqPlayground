import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { SimStats } from '../core/runtime/sim-stats';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { ConsumerSettings } from './consumer-settings';

/** A consumer `worker` of `billing`, which acknowledges when it has finished, may hold two messages and takes a second for each. */
const canvas = (ack: 'auto' | 'manual' = 'manual', prefetch = 2): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: { C: consumerRecord('worker', ['Q'], { ack, prefetch, processingMs: 1_000 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderSettings(document: CanvasDocument = canvas(), id = 'C') {
  const view = await render(ConsumerSettings, {
    inputs: { id },
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  // The log listens from the moment that it is made.
  const log = TestBed.inject(CommandLog);
  // The editor has the simulation from the start, which is what the commands of the runtime are run with.
  const simulation = TestBed.inject(Simulation);
  TestBed.inject(DocumentStore).load(document);
  // The canvas does not run by itself while a spec looks at it, and pausing it is not what the spec is about, so the log does not have it.
  simulation.execute({ type: 'pause' });
  view.fixture.detectChanges();
  return {
    ...view,
    bus,
    status: TestBed.inject(StatusStore),
    log,
    settle: () => view.fixture.detectChanges(),
    consumer: () => TestBed.inject(DocumentStore).document().consumers['C'],
    give: (field: HTMLElement, value: string) => {
      (field as HTMLInputElement).value = value;
      fireEvent.change(field);
      view.fixture.detectChanges();
    },
    /** Sends messages from an exchange and steps through them all. */
    flow(messages: number, steps: number) {
      for (let sent = 0; sent < messages; sent += 1) {
        bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' }, 'toolbar');
      }
      for (let step = 0; step < steps; step += 1) {
        bus.run({ type: 'step' }, 'toolbar');
      }
      view.fixture.detectChanges();
    },
  };
}

describe('ConsumerSettings (ADR-0056)', () => {
  it('has the settings of the consumer, with the values that the document has, each with a label', async () => {
    await renderSettings();

    expect(screen.getByRole('heading', { name: 'How it consumes' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Acknowledges' })).toHaveValue('manual');
    expect(screen.getByRole('spinbutton', { name: 'Prefetch' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Milliseconds to handle a message' })).toHaveValue(1000);
  });

  it('offers the two ways to acknowledge, in words that say when', async () => {
    await renderSettings();

    const options = screen.getAllByRole('option').map((option) => option.textContent?.trim());

    expect(options).toEqual([
      'Automatically, as soon as it has the message',
      'By itself, when it has finished with the message',
    ]);
  });

  it('sets how it acknowledges with the command that sets it, logs the line, and says what it did', async () => {
    const { consumer, log, status } = await renderSettings();
    const ack = screen.getByRole('combobox', { name: 'Acknowledges' }) as HTMLSelectElement;

    ack.value = 'auto';
    fireEvent.change(ack);

    expect(consumer()?.ack).toBe('auto');
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['inspector: set worker ack=auto']);
    expect(status.notice()).toEqual({ kind: 'message', text: 'Changed the acknowledgement of consumer worker.' });
  });

  it('sets the prefetch and the time, and says that 0 is no limit', async () => {
    const { give, consumer } = await renderSettings();

    give(screen.getByRole('spinbutton', { name: 'Prefetch' }), '0');
    give(screen.getByRole('spinbutton', { name: 'Milliseconds to handle a message' }), '250');

    expect(consumer()).toMatchObject({ prefetch: 0, processingMs: 250 });
  });

  it('puts back what the document has, and says under the field why, when a value is refused', async () => {
    const { give, consumer } = await renderSettings();
    const prefetch = screen.getByRole('spinbutton', { name: 'Prefetch' });

    give(prefetch, '70000');

    expect(consumer()?.prefetch).toBe(2);
    expect(prefetch).toHaveValue(2);
    expect(prefetch).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(/prefetch/i);
  });

  it('says that a number has to be one', async () => {
    const { give, consumer } = await renderSettings();

    give(screen.getByRole('spinbutton', { name: 'Milliseconds to handle a message' }), 'soon');

    expect(consumer()?.processingMs).toBe(1000);
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(
      'The time to handle a message has to be a number. It stays as it was.',
    );
  });

  it('says what it holds of what it may hold, and what it has finished with and what waits, in words', async () => {
    const { flow } = await renderSettings();
    expect(screen.getByTestId('consumer-holds')).toHaveTextContent(
      'It holds 0 of the 2 that it may hold and has not acknowledged. It has finished with 0 messages, and 0 are waiting for its turn.',
    );

    flow(3, 8);

    expect(screen.getByTestId('consumer-holds')).toHaveTextContent(
      'It holds 2 of the 2 that it may hold and has not acknowledged.',
    );
    expect(screen.getByTestId('consumer-holds')).toHaveTextContent('0 messages');
  });

  it('says nothing of what it holds until the simulation has said anything of it', async () => {
    const { settle } = await renderSettings();
    TestBed.inject(SimStats).apply(new Map());
    settle();

    expect(screen.getByTestId('consumer-holds').textContent?.trim()).toBe('');
  });

  it('says any number when there is no limit, and that a consumer that acknowledges for itself holds none', async () => {
    await renderSettings(canvas('manual', 0));
    expect(screen.getByTestId('consumer-holds')).toHaveTextContent('of the any number that it may hold');
  });

  it('says that a consumer that acknowledges for itself holds none, and counts what it has finished with', async () => {
    const { flow } = await renderSettings(canvas('auto', 1));
    flow(1, 6);

    expect(screen.getByTestId('consumer-holds')).toHaveTextContent(
      'It acknowledges as soon as it has a message, so it holds none.',
    );
    expect(screen.getByTestId('consumer-holds')).toHaveTextContent('1 message');
  });

  it('says what the singular is', async () => {
    const { flow } = await renderSettings(canvas('manual', 3));
    flow(1, 3);

    expect(screen.getByTestId('consumer-holds')).toHaveTextContent('0 messages, and 0 are waiting');
  });

  it('shows nothing for what is not a consumer, or for one that is gone', async () => {
    const { container } = await renderSettings(canvas(), 'P');

    expect(container.querySelector('[data-testid="consumer-settings"]')).toBeNull();
  });
});
