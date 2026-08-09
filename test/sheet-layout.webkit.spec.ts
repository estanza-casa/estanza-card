// @vitest-environment node
import { tokens } from '@estanza/tokens';
import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { controlStyles } from '../src/control-view.js';
import { floorStyles } from '../src/floor-view.js';
import { switchStyles } from '../src/switch-view.js';

type Box = { top: number; bottom: number; left: number; right: number };

type Measured = {
  rows: Box[];
  sheet: Box;
  paddingBottom: number;
  dock: Box;
  dockShown: boolean;
  viewsReached: boolean;
  floorsReached: boolean;
};

const HIT_PX = tokens.layout.minHitTarget;
const COARSE_PX = tokens.control.sm.height.base;
const STAGE = { width: 390, height: 640 };

const styles = [controlStyles, floorStyles, switchStyles]
  .map((sheet) => sheet.cssText)
  .join('\n');

const icon = '<svg class="icon" width="20" height="20"></svg>';
const row = (name: string) =>
  `<button class="readout row" data-row="door"><span class="row-icon"><span class="lamp-icon">${icon}</span></span><span class="row-text">${name} <span class="row-state">Closed</span></span></button>`;

const markup = `<style>${styles}</style>
<div class="stage sheet-up" data-look="light" style="position:relative;width:${STAGE.width}px;height:${STAGE.height}px">
  <div class="dock">
    <div class="views">
      <button class="fb" data-view="3d" aria-pressed="true">${icon}</button>
      <button class="fb" data-view="2d" aria-pressed="false">${icon}</button>
    </div>
    <div class="floors">
      <button class="fb" data-floor="all">${icon}</button>
      <button class="fb" data-floor="f3"><span class="label">2nd</span></button>
      <button class="fb" data-floor="f2"><span class="label">1st</span></button>
      <button class="fb" data-floor="f1"><span class="label">Grd</span></button>
      <button class="fb" data-floor="b1"><span class="label">B</span></button>
    </div>
  </div>
  <div class="sheets" data-look="light" style="display:contents">
    <div class="sheet bottom room rows" data-kind="room" role="dialog">
      <div class="grip"></div>
      <div class="sheet-head"><div class="sheet-names"><h2 class="sheet-title">Hall</h2></div><button class="tb" data-act="close">${icon}</button></div>
      <div class="room-body">
        <div class="openings">
          ${['Door to outside', 'Door to Study', 'Door to Living Room', 'Door to Washroom', 'Door to Kitchen', 'Hall window'].map(row).join('')}
        </div>
      </div>
    </div>
  </div>
</div>`;

let browser: Browser;

beforeAll(async () => {
  browser = await webkit.launch();
});

afterAll(async () => {
  await browser.close();
});

async function measure(hasTouch: boolean): Promise<Measured> {
  const context = await browser.newContext({
    viewport: { width: STAGE.width, height: 844 },
    hasTouch,
  });

  try {
    const tab = await context.newPage();

    await tab.setContent('<div id="card"></div>');

    return await tab.evaluate((html) => {
      const host = document.getElementById('card') as HTMLElement;
      const root = host.attachShadow({ mode: 'open' });

      root.innerHTML = html;

      const stage = root.querySelector<HTMLElement>('.stage') as HTMLElement;
      const sheet = root.querySelector<HTMLElement>('.sheet') as HTMLElement;

      stage.style.setProperty('--ez-sheet-rise', `${sheet.offsetHeight}px`);
      sheet.scrollTop = sheet.scrollHeight;

      const box = (element: Element): Box => {
        const rect = element.getBoundingClientRect();

        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        };
      };
      const reached = (selector: string): boolean => {
        const target = root.querySelector(selector) as Element;
        const rect = target.getBoundingClientRect();
        const hit = root.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );

        return hit !== null && target.contains(hit);
      };
      const dock = root.querySelector('.dock') as HTMLElement;

      return {
        rows: [...root.querySelectorAll('.openings .row')].map(box),
        sheet: box(sheet),
        paddingBottom: Number.parseFloat(getComputedStyle(sheet).paddingBottom),
        dock: box(dock),
        dockShown: getComputedStyle(dock).visibility === 'visible',
        viewsReached: reached('.views .fb[data-view="2d"]'),
        floorsReached: reached('.floors .fb[data-floor="all"]'),
      };
    }, markup);
  } finally {
    await context.close();
  }
}

function pitches(rows: Box[]): number[] {
  return rows.slice(1).map((row, at) => row.top - rows[at].top);
}

describe('a bottom sheet on a phone in WebKit', () => {
  it('gives every touch row a full hit height at the same pitch a mouse gets', async () => {
    const touch = await measure(true);
    const mouse = await measure(false);

    expect(touch.rows.map((row) => row.bottom - row.top)).toEqual(
      touch.rows.map(() => COARSE_PX),
    );
    expect(pitches(touch.rows)).toEqual(pitches(mouse.rows));
    expect(pitches(touch.rows)[0]).toBe(HIT_PX);
  }, 30_000);

  it('keeps the token padding below its last row once scrolled to the end, above the safe area', async () => {
    const touch = await measure(true);
    const last = touch.rows[touch.rows.length - 1];

    expect(touch.paddingBottom).toBe(tokens.spacing[2]);
    expect(touch.sheet.bottom - last.bottom).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('keeps the view switch and the floor stack shown and reachable above it', async () => {
    const touch = await measure(true);

    expect(touch.dockShown).toBe(true);
    expect(touch.dock.bottom).toBeLessThanOrEqual(touch.sheet.top);
    expect(touch.viewsReached).toBe(true);
    expect(touch.floorsReached).toBe(true);
  }, 30_000);
});
