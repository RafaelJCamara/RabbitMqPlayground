import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createEngine } from '@rmq/engine';
import { documentOf, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../app-info';
import { FLAG_SOURCES, FeatureFlags } from '../flags/feature-flags';
import { createDebugHandle, installDebugHandle, provideDebugHandle } from './debug-handle';
import { DebugSources, type EditorDebugSources } from './debug-sources';

function flagsWith(stored: string | null): FeatureFlags {
  TestBed.configureTestingModule({ providers: [{ provide: FLAG_SOURCES, useValue: { stored, query: null } }] });
  return TestBed.inject(FeatureFlags);
}

const document = documentOf({ queues: { q1: queueRecord('billing') } });
const state = {
  now: 300,
  running: false,
  speed: 2,
  nextAt: 450,
  view: createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } }).view(),
};
const editor: EditorDebugSources = {
  document: () => document,
  selection: () => ({ nodes: ['q1'], edges: ['x1>q1'] }),
  drawnEdges: () => ['x1>q1'],
  intents: () => [{ type: 'select' }],
  viewport: () => ({ x: 10, y: 20, zoom: 1.5 }),
  simulationState: () => state,
};

describe('createDebugHandle', () => {
  it('names the app and lists the flags that are on', () => {
    const handle = createDebugHandle(flagsWith('editor,share'));

    expect(handle.app).toBe(APP_NAME);
    expect([...handle.flags()].sort()).toEqual(['editor', 'share']);
  });

  it('is frozen, and hands out a copy of the flags, so a test cannot change the app through it', () => {
    const handle = createDebugHandle(flagsWith('editor'));

    expect(Object.isFrozen(handle)).toBe(true);
    (handle.flags() as string[]).push('share');
    expect(handle.flags()).toEqual(['editor']);
  });

  it('knows nothing of the editor until there is one', () => {
    const handle = createDebugHandle(flagsWith(null));

    expect(handle.document()).toBeNull();
    expect(handle.selection()).toEqual({ nodes: [], edges: [] });
    expect(handle.drawnEdges()).toEqual([]);
    expect(handle.intents()).toEqual([]);
    expect(handle.viewport()).toBeNull();
    expect(handle.simulationState()).toBeNull();
  });

  it('says what the editor shows, while it is open, and nothing once it is gone', () => {
    const sources = new DebugSources();
    const handle = createDebugHandle(flagsWith(null), sources);
    const detach = sources.attach(editor);

    expect(handle.document()).toBe(document);
    expect(handle.selection()).toEqual({ nodes: ['q1'], edges: ['x1>q1'] });
    expect(handle.drawnEdges()).toEqual(['x1>q1']);
    expect(handle.intents()).toEqual([{ type: 'select' }]);
    expect(handle.viewport()).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(handle.simulationState()).toBe(state);

    detach();
    expect(handle.document()).toBeNull();
    expect(handle.viewport()).toBeNull();
  });

  it('hands out copies of what it lists, so that a test cannot change the editor through them', () => {
    const sources = new DebugSources();
    const handle = createDebugHandle(flagsWith(null), sources);
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
  const flags = () => ({ enabled: [] }) as unknown as FeatureFlags;
  const handle = () => createDebugHandle(flags());

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
      providers: [
        { provide: DOCUMENT, useValue: { defaultView: fakeWindow } },
        { provide: FLAG_SOURCES, useValue: { stored: 'headers', query: null } },
        provideDebugHandle(),
      ],
    });
    TestBed.inject(FeatureFlags); // creating the environment injector runs the initializer

    const installed = (fakeWindow as { __rmq?: { app: string; flags: () => string[]; document: () => unknown } }).__rmq;
    expect(installed?.app).toBe(APP_NAME);
    expect(installed?.flags()).toEqual(['headers']);
    expect(installed?.document()).toBeNull();
  });

  it('reads from the editor that attaches to the sources of the app', () => {
    const fakeWindow = {};
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: { defaultView: fakeWindow } },
        { provide: FLAG_SOURCES, useValue: { stored: null, query: null } },
        provideDebugHandle(),
      ],
    });
    TestBed.inject(FeatureFlags);
    TestBed.inject(DebugSources).attach(editor);

    const installed = (fakeWindow as { __rmq?: { drawnEdges: () => unknown } }).__rmq;
    expect(installed?.drawnEdges()).toEqual(['x1>q1']);
  });

  it('copes with a document that has no window', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }, provideDebugHandle()],
    });

    expect(() => TestBed.inject(FeatureFlags)).not.toThrow();
  });
});
