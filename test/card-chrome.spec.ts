import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import type { EstanzaPlanView } from '../src/plan-view.js';
import type { EstanzaSceneView } from '../src/scene-view.js';
import { drawPlansAt } from './drawn-plan.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockEntityState,
  mockLight,
  mockSensor,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

type Sun = { elevation: number; azimuth: number };

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  {
    scope: { type: 'room', id: 'hall' },
    entity_id: 'light.hall',
    temperature_entity_id: 'sensor.hall_temperature',
  },
];

const day: Sun = { elevation: 30, azimuth: 180 };
const night: Sun = { elevation: -20, azimuth: 300 };

function sunState(sun: Sun) {
  return mockEntityState(
    'sun.sun',
    sun.elevation > 0 ? 'above_horizon' : 'below_horizon',
    sun,
  );
}

async function mountCard(
  sun: Sun,
  darkMode: boolean,
  extra: Record<string, unknown> = {},
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  card.hass = {
    ...createMockHass({
      states: [
        mockLight('light.living', { on: true }),
        mockLight('light.hall', { on: false }),
        mockSensor('sensor.hall_temperature', 'temperature', 21, '°C'),
        sunState(sun),
      ],
    }),
    themes: { darkMode },
  };
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
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
    await planOf(card)?.updateComplete;
  }
}

async function showPlan(card: EstanzaCard): Promise<void> {
  part(card, '.views button[data-view="2d"]').click();
  await settle(card);
  await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
  await settle(card);
  await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
  await settle(card);
}

function sceneOf(card: EstanzaCard): EstanzaSceneView {
  const scene = card.shadowRoot?.querySelector('estanza-scene-view');

  if (!scene) throw new Error('no scene in the card');

  return scene;
}

function planOf(card: EstanzaCard): EstanzaPlanView | null {
  return card.shadowRoot?.querySelector('estanza-plan-view') ?? null;
}

function part(card: EstanzaCard, selector: string): HTMLElement {
  const found = card.shadowRoot?.querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`no ${selector} in the card`);

  return found;
}

function lookOf(card: EstanzaCard, element: Element): string {
  const dressed = element.closest('[data-look]')?.getAttribute('data-look');

  return dressed ?? (card.hasAttribute('dark') ? 'dark' : 'light');
}

function chromeOf(card: EstanzaCard): string[] {
  return ['.views', '.floors'].map((selector) =>
    lookOf(card, part(card, selector)),
  );
}

function sheetsIn(card: EstanzaCard): Element {
  return part(card, '.stage .sheets');
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the chrome over the scene', () => {
  it('is dark over a day scene by day in a dark theme', async () => {
    const card = await mountCard(day, true);

    expect(chromeOf(card)).toEqual(['dark', 'dark']);
    expect(card.hasAttribute('dark')).toBe(true);
    expect(sceneOf(card).night).toBe(false);
    expect(sceneOf(card).sun).toEqual(day);
  });

  it('stays light over a night scene by day in a light theme when the card keeps the night', async () => {
    const card = await mountCard(day, false, { night: 'night' });

    expect(chromeOf(card)).toEqual(['light', 'light']);
    expect(card.hasAttribute('dark')).toBe(false);
    expect(sceneOf(card).night).toBe(true);
    expect(sceneOf(card).sun).toBeNull();
  });

  it('stays light over a night scene when the scene follows the sun in a light theme', async () => {
    const card = await mountCard(night, false, { night: 'auto' });

    expect(chromeOf(card)).toEqual(['light', 'light']);
    expect(card.hasAttribute('dark')).toBe(false);
    expect(sceneOf(card).night).toBe(true);
    expect(sceneOf(card).sun).toEqual(night);
  });

  it('stays dark over a day scene in a dark theme when the card keeps the day', async () => {
    const card = await mountCard(night, true, { night: 'day' });

    expect(chromeOf(card)).toEqual(['dark', 'dark']);
    expect(sceneOf(card).night).toBe(false);
  });

  it('turns over with the theme, never with the sunset', async () => {
    const card = await mountCard(day, false);
    const hass = card.hass;

    if (!hass) throw new Error('no hass');

    card.hass = {
      ...hass,
      states: { ...hass.states, 'sun.sun': sunState(night) },
    };
    await settle(card);

    expect(chromeOf(card)).toEqual(['light', 'light']);

    card.hass = { ...card.hass, themes: { darkMode: true } };
    await settle(card);

    expect(chromeOf(card)).toEqual(['dark', 'dark']);
    expect(card.hasAttribute('dark')).toBe(true);
  });

  it('dresses a sheet that floats on a wide card like the theme', async () => {
    const card = await mountCard(day, true);

    vi.spyOn(part(card, '.stage'), 'clientWidth', 'get').mockReturnValue(1280);
    vi.spyOn(part(card, '.stage'), 'clientHeight', 'get').mockReturnValue(800);
    card.requestUpdate();
    await settle(card);

    expect(lookOf(card, sheetsIn(card))).toBe('dark');
  });

  it('dresses a floating sheet light over a night scene in a light theme', async () => {
    const card = await mountCard(night, false, { night: 'auto' });

    vi.spyOn(part(card, '.stage'), 'clientWidth', 'get').mockReturnValue(1280);
    vi.spyOn(part(card, '.stage'), 'clientHeight', 'get').mockReturnValue(800);
    card.requestUpdate();
    await settle(card);

    expect(lookOf(card, sheetsIn(card))).toBe('light');
  });

  it('dresses the bottom sheet of a phone like the dashboard theme', async () => {
    vi.stubGlobal('innerWidth', 390);

    const card = await mountCard(day, true);

    vi.spyOn(part(card, '.stage'), 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(part(card, '.stage'), 'clientHeight', 'get').mockReturnValue(700);
    card.requestUpdate();
    await settle(card);

    expect(lookOf(card, sheetsIn(card))).toBe('dark');
  });
});

describe('the floor plan under the chrome', () => {
  it('lays dark paper with the night look by day in a dark theme', async () => {
    const card = await mountCard(day, true);

    await showPlan(card);

    expect(planOf(card)?.scheme).toBe('dark');
    expect(planOf(card)?.night).toBe(true);
    expect(chromeOf(card)).toEqual(['dark', 'dark']);
  });

  it('lays light paper at night in a light theme, even when the scene follows the sun', async () => {
    const card = await mountCard(night, false, { night: 'auto' });

    await showPlan(card);

    expect(planOf(card)?.scheme).toBe('light');
    expect(planOf(card)?.night).toBe(false);
    expect(chromeOf(card)).toEqual(['light', 'light']);
  });

  it('dresses the temperatures like the paper they sit on', async () => {
    drawPlansAt({ width: 800, height: 600 });

    const light = await mountCard(night, false, { night: 'auto' });

    await showPlan(light);

    expect(part(light, '.temps').classList.contains('dark')).toBe(false);

    document.body.replaceChildren();

    const dark = await mountCard(day, true);

    await showPlan(dark);

    expect(part(dark, '.temps').classList.contains('dark')).toBe(true);
  });
});
