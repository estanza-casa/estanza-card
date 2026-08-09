import '../src/card.js';

import { ROOM_FILL } from '@estanza/plan-engine/geometry/plan-drawing.js';
import { planPalette } from '@estanza/plan2d';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { alertStyles, PIN_FADE_MS } from '../src/alert-view.js';
import type { SceneScope } from '../src/bindings.js';
import { cardType, type SceneBinding, scopeKey } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { controlStyles, dotLook } from '../src/control-view.js';
import type { Point } from '../src/gesture.js';
import { covered, type Theme } from '../src/living.js';
import { TOUCH_PX } from '../src/mark-layout.js';
import { NIGHT_SHADE, VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { drawPlansAt } from './drawn-plan.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  type MockHass,
  mockLight,
  mockSensor,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const DOOR = { x: 300, y: 200 };
const themes: Theme[] = ['light', 'dark'];

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.door_d1' },
  { scope: { type: 'door', id: 'd2' }, entity_id: 'binary_sensor.door_d2' },
  { scope: { type: 'window', id: 'n1' }, entity_id: 'binary_sensor.window_n1' },
  {
    scope: { type: 'room', id: 'living-space' },
    temperature_entity_id: 'sensor.living_temperature',
  },
];

let hass: MockHass;

async function mountCard(
  windowClass = 'window',
  theme: Theme = 'light',
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.living', { on: false }),
      mockBinarySensor('binary_sensor.door_d1', 'door', false),
      mockBinarySensor('binary_sensor.door_d2', 'door', false),
      mockBinarySensor('binary_sensor.window_n1', windowClass, false),
      mockSensor('sensor.living_temperature', 'temperature', 21.4, '°C'),
    ],
  });
  hass.themes = { darkMode: theme === 'dark' };
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    bindings,
  });
  document.body.append(card);
  await settle(card);

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

async function openDoor(
  card: EstanzaCard,
  since: Date,
  entityId = 'binary_sensor.door_d1',
): Promise<void> {
  hass = {
    ...hass,
    states: {
      ...hass.states,
      [entityId]: {
        ...hass.states[entityId],
        state: 'on',
        last_changed: since.toISOString(),
      },
    },
  };
  card.hass = hass;
  await settle(card);
}

async function closeContact(
  card: EstanzaCard,
  entityId: string,
): Promise<void> {
  hass = {
    ...hass,
    states: {
      ...hass.states,
      [entityId]: {
        ...hass.states[entityId],
        state: 'off',
        last_changed: new Date().toISOString(),
      },
    },
  };
  card.hass = hass;
  await settle(card);
  await vi.advanceTimersByTimeAsync(PIN_FADE_MS);
  await settle(card);
}

function pins(card: EstanzaCard): HTMLElement[] {
  return [...(card.shadowRoot?.querySelectorAll<HTMLElement>('.pin') ?? [])];
}

async function showPlan(card: EstanzaCard): Promise<void> {
  card.shadowRoot
    ?.querySelector<HTMLButtonElement>('.views button[data-view="2d"]')
    ?.click();
  await settle(card);
  card.shadowRoot
    ?.querySelector('estanza-plan-view')
    ?.dispatchEvent(new Event('view-change'));
  await settle(card);

  for (let step = 0; step < 2; step += 1) {
    await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
    await settle(card);
  }
}

function anchorsAt(where: Record<string, Point>) {
  return (scope: SceneScope): Point | null =>
    Object.hasOwn(where, scopeKey(scope)) ? where[scopeKey(scope)] : null;
}

function placeIn3d(where: Record<string, Point>): void {
  const at = anchorsAt(where);

  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(at);
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    (scopes) =>
      new Map(
        scopes.flatMap((scope) => {
          const point = at(scope);

          return point ? [[scopeKey(scope), point]] : [];
        }),
      ),
  );
}

function mark(card: EstanzaCard, key: string): HTMLElement | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(`.mark[data-key="${key}"]`) ??
    null
  );
}

function spotOf(element: HTMLElement | null): Point {
  return {
    x: parseFloat(element?.style.left ?? 'NaN'),
    y: parseFloat(element?.style.top ?? 'NaN'),
  };
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

describe('a linked door or window in 3D', () => {
  it('keeps a quiet mark on a shut door and a glyph on a light without a hover', async () => {
    placeIn3d({
      'door:d1': DOOR,
      'light:living-space-light': { x: 80, y: 80 },
    });

    const card = await mountCard();
    const door = mark(card, 'door:d1');

    expect(door?.classList).toContain('opening');
    expect(door?.classList).not.toContain('open');
    expect(door?.classList).not.toContain('hint');
    expect(spotOf(door)).toEqual(DOOR);
    expect(mark(card, 'light:living-space-light')).not.toBeNull();
  });

  it('names the mark by its icon alone', async () => {
    placeIn3d({ 'door:d1': DOOR });

    const card = await mountCard();
    const door = mark(card, 'door:d1');

    expect(door?.textContent?.trim()).toBe('');
    expect(door?.getAttribute('aria-label')).toBeTruthy();
  });

  it('draws a shut door as a small dot with no icon', async () => {
    placeIn3d({ 'door:d1': DOOR });

    const card = await mountCard();
    const door = mark(card, 'door:d1');

    expect(door?.classList).toContain('dot');
    expect(door?.querySelector('.icon')).toBeNull();
  });

  it('turns the mark to the accent the moment the door opens', async () => {
    placeIn3d({ 'door:d1': DOOR });

    const card = await mountCard();

    await openDoor(card, new Date());

    const door = mark(card, 'door:d1');

    expect(door?.classList).toContain('open');
    expect(door?.classList).not.toContain('dot');
    expect(door?.querySelector('.icon')).not.toBeNull();
  });

  it('draws a shut window as the same small dot', async () => {
    placeIn3d({ 'window:n1': DOOR });

    const card = await mountCard();
    const pane = mark(card, 'window:n1');

    expect(pane?.classList).toContain('opening');
    expect(pane?.classList).toContain('dot');
    expect(pane?.classList).not.toContain('open');
  });

  it('turns the window mark to the accent the moment the window opens', async () => {
    placeIn3d({ 'window:n1': DOOR });

    const card = await mountCard();

    await openDoor(card, new Date(), 'binary_sensor.window_n1');

    const pane = mark(card, 'window:n1');

    expect(pane?.classList).toContain('open');
    expect(pane?.classList).not.toContain('dot');
    expect(pane?.querySelector('.icon')).not.toBeNull();
    expect(pane?.textContent?.trim()).toBe('');
  });

  it('gives the mark up to the pin of a door left open', async () => {
    placeIn3d({ 'door:d1': DOOR });

    const card = await mountCard();

    await openDoor(card, new Date(2026, 8, 23, 19, 0));

    expect(card.shadowRoot?.querySelector('.pin')).not.toBeNull();
    expect(mark(card, 'door:d1')).toBeNull();
  });

  it('draws two shut doors that would overlap where they sit, with no leader', async () => {
    placeIn3d({ 'door:d1': DOOR, 'door:d2': { x: DOOR.x + 10, y: DOOR.y } });

    const card = await mountCard();

    expect(spotOf(mark(card, 'door:d1'))).toEqual(DOOR);
    expect(spotOf(mark(card, 'door:d2'))).toEqual({
      x: DOOR.x + 10,
      y: DOOR.y,
    });
    expect(card.shadowRoot?.querySelector('.mark-leader')).toBeNull();
    expect(card.shadowRoot?.querySelector('.bubble')).toBeNull();
  });

  it('keeps the open door on its door and a shut one in its way where it sits', async () => {
    const beside = { x: DOOR.x + 10, y: DOOR.y };

    placeIn3d({ 'door:d1': DOOR, 'door:d2': beside });

    const card = await mountCard();

    await openDoor(card, new Date(), 'binary_sensor.door_d2');

    expect(mark(card, 'door:d2')?.classList).toContain('open');
    expect(spotOf(mark(card, 'door:d2'))).toEqual(beside);
    expect(spotOf(mark(card, 'door:d1'))).toEqual(DOOR);
    expect(card.shadowRoot?.querySelector('.mark-leader')).toBeNull();
  });

  it('moves an open door out of the way of another open door along a leader', async () => {
    placeIn3d({ 'door:d1': DOOR, 'door:d2': { x: DOOR.x + 10, y: DOOR.y } });

    const card = await mountCard();

    await openDoor(card, new Date(), 'binary_sensor.door_d1');
    await openDoor(card, new Date(), 'binary_sensor.door_d2');

    const one = spotOf(mark(card, 'door:d1'));
    const two = spotOf(mark(card, 'door:d2'));

    expect(
      Math.abs(two.x - one.x) >= TOUCH_PX ||
        Math.abs(two.y - one.y) >= TOUCH_PX,
    ).toBe(true);
    expect(card.shadowRoot?.querySelector('.mark-leader')).not.toBeNull();
  });
});

describe('a window with a door contact on it, left open', () => {
  const ABOVE = { x: 300, y: 90 };
  const GLASS = { x: 300, y: 330 };
  const LEFT_OPEN = new Date(2026, 8, 23, 19, 0);
  const CONTACT = 'binary_sensor.window_n1';

  function placeClose(): void {
    vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
      anchorsAt({ 'window:n1': ABOVE }),
    );
    vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
      (scopes) =>
        new Map(
          scopes
            .filter((scope) => scopeKey(scope) === 'window:n1')
            .map((scope) => [scopeKey(scope), GLASS]),
        ),
    );
  }

  it.each(themes)(
    'shows one pin and no mark from a close camera inside the room, in the %s theme',
    async (theme) => {
      placeClose();

      const card = await mountCard('door', theme);

      await openDoor(card, LEFT_OPEN, CONTACT);

      expect(card.hasAttribute('dark')).toBe(theme === 'dark');
      expect(pins(card)).toHaveLength(1);
      expect(mark(card, 'window:n1')).toBeNull();
    },
  );

  it('turns the pin to the notice look while open and back to a shut dot when closed', async () => {
    placeClose();

    const card = await mountCard('door');

    await openDoor(card, LEFT_OPEN, CONTACT);

    expect(pins(card).map((pin) => pin.classList.contains('notice'))).toEqual([
      true,
    ]);

    await closeContact(card, CONTACT);

    expect(pins(card)).toHaveLength(0);
    expect(mark(card, 'window:n1')?.classList).toContain('dot');
    expect(mark(card, 'window:n1')?.classList).not.toContain('open');
  });

  it('draws the notice pin in the accent, like an open mark', () => {
    expect(alertStyles.cssText).toMatch(
      /\.pin\.notice \.pin-head \{[^}]*background: var\(--ez-accent\)[^}]*color: var\(--ez-on-accent\)/,
    );
  });

  it('opens the window it is linked to, not a door', async () => {
    placeClose();

    const card = await mountCard('door');

    await openDoor(card, new Date(), CONTACT);

    expect(card.overlay.windows.n1).toBe(1);
    expect(card.overlay.doors).toEqual({ d1: 0, d2: 0 });
    expect(mark(card, 'window:n1')?.classList).toContain('open');
    expect(pins(card)).toHaveLength(0);
  });

  it('shows one pin and no mark on the plan', async () => {
    vi.spyOn(EstanzaPlanView.prototype, 'anchorOf').mockImplementation(
      anchorsAt({ 'window:n1': GLASS }),
    );

    const card = await mountCard('door', 'dark');

    await showPlan(card);
    await openDoor(card, LEFT_OPEN, CONTACT);

    expect(pins(card)).toHaveLength(1);
    expect(mark(card, 'window:n1')).toBeNull();
  });
});

describe('a linked door or window on the plan', () => {
  function placeOnPlan(where: Record<string, Point>): void {
    vi.spyOn(EstanzaPlanView.prototype, 'anchorOf').mockImplementation(
      anchorsAt(where),
    );
  }

  it('keeps a quiet mark on a shut door', async () => {
    placeOnPlan({ 'door:d1': DOOR });

    const card = await mountCard();

    await showPlan(card);

    expect(mark(card, 'door:d1')?.classList).toContain('opening');
    expect(mark(card, 'door:d1')?.classList).not.toContain('open');
  });

  it('turns the mark to the accent when the door opens', async () => {
    placeOnPlan({ 'door:d1': DOOR });

    const card = await mountCard();

    await showPlan(card);
    await openDoor(card, new Date());

    expect(mark(card, 'door:d1')?.classList).toContain('open');
  });

  function glyphSpots(card: EstanzaCard): Map<string, Point> {
    const plan = card.shadowRoot?.querySelector('estanza-plan-view');

    return new Map(
      (plan?.glyphs ?? []).flatMap(({ scope, nudge }) => {
        const at = plan?.anchorOf(scope);

        return at
          ? [[scopeKey(scope), { x: at.x + nudge.x, y: at.y + nudge.y }]]
          : [];
      }),
    );
  }

  it('hands the plan an open door mark so a room tag moves out from under it', async () => {
    placeOnPlan({ 'door:d1': DOOR });

    const card = await mountCard();

    await showPlan(card);
    await openDoor(card, new Date());

    expect(glyphSpots(card).get('door:d1')).toEqual(DOOR);
  });

  it('hands the plan every mark at the spot it is drawn, so a room tag moves out from under it', async () => {
    placeOnPlan({
      'light:living-space-light': DOOR,
      'door:d1': { x: DOOR.x + 10, y: DOOR.y },
    });

    const card = await mountCard();

    await showPlan(card);
    await openDoor(card, new Date());

    const spots = glyphSpots(card);
    const light = spotOf(mark(card, 'light:living-space-light'));
    const door = spotOf(mark(card, 'door:d1'));

    expect(door).not.toEqual({ x: DOOR.x + 10, y: DOOR.y });
    expect(spots.get('light:living-space-light')).toEqual(light);
    expect(spots.get('door:d1')).toEqual(door);
  });

  it('hides a shut door dot under a room name rather than lead it away', async () => {
    const name = { key: 'name:living-space', ...DOOR, width: 60, height: 14 };

    placeOnPlan({ 'door:d1': DOOR });
    vi.spyOn(EstanzaPlanView.prototype, 'wordBoxes').mockReturnValue([name]);

    const card = await mountCard();

    await showPlan(card);

    expect(mark(card, 'door:d1')).toBeNull();
    expect(card.shadowRoot?.querySelector('.mark-leader')).toBeNull();
  });

  it('moves a light off the Up or Down word the plan draws on a stair', async () => {
    const word = { key: 'stair:s1', ...DOOR, width: 44, height: 18 };

    placeOnPlan({ 'light:living-space-light': DOOR });
    vi.spyOn(EstanzaPlanView.prototype, 'wordBoxes').mockReturnValue([word]);

    const card = await mountCard();

    await showPlan(card);

    const light = spotOf(mark(card, 'light:living-space-light'));

    expect(Number.isNaN(light.x)).toBe(false);
    expect(covered({ ...light, width: 1, height: 1 }, [word])).toBe(false);
  });

  it('sets a room temperature off a shut door dot so the dot stays drawn', async () => {
    drawPlansAt({ width: 800, height: 600 });

    const card = await mountCard();

    await showPlan(card);

    const centre = card.shadowRoot
      ?.querySelector('estanza-plan-view')
      ?.tagBounds('living-space');

    if (!centre) throw new Error('no living space tag');

    const at = {
      x: (centre.left + centre.right) / 2,
      y: (centre.top + centre.bottom) / 2,
    };

    placeOnPlan({ 'door:d1': at });
    card.requestUpdate();
    await settle(card);
    await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
    await settle(card);

    const pill = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="living-space"]',
    );
    const dot = mark(card, 'door:d1');

    expect(dot).not.toBeNull();
    expect(pill).not.toBeNull();
    expect(
      covered({ ...spotOf(pill ?? null), width: 40, height: 22 }, [
        { ...spotOf(dot), width: 14, height: 14 },
      ]),
    ).toBe(false);
  });
});

describe('the rows of a room sheet', () => {
  function blocks(selector: string, css: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return [
      ...css.matchAll(new RegExp(`(?:^|[\\s}])${escaped} \\{([^}]*)\\}`, 'g')),
    ].map((match) => match[1]);
  }

  function heights(selector: string, css: string): string[] {
    return blocks(selector, css).flatMap((block) =>
      [...block.matchAll(/min-height: ([^;]+);/g)].map((match) => match[1]),
    );
  }

  const css = controlStyles.cssText;
  const [fine, coarse] = css.split('@media (pointer: coarse)');

  function fixed(selector: string, css: string): string[] {
    return blocks(selector, css).flatMap((block) =>
      [...block.matchAll(/(?:^|[\s;])height: ([^;]+);/g)].map(
        (match) => match[1],
      ),
    );
  }

  it('gives the temperature line the same height as a door or window line', () => {
    expect(heights('.readout', fine)).toEqual(['36px']);
    expect(fixed('.readout.row', fine)).toEqual(['36px']);
  });

  it('keeps every line 40px tall under a finger', () => {
    expect(heights('.sheet .readout', coarse)).toEqual(['40px', '40px']);
    expect(fixed('.sheet :is(.device, .readout.row)', coarse)).toEqual([
      '40px',
      '40px',
    ]);
  });
});

describe('the dot of a shut opening', () => {
  function luminance(hex: string): number {
    const value = Number.parseInt(hex.slice(1), 16);
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

  const behind = [
    ...themes.map((theme) => planPalette(theme).page),
    ROOM_FILL,
    NIGHT_SHADE,
    '#3b3566',
    '#2c4788',
    '#9aa7b4',
    '#d8d2c8',
    '#1f2d1f',
    '#cfe0ee',
  ];

  it.each(themes)(
    'stands out at 3:1 from any plan or scene behind it in the %s theme',
    (theme) => {
      const { core, ring } = dotLook(theme);

      expect(contrast(core, ring)).toBeGreaterThanOrEqual(3);

      for (const colour of behind) {
        expect(
          Math.max(contrast(core, colour), contrast(ring, colour)),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('is drawn in those two colours', () => {
    expect(controlStyles.cssText).toMatch(
      /\.mark\.dot \.disc \{[^}]*background: var\(--ez-dot\)[^}]*border: 2px solid var\(--ez-dot-ring\)/,
    );
  });
});
