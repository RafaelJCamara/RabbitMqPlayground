import { ChangeDetectionStrategy, Component, inject, input, output, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { transientQueueReply } from '@rmq/engine';
import { createMemoryRepository, type CanvasRepository } from '@rmq/persistence';
import { manualClock, manualFrames, manualTimer } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkRules } from '@rmq/domain';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasVm } from '../canvas/model/canvas-vm';
import type { CanvasIntent } from '../canvas/model/intents';
import { Announcer } from '../core/announcer';
import { APP_NAME } from '../core/app-info';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import {
  AUTOSAVE_TIMER,
  CanvasSession,
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
import { ContextMenu } from './context-menu';
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

function renderEditor(providers: Provider[]) {
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

  it('has no canvas to draw, and says that it is opening one, until the canvas has been opened', async () => {
    let release: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => (release = resolve));
    const { providers } = harness({
      browser: (memory) => ({
        ...memory,
        list: async () => {
          await opened;
          return memory.list();
        },
      }),
    });
    const { fixture } = await renderEditor(providers);

    expect(screen.getByTestId('opening')).toHaveTextContent('Opening your canvas');
    expect(fixture.debugElement.query(By.directive(FakeCanvas))).toBeNull();

    release();
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    expect(screen.queryByTestId('opening')).not.toBeInTheDocument();
    expect(fixture.debugElement.query(By.directive(FakeCanvas))).not.toBeNull();
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

  it('does not say anything assertively for a write that worked', async () => {
    const announce = vi.spyOn(Announcer.prototype, 'announce');
    try {
      const { providers, timer } = harness();
      const { fixture } = await renderEditor(providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      fixture.detectChanges();
      expect(screen.getByTestId('save-state')).toHaveTextContent('Saving…');
      timer.advance(500);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      expect(announce.mock.calls.filter(([, politeness]) => politeness === 'assertive')).toEqual([]);
    } finally {
      announce.mockRestore();
    }
  });

  it.each([
    ['almost no room is left, which is urgent', 990, 'assertive'],
    ['the room is running low, which is not', 850, 'polite'],
  ] as const)('says aloud, with the urgency that it has, when %s', async (_what, usage, politeness) => {
    const { providers, timer, storage } = harness();
    storage.estimate.mockResolvedValue({ usage, quota: 1_000 });
    const { fixture } = await renderEditor(providers);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    const announce = vi.spyOn(fixture.debugElement.injector.get(Announcer), 'announce');

    fixture.debugElement.injector
      .get(CommandBus)
      .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    timer.advance(500);
    await waitFor(() => expect(screen.getByTestId('quota')).toBeInTheDocument());

    const warning = fixture.debugElement.injector.get(CanvasSession).quota();
    expect(announce).toHaveBeenCalledWith(warning?.message, politeness);
  });

  it('says aloud what the browser said when it would not promise to keep the canvases', async () => {
    const { providers, timer, storage } = harness();
    storage.persist.mockResolvedValue(false);
    const { fixture } = await renderEditor(providers);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    const announce = vi.spyOn(fixture.debugElement.injector.get(Announcer), 'announce');

    fixture.debugElement.injector
      .get(CommandBus)
      .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    timer.advance(500);

    await waitFor(() => expect(fixture.debugElement.injector.get(CanvasSession).persistence()).not.toBeNull());
    const note = fixture.debugElement.injector.get(CanvasSession).persistence();
    await waitFor(() => expect(announce).toHaveBeenCalledWith(note?.message));
  });

  it('lets go of the canvas when it is taken away, so that nothing is written after it', async () => {
    const { fixture } = await renderEditor(harness().providers);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    const close = vi.spyOn(fixture.debugElement.injector.get(CanvasSession), 'close');

    fixture.destroy();

    expect(close).toHaveBeenCalledTimes(1);
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
      await user.click(screen.getByRole('button', { name: 'Fanout exchange' }));
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

      fixture.debugElement.injector.get(CommandBus).undo('toolbar');
      fixture.detectChanges();
      expect(canvas().model().nodes).toHaveLength(1);
    });
  });

  describe('linking (ADR-0041, ADR-0042)', () => {
    async function openEditor(...items: string[]) {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      const user = userEvent.setup();
      for (const item of items) {
        await user.click(screen.getByRole('button', { name: item }));
      }
      view.fixture.detectChanges();
      const idOf = (kind: string) =>
        canvas()
          .model()
          .nodes.find((node) => node.kind === kind)!.id;
      const bus = () => view.fixture.debugElement.injector.get(CommandBus);
      return { ...view, canvas, user, idOf, bus };
    }

    const bindings = (store: DocumentStore) => Object.values(store.document().bindings);

    it('asks for the key of a binding from a topic exchange in a popover with the cursor in it, and binds with the key that is typed', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Topic exchange', 'Queue');
      const store = fixture.debugElement.injector.get(DocumentStore);

      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();

      const popover = await screen.findByRole('group', { name: 'Binding key from exchange exchange1 to queue queue1' });
      expect(popover).toBeInTheDocument();
      const field = screen.getByRole('textbox', { name: 'Binding key' });
      await waitFor(() => expect(field).toHaveFocus());
      expect(bindings(store)).toEqual([]);

      await user.keyboard('order.*{Enter}');
      fixture.detectChanges();

      expect(bindings(store).map(({ key }) => key)).toEqual(['order.*']);
      expect(screen.queryByTestId('binding-key')).not.toBeInTheDocument();
      expect(canvas().calls).toContain('focus');
    });

    it('keeps the popover open with the reason under the field when the key is refused, once, and binds when it is corrected', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Topic exchange', 'Queue');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());

      await user.keyboard('#.#.#{Enter}');
      fixture.detectChanges();

      expect(screen.getByTestId('binding-key')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('#');
      // The reason is under the field, and not also on the status line, where there would be two of it.
      expect(screen.getAllByTestId('refusal-message')).toHaveLength(1);
      expect(bindings(store)).toEqual([]);

      await user.clear(screen.getByRole('textbox', { name: 'Binding key' }));
      await user.keyboard('a.#{Enter}');
      fixture.detectChanges();

      expect(bindings(store).map(({ key }) => key)).toEqual(['a.#']);
      expect(screen.queryByTestId('binding-key')).not.toBeInTheDocument();
    });

    it('gives the link up on Escape, says so, makes nothing, and gives the focus back to the canvas', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Direct exchange', 'Queue');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());
      canvas().calls.length = 0;

      await user.keyboard('{Escape}');
      fixture.detectChanges();

      expect(screen.queryByTestId('binding-key')).not.toBeInTheDocument();
      expect(bindings(store)).toEqual([]);
      expect(screen.getByTestId('status-message')).toHaveTextContent('Link cancelled.');
      expect(canvas().calls).toContain('focus');
    });

    it('gives the link up when the focus goes elsewhere, and leaves the focus where the learner put it', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Direct exchange', 'Queue');
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());
      canvas().calls.length = 0;

      await user.click(screen.getByRole('combobox', { name: 'Theme' }));
      fixture.detectChanges();

      expect(screen.queryByTestId('binding-key')).not.toBeInTheDocument();
      expect(screen.getByTestId('status-message')).toHaveTextContent('Link cancelled.');
      expect(canvas().calls).not.toContain('focus');
    });

    it('opens the picker from the menu, lists what the rules allow, and binds, through the popover, what is chosen', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Direct exchange', 'Queue');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: idOf('exchange') },
        client: { x: 40, y: 40 },
      });
      fixture.detectChanges();
      await screen.findByRole('menu', { name: 'Actions for exchange exchange1' });

      await user.click(screen.getByRole('menuitem', { name: /Link to…/ }));
      fixture.detectChanges();

      const dialog = await screen.findByRole('dialog', { name: 'Link exchange exchange1 to…' });
      expect(
        within(dialog)
          .getAllByRole('option')
          .map((option) => option.querySelector('strong')?.textContent),
      ).toEqual(['exchange1', 'queue1']);
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search the targets' })).toHaveFocus());

      await user.keyboard('queue{Enter}');
      fixture.detectChanges();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await screen.findByRole('group', { name: 'Binding key from exchange exchange1 to queue queue1' });
      await user.keyboard('k{Enter}');
      expect(bindings(store).map(({ key }) => key)).toEqual(['k']);
    });

    it('says that the picker was given up, on Escape, and gives the focus back to the canvas', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Producer', 'Queue');
      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: idOf('producer') },
        client: { x: 5, y: 5 },
      });
      fixture.detectChanges();
      await user.click(await screen.findByRole('menuitem', { name: /Link to…/ }));
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search the targets' })).toHaveFocus());
      canvas().calls.length = 0;

      await user.keyboard('{Escape}');
      fixture.detectChanges();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('status-message')).toHaveTextContent('Link cancelled.');
      expect(canvas().calls).toContain('focus');
    });

    it('gives the picker up when the focus goes elsewhere, and leaves the focus where the learner put it', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Producer', 'Queue');
      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: idOf('producer') },
        client: { x: 5, y: 5 },
      });
      fixture.detectChanges();
      await user.click(await screen.findByRole('menuitem', { name: /Link to…/ }));
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search the targets' })).toHaveFocus());
      canvas().calls.length = 0;

      await user.click(screen.getByRole('combobox', { name: 'Theme' }));
      fixture.detectChanges();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('status-message')).toHaveTextContent('Link cancelled.');
      expect(canvas().calls).not.toContain('focus');
    });

    it('says why there is nothing to choose in the picker, in the words of what is needed', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Producer');
      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: idOf('producer') },
        client: { x: 5, y: 5 },
      });
      fixture.detectChanges();

      await user.click(await screen.findByRole('menuitem', { name: /Link to…/ }));
      fixture.detectChanges();

      expect(await screen.findByTestId('picker-reason')).toHaveTextContent(
        'Add an exchange or a queue first: a producer publishes to one of them.',
      );
    });

    it('does not offer "Link to…" for a consumer, which nothing is linked from', async () => {
      const { canvas, fixture, idOf } = await openEditor('Consumer');

      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: idOf('consumer') },
        client: { x: 5, y: 5 },
      });
      fixture.detectChanges();

      await screen.findByRole('menu', { name: 'Actions for consumer consumer1' });
      expect(screen.queryByRole('menuitem', { name: /Link to…/ })).not.toBeInTheDocument();
    });

    it('opens a menu where the link was let go on nothing, and makes the node and the link as one step when it is chosen', async () => {
      const { canvas, user, fixture, idOf, bus } = await openEditor('Producer');
      const store = fixture.debugElement.injector.get(DocumentStore);

      canvas().intent.emit({
        type: 'link-to-empty',
        source: idOf('producer'),
        at: { x: 400, y: 300 },
        client: { x: 640, y: 480 },
        via: 'drag',
      });
      fixture.detectChanges();

      await screen.findByRole('menu', { name: 'Create and link from producer producer1' });
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
        'New direct exchange',
        'New fanout exchange',
        'New topic exchange',
        'New headers exchange',
        'New queue',
      ]);

      await user.click(screen.getByRole('menuitem', { name: 'New fanout exchange' }));
      fixture.detectChanges();

      expect(Object.values(store.document().exchanges).map(({ name, type }) => [name, type])).toEqual([
        ['exchange1', 'fanout'],
      ]);
      expect(Object.values(store.document().producers)[0]?.target).toMatchObject({ kind: 'exchange' });
      expect(store.undoLabel()).toBe(
        'added fanout exchange exchange1 and linked producer producer1 to exchange exchange1',
      );
      bus().undo('toolbar');
      expect(Object.keys(store.document().exchanges)).toEqual([]);
    });

    it('asks for the key before it makes anything for a drop on nothing from a topic exchange, and the focus goes back to the canvas on Escape from the menu', async () => {
      const { canvas, user, fixture, idOf } = await openEditor('Topic exchange');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({
        type: 'link-to-empty',
        source: idOf('exchange'),
        at: { x: 400, y: 300 },
        client: { x: 640, y: 480 },
        via: 'drag',
      });
      fixture.detectChanges();
      await user.click(await screen.findByRole('menuitem', { name: 'New queue' }));
      fixture.detectChanges();

      await screen.findByRole('group', { name: 'Binding key from exchange exchange1 to queue queue1' });
      expect(Object.keys(store.document().queues)).toEqual([]);
      await user.keyboard('new.*{Enter}');
      fixture.detectChanges();

      expect(Object.values(store.document().queues).map(({ name }) => name)).toEqual(['queue1']);
      expect(bindings(store).map(({ key }) => key)).toEqual(['new.*']);
    });

    it('says why nothing can be made, and opens no menu, when the link started where nothing is linked from', async () => {
      const { canvas, fixture, idOf } = await openEditor('Consumer');

      canvas().intent.emit({
        type: 'link-to-empty',
        source: idOf('consumer'),
        at: { x: 1, y: 1 },
        client: { x: 1, y: 1 },
        via: 'drag',
      });
      fixture.detectChanges();

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('A consumer is where a message ends');
    });

    it('closes the menu of a drop on nothing with Escape, and makes nothing', async () => {
      const { canvas, fixture, idOf } = await openEditor('Producer');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({
        type: 'link-to-empty',
        source: idOf('producer'),
        at: { x: 1, y: 1 },
        client: { x: 10, y: 10 },
        via: 'drag',
      });
      fixture.detectChanges();
      await screen.findByRole('menu');
      canvas().calls.length = 0;

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', keyCode: 27 });
      fixture.detectChanges();

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
      expect(Object.keys(store.document().exchanges)).toEqual([]);
      await waitFor(() => expect(canvas().calls).toContain('focus'));
    });

    it('moves the label of an edge when the canvas says that it was dragged, as one step that a typed line can say', async () => {
      const { canvas, fixture, idOf, bus } = await openEditor('Fanout exchange', 'Queue');
      const store = fixture.debugElement.injector.get(DocumentStore);
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      const [edge] = canvas().model().edges;

      canvas().intent.emit({ type: 'move-label', key: edge!.id, at: 0.25 });
      fixture.detectChanges();

      expect(store.document().layout.labels[edge!.id]).toEqual({ at: 0.25 });
      expect(canvas().model().edges[0]?.labelAt).toBe(0.25);
      bus().undo('toolbar');
      expect(store.document().layout.labels[edge!.id]).toBeUndefined();
    });
  });

  describe('the card of a label (ADR-0044)', () => {
    async function openEditorWithManyKeys() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const canvas = () => view.fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      const bus = view.fixture.debugElement.injector.get(CommandBus);
      bus.apply(
        {
          type: 'batch',
          commands: [
            {
              type: 'declare-exchange',
              name: 'orders',
              exchangeType: 'topic',
              durable: true,
              autoDelete: false,
              internal: false,
            },
            { type: 'declare-queue', name: 'billing', durable: true },
            ...['a', 'b', 'c', 'd', 'e'].map(
              (key) =>
                ({ type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key }) as const,
            ),
          ],
        },
        'typed',
      );
      view.fixture.detectChanges();
      const [edge] = canvas().model().edges;
      return { ...view, canvas, key: edge!.id };
    }

    it('lists every key of the edge while a pointer is over its label, one to a line, under whose they are', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();

      canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
      fixture.detectChanges();

      const card = screen.getByRole('group', { name: 'Bindings from exchange orders to queue billing' });
      expect(
        within(card)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['a', 'b', 'c', 'd', 'e']);
      // The label is 80 high from 100, and the card is 4 under it.
      expect(card).toHaveStyle({ left: '100px', top: '184px' });
    });

    it('goes 150 milliseconds after the pointer has left the label, and not a moment before', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();

        canvas().intent.emit({ type: 'peek', key: null });
        vi.advanceTimersByTime(149);
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).toBeInTheDocument();

        vi.advanceTimersByTime(1);
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays when the pointer comes onto it before the label has said that the pointer left, whichever of the two comes first', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();

        fireEvent.pointerEnter(screen.getByTestId('label-card'));
        canvas().intent.emit({ type: 'peek', key: null });
        vi.advanceTimersByTime(500);
        fixture.detectChanges();

        expect(screen.queryByTestId('label-card')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('is not taken away by a key that is not Escape, and a pointer that is on it is still on it', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();
        fireEvent.pointerEnter(screen.getByTestId('label-card'));

        fireEvent.keyDown(document.body, { key: 'a' });
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).toBeInTheDocument();

        canvas().intent.emit({ type: 'peek', key: null });
        vi.advanceTimersByTime(500);
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes shortly after the pointer has left the label, and stays while the pointer is on the card', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();
        const card = screen.getByTestId('label-card');

        canvas().intent.emit({ type: 'peek', key: null });
        fireEvent.pointerEnter(card);
        vi.advanceTimersByTime(500);
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).toBeInTheDocument();

        fireEvent.pointerLeave(card);
        vi.advanceTimersByTime(500);
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes when the pointer has left the label and has not come onto the card', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();

        canvas().intent.emit({ type: 'peek', key: null });
        vi.advanceTimersByTime(500);
        fixture.detectChanges();

        expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('forgets that the pointer was on the card when Escape takes it away, so that the next one goes when the pointer has left the label', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      vi.useFakeTimers();
      try {
        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();
        // The pointer is on the card when Escape takes it away, so it never leaves it: the element is gone.
        fireEvent.pointerEnter(screen.getByTestId('label-card'));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        fixture.detectChanges();
        expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();

        canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
        fixture.detectChanges();
        canvas().intent.emit({ type: 'peek', key: null });
        vi.advanceTimersByTime(500);
        fixture.detectChanges();

        expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes on Escape, wherever the focus is, without the pointer having to move (WCAG 1.4.13)', async () => {
      const { canvas, fixture, key } = await openEditorWithManyKeys();
      canvas().intent.emit({ type: 'peek', key, rect: { x: 100, y: 100, width: 60, height: 80 } });
      fixture.detectChanges();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      fixture.detectChanges();

      expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
    });

    it('does not open for an edge that is not on the canvas', async () => {
      const { canvas, fixture } = await openEditorWithManyKeys();

      canvas().intent.emit({ type: 'peek', key: 'a>gone', rect: { x: 1, y: 1, width: 1, height: 1 } });
      canvas().intent.emit({ type: 'peek', key: 'nonsense', rect: { x: 1, y: 1, width: 1, height: 1 } });
      fixture.detectChanges();

      expect(screen.queryByTestId('label-card')).not.toBeInTheDocument();
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
      await user.click(screen.getByRole('button', { name: 'Fanout exchange' }));
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

    it('is for what was pointed at, and only that, so that is all that is selected, even when it was one of several', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();
      const [first, second] = canvas().model().nodes;
      canvas().intent.emit({ type: 'select', nodes: [first!.id, second!.id], edges: [] });
      fixture.detectChanges();

      canvas().intent.emit({ type: 'context-menu', target: { kind: 'node', id: second!.id }, client: { x: 5, y: 5 } });
      fixture.detectChanges();

      expect(await screen.findByRole('menu', { name: 'Actions for queue queue2' })).toBeInTheDocument();
      expect(canvas().selection().nodes).toEqual([second!.id]);
    });

    it('does not open for a node that has gone from the canvas, and leaves the selection as it was', async () => {
      const { canvas, queue, fixture } = await openEditor();
      canvas().intent.emit({ type: 'select', nodes: [queue.id], edges: [] });
      fixture.detectChanges();

      canvas().intent.emit({ type: 'context-menu', target: { kind: 'node', id: 'gone' }, client: { x: 5, y: 5 } });
      fixture.detectChanges();

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(canvas().selection().nodes).toEqual([queue.id]);
    });

    it('does not open for an edge of the default exchange, which is not the document’s, and leaves the selection as it was', async () => {
      const { canvas, queue, fixture } = await openEditor();
      canvas().intent.emit({ type: 'select', nodes: [queue.id], edges: [] });
      fixture.detectChanges();

      canvas().intent.emit({
        type: 'context-menu',
        target: { kind: 'edge', key: '~default>q1' },
        client: { x: 5, y: 5 },
      });
      fixture.detectChanges();

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(canvas().selection()).toEqual({ nodes: [queue.id], edges: [] });
    });

    it('does not rename an edge, and does not delete it either, when it is asked to', async () => {
      const { canvas, user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Fanout exchange' }));
      fixture.detectChanges();
      const idOf = (kind: string) =>
        canvas()
          .model()
          .nodes.find((node) => node.kind === kind)!.id;
      canvas().intent.emit({ type: 'link', source: idOf('exchange'), target: idOf('queue'), via: 'drag' });
      fixture.detectChanges();
      const [edge] = canvas().model().edges;

      fixture.debugElement
        .query(By.directive(ContextMenu))
        .triggerEventHandler('act', { action: 'rename', target: { kind: 'edge', key: edge!.id } });
      fixture.detectChanges();

      expect(canvas().model().edges).toHaveLength(1);
      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
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

      const field = screen.getByTestId('rename-field');
      expect(field).toBeInTheDocument();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(expect.stringContaining('queue2'));
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
      canvas().calls.length = 0;

      await user.keyboard('queue2');
      await user.tab();
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      // The learner went to something else, and the focus stays where they put it.
      expect(canvas().calls).not.toContain('focus');
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
      const apply = vi.spyOn(fixture.debugElement.injector.get(CommandBus), 'apply');

      await user.keyboard('{Enter}');
      fixture.detectChanges();

      expect(screen.queryByTestId('rename-field')).not.toBeInTheDocument();
      expect(store.document()).toBe(before);
      expect(apply).not.toHaveBeenCalled();
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

  describe('the command bar and the cheat-sheet (ADR-0045, ADR-0047)', () => {
    async function openEditor() {
      const view = await renderEditor(harness().providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const fake = () => view.fixture.debugElement.query(By.directive(FakeCanvas));
      const canvas = () => fake().componentInstance as FakeCanvas;
      /** Presses a key on the canvas, which is where the focus is when a learner works on it. */
      const onCanvas = (init: KeyboardEventInit & { key: string }) => {
        fireEvent.keyDown(fake().nativeElement as HTMLElement, init);
        view.fixture.detectChanges();
      };
      return { ...view, canvas, onCanvas, user: userEvent.setup() };
    }
    const bar = () => screen.getByRole('region', { name: 'Command bar' });
    const field = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Command' });
    const nodeNames = (canvas: () => FakeCanvas) =>
      canvas()
        .model()
        .nodes.map((node) => node.name);

    it('has the command bar under the canvas and over the hints, closed, with the keys that open it', async () => {
      await openEditor();

      expect(within(bar()).getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-expanded', 'false');
      expect(within(bar()).getByText('/ or Ctrl+K')).toBeVisible();
      expect(screen.getByRole('main').compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        bar().compareDocumentPosition(screen.getByRole('region', { name: 'Hints' })) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('opens on /, on the canvas, with the cursor in the field, and the slash is not typed into it', async () => {
      const { onCanvas } = await openEditor();

      onCanvas({ key: '/' });

      await waitFor(() => expect(field()).toHaveFocus());
      expect(field()).toHaveValue('');
    });

    it('opens on Ctrl+K from outside the canvas, and from a field of text, where / is typed', async () => {
      const { user, fixture } = await openEditor();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      fireEvent.keyDown(screen.getByRole('button', { name: 'Queue' }), { key: 'k', ctrlKey: true });
      await waitFor(() => expect(field()).toHaveFocus());

      await user.click(screen.getByRole('button', { name: 'Commands' }));
      await user.click(screen.getByRole('textbox', { name: 'Name' }));
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'k', metaKey: true });
      await waitFor(() => expect(field()).toHaveFocus());
    });

    it('closes with Escape, and gives the focus back to the canvas', async () => {
      const { onCanvas, canvas, user } = await openEditor();
      onCanvas({ key: '/' });
      await waitFor(() => expect(field()).toHaveFocus());
      canvas().calls.length = 0;

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('combobox', { name: 'Command' })).not.toBeInTheDocument();
      expect(canvas().calls).toContain('focus');
    });

    it('makes a typed line a change of the canvas, as one step that Ctrl+Z on the canvas takes back', async () => {
      const { onCanvas, canvas, user, fixture } = await openEditor();
      onCanvas({ key: '/' });
      await waitFor(() => expect(field()).toHaveFocus());

      await user.keyboard('declare queue billing{Enter}');
      fixture.detectChanges();
      expect(nodeNames(canvas)).toEqual(['billing']);

      await user.keyboard('{Escape}');
      onCanvas({ key: 'z', ctrlKey: true });
      expect(nodeNames(canvas)).toEqual([]);
    });

    it('shows what a gesture did as the line that a learner would type to do the same', async () => {
      const { user, fixture } = await openEditor();

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      expect(within(bar()).getByTestId('latest-command')).toHaveTextContent(/declare queue queue1/);
      await user.click(screen.getByRole('button', { name: 'Commands' }));
      expect(within(screen.getByTestId('command-log')).getByText(/declare queue queue1/)).toBeVisible();
      expect(within(screen.getByTestId('command-log')).getByTestId('origin')).toHaveTextContent('gesture');
    });

    it('shows the refusal of a typed line in the bar, where it was typed, and not a second time on the status line', async () => {
      const { onCanvas, user, fixture } = await openEditor();
      onCanvas({ key: '/' });
      await waitFor(() => expect(field()).toHaveFocus());

      await user.keyboard('declare exchange amq.mine type=direct{Enter}');
      fixture.detectChanges();

      expect(screen.getAllByTestId('refusal')).toHaveLength(1);
      expect(within(bar()).getByTestId('refusal')).toBeVisible();
      expect(within(screen.getByRole('contentinfo', { name: 'Status' })).queryByTestId('refusal')).toBeNull();
    });

    it('says what a typed line did on the status line, as a gesture does', async () => {
      const { onCanvas, user, fixture } = await openEditor();
      onCanvas({ key: '/' });
      await waitFor(() => expect(field()).toHaveFocus());

      await user.keyboard('declare queue billing{Enter}');
      fixture.detectChanges();

      expect(screen.getByTestId('status-message')).toHaveTextContent('Added queue billing.');
    });

    it('says in the hint bar that / opens the commands and ? the shortcuts, for what is selected or not', async () => {
      const { user, fixture } = await openEditor();
      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('/ Commands');
      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('? Shortcuts');

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();

      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('/ Commands');
    });

    it('shows the card of the first run under the top bar, until the learner has linked', async () => {
      const { user, fixture } = await openEditor();
      const bus = fixture.debugElement.injector.get(CommandBus);

      const card = screen.getByRole('region', { name: 'How to link' });
      expect(screen.getByRole('banner').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      bus.apply(
        {
          type: 'declare-exchange',
          name: 'orders',
          exchangeType: 'direct',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        'gesture',
      );
      fixture.detectChanges();
      expect(screen.getByRole('region', { name: 'How to link' })).toBeVisible();

      bus.apply(
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'queue1' }, key: 'k' },
        'gesture',
      );
      fixture.detectChanges();
      expect(screen.queryByRole('region', { name: 'How to link' })).not.toBeInTheDocument();
    });

    it('opens the cheat-sheet on ?, and Escape closes it and gives the focus back to what had it', async () => {
      const { onCanvas } = await openEditor();

      onCanvas({ key: '?', shiftKey: true });

      const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts and commands' });
      expect(within(dialog).getByRole('list', { name: 'Five ways to link' })).toBeVisible();
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('opens the cheat-sheet with the Help button of the top bar, wherever the focus is', async () => {
      const { user } = await openEditor();

      await user.click(screen.getByRole('button', { name: 'Help' }));

      expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts and commands' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Help' })).toHaveFocus();
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

  describe('the simulation (ADR-0054, ADR-0056)', () => {
    async function openEditor(flags: string | null) {
      const providers = [
        ...harness().providers,
        { provide: FRAME_SOURCE, useValue: manualFrames() },
        { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
      ];
      const view = await renderEditor(providers);
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
      const fake = () => view.fixture.debugElement.query(By.directive(FakeCanvas));
      const onCanvas = (init: KeyboardEventInit & { key: string }) => {
        fireEvent.keyDown(fake().nativeElement as HTMLElement, init);
        view.fixture.detectChanges();
      };
      return {
        ...view,
        onCanvas,
        user: userEvent.setup(),
        status: view.fixture.debugElement.injector.get(StatusStore),
      };
    }

    it('has no controls without its flag, and Space, the full stop and P are the page’s, and the hints do not say them', async () => {
      const { onCanvas, status } = await openEditor(null);

      expect(screen.queryByRole('group', { name: 'Simulation' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Hints' })).not.toHaveTextContent('Space');
      onCanvas({ key: ' ' });
      onCanvas({ key: '.' });
      onCanvas({ key: 'p' });

      expect(status.notice()).toBeNull();
    });

    it('has the controls under the top bar from the first frame, and the hints say the keys', async () => {
      await openEditor('simulation');

      const bar = screen.getByRole('group', { name: 'Simulation' });
      expect(screen.getByRole('banner').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        screen.getByRole('main', { name: 'Canvas' }).compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('Space Play or pause the simulation');
      expect(screen.getByRole('region', { name: 'Hints' })).toHaveTextContent('. Step to the next event');
    });

    it('plays and pauses on Space, from the canvas, and says so', async () => {
      const { onCanvas, status } = await openEditor('simulation');
      expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();

      onCanvas({ key: ' ' });

      expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
      expect(status.notice()).toEqual({ kind: 'message', text: 'Paused.' });
      onCanvas({ key: ' ' });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
      expect(status.notice()).toEqual({ kind: 'message', text: 'Playing at 1×.' });
    });

    it('says that there is nothing to step to when the full stop is pressed and nothing is scheduled', async () => {
      const { onCanvas, status } = await openEditor('simulation');

      onCanvas({ key: '.' });

      expect(status.notice()).toEqual({
        kind: 'message',
        text: 'Nothing is scheduled, so there is nothing to step.',
      });
    });

    it('publishes from the producer that is selected on P, and says why a producer that is linked to nothing cannot', async () => {
      const { onCanvas, user, fixture, status } = await openEditor('simulation');
      await user.click(screen.getByRole('button', { name: 'Producer' }));
      fixture.detectChanges();

      onCanvas({ key: 'p' });

      expect(status.refusal()).toMatchObject({ origin: 'key', issue: { kind: 'not-linked' } });
    });

    it('has the fields of the simulation in the inspector of a producer, and not in that of a queue that has none', async () => {
      const { user, fixture } = await openEditor('simulation');

      await user.click(screen.getByRole('button', { name: 'Producer' }));
      fixture.detectChanges();
      expect(screen.getByTestId('producer-composer')).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      fixture.detectChanges();
      expect(screen.queryByTestId('producer-composer')).not.toBeInTheDocument();
      expect(screen.getByTestId('queue-messages')).toBeVisible();
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
