import { DeferBlockBehavior } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { createMemoryRepository } from '@rmq/persistence';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import { APP_DISCLAIMER, APP_NAME } from './core/app-info';
import { FLAG_SOURCES } from './core/flags/feature-flags';
import { REPOSITORIES } from './core/session/canvas-session';

const options = (stored: string | null) => ({
  deferBlockBehavior: DeferBlockBehavior.Playthrough,
  providers: [
    { provide: FLAG_SOURCES, useValue: { stored, query: null } },
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
    await render(App);

    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
  });

  it('says it is not affiliated with Broadcom or the RabbitMQ project', async () => {
    await render(App);

    expect(screen.getByText(APP_DISCLAIMER)).toBeInTheDocument();
    expect(APP_DISCLAIMER).toContain('Not affiliated with');
    expect(APP_DISCLAIMER).toContain('Broadcom');
  });

  it('links to the source, the decision records and the progress issue', async () => {
    await render(App);

    for (const name of ['Source code', 'Design decisions', 'Progress']) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', expect.stringContaining('github.com'));
    }
  });

  describe('behind the editor flag (ADR-0030)', () => {
    it('shows the placeholder, and none of the editor, when the flag is off', async () => {
      await render(App, options(null));

      expect(screen.getByText(/Under construction/)).toBeInTheDocument();
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-state')).not.toBeInTheDocument();
    });

    it('shows the editor, and not the placeholder, when the flag is on, and the editor has the one heading', async () => {
      await render(App, options('editor'));

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.queryByText(/Under construction/)).not.toBeInTheDocument();
    });

    it('loads a flag that is not the editor’s and shows the placeholder', async () => {
      await render(App, options('simulation'));

      expect(screen.getByText(/Under construction/)).toBeInTheDocument();
    });
  });

  describe('behind the canvases flag (ADR-0072)', () => {
    it('shows the editor alone, with no strip of open canvases, when only the editor flag is on', async () => {
      await render(App, options('editor'));

      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Open canvases' })).not.toBeInTheDocument();
    });

    it('puts the editor in a workspace, with the strip and the one heading, when the flags are editor and canvases', async () => {
      await render(App, options('editor,canvases'));

      expect(await screen.findByRole('navigation', { name: 'Open canvases' })).toBeInTheDocument();
      expect(await screen.findByLabelText('Toolbox')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'My canvases' })).toBeInTheDocument();
      expect(screen.queryByText(/Under construction/)).not.toBeInTheDocument();
    });

    it('does nothing without the editor: the placeholder, and none of the workspace, because canvases need the editor', async () => {
      await render(App, options('canvases'));

      expect(screen.getByText(/Under construction/)).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Open canvases' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Toolbox')).not.toBeInTheDocument();
    });
  });
});
