import '../src/card.js';

import { type CanvasState, drawPlan, planPalette } from '@estanza/plan2d';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { controlStyles } from '../src/control-view.js';
import type { HassEntityState } from '../src/hass-state.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import type { EstanzaSceneView } from '../src/scene-view.js';
import { tileStyles } from '../src/tile-view.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
  mockLight,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

vi.mock('@estanza/plan2d', async (original) => {
  const real = await original<typeof import('@estanza/plan2d')>();

  return { ...real, drawPlan: vi.fn(fakeDraw) };
});

const TILE = { rows: 2, columns: 6 };
const WIDE = { rows: 2, columns: 12 };

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  { scope: { type: 'light', id: 'cellar-light' }, entity_id: 'light.cellar' },
  { scope: { type: 'room', id: 'hall' }, entity_id: 'light.hall' },
  {
    scope: { type: 'room', id: 'cellar' },
    entity_ids: ['binary_sensor.cellar_leak'],
  },
];

let hass: MockHass;

function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};

  return new Proxy(store, {
    get: (target, key) =>
      key in target ? target[key] : () => ({ addColorStop: () => undefined }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeDraw(
  ctx: CanvasRenderingContext2D,
  view: Parameters<typeof drawPlan>[1],
): CanvasState {
  const cs = {
    ctx,
    width: view.width,
    height: view.height,
    zoom: 0.1,
    camX: 0,
    camY: 0,
    palette: view.palette,
    units: view.units,
    words: view.words,
    labels: [],
  } as unknown as CanvasState;

  view.overlay?.(cs);

  return cs;
}

function sun(state: string): HassEntityState {
  return mockEntityState('sun.sun', state);
}

async function mountTile(
  extra: Record<string, unknown> = {},
  states: HassEntityState[] = [],
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.living', { on: true }),
      mockLight('light.cellar', { on: false }),
      mockLight('light.hall', { on: false }),
      mockBinarySensor('binary_sensor.cellar_leak', 'moisture', false),
      mockEntityState('sensor.outside_humidity', '60'),
      sun('above_horizon'),
      ...states,
    ],
  });
  card.hass = hass;
  card.layout = 'grid';
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    grid_options: TILE,
    bindings,
    ...extra,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await sceneOf(card)?.updateComplete;

    for (const plan of plans(card)) await plan.updateComplete;
  }
}

async function setState(
  card: EstanzaCard,
  entityId: string,
  state: string,
): Promise<void> {
  const known = hass.states[entityId] ?? mockEntityState(entityId, state);

  hass = {
    ...hass,
    states: { ...hass.states, [entityId]: { ...known, state } },
  };
  card.hass = hass;
  await settle(card);
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

function plans(card: EstanzaCard): EstanzaPlanView[] {
  return [
    ...(card.shadowRoot?.querySelectorAll<EstanzaPlanView>(
      '.tile estanza-plan-view',
    ) ?? []),
  ];
}

function wordsBesideStoreys(card: EstanzaCard): string {
  const tile = tileOf(card).cloneNode(true) as HTMLElement;

  for (const storey of tile.querySelectorAll('.tile-storey')) storey.remove();

  return tile.textContent?.replace(/\s+/g, '') ?? '';
}

function tileOf(card: EstanzaCard): HTMLElement {
  const tile = card.shadowRoot?.querySelector<HTMLElement>('ha-card.tile');

  if (!tile) throw new Error('the card is not a tile');

  return tile;
}

function lightCount(card: EstanzaCard): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>('.tile-lights') ?? null;
}

function alertGlyph(card: EstanzaCard): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>('.tile-alert') ?? null;
}

function house(card: EstanzaCard): HTMLDialogElement | null {
  return card.shadowRoot?.querySelector('dialog.house') ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (kind: string) => (kind === '2d' ? fakeContext() : null) as never,
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(EstanzaPlanView.prototype, 'clientWidth', {
    configurable: true,
    get: () => 240,
  });
  Object.defineProperty(EstanzaPlanView.prototype, 'clientHeight', {
    configurable: true,
    get: () => 120,
  });
  vi.mocked(drawPlan).mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(EstanzaPlanView.prototype, 'clientWidth');
  Reflect.deleteProperty(EstanzaPlanView.prototype, 'clientHeight');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the tile size', () => {
  it('lets the sections view shrink the card to a two row tile', () => {
    const card = document.createElement('estanza-card');

    expect(card.getGridOptions().min_rows).toBe(2);
  });

  it('draws a still plan of the ground floor at six wide', async () => {
    const card = await mountTile();

    expect(tileOf(card)).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.stage')).toBeNull();
    expect(plans(card).map((plan) => plan.active)).toEqual(['f1']);
    expect(plans(card)[0].interactive).toBe(false);
    expect(plans(card)[0].still).toBe(true);
    expect(plans(card)[0].targets).toEqual([]);
  });

  it('shows every floor side by side at twelve wide, lowest first', async () => {
    const card = await mountTile({ grid_options: WIDE });

    expect(plans(card).map((plan) => plan.active)).toEqual([
      'bfloor',
      'f1',
      'ufloor',
    ]);
  });

  it('labels each storey side by side with its short name', async () => {
    const card = await mountTile({ grid_options: WIDE });
    const labels = [
      ...(card.shadowRoot?.querySelectorAll('.tile-floor .tile-storey') ?? []),
    ].map((label) => label.textContent?.trim());

    expect(labels).toEqual(['B', 'Grd', '1st']);
  });

  it('keeps each plan clear of the storey name in its corner', async () => {
    const card = await mountTile({ grid_options: WIDE });

    for (const plan of plans(card)) {
      expect(plan.clear).toEqual([
        expect.objectContaining({ left: 0, top: 0 }),
      ]);
      expect(plan.clear[0].right).toBeGreaterThan(0);
      expect(plan.clear[0].bottom).toBeGreaterThan(0);
    }
  });

  it('labels the one storey a narrow tile shows', async () => {
    const card = await mountTile();

    expect(
      card.shadowRoot?.querySelector('.tile-floor .tile-storey')?.textContent,
    ).toBe('Grd');
  });

  it('shows every floor for a full width tile too', async () => {
    const card = await mountTile({
      grid_options: { rows: 2, columns: 'full' },
    });

    expect(plans(card)).toHaveLength(3);
  });

  it('stays the live house at four rows and more', async () => {
    const card = await mountTile({ grid_options: { rows: 4, columns: 6 } });

    expect(card.shadowRoot?.querySelector('.tile')).toBeNull();
    expect(card.shadowRoot?.querySelector('.stage')).not.toBeNull();
  });

  it('never asks for a WebGL context', async () => {
    const card = await mountTile({ grid_options: WIDE });
    const kinds = vi
      .mocked(HTMLCanvasElement.prototype.getContext)
      .mock.calls.map(([kind]) => kind);

    expect(sceneOf(card)?.headless).toBe(true);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((kind) => kind === '2d')).toBe(true);
  });
});

describe('what the tile shows', () => {
  it('keeps light paper and the day look at night in a light theme', async () => {
    const card = await mountTile();

    expect(plans(card)[0].scheme).toBe('light');
    expect(plans(card)[0].night).toBe(false);
    expect(tileOf(card).style.getPropertyValue('--ez-tile-page')).toBe(
      planPalette('light').page,
    );

    await setState(card, 'sun.sun', 'below_horizon');

    expect(plans(card)[0].scheme).toBe('light');
    expect(plans(card)[0].night).toBe(false);
    expect(tileOf(card).style.getPropertyValue('--ez-tile-page')).toBe(
      planPalette('light').page,
    );
  });

  it('turns to dark paper and the night look with the dashboard theme, by day', async () => {
    const card = await mountTile();

    hass = { ...hass, themes: { darkMode: true } };
    card.hass = hass;
    await settle(card);

    expect(plans(card)[0].scheme).toBe('dark');
    expect(plans(card)[0].night).toBe(true);
    expect(card.hasAttribute('dark')).toBe(true);
    expect(tileOf(card).style.getPropertyValue('--ez-tile-page')).toBe(
      planPalette('dark').page,
    );
  });

  it('hands the plan the lights that are on, so lit rooms are warm', async () => {
    const card = await mountTile();

    expect(plans(card)[0].overlay.lights['living-space-light']?.on).toBe(true);
  });

  it('fills a room with a critical alert and moves the tile to its storey', async () => {
    const card = await mountTile();

    expect(alertGlyph(card)).toBeNull();

    await setState(card, 'binary_sensor.cellar_leak', 'on');

    expect(plans(card).map((plan) => plan.active)).toEqual(['bfloor']);
    expect(plans(card)[0].roomMarks.cellar?.danger).toBe('room');
    expect(alertGlyph(card)?.getAttribute('aria-label')).toBe('Basement leak');
    expect(alertGlyph(card)?.querySelector('svg')).not.toBeNull();
  });

  it('goes back to the ground floor once the alert clears', async () => {
    const card = await mountTile();

    await setState(card, 'binary_sensor.cellar_leak', 'on');
    await setState(card, 'binary_sensor.cellar_leak', 'off');

    expect(plans(card).map((plan) => plan.active)).toEqual(['f1']);
    expect(alertGlyph(card)).toBeNull();
  });

  it('counts the lights that are on beside a bulb', async () => {
    const card = await mountTile();

    expect(lightCount(card)?.textContent?.trim()).toBe('1');
    expect(lightCount(card)?.getAttribute('aria-label')).toBe('1 light on');
    expect(lightCount(card)?.querySelector('svg')).not.toBeNull();

    await setState(card, 'light.hall', 'on');

    expect(lightCount(card)?.textContent?.trim()).toBe('2');
    expect(lightCount(card)?.getAttribute('aria-label')).toBe('2 lights on');
  });

  it('shows no count at all when no light is on', async () => {
    const card = await mountTile();

    await setState(card, 'light.living', 'off');

    expect(lightCount(card)).toBeNull();
    expect(wordsBesideStoreys(card)).toBe('');
  });

  it('carries no words beside the short storey names, only the count', async () => {
    const card = await mountTile();

    await setState(card, 'binary_sensor.cellar_leak', 'on');

    expect(wordsBesideStoreys(card)).toMatch(/^\d+$/);
  });
});

describe('opening the house from the tile', () => {
  it('goes to the configured view on a tap', async () => {
    const card = await mountTile({ navigation_path: '/estanza-dev/wall' });
    const moved = vi.fn();

    window.addEventListener('location-changed', moved);
    tileOf(card).click();
    window.removeEventListener('location-changed', moved);

    expect(location.pathname).toBe('/estanza-dev/wall');
    expect(moved).toHaveBeenCalledTimes(1);
    expect(house(card)).toBeNull();
  });

  it('opens the house in a dialog at section size when no view is set', async () => {
    const card = await mountTile();

    tileOf(card).click();
    await settle(card);

    const inner = house(card)?.querySelector('estanza-card');

    expect(house(card)?.open).toBe(true);
    expect(inner?.hass).toBe(hass);
    expect(inner?.layout).toBe('grid');

    await inner?.updateComplete;

    expect(inner?.shadowRoot?.querySelector('.stage')).not.toBeNull();
  });

  it('opens it from the keyboard as well', async () => {
    const card = await mountTile();

    tileOf(card).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle(card);

    expect(house(card)?.open).toBe(true);
  });

  it('names the tile and the close button without visible words', async () => {
    const card = await mountTile();

    expect(tileOf(card).getAttribute('role')).toBe('button');
    expect(tileOf(card).getAttribute('aria-label')).toBe('Open the house');

    tileOf(card).click();
    await settle(card);

    const close = house(card)?.querySelector<HTMLButtonElement>('.close');

    expect(close?.getAttribute('aria-label')).toBe('Close');
    expect(close?.title).toBe('Close');
    expect(close?.textContent?.trim()).toBe('');

    close?.click();
    await settle(card);

    expect(house(card)).toBeNull();
  });

  it('heads the dialog with the home name, its close beside it', async () => {
    const card = await mountTile({ title: 'Seaside flat' });

    tileOf(card).click();
    await settle(card);

    const head = house(card)?.querySelector('.house-head');
    const inner = house(card)?.querySelector('estanza-card');

    await inner?.updateComplete;

    expect(head?.querySelector('.house-title')?.textContent).toBe(
      'Seaside flat',
    );
    expect(head?.querySelector('.close')).not.toBeNull();
    expect(inner?.shadowRoot?.querySelector('.title')).toBeNull();
  });

  it('closes from a tap outside it', async () => {
    const card = await mountTile();

    tileOf(card).click();
    await settle(card);
    house(card)?.click();
    await settle(card);

    expect(house(card)).toBeNull();
  });
});

describe('drawing the tile', () => {
  it('draws once, and not again while nothing it shows changes', async () => {
    const card = await mountTile();

    expect(drawPlan).toHaveBeenCalledTimes(1);

    card.hass = { ...hass };
    await settle(card);
    await setState(card, 'sensor.outside_humidity', '61');

    expect(drawPlan).toHaveBeenCalledTimes(1);
  });

  it('redraws one storey for one light at twelve wide', async () => {
    const card = await mountTile({ grid_options: WIDE });

    expect(drawPlan).toHaveBeenCalledTimes(3);

    await setState(card, 'light.hall', 'on');

    expect(drawPlan).toHaveBeenCalledTimes(4);
  });
});

describe('the alert badge on the tile', () => {
  function luminance(hex: string): number {
    const value = Number.parseInt(hex.slice(1, 7), 16);
    const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map(
      (channel) => {
        const unit = channel / 255;

        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      },
    );

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);

    return (light + 0.05) / (dark + 0.05);
  }

  function block(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);

    return css.slice(start, css.indexOf('}', start));
  }

  function resolved(theme: 'light' | 'dark', property: string): string {
    const css = controlStyles.cssText;
    const vars = block(css, theme === 'light' ? ':host' : ':host([dark])');
    const rule = block(tileStyles.cssText, '.tile-alert');
    const name = new RegExp(`\\n\\s*${property}: var\\((--[\\w-]+)\\)`).exec(
      rule,
    )?.[1];

    return new RegExp(`${name}: (#[0-9a-fA-F]{6})`).exec(vars)?.[1] ?? '';
  }

  it.each(['light', 'dark'] as const)(
    'stands out at 3:1 from the tile paper in the %s theme, with its icon at 3:1 on it',
    (theme) => {
      const fill = resolved(theme, 'background');
      const ink = resolved(theme, 'color');

      expect(contrast(fill, planPalette(theme).page)).toBeGreaterThanOrEqual(3);
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(3);
    },
  );
});
