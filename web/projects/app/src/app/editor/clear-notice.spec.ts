import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { manualTimer, sampleDocument } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { TOAST_TIMER, Toasts } from '../core/ui/toasts';
import { ClearNotice } from './clear-notice';

describe('ClearNotice (ADR-0074)', () => {
  let bus: CommandBus;
  let store: DocumentStore;
  let toasts: Toasts;
  let announce: ReturnType<typeof vi.spyOn>;
  /** The editor, as far as the notice is concerned: an injector that is destroyed when the editor goes. */
  let editor: EnvironmentInjector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DocumentStore,
        SelectionStore,
        StatusStore,
        CommandBus,
        { provide: TOAST_TIMER, useValue: manualTimer() },
      ],
    });
    bus = TestBed.inject(CommandBus);
    store = TestBed.inject(DocumentStore);
    toasts = TestBed.inject(Toasts);
    announce = vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
    store.load(sampleDocument());
    editor = createEnvironmentInjector([ClearNotice], TestBed.inject(EnvironmentInjector));
    editor.get(ClearNotice);
  });

  it('follows a clear with a notice that says so and has an Undo, with the keys, whichever way it was asked for', () => {
    bus.apply({ type: 'clear' }, 'typed');

    expect(toasts.visible()).toHaveLength(1);
    expect(toasts.visible()[0]).toMatchObject({
      message: 'Cleared the canvas.',
      undo: { label: 'Undo', keys: 'Ctrl+Z' },
    });
    expect(announce).toHaveBeenCalledWith('Cleared the canvas. Press Ctrl+Z to undo.');
  });

  it('says nothing for any other command', () => {
    bus.apply({ type: 'declare-queue', name: 'extra', durable: true }, 'gesture');
    bus.apply({ type: 'layout' }, 'toolbar');

    expect(toasts.visible()).toEqual([]);
  });

  it('says nothing for a clear that changed nothing, because the bus does not tell anyone of a command that did nothing', () => {
    bus.apply({ type: 'clear' }, 'toolbar');
    toasts.dismiss(toasts.visible()[0]?.id ?? 0);

    bus.apply({ type: 'clear' }, 'toolbar');

    expect(toasts.visible()).toEqual([]);
  });

  it('brings everything back with its Undo, which is the Undo of the editor, and the notice goes', async () => {
    bus.apply({ type: 'clear' }, 'toolbar');
    expect(Object.keys(store.document().queues)).toEqual([]);

    await toasts.undo(toasts.visible()[0]?.id ?? 0);

    expect(Object.keys(store.document().queues)).not.toEqual([]);
    expect(toasts.visible()).toEqual([]);
    expect(store.canRedo()).toBe(true);
  });

  it('goes by itself when anything else is done to the canvas, because the Undo would then take back something else', () => {
    bus.apply({ type: 'clear' }, 'toolbar');
    expect(toasts.visible()).toHaveLength(1);

    bus.apply({ type: 'declare-queue', name: 'after', durable: true }, 'gesture');

    expect(toasts.visible()).toEqual([]);
  });

  it('goes when the learner takes the clear back with the keys or the button of the top bar', () => {
    bus.apply({ type: 'clear' }, 'toolbar');

    bus.undo('toolbar');

    expect(toasts.visible()).toEqual([]);
  });

  it('is there again for a second clear, after the canvas has been built up again', () => {
    bus.apply({ type: 'clear' }, 'toolbar');
    bus.undo('toolbar');

    bus.apply({ type: 'clear' }, 'toolbar');

    expect(toasts.visible()).toHaveLength(1);
  });

  it('takes its notices away with the editor, and makes no more, because an Undo of a canvas that is not open would do nothing and say it had', () => {
    bus.apply({ type: 'clear' }, 'toolbar');
    expect(toasts.visible()).toHaveLength(1);

    editor.destroy();

    expect(toasts.visible()).toEqual([]);
    bus.undo('toolbar');
    bus.apply({ type: 'clear' }, 'toolbar');
    expect(toasts.visible()).toEqual([]);
  });

  it('leaves the notices of others when the editor goes', () => {
    const other = toasts.show({ message: 'Deleted “Orders”.' });
    bus.apply({ type: 'clear' }, 'toolbar');

    editor.destroy();

    expect(toasts.visible().map(({ id }) => id)).toEqual([other]);
  });
});
