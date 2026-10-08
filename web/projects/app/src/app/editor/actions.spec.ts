import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { manualFrames, sampleDocument } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { FILE_DOWNLOADER, type FileDownloader } from '../core/files/downloader';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { Simulation } from '../core/runtime/simulation';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { StatusStore } from '../core/state/status-store';
import { ShareDialogs } from '../share/dialogs';
import { EditorActions, type ActionSurface } from './actions';

describe('EditorActions', () => {
  let actions: EditorActions;
  let store: DocumentStore;
  let selection: SelectionStore;
  let announcer: Announcer;
  let calls: string[];
  let surface: ActionSurface;
  let dialogs: ShareDialogs;
  const downloader = { save: vi.fn<FileDownloader['save']>() };

  beforeEach(() => {
    downloader.save.mockClear();
    TestBed.configureTestingModule({
      providers: [
        DocumentStore,
        SelectionStore,
        StatusStore,
        CommandBus,
        FlowViewport,
        EditorActions,
        CommandLog,
        CanvasSession,
        ...RUNTIME_SERVICES,
        { provide: FRAME_SOURCE, useValue: manualFrames() },
        { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
        { provide: FILE_DOWNLOADER, useValue: downloader },
      ],
    });
    dialogs = TestBed.inject(ShareDialogs);
    vi.spyOn(dialogs, 'share').mockImplementation(() => undefined);
    vi.spyOn(dialogs, 'exportDefinitions').mockImplementation(() => undefined);
    actions = TestBed.inject(EditorActions);
    store = TestBed.inject(DocumentStore);
    selection = TestBed.inject(SelectionStore);
    announcer = TestBed.inject(Announcer);
    vi.spyOn(announcer, 'announce');
    calls = [];
    TestBed.inject(FlowViewport).attach({
      transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
      host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      fit: () => calls.push('fit'),
      zoomIn: () => calls.push('zoomIn'),
      zoomOut: () => calls.push('zoomOut'),
      resetZoom: () => calls.push('resetZoom'),
      select: () => undefined,
      focus: () => calls.push('focus'),
      edgePath: () => null,
    });
    surface = {
      startRename: vi.fn(),
      focusInspector: vi.fn(() => true),
      openCommandBar: vi.fn(),
      openCheatSheet: vi.fn(),
      toggleEventLog: vi.fn(() => true),
    };
    actions.surface = surface;
    store.load(sampleDocument());
  });

  describe('undo and redo', () => {
    it('take back the last change and put it back, and say so', () => {
      TestBed.inject(CommandBus).apply({ type: 'declare-queue', name: 'extra', durable: true }, 'gesture');
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toContain('extra');

      actions.undo('toolbar');
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toEqual(['billing', 'archive']);
      expect(TestBed.inject(StatusStore).notice()).toMatchObject({
        kind: 'message',
        text: 'Undid: added queue extra.',
      });

      actions.redo('toolbar');
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toContain('extra');
    });

    it('say that there is nothing to undo or redo when there is not', () => {
      actions.undo('toolbar');
      expect(TestBed.inject(StatusStore).notice()).toMatchObject({ text: 'Nothing to undo.' });

      actions.redo('toolbar');
      expect(TestBed.inject(StatusStore).notice()).toMatchObject({ text: 'Nothing to redo.' });
    });
  });

  describe('clear (ADR-0074)', () => {
    it('takes everything off the canvas with the command, as one step that undo brings back', () => {
      const applied = vi.spyOn(TestBed.inject(CommandBus), 'apply');

      actions.clear('toolbar');

      expect(applied).toHaveBeenCalledExactlyOnceWith({ type: 'clear' }, 'toolbar');
      expect(Object.keys(store.document().queues)).toEqual([]);
      expect(store.undoLabel()).toBeDefined();
      actions.undo('toolbar');
      expect(Object.keys(store.document().queues)).not.toEqual([]);
    });

    it('is told with the origin of whoever asked', () => {
      const applied = vi.spyOn(TestBed.inject(CommandBus), 'apply');

      actions.clear('typed');

      expect(applied).toHaveBeenCalledExactlyOnceWith({ type: 'clear' }, 'typed');
    });

    it('says that the canvas is already empty when there is nothing on it, and does nothing', () => {
      actions.clear('toolbar');
      const applied = vi.spyOn(TestBed.inject(CommandBus), 'apply');
      const before = store.document();

      actions.clear('toolbar');

      expect(applied).not.toHaveBeenCalled();
      expect(store.document()).toBe(before);
      expect(announcer.announce).toHaveBeenLastCalledWith('The canvas is already empty.');
      expect(TestBed.inject(StatusStore).notice()).toEqual({ kind: 'message', text: 'The canvas is already empty.' });
    });
  });

  describe('the command bar and the cheat-sheet', () => {
    it('are opened by the editor, which has them, when a key or a button asks', () => {
      actions.openCommandBar();
      actions.openCheatSheet();

      expect(surface.openCommandBar).toHaveBeenCalledOnce();
      expect(surface.openCheatSheet).toHaveBeenCalledOnce();
    });
  });

  describe('the event log', () => {
    it('is shown and hidden by the editor, which has it, and the answer is the editor’s', () => {
      expect(actions.toggleEventLog()).toBe(true);
      vi.mocked(surface.toggleEventLog).mockReturnValueOnce(false);

      expect(actions.toggleEventLog()).toBe(false);
      expect(surface.toggleEventLog).toHaveBeenCalledTimes(2);
    });

    it('leaves the key to the page when there is no editor to show it', () => {
      actions.surface = undefined;

      expect(actions.toggleEventLog()).toBe(false);
    });
  });

  describe('the default exchange', () => {
    it('is turned on as a command of the toolbar, so that it is saved, logged and undone like every other change', () => {
      const origins: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => origins.push(`${origin}:${command.type}`));
      expect(store.document().settings.showDefaultExchange).toBe(false);

      actions.setDefaultExchange(true);

      expect(store.document().settings.showDefaultExchange).toBe(true);
      expect(origins).toEqual(['toolbar:set']);

      actions.undo('toolbar');
      expect(store.document().settings.showDefaultExchange).toBe(false);
    });

    it('is turned off again by the same action', () => {
      actions.setDefaultExchange(true);

      actions.setDefaultExchange(false);

      expect(store.document().settings.showDefaultExchange).toBe(false);
    });
  });

  describe('layout', () => {
    it('puts the nodes in their places as one step that the toolbar made, and fits the canvas once they are drawn there', () => {
      const origins: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => origins.push(`${origin}:${command.type}`));

      actions.layout();
      expect(calls).toEqual([]);
      TestBed.inject(ApplicationRef).tick();

      expect(origins).toEqual(['toolbar:layout']);
      expect(calls).toEqual(['fit']);
      expect(store.undoLabel()).toBe('arranged the canvas');
    });

    it('leaves the canvas alone, and does not fit it, when the nodes are already in their places', () => {
      actions.layout();
      TestBed.inject(ApplicationRef).tick();
      calls.length = 0;

      actions.layout();
      TestBed.inject(ApplicationRef).tick();

      expect(calls).toEqual([]);
    });
  });

  describe('the view', () => {
    it('fits the canvas, and says that it shows all of it', () => {
      actions.fit();

      expect(calls).toEqual(['fit']);
      expect(announcer.announce).toHaveBeenCalledWith('Showing the whole canvas.');
    });

    it('zooms in, out, and back to 100%', () => {
      actions.zoomIn();
      actions.zoomOut();
      actions.resetZoom();

      expect(calls).toEqual(['zoomIn', 'zoomOut', 'resetZoom']);
    });
  });

  describe('renaming what is selected', () => {
    it('opens the field on the node when exactly one node is selected, as a key did', () => {
      selection.select(['Q1']);

      actions.renameSelected();

      expect(surface.startRename).toHaveBeenCalledWith('Q1', 'key');
    });

    it.each([
      ['nothing', [], []],
      ['two nodes', ['Q1', 'Q2'], []],
      ['an edge', [], ['E1>Q1']],
    ])('says what to do when %s is selected', (_, nodes, edges) => {
      selection.select(nodes, edges);

      actions.renameSelected();

      expect(surface.startRename).not.toHaveBeenCalled();
      expect(announcer.announce).toHaveBeenCalledWith('Select one node first, then press F2 to rename it.');
    });

    it('does nothing before the editor has a field to open', () => {
      actions.surface = undefined;
      selection.select(['Q1']);

      expect(() => actions.renameSelected()).not.toThrow();
    });
  });

  describe('the simulation (ADR-0054)', () => {
    beforeEach(() => {
      // The log listens from the moment that it is made, so it is made before anything is done.
      TestBed.inject(CommandLog);
    });

    const lines = () =>
      TestBed.inject(CommandLog)
        .entries()
        .map(({ origin, text }) => `${origin}: ${text}`);

    it('plays what is paused and pauses what plays, as the command that it was, with the origin of what asked', () => {
      actions.togglePlay('key');
      expect(TestBed.inject(Simulation).running()).toBe(false);
      actions.togglePlay('toolbar');
      expect(TestBed.inject(Simulation).running()).toBe(true);

      expect(lines()).toEqual(['key: pause', 'toolbar: play']);
      expect(TestBed.inject(StatusStore).notice()).toEqual({ kind: 'message', text: 'Playing at 1×.' });
    });

    it('steps, as a command, and says what the step did', () => {
      actions.step('key');

      expect(lines()).toEqual(['key: step']);
      expect(TestBed.inject(StatusStore).notice()).toMatchObject({
        kind: 'message',
        text: expect.stringMatching(/^Stepped: /),
      });
    });

    it('publishes from the producer that is selected, and answers true, so that the key is taken', () => {
      selection.select(['P1']);

      expect(actions.publishSelected('key')).toBe(true);

      expect(lines()).toEqual(['key: publish sender']);
      expect(TestBed.inject(StatusStore).notice()).toEqual({
        kind: 'message',
        text: 'Published 2 messages from sender.',
      });
    });

    it('answers false, and does nothing, when what is selected is not one producer, so that the key is left for the page', () => {
      expect(actions.publishSelected('key')).toBe(false);
      selection.select(['Q1']);
      expect(actions.publishSelected('key')).toBe(false);
      selection.select(['P1', 'Q1']);
      expect(actions.publishSelected('key')).toBe(false);
      selection.select([], ['E1>Q1']);
      expect(actions.publishSelected('key')).toBe(false);
      selection.select(['gone']);
      expect(actions.publishSelected('key')).toBe(false);

      expect(lines()).toEqual([]);
    });

    it('says why, and publishes nothing, for a producer that is linked to nothing', () => {
      TestBed.inject(CommandBus).apply({ type: 'unlink', producer: 'sender' }, 'gesture');
      selection.select(['P1']);

      expect(actions.publishSelected('key')).toBe(true);

      expect(TestBed.inject(StatusStore).refusal()).toMatchObject({ origin: 'key', issue: { kind: 'not-linked' } });
      expect(lines()).toEqual(['gesture: unlink sender']);
    });
  });

  describe('editing what is selected', () => {
    it('takes the focus to the inspector, and says that it did', () => {
      selection.select(['Q1']);

      expect(actions.editSelected()).toBe(true);
      expect(surface.focusInspector).toHaveBeenCalledOnce();
    });

    it('does nothing, and says that it did nothing, when nothing is selected', () => {
      expect(actions.editSelected()).toBe(false);
      expect(surface.focusInspector).not.toHaveBeenCalled();
    });

    it('says that it did nothing when the inspector has nothing to focus', () => {
      selection.select(['Q1']);
      vi.mocked(surface.focusInspector).mockReturnValue(false);

      expect(actions.editSelected()).toBe(false);
    });

    it('says that it did nothing before the editor has an inspector', () => {
      actions.surface = undefined;
      selection.select(['Q1']);

      expect(actions.editSelected()).toBe(false);
    });
  });

  describe('sharing (ADR-0078, ADR-0079)', () => {
    const shared = () => vi.mocked(dialogs.share).mock.calls[0]?.[0];

    it('opens the panel for the canvas as it is on the screen, with the name the session gives it', () => {
      actions.share();

      expect(dialogs.share).toHaveBeenCalledTimes(1);
      expect(shared()?.name).toBe('Untitled canvas');
      expect(shared()?.document).toBe(store.document());
    });

    it('offers the messages when there is a simulation to ask, with how many there are and the engine as it is when the choice is made', () => {
      TestBed.inject(CommandBus).run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar');
      const simulation = TestBed.inject(Simulation);

      actions.share();

      expect(shared()?.messages?.count).toBe(simulation.messageCount());
      expect(shared()?.messages?.count).toBeGreaterThan(0);
      expect(shared()?.messages?.snapshot()).toEqual(simulation.snapshot());
    });

    it('offers nothing of messages where there is no simulation', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          DocumentStore,
          SelectionStore,
          StatusStore,
          CommandBus,
          FlowViewport,
          EditorActions,
          CommandLog,
          CanvasSession,
          ...RUNTIME_SERVICES,
          { provide: FRAME_SOURCE, useValue: manualFrames() },
          { provide: FLAG_SOURCES, useValue: { stored: null, query: 'editor' } },
        ],
      });
      const withoutSimulation = TestBed.inject(EditorActions);
      TestBed.inject(DocumentStore).load(sampleDocument());
      const open = vi.spyOn(TestBed.inject(ShareDialogs), 'share').mockImplementation(() => undefined);

      withoutSimulation.share();

      expect(open.mock.calls[0]?.[0]).not.toHaveProperty('messages');
    });

    it('opens the dialog that exports a definitions file for the canvas as it is on the screen', () => {
      actions.exportDefinitions();

      expect(dialogs.exportDefinitions).toHaveBeenCalledExactlyOnceWith({
        name: 'Untitled canvas',
        document: store.document(),
      });
    });

    describe('the file that a link too long to send is replaced by', () => {
      it('is the canvas file of the canvas as it was when the panel opened, named for the canvas, and it is said', () => {
        actions.share();
        const opened = shared();
        TestBed.inject(CommandBus).apply({ type: 'declare-queue', name: 'later', durable: true }, 'gesture');

        opened?.saveAsFile();

        expect(downloader.save).toHaveBeenCalledTimes(1);
        const [file, text] = vi.mocked(downloader.save).mock.calls[0] ?? [];
        expect(file).toBe('untitled-canvas.rmq.json');
        const parsed = JSON.parse(text ?? '') as {
          name: string;
          document: { queues: Record<string, { name: string }> };
        };
        expect(parsed.name).toBe('Untitled canvas');
        expect(Object.values(parsed.document.queues).map(({ name }) => name)).toEqual(['billing', 'archive']);
        expect(Object.values(store.document().queues).map(({ name }) => name)).toContain('later');
        expect(announcer.announce).toHaveBeenCalledWith('Saved “Untitled canvas” as untitled-canvas.rmq.json.');
      });

      it('is not given, and that is said at once, for a canvas that the app could not open again', () => {
        store.load({ ...sampleDocument(), vhost: '' });
        actions.share();

        shared()?.saveAsFile();

        expect(downloader.save).not.toHaveBeenCalled();
        expect(announcer.announce).toHaveBeenCalledWith(
          expect.stringContaining('“Untitled canvas” could not be saved as a file.'),
          'assertive',
        );
      });
    });
  });
});
