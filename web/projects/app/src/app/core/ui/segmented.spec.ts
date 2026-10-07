import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Segmented } from './segmented';

const OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'any', label: 'any' },
  { value: 'all-with-x', label: 'all-with-x' },
  { value: 'any-with-x', label: 'any-with-x' },
];

async function renderControl(value = 'all', describedBy?: string) {
  const chosen: string[] = [];
  await render(Segmented, {
    inputs: { legend: 'x-match', options: OPTIONS, value, ...(describedBy === undefined ? {} : { describedBy }) },
    on: { chosen: (found: string) => chosen.push(found) },
  });
  return { chosen, user: userEvent.setup() };
}

describe('Segmented (ADR-0066)', () => {
  it('is a group of radio buttons under a legend, one for each choice, named by what it says', async () => {
    await renderControl();

    const group = screen.getByRole('group', { name: 'x-match' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(
      OPTIONS.map(({ value }) => value),
    );
    for (const { label } of OPTIONS) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the choice that it is given as the one that is checked, and no other', async () => {
    await renderControl('any-with-x');

    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('asks for the choice that is pressed, and does not decide', async () => {
    const { chosen, user } = await renderControl('all');

    await user.click(screen.getByRole('radio', { name: 'any' }));
    await user.click(screen.getByRole('radio', { name: 'all-with-x' }));

    expect(chosen).toEqual(['any', 'all-with-x']);
  });

  it('is moved from one choice to the next with the arrow keys, which is the browser’s own', async () => {
    const { chosen, user } = await renderControl('all');
    screen.getByRole('radio', { name: 'all' }).focus();

    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(chosen).toEqual(['any', 'all-with-x']);
  });

  it('shares one name between its radio buttons, so that the browser treats them as one group', async () => {
    await renderControl();

    const names = new Set(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).name));
    expect(names.size).toBe(1);
    expect([...names][0]).toMatch(/^rmq-segmented-\d+$/u);
  });

  it('gives each control a group of its own, so that two on a page do not take one another’s choice', async () => {
    await render(
      `<rmq-segmented legend="First" [options]="options" value="all" /><rmq-segmented legend="Second" [options]="options" value="any" />`,
      { imports: [Segmented], componentProperties: { options: OPTIONS } },
    );

    const first = screen
      .getByRole('group', { name: 'First' })
      .querySelector<HTMLInputElement>('input') as HTMLInputElement;
    const second = screen
      .getByRole('group', { name: 'Second' })
      .querySelector<HTMLInputElement>('input') as HTMLInputElement;
    expect(first.name).not.toBe(second.name);
  });

  it('is described by the element that it is told to be described by', async () => {
    await render(
      `<p id="help">Every condition has to hold.</p><rmq-segmented legend="x-match" [options]="options" value="all" describedBy="help" />`,
      {
        imports: [Segmented],
        componentProperties: { options: OPTIONS },
      },
    );

    expect(screen.getByRole('group', { name: 'x-match' })).toHaveAccessibleDescription('Every condition has to hold.');
  });

  it('has no description when it is not told of one', async () => {
    await renderControl();

    expect(screen.getByRole('group', { name: 'x-match' })).not.toHaveAttribute('aria-describedby');
  });
});
