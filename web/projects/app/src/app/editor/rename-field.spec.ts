import type { Issue } from '@rmq/domain';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RenameField, type RenameBy } from './rename-field';

const RECT = { x: 100, y: 200, width: 200, height: 56 };

async function renderField(overrides: { rect?: typeof RECT; error?: Issue | null; value?: string } = {}) {
  const commits: { name: string; by: RenameBy }[] = [];
  const cancels: number[] = [];
  const view = await render(RenameField, {
    inputs: {
      rect: overrides.rect ?? RECT,
      value: overrides.value ?? 'billing',
      label: 'Rename queue billing',
      error: overrides.error ?? null,
    },
    on: {
      commit: (event: { name: string; by: RenameBy }) => commits.push(event),
      cancelled: () => cancels.push(1),
    },
  });
  await view.fixture.whenStable();
  return {
    ...view,
    commits,
    cancels,
    user: userEvent.setup(),
    field: () => screen.getByRole('textbox', { name: 'Rename queue billing' }) as HTMLInputElement,
  };
}

describe('RenameField', () => {
  it('is named for what it renames, and has the name that the node has', async () => {
    const { field } = await renderField();

    expect(field()).toHaveValue('billing');
  });

  it('takes the focus when it opens, with the name selected, so that typing replaces it', async () => {
    const { field } = await renderField();

    expect(field()).toHaveFocus();
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe('billing'.length);
  });

  it('gives the name when Enter is pressed, and says that it was Enter', async () => {
    const { field, commits, user } = await renderField();

    await user.keyboard('payments{Enter}');

    expect(commits).toEqual([{ name: 'payments', by: 'enter' }]);
    expect(field()).toHaveValue('payments');
  });

  it('gives the name when the field is left, and says that it was left', async () => {
    const { commits, user } = await renderField();

    await user.keyboard('payments');
    await user.tab();

    expect(commits).toEqual([{ name: 'payments', by: 'blur' }]);
  });

  it('drops what was typed on Escape, and gives nothing', async () => {
    const { commits, cancels, user } = await renderField();

    await user.keyboard('payments{Escape}');

    expect(cancels).toHaveLength(1);
    expect(commits).toEqual([]);
  });

  it('keeps Escape to itself, so that the canvas does not also take it', async () => {
    const { user } = await renderField();
    let reached = false;
    document.addEventListener('keydown', (event) => (reached ||= event.key === 'Escape'));

    await user.keyboard('{Escape}');

    expect(reached).toBe(false);
  });

  it('is over the node, which it is as wide as, and centred on it', async () => {
    const { container } = await renderField();

    const box = container.querySelector<HTMLElement>('.absolute');
    expect(box?.style.left).toBe('100px');
    expect(box?.style.width).toBe('200px');
    expect(box?.style.top).toBe(`${200 + (56 - 34) / 2}px`);
  });

  it('is wide enough to type in when the node is narrow, at a small zoom', async () => {
    const { container } = await renderField({ rect: { x: 0, y: 0, width: 50, height: 20 } });

    const box = container.querySelector<HTMLElement>('.absolute');
    expect(box?.style.width).toBe('160px');
    expect(box?.style.top).toBe('0px');
  });

  describe('when the name was refused', () => {
    const issue: Issue = { kind: 'duplicate-name', message: "A queue named 'archive' already exists." };

    it('says why under the field, and the field says that it is not valid, and by what it is described', async () => {
      const { field } = await renderField({ error: issue });

      expect(field()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByTestId('refusal-message')).toHaveTextContent("A queue named 'archive' already exists.");
      expect(field().getAttribute('aria-describedby')).toBe(screen.getByTestId('refusal').closest('[id]')?.id);
    });

    it('says nothing is wrong when nothing was refused', async () => {
      const { field } = await renderField();

      expect(field()).not.toHaveAttribute('aria-invalid');
      expect(field()).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });
  });
});
