import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import { APP_DISCLAIMER, APP_NAME } from './core/app-info';

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
});
