import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../app-info';
import { FLAG_SOURCES, FeatureFlags } from '../flags/feature-flags';
import { createDebugHandle, installDebugHandle, provideDebugHandle } from './debug-handle';

function flagsWith(stored: string | null): FeatureFlags {
  TestBed.configureTestingModule({ providers: [{ provide: FLAG_SOURCES, useValue: { stored, query: null } }] });
  return TestBed.inject(FeatureFlags);
}

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
});

describe('installDebugHandle', () => {
  const handle = { app: 'x', flags: () => [] };

  it('defines a property that cannot be reassigned, deleted or redefined, and that is not listed', () => {
    const target: Record<string, unknown> = {};
    installDebugHandle(target, handle);

    expect(target['__rmq']).toBe(handle);
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
    installDebugHandle(target, handle);

    expect(() => installDebugHandle(target, { app: 'second', flags: () => [] })).not.toThrow();
    expect(target['__rmq']).toBe(handle);
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

    const installed = (fakeWindow as { __rmq?: { app: string; flags: () => string[] } }).__rmq;
    expect(installed?.app).toBe(APP_NAME);
    expect(installed?.flags()).toEqual(['headers']);
  });

  it('copes with a document that has no window', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }, provideDebugHandle()],
    });

    expect(() => TestBed.inject(FeatureFlags)).not.toThrow();
  });
});
