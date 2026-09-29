import '../src/card.js';

import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EstanzaCard } from '../src/card.js';

type Dock = { visibility: string; animation: string; height: number };

const cardStyles = (
  customElements.get('estanza-card') as unknown as typeof EstanzaCard
).styles.cssText;

const markup = (stage: string): string => `<style>${cardStyles}</style>
<ha-card>
  <div class="${stage}">
    <div class="dock"><div class="views" style="width: 80px; height: 40px"></div></div>
    <estanza-scene-view></estanza-scene-view>
  </div>
</ha-card>`;

let browser: Browser;

beforeAll(async () => {
  browser = await webkit.launch();
});

afterAll(async () => {
  await browser.close();
});

async function dockOf(
  stage: string,
  reducedMotion: 'reduce' | 'no-preference',
): Promise<Dock> {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    reducedMotion,
  });

  try {
    const tab = await context.newPage();

    await tab.setContent('<div id="card" style="width: 600px"></div>');

    return await tab.evaluate((html) => {
      const host = document.getElementById('card') as HTMLElement;
      const root = host.attachShadow({ mode: 'open' });

      root.innerHTML = html;

      const dock = root.querySelector('.dock') as HTMLElement;
      const style = getComputedStyle(dock);

      return {
        visibility: style.visibility,
        animation: style.animationName,
        height:
          root.querySelector('.stage')?.getBoundingClientRect().height ?? 0,
      };
    }, markup(stage));
  } finally {
    await context.close();
  }
}

describe('the card controls around the first frame in WebKit', () => {
  it('hides the controls while the home is undrawn, at the final size', async () => {
    const waiting = await dockOf('stage undrawn', 'no-preference');
    const drawn = await dockOf('stage', 'no-preference');

    expect(waiting.visibility).toBe('hidden');
    expect(waiting.height).toBeGreaterThan(0);
    expect(waiting.height).toBe(drawn.height);
  }, 30_000);

  it('fades the controls in once the home is drawn', async () => {
    const drawn = await dockOf('stage', 'no-preference');

    expect(drawn.visibility).toBe('visible');
    expect(drawn.animation).toBe('ez-appear');
  }, 30_000);

  it('shows the controls without a fade under reduced motion', async () => {
    const drawn = await dockOf('stage', 'reduce');

    expect(drawn.visibility).toBe('visible');
    expect(drawn.animation).toBe('none');
  }, 30_000);
});
