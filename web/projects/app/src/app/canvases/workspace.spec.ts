import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyDocument, type LinkRules } from '@rmq/domain';
import { createMemoryRepository, type CanvasRepository } from '@rmq/persistence';
import { idSequence, manualClock, manualTimer } from '@rmq/testing';
import { render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasVm } from '../canvas/model/canvas-vm';
import type { CanvasIntent } from '../canvas/model/intents';
import { Announcer } from '../core/announcer';
import { APP_NAME } from '../core/app-info';
import { NO_EMPHASIS, type Emphasis } from '../core/explain/emphasis';
import { AUTOSAVE_TIMER, NOW, REPOSITORIES, STORAGE_MANAGER } from '../core/session/canvas-session';
import type { Selection } from '../core/state/selection-store';
import { Editor } from '../editor/editor';
import { Workspace } from './workspace';

/** The canvas as the editor sees it, without a library to draw it (as in the spec of the editor): jsdom has no layout. */
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

async function renderWorkspace(
  options: {
    readonly seed?: readonly string[];
    /** The strip and the canvas that was open last, as an earlier visit left them. */
    readonly strip?: readonly string[];
    readonly last?: string;
    readonly browser?: (memory: CanvasRepository) => CanvasRepository;
    readonly memory?: (memory: CanvasRepository) => CanvasRepository;
  } = {},
) {
  const clock = manualClock(2_000_000);
  const ids = idSequence('c');
  const memory = createMemoryRepository({ now: clock.now, newId: ids });
  for (const name of options.seed ?? []) {
    await memory.create({ id: name.toLowerCase(), name, document: emptyDocument() });
    clock.advance(1_000);
  }
  if (options.strip !== undefined) {
    await memory.setMeta('openCanvases', options.strip);
  }
  if (options.last !== undefined) {
    await memory.setMeta('lastOpenCanvas', options.last);
  }
  TestBed.overrideComponent(Editor, { remove: { imports: [FlowCanvas] }, add: { imports: [FakeCanvas] } });
  const timer = manualTimer();
  const view = await render(Workspace, {
    providers: [
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => options.browser?.(memory) ?? memory,
          memory: () => {
            const fallback = createMemoryRepository({ now: clock.now, newId: idSequence('m') });
            return options.memory?.(fallback) ?? fallback;
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
    ],
  });
  vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return { ...view, memory, user: userEvent.setup(), timer };
}

const strip = () => screen.getByRole('navigation', { name: 'Open canvases' });
const tabNames = (): string[] =>
  within(strip())
    .getAllByRole('button')
    .filter((button) => button.dataset['testid'] === 'tab' || button.dataset['testid'] === 'tab-home')
    .map((button) => button.textContent?.trim() ?? '');
const current = (): string[] =>
  within(strip())
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-current') === 'true')
    .map((button) => button.textContent?.trim() ?? '');

afterEach(() => {
  window.localStorage.clear();
});

describe('Workspace (ADR-0072)', () => {
  describe('at start', () => {
    it('says that it is opening the canvases, and then has the strip and the editor of the first canvas, on a first run', async () => {
      await renderWorkspace();

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(tabNames()).toEqual(['My canvases', 'Untitled canvas']);
      expect(current()).toEqual(['Untitled canvas']);
      expect(screen.queryByTestId('opening-canvases')).not.toBeInTheDocument();
    });

    it('has the name of the product as the one heading of the page, in the strip, and not again in the editor', async () => {
      await renderWorkspace();
      await screen.findByLabelText('Toolbox');

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      expect(strip().closest('header')).toContainElement(screen.getByRole('heading', { level: 1 }));
    });

    it('lets the editor fill what is under the strip, and not the whole window', async () => {
      const { container } = await renderWorkspace();
      await screen.findByLabelText('Toolbox');

      const root = container.querySelector('rmq-editor > div');
      expect(root).toHaveClass('h-full');
      expect(root).not.toHaveClass('h-dvh');
    });

    it('opens the canvas that was open last, with the strip that was kept', async () => {
      await renderWorkspace({ seed: ['Alpha', 'Beta', 'Gamma'], strip: ['beta', 'alpha'], last: 'alpha' });
      await screen.findByLabelText('Toolbox');

      expect(tabNames()).toEqual(['My canvases', 'Beta', 'Alpha']);
      expect(current()).toEqual(['Alpha']);
    });

    it('says why, as an alert, when the canvases cannot be opened even in memory', async () => {
      const boom = (memory: CanvasRepository): CanvasRepository => ({
        ...memory,
        list: async () => ({ ok: false, error: { kind: 'failed', message: 'Boom.', detail: 'x' } }),
      });
      await renderWorkspace({ browser: boom, memory: boom });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The canvases of this browser could not be opened. Boom.',
      );
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
    });
  });

  describe('the strip', () => {
    it('makes a canvas with New canvas, shows it, and marks it as the current one', async () => {
      const { user } = await renderWorkspace();
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'New canvas' }));

      await waitFor(() => expect(tabNames()).toEqual(['My canvases', 'Untitled canvas', 'Untitled canvas 2']));
      expect(current()).toEqual(['Untitled canvas 2']);
      expect(screen.getAllByRole('main', { name: 'Canvas' })).toHaveLength(1);
    });

    it('shows the home with My canvases, with the strip still there, and a canvas again with its tab', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));

      expect(await screen.findByRole('main', { name: 'My canvases' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
      expect(current()).toEqual(['My canvases']);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

      await user.click(within(strip()).getByRole('button', { name: 'Alpha' }));

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.queryByRole('main', { name: 'My canvases' })).not.toBeInTheDocument();
      expect(current()).toEqual(['Alpha']);
    });

    it('opens a canvas from its card on the home, in a tab of its own', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha', 'Beta'] });
      await screen.findByLabelText('Toolbox');
      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });

      await user.click(screen.getByRole('button', { name: 'Open Alpha' }));

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(tabNames()).toEqual(['My canvases', 'Beta', 'Alpha']);
      expect(current()).toEqual(['Alpha']);
    });

    it('closes a tab with a button named for the canvas, and shows the one on its left', async () => {
      const { user } = await renderWorkspace();
      await screen.findByLabelText('Toolbox');
      await user.click(within(strip()).getByRole('button', { name: 'New canvas' }));
      await waitFor(() => expect(current()).toEqual(['Untitled canvas 2']));

      await user.click(within(strip()).getByRole('button', { name: 'Close Untitled canvas 2' }));

      await waitFor(() => expect(tabNames()).toEqual(['My canvases', 'Untitled canvas']));
      expect(current()).toEqual(['Untitled canvas']);
    });

    it('puts the cursor on the item that is shown now when a tab is closed, because the button that had it is gone', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha', 'Beta'], strip: ['alpha', 'beta'], last: 'beta' });
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'Close Beta' }));

      await waitFor(() => expect(within(strip()).getByRole('button', { name: 'Alpha' })).toHaveFocus());
    });

    it('puts the cursor on the item that is shown when a tab that is not shown is closed', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha', 'Beta'], strip: ['alpha', 'beta'], last: 'beta' });
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'Close Alpha' }));

      await waitFor(() => expect(within(strip()).getByRole('button', { name: 'Beta' })).toHaveFocus());
    });

    it('puts the cursor on My canvases when the last tab is closed', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'Close Alpha' }));

      await waitFor(() => expect(within(strip()).getByRole('button', { name: 'My canvases' })).toHaveFocus());
    });

    it('shows the home when the last tab is closed, and keeps the canvas', async () => {
      const { user, memory } = await renderWorkspace();
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'Close Untitled canvas' }));

      expect(await screen.findByRole('main', { name: 'My canvases' })).toBeInTheDocument();
      expect(tabNames()).toEqual(['My canvases']);
      const listed = await memory.list();
      expect(listed.ok && listed.value.canvases).toHaveLength(1);
      expect(await screen.findByRole('button', { name: 'Open Untitled canvas' })).toBeInTheDocument();
    });

    it('keeps the strip, so that a reload brings it back', async () => {
      const { user, memory } = await renderWorkspace();
      await screen.findByLabelText('Toolbox');

      await user.click(within(strip()).getByRole('button', { name: 'New canvas' }));
      await waitFor(() => expect(current()).toEqual(['Untitled canvas 2']));

      await vi.waitFor(async () => {
        const stored = await memory.getMeta('openCanvases');
        expect(stored.ok && stored.value).toHaveLength(2);
      });
    });

    it('has a button for each tab and for each close, and no more than one of the heading', async () => {
      await renderWorkspace({ seed: ['Alpha', 'Beta'] });
      await screen.findByLabelText('Toolbox');

      const items = within(strip()).getAllByRole('listitem');
      // My canvases, Beta (shown, since it was edited last), and New canvas: Alpha is not in the strip.
      expect(items).toHaveLength(3);
      expect(within(strip()).getAllByRole('button', { name: /^Close / })).toHaveLength(1);
    });
  });

  describe('clearing a canvas (ADR-0074)', () => {
    it('takes everything off the canvas with a button of the top bar, says so in a notice that has an Undo, and the Undo brings it back', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.queryByTestId('canvas-empty')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear canvas' }));

      const notices = await screen.findByRole('region', { name: 'Notices' });
      expect(within(notices).getByText('Cleared the canvas.')).toBeInTheDocument();
      expect(screen.getByTestId('canvas-empty')).toBeInTheDocument();
      await user.click(within(notices).getByRole('button', { name: 'Undo' }));

      await waitFor(() => expect(screen.queryByTestId('canvas-empty')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument());
    });

    it('says that the canvas is already empty, and makes no notice, when there is nothing to clear', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');

      await user.click(screen.getByRole('button', { name: 'Clear canvas' }));

      expect(await screen.findByText('The canvas is already empty.')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
    });

    it('takes the notice away when the learner goes to another view, because its Undo would be for a canvas that is not open', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      await user.click(screen.getByRole('button', { name: 'Clear canvas' }));
      await screen.findByRole('region', { name: 'Notices' });

      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });

      expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
    });
  });

  describe('deleting a canvas (ADR-0074)', () => {
    it('asks first, deletes, says so in a notice, and takes the delete back with the Undo of the notice or with the keys', async () => {
      const { user, memory } = await renderWorkspace({ seed: ['Alpha', 'Beta'] });
      await screen.findByLabelText('Toolbox');
      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });

      await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Alpha”?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete canvas' }));

      const notices = await screen.findByRole('region', { name: 'Notices' });
      expect(within(notices).getByText('Deleted “Alpha”.')).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: /Alpha/ })).not.toBeInTheDocument();
      expect((await memory.get('alpha')).ok).toBe(false);

      await user.click(within(notices).getByRole('button', { name: 'Undo' }));

      expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
      expect((await memory.get('alpha')).ok).toBe(true);
    });

    it('takes the delete back with Control and Z on the home', async () => {
      const { user, memory } = await renderWorkspace({ seed: ['Alpha', 'Beta'] });
      await screen.findByLabelText('Toolbox');
      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });
      await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete canvas' }));
      await screen.findByRole('region', { name: 'Notices' });

      await user.keyboard('{Control>}z{/Control}');

      expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
      expect((await memory.get('alpha')).ok).toBe(true);
    });

    it('deletes nothing when the learner says no', async () => {
      const { user, memory } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');
      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });

      await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
      expect((await memory.get('alpha')).ok).toBe(true);
    });
  });

  describe('leaving a canvas', () => {
    it('writes what was changed to the canvas before it goes, and finds it there when it is opened again', async () => {
      const { user, memory } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      // The autosave waits 500 ms and the timer here is by hand, so only leaving the canvas can write it.
      const before = await memory.get('alpha');
      expect(before.ok && Object.keys(before.value.document.queues)).toEqual([]);

      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });

      const after = await memory.get('alpha');
      expect(after.ok && Object.keys(after.value.document.queues)).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Open Alpha' }));
      await screen.findByLabelText('Toolbox');
      expect(screen.queryByTestId('canvas-empty')).not.toBeInTheDocument();
    });

    it('opens a canvas without the history of the last time: a change that was made cannot be undone after it is opened again', async () => {
      const { user } = await renderWorkspace({ seed: ['Alpha'] });
      await screen.findByLabelText('Toolbox');
      await user.click(screen.getByRole('button', { name: 'Queue' }));
      expect(screen.getByTestId('undo')).toBeEnabled();

      await user.click(within(strip()).getByRole('button', { name: 'My canvases' }));
      await screen.findByRole('main', { name: 'My canvases' });
      await user.click(screen.getByRole('button', { name: 'Open Alpha' }));
      await screen.findByLabelText('Toolbox');

      expect(screen.getByTestId('undo')).toBeDisabled();
    });
  });
});
