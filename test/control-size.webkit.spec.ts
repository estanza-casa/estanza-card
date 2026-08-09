// @vitest-environment node
import { tokens } from '@estanza/tokens';
import { type Browser, webkit } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alertStyles } from '../src/alert-view.js';
import { controlStyles } from '../src/control-view.js';
import { floorStyles } from '../src/floor-view.js';
import { switchStyles } from '../src/switch-view.js';
import { tabletStyles } from '../src/tablet-view.js';

type Box = { left: number; top: number; right: number; bottom: number };

type Measured = {
  coarse: boolean;
  hits: Box[];
  visuals: Box[];
  panels: Box[];
  label: number;
  icon: number;
  status: number;
  tool: number[];
  toolIcon: number;
  reach: { free: number; shared: number }[];
};

type Setup = { hasTouch: boolean; tablet: boolean };

const FINE_PX = tokens.control.iconSm.height.base;
const COARSE_PX = tokens.control.sm.height.base;
const HIT_PX = tokens.layout.minHitTarget;
const GAP_PX = tokens.spacing[0];
const LABEL_PX = tokens.typography.roles.caption.size;
const ICON_PX = tokens.icons.sizes[1];

const styles = [
  controlStyles,
  floorStyles,
  tabletStyles,
  switchStyles,
  alertStyles,
]
  .map((sheet) => sheet.cssText)
  .join('\n');

const markup = `<style>${styles}</style>
<div class="stage" style="--ez-border: #888">
  <div class="dock">
    <div class="views">
      <button class="fb" aria-pressed="true"><svg class="icon" width="20" height="20"></svg></button>
      <button class="fb" aria-pressed="false"><svg class="icon" width="20" height="20"></svg></button>
    </div>
    <div class="floors">
      <button class="fb" data-floor="all"><svg class="icon" width="20" height="20"></svg></button>
      <button class="fb" data-floor="f2"><span class="label">1st</span></button>
      <button class="fb" data-floor="f1"><span class="label">Grd</span></button>
    </div>
  </div>
  <div class="status"><button class="fb"><svg class="icon" width="20" height="20"></svg></button></div>
  <div class="tools"><button class="tb"><svg class="icon" width="20" height="20"></svg></button></div>
</div>`;

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
      ({ html, asTablet }) => {
        const host = document.getElementById('card') as HTMLElement;
        const root = host.attachShadow({ mode: 'open' });

        if (asTablet) host.setAttribute('tablet', '');

        root.innerHTML = html;

        const box = (rect: DOMRect, inset: number): Box => ({
          left: rect.left + inset,
          top: rect.top + inset,
          right: rect.right - inset,
          bottom: rect.bottom - inset,
        });
        const buttons = [...root.querySelectorAll<HTMLElement>('.dock .fb')];
        const status = root.querySelector<HTMLElement>('.status .fb');
        const sizeOf = (rect: DOMRect) => [rect.width, rect.height];
        const tool = root.querySelector<HTMLElement>('.tools .tb');
        const toolIcon = root.querySelector<SVGElement>('.tb .icon');
        const drawnInset = (button: HTMLElement): number => {
          const style = getComputedStyle(button);

          return style.backgroundClip === 'content-box'
            ? Number.parseFloat(style.paddingLeft)
            : 0;
        };
        const label = root.querySelector<HTMLElement>('.fb .label');
        const icon = root.querySelector<SVGElement>('.fb .icon');
        const reachOf = (button: HTMLElement) => {
          const rect = button.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const reaches = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].map(([dx, dy]) => {
            let far = 0;

            for (let step = 0; step <= 60; step += 1) {
              const at = step / 2;
              const hit = root.elementFromPoint(x + dx * at, y + dy * at);

              if (hit?.closest('.fb') !== button) break;

              far = at;
            }

            const past = root
              .elementFromPoint(x + dx * (far + 1), y + dy * (far + 1))
              ?.closest('.fb');

            return { far, shared: past !== null && past !== undefined };
          });

          return {
            free: Math.min(
              ...reaches.filter((entry) => !entry.shared).map((e) => e.far),
            ),
            shared: Math.min(
              ...reaches.filter((entry) => entry.shared).map((e) => e.far),
              Number.POSITIVE_INFINITY,
            ),
          };
        };

        return {
          coarse: matchMedia('(pointer: coarse)').matches,
          hits: buttons.map((button) => box(button.getBoundingClientRect(), 0)),
          visuals: buttons.map((button) =>
            box(button.getBoundingClientRect(), drawnInset(button)),
          ),
          panels: [...root.querySelectorAll('.views, .floors')].map((panel) =>
            box(
              panel.getBoundingClientRect(),
              Number.parseFloat(getComputedStyle(panel).borderLeftWidth),
            ),
          ),
          label: label
            ? Number.parseFloat(getComputedStyle(label).fontSize)
            : 0,
          icon: icon ? icon.getBoundingClientRect().width : 0,
          status: status ? status.getBoundingClientRect().width : 0,
          tool: tool ? sizeOf(tool.getBoundingClientRect()) : [0, 0],
          toolIcon: toolIcon ? toolIcon.getBoundingClientRect().width : 0,
          reach: [...buttons, ...(status ? [status] : [])].map(reachOf),
        };
      },
      { html: markup, asTablet: tablet },
    );
  } finally {
    await context.close();
  }
}

function sizes(boxes: Box[]): number[][] {
  return boxes.map((box) => [box.right - box.left, box.bottom - box.top]);
}

function expectDensity(measured: Measured, visual: number, hit: number) {
  const [switch3d, switch2d, ...floors] = measured.visuals;
  const [views, rail] = measured.panels;

  expect(sizes(measured.visuals)).toEqual(
    measured.visuals.map(() => [visual, visual]),
  );
  expect(sizes(measured.hits)).toEqual(measured.hits.map(() => [hit, hit]));
  expect(switch2d.left - switch3d.right).toBeCloseTo(GAP_PX, 3);
  expect(switch3d.left - views.left).toBeCloseTo(GAP_PX, 3);
  expect(switch3d.top - views.top).toBeCloseTo(GAP_PX, 3);
  expect(floors[1].top - floors[0].bottom).toBeCloseTo(GAP_PX, 3);
  expect(floors[0].left - rail.left).toBeCloseTo(GAP_PX, 3);
  expect(floors[0].top - rail.top).toBeCloseTo(GAP_PX, 3);
  expect(measured.label).toBe(LABEL_PX);
  expect(measured.icon).toBe(ICON_PX);
  expectFullReach(measured, visual);
}

function expectFullReach(measured: Measured, visual: number) {
  const free = HIT_PX / 2 - 0.5;
  const shared = Math.min(free, (visual + GAP_PX) / 2) - 1;

  for (const reach of measured.reach) {
    expect(reach.free).toBeGreaterThanOrEqual(free);
    expect(reach.shared).toBeGreaterThanOrEqual(shared);
  }
}

describe('the view switch and the floor rail in WebKit', () => {
  it('draws a mouse button at Home Assistant density', async () => {
    const measured = await measure({ hasTouch: false, tablet: false });

    expect(measured.coarse).toBe(false);
    expectDensity(measured, FINE_PX, FINE_PX);
  }, 30_000);

  it('draws a touch button a little larger, with a full hit area', async () => {
    const measured = await measure({ hasTouch: true, tablet: false });

    expect(measured.coarse).toBe(true);
    expectDensity(measured, COARSE_PX, HIT_PX);
  }, 30_000);

  it('draws a tablet button like a phone one, even when the browser reports a mouse', async () => {
    const phone = await measure({ hasTouch: true, tablet: false });

    for (const hasTouch of [true, false]) {
      const tablet = await measure({ hasTouch, tablet: true });

      expectDensity(tablet, COARSE_PX, HIT_PX);
      expect(tablet.status).toBe(phone.status);
      expect(tablet.tool).toEqual(phone.tool);
      expect(tablet.toolIcon).toBe(phone.toolIcon);
    }
  }, 30_000);
});
