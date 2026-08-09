// @vitest-environment node
import { tokens } from '@estanza/tokens';
import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { controlStyles } from '../src/control-view.js';

type Setup = { hasTouch: boolean; tablet: boolean };

type Measured = {
  coarse: boolean;
  drawn: Record<string, number[]>;
  reach: Record<string, number[]>;
};

const FINE_PX = tokens.control.iconSm.height.base;
const COARSE_PX = tokens.control.sm.height.base;
const HIT_PX = tokens.layout.minHitTarget;

const svg = '<svg class="icon" width="20" height="20"></svg>';

const markup = `<style>${controlStyles.cssText}</style>
<div class="sheet" style="left:40px;top:40px">
  <div class="sheet-head">
    <h2 class="sheet-title">Kitchen</h2>
    <button class="tb" data-probe="close">${svg}</button>
  </div>
  <div class="level">
    <button class="tb" data-probe="power">${svg}</button>
    <div class="bar" data-probe="bar">
      <div class="track"></div>
      <input type="range" min="0" max="100" value="40" />
    </div>
  </div>
  <div class="tools light-tools">
    <button class="tb swatch" data-probe="swatch"><span></span></button>
    <button class="tb swatch"><span></span></button>
    <button class="tb">${svg}</button>
  </div>
</div>
<div class="sheet room rows" style="left:360px;top:40px">
  <div class="room-body">
    <div class="room-line">
      <button class="lamp" data-probe="lamp">
        <span class="lamp-icon">${svg}</span><span class="lamp-state">Off</span>
      </button>
    </div>
    <div class="devices">
      <div class="device">
        <button class="device-toggle" data-probe="toggle">
          <span class="lamp-icon">${svg}</span>
        </button>
        <button class="readout device-name"><span>Lamp</span></button>
      </div>
    </div>
  </div>
</div>`;

const drawnOf: Record<string, string> = {
  close: '[data-probe="close"]',
  power: '[data-probe="power"]',
  bar: '[data-probe="bar"] .track',
  swatch: '[data-probe="swatch"]',
  lamp: '[data-probe="lamp"]',
  toggle: '[data-probe="toggle"] .lamp-icon',
};

let browser: Browser;

beforeAll(async () => {
  browser = await webkit.launch();
});

afterAll(async () => {
  await browser.close();
});

async function measure({ hasTouch, tablet }: Setup): Promise<Measured> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch,
  });

  try {
    const tab = await context.newPage();

    await tab.setContent('<div id="card"></div>');

    return await tab.evaluate(
      ({ html, asTablet, drawnSelectors }) => {
        const host = document.getElementById('card') as HTMLElement;
        const root = host.attachShadow({ mode: 'open' });

        if (asTablet) host.setAttribute('tablet', '');

        root.innerHTML = html;

        const drawn: Record<string, number[]> = {};
        const reach: Record<string, number[]> = {};

        for (const [name, selector] of Object.entries(drawnSelectors)) {
          const shape = root.querySelector(selector)?.getBoundingClientRect();

          drawn[name] = shape ? [shape.width, shape.height] : [0, 0];
        }

        for (const probe of root.querySelectorAll<HTMLElement>(
          '[data-probe]',
        )) {
          const name = probe.dataset.probe ?? '';
          const box = probe.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          const x = box.left + box.width / 2;
          const hits = (y: number): boolean =>
            root.elementFromPoint(x, y)?.closest('[data-probe]') === probe;
          let top = middle;
          let bottom = middle;

          while (hits(top - 0.5)) top -= 0.5;
          while (hits(bottom + 0.5)) bottom += 0.5;

          reach[name] = [bottom - top, box.top - top, bottom - box.bottom];
        }

        return {
          coarse: matchMedia('(pointer: coarse)').matches,
          drawn,
          reach,
        };
      },
      { html: markup, asTablet: tablet, drawnSelectors: drawnOf },
    );
  } finally {
    await context.close();
  }
}

function expectSizes(measured: Measured, drawn: number): void {
  for (const name of ['close', 'power', 'lamp', 'toggle']) {
    expect(measured.drawn[name][1], name).toBe(drawn);
  }

  for (const name of ['close', 'power', 'toggle']) {
    expect(measured.drawn[name][0], name).toBe(drawn);
  }

  expect(measured.drawn.bar[1]).toBe(drawn);
  expect(measured.drawn.swatch[1]).toBe(drawn);

  for (const [name, [height]] of Object.entries(measured.reach)) {
    expect(height, name).toBeGreaterThanOrEqual(HIT_PX - 1);
  }
}

describe('the controls of a sheet in WebKit', () => {
  it('draws them at 36 px under a mouse, with a 44 px reach', async () => {
    const measured = await measure({ hasTouch: false, tablet: false });

    expect(measured.coarse).toBe(false);
    expectSizes(measured, FINE_PX);
  }, 30_000);

  it('draws them at 40 px on touch, with a 44 px reach', async () => {
    const measured = await measure({ hasTouch: true, tablet: false });

    expect(measured.coarse).toBe(true);
    expectSizes(measured, COARSE_PX);
  }, 30_000);

  it('draws them at 40 px on a wall tablet, even when it reports a mouse', async () => {
    for (const hasTouch of [true, false]) {
      expectSizes(await measure({ hasTouch, tablet: true }), COARSE_PX);
    }
  }, 30_000);
});
