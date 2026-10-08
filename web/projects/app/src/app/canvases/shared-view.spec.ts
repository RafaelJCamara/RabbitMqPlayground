import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CanvasDocument, LinkRules } from '@rmq/domain';
import type { EngineSnapshot } from '@rmq/engine';
import { createMemoryRepository, type CanvasRepository, type Shared } from '@rmq/persistence';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  idSequence,
  manualClock,
  manualTimer,
  producerRecord,
  queueRecord,
  snapshotAfter,
} from '@rmq/testing';
import { render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import type { CanvasVm } from '../canvas/model/canvas-vm';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasIntent } from '../canvas/model/intents';
import { Announcer } from '../core/announcer';
import { APP_NAME } from '../core/app-info';
import { NO_EMPHASIS, type Emphasis } from '../core/explain/emphasis';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { Simulation } from '../core/runtime/simulation';
import { AUTOSAVE_TIMER, NOW, REPOSITORIES, STORAGE_MANAGER } from '../core/session/canvas-session';
import { LinkOpening } from '../core/share/link-opening';
import { DocumentStore } from '../core/state/document-store';
import type { Selection } from '../core/state/selection-store';
import { Editor } from '../editor/editor';
import { ShareDialogs } from '../share/dialogs';
import { SharedView } from './shared-view';

/** The canvas as the editor sees it, without a library to draw it: jsdom has no layout. It keeps the model it was given, so that a spec can read what is drawn. */
@Component({ selector: 'rmq-flow-canvas', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class FakeCanvas {
  readonly model = input.required<CanvasVm>();
  readonly selection = input.required<Selection>();
  readonly rules = input<LinkRules>();
  readonly emphasis = input<Emphasis>(NO_EMPHASIS);
  readonly intent = output<CanvasIntent>();

  constructor() {
    inject(FlowViewport).attach({
      transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
      host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      fit: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      resetZoom: () => undefined,
      select: () => undefined,
      focus: () => undefined,
      edgePath: () => null,
    });
  }
}

const traffic = (): CanvasDocument =>
  documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  });

const orders = (): Shared => ({
  name: 'Orders flow',
  document: documentOf({ queues: { q1: queueRecord('billing') } }),
});

interface Options {
  readonly shared?: Shared;
  readonly flags?: string;
  /** What the learner’s browser does to the repository their canvases are kept in. */
  readonly learner?: (repository: CanvasRepository) => CanvasRepository;
  /** What happens to the repository in memory that the view keeps the shared canvas in. */
  readonly view?: (repository: CanvasRepository) => CanvasRepository;
}

async function renderView(options: Options = {}) {
  const clock = manualClock(9_000_000);
  const learner = createMemoryRepository({ now: clock.now, newId: idSequence('own') });
  const views: CanvasRepository[] = [];
  const timer = manualTimer();
  const leave = vi.fn();
  TestBed.overrideComponent(Editor, { remove: { imports: [FlowCanvas] }, add: { imports: [FakeCanvas] } });
  const view = await render(SharedView, {
    inputs: { shared: options.shared ?? orders() },
    providers: [
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => options.learner?.(learner) ?? learner,
          memory: () => {
            const memory = createMemoryRepository({ now: clock.now, newId: idSequence(`view${views.length}-`) });
            views.push(memory);
            return views.length === 1 ? (options.view?.(memory) ?? memory) : memory;
          },
        },
      },
      { provide: AUTOSAVE_TIMER, useValue: timer },
      { provide: NOW, useValue: clock.now },
      {
        provide: STORAGE_MANAGER,
        useValue: {
          persist: async () => true,
          persisted: async () => true,
          estimate: async () => ({ usage: 1, quota: 1_000 }),
        },
      },
      { provide: LinkOpening, useValue: { leave } },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? 'editor,share' } },
    ],
  });
  vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  /** What the editor under the view has: its injector is where its services are. */
  const editorInjector = () => view.fixture.debugElement.query(By.directive(Editor))?.injector;
  return { ...view, learner, views, timer, leave, user: userEvent.setup(), editorInjector };
}

/** Waits until the session of the editor has opened the canvas, which it says in the status strip. */
const editorOpen = () =>
  waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Not kept after you close this tab.'));

const namesIn = async (repository: CanvasRepository): Promise<string[]> => {
  const listed = await repository.list();
  return listed.ok ? listed.value.canvases.map(({ name }) => name) : [];
};

afterEach(() => {
  window.localStorage.clear();
});

describe('SharedView (ADR-0078)', () => {
  describe('the page', () => {
    it('has the name of the product as its one heading, and says that this is a shared canvas, by name, and that nothing here is saved', async () => {
      await renderView();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      const banner = screen.getByTestId('shared-banner');
      expect(within(banner).getByTestId('shared-name')).toHaveTextContent('Shared canvas “Orders flow”');
      expect(banner).toHaveTextContent('You can look around, change things and play. Nothing here is saved.');
    });

    it('is the editor, over the canvas of the link, in the layout that a workspace gives it', async () => {
      const { editorInjector } = await renderView();

      expect(await screen.findByRole('complementary', { name: 'Toolbox' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Editor tools' })).toBeInTheDocument();
      await editorOpen();
      const document = editorInjector()?.get(DocumentStore).document();
      expect(Object.values(document?.queues ?? {}).map(({ name }) => name)).toEqual(['billing']);
    });

    it('draws the elements of the link on the canvas', async () => {
      const { fixture } = await renderView();
      await editorOpen();

      const canvas = fixture.debugElement.query(By.directive(FakeCanvas)).componentInstance as FakeCanvas;
      await waitFor(() => expect(canvas.model().nodes.map(({ id }) => id)).toContain('q1'));
    });

    it('says in the status strip that nothing of it is kept after the tab is closed, and why', async () => {
      await renderView();

      await waitFor(() =>
        expect(screen.getByTestId('save-state')).toHaveTextContent(
          'Not kept after you close this tab. This is a shared canvas, and what is changed here stays here unless you save a copy.',
        ),
      );
    });

    it('says that it is opening the canvas while the canvas is being put in memory, and cannot be saved as a copy yet', async () => {
      await renderView({
        view: (memory) => ({ ...memory, create: () => new Promise(() => undefined) }) as CanvasRepository,
      });

      expect(screen.getByTestId('opening-shared')).toHaveTextContent('Opening the shared canvas…');
      expect(screen.getByRole('button', { name: 'Save a copy to my canvases' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Leave' })).toBeEnabled();
    });

    it('says why, as an alert, instead of the editor, when the canvas could not be put in memory', async () => {
      await renderView({
        view: (memory) =>
          ({
            ...memory,
            create: async () => ({ ok: false, error: { kind: 'failed', message: 'The browser failed (boom).' } }),
          }) as CanvasRepository,
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The shared canvas could not be opened. The browser failed (boom).',
      );
      expect(screen.queryByRole('complementary', { name: 'Toolbox' })).not.toBeInTheDocument();
    });

    it('is plain text: a name that is markup is shown as it was written, and nothing of it is made', async () => {
      await renderView({
        shared: { ...orders(), name: '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>' },
      });

      expect(screen.getByTestId('shared-name')).toHaveTextContent(
        'Shared canvas “<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>”',
      );
      expect(document.querySelector('img[src="x"]')).toBeNull();
      expect(document.querySelector('script[src], header script')).toBeNull();
      expect((window as unknown as Record<string, unknown>)['pwned']).toBeUndefined();
    });
  });

  describe('what the learner does here', () => {
    it('stays in memory: the autosave writes to the view’s repository, and nothing reaches the canvases of the learner', async () => {
      const { user, timer, views, learner } = await renderView();
      await editorOpen();

      await user.click(screen.getByRole('button', { name: 'Queue' }));
      timer.advance(500);

      await vi.waitFor(async () => {
        const listed = await views[0]?.list();
        const record = listed?.ok ? listed.value.canvases[0] : undefined;
        expect(Object.keys(record?.document.queues ?? {})).toHaveLength(2);
      });
      expect(await namesIn(learner)).toEqual([]);
    });

    it('can be kept: Save a copy to my canvases makes a canvas of their own with the change, and leaves the link', async () => {
      const { user, timer, learner, leave } = await renderView();
      await editorOpen();
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      timer.advance(500);

      await user.click(screen.getByRole('button', { name: 'Save a copy to my canvases' }));

      await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
      const listed = await learner.list();
      const [copy] = listed.ok ? listed.value.canvases : [];
      expect(copy?.name).toBe('Orders flow (shared)');
      expect(Object.keys(copy?.document.queues ?? {})).toHaveLength(2);
    });

    it('can be left: Leave loads the page again as it was, and keeps nothing', async () => {
      const { user, learner, leave } = await renderView();
      await editorOpen();

      await user.click(screen.getByRole('button', { name: 'Leave' }));

      expect(leave).toHaveBeenCalledTimes(1);
      expect(await namesIn(learner)).toEqual([]);
    });

    it('is told, as an alert in the banner, why a copy could not be made, and keeps the editor and the work', async () => {
      const { user, learner, leave } = await renderView({
        learner: (repository) =>
          ({
            ...repository,
            create: async () => ({
              ok: false,
              error: { kind: 'quota-exceeded', message: 'The browser has no room left to keep this canvas.' },
            }),
          }) as CanvasRepository,
      });
      await editorOpen();

      await user.click(screen.getByRole('button', { name: 'Save a copy to my canvases' }));

      expect(await screen.findByTestId('shared-problem')).toHaveTextContent(
        'A copy could not be saved. The browser has no room left to keep this canvas.',
      );
      expect(screen.getByTestId('shared-problem')).toHaveAttribute('role', 'alert');
      expect(screen.getByRole('complementary', { name: 'Toolbox' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save a copy to my canvases' })).toBeEnabled();
      expect(leave).not.toHaveBeenCalled();
      expect(await namesIn(learner)).toEqual([]);
    });

    it('can be shared again: the Share button of the top bar shares the canvas as it is now', async () => {
      const { user } = await renderView();
      await editorOpen();
      const share = vi.spyOn(TestBed.inject(ShareDialogs), 'share').mockImplementation(() => undefined);
      await user.click(screen.getByRole('button', { name: 'Queue' }));

      await user.click(screen.getByRole('button', { name: 'Share…' }));

      expect(share).toHaveBeenCalledTimes(1);
      const data = share.mock.calls[0]?.[0];
      expect(data?.name).toBe('Orders flow');
      expect(Object.keys(data?.document.queues ?? {})).toHaveLength(2);
    });
  });

  describe('the messages of the link', () => {
    const withMessages = (snapshot?: EngineSnapshot): Shared => ({
      name: 'Traffic',
      document: traffic(),
      simulation: snapshot ?? snapshotAfter(traffic(), 180),
    });

    it('are put back as they were, paused, with the clock where the sender left it, when the simulation is on', async () => {
      const snapshot = snapshotAfter(traffic(), 180);
      const { editorInjector } = await renderView({ shared: withMessages(snapshot), flags: 'editor,share,simulation' });
      await editorOpen();

      const simulation = editorInjector()?.get(Simulation);
      expect(simulation?.running()).toBe(false);
      expect(simulation?.now()).toBe(180);
      expect(simulation?.snapshot()).toEqual(snapshot);
      expect(simulation?.messageCount()).toBeGreaterThan(0);
      expect(screen.queryByTestId('shared-notice')).not.toBeInTheDocument();
    });

    it('are said to be left out, with how many there were, when the simulation is not switched on', async () => {
      await renderView({ shared: withMessages() });

      const notice = await screen.findByTestId('shared-notice');
      expect(notice).toHaveTextContent(/^This link carries 2 messages, but the simulation is not switched on yet/);
      expect(notice).toHaveAttribute('role', 'status');
    });

    it('are said to be left out, and why, when the engine does not take them, and the canvas is shown without them', async () => {
      const snapshot = { ...snapshotAfter(traffic(), 180), version: 2 } as unknown as EngineSnapshot;
      const { editorInjector } = await renderView({ shared: withMessages(snapshot), flags: 'editor,share,simulation' });

      expect(await screen.findByTestId('shared-notice')).toHaveTextContent(
        'The messages of this link could not be put back (This engine reads snapshots of version 1, and this one is version 2), so the canvas is shown without them.',
      );
      expect(editorInjector()?.get(Simulation).messageCount()).toBe(0);
    });
  });
});
