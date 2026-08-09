import '../src/card.js';

import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EstanzaCard } from '../src/card.js';

type Laid = {
  scroll: number;
  viewport: number;
  stage: { top: number; bottom: number; height: number };
  sheet: { height: number; scrolls: boolean } | null;
};

type Setup = {
  width: number;
  height: number;
  layout: string;
  sheetRows: number;
};

const HEADER_PX = 56;

const cardStyles = (
  customElements.get('estanza-card') as unknown as typeof EstanzaCard
).styles.cssText;

const rows = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      `<div class="row" style="min-height: 48px">Door ${String(index)}</div>`,
  ).join('');

const markup = (sheetRows: number): string => `<style>${cardStyles}</style>
<ha-card>
  <div class="title">Casa Aurora</div>
  <div class="stage">
    <estanza-scene-view></estanza-scene-view>
    ${
      sheetRows > 0
        ? `<div class="sheet room bottom"><div class="sheet-head"><h2 class="sheet-title">Hall</h2></div>${rows(sheetRows)}</div>`
        : ''
    }
  </div>
</ha-card>`;

let browser: Browser;

beforeAll(async () => {
  browser = await webkit.launch();
});

afterAll(async () => {
  await browser.close();
});

async function lay({ width, height, layout, sheetRows }: Setup): Promise<Laid> {
  const context = await browser.newContext({ viewport: { width, height } });

  try {
    const tab = await context.newPage();

    await tab.setContent(`<style>
      html { --header-height: ${String(HEADER_PX)}px; }
      body { margin: 0; }
      .header { height: ${String(HEADER_PX)}px; }
      .view { display: flex; flex-direction: column; }
    </style>
    <div class="header"></div>
    <div class="view"><div id="card"></div></div>`);

    return await tab.evaluate(
      ({ html, placed }) => {
        const host = document.getElementById('card') as HTMLElement;
        const root = host.attachShadow({ mode: 'open' });

        host.setAttribute('layout', placed);
        root.innerHTML = html;

        const stage = root.querySelector('.stage')?.getBoundingClientRect();
        const sheet = root.querySelector<HTMLElement>('.sheet');

        return {
          scroll: document.scrollingElement?.scrollHeight ?? 0,
          viewport: innerHeight,
          stage: {
            top: stage?.top ?? 0,
            bottom: stage?.bottom ?? 0,
            height: stage?.height ?? 0,
          },
          sheet: sheet
            ? {
                height: sheet.getBoundingClientRect().height,
                scrolls: sheet.scrollHeight > sheet.clientHeight,
              }
            : null,
        };
      },
      { html: markup(sheetRows), placed: layout },
    );
  } finally {
    await context.close();
  }
}

describe('the card laid out in WebKit', () => {
  for (const size of [
    { width: 1280, height: 900 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    it(`fills a panel view to the bottom of a ${String(size.width)} by ${String(size.height)} screen without scrolling it`, async () => {
      const laid = await lay({ ...size, layout: 'panel', sheetRows: 0 });

      expect(laid.scroll).toBe(laid.viewport);
      expect(laid.stage.bottom).toBeCloseTo(size.height, 0);
    }, 30_000);
  }

  it('keeps its 4:3 shape in a masonry column', async () => {
    const laid = await lay({
      width: 1280,
      height: 900,
      layout: 'masonry',
      sheetRows: 0,
    });

    expect(laid.stage.height).toBeCloseTo((1280 * 3) / 4, 0);
  }, 30_000);

  it('caps a long bottom sheet at half the stage on a small phone and scrolls inside it', async () => {
    const laid = await lay({
      width: 360,
      height: 640,
      layout: 'panel',
      sheetRows: 9,
    });

    expect(laid.sheet?.height ?? Infinity).toBeLessThanOrEqual(
      laid.stage.height / 2 + 1,
    );
    expect(laid.sheet?.scrolls).toBe(true);
  }, 30_000);

  it('lets a short bottom sheet hug its content', async () => {
    const laid = await lay({
      width: 390,
      height: 844,
      layout: 'panel',
      sheetRows: 1,
    });

    expect(laid.sheet?.height ?? 0).toBeLessThan(laid.stage.height / 4);
    expect(laid.sheet?.scrolls).toBe(false);
  }, 30_000);
});
