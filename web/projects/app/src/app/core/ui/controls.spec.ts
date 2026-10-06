import { Component } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Help } from './help';
import { Switch } from './switch';

@Component({
  selector: 'rmq-help-host',
  imports: [Help],
  template: `
    <div class="flex flex-wrap">
      <span id="durable-label">Durable</span>
      <rmq-help topic="Durable">Survives a restart.</rmq-help>
    </div>
  `,
})
class HelpHost {}

describe('Help', () => {
  it('is a button that is named for what it explains, and is closed until it is pressed', async () => {
    await render(HelpHost);

    const button = screen.getByRole('button', { name: 'Help: Durable' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Survives a restart.')).not.toBeInTheDocument();
  });

  it('opens a sentence under the label when it is pressed, and closes it when it is pressed again', async () => {
    const user = userEvent.setup();
    await render(HelpHost);
    const button = screen.getByRole('button', { name: 'Help: Durable' });

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Survives a restart.')).toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Survives a restart.')).not.toBeInTheDocument();
  });

  it('opens from the keyboard, and tells what it controls', async () => {
    const user = userEvent.setup();
    await render(HelpHost);
    const button = screen.getByRole('button', { name: 'Help: Durable' });

    await user.tab();
    await user.keyboard('{Enter}');

    const text = screen.getByText('Survives a restart.');
    expect(button.getAttribute('aria-controls')).toBe(text.id);
    expect(text.id).not.toBe('');
  });

  it('gives each help a text of its own, so that two on a page are not tied to one another', async () => {
    const user = userEvent.setup();
    await render(`<rmq-help topic="One">First.</rmq-help><rmq-help topic="Two">Second.</rmq-help>`, {
      imports: [Help],
    });

    await user.click(screen.getByRole('button', { name: 'Help: One' }));
    await user.click(screen.getByRole('button', { name: 'Help: Two' }));

    const [one, two] = screen.getAllByRole('button').map((button) => button.getAttribute('aria-controls'));
    expect(one).not.toBe(two);
  });
});

describe('Switch', () => {
  async function renderSwitch(checked: boolean, describedBy?: string) {
    const toggles: boolean[] = [];
    await render(
      `<span id="label">Durable</span><rmq-switch [checked]="checked" labelledBy="label" [describedBy]="describedBy" (turn)="toggled($event)" />`,
      {
        imports: [Switch],
        componentProperties: { checked, describedBy, toggled: (value: boolean) => toggles.push(value) },
      },
    );
    return { toggles, user: userEvent.setup(), control: () => screen.getByRole('switch', { name: 'Durable' }) };
  }

  it('is a switch that is named by its label, and says whether it is on', async () => {
    const { control } = await renderSwitch(true);

    expect(control()).toHaveAttribute('aria-checked', 'true');
  });

  it('says whether it is on in words as well, so that it is not told by colour and position alone', async () => {
    await renderSwitch(true);
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('says that it is off in words, and in the state that a screen reader reads', async () => {
    const { control } = await renderSwitch(false);

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(control()).toHaveAttribute('aria-checked', 'false');
  });

  it('asks for the other state when it is pressed, and does not change by itself', async () => {
    const { control, toggles, user } = await renderSwitch(true);

    await user.click(control());

    expect(toggles).toEqual([false]);
    expect(control()).toHaveAttribute('aria-checked', 'true');
  });

  it('asks for the other state from the keyboard, with Space and with Enter', async () => {
    const { toggles, user } = await renderSwitch(false);

    await user.tab();
    await user.keyboard('{ }');
    await user.keyboard('{Enter}');

    expect(toggles).toEqual([true, true]);
  });

  it('is described by what it is told to be described by, such as a refusal under it', async () => {
    const { control } = await renderSwitch(true, 'refusal');

    expect(control()).toHaveAttribute('aria-describedby', 'refusal');
  });

  it('has no description when it is not given one', async () => {
    const { control } = await renderSwitch(true);

    expect(control()).not.toHaveAttribute('aria-describedby');
  });
});
