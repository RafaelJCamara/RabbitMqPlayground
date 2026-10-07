import { TestBed } from '@angular/core/testing';
import { emptyDocument, LIMITS, type CanvasDocument } from '@rmq/domain';
import { bindingRecord, documentOf, exchangeRecord, manualFrames, producerRecord, queueRecord } from '@rmq/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { ProducerComposer } from './producer-composer';

/** A producer `sender` that sends `hello` with the key `new` to `orders`, which sends it to `billing`, and one that is linked to nothing. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        {
          message: { payload: 'hello', key: 'new', headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] },
          burst: 2,
          interval: { everyMs: 500, on: false },
        },
      ),
      L: producerRecord('lonely'),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderComposer(id = 'P') {
  const view = await render(ProducerComposer, {
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
  TestBed.inject(DocumentStore).load(canvas());
  // The canvas does not run by itself while a spec looks at it, and pausing it is not what the spec is about, so the log does not have it.
  simulation.execute({ type: 'pause' });
  view.fixture.detectChanges();
  return {
    ...view,
    bus,
    store: TestBed.inject(DocumentStore),
    status: TestBed.inject(StatusStore),
    log,
    user: userEvent.setup(),
    settle: () => view.fixture.detectChanges(),
    /** What the learner does to a field: the value is put in it, and it is left. */
    give: (field: HTMLElement, value: string) => {
      (field as HTMLInputElement).value = value;
      fireEvent.change(field);
      view.fixture.detectChanges();
    },
    producer: () => TestBed.inject(DocumentStore).document().producers['P'],
  };
}

describe('ProducerComposer (ADR-0056)', () => {
  it('has the fields of the message and of when it is sent, with the values that the document has, each with a label', async () => {
    await renderComposer();

    expect(screen.getByRole('heading', { name: 'What it sends' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Payload' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Routing key' })).toHaveValue('new');
    expect(screen.getByRole('spinbutton', { name: 'Messages at a time' })).toHaveValue(2);
    expect(screen.getByRole('switch', { name: 'Keeps sending' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('spinbutton', { name: 'Milliseconds between sends' })).toHaveValue(500);
    expect(screen.getByRole('button', { name: 'Publish now' })).toHaveAttribute('aria-keyshortcuts', 'P');
  });

  it('says how many headers the message has, and that the table for them comes with the headers exchange', async () => {
    await renderComposer();

    expect(screen.getByTestId('composer-headers')).toHaveTextContent(
      'The message has 1 header. The table to edit them is coming with the headers exchange.',
    );
  });

  it('sets the payload and the key with the command that sets them, logs the line that does the same, and says what it did', async () => {
    const { give, producer, log, status } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'goodbye');
    give(screen.getByRole('textbox', { name: 'Routing key' }), 'old');

    expect(producer()?.message).toMatchObject({ payload: 'goodbye', key: 'old' });
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual([
      'inspector: set sender payload=goodbye',
      'inspector: set sender key=old',
    ]);
    expect(status.notice()).toEqual({ kind: 'message', text: 'Changed the routing key of producer sender.' });
  });

  it('does nothing for a value that is the one that the document has', async () => {
    const { give, log } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'hello');

    expect(log.entries()).toEqual([]);
  });

  it('does nothing for a number that is the one that the document has', async () => {
    const { give, log } = await renderComposer();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '2');

    expect(log.entries()).toEqual([]);
    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('sets the burst and the time between sends, and a switch turns the repeat on and off', async () => {
    const { give, producer, user, settle } = await renderComposer();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '5');
    give(screen.getByRole('spinbutton', { name: 'Milliseconds between sends' }), '250');
    await user.click(screen.getByRole('switch', { name: 'Keeps sending' }));
    settle();

    expect(producer()).toMatchObject({ burst: 5, interval: { everyMs: 250, on: true } });
    expect(screen.getByRole('switch', { name: 'Keeps sending' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('switch', { name: 'Keeps sending' }));
    settle();

    expect(producer()?.interval.on).toBe(false);
  });

  it('puts back what the document has, and says under the field why, when a value is refused', async () => {
    const { give, producer, log } = await renderComposer();
    const burst = screen.getByRole('spinbutton', { name: 'Messages at a time' });

    give(burst, '0');

    expect(producer()?.burst).toBe(2);
    expect(burst).toHaveValue(2);
    expect(burst).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(/burst/i);
    expect(burst).toHaveAttribute('aria-describedby', screen.getByTestId('refusal').closest('[id]')?.id ?? 'x');
    expect(log.entries()).toEqual([]);
  });

  it('refuses a key that no client could send, with the words of the grammar, and puts the old one back', async () => {
    const { give, producer } = await renderComposer();
    const key = screen.getByRole('textbox', { name: 'Routing key' });

    give(key, 'k'.repeat(300));

    expect(producer()?.message.key).toBe('new');
    expect(key).toHaveValue('new');
    expect(screen.getByTestId('refusal-message')).toHaveTextContent('255');
  });

  it('refuses a payload that is too long', async () => {
    const { give, producer } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'p'.repeat(LIMITS.textLength + 1));

    expect(producer()?.message.payload).toBe('hello');
    expect(screen.getByTestId('refusal')).toBeVisible();
  });

  it('says that a number has to be one, and leaves the field as it was', async () => {
    const { give, producer } = await renderComposer();
    const every = screen.getByRole('spinbutton', { name: 'Milliseconds between sends' });

    give(every, '');

    expect(producer()?.interval.everyMs).toBe(500);
    expect(every).toHaveValue(500);
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(
      'The time between sends has to be a number. It stays as it was.',
    );
  });

  it('forgets a refusal when something is changed that is not refused', async () => {
    const { give } = await renderComposer();
    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '0');
    expect(screen.getByTestId('refusal')).toBeVisible();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '3');

    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('publishes now, with the command, and says how many it sent', async () => {
    const { user, status, log, settle } = await renderComposer();

    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(status.notice()).toEqual({ kind: 'message', text: 'Published 2 messages from sender.' });
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['inspector: publish sender']);
  });

  it('says why a producer that is linked to nothing cannot publish, under the button, and forgets it when the click is another', async () => {
    const { user, settle, bus } = await renderComposer('L');

    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(screen.getByTestId('publish-problem')).toHaveTextContent("The producer 'lonely' is not linked to anything");

    bus.apply({ type: 'link', producer: 'lonely', target: { kind: 'queue', name: 'billing' } }, 'inspector');
    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(screen.queryByTestId('publish-problem')).toBeNull();
  });

  it('shows nothing for what is not a producer, or for one that is gone', async () => {
    const { container } = await renderComposer('Q');

    expect(container.querySelector('[data-testid="producer-composer"]')).toBeNull();
  });
});
