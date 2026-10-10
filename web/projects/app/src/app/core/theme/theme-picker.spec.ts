import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ICONS } from '../ui/icons';
import { THEME_STORAGE_KEY } from './theme';
import { ThemePicker } from './theme-picker';

beforeEach(() => {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemePicker (ADR-0103)', () => {
  it('is the system’s until the learner chooses, and the choice is applied and kept', async () => {
    const user = userEvent.setup();
    await render(ThemePicker);
    const select = screen.getByRole('combobox', { name: 'Theme' });

    expect(select).toHaveValue('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    await user.selectOptions(select, 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.selectOptions(select, 'light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.selectOptions(select, 'system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('offers the three choices, in words', async () => {
    await render(ThemePicker);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark']);
  });

  it('starts as the choice that was kept', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await render(ThemePicker);

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
  });

  it('has its name and title in words, and an icon in front that is a picture of the choice, hidden from a reader because the choice says it in words', async () => {
    await render(ThemePicker);
    const select = screen.getByRole('combobox', { name: 'Theme' });

    expect(select).toHaveAttribute('title', 'Theme');
    expect(select.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a monitor for the system, a sun for light and a moon for dark', async () => {
    const user = userEvent.setup();
    const view = await render(ThemePicker);
    const select = screen.getByRole('combobox', { name: 'Theme' });
    const drawn = () => select.previousElementSibling?.querySelector('svg path')?.getAttribute('d');

    expect(drawn()).toBe(ICONS.monitor);
    await user.selectOptions(select, 'light');
    view.fixture.detectChanges();
    expect(drawn()).toBe(ICONS.sun);
    await user.selectOptions(select, 'dark');
    view.fixture.detectChanges();
    expect(drawn()).toBe(ICONS.moon);
  });
});
