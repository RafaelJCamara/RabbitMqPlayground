import { COMMAND_DOCS, SPECS } from '@rmq/domain';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { helpOutput, type HelpOutput } from './help';
import { HelpView } from './help-view';

async function renderHelp(output: HelpOutput) {
  const used: string[] = [];
  const looked: (string | null)[] = [];
  const view = await render(HelpView, {
    inputs: { output },
    on: { use: (line: string) => used.push(line), lookup: (topic: string | null) => looked.push(topic) },
  });
  return { ...view, used, looked, user: userEvent.setup() };
}

describe('HelpView (ADR-0045)', () => {
  describe('the list of commands', () => {
    it('is a region that says what it is, with every command of the registry by name and with its first sentence', async () => {
      await renderHelp(helpOutput());

      const region = screen.getByRole('region', { name: 'Help: the commands' });
      const buttons = within(region).getAllByRole('button');
      expect(buttons.map((button) => button.textContent?.trim())).toEqual(SPECS.map(({ name }) => name));
      expect(within(region).getByText(/^Puts an exchange on the canvas\.$/)).toBeVisible();
    });

    it('asks for the help of a command when its name is pressed', async () => {
      const { user, looked } = await renderHelp(helpOutput());

      await user.click(screen.getByRole('button', { name: 'declare queue' }));

      expect(looked).toEqual(['declare queue']);
    });

    it('says what ; does, because that is not a command and is not in the list', async () => {
      await renderHelp(helpOutput());

      expect(screen.getByText(/Several commands, one after the other, as one change\./)).toBeVisible();
      expect(screen.getByText(';', { selector: 'code' })).toBeVisible();
    });
  });

  describe('one command', () => {
    const bind = COMMAND_DOCS.find(({ name }) => name === 'bind');

    it('is a region named for the command, with how it is written and what it does', async () => {
      await renderHelp(helpOutput('bind'));

      const region = screen.getByRole('region', { name: 'Help: bind' });
      expect(within(region).getByRole('heading', { name: 'bind' })).toBeVisible();
      expect(within(region).getByText(bind?.syntax ?? '', { selector: 'code' })).toBeVisible();
      expect(within(region).getByText(bind?.summary ?? '')).toBeVisible();
    });

    it('has each example as a button that puts it in the field, which says what it does and keeps the example in its name', async () => {
      const { user, used } = await renderHelp(helpOutput('bind'));
      const [first] = bind?.examples ?? [];

      const button = screen.getByRole('button', { name: `Put ${first} in the field` });
      await user.click(button);

      expect(used).toEqual([first]);
      expect(button).toHaveTextContent(first ?? '');
    });

    it('goes back to the list of commands', async () => {
      const { user, looked } = await renderHelp(helpOutput('bind'));

      await user.click(screen.getByRole('button', { name: 'All the commands' }));

      expect(looked).toEqual([null]);
    });
  });

  it('shows what it is given when it is given something else', async () => {
    const { rerender } = await renderHelp(helpOutput('bind'));
    expect(screen.getByRole('region', { name: 'Help: bind' })).toBeInTheDocument();

    await rerender({ inputs: { output: helpOutput() } });

    expect(screen.queryByRole('region', { name: 'Help: bind' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Help: the commands' })).toBeInTheDocument();
  });
});
