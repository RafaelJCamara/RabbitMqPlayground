import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createEngine } from '@rmq/engine';
import { documentOf, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../app-info';
import { createDebugHandle, installDebugHandle, provideDebugHandle } from './debug-handle';
import { DebugSources, type EditorDebugSources } from './debug-sources';

const document = documentOf({ queues: { q1: queueRecord('billing') } });
const frame = { reducedMotion: true, markers: [] };
const state = {
  now: 300,
  running: false,
  speed: 2,
  nextAt: 450,
  view: createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } }).view(),
};
const log = { count: 2, dropped: 0, rows: [] };
const lit = {
  source: 'auto' as const,
  message: 1,
  title: 'Why? Message 1',
  text: 'Reached billing.',
  edges: [],
  nodes: [{ id: 'q1', mark: 'reached' }],
  gone: 0,
};
const editor: EditorDebugSources = {
  document: () => document,
  selection: () => ({ nodes: ['q1'], edges: ['x1>q1'] }),
  drawnEdges: () => ['x1>q1'],
  intents: () => [{ type: 'select' }],
  viewport: () => ({ x: 10, y: 20, zoom: 1.5 }),
  simulationState: () => state,
  overlayFrame: () => frame,
  explainEventLog: () => log,
  explainEmphasis: () => lit,
};

describe('createDebugHandle', () => {
  it('names the app', () => {
    expect(createDebugHandle().app).toBe(APP_NAME);
  });

  it('is frozen, so a test cannot change the app through it', () => {
    expect(Object.isFrozen(createDebugHandle())).toBe(true);
  });

  it('knows nothing of the editor until there is one', () => {
    const handle = createDebugHandle();

    expect(handle.document()).toBeNull();
    expect(handle.selection()).toEqual({ nodes: [], edges: [] });
    expect(handle.drawnEdges()).toEqual([]);
    expect(handle.intents()).toEqual([]);
    expect(handle.viewport()).toBeNull();
    expect(handle.simulationState()).toBeNull();
    expect(handle.overlayFrame()).toBeNull();
    expect(handle.explainEventLog()).toBeNull();
    expect(handle.explainEmphasis()).toBeNull();
  });

  it('says what the editor shows, while it is open, and nothing once it is gone', () => {
    const sources = new DebugSources();
    const handle = createDebugHandle(sources);
    const detach = sources.attach(editor);

    expect(handle.document()).toBe(document);
    expect(handle.selection()).toEqual({ nodes: ['q1'], edges: ['x1>q1'] });
    expect(handle.drawnEdges()).toEqual(['x1>q1']);
    expect(handle.intents()).toEqual([{ type: 'select' }]);
    expect(handle.viewport()).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(handle.simulationState()).toBe(state);
    expect(handle.overlayFrame()).toBe(frame);
    expect(handle.explainEventLog()).toBe(log);
    expect(handle.explainEmphasis()).toBe(lit);

    detach();
    expect(handle.document()).toBeNull();
    expect(handle.viewport()).toBeNull();
    expect(handle.explainEventLog()).toBeNull();
    expect(handle.explainEmphasis()).toBeNull();
  });

  it('hands out copies of what it lists, so that a test cannot change the editor through them', () => {
    const sources = new DebugSources();
    const handle = createDebugHandle(sources);
    sources.attach(editor);

    (handle.selection().nodes as string[]).push('x');
    (handle.drawnEdges() as string[]).push('x');
    (handle.intents() as unknown[]).push('x');

    expect(handle.selection().nodes).toEqual(['q1']);
    expect(handle.drawnEdges()).toEqual(['x1>q1']);
    expect(handle.intents()).toEqual([{ type: 'select' }]);
  });
});

describe('DebugSources', () => {
  it('lets a later editor replace an earlier one, and does not let the earlier one take the later one away', () => {
    const sources = new DebugSources();
    const other: EditorDebugSources = { ...editor, drawnEdges: () => [] };

    const detachFirst = sources.attach(editor);
    sources.attach(other);
    detachFirst();

    expect(sources.current).toBe(other);
  });
});

describe('installDebugHandle', () => {
  const handle = () => createDebugHandle();

  it('defines a property that cannot be reassigned, deleted or redefined, and that is not listed', () => {
    const target: Record<string, unknown> = {};
    const installed = handle();
    installDebugHandle(target, installed);

    expect(target['__rmq']).toBe(installed);
    expect(Object.keys(target)).toEqual([]);
    expect(() => {
      target['__rmq'] = 'other';
    }).toThrow(TypeError);
    expect(() => {
      delete target['__rmq'];
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(target, '__rmq', { value: 'other' })).toThrow(TypeError);
  });

  it('does nothing when called again, rather than throwing or replacing the first handle', () => {
    const target: Record<string, unknown> = {};
    const installed = handle();
    installDebugHandle(target, installed);

    expect(() => installDebugHandle(target, handle())).not.toThrow();
    expect(target['__rmq']).toBe(installed);
  });
});

describe('provideDebugHandle', () => {
  it('installs the handle on the window when the app starts', () => {
    const fakeWindow = {};
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: fakeWindow } }, provideDebugHandle()],
    });
    TestBed.inject(DebugSources); // creating the environment injector runs the initializer

    const installed = (fakeWindow as { __rmq?: { app: string; document: () => unknown } }).__rmq;
    expect(installed?.app).toBe(APP_NAME);
    expect(installed?.document()).toBeNull();
  });

  it('reads from the editor that attaches to the sources of the app', () => {
    const fakeWindow = {};
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: fakeWindow } }, provideDebugHandle()],
    });
    TestBed.inject(DebugSources).attach(editor);

    const installed = (fakeWindow as { __rmq?: { drawnEdges: () => unknown } }).__rmq;
    expect(installed?.drawnEdges()).toEqual(['x1>q1']);
  });

  it('copes with a document that has no window', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }, provideDebugHandle()],
    });

    expect(() => TestBed.inject(DebugSources)).not.toThrow();
  });
});
