// @vitest-environment node
import { tokens } from '@estanza/tokens';
import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alertStyles } from '../src/alert-view.js';
import { controlStyles } from '../src/control-view.js';

type Span = { top: number; bottom: number; lines: number };

const CONTROL_PX = tokens.control.iconSm.height.base;
const HIT_PX = tokens.layout.minHitTarget;

const styles = [controlStyles, alertStyles]
  .map((sheet) => sheet.cssText)
  .join('\n');

const row = (name: string, state: string): string =>
  `<button class="readout row"><span class="row-icon"><span class="lamp-icon"><svg class="icon" width="16" height="16"></svg></span></span><span class="row-text">${name} <span class="row-state">${state}</span></span></button>`;

const sheetMarkup = `<style>${styles}</style>
<div style="width: 220px; line-height: 20px">
  <div class="openings">
    ${row('Door between Landing and Bathroom', 'Closed')}
    ${row('Door between Landing and Suite', 'Closed')}
    ${row('Window', 'Open')}
  </div>
</div>`;

const bannerMarkup = `<style>${styles}</style>
<div class="stage" style="position: relative; width: 600px; height: 200px">
  <div class="banner" role="alert">
    <svg class="icon" width="20" height="20"></svg>
    <span class="banner-text"><span class="banner-kind">Smoke</span></span>
    <button class="banner-count">+1</button>
  </div>
</div>`;

const glyph = '<svg class="icon" width="16" height="16"></svg>';

const text = (name: string, state: string): string =>
  `<span class="row-text">${name} <span class="row-state">${state}</span></span>`;

const opening = (name: string, state: string, armed = false): string =>
  armed
    ? `<button class="readout row armed"><span class="row-icon">${glyph}<span class="turn"></span>${glyph}</span>${text(name, state)}<span class="drain"></span></button>`
    : `<button class="readout row"><span class="row-icon"><span class="lamp-icon">${glyph}</span></span>${text(name, state)}</button>`;

const gridMarkup = (armed: boolean): string => `<style>${styles}</style>
<div class="sheet" style="position: static; width: 272px; animation: none">
  <div class="devices">
    <div class="device"><button class="device-toggle"><span class="lamp-icon">${glyph}</span></button><button class="readout device-name">${text('Living Room light', 'Off')}</button></div>
    <div class="device"><span class="device-icon"><span class="lamp-icon">${glyph}</span></span><button class="readout device-name">${text('Living Room thermostat', 'Off')}</button></div>
  </div>
  <div class="openings">
    ${opening('Door in Hall', armed ? 'Tap again to unlock' : 'Closed · Locked', armed)}
    ${opening('Door between Hall and Living Room', 'Closed')}
    ${opening('Hall window', 'Closed')}
  </div>
</div>`;

type Grid = {
  heights: number[];
  names: number[];
  hits: number[];
  tops: number[];
};

function rowGrid(): Grid {
  const root = document.getElementById('card')?.shadowRoot;
  const rows = [
    ...(root?.querySelectorAll<HTMLElement>('.device, .readout.row') ?? []),
  ];
  const hitOf = (row: HTMLElement): number => {
    const target = row.matches('.device')
      ? row.querySelector<HTMLElement>('.device-name')
      : row;
    const after = target ? getComputedStyle(target, '::after') : null;

    return (
      row.getBoundingClientRect().height -
      2 * Number.parseFloat(after?.top ?? '0')
    );
  };

  return {
    heights: rows.map((row) => row.getBoundingClientRect().height),
    names: rows.map(
      (row) =>
        (row.querySelector('.row-text')?.getBoundingClientRect().left ?? 0) -
        row.getBoundingClientRect().left,
    ),
    hits: rows.map(hitOf),
    tops: rows.map((row) => row.getBoundingClientRect().top),
  };
}

let browser: Browser;

beforeAll(async () => {
  browser = await webkit.launch();
});

afterAll(async () => {
  await browser.close();
});

async function inShadow<T>(
  hasTouch: boolean,
  html: string,
  read: () => T,
): Promise<T> {
  const context = await browser.newContext({
    viewport: { width: 820, height: 800 },
    hasTouch,
  });

  try {
    const tab = await context.newPage();

    await tab.setContent('<div id="card"></div>');
    await tab.evaluate((markup) => {
      const host = document.getElementById('card') as HTMLElement;

      host.attachShadow({ mode: 'open' }).innerHTML = markup;
    }, html);

    return (await tab.evaluate(read)) as T;
  } finally {
    await context.close();
  }
}

function rowNames(): Span[] {
  const root = document.getElementById('card')?.shadowRoot;
  const names = [
    ...(root?.querySelectorAll<HTMLElement>('.row .row-text') ?? []),
  ];

  return names.map((name) => {
    const rect = name.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(name).lineHeight);

    return {
      top: rect.top,
      bottom: rect.bottom,
      lines: Math.round(rect.height / lineHeight),
    };
  });
}

function countBox(): number[] {
  const root = document.getElementById('card')?.shadowRoot;
  const count = root?.querySelector<HTMLElement>('.banner-count');

  if (!count) return [];

  const style = getComputedStyle(count);
  const rect = count.getBoundingClientRect();
  const border = Number.parseFloat(style.borderTopWidth);

  return [rect.height, rect.height - 2 * border];
}

describe('the rows of a room sheet in WebKit', () => {
  for (const hasTouch of [true, false]) {
    it(`never lets a two-line name run into the next row (${hasTouch ? 'touch' : 'mouse'})`, async () => {
      const names = await inShadow(hasTouch, sheetMarkup, rowNames);

      expect(names[0].lines).toBeGreaterThan(1);

      for (let index = 1; index < names.length; index += 1) {
        expect(names[index].top).toBeGreaterThanOrEqual(
          names[index - 1].bottom,
        );
      }
    }, 30_000);
  }
});

describe('every row of a room sheet in WebKit', () => {
  for (const hasTouch of [false, true]) {
    const drawn = hasTouch ? tokens.control.sm.height.base : CONTROL_PX;
    const mode = hasTouch ? 'touch' : 'mouse';

    it(`shares one height, one name indent and a full hit area (${mode})`, async () => {
      const grid = await inShadow(hasTouch, gridMarkup(false), rowGrid);

      expect(new Set(grid.heights)).toEqual(new Set([drawn]));
      expect(new Set(grid.names).size).toBe(1);
      expect(new Set(grid.hits)).toEqual(new Set([HIT_PX]));
    }, 30_000);

    it(`keeps its height, and the rows below it, when a row arms (${mode})`, async () => {
      const calm = await inShadow(hasTouch, gridMarkup(false), rowGrid);
      const armed = await inShadow(hasTouch, gridMarkup(true), rowGrid);

      expect(armed.heights).toEqual(calm.heights);
      expect(armed.tops).toEqual(calm.tops);
    }, 30_000);
  }
});

describe('the next-alert button in WebKit', () => {
  it('draws at the control height with a mouse', async () => {
    const [hit, drawn] = await inShadow(false, bannerMarkup, countBox);

    expect(hit).toBe(CONTROL_PX);
    expect(drawn).toBe(CONTROL_PX);
  }, 30_000);

  it('keeps a full hit area on touch, drawn no smaller than with a mouse', async () => {
    const [hit, drawn] = await inShadow(true, bannerMarkup, countBox);

    expect(hit).toBe(HIT_PX);
    expect(drawn).toBe(CONTROL_PX);
  }, 30_000);
});
