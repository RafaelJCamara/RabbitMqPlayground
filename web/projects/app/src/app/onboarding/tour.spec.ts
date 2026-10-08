import { TestBed } from '@angular/core/testing';
import { isDocumentCommand, parseCommand } from '@rmq/domain';
import { canvasFromText } from '@rmq/testing';
import { render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Announcer } from '../core/announcer';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { WAYS_TO_LINK } from '../core/ui/ways-to-link';
import { TOUR_STEPS } from './tour-steps';
import { Tour, TourController } from './tour';
import { TourRequests } from './tour-requests';

/** The tour of the first run (ADR-0083): a banner that says what to do and is ticked off by the canvas. */

interface Options {
  readonly asked?: boolean;
  readonly flags?: string;
  /** Lines of the command language that the canvas has when the tour begins. */
  readonly before?: readonly string[];
}

async function renderTour(options: Options = {}) {
  const spoken: string[] = [];
  const view = await render(Tour, {
    providers: [
      {
        provide: DocumentStore,
        useFactory: () => {
          const store = new DocumentStore();
          store.load(canvasFromText((options.before ?? []).join('\n')));
          return store;
        },
      },
      { provide: Announcer, useValue: { announce: (message: string) => spoken.push(message) } },
      SelectionStore,
      StatusStore,
      CommandBus,
      TourController,
      { provide: TourRequests, useValue: { take: () => options.asked ?? true, request: () => undefined } },
      {
        provide: FLAG_SOURCES,
        useValue: { stored: null, query: options.flags ?? 'editor,canvases,simulation,onboarding' },
      },
    ],
  });
  const store = TestBed.inject(DocumentStore);
  const bus = TestBed.inject(CommandBus);
  const type = (line: string): void => {
    const read = parseCommand(line, store.document());
    if (!read.ok || !isDocumentCommand(read.value)) {
      throw new Error(`${line} is not a command that changes the canvas`);
    }
    const applied = bus.apply(read.value, 'typed');
    if (!applied.ok) {
      throw new Error(`${line} was refused: ${applied.error.message}`);
    }
  };
  /** A simulation that takes the commands of the runtime and says that it changed. */
  bus.attach({ execute: () => ({ changed: true, said: 'Sent.' }), takeLost: () => 0 });
  const publish = (producer: string): void => {
    const done = bus.run({ type: 'publish', from: { kind: 'producer', name: producer } }, 'key');
    if (!done.ok) {
      throw new Error(`the publish was refused: ${done.error.message}`);
    }
  };
  view.fixture.detectChanges();
  return { ...view, store, bus, type, publish, spoken, user: userEvent.setup() };
}

const banner = (): HTMLElement => screen.getByRole('region', { name: 'Tour' });
const title = (): string | null => screen.getByTestId('tour-title').textContent;
const progress = (): string => (screen.getByTestId('tour-progress').textContent ?? '').replace(/\s+/g, ' ').trim();

const ALL_BUT_THE_LAST = [
  'add producer sender',
  'declare exchange orders type=direct',
  'declare queue billing',
  'link sender -> orders',
  'bind orders -> billing key=new',
  'add consumer worker',
  'subscribe worker billing',
];

describe('Tour (ADR-0083)', () => {
  describe('when it begins', () => {
    it('is a region named Tour, on the first of six steps, which says what to do', async () => {
      await renderTour();

      expect(within(banner()).getByRole('heading', { level: 2 })).toHaveTextContent(TOUR_STEPS[0]?.title ?? '');
      expect(progress()).toBe('Step 1 of 6');
      expect(screen.getByTestId('tour-text')).toHaveTextContent('Click Producer, an exchange and Queue in the toolbox');
    });

    it('says the first step aloud', async () => {
      const { spoken } = await renderTour();

      expect(spoken).toEqual(['Tour, step 1 of 6: Add a producer, an exchange and a queue.']);
    });

    it('is not there when the chooser did not ask for it', async () => {
      await renderTour({ asked: false });

      expect(screen.queryByRole('region', { name: 'Tour' })).not.toBeInTheDocument();
    });

    it.each([['editor,canvases,onboarding'], ['editor,canvases,simulation']])(
      'is not there without a flag that it needs: only %s is on',
      async (flags) => {
        await renderTour({ flags });

        expect(screen.queryByRole('region', { name: 'Tour' })).not.toBeInTheDocument();
      },
    );

    it('has Skip this step and End tour, and no Back on the first step, and does not take the cursor', async () => {
      await renderTour();

      expect(screen.getByRole('button', { name: 'Skip this step' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'End tour' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
      expect(banner().contains(document.activeElement)).toBe(false);
    });
  });

  describe('as the learner does what it says', () => {
    it('moves on, and says so aloud, when the step becomes done, by whichever command made it so', async () => {
      const { type, spoken } = await renderTour();

      type('add producer sender');
      type('declare exchange orders type=direct');
      expect(progress()).toBe('Step 1 of 6');
      type('declare queue billing');

      await waitFor(() => expect(progress()).toBe('Step 2 of 6'));
      expect(title()).toBe('Link the producer to the exchange');
      expect(spoken.at(-1)).toBe('Tour, step 2 of 6: Link the producer to the exchange.');
    });

    it('lists the five ways to link in the step that links, in the words of the card and the cheat-sheet', async () => {
      const { type } = await renderTour();
      ['add producer sender', 'declare exchange orders type=direct', 'declare queue billing'].forEach(type);
      await waitFor(() => expect(progress()).toBe('Step 2 of 6'));

      const ways = within(screen.getByTestId('tour-ways')).getAllByRole('listitem');

      expect(ways.map((way) => way.textContent)).toEqual(WAYS_TO_LINK.map((way) => way.short));
      expect(ways).toHaveLength(5);
    });

    it('goes through every step to the last one, ticked off by the canvas and by one message', async () => {
      const { type, publish } = await renderTour();

      ALL_BUT_THE_LAST.slice(0, 3).forEach(type);
      await waitFor(() => expect(progress()).toBe('Step 2 of 6'));
      type(ALL_BUT_THE_LAST[3] ?? '');
      await waitFor(() => expect(progress()).toBe('Step 3 of 6'));
      type(ALL_BUT_THE_LAST[4] ?? '');
      await waitFor(() => expect(progress()).toBe('Step 4 of 6'));
      expect(title()).toBe('Add a consumer and give it the queue');
      type(ALL_BUT_THE_LAST[5] ?? '');
      type(ALL_BUT_THE_LAST[6] ?? '');
      await waitFor(() => expect(progress()).toBe('Step 5 of 6'));
      publish('sender');

      await waitFor(() => expect(progress()).toBe('Step 6 of 6'));
      expect(title()).toBe('That is the whole path');
      expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Skip this step' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'End tour' })).not.toBeInTheDocument();
    });

    it('counts the messages that the runtime took, and not the ones that it did not', async () => {
      const { bus, user } = await renderTour({ before: ALL_BUT_THE_LAST });
      for (let skipped = 0; skipped < 4; skipped += 1) {
        await user.click(screen.getByRole('button', { name: 'Next' }));
      }
      expect(progress()).toBe('Step 5 of 6');
      bus.attach({ execute: () => ({ changed: false, said: 'Nothing to send.' }), takeLost: () => 0 });

      bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'key');
      await Promise.resolve();

      expect(progress()).toBe('Step 5 of 6');
      bus.attach({ execute: () => ({ changed: true, said: 'Sent.' }), takeLost: () => 0 });
      bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'key');
      await waitFor(() => expect(progress()).toBe('Step 6 of 6'));
    });

    it('never changes the canvas', async () => {
      const { store, user } = await renderTour();
      const before = store.document();

      await user.click(screen.getByRole('button', { name: 'Skip this step' }));
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await user.click(screen.getByRole('button', { name: 'End tour' }));

      expect(store.document()).toBe(before);
    });
  });

  describe('when a step is done already', () => {
    it('waits to be moved on with Next, and does not move itself on, when the canvas had what it asks for', async () => {
      const { user } = await renderTour({
        before: ['add producer sender', 'declare exchange orders type=direct', 'declare queue billing'],
      });

      expect(progress()).toBe('Step 1 of 6');
      expect(screen.getByTestId('tour-done')).toHaveTextContent('Done.');
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(progress()).toBe('Step 2 of 6');
    });

    it('waits for Next after Back as well, so that going back does not bounce', async () => {
      const { type, user } = await renderTour();
      ['add producer sender', 'declare exchange orders type=direct', 'declare queue billing'].forEach(type);
      await waitFor(() => expect(progress()).toBe('Step 2 of 6'));

      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(progress()).toBe('Step 1 of 6');
      await Promise.resolve();
      expect(progress()).toBe('Step 1 of 6');
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('stays on a step that stops being done, as Back and Skip are for', async () => {
      const { type, store, bus } = await renderTour();
      ['add producer sender', 'declare exchange orders type=direct', 'declare queue billing'].forEach(type);
      await waitFor(() => expect(progress()).toBe('Step 2 of 6'));
      type('link sender -> orders');
      await waitFor(() => expect(progress()).toBe('Step 3 of 6'));

      bus.undo('key');

      expect(store.document().producers).toBeDefined();
      expect(progress()).toBe('Step 3 of 6');
    });
  });

  describe('the buttons', () => {
    it('skip a step that is not done, and say the next one aloud', async () => {
      const { user, spoken } = await renderTour();

      await user.click(screen.getByRole('button', { name: 'Skip this step' }));

      expect(progress()).toBe('Step 2 of 6');
      expect(spoken.at(-1)).toBe('Tour, step 2 of 6: Link the producer to the exchange.');
    });

    it('go back a step, and say it aloud', async () => {
      const { user, spoken } = await renderTour();
      await user.click(screen.getByRole('button', { name: 'Skip this step' }));

      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(progress()).toBe('Step 1 of 6');
      expect(spoken.at(-1)).toBe('Tour, step 1 of 6: Add a producer, an exchange and a queue.');
    });

    it('end the tour from any step, and say so', async () => {
      const { user, spoken } = await renderTour();
      await user.click(screen.getByRole('button', { name: 'Skip this step' }));

      await user.click(screen.getByRole('button', { name: 'End tour' }));

      expect(screen.queryByRole('region', { name: 'Tour' })).not.toBeInTheDocument();
      expect(spoken.at(-1)).toBe('Tour ended.');
    });

    it('end the tour with Finish at the last step', async () => {
      const { user } = await renderTour();
      for (let skipped = 0; skipped < 5; skipped += 1) {
        await user.click(screen.getByRole('button', { name: 'Skip this step' }));
      }
      expect(progress()).toBe('Step 6 of 6');

      await user.click(screen.getByRole('button', { name: 'Finish' }));

      expect(screen.queryByRole('region', { name: 'Tour' })).not.toBeInTheDocument();
    });
  });
});
