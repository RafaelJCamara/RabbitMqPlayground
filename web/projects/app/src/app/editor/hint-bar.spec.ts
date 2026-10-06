import { TestBed } from '@angular/core/testing';
import { emptyDocument } from '@rmq/domain';
import { sampleDocument } from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { HintBar } from './hint-bar';

async function renderBar(document = sampleDocument()) {
  const view = await render(HintBar, { providers: [DocumentStore, SelectionStore] });
  const store = TestBed.inject(DocumentStore);
  const selection = TestBed.inject(SelectionStore);
  store.load(document);
  const choose = (nodes: string[], edges: string[] = []) => {
    selection.select(nodes, edges);
    view.fixture.detectChanges();
  };
  view.fixture.detectChanges();
  const shown = () =>
    within(screen.getByTestId('hints'))
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
  return { ...view, choose, shown, store };
}

describe('HintBar', () => {
  it('is a region with a name, which is text and not a live region', async () => {
    await renderBar();

    const region = screen.getByRole('region', { name: 'Hints' });
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-live');
    expect(region.querySelector('[aria-live]')).toBeNull();
    expect(region.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it('says what the keys do when nothing is selected', async () => {
    const { shown } = await renderBar();

    expect(shown()).toEqual([
      'Arrow keys Move between nodes',
      'F Fit the canvas',
      '+ and - Zoom',
      expect.stringMatching(/^(Ctrl|Cmd)\+Z Undo$/),
      expect.stringMatching(/^(Ctrl|Cmd)\+Shift\+Z Redo$/),
      '/ Commands',
      '? Shortcuts',
    ]);
  });

  it('changes with what is selected: one node can be renamed, edited, moved, linked and deleted', async () => {
    const { shown, choose } = await renderBar();

    choose(['Q1']);

    expect(shown()).toEqual(
      expect.arrayContaining([
        'F2 Rename',
        'Enter Edit in the inspector',
        'M Move with the arrow keys',
        'L Link to another node',
        'Delete Delete',
      ]),
    );
  });

  it('does not offer to link from a consumer', async () => {
    const { shown, choose } = await renderBar();

    choose(['C1']);

    expect(shown().join('|')).not.toContain('Link to another node');
    expect(shown()).toContain('F2 Rename');
  });

  it('changes again for an edge, and for several things', async () => {
    const { shown, choose } = await renderBar();

    choose([], ['E1>Q1']);
    expect(shown()).toContain('Delete Delete');
    expect(shown().join('|')).not.toContain('Rename');

    choose(['Q1', 'C1']);
    expect(shown()).toContain('M Move with the arrow keys');
    expect(shown().join('|')).not.toContain('Rename');
  });

  it('writes each key as a key, in a kbd element, so that it reads as one', async () => {
    const { choose } = await renderBar();
    choose(['Q1']);

    const keys = [...screen.getByTestId('hints').querySelectorAll('kbd')].map((key) => key.textContent);

    expect(keys).toEqual(expect.arrayContaining(['F2', 'Enter', 'M', 'L', 'Delete']));
  });

  it('has the same hints for a canvas that is empty, because what the keys do does not depend on what is on it', async () => {
    const { shown } = await renderBar(emptyDocument());

    expect(shown().slice(0, 3)).toEqual(['Arrow keys Move between nodes', 'F Fit the canvas', '+ and - Zoom']);
  });
});
