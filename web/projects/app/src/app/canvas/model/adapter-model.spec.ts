import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { DRAWN_ATTRIBUTE, EDGE_ATTRIBUTE, watchDrawnEdges } from './drawn-edges';
import { FlowViewport, type ViewportDriver } from './flow-viewport';
import { deleteIntent, dropNewIntent, moveIntent, selectIntent } from './from-events';
import { blocksFoblex, CONNECT_KEYS, GRAB_KEYS } from './guard';
import { nodeIdAt, nodeIdOfTarget } from './hit-test';
import { isInView } from './transform';

const press = (key: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('blocksFoblex (ADR-0017)', () => {
  it('holds back Ctrl+M, Cmd+M and Alt+M, which Foblex would take for picking a node up', () => {
    expect(blocksFoblex(press('m', { ctrlKey: true }))).toBe(true);
    expect(blocksFoblex(press('m', { metaKey: true }))).toBe(true);
    expect(blocksFoblex(press('m', { altKey: true }))).toBe(true);
    expect(blocksFoblex(press('M', { ctrlKey: true }))).toBe(true);
  });

  it('lets M through, and Shift+M, which is how a capital is typed, and keys that are not M', () => {
    expect(blocksFoblex(press('m'))).toBe(false);
    expect(blocksFoblex(press('M'))).toBe(false);
    expect(blocksFoblex(press('z', { ctrlKey: true }))).toBe(false);
    expect(blocksFoblex(press('ArrowRight', { ctrlKey: true }))).toBe(false);
    expect(blocksFoblex(press('a', { ctrlKey: true }))).toBe(false);
  });

  it('takes the keys that it holds back as an argument, and defaults to the key that picks up', () => {
    expect(GRAB_KEYS).toEqual(['m']);
    expect(CONNECT_KEYS).toEqual(['l']);
    expect(blocksFoblex(press('l', { ctrlKey: true }), CONNECT_KEYS)).toBe(true);
    expect(blocksFoblex(press('l', { ctrlKey: true }))).toBe(false);
  });

  it('holds back any of the keys that it is given, and not only the first', () => {
    const both = [...GRAB_KEYS, ...CONNECT_KEYS];

    expect(blocksFoblex(press('m', { ctrlKey: true }), both)).toBe(true);
    expect(blocksFoblex(press('l', { ctrlKey: true }), both)).toBe(true);
    expect(blocksFoblex(press('x', { ctrlKey: true }), both)).toBe(false);
  });
});

describe('the events of the library as intents', () => {
  it('makes a selection of the ids that the library reports, as copies', () => {
    const nodeIds = ['a'];
    const connectionIds = ['a>b'];
    const intent = selectIntent({ nodeIds, connectionIds });

    expect(intent).toEqual({ type: 'select', nodes: ['a'], edges: ['a>b'] });
    nodeIds.push('x');
    expect(intent).toEqual({ type: 'select', nodes: ['a'], edges: ['a>b'] });
  });

  it('makes a delete of the same shape, which the editor turns into commands', () => {
    expect(deleteIntent({ nodeIds: ['a', 'b'], connectionIds: ['a>b'] }, 'keyboard')).toEqual({
      type: 'delete',
      nodes: ['a', 'b'],
      edges: ['a>b'],
      by: 'keyboard',
    });
  });

  it('makes a move of every node that was put somewhere, and leaves out one that has no position', () => {
    expect(
      moveIntent(
        {
          nodes: [{ id: 'a', position: { x: 10, y: 20 } }, { id: 'b' }, { id: 'c', position: { x: 0, y: 0 } }],
        },
        'pointer',
      ),
    ).toEqual({
      type: 'move',
      moves: [
        { id: 'a', x: 10, y: 20 },
        { id: 'c', x: 0, y: 0 },
      ],
      by: 'pointer',
    });
  });

  it('makes a drop of what came from the toolbox where the middle of its preview was', () => {
    const node = { kind: 'exchange', exchangeType: 'topic' } as const;

    expect(dropNewIntent({ data: node, externalItemRect: { gravityCenter: { x: 5, y: 6 } } })).toEqual({
      type: 'drop-new',
      node,
      at: { x: 5, y: 6 },
    });
  });

  it('does not take the position of the pointer that the library has for a drop on a node, which is in the page', () => {
    const node = { kind: 'queue' } as const;
    const event = {
      data: node,
      dropPosition: { x: 900, y: 700 },
      externalItemRect: { gravityCenter: { x: 5, y: 6 } },
    };

    expect(dropNewIntent(event)).toMatchObject({ at: { x: 5, y: 6 } });
  });
});

describe('hit testing', () => {
  const page = () => {
    document.body.innerHTML = `
      <div id="outside" data-node-id="ghost"><span id="outside-child"></span></div>
      <div id="host">
        <div data-node-id="q1" id="node"><span id="label">Queue</span><div id="handle"></div></div>
        <div id="empty"></div>
      </div>`;
    const get = (id: string) => document.getElementById(id) as HTMLElement;
    return {
      host: get('host'),
      node: get('node'),
      label: get('label'),
      handle: get('handle'),
      empty: get('empty'),
      outside: get('outside-child'),
    };
  };

  it('is the node that the topmost element at the point belongs to, from anywhere inside it', () => {
    const { host, label, handle, node } = page();

    expect(nodeIdAt([label, host], host)).toBe('q1');
    expect(nodeIdAt([handle], host)).toBe('q1');
    expect(nodeIdAt([node], host)).toBe('q1');
  });

  it('is nothing when the point is on the canvas and not on a node, or on nothing of the canvas at all', () => {
    const { host, empty, outside } = page();

    expect(nodeIdAt([empty, host], host)).toBeNull();
    expect(nodeIdAt([], host)).toBeNull();
    expect(nodeIdAt([outside], host)).toBeNull();
  });

  it('skips what is outside the canvas, on top of it, and finds the node under that', () => {
    const { host, label, outside } = page();

    expect(nodeIdAt([outside, label], host)).toBe('q1');
  });

  it('does not take a node of the page that is not on this canvas for one that is', () => {
    const { host, outside } = page();

    expect(nodeIdAt([outside], host)).toBeNull();
  });

  it('finds the node of the target of an event, and nothing for a target that is not an element', () => {
    const { label, empty } = page();

    expect(nodeIdOfTarget(label)).toBe('q1');
    expect(nodeIdOfTarget(empty)).toBeNull();
    expect(nodeIdOfTarget(null)).toBeNull();
    expect(nodeIdOfTarget(window)).toBeNull();
  });
});

describe('isInView', () => {
  const viewport = { x: 100, y: 50, zoom: 2 };
  const size = { width: 800, height: 600 };

  it('is true when the whole rectangle is inside the canvas, with room to spare', () => {
    expect(isInView(viewport, size, { x: 0, y: 0, width: 100, height: 50 })).toBe(true);
    expect(isInView(viewport, size, { x: 100, y: 100, width: 100, height: 50 })).toBe(true);
  });

  it('is false when any part of it is outside, or so near the edge that it is half hidden', () => {
    expect(isInView(viewport, size, { x: -100, y: 0, width: 100, height: 50 })).toBe(false);
    expect(isInView(viewport, size, { x: 0, y: -100, width: 100, height: 50 })).toBe(false);
    expect(isInView(viewport, size, { x: 330, y: 0, width: 100, height: 50 })).toBe(false);
    expect(isInView(viewport, size, { x: 0, y: 260, width: 100, height: 50 })).toBe(false);
    expect(isInView({ x: 0, y: 0, zoom: 1 }, size, { x: 10, y: 10, width: 50, height: 50 })).toBe(false);
  });

  it('takes the margin as an argument', () => {
    expect(isInView({ x: 0, y: 0, zoom: 1 }, size, { x: 10, y: 10, width: 50, height: 50 }, 5)).toBe(true);
  });

  describe('at the margin, which is 24 pixels unless it is said', () => {
    const plain = { x: 0, y: 0, zoom: 1 };
    const host = { width: 400, height: 300 };

    it('is in view when it is exactly the margin from each edge, and not when it is a pixel closer', () => {
      // The rectangle is 100 by 50, and the host 400 by 300, so it fits between 24 and 376 across, and 24 and 276 down.
      expect(isInView(plain, host, { x: 24, y: 24, width: 100, height: 50 })).toBe(true);
      expect(isInView(plain, host, { x: 23, y: 24, width: 100, height: 50 })).toBe(false);
      expect(isInView(plain, host, { x: 24, y: 23, width: 100, height: 50 })).toBe(false);
      expect(isInView(plain, host, { x: 276, y: 24, width: 100, height: 50 })).toBe(true);
      expect(isInView(plain, host, { x: 277, y: 24, width: 100, height: 50 })).toBe(false);
      expect(isInView(plain, host, { x: 24, y: 226, width: 100, height: 50 })).toBe(true);
      expect(isInView(plain, host, { x: 24, y: 227, width: 100, height: 50 })).toBe(false);
    });

    it('is not in view when it is past the edge by less than the margin, which is half hidden', () => {
      expect(isInView(plain, host, { x: 300, y: 24, width: 100, height: 50 })).toBe(false);
      expect(isInView(plain, host, { x: 24, y: 250, width: 100, height: 50 })).toBe(false);
    });
  });
});

describe('FlowViewport', () => {
  const fakeDriver = (overrides: Partial<ViewportDriver> = {}) => {
    const calls: string[] = [];
    const driver: ViewportDriver = {
      transform: () => ({ position: { x: 10, y: 20 }, scaledPosition: { x: 5, y: 5 }, scale: 2 }),
      host: () => ({ x: 100, y: 50, width: 800, height: 600 }),
      fit: () => calls.push('fit'),
      zoomIn: () => calls.push('zoomIn'),
      zoomOut: () => calls.push('zoomOut'),
      resetZoom: () => calls.push('resetZoom'),
      select: (nodes, edges) => calls.push(`select ${nodes.join(',')} ${edges.join(',')}`),
      focus: () => calls.push('focus'),
      edgePath: (id) => (id === 'a>b' ? 'M0,0 L1,1' : null),
      ...overrides,
    };
    return { driver, calls };
  };
  const make = () => TestBed.runInInjectionContext(() => new FlowViewport());

  it('does nothing and knows nothing until a canvas is attached', () => {
    const viewport = make();

    expect(viewport.live()).toBeNull();
    expect(viewport.toCanvas({ x: 1, y: 1 })).toBeNull();
    expect(viewport.edgePath('a>b')).toBeNull();
    expect(() => {
      viewport.fit();
      viewport.zoomIn();
      viewport.zoomOut();
      viewport.resetZoom();
      viewport.select(['a']);
      viewport.focus();
      viewport.reveal({ id: 'a', x: 0, y: 0, width: 1, height: 1 });
    }).not.toThrow();
    expect(viewport.zoom()).toBe(1);
    expect(viewport.drawn().size).toBe(0);
  });

  it('reads the live viewport from the transform that the canvas has now, every time', () => {
    const viewport = make();
    let scale = 2;
    viewport.attach(
      fakeDriver({ transform: () => ({ position: { x: 10, y: 20 }, scaledPosition: { x: 5, y: 5 }, scale }) }).driver,
    );

    expect(viewport.live()).toEqual({ x: 15, y: 25, zoom: 2 });
    scale = 3;
    expect(viewport.live()).toEqual({ x: 15, y: 25, zoom: 3 });
  });

  it('takes a point of the page to the canvas, from where the host is and how far it is zoomed', () => {
    const viewport = make();
    viewport.attach(fakeDriver().driver);

    // The host is at (100, 50) on the page, and the viewport puts the canvas origin at (15, 25) in it, at zoom 2.
    expect(viewport.toCanvas({ x: 100 + 15 + 40, y: 50 + 25 + 20 })).toEqual({ x: 20, y: 10 });
  });

  it('takes a rectangle of the canvas to the host, at the size that it is drawn, which is where a field goes that edits it', () => {
    const viewport = make();
    viewport.attach(fakeDriver().driver);

    // The viewport puts the canvas origin at (15, 25) of the host, at zoom 2.
    expect(viewport.onHost({ x: 20, y: 10, width: 140, height: 56 })).toEqual({
      x: 15 + 40,
      y: 25 + 20,
      width: 280,
      height: 112,
    });
  });

  it('has no place on the host for a rectangle until a canvas is attached', () => {
    expect(make().onHost({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it('passes what the app asks to the canvas', () => {
    const viewport = make();
    const { driver, calls } = fakeDriver();
    viewport.attach(driver);

    viewport.fit();
    viewport.zoomIn();
    viewport.zoomOut();
    viewport.resetZoom();
    viewport.select(['a', 'b'], ['a>b']);
    viewport.select(['c']);
    viewport.focus();

    expect(calls).toEqual(['fit', 'zoomIn', 'zoomOut', 'resetZoom', 'select a,b a>b', 'select c ', 'focus']);
    expect(viewport.edgePath('a>b')).toBe('M0,0 L1,1');
    expect(viewport.edgePath('x>y')).toBeNull();
  });

  it('fits the canvas to show everything when a node is out of view, and leaves the canvas alone when it is in view', () => {
    const viewport = make();
    const { driver, calls } = fakeDriver();
    viewport.attach(driver);

    viewport.reveal({ id: 'near', x: 20, y: 20, width: 100, height: 50 });
    expect(calls).toEqual([]);

    viewport.reveal({ id: 'far', x: 5_000, y: 5_000, width: 100, height: 50 });
    expect(calls).toEqual(['fit']);
  });

  it('stops steering a canvas that has been detached, and forgets its edges', () => {
    const viewport = make();
    const { driver, calls } = fakeDriver();
    const detach = viewport.attach(driver);
    viewport.markDrawn(['a>b']);

    detach();
    viewport.fit();

    expect(calls).toEqual([]);
    expect(viewport.live()).toBeNull();
    expect(viewport.drawn().size).toBe(0);
  });

  it('does not let a canvas that was replaced detach the one that replaced it', () => {
    const viewport = make();
    const first = fakeDriver();
    const second = fakeDriver();
    const detachFirst = viewport.attach(first.driver);
    viewport.attach(second.driver);

    detachFirst();
    viewport.fit();

    expect(second.calls).toEqual(['fit']);
  });

  it('keeps the zoom that the canvas reports', () => {
    const viewport = make();

    viewport.setZoom(1.5);

    expect(viewport.zoom()).toBe(1.5);
  });

  it('keeps the set of the edges that are drawn, and changes it only when it changes', () => {
    const viewport = make();
    const seen = [viewport.drawn()];

    viewport.markDrawn(['a>b', 'c>d']);
    seen.push(viewport.drawn());
    viewport.markDrawn(['a>b']);
    seen.push(viewport.drawn());
    viewport.markGone(['a>b']);
    seen.push(viewport.drawn());
    viewport.markGone(['x>y']);
    seen.push(viewport.drawn());

    expect([...(seen[1] ?? [])]).toEqual(['a>b', 'c>d']);
    expect(seen[2]).toBe(seen[1]);
    expect([...(seen[3] ?? [])]).toEqual(['c>d']);
    expect(seen[4]).toBe(seen[3]);
  });
});

describe('watchDrawnEdges (ADR-0016, workaround 3)', () => {
  const edge = (container: Element, id: string, d: string | null) => {
    const element = document.createElement('f-connection');
    element.setAttribute(EDGE_ATTRIBUTE, id);
    const path = document.createElement('path');
    path.classList.add('f-connection-path');
    if (d !== null) {
      path.setAttribute('d', d);
    }
    element.append(path);
    container.append(element);
    return { element, path };
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const reports = () => {
    const seen = { drawn: [] as string[][], gone: [] as string[][] };
    return {
      seen,
      report: { drawn: (ids: string[]) => seen.drawn.push(ids), gone: (ids: string[]) => seen.gone.push(ids) },
    };
  };

  it('says that an edge is drawn when its path has a d, and not before, and marks its element', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);

    const { element, path } = edge(container, 'a>b', null);
    await settle();
    expect(seen.drawn).toEqual([]);
    expect(element.hasAttribute(DRAWN_ATTRIBUTE)).toBe(false);

    path.setAttribute('d', 'M0,0 L10,10');
    await settle();

    expect(seen.drawn).toEqual([['a>b']]);
    expect(element.getAttribute(DRAWN_ATTRIBUTE)).toBe('a>b');
    stop();
  });

  it('does not say that an edge is drawn for a d that is empty, or for a path that is not an edge’s', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const { path } = edge(container, 'a>b', null);
    const stray = document.createElement('path');
    container.append(stray);

    path.setAttribute('d', '');
    stray.setAttribute('d', 'M0,0');
    await settle();

    expect(seen.drawn).toEqual([]);
    stop();
  });

  it('says it once for each edge in a burst, however many times the path changes', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const first = edge(container, 'a>b', null);
    const second = edge(container, 'c>d', null);

    first.path.setAttribute('d', 'M0,0 L1,1');
    first.path.setAttribute('d', 'M0,0 L2,2');
    second.path.setAttribute('d', 'M0,0 L3,3');
    await settle();

    expect(seen.drawn).toHaveLength(1);
    expect([...(seen.drawn[0] ?? [])].sort()).toEqual(['a>b', 'c>d']);
    stop();
  });

  it('reports the edges that are already drawn when it starts', () => {
    const container = document.createElement('div');
    edge(container, 'a>b', 'M0,0 L1,1');
    edge(container, 'c>d', null);
    const { seen, report } = reports();

    watchDrawnEdges(container, report)();

    expect(seen.drawn).toEqual([['a>b']]);
  });

  it('says that an edge is gone when its element is taken away, or the subtree that holds it', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const one = edge(container, 'a>b', 'M0,0 L1,1');
    const wrapper = document.createElement('div');
    container.append(wrapper);
    const two = edge(wrapper, 'c>d', 'M0,0 L1,1');
    await settle();

    one.element.remove();
    await settle();
    wrapper.remove();
    await settle();

    expect(seen.gone).toEqual([['a>b'], ['c>d']]);
    expect(two.element.isConnected).toBe(false);
    stop();
  });

  it('does not take text or an element that is not an edge for an edge that is gone', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const text = document.createTextNode('x');
    const other = document.createElement('div');
    container.append(text, other);
    await settle();

    text.remove();
    other.remove();
    await settle();

    expect(seen.gone).toEqual([]);
    stop();
  });

  it('does not say that an edge is gone when its element is moved in the container, which the library does to the edge that it selects', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const first = edge(container, 'a>b', 'M0,0 L1,1');
    edge(container, 'c>d', 'M0,0 L2,2');
    await settle();
    expect(seen.drawn).toEqual([['a>b', 'c>d']]);

    container.append(first.element);
    await settle();

    expect(seen.gone).toEqual([]);
    expect(seen.drawn).toEqual([['a>b', 'c>d']]);
    stop();
  });

  it('says that an edge is gone when its path loses its d, and that it is drawn when the path has one again', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const { path } = edge(container, 'a>b', 'M0,0 L1,1');
    await settle();

    path.setAttribute('d', '');
    await settle();
    expect(seen.gone).toEqual([['a>b']]);

    path.setAttribute('d', 'M0,0 L5,5');
    await settle();
    expect(seen.drawn).toEqual([['a>b'], ['a>b']]);
    stop();
  });

  it('says nothing when the path of a drawn edge is only drawn another way', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const { path } = edge(container, 'a>b', 'M0,0 L1,1');
    await settle();

    path.setAttribute('d', 'M0,0 L9,9');
    await settle();

    expect(seen.drawn).toEqual([['a>b']]);
    expect(seen.gone).toEqual([]);
    stop();
  });

  it('says that an edge is drawn when its path is, in a burst that has a change that is not news as well', async () => {
    const container = document.createElement('div');
    const { seen, report } = reports();
    const stop = watchDrawnEdges(container, report);
    const { path } = edge(container, 'a>b', null);
    const stray = document.createElement('path');
    container.append(stray);
    await settle();

    path.setAttribute('d', 'M0,0 L1,1');
    stray.setAttribute('d', 'M5,5');
    await settle();

    expect(seen.drawn).toEqual([['a>b']]);
    stop();
  });

  it('does not look at the container again for a path that is only drawn another way, or for one that is not an edge’s', async () => {
    const container = document.createElement('div');
    const { report } = reports();
    const { path } = edge(container, 'a>b', 'M0,0 L1,1');
    const stray = document.createElement('path');
    container.append(stray);
    const stop = watchDrawnEdges(container, report);
    const scan = vi.spyOn(container, 'querySelectorAll');

    path.setAttribute('d', 'M0,0 L9,9');
    stray.setAttribute('d', 'M5,5');
    await settle();

    expect(scan).not.toHaveBeenCalled();
    stop();
  });

  it('stops watching when it is stopped', async () => {
    const container = document.createElement('div');
    const report = { drawn: vi.fn(), gone: vi.fn() };
    const stop = watchDrawnEdges(container, report);
    const { path } = edge(container, 'a>b', null);
    stop();

    path.setAttribute('d', 'M0,0 L1,1');
    await settle();

    expect(report.drawn).not.toHaveBeenCalled();
  });
});
