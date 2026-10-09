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
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { WhatIf } from '../core/explain/what-if';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { MOTION_QUERY } from '../core/runtime/motion';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { WhyCard } from './why-card';

/** A producer `sender` that sends two messages at a time to `orders`, which sends what has the key `new` to `billing`, and nothing to `archive`, whose binding has the key `old`. */
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
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderCard() {
  const frames = manualFrames();
  const view = await render(WhyCard, {
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
    bus,
    run,
    explain: TestBed.inject(ExplainState),
    whatIf: TestBed.inject(WhatIf),
    selection: TestBed.inject(SelectionStore),
    settle: () => view.fixture.detectChanges(),
    user: userEvent.setup(),
    /** A canvas that has stopped the clock and published, and has had the first message routed. */
    stoppedAfterOneRouted(): void {
      run({ type: 'pause' });
      run({ type: 'publish', from: { kind: 'producer', name: 'sender' } });
      run({ type: 'step' });
    },
  };
}

describe('WhyCard (ADR-0062)', () => {
  it('is not there while nothing is lit', async () => {
    await renderCard();

    expect(screen.queryByTestId('why-card')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('says what is lit in words, as a labelled group, with the sentence of the explanation', async () => {
    const { stoppedAfterOneRouted } = await renderCard();

    stoppedAfterOneRouted();

    const card = screen.getByRole('group', { name: 'Why? Message 1 (the last one routed)' });
    expect(card).toHaveAttribute('data-source', 'auto');
    expect(within(card).getByTestId('why-card-title')).toHaveTextContent('Why? Message 1 (the last one routed)');
    expect(within(card).getByTestId('why-card-text')).toHaveTextContent('Reached billing.');
    expect(within(card).queryByTestId('why-card-gone')).toBeNull();
  });

  it('says what the lines mean, for the looks that are on the canvas, each with a shape that colour does not carry', async () => {
    const { stoppedAfterOneRouted } = await renderCard();

    stoppedAfterOneRouted();

    const legend = screen.getByRole('list', { name: 'What the lines mean' });
    const items = within(legend).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-legend'))).toEqual(['hit', 'miss']);
    expect(items[0]).toHaveTextContent('went this way, or got a copy');
    expect(items[1]).toHaveTextContent('did not match, and why');
    // A thick line for where it went, and a dashed and lighter one for where it did not: the shapes are in the picture of the line.
    expect(items[0]?.querySelector('line')?.getAttribute('stroke-width')).toBe('4');
    expect(items[1]?.querySelector('line')?.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(items[0]?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says what a queue that is asked about is, with its own look, and offers to stop asking', async () => {
    const { stoppedAfterOneRouted, selection, settle } = await renderCard();
    stoppedAfterOneRouted();

    selection.select(['A']);
    settle();

    const card = screen.getByTestId('why-card');
    expect(card).toHaveAttribute('data-source', 'queue');
    expect(within(card).getByTestId('why-card-title')).toHaveTextContent('Why? Message 1 and archive');
    expect(within(card).getByTestId('why-card-text')).toHaveTextContent('The queue archive did not get the message.');
    const legend = within(card).getAllByRole('listitem');
    expect(legend.map((item) => item.getAttribute('data-legend'))).toContain('asked');
    expect(legend.find((item) => item.getAttribute('data-legend') === 'asked')?.querySelector('line')).toHaveAttribute(
      'stroke-dasharray',
      '1 7',
    );
    expect(within(card).getByRole('button', { name: 'Stop asking' })).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Let go' })).toBeNull();
  });

  it('lets go of what is lit with its button, and goes, until the next message is routed', async () => {
    const { stoppedAfterOneRouted, user, run, settle } = await renderCard();
    stoppedAfterOneRouted();

    await user.click(screen.getByRole('button', { name: 'Let go' }));
    settle();

    expect(screen.queryByTestId('why-card')).toBeNull();

    run({ type: 'step' });

    expect(screen.getByTestId('why-card-title')).toHaveTextContent('Why? Message 2 (the last one routed)');
  });

  it('says what the what-if tester lights, with a button that shuts the tester, and goes with it', async () => {
    const { whatIf, settle, user } = await renderCard();
    whatIf.open();
    whatIf.type('key=new');
    settle();

    const card = screen.getByTestId('why-card');
    expect(card).toHaveAttribute('data-source', 'what-if');
    expect(within(card).getByTestId('why-card-title')).toHaveTextContent('What if? To orders with the key "new"');
    expect(within(card).getByTestId('why-card-text')).toHaveTextContent('Would reach billing.');
    expect(within(card).queryByRole('button', { name: 'Let go' })).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Close the tester' }));
    settle();

    expect(whatIf.isOpen()).toBe(false);
    expect(screen.queryByTestId('why-card')).toBeNull();
  });

  it('stops asking about a queue by taking the selection away, which is how a queue is asked about', async () => {
    const { stoppedAfterOneRouted, selection, user, settle } = await renderCard();
    stoppedAfterOneRouted();
    selection.select(['A']);
    settle();

    await user.click(screen.getByRole('button', { name: 'Stop asking' }));
    settle();

    expect(selection.count()).toBe(0);
    expect(screen.queryByTestId('why-card')).toBeNull();
  });

  it('says how many parts of what is lit are not on the canvas any more, in the singular and in the plural', async () => {
    const { stoppedAfterOneRouted, bus, settle } = await renderCard();
    stoppedAfterOneRouted();

    bus.apply({ type: 'delete', target: { kind: 'producer', name: 'sender' } }, 'gesture');
    settle();

    expect(screen.getByTestId('why-card-gone')).toHaveTextContent('One part of this is not on the canvas any more.');

    // A queue that is deleted takes its binding with it, and both are parts of what was lit.
    bus.apply({ type: 'delete', target: { kind: 'queue', name: 'archive' } }, 'gesture');
    settle();

    expect(screen.getByTestId('why-card-gone')).toHaveTextContent('3 parts of this are not on the canvas any more.');
  });

  it('says nothing aloud: what was chosen was said when it was chosen', async () => {
    const { stoppedAfterOneRouted } = await renderCard();

    stoppedAfterOneRouted();

    expect(screen.getByTestId('why-card').closest('[aria-live]')).toBeNull();
    expect(screen.getByTestId('why-card')).not.toHaveAttribute('aria-live');
  });
});
