import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { explainLink, LIMITS, type CanvasDocument } from '@rmq/domain';
import { documentOf, queueRecord, sampleDocument } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasIntent } from '../canvas/model/intents';
import { frameOf } from '../canvas/model/shapes';
import { Announcer } from '../core/announcer';
import { CommandBus, type Applied } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { IntentHandler, type IntentSurface } from './intents';

describe('IntentHandler', () => {
  let handler: IntentHandler;
  let store: DocumentStore;
  let bus: CommandBus;
  let selection: SelectionStore;
  let status: StatusStore;
  let announcer: Announcer;
  let viewport: FlowViewport;
  let applied: Applied[];

  function start(document: CanvasDocument = sampleDocument()): void {
    store.load(document);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, FlowViewport, IntentHandler],
    });
    handler = TestBed.inject(IntentHandler);
    store = TestBed.inject(DocumentStore);
    bus = TestBed.inject(CommandBus);
    selection = TestBed.inject(SelectionStore);
    status = TestBed.inject(StatusStore);
    announcer = TestBed.inject(Announcer);
    viewport = TestBed.inject(FlowViewport);
    vi.spyOn(announcer, 'announce');
    vi.spyOn(viewport, 'reveal');
    applied = [];
    bus.onApplied((change) => applied.push(change));
    start();
  });

  describe('a selection', () => {
    it('is what the editor holds, in ids', () => {
      handler.handle({ type: 'select', nodes: ['Q1', 'C1'], edges: ['E1>Q1'] });

      expect(selection.selection()).toEqual({ nodes: ['Q1', 'C1'], edges: ['E1>Q1'] });
      expect(applied).toEqual([]);
    });
  });

  describe('a move', () => {
    const move = (by: 'pointer' | 'keyboard', moves: { id: string; x: number; y: number }[]): CanvasIntent => ({
      type: 'move',
      moves,
      by,
    });

    it('puts the node where it was dropped, as a move that came from a gesture when a pointer did it', () => {
      handler.handle(move('pointer', [{ id: 'Q1', x: 500, y: 40 }]));

      expect(store.document().layout.nodes['Q1']).toEqual({ x: 500, y: 40 });
      expect(applied.map(({ origin, command }) => [origin, command.type])).toEqual([['gesture', 'move']]);
    });

    it('says that it came from a key when a key did it', () => {
      handler.handle(move('keyboard', [{ id: 'Q1', x: 500, y: 40 }]));

      expect(applied.map(({ origin }) => origin)).toEqual(['key']);
    });

    it('moves several nodes as one step of undo, and undo puts them all back', () => {
      const before = store.document();

      handler.handle(
        move('pointer', [
          { id: 'Q1', x: 500, y: 40 },
          { id: 'C1', x: 700, y: 60 },
        ]),
      );

      expect(applied).toHaveLength(1);
      expect(applied[0]?.command.type).toBe('batch');
      bus.undo('toolbar');
      expect(store.document()).toEqual(before);
    });

    it('does not say what it moved, because a pointer shows it and a key has had it announced', () => {
      handler.handle(move('pointer', [{ id: 'Q1', x: 500, y: 40 }]));

      expect(announcer.announce).not.toHaveBeenCalled();
      expect(status.notice()).toBeNull();
    });

    it('leaves out a node that is not on the canvas, and does nothing when none is', () => {
      handler.handle(move('pointer', [{ id: 'gone', x: 1, y: 2 }]));

      expect(applied).toEqual([]);
      expect(store.canUndo()).toBe(false);
    });

    it('does nothing for a drop that is where the node was, and leaves no step', () => {
      const where = store.document().layout.nodes['Q1']!;

      handler.handle(move('pointer', [{ id: 'Q1', ...where }]));

      expect(store.canUndo()).toBe(false);
    });
  });

  describe('a delete', () => {
    it('deletes the nodes, and the edges that were on them, as one step of undo', () => {
      const before = store.document();

      handler.handle({ type: 'delete', nodes: ['Q2'], edges: [], by: 'keyboard' });

      expect(store.document().queues['Q2']).toBeUndefined();
      expect(Object.keys(store.document().bindings)).toEqual(['B1', 'B3']);
      expect(applied.map(({ origin }) => origin)).toEqual(['key']);
      bus.undo('toolbar');
      expect(store.document()).toEqual(before);
    });

    it('takes an edge away while both of its ends are there, which is the binding that it stood for', () => {
      handler.handle({ type: 'delete', nodes: [], edges: ['E1>Q1'], by: 'pointer' });

      expect(Object.keys(store.document().bindings)).toEqual(['B2', 'B3']);
      expect(store.document().queues['Q1']).toBeDefined();
      expect(applied.map(({ origin }) => origin)).toEqual(['gesture']);
    });

    it('takes an edge and a node in one step, edges first, so that no edge is taken twice', () => {
      handler.handle({ type: 'delete', nodes: ['Q1'], edges: ['E1>Q1'], by: 'keyboard' });

      expect(store.document().queues['Q1']).toBeUndefined();
      expect(store.document().consumers['C1']?.queues).toEqual([]);
      expect(applied).toHaveLength(1);
    });

    it('says what it did, on the status line', () => {
      handler.handle({ type: 'delete', nodes: ['Q2'], edges: [], by: 'keyboard' });

      expect(status.notice()).toEqual({ kind: 'message', text: 'Deleted queue archive.' });
    });

    it('does nothing for a node that is not there', () => {
      handler.handle({ type: 'delete', nodes: ['gone'], edges: [], by: 'keyboard' });

      expect(applied).toEqual([]);
    });

    it('is also what the menu and the inspector do, for what is selected, with the origin that they give', () => {
      selection.select(['Q2']);

      handler.deleteSelected('menu');

      expect(store.document().queues['Q2']).toBeUndefined();
      expect(applied.map(({ origin }) => origin)).toEqual(['menu']);
    });
  });

  describe('a link', () => {
    it('is made with the command that the rules choose, and says that a gesture made it', () => {
      handler.handle({ type: 'link', source: 'E1', target: 'Q2', via: 'drag' });

      expect(Object.values(store.document().bindings).filter(({ dest }) => dest.id === 'Q2')).toHaveLength(2);
      expect(applied.map(({ origin }) => origin)).toEqual(['gesture']);
    });

    it('says that it came from a key when it was made from the keyboard', () => {
      handler.handle({ type: 'link', source: 'E1', target: 'Q2', via: 'keyboard' });

      expect(applied.map(({ origin }) => origin)).toEqual(['key']);
    });

    it('counts a click on two handles as a gesture', () => {
      handler.handle({ type: 'link', source: 'E1', target: 'Q2', via: 'click' });

      expect(applied.map(({ origin }) => origin)).toEqual(['gesture']);
    });

    it('is refused, in the words of the rule, when the rules do not allow it, and changes nothing', () => {
      const before = store.document();

      handler.handle({ type: 'link', source: 'P1', target: 'E3', via: 'drag' });

      expect(store.document()).toBe(before);
      expect(status.refusal()?.issue.message).toBe(explainLink(before, 'P1', 'E3'));
      expect(status.refusal()?.origin).toBe('gesture');
      expect(announcer.announce).toHaveBeenCalledWith(explainLink(before, 'P1', 'E3'), 'assertive');
    });

    it('is explained, when it was dropped on a node that the rules do not allow, in the words of the rule', () => {
      const before = store.document();

      handler.handle({ type: 'link-invalid', source: 'E3', target: 'P1', via: 'drag' });

      expect(status.refusal()?.issue.message).toBe(explainLink(before, 'E3', 'P1'));
      expect(store.document()).toBe(before);
    });

    it('says that there is nothing to link to when it was dropped on nothing', () => {
      handler.handle({
        type: 'link-to-empty',
        source: 'E1',
        at: { x: 1, y: 2 },
        client: { x: 3, y: 4 },
        via: 'drag',
      });

      expect(status.notice()).toEqual({
        kind: 'message',
        text: 'There is nothing to link to where you let go. Drop the link on a node.',
      });
      expect(announcer.announce).toHaveBeenCalledWith(
        'There is nothing to link to where you let go. Drop the link on a node.',
      );
      expect(applied).toEqual([]);
    });
  });

  describe('a rename', () => {
    it('gives the node another name, and answers the document that the command made', () => {
      const result = handler.rename('Q1', 'payments', 'menu');

      expect(result?.ok).toBe(true);
      expect(store.document().queues['Q1']?.name).toBe('payments');
      expect(applied.map(({ origin, command }) => [origin, command.type])).toEqual([['menu', 'rename']]);
    });

    it('answers why when the name is refused, and changes nothing, so that a field can say it', () => {
      const before = store.document();

      const result = handler.rename('Q1', 'archive', 'key');

      expect(result?.ok).toBe(false);
      expect(!result?.ok && result?.error.kind).toBe('duplicate-name');
      expect(store.document()).toBe(before);
      expect(status.refusal()?.origin).toBe('key');
    });

    it('answers nothing for a node that is not on the canvas, and applies nothing', () => {
      expect(handler.rename('gone', 'x', 'key')).toBeUndefined();
      expect(applied).toEqual([]);
    });
  });

  describe('a delete that a menu asks for', () => {
    it('deletes the node that the menu was opened on, whether or not it is selected', () => {
      selection.select(['C1']);

      handler.deleteTarget({ kind: 'node', id: 'Q2' }, 'menu');

      expect(store.document().queues['Q2']).toBeUndefined();
      expect(store.document().consumers['C1']).toBeDefined();
      expect(applied.map(({ origin }) => origin)).toEqual(['menu']);
    });

    it('takes away the edge that the menu was opened on, and no node', () => {
      handler.deleteTarget({ kind: 'edge', key: 'E1>Q1' }, 'menu');

      expect(Object.keys(store.document().bindings)).toEqual(['B2', 'B3']);
      expect(store.document().queues['Q1']).toBeDefined();
    });
  });

  describe('what the editor shows', () => {
    it('opens a menu where the canvas says, for what it says', () => {
      const surface: IntentSurface = { openMenu: vi.fn(), startRename: vi.fn() };
      handler.surface = surface;

      handler.handle({ type: 'context-menu', target: { kind: 'node', id: 'Q1' }, client: { x: 10, y: 20 } });

      expect(surface.openMenu).toHaveBeenCalledWith({ kind: 'node', id: 'Q1' }, { x: 10, y: 20 });
    });

    it('starts a rename of the node that the canvas says', () => {
      const surface: IntentSurface = { openMenu: vi.fn(), startRename: vi.fn() };
      handler.surface = surface;

      handler.handle({ type: 'rename', id: 'Q1' });

      expect(surface.startRename).toHaveBeenCalledWith('Q1');
    });

    it('does nothing about a menu or a rename before the editor has a surface for them', () => {
      expect(() => {
        handler.handle({ type: 'context-menu', target: { kind: 'node', id: 'Q1' }, client: { x: 0, y: 0 } });
        handler.handle({ type: 'rename', id: 'Q1' });
      }).not.toThrow();
    });
  });

  describe('a node from the toolbox', () => {
    it('is added, selected, and brought into view, when it is clicked', () => {
      handler.add({ kind: 'queue' }, 'gesture');
      expect(viewport.reveal).not.toHaveBeenCalled();
      TestBed.inject(ApplicationRef).tick();

      const [id] = Object.entries(store.document().queues).find(([, record]) => record.name === 'queue1') ?? [];
      expect(id).toBeDefined();
      expect(selection.selection()).toEqual({ nodes: [id], edges: [] });
      const { width, height } = frameOf('queue');
      const where = store.document().layout.nodes[id ?? ''];
      expect(viewport.reveal).toHaveBeenCalledWith({ id, x: where?.x, y: where?.y, width, height });
      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue queue1.' });
    });

    it('gives the new node the next name that is free, for its kind, and the type that was chosen', () => {
      handler.add({ kind: 'exchange', exchangeType: 'headers' }, 'gesture');
      handler.add({ kind: 'exchange', exchangeType: 'headers' }, 'gesture');

      const exchanges = Object.values(store.document().exchanges).filter(({ name }) => name.startsWith('exchange'));
      expect(exchanges.map(({ name, type }) => [name, type]).sort()).toEqual([
        ['exchange1', 'headers'],
        ['exchange2', 'headers'],
      ]);
    });

    it('is put where the middle of the preview was when it is dropped, as one step of undo', () => {
      const before = store.document();

      handler.handle({ type: 'drop-new', node: { kind: 'queue' }, at: { x: 300, y: 200 } });

      const [id] = Object.entries(store.document().queues).find(([, record]) => record.name === 'queue1') ?? [];
      const { width, height } = frameOf('queue');
      expect(store.document().layout.nodes[id ?? '']).toEqual({
        x: Math.round(300 - width / 2),
        y: Math.round(200 - height / 2),
      });
      expect(selection.selection().nodes).toEqual([id]);
      expect(applied).toHaveLength(1);
      bus.undo('toolbar');
      expect(store.document()).toEqual(before);
    });

    it('is refused, and is not selected or brought into view, when the canvas is full', () => {
      const queues = Object.fromEntries(
        Array.from({ length: LIMITS.elements }, (_, index) => [`Q${index}`, queueRecord(`q${index}`)]),
      );
      start(documentOf({ queues }));

      handler.add({ kind: 'consumer' }, 'gesture');
      TestBed.inject(ApplicationRef).tick();

      expect(selection.selection().nodes).toEqual([]);
      expect(viewport.reveal).not.toHaveBeenCalled();
      expect(status.refusal()?.issue.kind).toBe('canvas-full');
    });
  });

  describe('describing what the menu or the inspector acts on', () => {
    it('says the kind and the name', () => {
      expect(handler.describe('Q1')).toBe('queue billing');
      expect(handler.describe('P1')).toBe('producer sender');
    });

    it('says nothing for what is not on the canvas', () => {
      expect(handler.describe('gone')).toBeUndefined();
    });
  });
});
