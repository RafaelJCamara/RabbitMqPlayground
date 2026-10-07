import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import {
  bindingRecord,
  bool,
  consumerRecord,
  documentOf,
  entry,
  exchangeRecord,
  float,
  int,
  manualFrames,
  producerRecord,
  queueRecord,
  str,
} from '@rmq/testing';
import { fireEvent, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { EventLog } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { MOTION_QUERY } from '../core/runtime/motion';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { headerRow, MessageInspector } from './message-inspector';

/** A producer `sender` that sends a message with a header to `orders`, which sends what has the key `new` to `billing`, which `worker` takes, and nothing to `archive`. */
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
        {
          message: { payload: 'hello\nworld', key: 'new', headers: [entry('format', str('pdf'))] },
          burst: 1,
          interval: { everyMs: 1_000, on: false },
        },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const PUBLISH: RuntimeCommand = { type: 'publish', from: { kind: 'producer', name: 'sender' } };
const BY_COMMAND: RuntimeCommand = { type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' };

async function renderInspector() {
  const frames = manualFrames();
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      FlowViewport,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation,explain' } },
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
  const focus = vi.fn();
  TestBed.inject(FlowViewport).attach({
    transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
    host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    fit: () => undefined,
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    resetZoom: () => undefined,
    select: () => undefined,
    focus,
    edgePath: () => null,
  });
  const fixture = TestBed.createComponent(MessageInspector);
  fixture.detectChanges();
  const run = (command: RuntimeCommand): void => {
    const result = bus.run(command, 'toolbar');
    if (!result.ok) {
      throw new Error(`refused: ${result.error.message}`);
    }
    log.flush();
    fixture.detectChanges();
  };
  return {
    fixture,
    frames,
    run,
    focus,
    store: TestBed.inject(DocumentStore),
    bus,
    simulation: TestBed.inject(Simulation),
    explain: TestBed.inject(ExplainState),
    announcer: TestBed.inject(Announcer),
    user: userEvent.setup(),
    open: (message: number): void => {
      TestBed.inject(ExplainState).openMessage(message);
      fixture.detectChanges();
    },
    inspector: () => screen.getByTestId('message-inspector'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MessageInspector (ADR-0063)', () => {
  it('is not there until a message is open, and is gone when it is closed', async () => {
    const { run, open, explain, fixture } = await renderInspector();
    run({ type: 'pause' });
    run(PUBLISH);
    expect(screen.queryByTestId('message-inspector')).toBeNull();

    open(1);
    expect(screen.getByTestId('message-inspector')).toBeVisible();
    explain.closeMessage();
    fixture.detectChanges();

    expect(screen.queryByTestId('message-inspector')).toBeNull();
  });

  it('is a section with the name of the message, which a screen reader can reach as a region', async () => {
    const { run, open } = await renderInspector();
    run({ type: 'pause' });
    run(PUBLISH);

    open(1);

    const section = screen.getByRole('region', { name: 'Message 1' });
    expect(within(section).getByRole('heading', { level: 2, name: 'Message 1' })).toBeVisible();
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent?.trim()),
    ).toEqual(['Where it is', 'Payload', 'Headers', 'Route', 'Queues that did not get it']);
    // Each part of it is a region that is named by its heading, so that a screen reader can go from one to the next.
    for (const name of ['Where it is', 'Payload', 'Headers', 'Route', 'Queues that did not get it']) {
      expect(within(section).getByRole('region', { name }), name).toBeVisible();
    }
  });

  it('says what the message is: where it was published and with what key, who sent it, and when', async () => {
    const { run, open } = await renderInspector();
    run({ type: 'pause' });
    run(PUBLISH);
    run({ type: 'step' });

    open(1);

    expect(screen.getByTestId('message-exchange')).toHaveTextContent('exchange orders');
    expect(screen.getByTestId('message-key')).toHaveTextContent('new');
    expect(screen.getByTestId('message-sender')).toHaveTextContent('sender');
    expect(screen.getByTestId('message-time')).toHaveTextContent('0.000 s');
  });

  it('says of a message that a command published that it has no producer, and says the default exchange and the empty key as words', async () => {
    const { run, open } = await renderInspector();
    run({ type: 'pause' });
    run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: '' });
    run(BY_COMMAND);

    open(1);
    expect(screen.getByTestId('message-sender')).toHaveTextContent('a command, with no producer');
    expect(screen.getByTestId('message-key')).toHaveTextContent('the empty key');
    expect(screen.getByTestId('message-exchange')).toHaveTextContent('exchange orders');
  });

  it('says of a message that was published to the default exchange that it is the default exchange, and the key that it was sent with', async () => {
    const { run, open, store } = await renderInspector();
    // A producer that is linked to a queue sends through the default exchange, with the name of the queue as the key.
    store.load({
      ...traffic(),
      producers: {
        P: producerRecord(
          'sender',
          { kind: 'queue', id: 'Q' },
          { message: { payload: 'hi', key: 'billing', headers: [] } },
        ),
      },
    });
    run({ type: 'pause' });
    run(PUBLISH);

    open(1);

    expect(screen.getByTestId('message-exchange')).toHaveTextContent('the default exchange');
    expect(screen.getByTestId('message-exchange')).not.toHaveTextContent('exchange the default');
    expect(screen.getByTestId('message-key')).toHaveTextContent('billing');
  });

  it('says when it was published in seconds, to the thousandth, as the clock of the simulation had it', async () => {
    const { run, open, frames, store } = await renderInspector();
    // A leg that takes five seconds keeps the clock going while the first message is on it, so that the second is published late.
    store.load({
      ...traffic(),
      settings: { ...traffic().settings, timing: { publishMs: 5_000, brokerMs: 50, deliverMs: 100 } },
    });
    run({ type: 'play' });
    run(PUBLISH);
    for (let time = 10; time <= 2500; time += 10) {
      frames.frame(time);
    }
    run({ type: 'pause' });
    run(PUBLISH);

    open(2);

    const at = TestBed.inject(EventLog).held.get(2)?.publishedAt as number;
    expect(at).toBeGreaterThanOrEqual(2000);
    expect(screen.getByTestId('message-time')).toHaveTextContent(`${(at / 1000).toFixed(3)} s`);
    expect(screen.getByTestId('message-time').textContent).toMatch(/\b2\.\d{3} s\b/);
  });

  it('has the payload whole, in a field that can be read and not changed, which scrolls and has a name', async () => {
    const { run, open } = await renderInspector();
    run({ type: 'pause' });
    run(PUBLISH);

    open(1);

    const payload = screen.getByRole('textbox', { name: 'Payload of message 1' });
    expect(payload).toHaveValue('hello\nworld');
    expect(payload).toHaveAttribute('readonly');
  });

  it('lists the headers with their type and their value as a command writes it, and says that there are none when there are none', async () => {
    const { run, open } = await renderInspector();
    run({ type: 'pause' });
    run(PUBLISH);
    run(BY_COMMAND);

    open(1);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['Name', 'Type', 'Value']);
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['format', 'string', '"pdf"']);

    open(2);
    expect(screen.getByTestId('message-no-headers')).toHaveTextContent('No headers.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  describe('where it is', () => {
    it('is on its way to the broker before it gets there, and says what the route would be then, with the canvas as it is', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);

      open(1);

      expect(screen.getByTestId('message-places')).toHaveTextContent('On its way from its producer to the exchange.');
      expect(within(screen.getByTestId('message-places')).getByRole('listitem')).toHaveAttribute(
        'data-place',
        'to-the-broker',
      );
      expect(screen.getByTestId('message-basis')).toHaveTextContent(
        'It has not got to the broker yet. This is where it would go',
      );
      expect(screen.getByTestId('route-summary')).toHaveTextContent('Reached billing.');
    });

    it('follows the engine as the clock moves it: in the broker, on its way to the consumer, and held until it is acknowledged', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      open(1);
      const places = () => screen.getByTestId('message-places').textContent?.replace(/\s+/g, ' ').trim();

      run({ type: 'step' });
      expect(places()).toBe('Inside the broker, on its way to the queues that it was routed to.');
      expect(screen.queryByTestId('message-basis')).toBeNull();

      run({ type: 'step' });
      expect(places()).toBe('On its way from billing to worker.');
      // A copy that is on its way to a consumer has been given once, so it was not redelivered.
      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('No');

      run({ type: 'step' });
      expect(places()).toBe('Held by worker, which has not acknowledged it: it stays in billing until it does.');
      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('No');
    });

    it('says that it is ready in a queue, and its place among the ones that wait, when a consumer has taken another', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run(PUBLISH);
      for (let step = 0; step < 4; step += 1) {
        run({ type: 'step' });
      }

      open(2);

      expect(screen.getByTestId('message-places')).toHaveTextContent(
        'Ready in billing, number 1 of 1 that are waiting for a consumer.',
      );
    });

    it('says that a copy that a consumer has acknowledged is finished with', async () => {
      const { run, open, simulation } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let step = 0; step < 20 && simulation.canStep(); step += 1) {
        run({ type: 'step' });
      }

      open(1);

      expect(screen.getByTestId('message-places')).toHaveTextContent(
        'Finished with: it was acknowledged, or taken from billing.',
      );
    });

    it('says that it was redelivered when its consumer went and it was given back to the queue, and that it is ready there again', async () => {
      const { run, open, bus, fixture } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let step = 0; step < 3; step += 1) {
        run({ type: 'step' });
      }
      open(1);
      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('No');

      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');
      fixture.detectChanges();

      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('Yes');
      expect(screen.getByTestId('message-places')).toHaveTextContent('Ready in billing, number 1 of 1');
    });

    it('says that it was redelivered while it is on its way to a consumer for the second time', async () => {
      const { run, open, bus, fixture } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let step = 0; step < 3; step += 1) {
        run({ type: 'step' });
      }
      open(1);
      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');
      bus.apply({ type: 'add-consumer', name: 'worker' }, 'gesture');
      bus.apply(
        { type: 'set', kind: 'consumer', name: 'worker', changes: { ack: 'manual', prefetch: 1, processingMs: 100 } },
        'gesture',
      );
      bus.apply({ type: 'subscribe', consumer: 'worker', queue: 'billing' }, 'gesture');
      fixture.detectChanges();

      expect(screen.getByTestId('message-places')).toHaveTextContent('On its way from billing to worker.');
      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('Yes');
    });

    it('says that it was redelivered when any of its copies was, and not only when all of them were', async () => {
      const { run, open, bus, fixture, store } = await renderInspector();
      // Two queues get the message, each with a consumer of its own.
      store.load({
        ...traffic(),
        bindings: {
          B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
          B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'new'),
        },
        consumers: {
          C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }),
          C2: consumerRecord('helper', ['A'], { ack: 'manual', prefetch: 1, processingMs: 100 }),
        },
      });
      run({ type: 'pause' });
      run(PUBLISH);
      for (let step = 0; step < 4; step += 1) {
        run({ type: 'step' });
      }
      open(1);
      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('No');

      // Only one of the two consumers goes, and the copy that it held goes back to its queue as a redelivery.
      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');
      fixture.detectChanges();

      expect(screen.getByTestId('message-redelivered')).toHaveTextContent('Yes');
    });

    it('does not say anything of redelivery when no queue has a copy', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });
      run(BY_COMMAND);

      open(1);

      expect(screen.queryByTestId('message-redelivered')).toBeNull();
    });
  });

  describe('the route', () => {
    it('is the explanation of the message with the canvas that routed it, as a tree, with the queue that it did not reach', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });

      open(1);

      expect(screen.getByTestId('route-summary')).toHaveTextContent('Reached billing.');
      expect(screen.getAllByTestId('route-binding').map((binding) => binding.getAttribute('data-verdict'))).toEqual([
        'matched',
        'missed',
      ]);
      const unreached = screen.getByTestId('message-unreached');
      expect(
        within(unreached)
          .getAllByTestId('message-unreached-queue')
          .map((item) => item.getAttribute('data-queue')),
      ).toEqual(['archive']);
    });

    it('keeps the route that the broker made when the canvas changes, and does not say that it is again', async () => {
      const { run, open, store } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      open(1);

      store.load({ ...traffic(), bindings: {} });
      TestBed.inject(ExplainState).openMessage(1);

      expect(screen.queryByTestId('message-gone')).toBeNull();
    });

    it('opens the reasons that a queue did not get the message in place, with a button that says which queue, and closes them again', async () => {
      const { run, open, user, fixture } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      open(1);
      const button = screen.getByRole('button', { name: 'Why didn’t it get to archive?' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('why-not-reasons')).toBeNull();

      await user.click(button);
      fixture.detectChanges();

      expect(button).toHaveAttribute('aria-expanded', 'true');
      const reasons = screen.getByTestId('why-not-reasons');
      expect(button).toHaveAttribute('aria-controls', reasons.id);
      expect(reasons.id).toMatch(/^rmq-message-inspector-\d+-why-archive$/);
      expect(within(reasons).getByTestId('queue-why-text')).toHaveTextContent(
        'The queue archive did not get the message.',
      );
      expect(within(reasons).getAllByTestId('reason')[0]).toHaveAttribute('data-kind', 'binding-did-not-match');

      await user.click(button);
      fixture.detectChanges();

      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('why-not-reasons')).toBeNull();
    });

    it('has no queues that did not get it when it reached all of them, and none when the message was refused', async () => {
      const { run, open, store } = await renderInspector();
      store.load({
        ...traffic(),
        queues: { Q: traffic().queues['Q'] as never },
        bindings: { B: traffic().bindings['B'] as never },
      });
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });

      open(1);

      expect(screen.queryByTestId('message-unreached')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Queues that did not get it' })).toBeNull();
    });

    it('lights the Why? of the message on the canvas with its button, and says so', async () => {
      const { run, open, user, explain, announcer } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      open(1);
      explain.letGoOfWhat();

      await user.click(screen.getByRole('button', { name: 'Show it on the canvas' }));

      expect(explain.focus()).toEqual({ kind: 'why', message: 1 });
      expect(announcer.last()).toBe('Showing why message 1 went where it went on the canvas.');
    });
  });

  describe('a message that the log does not hold', () => {
    it('is explained again with the canvas as it is, which it says, and does not know when it was published', async () => {
      const { run, explain, fixture } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      const info = { id: 4242, producer: null, exchange: 'orders', key: 'new', headers: [], payload: 'from a list' };

      explain.openMessage(4242, { info, queue: 'billing' });
      fixture.detectChanges();

      expect(screen.getByTestId('message-title')).toHaveTextContent('Message 4242');
      expect(screen.getByTestId('message-basis')).toHaveTextContent(
        'Its route is not kept any more. This is where it would go on the canvas as it is now.',
      );
      expect(screen.getByTestId('message-time')).toHaveTextContent('not known');
      expect(screen.getByTestId('message-sender')).toHaveTextContent('a command, with no producer');
      expect(screen.getByRole('textbox', { name: 'Payload of message 4242' })).toHaveValue('from a list');
      expect(screen.getByTestId('route-summary')).toHaveTextContent('Reached billing.');
    });

    it('says that it is not kept when nothing knows of it, and has no buttons of a message', async () => {
      const { run, open } = await renderInspector();
      run({ type: 'pause' });

      open(99);

      expect(screen.getByTestId('message-gone')).toHaveTextContent('Message 99 is not kept any more');
      expect(screen.queryByRole('button', { name: 'Show it on the canvas' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Close message 99' })).toBeVisible();
    });
  });

  describe('closing', () => {
    it('closes with its button, and gives the keyboard to the canvas', async () => {
      const { run, open, user, explain, focus, fixture } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      open(1);

      await user.click(screen.getByRole('button', { name: 'Close message 1' }));
      fixture.detectChanges();

      expect(explain.message()).toBeNull();
      expect(focus).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('message-inspector')).toBeNull();
    });

    it('closes with Escape from inside it, as with the button', async () => {
      const { run, open, explain, focus, inspector } = await renderInspector();
      run({ type: 'pause' });
      run(PUBLISH);
      open(1);

      fireEvent.keyDown(within(inspector()).getByRole('heading', { level: 2 }), { key: 'Escape' });

      expect(explain.message()).toBeNull();
      expect(focus).toHaveBeenCalledOnce();
    });
  });
});

describe('headerRow', () => {
  it('writes a header as its name, its type, and its value as a command writes it', () => {
    expect([
      headerRow(entry('a', str('x y'))),
      headerRow(entry('b', int(3))),
      headerRow(entry('c', float(1))),
      headerRow(entry('d', float(1.5))),
      headerRow(entry('e', bool(false))),
      headerRow(entry('f', float(0.25))),
    ]).toEqual([
      { name: 'a', type: 'string', value: '"x y"' },
      { name: 'b', type: 'integer', value: '3' },
      { name: 'c', type: 'float', value: '1.0' },
      { name: 'd', type: 'float', value: '1.5' },
      { name: 'e', type: 'boolean', value: 'false' },
      { name: 'f', type: 'float', value: '0.25' },
    ]);
  });
});
