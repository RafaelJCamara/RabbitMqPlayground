import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { BUILD, type Build } from '../build-info';
import { BuildStamp } from './build-stamp';

const renderStamp = (build: Build | null) => render(BuildStamp, { providers: [{ provide: BUILD, useValue: build }] });

describe('BuildStamp (ADR-0109)', () => {
  it('says "Build" and the short hash, which links to the commit and has the whole hash as its title', async () => {
    await renderStamp({
      commit: 'abcdef0123456789',
      short: 'abcdef0',
      url: 'https://example.test/commit/abcdef0123456789',
    });

    expect(screen.getByTestId('build-stamp')).toHaveTextContent('Build abcdef0');
    const link = screen.getByRole('link', { name: 'abcdef0' });
    expect(link).toHaveAttribute('href', 'https://example.test/commit/abcdef0123456789');
    expect(link).toHaveAttribute('title', 'abcdef0123456789');
  });

  it('is plain text for a local build, which has no commit to link to', async () => {
    await renderStamp({ commit: 'local', short: 'local', url: null });

    expect(screen.getByTestId('build-stamp')).toHaveTextContent('Build local');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says nothing when the page has no build', async () => {
    await renderStamp(null);

    expect(screen.queryByTestId('build-stamp')).toBeNull();
  });
});
