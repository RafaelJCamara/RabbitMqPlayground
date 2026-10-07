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
import { render, screen } from '@testing-library/angular';
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
import { keysFor } from '../editor/keyboard';
import { SimulationBar } from './simulation-bar';

/** A producer that sends two messages to a queue that nobody consumes, and takes 100 ms, 50 ms and 100 ms to do it. */
const traffic = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2 },
      ),
    },
    consumers: { C: consumerRecord('worker', [], {}) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderBar(document: CanvasDocument = traffic()) {
  const frames = manualFrames();
  const view = await render(SimulationBar, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
    ],
  });
  const store = TestBed.inject(DocumentStore);
  store.load(document);
  frames.frame(0);
  view.fixture.detectChanges();
  return {
    ...view,
    frames,
    store,
    simulation: TestBed.inject(Simulation),
    bus: TestBed.inject(CommandBus),
    status: TestBed.inject(StatusStore),
    log: TestBed.inject(CommandLog),
    user: userEvent.setup(),
    /** Gives the screen the changes that the simulation made. */
    settle: () => view.fixture.detectChanges(),
  };
}

describe('SimulationBar (ADR-0056)', () => {
  it('is a region of the page, with a name, and has its controls in the order that a learner reaches for them, each with a name in words', async () => {
    await renderBar();

    const bar = screen.getByRole('region', { name: 'Simulation' });
    const names = [...bar.querySelectorAll('button')].map((button) => button.textContent?.replace(/\s+/g, ' ').trim());

    expect(names).toEqual(['Pause', 'Step', '0.25×', '0.5×', '1×', '2×', '4×', 'Clear messages', 'Reset counters']);
  });

  it('plays when it starts, so that the button says what it will do, which is pause, and the speed in use is pressed', async () => {
    await renderBar();

    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says the key of what has one, where the pointer rests and to a screen reader', async () => {
    await renderBar();

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('title', 'Pause (Space)');
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-keyshortcuts', 'Space');
    expect(screen.getByRole('group', { name: 'Speed' })).toBeVisible();
    // The words of the keys are the table's, which the cheat-sheet and the hint bar are made from.
    expect(keysFor(['play'])).toBe('Space');
    expect(keysFor(['step'])).toBe('.');
    expect(screen.getByTestId('step')).toHaveAttribute('aria-keyshortcuts', '.');
  });

  it('pauses and plays with the same button, hands the command to the bus as a button of the toolbar does, and says it', async () => {
    const { user, status, log, simulation, settle } = await renderBar();

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    settle();

    expect(simulation.running()).toBe(false);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('title', 'Play (Space)');
    expect(status.notice()).toEqual({ kind: 'message', text: 'Paused.' });
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['toolbar: pause']);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    settle();

    expect(simulation.running()).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(log.entries().map(({ text }) => text)).toEqual(['pause', 'play']);
  });

  it('has a step that cannot be taken while nothing is scheduled, and says why, and can when something is', async () => {
    const { user, bus, simulation, settle, status } = await renderBar();
    const step = screen.getByRole('button', { name: 'Step' });

    expect(step).toBeDisabled();
    expect(step).toHaveAttribute('title', 'Nothing is scheduled, so there is nothing to step to');

    bus.run({ type: 'pause' }, 'toolbar');
    bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar');
    settle();

    expect(step).toBeEnabled();
    expect(step).toHaveAttribute('title', 'Step to the next event (.)');
    await user.click(step);
    settle();

    expect(simulation.view().now).toBe(100);
    expect(status.notice()).toEqual({ kind: 'message', text: 'Stepped: message 1 was routed to billing.' });
  });

  it('changes the speed with a button, and presses the one that is in use', async () => {
    const { user, simulation, settle, log } = await renderBar();

    await user.click(screen.getByTestId('speed-4'));
    settle();

    expect(simulation.speed()).toBe(4);
    expect(screen.getByRole('button', { name: '4×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false');
    expect(log.entries().map(({ text }) => text)).toEqual(['speed 4']);

    await user.click(screen.getByRole('button', { name: '0.25×' }));
    settle();

    expect(simulation.speed()).toBe(0.25);
  });

  it('clears the messages and resets the counters, and says what it did', async () => {
    const { user, bus, status, settle } = await renderBar();
    bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar');

    await user.click(screen.getByRole('button', { name: 'Clear messages' }));
    expect(status.notice()).toEqual({ kind: 'message', text: 'Cleared the messages.' });

    await user.click(screen.getByRole('button', { name: 'Reset counters' }));
    expect(status.notice()).toEqual({ kind: 'message', text: 'Counters reset.' });

    await user.click(screen.getByRole('button', { name: 'Reset counters' }));
    expect(status.notice()).toEqual({ kind: 'message', text: 'The counters are 0 already.' });
    settle();
  });

  it('reads a long time as seconds and a tenth, to the thousand milliseconds that make a second', async () => {
    const slow = traffic();
    const { bus, settle } = await renderBar({
      ...slow,
      settings: { ...slow.settings, timing: { publishMs: 1_000_000, brokerMs: 50, deliverMs: 100 } },
    });
    bus.run({ type: 'pause' }, 'toolbar');
    bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar');
    bus.run({ type: 'step' }, 'toolbar');
    settle();

    expect(screen.getByTestId('simulation-readout')).toHaveTextContent('Time 1000.0 s');
  });

  it('reads the time to a tenth of a second and how many messages are on their way, as text and not as a live region', async () => {
    const { bus, frames, settle } = await renderBar();
    const readout = screen.getByTestId('simulation-readout');
    expect(readout).toHaveTextContent('Time 0.0 s');
    expect(readout).toHaveTextContent('No messages on their way');
    expect(readout).not.toHaveAttribute('aria-live');
    expect(readout.closest('[aria-live]')).toBeNull();

    bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar');
    settle();
    expect(readout).toHaveTextContent('2 messages on their way');

    frames.frame(0);
    frames.frame(100);
    settle();
    expect(readout).toHaveTextContent('Time 0.1 s');

    bus.run({ type: 'clear-messages' }, 'toolbar');
    bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' }, 'toolbar');
    settle();
    expect(readout).toHaveTextContent('1 message on its way');
  });
});
