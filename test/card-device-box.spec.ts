import { motionLive } from '@estanza/scene/env.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
} from '../src/bindings.js';
import { SHEET_FRAME_MARGIN_PX, SHEET_GLIDE_MS } from '../src/camera-rig.js';
import { EstanzaCard } from '../src/card.js';
import { type Point, TARGET_RADIUS_PX } from '../src/gesture.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import type { Size } from '../src/sheet.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockEntityState,
  type MockHass,
  mockLight,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const EDGE_PX = 16;
const DOCK_WIDTH_PX = 272;
const HEIGHTS: Record<string, number> = { room: 300, light: 148 };

const bindings: SceneBinding[] = [
  { scope: { type: 'light', id: 'lamp' }, entity_id: 'light.lamp' },
  { scope: { type: 'light', id: 'plug' }, entity_id: 'switch.plug' },
  { scope: { type: 'door', id: 'front' }, entity_id: 'lock.front' },
  { scope: { type: 'room', id: 'hall' }, entity_id: 'light.hall' },
];

const things = ['light:lamp', 'light:plug', 'room:hall'];

const house: Point[] = [
  { x: 150, y: 90 },
  { x: 1180, y: 90 },
  { x: 1180, y: 680 },
  { x: 150, y: 680 },
];

let hass: MockHass;
let spots = new Map<string, Point>();

function keyOf(scope: SceneScope): string {
  return `${scope.type}:${scope.id}`;
}

function edgesOf(size: Size): [string, Point][] {
  const inset = 30;
  const xs = [inset, size.width / 2, size.width - inset];
  const ys = [inset, size.height / 2, size.height - inset];
  const names = [
    ['top left', 'top', 'top right'],
    ['left', 'middle', 'right'],
    ['bottom left', 'bottom', 'bottom right'],
  ];

  return ys.flatMap((y, row) =>
    xs.map((x, column): [string, Point] => [names[row][column], { x, y }]),
  );
}

async function mountCard(
  screen: number,
  stage: Size,
  view: '3d' | '2d',
  home: unknown = homeFixture,
): Promise<EstanzaCard> {
  vi.stubGlobal('innerWidth', screen);

  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.lamp', { on: true }),
      mockLight('light.hall', { on: false }),
      mockEntityState('switch.plug', 'on'),
      mockEntityState('lock.front', 'locked'),
    ],
  });
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: home,
    bindings,
    default_view: view,
  });
  document.body.append(card);
  await settle(card);

  const shown = find(card, '.stage');

  if (!shown) throw new Error('no stage');

  vi.spyOn(shown, 'clientWidth', 'get').mockReturnValue(stage.width);
  vi.spyOn(shown, 'clientHeight', 'get').mockReturnValue(stage.height);
  await wait(card, VIEW_SWITCH_MS);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
    await card.shadowRoot?.querySelector('estanza-plan-view')?.updateComplete;
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(card);
}

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function surfaceOf(card: EstanzaCard): HTMLElement {
  const surface =
    find(card, 'estanza-plan-view') ?? find(card, 'estanza-scene-view');

  if (!surface) throw new Error('no surface');

  return surface;
}

async function press(
  card: EstanzaCard,
  key: string,
  gesture: 'tap' | 'press' = 'press',
): Promise<void> {
  await begin(card, key, gesture);
  await wait(card, SHEET_GLIDE_MS * 2);
}

async function begin(
  card: EstanzaCard,
  key: string,
  gesture: 'tap' | 'press' = 'press',
): Promise<void> {
  const [scopeType, scopeId] = key.split(':');
  const at = spots.get(key) ?? { x: 0, y: 0 };

  surfaceOf(card).dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture, ...at },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
  card.hass = { ...hass };
  await settle(card);
}

async function close(card: EstanzaCard): Promise<void> {
  find(card, '.sheet button[data-act="close"]')?.click();
  await settle(card);
}

function placeAt(key: string, at: Point): void {
  spots = new Map([...spots, [key, at]]);
}

function placeOf(card: EstanzaCard): string {
  const sheet = find(card, '.sheet');

  if (!sheet) throw new Error('no sheet');

  return `${sheet.classList.contains('bottom') ? 'bottom' : 'docked'} ${sheet.getAttribute('style') ?? ''}`;
}

function dockOf(stage: Size): string {
  return `docked left:${stage.width - EDGE_PX - DOCK_WIDTH_PX}px;top:${EDGE_PX}px;width:${DOCK_WIDTH_PX}px;max-height:${stage.height - 2 * EDGE_PX}px`;
}

function styleRules(): string {
  return EstanzaCard.styles.cssText.replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  spots = new Map();

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement): number {
      return this.classList.contains('sheet') ? DOCK_WIDTH_PX : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement): number {
      if (!this.classList.contains('sheet')) return 0;

      return HEIGHTS[this.dataset.kind ?? 'light'] ?? HEIGHTS.light;
    },
  );
  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
    (scope: SceneScope) => spots.get(keyOf(scope)) ?? null,
  );
  vi.spyOn(EstanzaPlanView.prototype, 'anchorOf').mockImplementation(function (
    this: EstanzaPlanView,
    scope: SceneScope,
  ) {
    const at = spots.get(keyOf(scope));

    return at ? { x: at.x + this.shift.x, y: at.y + this.shift.y } : null;
  });

  for (const surface of [EstanzaSceneView, EstanzaPlanView]) {
    vi.spyOn(surface.prototype, 'roomFootprints').mockImplementation(
      (slugs: readonly string[]) =>
        new Map(
          slugs.slice(0, 1).map((slug) => [slug, { floor: house, top: [] }]),
        ),
    );
  }
});

afterEach(() => {
  motionLive.reduced = false;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a sheet on a 1280 px card', () => {
  const stage = { width: 1280, height: 720 };

  for (const view of ['3d', '2d'] as const) {
    it(`docks every device and room at the same place on the right in ${view}`, async () => {
      const card = await mountCard(1280, stage, view);
      const places = new Set<string>();

      for (const [, at] of edgesOf(stage)) {
        for (const key of things) {
          placeAt(key, at);
          await press(card, key);
          places.add(placeOf(card));
          await close(card);
        }
      }

      expect([...places]).toEqual([dockOf(stage)]);
    });
  }

  it('tiles all floors into the card beside a docked sheet, as if the card were that much narrower, and back once it closes', async () => {
    const small: Point[] = [
      { x: 700, y: 200 },
      { x: 900, y: 200 },
      { x: 900, y: 400 },
      { x: 700, y: 400 },
    ];

    vi.mocked(EstanzaPlanView.prototype.roomFootprints).mockImplementation(
      (slugs: readonly string[]) =>
        new Map(
          slugs.slice(0, 1).map((slug) => [slug, { floor: small, top: [] }]),
        ),
    );

    const card = await mountCard(1280, stage, '2d', threeStoreyHome());

    find(card, '.floors button[data-floor="all"]')?.click();
    await wait(card, VIEW_SWITCH_MS);
    placeAt('room:hall', { x: 640, y: 360 });
    await press(card, 'room:hall', 'tap');
    await wait(card, 0);

    const plan = find(card, 'estanza-plan-view') as EstanzaPlanView | null;

    const dockLeft = stage.width - EDGE_PX - DOCK_WIDTH_PX;

    expect(plan?.active).toBeNull();
    expect(placeOf(card)).toBe(dockOf(stage));
    expect(plan?.clear).not.toContainEqual(
      expect.objectContaining({ left: dockLeft }),
    );
    expect(plan?.shift).toEqual({ x: 0, y: 0 });
    expect(plan?.beside.right).toBe(stage.width - dockLeft);

    await close(card);
    await wait(card, 0);

    expect(plan?.shift).toEqual({ x: 0, y: 0 });
    expect(plan?.beside.right).toBe(0);
  });

  it('keeps all floors tiled beside the sheet while the plan fades into 3D', async () => {
    const card = await mountCard(1280, stage, '2d', threeStoreyHome());

    find(card, '.floors button[data-floor="all"]')?.click();
    await wait(card, VIEW_SWITCH_MS);
    placeAt('room:hall', { x: 640, y: 360 });
    await press(card, 'room:hall', 'tap');
    await wait(card, 0);
    find(card, '.views button[data-view="3d"]')?.click();
    await card.updateComplete;

    const plan = find(card, 'estanza-plan-view') as EstanzaPlanView | null;

    expect(plan?.classList).toContain('leaving');
    expect(plan?.beside.right).toBe(EDGE_PX + DOCK_WIDTH_PX);
  });

  it('is one width for rooms, devices and choosers, on a wall tablet too', () => {
    const widths = [...styleRules().matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(
        ([, selector, body]) =>
          /(?:^|\s)\.sheet(?:\.[\w-]+|:not\(\.[\w-]+\))*$/.test(
            selector.trim(),
          ) && /(?:^|[\s;])(?:max-|min-)?width: /.test(body),
      )
      .map(([, selector, body]) => `${selector.trim()} {${body}}`);

    expect(widths).toEqual([
      expect.stringMatching(
        new RegExp(
          `^\\.sheet:not\\(\\.bottom\\) \\{ width: ${DOCK_WIDTH_PX}px;[^}]*\\}$`,
        ),
      ),
      expect.stringMatching(/^\.sheet\.bottom \{[^}]*width: auto;/),
    ]);
  });
});

describe('a sheet on a 390 px phone', () => {
  const stage = { width: 390, height: 600 };

  for (const view of ['3d', '2d'] as const) {
    it(`rises from the bottom for every device and room in ${view}`, async () => {
      const card = await mountCard(390, stage, view);
      const places = new Set<string>();

      for (const [, at] of edgesOf(stage)) {
        for (const key of things) {
          placeAt(key, at);
          await press(card, key);
          places.add(placeOf(card));
          await close(card);
        }
      }

      expect([...places]).toEqual(['bottom ']);
    });
  }

  const risen = {
    x: 0,
    y:
      stage.height -
      HEIGHTS.light -
      SHEET_FRAME_MARGIN_PX -
      (stage.height - 30 + TARGET_RADIUS_PX),
  };

  it('keeps the plan at its scale and pans the tapped plug just above the sheet', async () => {
    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await press(card, 'light:plug');

    const plan = card.shadowRoot?.querySelector('estanza-plan-view');

    expect(plan?.shift).toEqual(risen);
    expect(plan?.clear).not.toContainEqual(
      expect.objectContaining({ top: stage.height - HEIGHTS.light }),
    );
  });

  function shown(card: EstanzaCard): number {
    const plan = find(card, 'estanza-plan-view') as EstanzaPlanView;
    const glide = card.style.getPropertyValue('--ez-glide-y');

    return plan.shift.y + Number.parseFloat(glide || '0');
  }

  it('glides the plan up to the sheet and back down, never in one frame', async () => {
    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await begin(card, 'light:plug');
    await wait(card, SHEET_GLIDE_MS / 2);

    const rising = shown(card);

    await wait(card, SHEET_GLIDE_MS * 2);

    expect(rising).toBeLessThan(0);
    expect(rising).toBeGreaterThan(risen.y);
    expect(shown(card)).toBe(risen.y);

    await close(card);
    await wait(card, SHEET_GLIDE_MS / 2);

    const falling = shown(card);

    await wait(card, SHEET_GLIDE_MS * 2);

    expect(falling).toBeLessThan(0);
    expect(falling).toBeGreaterThan(risen.y);
    expect(shown(card)).toBe(0);
  });

  it('still glides back down in steps when every frame takes 130 ms to draw', async () => {
    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await press(card, 'light:plug');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (step) =>
        window.setTimeout(
          () => step(performance.now()),
          130,
        ) as unknown as number,
    );
    await close(card);

    const steps = new Set<number>();

    for (let frame = 0; frame < 12; frame += 1) {
      await wait(card, 130);
      steps.add(shown(card));
    }

    steps.delete(0);
    steps.delete(risen.y);

    expect(steps.size).toBeGreaterThanOrEqual(5);
    expect(shown(card)).toBe(0);
  });

  it('moves the plan and everything on it together while it glides', () => {
    expect(styleRules()).toMatch(
      /\.stage\.on-plan :is\(estanza-plan-view, \.highlight, \.marks, \.temps, \.pins\) \{ translate: var\(--ez-glide-x, 0px\) var\(--ez-glide-y, 0px\); \}/,
    );
  });

  it('moves the plan in one step when motion is reduced', async () => {
    motionLive.reduced = true;

    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await begin(card, 'light:plug');

    expect(shown(card)).toBe(risen.y);
  });

  it('hands 3D the plan where the pan left it, so the two views meet on one house', async () => {
    const drawn = { left: 40, top: 300, right: 350, bottom: 580 };

    vi.spyOn(EstanzaPlanView.prototype, 'houseFrame').mockReturnValue(drawn);

    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await press(card, 'light:plug');
    find(card, 'estanza-plan-view')?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(
      (find(card, 'estanza-scene-view') as EstanzaSceneView | null)?.planFrame,
    ).toEqual({
      left: drawn.left,
      top: drawn.top + risen.y,
      right: drawn.right,
      bottom: drawn.bottom + risen.y,
    });
  });

  it('leaves the plan still when the tapped plug already shows above the sheet', async () => {
    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: 120 });
    await press(card, 'light:plug');

    expect(card.shadowRoot?.querySelector('estanza-plan-view')?.shift).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('pans the plan above a sheet opened in 3D once the plan comes in', async () => {
    const card = await mountCard(390, stage, '3d');
    const footprints = vi.mocked(EstanzaPlanView.prototype.roomFootprints);
    const drawn = footprints.getMockImplementation();

    footprints.mockImplementation(function (
      this: EstanzaPlanView,
      slugs: readonly string[],
    ) {
      return this.hasUpdated && drawn ? drawn.call(this, slugs) : new Map();
    });
    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await press(card, 'light:plug');
    find(card, '.views button[data-view="2d"]')?.click();
    await wait(card, VIEW_SWITCH_MS);
    find(card, 'estanza-plan-view')?.dispatchEvent(new Event('view-change'));
    await wait(card, VIEW_SWITCH_MS);

    const plan = find(card, 'estanza-plan-view') as EstanzaPlanView | null;

    expect(placeOf(card)).toBe('bottom ');
    expect(plan?.shift).toEqual(risen);
  });

  it('keeps the plan where it panned while it fades out to 3D', async () => {
    const card = await mountCard(390, stage, '2d');

    placeAt('light:plug', { x: 195, y: stage.height - 30 });
    await press(card, 'light:plug');

    const fitted = find(card, 'estanza-plan-view') as EstanzaPlanView | null;
    const before = fitted?.clear;

    expect(fitted?.shift).toEqual(risen);

    find(card, '.views button[data-view="3d"]')?.click();
    await settle(card);

    expect(fitted?.classList).toContain('leaving');
    expect(fitted?.clear).toEqual(before);
    expect(fitted?.shift).toEqual(risen);
  });

  it('covers the whole of a 390 px card on a wide screen and hides the plan under it', async () => {
    const card = await mountCard(1280, stage, '3d');
    const width = stage.width - 2 * EDGE_PX;

    placeAt('light:lamp', { x: 60, y: 60 });
    await press(card, 'light:lamp');

    expect(placeOf(card)).toBe(
      `docked left:${EDGE_PX}px;top:${EDGE_PX}px;width:${width}px;max-height:${stage.height - 2 * EDGE_PX}px`,
    );
    expect(find(card, '.stage')?.classList).toContain('covered');
  });
});

describe('opening another device', () => {
  it('swaps the content of the one sheet in place', async () => {
    const stage = { width: 1280, height: 720 };
    const card = await mountCard(1280, stage, '3d');

    placeAt('light:lamp', { x: 300, y: 300 });
    placeAt('light:plug', { x: 900, y: 500 });
    await press(card, 'light:lamp');

    const first = find(card, '.sheet');

    await press(card, 'light:plug');

    expect(find(card, '.sheet')).toBe(first);
    expect(placeOf(card)).toBe(dockOf(stage));
  });
});

describe('the view under a docked sheet', () => {
  const stage = { width: 1280, height: 720 };
  const opened = [
    { key: 'light:lamp', scope: { type: 'light', id: 'lamp' }, kind: 'light' },
    { key: 'room:hall', scope: { type: 'room', id: 'hall' }, kind: 'room' },
  ];

  function dockOver(kind: string) {
    return {
      left: stage.width - EDGE_PX - DOCK_WIDTH_PX,
      top: EDGE_PX,
      right: stage.width - EDGE_PX,
      bottom: EDGE_PX + HEIGHTS[kind],
    };
  }

  for (const { key, scope, kind } of opened) {
    it(`frames the 3D view into the space the sheet leaves for ${key}`, async () => {
      const card = await mountCard(1280, stage, '3d');

      placeAt(key, { x: 1150, y: 110 });
      await press(card, key);

      expect(
        card.shadowRoot?.querySelector('estanza-scene-view')?.sheet,
      ).toEqual({ scope, covered: dockOver(kind) });
    });

    it(`pans the plan rather than fitting it beside the sheet for ${key}`, async () => {
      const card = await mountCard(1280, stage, '2d');

      placeAt(key, { x: 1150, y: 110 });
      await press(card, key);

      const plan = card.shadowRoot?.querySelector('estanza-plan-view');

      expect(plan?.clear).not.toContainEqual(dockOver(kind));
      expect(plan?.shift).not.toEqual({ x: 0, y: 0 });
    });
  }

  it('keeps the 3D view where the plan draws the house until the plan has gone', async () => {
    vi.spyOn(EstanzaSceneView.prototype, 'drawable', 'get').mockReturnValue(
      true,
    );
    vi.spyOn(EstanzaSceneView.prototype, 'redraw').mockImplementation(() => {});

    const card = await mountCard(1280, stage, '2d');

    placeAt('light:lamp', { x: 1150, y: 110 });
    await press(card, 'light:lamp');
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.views button[data-view="3d"]')
      ?.click();
    await wait(card, VIEW_SWITCH_MS);

    expect(find(card, 'estanza-plan-view')?.classList).toContain('holding');
    expect(
      card.shadowRoot?.querySelector('estanza-scene-view')?.sheet,
    ).toBeNull();
  });

  it('pans a covered lamp the shortest way out from under the sheet', async () => {
    const card = await mountCard(1280, stage, '2d');

    placeAt('light:lamp', { x: 1150, y: 110 });
    await press(card, 'light:lamp');

    expect(card.shadowRoot?.querySelector('estanza-plan-view')?.shift).toEqual({
      x: 0,
      y:
        dockOver('light').bottom +
        SHEET_FRAME_MARGIN_PX -
        (110 - TARGET_RADIUS_PX),
    });
  });

  it('leaves the plan still when the tapped lamp already shows beside the sheet', async () => {
    const card = await mountCard(1280, stage, '2d');

    placeAt('light:lamp', { x: 300, y: 300 });
    await press(card, 'light:lamp');

    expect(card.shadowRoot?.querySelector('estanza-plan-view')?.shift).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('the plan under a sheet when the card changes size', () => {
  it('takes the pan back once the wider card shows the tapped lamp beside the sheet', async () => {
    const card = await mountCard(700, { width: 700, height: 806 }, '2d');
    const shown = find(card, '.stage');

    placeAt('light:lamp', { x: 600, y: 110 });
    await press(card, 'light:lamp');

    const before = card.shadowRoot?.querySelector('estanza-plan-view')?.shift;

    if (!shown) throw new Error('no stage');

    vi.spyOn(shown, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(shown, 'clientHeight', 'get').mockReturnValue(606);
    find(card, 'estanza-plan-view')?.dispatchEvent(new Event('view-change'));
    await settle(card);
    find(card, 'estanza-plan-view')?.dispatchEvent(new Event('view-change'));
    await wait(card, SHEET_GLIDE_MS * 2);

    const after = card.shadowRoot?.querySelector('estanza-plan-view')?.shift;

    expect(before).not.toEqual({ x: 0, y: 0 });
    expect(after).toEqual({ x: 0, y: 0 });
  });
});

describe("a lock's confirm target", () => {
  const stage = { width: 1280, height: 720 };

  for (const [edge, at] of edgesOf(stage)) {
    it(`stays whole inside the card over a lock at the ${edge}`, async () => {
      const card = await mountCard(1280, stage, '3d');

      placeAt('door:front', at);
      await press(card, 'door:front', 'tap');

      const pill = find(card, '.mark.armed');

      expect(pill).not.toBeNull();

      const x = parseFloat(pill?.style.left ?? 'NaN');
      const y = parseFloat(pill?.style.top ?? 'NaN');

      expect(x - 44).toBeGreaterThanOrEqual(EDGE_PX);
      expect(x + 44).toBeLessThanOrEqual(stage.width - EDGE_PX);
      expect(y - 22).toBeGreaterThanOrEqual(EDGE_PX);
      expect(y + 22).toBeLessThanOrEqual(stage.height - EDGE_PX);
      expect(Math.abs(x - at.x)).toBeLessThanOrEqual(44);
      expect(Math.abs(y - at.y)).toBeLessThanOrEqual(22);
    });
  }
});
