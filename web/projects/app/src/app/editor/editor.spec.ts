import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { transientQueueReply } from '@rmq/engine';
import { createMemoryRepository, type CanvasRepository } from '@rmq/persistence';
import { manualClock, manualTimer } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkRules } from '@rmq/domain';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasVm } from '../canvas/model/canvas-vm';
import type { CanvasIntent } from '../canvas/model/intents';
import { Announcer } from '../core/announcer';
import { APP_NAME } from '../core/app-info';
import {
  AUTOSAVE_TIMER,
  NOW,
  REPOSITORIES,
  STORAGE_MANAGER,
  UNTITLED,
  type RepositoryFactories,
} from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import type { Selection } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { THEME_STORAGE_KEY } from '../core/theme/theme';
import { Editor } from './editor';

/**
 * The canvas as the editor sees it, without a library to draw it: jsdom has no layout, no `ResizeObserver` and no worker, so the
 * real one cannot be drawn in a unit test. It takes what the real one takes and reports what the real one reports, and the real
 * one is covered by the end-to-end journeys and the contract suite (ADR-0018, ADR-0034).
 */
@Component({ selector: 'rmq-flow-canvas', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class FakeCanvas {
  readonly model = input.required<CanvasVm>();
  readonly selection = input.required<Selection>();
  readonly rules = input<LinkRules>();
  readonly intent = output<CanvasIntent>();
  /** What the editor asked of the canvas, in order. */
  readonly calls: string[] = [];

  constructor() {
    // The canvas is a 800 by 600 box at the corner of the page, at 100%, and does what it is asked by writing it down.
    inject(FlowViewport).attach({
      transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
      host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      fit: () => this.calls.push('fit'),
      zoomIn: () => this.calls.push('zoomIn'),
      zoomOut: () => this.calls.push('zoomOut'),
      resetZoom: () => this.calls.push('resetZoom'),
      select: () => undefined,
      focus: () => this.calls.push('focus'),
      edgePath: () => null,
    });
  }
}

function renderEditor(providers: ReturnType<typeof harness>['providers']) {
  TestBed.overrideComponent(Editor, { remove: { imports: [FlowCanvas] }, add: { imports: [FakeCanvas] } });
  return render(Editor, { providers });
}

function harness(options: { readonly browser?: (memory: CanvasRepository) => CanvasRepository } = {}) {
  const clock = manualClock();
  const timer = manualTimer();
  const memory = createMemoryRepository({ now: clock.now, newId: () => 'canvas1' });
  const storage = {
    persist: vi.fn(async () => true),
    persisted: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 1, quota: 1_000 })),
  };
  const factories: RepositoryFactories = {
    browser: () => options.browser?.(memory) ?? memory,
    memory: () => createMemoryRepository({ now: clock.now, newId: () => 'canvas2' }),
  };
  return {
    memory,
    timer,
    storage,
    providers: [
      { provide: REPOSITORIES, useValue: factories },
      { provide: AUTOSAVE_TIMER, useValue: timer },
      { provide: NOW, useValue: clock.now },
      { provide: STORAGE_MANAGER, useValue: storage },
    ],
  };
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('Editor', () => {
  it('has the one heading, which names the product, and the regions of the layout of ADR-0010', async () => {
    await renderEditor(harness().providers);

    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Toolbox' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Canvas' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Status' })).toBeInTheDocument();
  });

  it('opens the one implicit canvas, and says that its changes are saved', async () => {
    const { providers, memory } = harness();
    await renderEditor(providers);

    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    expect(screen.queryByTestId('opening')).not.toBeInTheDocument();
    const listed = await memory.list();
    expect(listed.ok && listed.value.canvases.map((canvas) => canvas.name)).toEqual([UNTITLED]);
  });

  it('says what each write came to, and says why when it failed', async () => {
    const { providers, timer } = harness({
      browser: (memory) => ({
        ...memory,
        save: async () => ({
          ok: false,
          error: { kind: 'quota-exceeded', message: 'The browser has no room left to keep this canvas.' },
        }),
      }),
    });
    const { fixture } = await renderEditor(providers);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

    const bus = fixture.debugElement.injector.get(CommandBus);
    bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    fixture.detectChanges();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saving…');

    timer.advance(500);
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved. The browser has no room left'),
    );
  });

  it('says aloud, assertively, that a write failed, and does not let the warning about room take its place', async () => {
    const { providers, timer, storage } = harness({
      browser: (memory) => ({
        ...memory,
        save: async () => ({
          ok: false,
          error: { kind: 'quota-exceeded', message: 'The browser has no room left to keep this canvas.' },
        }),
      }),
    });
    storage.estimate.mockResolvedValue({ usage: 990, quota: 1_000 });
    const { fixture } = await renderEditor(providers);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    const announce = vi.spyOn(fixture.debugElement.injector.get(Announcer), 'announce');

    fixture.debugElement.injector
      .get(CommandBus)
      .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    timer.advance(500);
    await waitFor(() => expect(screen.getByTestId('quota')).toBeInTheDocument());

    const said = announce.mock.calls.filter(
      ([message]) => message.startsWith('Not saved.') || message.includes('almost no room'),
    );
    expect(
      said.map(([message, politeness]) => [message.startsWith('Not saved.') ? 'failure' : 'warning', politeness]),
    ).toEqual([
      ['failure', 'assertive'],
      ['warning', 'polite'],
    ]);
  });

  it('says that nothing is kept when the browser will not let the site keep canvases', async () => {
    const { providers } = harness({
      browser: (memory) => ({
        ...memory,
        list: async () => ({
          ok: false,
          error: { kind: 'unavailable', message: 'The browser does not let this site keep canvases here.' },
        }),
      }),
    });
    await renderEditor(providers);

    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('Not kept after you close this tab.'),
    );
    expect(screen.getByTestId('save-state')).toHaveTextContent('does not let this site keep canvases');
  });

  describe('the canvas', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      return { ...view, canvas, user: userEvent.setup() };
    }

    it('is given the nodes of the document, drawn, when a node is added from the toolbox', async () => {
      const { canvas, user, fixture } = await openEditor();
      expect(canvas().model().nodes).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      expect(
        canvas()
          .model()
          .nodes.map(({ kind, name }) => [kind, name]),
      ).toEqual([['queue', 'queue1']]);
      expect(canvas().selection().nodes).toHaveLength(1);
    });

    it('is given the link rules of the document, so that it can offer the targets that are valid', async () => {
      const { canvas, user, fixture } = await openEditor();

      await user.click(screen.getByRole('button', { name: 'Producer' }));
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      const idOf = (kind: string) =>
        canvas()
          .model()
          .nodes.find((node) => node.kind === kind)!.id;
      expect(canvas().rules()?.allowedTargets(idOf('producer'))).toContain(idOf('queue'));
    });

    it('is where a selection is made, and the editor holds what the canvas reports', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      const [queue] = canvas().model().nodes;

      canvas().intent.emit({ type: 'select', nodes: [], edges: [] });
      fixture.detectChanges();
      expect(canvas().selection()).toEqual({ nodes: [], edges: [] });

      canvas().intent.emit({ type: 'select', nodes: [queue!.id], edges: [] });
      fixture.detectChanges();
      expect(canvas().selection()).toEqual({ nodes: [queue!.id], edges: [] });
    });

    it('shows what is selected in the inspector, and a change there is drawn', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      const name = screen.getByRole('textbox', { name: 'Name' });
      expect(name).toHaveValue('queue1');
      await user.clear(name);
      await user.type(name, 'payments');
      await user.tab();
      fixture.detectChanges();

      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toEqual(['payments']);
    });

    it('turns what is dropped on it from the toolbox into a node where the preview was', async () => {
      const { canvas, fixture } = await openEditor();

      canvas().intent.emit({ type: 'drop-new', node: { kind: 'consumer' }, at: { x: 400, y: 300 } });
      fixture.detectChanges();

      const [consumer] = canvas().model().nodes;
      expect(consumer).toMatchObject({ kind: 'consumer', name: 'consumer1' });
      expect(consumer?.x).toBeLessThan(400);
      expect(consumer?.y).toBeLessThan(300);
    });

    it('turns a link that it reports into a binding, and the edge is drawn', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Direct exchange' }));
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();
      const idOf = (kind: string) =>
        canvas()
          .model()
          .nodes.find((node) => node.kind === kind)!.id;
      const [exchange, queue] = [idOf('exchange'), idOf('queue')];

      canvas().intent.emit({ type: 'link', source: exchange, target: queue, via: 'drag' });
      fixture.detectChanges();

      expect(
        canvas()
          .model()
          .edges.map(({ source, target }) => [source, target]),
      ).toEqual([[exchange, queue]]);
    });

    it('turns a delete that it reports into one that can be undone from the top bar', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      const [queue] = canvas().model().nodes;

      canvas().intent.emit({ type: 'delete', nodes: [queue!.id], edges: [], by: 'keyboard' });
      fixture.detectChanges();
      expect(canvas().model().nodes).toEqual([]);

      fixture.debugElement.injector.get(CommandBus).undo();
      fixture.detectChanges();
      expect(canvas().model().nodes).toHaveLength(1);
    });
  });

  describe('the context menu', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();
      const [queue] = canvas().model().nodes;
      const openMenu = async () => {
        canvas().intent.emit({
          type: 'context-menu',
          target: { kind: 'node', id: queue!.id },
          client: { x: 50, y: 60 },
        });
        view.fixture.detectChanges();
        return screen.findByRole('menu', { name: 'Actions for queue queue1' });
      };
      return { ...view, canvas, user, queue: queue!, openMenu };
    }

    it('opens for the node that the canvas names, with what can be done to it', async () => {
      const { openMenu } = await openEditor();

      await openMenu();

      expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument();
    });

    it('selects what it was opened on, so that the inspector shows it', async () => {
      const { canvas, openMenu, fixture } = await openEditor();
      canvas().intent.emit({ type: 'select', nodes: [], edges: [] });
      fixture.detectChanges();
      expect(canvas().selection().nodes).toEqual([]);

      await openMenu();
      fixture.detectChanges();

      expect(canvas().selection().nodes).toEqual([canvas().model().nodes[0]!.id]);
    });

    it('deletes the node from the menu, with the menu as the origin, and gives the focus back to the canvas', async () => {
      const { canvas, openMenu, user, fixture } = await openEditor();
      await openMenu();
      const seen: string[] = [];
      fixture.debugElement.injector.get(CommandBus).onApplied(({ origin }) => seen.push(origin));

      await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
      fixture.detectChanges();

      expect(canvas().model().nodes).toEqual([]);
      expect(seen).toEqual(['menu']);
      expect(canvas().calls).toContain('focus');
    });

    it('opens the field for a name over the node when Rename is chosen', async () => {
      const { openMenu, user, fixture } = await openEditor();
      await openMenu();

      await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
      fixture.detectChanges();

      expect(await screen.findByRole('textbox', { name: 'Rename queue queue1' })).toBeInTheDocument();
    });

    it('opens for an edge, with delete only, and selects the edge', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Direct exchange' }));
      fixture.detectChanges();
      const idOf = (kind: string) =>
        canvas()
          .model()
          .nodes.find((node) => node.kind === kind)!.id;
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      const [edge] = canvas().model().edges;

      canvas().intent.emit({ type: 'context-menu', target: { kind: 'edge', key: edge!.id }, client: { x: 5, y: 5 } });
      fixture.detectChanges();

      expect(await screen.findByRole('menu', { name: 'Actions for this edge' })).toBeInTheDocument();
      expect(screen.getAllByRole('menuitem')).toHaveLength(1);
      expect(canvas().selection().edges).toEqual([edge!.id]);
    });

    it('gives the focus back to the canvas when it is closed without a choice', async () => {
      const { canvas, openMenu, fixture } = await openEditor();
      await openMenu();
      canvas().calls.length = 0;

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', keyCode: 27 });
      fixture.detectChanges();

      await waitFor(() => expect(canvas().calls).toContain('focus'));
    });
  });

  describe('renaming a node', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();
      const [first] = canvas().model().nodes;
      const field = () => screen.findByRole('textbox', { name: 'Rename queue queue1' });
      const startRename = async () => {
        canvas().intent.emit({ type: 'rename', id: first!.id });
        view.fixture.detectChanges();
        return field();
      };
      return { ...view, canvas, user, first: first!, startRename };
    }

    it('opens a field over the node, with the name in it, when the canvas says that the node was double-clicked', async () => {
      const { startRename } = await openEditor();

      const field = await startRename();

      expect(field).toHaveValue('queue1');
      await waitFor(() => expect(field).toHaveFocus());
    });

    it('renames the node with Enter, and gives the focus back to the canvas', async () => {
      const { startRename, canvas, user, fixture } = await openEditor();
      await startRename();
      canvas().calls.length = 0;

      await user.keyboard('payments{Enter}');
      fixture.detectChanges();

      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toContain('payments');
      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(canvas().calls).toContain('focus');
    });

    it('keeps the field open, with the reason under it, when the name is taken and Enter gave it', async () => {
      const { startRename, canvas, user, fixture } = await openEditor();
      await startRename();

      await user.keyboard('queue2{Enter}');
      fixture.detectChanges();

      expect(screen.getByTestId('rename-field')).toBeInTheDocument();
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('queue2');
      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toEqual(['queue1', 'queue2']);
    });

    it('can be given another name after a refusal', async () => {
      const { startRename, canvas, user, fixture } = await openEditor();
      await startRename();
      await user.keyboard('queue2{Enter}');
      fixture.detectChanges();

      await user.clear(screen.getByTestId('rename-field'));
      await user.keyboard('orders{Enter}');
      fixture.detectChanges();

      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toContain('orders');
      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
    });

    it('closes the field, and says on the status line why, when it is left with a name that is refused', async () => {
      const { startRename, canvas, user, fixture } = await openEditor();
      await startRename();

      await user.keyboard('queue2');
      await user.tab();
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('queue2');
      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toEqual(['queue1', 'queue2']);
    });

    it('closes the field and changes nothing on Escape', async () => {
      const { startRename, canvas, user, fixture } = await openEditor();
      await startRename();
      canvas().calls.length = 0;

      await user.keyboard('payments{Escape}');
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(
        canvas()
          .model()
          .nodes.map((node) => node.name),
      ).toEqual(['queue1', 'queue2']);
      expect(canvas().calls).toContain('focus');
    });

    it('closes the field, with no command, when the name is the one that it had', async () => {
      const { startRename, user, fixture } = await openEditor();
      await startRename();
      const store = fixture.debugElement.injector.get(DocumentStore);
      const before = store.document();

      await user.keyboard('{Enter}');
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(store.document()).toBe(before);
    });

    it('does not open for a node that is not there', async () => {
      const { canvas, fixture } = await openEditor();

      canvas().intent.emit({ type: 'rename', id: 'gone' });
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
    });
  });

  describe('the keyboard', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const fake = () => view.fixture.debugElement.query(By.directive(FakeCanvas));
      const canvas = () => fake().componentInstance as FakeCanvas;
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();
      const [queue] = canvas().model().nodes;
      /** Presses a key on the canvas, which is where the focus is when a learner works on it. */
      const onCanvas = (init: KeyboardEventInit & { key: string }) => {
        fireEvent.keyDown(fake().nativeElement as HTMLElement, init);
        view.fixture.detectChanges();
      };
      return { ...view, canvas, user, queue: queue!, onCanvas };
    }

    it('renames what is selected on F2, in a field over the node, and says that a key started it', async () => {
      const { onCanvas, fixture } = await openEditor();
      const seen: string[] = [];
      fixture.debugElement.injector.get(CommandBus).onApplied(({ origin }) => seen.push(origin));

      onCanvas({ key: 'F2' });

      const field = await screen.findByRole('textbox', { name: 'Rename queue queue1' });
      await waitFor(() => expect(field).toHaveFocus());
      const user = userEvent.setup();
      await user.keyboard('payments{Enter}');
      expect(seen).toEqual(['key']);
    });

    it('says what to do when F2 is pressed with nothing selected', async () => {
      const { onCanvas, canvas, fixture } = await openEditor();
      canvas().intent.emit({ type: 'select', nodes: [], edges: [] });
      fixture.detectChanges();

      onCanvas({ key: 'F2' });

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(fixture.debugElement.injector.get(Announcer).last()).toBe(
        'Select one node first, then press F2 to rename it.',
      );
    });

    it('takes the focus to the inspector on Enter, and Escape in the inspector gives it back to the canvas', async () => {
      const { onCanvas, canvas, user } = await openEditor();
      canvas().calls.length = 0;

      onCanvas({ key: 'Enter' });
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(canvas().calls).toContain('focus');
    });

    it('does nothing on Enter when nothing is selected', async () => {
      const { onCanvas, canvas, fixture } = await openEditor();
      canvas().intent.emit({ type: 'select', nodes: [], edges: [] });
      fixture.detectChanges();

      onCanvas({ key: 'Enter' });

      expect(document.activeElement).not.toBe(screen.queryByRole('textbox', { name: 'Name' }));
    });

    it('fits the canvas on F', async () => {
      const { onCanvas, canvas } = await openEditor();

      onCanvas({ key: 'f' });

      expect(canvas().calls).toContain('fit');
    });

    it('undoes and redoes from the page, with Ctrl+Z and Ctrl+Shift+Z, wherever the focus is in the editor', async () => {
      const { canvas, fixture } = await openEditor();
      const toolbox = screen.getByRole('button', { name: 'Queue' });
      expect(canvas().model().nodes).toHaveLength(1);

      fireEvent.keyDown(toolbox, { key: 'z', ctrlKey: true });
      fixture.detectChanges();
      expect(canvas().model().nodes).toHaveLength(0);

      fireEvent.keyDown(toolbox, { key: 'Z', ctrlKey: true, shiftKey: true });
      fixture.detectChanges();
      expect(canvas().model().nodes).toHaveLength(1);
    });

    it('undoes when the focus is nowhere, which is where it goes when the Undo button has nothing left to undo', async () => {
      const { canvas, fixture } = await openEditor();
      expect(canvas().model().nodes).toHaveLength(1);

      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      fixture.detectChanges();

      expect(canvas().model().nodes).toHaveLength(0);
    });

    it('does not take a key that goes to something outside the editor', async () => {
      const { canvas, fixture } = await openEditor();
      const outside = document.createElement('button');
      document.body.append(outside);

      fireEvent.keyDown(outside, { key: 'z', ctrlKey: true });
      fixture.detectChanges();
      outside.remove();

      expect(canvas().model().nodes).toHaveLength(1);
    });

    it('leaves Ctrl+Z to a field that is typed into, where it undoes the typing and not the canvas', async () => {
      const { canvas, user, fixture } = await openEditor();
      const name = screen.getByRole('textbox', { name: 'Name' });
      await user.click(name);

      fireEvent.keyDown(name, { key: 'z', ctrlKey: true });
      fixture.detectChanges();

      expect(canvas().model().nodes).toHaveLength(1);
    });

    it('does not act on a single key that is pressed outside the canvas', async () => {
      const { canvas } = await openEditor();
      canvas().calls.length = 0;

      fireEvent.keyDown(screen.getByRole('button', { name: 'Queue' }), { key: 'f' });

      expect(canvas().calls).not.toContain('fit');
    });
  });

  describe('the top bar', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      return { ...view, canvas, user: userEvent.setup() };
    }

    it('undoes what the toolbox added, and puts it back', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      await user.click(screen.getByRole('button', { name: 'Undo: added queue queue1' }));
      fixture.detectChanges();
      expect(canvas().model().nodes).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Redo: added queue queue1' }));
      fixture.detectChanges();
      expect(canvas().model().nodes).toHaveLength(1);
    });

    it('arranges the canvas, and fits it once the nodes are in their places', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      await user.click(screen.getByRole('button', { name: 'Producer' }));
      fixture.detectChanges();
      canvas().calls.length = 0;

      await user.click(screen.getByRole('button', { name: 'Auto-layout' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(canvas().calls).toContain('fit');
    });

    it('zooms, resets and fits', async () => {
      const { canvas, user } = await openEditor();

      await user.click(screen.getByRole('button', { name: 'Zoom in' }));
      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
      await user.click(screen.getByRole('button', { name: /^Reset the zoom/ }));
      await user.click(screen.getByRole('button', { name: 'Fit' }));

      expect(canvas().calls).toEqual(['zoomIn', 'zoomOut', 'resetZoom', 'fit']);
    });
  });

  describe('the hint bar', () => {
    it('says what the keys do for what is selected, and changes with the selection', async () => {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const user = userEvent.setup();
      expect(screen.getByRole('region', { name: 'Hints' })).not.toHaveTextContent('F2 Rename');

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();

      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('F2 Rename');
    });
  });

  describe('an empty canvas', () => {
    it('says that it is empty and how to add to it, until something is on it', async () => {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      expect(screen.getByTestId('canvas-empty')).toHaveTextContent('Your canvas is empty.');
      expect(screen.getByTestId('canvas-empty')).toHaveTextContent('Click an item in the toolbox, or drag one here');

      await userEvent.setup().click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();

      expect(screen.queryByTestId('canvas-empty')).not.toBeInTheDocument();
    });

    it('is empty again, and says so, when what was added is undone', async () => {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      view.fixture.detectChanges();

      await user.click(screen.getByRole('button', { name: /^Undo/ }));
      view.fixture.detectChanges();

      expect(screen.getByTestId('canvas-empty')).toBeInTheDocument();
    });
  });

  describe('canvases that cannot be opened', () => {
    const unreadable = (count: number) =>
      harness({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    ...listed.value,
                    unreadable: Array.from({ length: count }, (_, index) => ({
                      id: `newer${index}`,
                      error: {
                        kind: 'newer-version' as const,
                        of: 'schema' as const,
                        found: 9,
                        understood: 1,
                        message: 'Newer.',
                      },
                    })),
                  },
                }
              : listed;
          },
        }),
      });

    it('are counted, with the reason that nothing was changed, and are left alone', async () => {
      await renderEditor(unreadable(1).providers);

      expect(await screen.findByTestId('unreadable')).toHaveTextContent(
        '1 saved canvas in this browser could not be opened, for example because a newer version of the app saved it. Nothing was changed.',
      );
    });

    it('are counted in the plural', async () => {
      await renderEditor(unreadable(3).providers);

      expect(await screen.findByTestId('unreadable')).toHaveTextContent(
        '3 saved canvases in this browser could not be opened, for example because a newer version of the app saved them.',
      );
    });

    it('are not mentioned when there are none', async () => {
      await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      expect(screen.queryByTestId('unreadable')).not.toBeInTheDocument();
    });
  });

  describe('the theme', () => {
    it('is the system’s until the learner chooses, and the choice is applied and kept', async () => {
      const user = userEvent.setup();
      await renderEditor(harness().providers);
      const select = screen.getByRole('combobox', { name: 'Theme' });

      expect(select).toHaveValue('system');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

      await user.selectOptions(select, 'dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

      await user.selectOptions(select, 'light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      await user.selectOptions(select, 'system');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('offers the three choices, in words', async () => {
      await renderEditor(harness().providers);

      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark']);
    });

    it('starts as the choice that was kept', async () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      await renderEditor(harness().providers);

      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
    });
  });

  describe('the status strip', () => {
    it('lets the learner dismiss the note about the browser’s promise, and keeps the warning about room', async () => {
      const user = userEvent.setup();
      const { providers, timer, storage } = harness();
      storage.estimate.mockResolvedValue({ usage: 900, quota: 1_000 });
      storage.persist.mockResolvedValue(false);
      const { fixture } = await renderEditor(providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      timer.advance(500);
      expect(await screen.findByTestId('persistence')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByTestId('persistence')).not.toBeInTheDocument();
      expect(screen.getByTestId('quota')).toBeInTheDocument();
    });

    it('says what was done', async () => {
      const { fixture } = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      fixture.detectChanges();

      expect(screen.getByTestId('status-message')).toHaveTextContent('Added queue billing.');
    });

    it('says why a refusal was made, the root cause first, and the broker’s reply after it', async () => {
      const { fixture } = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: false }, 'gesture');
      fixture.detectChanges();

      const notice = screen.getByTestId('refusal');
      const message = screen.getByTestId('refusal-message');
      const reply = screen.getByTestId('refusal-reply');
      expect(message).toHaveTextContent("Queue 'billing' is not durable.");
      // The broker's text has line breaks in it, which the notice keeps and the matcher folds.
      expect(reply).toHaveTextContent(
        `${transientQueueReply().code} ${transientQueueReply().text.replace(/\s+/g, ' ')}`,
      );
      expect(notice.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
      expect(message.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('does not repeat a refusal that the inspector shows beside the control that made it', async () => {
      const { fixture } = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: false }, 'inspector');
      fixture.detectChanges();

      expect(fixture.debugElement.injector.get(StatusStore).refusal()).not.toBeNull();
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('says when the browser is running out of room, and when it would not promise to keep the canvases', async () => {
      const { providers, timer, storage } = harness();
      storage.estimate.mockResolvedValue({ usage: 900, quota: 1_000 });
      storage.persist.mockResolvedValue(false);
      const { fixture } = await renderEditor(providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      timer.advance(500);

      expect(await screen.findByTestId('quota')).toHaveTextContent('90%');
      expect(await screen.findByTestId('persistence')).toHaveTextContent('backup');
    });
  });
});
