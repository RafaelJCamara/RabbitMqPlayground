import { render } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { Icon } from './icon';
import { ICONS } from './icons';

describe('Icon', () => {
  it('draws the path of its name, and is hidden from a screen reader, because it is decoration', async () => {
    const { container } = await render(Icon, { inputs: { name: 'trash' } });

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('path')).toHaveAttribute('d', ICONS.trash);
  });

  it('has a drawing for every name, which starts by putting the pen somewhere, and no two that are the same', () => {
    const paths = Object.values(ICONS);

    expect(paths.every((path) => path.startsWith('M'))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('draws another path for another name', async () => {
    const { container } = await render(Icon, { inputs: { name: 'check' } });

    expect(container.querySelector('path')).toHaveAttribute('d', ICONS.check);
    expect(ICONS.check).not.toBe(ICONS.trash);
  });

  it('is 20 pixels across unless it is told another size', async () => {
    const { fixture } = await render(Icon, { inputs: { name: 'check' } });
    const host = fixture.nativeElement as HTMLElement;
    expect([host.style.width, host.style.height]).toEqual(['20px', '20px']);

    fixture.componentRef.setInput('size', 16);
    fixture.detectChanges();

    expect([host.style.width, host.style.height]).toEqual(['16px', '16px']);
  });
});
