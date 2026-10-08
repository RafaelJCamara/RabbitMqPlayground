import type { Provider } from '@angular/core';
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
import { describe, expect, it, vi } from 'vitest';
import { FeatureFlags, FLAG_SOURCES } from '../flags/feature-flags';
import { FRAME_SOURCE, FrameLoop } from '../runtime/frame-loop';
import { MOTION_QUERY } from '../runtime/motion';
import { SimStats } from '../runtime/sim-stats';
import { Simulation } from '../runtime/simulation';
import { CommandBus } from '../state/command-bus';
import { CommandLog } from '../state/command-log';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { StatusStore } from '../state/status-store';
import { WhatIf } from './what-if';

/** An exchange `orders` that sends what has the key `new` to `billing` and what has the key `old` to `archive`, a topic exchange `logs` with `#` to `archive`, and an internal one. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: {
      E: exchangeRecord('orders'),
      L: exchangeRecord('logs', 'topic'),
      H: exchangeRecord('hidden', 'direct', { internal: true }),
    },
    queues: { Q: queueRecord('billing'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
      B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'old'),
      B3: bindingRecord('L', { kind: 'queue', id: 'A' }, '#'),
    },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: { C: consumerRecord('worker', ['Q'], {}) },
  }),
  settings: { ...emptyDocument().settings },
});

function setup(flags: string | null = 'explain,simulation') {
  const frames = manualFrames();
  const providers: Provider[] = [
    DocumentStore,
    SelectionStore,
    StatusStore,
    CommandBus,
    CommandLog,
    FrameLoop,
    SimStats,
    Simulation,
    WhatIf,
    FeatureFlags,
    { provide: FRAME_SOURCE, useValue: frames },
    { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
    {
      provide: MOTION_QUERY,
      useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
    },
  ];
  TestBed.configureTestingModule({ providers });
  const store = TestBed.inject(DocumentStore);
  const simulation = TestBed.inject(Simulation);
  store.load(canvas());
  frames.frame(0);
  return {
    store,
    simulation,
    whatIf: TestBed.inject(WhatIf),
    selection: TestBed.inject(SelectionStore),
    bus: TestBed.inject(CommandBus),
    log: TestBed.inject(CommandLog),
  };
}

describe('WhatIf (ADR-0064)', () => {
  it('is shut at first, says nothing, and lights nothing', () => {
    const { whatIf } = setup();

    expect(whatIf.isOpen()).toBe(false);
    expect(whatIf.answer()).toBeNull();
    expect(whatIf.lit()).toBeNull();
    expect(whatIf.text()).toBe('');
  });

  it('lists the exchanges of the canvas, in its order, and the default exchange after them, which every canvas has', () => {
    const { whatIf } = setup();

    expect(whatIf.exchanges()).toEqual([
      { name: 'orders', label: 'orders (direct)' },
      { name: 'logs', label: 'logs (topic)' },
      { name: 'hidden', label: 'hidden (direct)' },
      { name: '', label: 'The default exchange' },
    ]);
  });

  it('asks about the first exchange of the canvas when it is opened, and about the one that is selected when there is one', () => {
    const { whatIf, selection } = setup();
    whatIf.open();
    expect(whatIf.exchange()).toBe('orders');
    whatIf.close();

    selection.select(['L']);
    whatIf.open();

    expect(whatIf.exchange()).toBe('logs');
  });

  it('does not ask about what is selected when it is not an exchange', () => {
    const { whatIf, selection } = setup();
    selection.select(['Q']);

    whatIf.open();

    expect(whatIf.exchange()).toBe('orders');
  });

  it('asks about the exchange that it is told, the default one included, and goes back to the first when that one is not on the canvas any more', () => {
    const { whatIf, bus } = setup();
    whatIf.open();

    whatIf.choose('');
    expect(whatIf.exchange()).toBe('');
    whatIf.choose('logs');
    expect(whatIf.exchange()).toBe('logs');

    bus.apply({ type: 'delete', target: { kind: 'exchange', name: 'logs' } }, 'gesture');

    expect(whatIf.exchange()).toBe('orders');
  });

  it('says the answer first, in the conditional, with the queues that the message would reach, from the key and the headers that are typed', () => {
    const { whatIf } = setup();
    whatIf.open();

    whatIf.type('key=new');
    expect(whatIf.answer()?.outlook).toBe('Would reach billing.');
    whatIf.type('key=old');
    expect(whatIf.answer()?.outlook).toBe('Would reach archive.');
    whatIf.type('key=unknown');
    expect(whatIf.answer()?.outlook).toBe('No queue would get it.');
  });

  it('answers for the message with no key and no text at all, which is a message that can be published', () => {
    const { whatIf } = setup();
    whatIf.open();

    expect(whatIf.answer()?.outlook).toBe('No queue would get it.');
    expect(whatIf.issue()).toBeNull();
  });

  it('says the refusal of the broker when the exchange cannot be published to, with the cause first', () => {
    const { whatIf } = setup();
    whatIf.open();
    whatIf.choose('hidden');

    expect(whatIf.answer()?.outlook).toContain('internal exchange');
    expect(whatIf.answer()?.explanation.outcome).toBe('refused');
  });

  it('says why a message cannot be sent, as the command does, and when what is typed cannot be read it says so and answers nothing', () => {
    const { whatIf } = setup();
    whatIf.open();

    whatIf.type('key=' + 'x'.repeat(300));
    expect(whatIf.answer()?.outlook).toBe('A routing key is at most 255 bytes of UTF-8, and this one is 300.');

    whatIf.type('keyy=new');
    expect(whatIf.answer()).toBeNull();
    expect(whatIf.lit()).toBeNull();
    expect(whatIf.issue()?.message).toEqual(expect.any(String));
    expect(whatIf.issue()?.message).not.toBe('');
  });

  it('reads headers as the command does: 1 is an integer and "1" is a string', () => {
    const { whatIf } = setup();
    whatIf.open();

    whatIf.type('key=new header:n=1 header:s="1"');

    expect(whatIf.answer()?.explanation.message.headers).toEqual([
      { key: 'n', value: { t: 'integer', v: 1 } },
      { key: 's', value: { t: 'string', v: '1' } },
    ]);
  });

  describe('the line that would send it for real', () => {
    it('is the publish that has the same text after the exchange, with the simulation on', () => {
      const { whatIf } = setup('explain,simulation');
      whatIf.open();

      whatIf.type('key=new header:format=pdf');

      expect(whatIf.answer()?.line).toBe('publish orders key=new header:format=pdf');
      whatIf.type('');
      expect(whatIf.answer()?.line).toBe('publish orders');
    });

    it('leaves out the spaces around what was written, so that what is pasted is a line that reads', () => {
      const { whatIf } = setup('explain,simulation');
      whatIf.open();

      whatIf.type('   key=new  ');
      expect(whatIf.answer()?.line).toBe('publish orders key=new');

      whatIf.type('    ');
      expect(whatIf.answer()?.line).toBe('publish orders');
    });

    it('writes the name of the exchange as the grammar reads it', () => {
      const { whatIf, bus } = setup('explain,simulation');
      bus.apply({ type: 'rename', target: { kind: 'exchange', name: 'orders' }, name: 'big orders' }, 'gesture');
      whatIf.open();

      expect(whatIf.answer()?.line).toBe('publish "big orders"');
    });

    it('is not there for the default exchange, which no command names, or without the simulation', () => {
      const { whatIf } = setup('explain,simulation');
      whatIf.open();
      whatIf.choose('');
      expect(whatIf.answer()?.line).toBeNull();

      TestBed.resetTestingModule();
      const alone = setup('explain');
      alone.whatIf.open();
      alone.whatIf.type('key=new');
      expect(alone.whatIf.answer()?.line).toBeNull();
    });
  });

  describe('what it lights', () => {
    it('is the Why? of the message that would be published: where it would go and where it would not, while the tester is open', () => {
      const { whatIf } = setup();
      whatIf.open();
      whatIf.type('key=new');

      const lit = whatIf.lit();

      expect(lit).toMatchObject({
        title: 'What if? To orders with the key "new"',
        text: 'Would reach billing.',
      });
      expect(lit?.emphasis.nodes.get('Q')).toBe('reached');
      expect(lit?.emphasis.nodes.get('A')).toBe('missed');
      expect(lit?.emphasis.nodes.get('E')).toBe('visited');
      expect(lit?.emphasis.edges.get('E>Q')?.mark).toBe('path');
      expect(lit?.emphasis.edges.get('E>A')?.mark).toBe('missed');
      // It was asked of no producer, so no producer's link is lit.
      expect(lit?.emphasis.nodes.has('P')).toBe(false);
    });

    it('says the empty key and the default exchange as words in its title', () => {
      const { whatIf } = setup();
      whatIf.open();

      expect(whatIf.lit()?.title).toBe('What if? To orders with the empty key');
      whatIf.choose('');
      expect(whatIf.lit()?.title).toBe('What if? To the default exchange with the empty key');
    });

    it('lights nothing when it is shut, and again when it is opened', () => {
      const { whatIf } = setup();
      whatIf.open();
      whatIf.type('key=new');
      expect(whatIf.lit()).not.toBeNull();

      whatIf.close();
      expect(whatIf.lit()).toBeNull();
      whatIf.open();

      expect(whatIf.lit()).not.toBeNull();
      expect(whatIf.text()).toBe('key=new');
    });

    it('follows the canvas, with no timer: a binding that is taken away changes the answer at once', () => {
      const { whatIf, bus } = setup();
      whatIf.open();
      whatIf.type('key=new');
      expect(whatIf.answer()?.outlook).toBe('Would reach billing.');

      bus.apply(
        { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'new' },
        'gesture',
      );

      expect(whatIf.answer()?.outlook).toBe('No queue would get it.');
    });
  });

  it('toggles, and says whether it is open', () => {
    const { whatIf } = setup();

    expect(whatIf.toggle()).toBe(true);
    expect(whatIf.isOpen()).toBe(true);
    expect(whatIf.toggle()).toBe(false);
    expect(whatIf.isOpen()).toBe(false);
  });

  it('changes nothing: it publishes nothing, writes nothing to the log, and leaves the canvas, the selection, the history and the counters as they were', () => {
    const { whatIf, store, selection, log, simulation, bus } = setup();
    selection.select(['Q']);
    const document = store.document();
    const selected = selection.selection();
    const run = vi.spyOn(bus, 'run');
    const apply = vi.spyOn(bus, 'apply');

    whatIf.open();
    whatIf.choose('logs');
    whatIf.type('key=a.b header:x=1');
    whatIf.answer();
    whatIf.lit();
    whatIf.close();

    expect(run).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(store.document()).toBe(document);
    expect(selection.selection()).toBe(selected);
    expect(store.canUndo()).toBe(false);
    expect(log.entries()).toEqual([]);
    expect(simulation.view().published).toBe(0);
    expect(simulation.view().travelling).toBe(0);
  });
});
