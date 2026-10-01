import { motionLive } from '@estanza/scene/env.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import { readViewChoice, VIEW_SWITCH_MS, viewKey } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { IDLE_RETURN_MS, REFRAME_WAIT_MS } from '../src/tablet.js';
import { drawPlansAt } from './drawn-plan.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
  mockLight,
  mockSensor,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const IDLE_MS = 45_000;

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

function config(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: cardType,
    home_document: threeStoreyHome(),
    bindings,
    ...extra,
  };
}

async function mountCard(
  extra: Record<string, unknown> = {},
  layout: string | undefined = undefined,
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.living', { on: true }),
      mockLight('light.cellar', { on: false }),
      mockLight('light.hall', { on: false }),
      mockBinarySensor('binary_sensor.cellar_leak', 'moisture', false),
      mockEntityState('alarm_control_panel.house', 'disarmed'),
    ],
  });
  card.hass = hass;
  card.layout = layout;
  card.setConfig(config(extra));
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await sceneOf(card)?.updateComplete;
    await planOf(card)?.updateComplete;
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(card);
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

function planOf(card: EstanzaCard): EstanzaPlanView | null {
  return card.shadowRoot?.querySelector('estanza-plan-view') ?? null;
}

type SceneStub = { frames: number; flat: boolean };

function drawableScene(flat = false): SceneStub {
  const state = { frames: 0, flat };

  vi.spyOn(EstanzaSceneView.prototype, 'drawable', 'get').mockReturnValue(true);
  vi.spyOn(EstanzaSceneView.prototype, 'frames', 'get').mockImplementation(
    () => state.frames,
  );
  vi.spyOn(
    EstanzaSceneView.prototype,
    'flatAndStill',
    'get',
  ).mockImplementation(() => state.flat);
  vi.spyOn(EstanzaSceneView.prototype, 'redraw').mockImplementation(() => {});

  return state;
}

function planAway(card: EstanzaCard): boolean {
  return planOf(card)?.classList.contains('away') ?? true;
}

function switchButton(card: EstanzaCard, view: string): HTMLButtonElement {
  const button = card.shadowRoot?.querySelector<HTMLButtonElement>(
    `.views button[data-view="${view}"]`,
  );

  if (!button) throw new Error(`no switch button for ${view}`);

  return button;
}

function shown(card: EstanzaCard): string | null {
  return (
    card.shadowRoot
      ?.querySelector('.views button[aria-pressed="true"]')
      ?.getAttribute('data-view') ?? null
  );
}

async function pick(card: EstanzaCard, view: string): Promise<void> {
  switchButton(card, view).click();
  await settle(card);

  if (view === '2d') await wait(card, VIEW_SWITCH_MS);
}

async function chooseFloor(card: EstanzaCard, floor: string): Promise<void> {
  card.shadowRoot
    ?.querySelector<HTMLButtonElement>(`.floors button[data-floor="${floor}"]`)
    ?.click();
  await settle(card);
}

function chosenFloor(card: EstanzaCard): string | null {
  return (
    card.shadowRoot
      ?.querySelector('.floors button[aria-pressed="true"]')
      ?.getAttribute('data-floor') ?? null
  );
}

async function select(
  card: EstanzaCard,
  scopeType: string,
  scopeId: string,
  gesture: 'tap' | 'press',
): Promise<void> {
  planOf(card)?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture, x: 200, y: 150 },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

function sheetTitle(card: EstanzaCard): string | null {
  return (
    card.shadowRoot
      ?.querySelector('.sheet')
      ?.textContent?.replace(/\s+/g, ' ') ?? null
  );
}

async function setState(
  card: EstanzaCard,
  entityId: string,
  state: string,
): Promise<void> {
  hass = {
    ...hass,
    states: {
      ...hass.states,
      [entityId]: { ...hass.states[entityId], state },
    },
  };
  card.hass = hass;
  await settle(card);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  motionLive.reduced = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('an open sheet and the floor and view controls', () => {
  async function openHall(card: EstanzaCard): Promise<void> {
    sceneOf(card)?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: 'hall',
          gesture: 'tap',
          x: 200,
          y: 150,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);
  }

  it('closes on a switch to another floor', async () => {
    const card = await mountCard();

    await openHall(card);

    expect(sheetTitle(card)).toContain('Hall');

    await chooseFloor(card, 'ufloor');

    expect(sheetTitle(card)).toBeNull();
  });

  it('stays open on a switch to the plan and back to 3D', async () => {
    const card = await mountCard();

    await openHall(card);
    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);

    expect(sheetTitle(card)).toContain('Hall');

    await pick(card, '3d');
    await wait(card, VIEW_SWITCH_MS);

    expect(sheetTitle(card)).toContain('Hall');
  });
});

describe('the view switch', () => {
  it('offers a 3D view and a floor plan, as the words 3D and 2D with names', async () => {
    const card = await mountCard();

    for (const [view, name, glyph] of [
      ['3d', '3D view', '3D'],
      ['2d', '2D floor plan', '2D'],
    ]) {
      const button = switchButton(card, view);

      expect(button.getAttribute('aria-label')).toBe(name);
      expect(button.title).toBe(name);
      expect(button.textContent?.trim()).toBe(glyph);
      expect(button.querySelector('svg')).toBeNull();
    }
  });

  it('opens on the 3D view with the plan put away', async () => {
    const card = await mountCard();

    expect(shown(card)).toBe('3d');
    expect(planAway(card)).toBe(true);
  });

  it('shows the plan when the reader picks it, and marks the choice', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(shown(card)).toBe('2d');
    expect(switchButton(card, '3d').getAttribute('aria-pressed')).toBe('false');
    expect(planOf(card)).not.toBeNull();
  });

  it('tilts the camera straight down over the switch time', async () => {
    const tilt = vi.spyOn(EstanzaSceneView.prototype, 'tiltDown');
    const card = await mountCard();

    await pick(card, '2d');

    expect(tilt).toHaveBeenCalledWith(expect.anything(), VIEW_SWITCH_MS);
  });

  it('lays the plan out unseen until the camera has landed over it, then fades it in', async () => {
    const scene = drawableScene();
    const card = await mountCard();

    switchButton(card, '2d').click();
    await settle(card);

    expect(planOf(card)?.classList.contains('arriving')).toBe(true);

    await wait(card, 2 * VIEW_SWITCH_MS);

    expect(planOf(card)?.classList.contains('arriving')).toBe(true);

    scene.flat = true;
    await wait(card, 32);

    expect(planOf(card)?.classList.contains('arriving')).toBe(false);
  });

  it('shows the plan at once when the scene cannot draw', async () => {
    const card = await mountCard();

    switchButton(card, '2d').click();
    await settle(card);

    expect(planOf(card)?.classList.contains('arriving')).toBe(false);
    expect(sceneOf(card)?.paused).toBe(true);
  });

  it('stops the 3D scene drawing once the plan has faded in', async () => {
    drawableScene(true);

    const card = await mountCard();

    await pick(card, '2d');

    expect(sceneOf(card)?.paused).toBe(false);

    await wait(card, VIEW_SWITCH_MS);

    expect(sceneOf(card)?.paused).toBe(true);
  });

  it('holds the plan until the scene has drawn, then fades it out and tilts up', async () => {
    const scene = drawableScene(true);
    const tiltUp = vi.spyOn(EstanzaSceneView.prototype, 'tiltUp');
    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    await pick(card, '3d');

    expect(sceneOf(card)?.paused).toBe(false);
    expect(planOf(card)?.classList).toContain('holding');

    await wait(card, 2 * VIEW_SWITCH_MS);

    expect(planOf(card)?.classList).toContain('holding');
    expect(tiltUp).not.toHaveBeenCalled();

    scene.frames += 1;
    await wait(card, 32);

    expect(planOf(card)?.classList).toContain('leaving');
    expect(tiltUp).not.toHaveBeenCalled();

    await wait(card, VIEW_SWITCH_MS);

    expect(tiltUp).toHaveBeenCalledWith(expect.anything(), VIEW_SWITCH_MS);
    expect(planAway(card)).toBe(true);
  });

  it('lets the plan go when the scene never draws', async () => {
    drawableScene(true);

    const tiltUp = vi.spyOn(EstanzaSceneView.prototype, 'tiltUp');
    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    await pick(card, '3d');
    await wait(card, 5000);

    expect(tiltUp).toHaveBeenCalledTimes(1);
    expect(planAway(card)).toBe(true);
  });

  it('keeps the same plan, with the tags it laid out, across a trip to 3D and back', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    const plan = planOf(card);

    await pick(card, '3d');
    await wait(card, VIEW_SWITCH_MS);
    await chooseFloor(card, 'ufloor');

    expect(planOf(card)).toBe(plan);
    expect(planOf(card)?.active).not.toBe('ufloor');

    await pick(card, '2d');

    expect(planOf(card)).toBe(plan);
    expect(planOf(card)?.active).toBe('ufloor');
  });

  it('tilts the house down onto the place the plan drew it', async () => {
    const drawn = { left: 40, top: 60, right: 300, bottom: 220 };

    vi.spyOn(EstanzaPlanView.prototype, 'houseFrame').mockReturnValue(drawn);

    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    planOf(card)?.dispatchEvent(new Event('view-change'));
    await card.updateComplete;

    expect(sceneOf(card)?.planFrame).toEqual(drawn);
  });

  it('hands the house each storey the plan drew side by side, so the tilt lays them out the same way', async () => {
    const cells = [
      { floor: 'f1', centre: { x: 300, y: 400 }, scale: 0.5 },
      { floor: 'f2', centre: { x: 900, y: 400 }, scale: 0.5 },
    ];

    vi.spyOn(EstanzaPlanView.prototype, 'houseFrame').mockReturnValue(null);
    vi.spyOn(EstanzaPlanView.prototype, 'cellFrames').mockReturnValue(cells);

    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    planOf(card)?.dispatchEvent(new Event('view-change'));
    await card.updateComplete;

    expect(sceneOf(card)?.planFrame).toBeNull();
    expect(sceneOf(card)?.planCells).toEqual(cells);
  });

  it('hands the camera to a drag that starts while the plan fades out, but not while it holds', async () => {
    const scene = drawableScene(true);
    const tiltUp = vi.spyOn(EstanzaSceneView.prototype, 'tiltUp');
    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    await pick(card, '3d');

    sceneOf(card)?.dispatchEvent(new Event('camera-input'));
    await card.updateComplete;

    expect(tiltUp).not.toHaveBeenCalled();

    scene.frames += 1;
    await wait(card, 32);
    sceneOf(card)?.dispatchEvent(new Event('camera-input'));
    await settle(card);

    expect(tiltUp).toHaveBeenCalledTimes(1);
    expect(tiltUp).toHaveBeenCalledWith(expect.anything(), 0);
    expect(planAway(card)).toBe(true);

    await wait(card, VIEW_SWITCH_MS);

    expect(tiltUp).toHaveBeenCalledTimes(1);
  });

  it('turns straight back up, with no plan shown, when 3D is picked before the plan came in', async () => {
    drawableScene();

    const tiltUp = vi.spyOn(EstanzaSceneView.prototype, 'tiltUp');
    const card = await mountCard();

    switchButton(card, '2d').click();
    await wait(card, 180);
    switchButton(card, '3d').click();
    await settle(card);

    expect(planAway(card)).toBe(true);
    expect(tiltUp).toHaveBeenCalledTimes(1);
    expect(tiltUp).toHaveBeenCalledWith(expect.anything(), VIEW_SWITCH_MS);

    await wait(card, 2 * VIEW_SWITCH_MS);

    expect(planAway(card)).toBe(true);
    expect(tiltUp).toHaveBeenCalledTimes(1);
  });

  it('keeps the plan when it is picked again while the plan fades out', async () => {
    const tiltUp = vi.spyOn(EstanzaSceneView.prototype, 'tiltUp');
    const card = await mountCard();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);
    switchButton(card, '3d').click();
    await wait(card, 180);
    switchButton(card, '2d').click();
    await settle(card);

    expect(planOf(card)).not.toBeNull();
    expect(planOf(card)?.classList).not.toContain('leaving');

    await wait(card, 2 * VIEW_SWITCH_MS);

    expect(tiltUp).not.toHaveBeenCalled();
    expect(sceneOf(card)?.paused).toBe(true);
  });

  it('ends on the last view picked after rapid toggling', async () => {
    const card = await mountCard();

    for (const view of ['2d', '3d', '2d', '3d', '2d', '3d']) {
      switchButton(card, view).click();
      await wait(card, 180);
    }

    await wait(card, 3 * VIEW_SWITCH_MS);

    expect(shown(card)).toBe('3d');
    expect(planAway(card)).toBe(true);
    expect(sceneOf(card)?.paused).toBe(false);
  });

  it('swaps at once when the reader asks for less motion', async () => {
    const tilt = vi.spyOn(EstanzaSceneView.prototype, 'tiltDown');
    const card = await mountCard();

    motionLive.reduced = true;
    await pick(card, '2d');

    expect(tilt).toHaveBeenCalledWith(expect.anything(), 0);
    expect(sceneOf(card)?.paused).toBe(true);

    await pick(card, '3d');

    expect(planAway(card)).toBe(true);
  });
});

describe('marks and temperatures while the view switches', () => {
  const planSpot = { x: 100, y: 120 };
  const sceneSpot = { x: 600, y: 420 };
  const lamp = '.mark[data-key="light:living-space-light"]';
  const pill = '.temp[data-room="hall"]';

  async function mountSpotted(): Promise<EstanzaCard> {
    for (const [surface, spot] of [
      [EstanzaPlanView, planSpot],
      [EstanzaSceneView, sceneSpot],
    ] as const) {
      vi.spyOn(surface.prototype, 'anchorOf').mockImplementation((scope) =>
        scope.id === 'living-space-light' ? spot : null,
      );
    }

    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) =>
        new Map(
          slugs
            .filter((slug) => slug === 'hall')
            .map((slug) => [slug, { x: sceneSpot.x + 200, y: sceneSpot.y }]),
        ),
    );

    const card = await mountCard({
      bindings: [
        ...bindings,
        {
          scope: { type: 'room', id: 'hall' },
          temperature_entity_id: 'sensor.hall_temperature',
        },
      ],
    });

    hass = {
      ...hass,
      states: {
        ...hass.states,
        'sensor.hall_temperature': mockSensor(
          'sensor.hall_temperature',
          'temperature',
          20.5,
          '°C',
        ),
      },
    };
    card.hass = hass;
    await settle(card);

    return card;
  }

  function spotOf(card: EstanzaCard, selector: string): string | null {
    const shown = card.shadowRoot?.querySelector<HTMLElement>(selector);

    if (!shown) return null;

    return `${Math.round(parseFloat(shown.style.left))},${Math.round(parseFloat(shown.style.top))}`;
  }

  function stageOf(card: EstanzaCard): HTMLElement | null {
    return card.shadowRoot?.querySelector<HTMLElement>('.stage') ?? null;
  }

  function onPlan(card: EstanzaCard): boolean | undefined {
    return card.shadowRoot
      ?.querySelector('.stage')
      ?.classList.contains('on-plan');
  }

  it('keeps marks and temperatures where the plan drew them while the plan fades out', async () => {
    drawPlansAt({ width: 800, height: 600 });

    const card = await mountSpotted();

    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);

    const pillAt = spotOf(card, pill);

    expect(spotOf(card, lamp)).toBe(`${planSpot.x},${planSpot.y}`);
    expect(pillAt).not.toBeNull();

    await pick(card, '3d');

    expect(planOf(card)?.classList).toContain('leaving');
    expect(stageOf(card)?.classList).toContain('plan-leaving');
    expect(spotOf(card, lamp)).toBe(`${planSpot.x},${planSpot.y}`);
    expect(spotOf(card, pill)).toBe(pillAt);

    await wait(card, VIEW_SWITCH_MS);

    expect(planAway(card)).toBe(true);
    expect(spotOf(card, lamp)).toBe(`${sceneSpot.x},${sceneSpot.y}`);
    expect(spotOf(card, pill)).not.toBeNull();
  });

  it('opens the sheet of a light on a right-click on its mark on the plan, and keeps the browser menu shut', async () => {
    drawPlansAt({ width: 800, height: 600 });

    const card = await mountSpotted();

    await pick(card, '2d');

    const mark = card.shadowRoot?.querySelector(lamp);
    const right = (type: string): MouseEvent => {
      const event = Object.assign(
        new MouseEvent(type, {
          clientX: planSpot.x,
          clientY: planSpot.y,
          button: 2,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
        { pointerType: 'mouse', isPrimary: true },
      );

      mark?.dispatchEvent(event);

      return event;
    };

    right('pointerdown');

    const menu = right('contextmenu');

    right('pointerup');
    await wait(card, 1000);

    expect(menu.defaultPrevented).toBe(true);
    expect(hass.serviceCalls).toEqual([]);
    expect(sheetTitle(card)).not.toBeNull();
  });

  it('lays marks out unseen at their plan spots while the camera turns to the plan', async () => {
    const scene = drawableScene();
    const card = await mountSpotted();

    expect(spotOf(card, lamp)).toBe(`${sceneSpot.x},${sceneSpot.y}`);

    switchButton(card, '2d').click();
    await settle(card);
    planOf(card)?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(stageOf(card)?.classList).toContain('plan-arriving');
    expect(spotOf(card, lamp)).toBe(`${planSpot.x},${planSpot.y}`);

    scene.flat = true;
    await wait(card, VIEW_SWITCH_MS);
    planOf(card)?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(planOf(card)).not.toBeNull();
    expect(spotOf(card, lamp)).toBe(`${planSpot.x},${planSpot.y}`);
    expect(onPlan(card)).toBe(true);
  });

  it('keeps the marks fading in with the plan when the scene rests before the fade ends', async () => {
    const card = await mountSpotted();

    switchButton(card, '2d').click();
    await wait(card, VIEW_SWITCH_MS);
    planOf(card)?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(onPlan(card)).toBe(true);

    await wait(card, VIEW_SWITCH_MS);

    expect(onPlan(card)).toBe(true);

    switchButton(card, '3d').click();
    await settle(card);

    expect(onPlan(card)).toBe(false);
  });

  it('fades the marks and temperatures in with the plan', () => {
    const rules = EstanzaCard.styles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(
      /\.stage\.on-plan :is\(\.marks, \.temps, \.pins\) \{ animation: ez-appear 0\.5s ease-in-out 1; \}/,
    );
  });

  it('fades the marks and temperatures out with the plan, and hides them until it arrives', () => {
    const rules = EstanzaCard.styles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(
      /\.stage\.plan-leaving :is\(\.marks, \.temps\) \{ animation: ez-fade 0\.5s ease-in-out forwards; \}/,
    );
    expect(rules).toMatch(
      /\.stage\.plan-arriving :is\(\.marks, \.temps\) \{ opacity: 0; \}/,
    );
  });
});

describe('the remembered view', () => {
  it('keeps the reader choice for this card', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(readViewChoice(viewKey(config()))).toBe('2d');
  });

  it('opens on the view the reader last chose', async () => {
    const first = await mountCard();

    await pick(first, '2d');
    first.remove();

    const again = await mountCard();

    expect(shown(again)).toBe('2d');
    expect(sceneOf(again)?.paused).toBe(true);
  });

  it('keeps a choice apart from another card', async () => {
    const first = await mountCard();

    await pick(first, '2d');

    const other = await mountCard({ title: 'Upstairs' });

    expect(shown(other)).toBe('3d');
  });

  it('opens on the configured default view', async () => {
    const card = await mountCard({ default_view: '2d' });

    expect(shown(card)).toBe('2d');
    expect(planOf(card)).not.toBeNull();
  });

  it('lets a stored choice win over the configured default', async () => {
    const first = await mountCard({ default_view: '2d' });

    await pick(first, '3d');
    first.remove();

    const again = await mountCard({ default_view: '2d' });

    expect(shown(again)).toBe('3d');
  });
});

describe('the floor stack in the plan', () => {
  it('draws every storey for all floors, and says so', async () => {
    const card = await mountCard();

    await chooseFloor(card, 'all');
    await pick(card, '2d');

    expect(planOf(card)?.active).toBeNull();
    expect(chosenFloor(card)).toBe('all');
  });

  it('draws the storey the reader picks', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    await chooseFloor(card, 'bfloor');

    expect(planOf(card)?.active).toBe('bfloor');
    expect(chosenFloor(card)).toBe('bfloor');
  });

  it('goes back to all floors in 3D', async () => {
    const card = await mountCard();

    await chooseFloor(card, 'all');
    await pick(card, '2d');
    await pick(card, '3d');

    expect(chosenFloor(card)).toBe('all');
    expect(sceneOf(card)?.floor).toBeNull();
  });

  it('switches storey for a critical alert on another floor and stays on the plan', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    await setState(card, 'binary_sensor.cellar_leak', 'on');
    await wait(card, REFRAME_WAIT_MS);

    expect(shown(card)).toBe('2d');
    expect(planOf(card)?.active).toBe('bfloor');
    expect(card.roomMarks.cellar?.danger).toBe('room');
  });

  it('keeps the plan clear of the alert banner while it shows', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(planOf(card)?.reserve.top).toBe(0);

    await setState(card, 'binary_sensor.cellar_leak', 'on');

    expect(planOf(card)?.reserve.top).toBe(68);

    await setState(card, 'binary_sensor.cellar_leak', 'off');

    expect(planOf(card)?.reserve.top).toBe(0);
  });

  it('keeps the plan clear of the armed shield in the corner', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(planOf(card)?.corner).toBe(0);

    await setState(card, 'alarm_control_panel.house', 'armed_away');

    expect(planOf(card)?.corner).toBe(68);
  });
});

describe('all floors a storey at a time on a narrow card', () => {
  async function paged(card: EstanzaCard, shownPage: string): Promise<void> {
    const plan = planOf(card);

    if (!plan) throw new Error('no plan');

    plan.pages = ['ufloor', 'f1', 'bfloor'];
    plan.shownPage = shownPage;
    plan.dispatchEvent(new Event('view-change'));
    await settle(card);
  }

  function tabs(card: EstanzaCard): HTMLButtonElement[] {
    return [
      ...(card.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '.pages button',
      ) ?? []),
    ];
  }

  async function allFloorsPlan(): Promise<EstanzaCard> {
    const card = await mountCard();

    await chooseFloor(card, 'all');
    await pick(card, '2d');

    return card;
  }

  async function folded(card: EstanzaCard): Promise<void> {
    Object.defineProperty(card, 'clientWidth', {
      configurable: true,
      value: 390,
    });
    card.requestUpdate();
    await settle(card);
  }

  function stackButton(card: EstanzaCard, floor: string) {
    return card.shadowRoot?.querySelector<HTMLButtonElement>(
      `.floors button[data-floor="${floor}"]`,
    );
  }

  it('pages the 3D house a storey at a time too, starting on the ground floor', async () => {
    const card = await mountCard();

    await chooseFloor(card, 'all');
    await folded(card);

    const scene = () =>
      card.shadowRoot?.querySelector<HTMLElement & { floor: unknown }>(
        'estanza-scene-view',
      );

    expect(tabs(card).map((tab) => tab.dataset.page)).toEqual([
      'ufloor',
      'f1',
      'bfloor',
    ]);
    expect(scene()?.floor).toBe('f1');

    tabs(card)[0]?.click();
    await settle(card);

    expect(scene()?.floor).toBe('ufloor');
  });

  it('offers every storey as a tab beside the folded floor stack, with the storey shown pressed', async () => {
    const card = await allFloorsPlan();

    await folded(card);
    await paged(card, 'f1');

    expect(stackButton(card, 'chip')).toBeTruthy();

    expect(tabs(card).map((tab) => tab.dataset.page)).toEqual([
      'ufloor',
      'f1',
      'bfloor',
    ]);
    expect(
      tabs(card).map((tab) => tab.getAttribute('aria-pressed') === 'true'),
    ).toEqual([false, true, false]);
    expect(tabs(card).every((tab) => tab.getAttribute('aria-label'))).toBe(
      true,
    );
  });

  it('turns to the storey tapped in one tap', async () => {
    const card = await allFloorsPlan();

    await folded(card);
    await paged(card, 'f1');
    tabs(card)[2].click();
    await settle(card);

    expect(planOf(card)?.page).toBe('bfloor');
    expect(planOf(card)?.active).toBeNull();
  });

  it('marks the storey on show in the floor stack while it lists every storey, with no second row', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'f1');

    expect(tabs(card)).toEqual([]);
    expect(stackButton(card, 'all')?.getAttribute('aria-pressed')).toBe('true');
    expect(
      ['ufloor', 'f1', 'bfloor'].map((floor) =>
        stackButton(card, floor)?.getAttribute('aria-current'),
      ),
    ).toEqual([null, 'page', null]);
  });

  it('leaves all floors for the storey picked in the floor stack while it pages', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'f1');
    stackButton(card, 'ufloor')?.click();
    await settle(card);

    expect(chosenFloor(card)).toBe('ufloor');
    expect(planOf(card)?.active).toBe('ufloor');
  });

  it('leaves all floors for the storey picked in the opened chooser on a narrow plan', async () => {
    const card = await allFloorsPlan();

    await folded(card);
    await paged(card, 'f1');
    stackButton(card, 'chip')?.click();
    await settle(card);

    const name = stackButton(card, 'bfloor')?.getAttribute('aria-label');

    stackButton(card, 'bfloor')?.click();
    await settle(card);

    expect(planOf(card)?.active).toBe('bfloor');
    expect(stackButton(card, 'chip')?.getAttribute('aria-label')).toBe(
      `${name}, choose a floor`,
    );
  });

  it('leaves all floors for the storey picked in the opened chooser on a narrow 3D card', async () => {
    const card = await mountCard();

    await chooseFloor(card, 'all');
    await folded(card);
    stackButton(card, 'chip')?.click();
    await settle(card);

    const name = stackButton(card, 'bfloor')?.getAttribute('aria-label');

    stackButton(card, 'bfloor')?.click();
    await settle(card);

    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(tabs(card)).toEqual([]);
    expect(stackButton(card, 'chip')?.getAttribute('aria-label')).toBe(
      `${name}, choose a floor`,
    );
  });

  it('opens all floors on the storey that was showing, not the page turned last time', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'f1');
    planOf(card)?.dispatchEvent(
      new CustomEvent('page-change', {
        detail: 'bfloor',
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);
    await chooseFloor(card, 'all');
    await chooseFloor(card, 'ufloor');

    expect(chosenFloor(card)).toBe('ufloor');

    await chooseFloor(card, 'all');

    expect(planOf(card)?.page).toBe('ufloor');
  });

  it('keeps the scene under the plan on the storey the page shows', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'bfloor');

    expect(sceneOf(card)?.floor).toBe('bfloor');
  });

  it('leaves all floors on the storey its page shows', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'bfloor');
    await chooseFloor(card, 'all');

    expect(planOf(card)?.active).toBe('bfloor');
  });

  it('marks no storey in the stack as the page while the storeys fit side by side', async () => {
    const card = await allFloorsPlan();

    planOf(card)?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(
      card.shadowRoot?.querySelectorAll('.floors [aria-current]'),
    ).toHaveLength(0);
  });

  it('turns the page the plan was swiped to, and closes an open sheet as a floor change does', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'f1');
    await select(card, 'room', 'hall', 'tap');

    expect(sheetTitle(card)).toContain('Hall');

    planOf(card)?.dispatchEvent(
      new CustomEvent('page-change', {
        detail: 'bfloor',
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);

    expect(planOf(card)?.page).toBe('bfloor');
    expect(sheetTitle(card)).toBeNull();
  });

  it('offers no tabs while the storeys fit side by side', async () => {
    const card = await allFloorsPlan();

    planOf(card)?.dispatchEvent(new Event('view-change'));
    await settle(card);

    expect(tabs(card)).toEqual([]);
  });

  it('keeps room names and the plan clear of the tabs', async () => {
    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('pages')) {
          return new DOMRect(12, 206, 126, 44);
        }

        return real.call(this);
      },
    );

    const card = await allFloorsPlan();

    await folded(card);
    await paged(card, 'f1');
    await setState(card, 'light.hall', 'on');

    expect(planOf(card)?.covers).toEqual(
      expect.arrayContaining([{ x: 75, y: 228, width: 126, height: 44 }]),
    );
    expect(planOf(card)?.clear).toEqual(
      expect.arrayContaining([{ left: 12, top: 206, right: 138, bottom: 250 }]),
    );
  });

  it('offers no tabs in 3D', async () => {
    const card = await allFloorsPlan();

    await paged(card, 'f1');
    await pick(card, '3d');

    expect(tabs(card)).toEqual([]);
  });
});

describe('touching the plan', () => {
  it('toggles a bulb on a tap', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    await select(card, 'light', 'living-space-light', 'tap');

    expect(hass.serviceCalls).toEqual([
      expect.objectContaining({
        domain: 'light',
        data: expect.objectContaining({ entity_id: 'light.living' }),
      }),
    ]);
  });

  it('opens the sheet for a room on a tap', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    await select(card, 'room', 'hall', 'tap');

    expect(sheetTitle(card)).toContain('Hall');
  });

  it('opens the sheet for a bulb on a long press', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    await select(card, 'light', 'living-space-light', 'press');

    expect(sheetTitle(card)).not.toBeNull();
    expect(hass.serviceCalls).toEqual([]);
  });

  it('hands the plan every bound device on the storey it draws', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(planOf(card)?.targets).toEqual([
      { type: 'light', id: 'living-space-light' },
      { type: 'room', id: 'hall' },
    ]);

    await chooseFloor(card, 'bfloor');

    expect(planOf(card)?.targets).toEqual(
      expect.arrayContaining([
        { type: 'light', id: 'cellar-light' },
        { type: 'room', id: 'cellar' },
      ]),
    );
  });

  it('gives the plan the larger targets on a wall tablet', async () => {
    const card = await mountCard({}, 'panel');

    await pick(card, '2d');

    expect(planOf(card)?.targetRadius).toBe(28);
    expect(switchButton(card, '2d').isConnected).toBe(true);
  });
});

describe('the plan paper and the plan at night', () => {
  function sunDown(): void {
    hass = {
      ...hass,
      states: {
        ...hass.states,
        'sun.sun': {
          entity_id: 'sun.sun',
          state: 'below_horizon',
          attributes: {},
          last_changed: '',
          last_updated: '',
        },
      },
    };
  }

  it('keeps light paper in a light theme once the sun is down', async () => {
    const card = await mountCard({ night: 'auto' });

    sunDown();
    card.hass = hass;
    await pick(card, '2d');

    expect(planOf(card)?.scheme).toBe('light');
    expect(planOf(card)?.night).toBe(false);
  });

  it('draws on light paper by day in a light theme', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(planOf(card)?.scheme).toBe('light');
    expect(planOf(card)?.night).toBe(false);
  });

  it('draws on dark paper with the night look by day in a dark theme', async () => {
    const card = await mountCard();

    card.hass = { ...hass, themes: { darkMode: true } };
    await pick(card, '2d');

    expect(planOf(card)?.scheme).toBe('dark');
    expect(planOf(card)?.night).toBe(true);
  });

  it('turns the paper over when the theme changes, not when the sun sets', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    card.hass = { ...hass, themes: { darkMode: true } };
    await settle(card);

    expect(planOf(card)?.scheme).toBe('dark');
    expect(card.hasAttribute('dark')).toBe(true);

    sunDown();
    card.hass = { ...hass, themes: { darkMode: false } };
    await settle(card);

    expect(planOf(card)?.scheme).toBe('light');
    expect(card.hasAttribute('dark')).toBe(false);
  });

  async function tempsCard(
    size: { width: number; height: number },
    readings: { hall: number; bathroom: number },
  ): Promise<EstanzaCard> {
    drawPlansAt(size);

    const card = await mountCard({
      bindings: [
        {
          scope: { type: 'room', id: 'hall' },
          temperature_entity_id: 'sensor.hall_temperature',
        },
        {
          scope: { type: 'room', id: 'bathroom' },
          temperature_entity_id: 'sensor.bath_temperature',
        },
      ],
    });

    hass = {
      ...hass,
      states: {
        ...hass.states,
        'sensor.hall_temperature': mockSensor(
          'sensor.hall_temperature',
          'temperature',
          readings.hall,
          '°C',
        ),
        'sensor.bath_temperature': mockSensor(
          'sensor.bath_temperature',
          'temperature',
          readings.bathroom,
          '°C',
        ),
      },
    };
    card.hass = hass;
    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);

    return card;
  }

  function pillTexts(card: EstanzaCard): Record<string, string> {
    return Object.fromEntries(
      [...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? [])].map(
        (label) => [label.dataset.room ?? '', label.textContent?.trim() ?? ''],
      ),
    );
  }

  it('keeps one decimal on every temperature under its name', async () => {
    const card = await tempsCard(
      { width: 800, height: 600 },
      { hall: 20, bathroom: 21.3 },
    );

    expect(pillTexts(card)).toEqual({ hall: '20.0°', bathroom: '21.3°' });
  });

  it('keeps one decimal in the one pill of a plan too small for a name above its pill', async () => {
    const card = await tempsCard(
      { width: 240, height: 180 },
      { hall: 20, bathroom: 21.3 },
    );
    const texts = pillTexts(card);

    expect(texts.hall).toMatch(/ 20\.0°$/);
    expect(texts.bathroom).toMatch(/ 21\.3°$/);
  });

  it('dresses the temperatures like the theme, whatever the sun', async () => {
    const card = await tempsCard(
      { width: 800, height: 600 },
      { hall: 20, bathroom: 21 },
    );
    const temps = (): Element | null =>
      card.shadowRoot?.querySelector('.temps') ?? null;

    card.hass = {
      ...hass,
      states: {
        ...hass.states,
        'sun.sun': mockEntityState('sun.sun', 'below_horizon'),
      },
    };
    await settle(card);

    expect(temps()?.classList.contains('dark')).toBe(false);

    card.hass = { ...hass, themes: { darkMode: true } };
    await settle(card);

    expect(temps()?.classList.contains('dark')).toBe(true);

    card.hass = {
      ...hass,
      states: {
        ...hass.states,
        'sun.sun': mockEntityState('sun.sun', 'above_horizon'),
      },
      themes: { darkMode: true },
    };
    await settle(card);

    expect(temps()?.classList.contains('dark')).toBe(true);
  });

  it('draws each temperature under its own name, as one tag', async () => {
    const card = await tempsCard(
      { width: 800, height: 600 },
      { hall: 20, bathroom: 21 },
    );
    const plan = planOf(card);
    const tags = plan?.tagLabels() ?? [];
    const names = new Map(
      (plan?.wordBoxes() ?? [])
        .filter((box) => box.key.startsWith('name:'))
        .map((box) => [box.key.slice(5), box]),
    );

    expect(tags.map((tag) => tag.key).sort()).toEqual(['bathroom', 'hall']);

    for (const tag of tags) {
      const name = names.get(tag.key);

      expect(tag.compact).toBe(false);
      expect(name && Math.abs(name.x - tag.x)).toBeLessThan(1);
      expect(name && tag.y - name.y).toBeGreaterThan(0);
    }
  });
});

describe('temperatures under an open sheet', () => {
  async function mountWarm(): Promise<EstanzaCard> {
    drawPlansAt({ width: 800, height: 600 });

    const card = await mountCard({
      bindings: [
        {
          scope: { type: 'room', id: 'hall' },
          entity_id: 'light.hall',
          temperature_entity_id: 'sensor.hall_temperature',
        },
        {
          scope: { type: 'room', id: 'bathroom' },
          temperature_entity_id: 'sensor.bath_temperature',
        },
      ],
    });

    hass = {
      ...hass,
      states: {
        ...hass.states,
        'sensor.hall_temperature': mockSensor(
          'sensor.hall_temperature',
          'temperature',
          20,
          '°C',
        ),
        'sensor.bath_temperature': mockSensor(
          'sensor.bath_temperature',
          'temperature',
          21,
          '°C',
        ),
      },
    };
    card.hass = hass;
    await pick(card, '2d');
    await wait(card, VIEW_SWITCH_MS);

    return card;
  }

  function pillOf(card: EstanzaCard, room: string): HTMLElement | null {
    return (
      card.shadowRoot?.querySelector<HTMLElement>(
        `.temp[data-room="${room}"]`,
      ) ?? null
    );
  }

  it('keeps the temperature of a room in place, selected, while its own sheet shows it', async () => {
    const card = await mountWarm();
    const before = [
      pillOf(card, 'hall')?.style.left,
      pillOf(card, 'hall')?.style.top,
    ];

    await select(card, 'room', 'hall', 'tap');

    expect(sheetTitle(card)).toContain('20');
    expect([
      pillOf(card, 'hall')?.style.left,
      pillOf(card, 'hall')?.style.top,
    ]).toEqual(before);
    expect(pillOf(card, 'hall')?.classList).toContain('selected');
    expect(pillOf(card, 'bathroom')?.classList).not.toContain('selected');
  });

  it('moves another room temperature out from under an open sheet while its room still shows', async () => {
    vi.stubGlobal('innerWidth', 390);

    const card = await mountWarm();
    const bath = pillOf(card, 'bathroom');
    const x = parseFloat(bath?.style.left ?? 'NaN');
    const y = parseFloat(bath?.style.top ?? 'NaN');
    const real = HTMLElement.prototype.getBoundingClientRect;

    expect(Number.isFinite(x)).toBe(true);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('sheet')
          ? new DOMRect(x - 60, y - 40, 120, 80)
          : real.call(this);
      },
    );
    await select(card, 'room', 'hall', 'tap');
    await settle(card);
    await vi.advanceTimersByTimeAsync(200);
    await settle(card);

    const moved = pillOf(card, 'bathroom');
    const clear =
      Math.abs(parseFloat(moved?.style.left ?? 'NaN') - x) >= 60 ||
      Math.abs(parseFloat(moved?.style.top ?? 'NaN') - y) >= 40;

    expect(planOf(card)?.veiled).not.toContain('bathroom');
    expect(clear).toBe(true);
    expect(pillOf(card, 'hall')).not.toBeNull();
  });
});

describe('room names and the card controls', () => {
  const views = new DOMRect(12, 12, 98, 52);
  const floors = new DOMRect(12, 72, 48, 174);

  function placeControls(): void {
    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('views')) return views;
        if (this.classList.contains('floors')) return floors;

        return real.call(this);
      },
    );
  }

  it('keeps a room name off the view switch and the floor stack', async () => {
    const card = await mountCard();

    await pick(card, '2d');
    placeControls();
    await setState(card, 'light.hall', 'on');

    expect(planOf(card)?.covers).toEqual(
      expect.arrayContaining([
        { x: 61, y: 38, width: 98, height: 52 },
        { x: 36, y: 159, width: 48, height: 174 },
      ]),
    );
  });

  it('keeps a room name off the controls while a bottom sheet leaves them in place above it', async () => {
    vi.stubGlobal('innerWidth', 390);

    const card = await mountCard();

    await pick(card, '2d');
    placeControls();
    await select(card, 'room', 'hall', 'tap');

    expect(card.shadowRoot?.querySelector('.sheet.bottom')).not.toBeNull();
    expect(planOf(card)?.covers).toEqual(
      expect.arrayContaining([{ x: 61, y: 38, width: 98, height: 52 }]),
    );
  });

  it('hands the plan an open sheet, so the room tags under it draw nothing', async () => {
    vi.stubGlobal('innerWidth', 390);

    const card = await mountCard();
    const real = HTMLElement.prototype.getBoundingClientRect;

    await pick(card, '2d');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('sheet')
          ? new DOMRect(340, 110, 120, 80)
          : real.call(this);
      },
    );
    await select(card, 'room', 'hall', 'tap');
    await settle(card);

    expect(planOf(card)?.sheets).toEqual(
      expect.arrayContaining([{ x: 400, y: 150, width: 120, height: 80 }]),
    );
  });

  it('highlights the room whose sheet is open on the plan', async () => {
    const card = await mountCard();

    await pick(card, '2d');

    expect(planOf(card)?.selected).toBeNull();

    await select(card, 'room', 'hall', 'tap');

    expect(planOf(card)?.selected).toBe('hall');
  });
});

describe('the idle return on a wall tablet', () => {
  it('goes back to the default view with the default floor', async () => {
    const card = await mountCard({}, 'panel');

    await pick(card, '2d');
    await chooseFloor(card, 'bfloor');
    await wait(card, IDLE_MS);

    expect(shown(card)).toBe('3d');
    expect(chosenFloor(card)).toBe('f1');
  });

  it('goes back to the plan when the plan is the default', async () => {
    const goHome = vi.spyOn(EstanzaSceneView.prototype, 'goHome');
    const card = await mountCard({ default_view: '2d' }, 'panel');

    await pick(card, '3d');
    await chooseFloor(card, 'bfloor');
    await wait(card, IDLE_MS + IDLE_RETURN_MS);

    expect(shown(card)).toBe('2d');
    expect(planOf(card)?.active).toBe('f1');
    expect(goHome).not.toHaveBeenCalledWith(expect.anything(), IDLE_RETURN_MS);
  });
});
