import { render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { TopicTester } from './topic-tester';

async function renderTester(pattern: string) {
  const view = await render(TopicTester, { inputs: { pattern } });
  return {
    ...view,
    type(next: string) {
      view.fixture.componentRef.setInput('pattern', next);
      view.fixture.detectChanges();
    },
  };
}

describe('TopicTester (ADR-0064)', () => {
  it('is a group with a name, and invites a key to be typed while there is none', async () => {
    await renderTester('');

    expect(screen.getByRole('group', { name: 'What this key matches' })).toBeVisible();
    expect(screen.getByTestId('topic-tester-empty')).toHaveTextContent('Type a key to see which keys it matches.');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists the keys that the pattern matches and the keys that it does not, as two lists with a name, each with a few words that say how', async () => {
    await renderTester('*.error');

    const matching = screen.getByRole('list', { name: 'Matches' });
    const missing = screen.getByRole('list', { name: 'Does not match' });
    expect(
      within(matching)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual([expect.stringContaining('x.error * took "x"'), expect.stringContaining('.error * took an empty word')]);
    const misses = within(missing)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(misses.some((line) => line.startsWith('""'))).toBe(true);
    expect(
      misses.some((line) => line.includes('x.errorx') && line.includes('last word is "errorx", not "error"')),
    ).toBe(true);
  });

  it('shows the empty key as two quotes, so that it is seen, and says in a note that a star took an empty word, once', async () => {
    await renderTester('*.error');

    expect(within(screen.getByTestId('topic-missing')).getAllByText('""')[0]).toBeVisible();
    expect(screen.getAllByTestId('topic-note')).toHaveLength(1);
    expect(screen.getByTestId('topic-note')).toHaveTextContent('The * took an empty word');
  });

  it('marks each key with an icon and with the list that it is in, so that colour is not what says it', async () => {
    await renderTester('a.b');

    for (const item of within(screen.getByTestId('topic-matching')).getAllByTestId('topic-sample')) {
      expect(item.querySelector('rmq-icon svg')).not.toBeNull();
      expect(item.querySelector('rmq-icon')?.getAttribute('style')).toContain('--rmq-explain-hit');
    }
    for (const item of within(screen.getByTestId('topic-missing')).getAllByTestId('topic-sample')) {
      expect(item.querySelector('rmq-icon')?.getAttribute('style')).toContain('--rmq-explain-miss');
    }
  });

  it('says what each wildcard of a pattern with a hash took, and that a pattern with none matched word for word', async () => {
    const { type } = await renderTester('logs.#');
    expect(
      within(screen.getByTestId('topic-matching'))
        .getAllByTestId('topic-sample')
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual([
      expect.stringContaining('logs # took no words'),
      expect.stringContaining('logs.y # took "y"'),
      expect.stringContaining('logs.y.z # took "y.z"'),
    ]);

    type('a.b');

    expect(within(screen.getByTestId('topic-matching')).getByTestId('topic-sample')).toHaveTextContent(
      'a.b word for word',
    );
  });

  it('works it out as the text changes, with no timer: what is typed is what is shown, from the first character', async () => {
    const { type } = await renderTester('');

    type('o');
    expect(within(screen.getByTestId('topic-matching')).getByTestId('topic-sample')).toHaveTextContent(
      'o word for word',
    );
    type('or');
    expect(within(screen.getByTestId('topic-matching')).getByTestId('topic-sample')).toHaveTextContent(
      'or word for word',
    );
    type('');
    expect(screen.getByTestId('topic-tester-empty')).toBeVisible();
  });

  it('says why a key with three hash words cannot be a binding key, in the words of the binding’s own check, and shows no samples', async () => {
    await renderTester('a.#.b.#.c.#');

    expect(screen.getByTestId('topic-tester-refusal')).toHaveTextContent(
      "The binding key 'a.#.b.#.c.#' has 3 '#' words, and RabbitMQ allows at most 2",
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says why a key over 255 bytes cannot be one, with how many bytes it is', async () => {
    await renderTester('x'.repeat(300));

    expect(screen.getByTestId('topic-tester-refusal')).toHaveTextContent(
      'A routing key is at most 255 bytes of UTF-8, and this one is 300.',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });
});
