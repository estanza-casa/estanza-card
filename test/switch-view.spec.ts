import { render } from 'lit';
import { describe, expect, it, vi } from 'vitest';

import type { View } from '../src/bindings.js';
import { viewSwitchTemplate } from '../src/switch-view.js';

function mountSwitch(chosen: View, choose = vi.fn()): HTMLElement {
  const host = document.createElement('div');

  render(viewSwitchTemplate({ chosen, choose }), host);

  return host;
}

function buttonsOf(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.views button')];
}

describe('the view switch', () => {
  it('reads 2D then 3D, as the Estanza editor does, with no icon', () => {
    const host = mountSwitch('3d');

    expect(buttonsOf(host).map((button) => button.textContent?.trim())).toEqual(
      ['2D', '3D'],
    );
    expect(host.querySelector('.views svg')).toBeNull();
  });

  it('names each button with the word it shows, in its tooltip too', () => {
    const host = mountSwitch('3d');

    expect(
      buttonsOf(host).map((button) => [
        button.getAttribute('aria-label'),
        button.title,
      ]),
    ).toEqual([
      ['2D floor plan', '2D floor plan'],
      ['3D view', '3D view'],
    ]);
    expect(host.querySelector('.views')?.getAttribute('aria-label')).toBe(
      'View',
    );
  });

  it('presses only the chosen view', () => {
    const host = mountSwitch('2d');

    expect(
      buttonsOf(host).map((button) => [
        button.dataset.view,
        button.getAttribute('aria-pressed'),
      ]),
    ).toEqual([
      ['2d', 'true'],
      ['3d', 'false'],
    ]);
  });

  it('chooses the view that is tapped', () => {
    const choose = vi.fn();
    const host = mountSwitch('2d', choose);

    buttonsOf(host)[1]?.click();

    expect(choose).toHaveBeenCalledWith('3d');
  });
});
