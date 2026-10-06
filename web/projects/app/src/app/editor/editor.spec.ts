import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { render, screen, waitFor } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { transientQueueReply } from '@rmq/engine';
import { createMemoryRepository, type CanvasRepository } from '@rmq/persistence';
import { manualClock, manualTimer } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkRules } from '@rmq/domain';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import type { CanvasVm } from '../canvas/model/canvas-vm';
import type { CanvasIntent } from '../canvas/model/intents';
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
