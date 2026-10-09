import { signal } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { createMemoryRepository, encodeShare, SHARE_KEY, type Shared } from '@rmq/persistence';
import { documentOf, queueRecord } from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { APP_NAME } from './core/app-info';
import { REPOSITORIES } from './core/session/canvas-session';
import { LinkOpening, type LinkState } from './core/share/link-opening';
import { PAGE_ADDRESS, type PageAddress } from './core/share/page-address';
import { OnboardingDialogs } from './onboarding/dialogs';
import { BLANK } from './onboarding/template-chooser';

const options = () => ({
  deferBlockBehavior: DeferBlockBehavior.Playthrough,
  providers: [
    // The first run asks what to start with (ADR-0082, ADR-0084); here it is answered the way a learner who leaves the question does.
    { provide: OnboardingDialogs, useValue: { choose: async () => BLANK } },
    {
      provide: REPOSITORIES,
      useValue: {
        browser: () => createMemoryRepository({ now: () => 1_000, newId: () => 'canvas1' }),
        memory: () => createMemoryRepository({ now: () => 1_000, newId: () => 'canvas2' }),
      },
    },
  ],
});

describe('App', () => {
  it('names the application in its top-level heading', async () => {
    await render(App, options());

    expect(await screen.findByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
  });

  describe('while the editor is loaded', () => {
    // A page that says only that it is loading has no landmark and no heading for a screen reader to start from (axe: landmark-one-main, page-has-heading-one), and it lasts as long as a slow network takes.
    it('is a page with the name of the product as its heading and a main region, when the editor is loading and when it could not be loaded', async () => {
      const { fixture } = await render(App, { ...options(), deferBlockBehavior: DeferBlockBehavior.Manual });
      const [block] = await fixture.getDeferBlocks();

      await block?.render(DeferBlockState.Loading);
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveTextContent('Loading the editor…');
      expect(screen.getByRole('status')).toHaveTextContent('Loading the editor…');

      await block?.render(DeferBlockState.Error);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('main')).toContainElement(screen.getByRole('alert'));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The editor could not be loaded. Reload the page to try again.',
      );
    });
  });

  describe('the editor (ADR-0030, ADR-0084)', () => {
    it('shows the editor, and the editor has the one heading', async () => {
      await render(App, options());

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });

  describe('the workspace of several canvases (ADR-0072)', () => {
    it('puts the editor in a workspace, with the strip and the one heading', async () => {
      await render(App, options());

      expect(await screen.findByRole('navigation', { name: 'Open canvases' })).toBeInTheDocument();
      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'My canvases' })).toBeInTheDocument();
    });
  });

  describe('a link in the address (ADR-0078)', () => {
    const HOME = 'https://learner.test/app/';
    const addressOf = (hash: string): PageAddress => ({
      base: () => HOME,
      hash: () => hash,
      clearHash: vi.fn(),
      reload: vi.fn(),
      onHashChange: () => () => undefined,
    });
    const shared = (): Shared => ({
      name: 'Orders flow',
      document: documentOf({ queues: { q1: queueRecord('billing') } }),
    });
    const hashOf = async (): Promise<string> => {
      const made = await encodeShare(shared());
      if (!made.ok) {
        throw new Error(made.error.message);
      }
      return `#${SHARE_KEY}=${made.value}`;
    };
    const withLink = (hash: string) => {
      const base = options();
      return { ...base, providers: [...base.providers, { provide: PAGE_ADDRESS, useValue: addressOf(hash) }] };
    };
    const withState = (state: LinkState) => {
      const base = options();
      return {
        ...base,
        providers: [...base.providers, { provide: LinkOpening, useValue: { state: signal(state), leave: vi.fn() } }],
      };
    };

    it('opens the shared canvas, with a banner that says so and the editor under it', async () => {
      await render(App, withLink(await hashOf()));

      expect(await screen.findByTestId('shared-name')).toHaveTextContent('Shared canvas “Orders flow”');
      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.queryByRole('navigation', { name: 'Open canvases' })).not.toBeInTheDocument();
    });

    it('opens it in the editor that keeps nothing, and the shared canvas is not among the canvases of the learner', async () => {
      await render(App, withLink(await hashOf()));

      expect(await screen.findByTestId('shared-name')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Open canvases' })).not.toBeInTheDocument();
    });

    it('says that it is opening the canvas while the link is unpacked, as a page with its heading and its main region, and shows nothing else', async () => {
      await render(App, withState({ kind: 'opening' }));

      expect(screen.getByTestId('opening-link')).toHaveTextContent('Opening the shared canvas…');
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      expect(screen.getByRole('main')).toContainElement(screen.getByTestId('opening-link'));
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
    });

    it('is a page of its own, with the reason and a way out, when the link cannot be opened, and opens nothing', async () => {
      await render(App, withLink('#c=v1.@@@@'));

      expect(
        await screen.findByRole('heading', { level: 2, name: 'This link could not be opened' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was opened and nothing was changed.$/);
      expect(screen.getByRole('link', { name: 'Go to the playground' })).toHaveAttribute('href', HOME);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
    });

    it('is the page as it was, with no sign of a link, when the address has no link', async () => {
      await render(App, withLink('#something-else'));

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.queryByTestId('shared-name')).not.toBeInTheDocument();
      expect(screen.queryByTestId('link-failed')).not.toBeInTheDocument();
    });
  });
});
