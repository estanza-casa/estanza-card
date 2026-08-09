import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { motionLive } from '@estanza/scene/env.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { CONFIRM_GAP_MS } from '../src/control.js';
import { controlStyles } from '../src/control-view.js';
import type { Point } from '../src/gesture.js';
import type { HassEntityState } from '../src/hass-state.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import {
  SHEET_EDGE_PX,
  SHEET_WIDTH_PX,
  SWIPE_FLICK_PX_PER_MS,
} from '../src/sheet.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockClimate,
  mockEntityState,
  type MockHass,
  mockLight,
  mockLock,
} from './mock-hass.js';

const SHEET_PX = 300;
const STAGE = { width: 390, height: 640 };
const MOTION_MS = 300;

const house: Point[] = [
  { x: 40, y: 60 },
  { x: 350, y: 60 },
  { x: 350, y: 300 },
  { x: 40, y: 300 },
];

const bindings: SceneBinding[] = [
  { scope: { type: 'light', id: 'lamp' }, entity_id: 'light.lamp' },
  { scope: { type: 'room', id: 'living-space' }, entity_id: 'light.living' },
  { scope: { type: 'room', id: 'bathroom' }, entity_id: 'light.bath' },
  { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.d1' },
  { scope: { type: 'door', id: 'd1' }, entity_id: 'lock.d1' },
  { scope: { type: 'window', id: 'win1' }, entity_id: 'binary_sensor.win1' },
];

function homeWithWindow() {
  const [ground, ...upper] = homeFixture.plan.floors;
  const win1 = {
    id: 'win1',
    wallId: 'w6',
    position: 0.5,
    width: 100,
    height: 120,
    sillHeight: 90,
    type: 'standard',
  };

  return homeDocumentSchema.parse({
    ...homeFixture,
    plan: {
      ...homeFixture.plan,
      floors: [{ ...ground, windows: [win1] }, ...upper],
    },
  });
}

async function mountCard(
  size: { width: number; height: number; viewport?: number } = STAGE,
  extra: HassEntityState[] = [],
  extraBindings: SceneBinding[] = [],
): Promise<EstanzaCard> {
  vi.stubGlobal('innerWidth', size.viewport ?? size.width);

  const card = document.createElement('estanza-card');

  card.hass = createMockHass({
    states: [
      mockLight('light.lamp', { on: true }),
      mockLight('light.living', { on: false }),
      mockLight('light.bath', { on: false }),
      mockBinarySensor('binary_sensor.d1', 'door', false),
      mockLock('lock.d1', 'locked'),
      mockBinarySensor('binary_sensor.win1', 'window', false),
      ...extra,
    ],
  });
  card.setConfig({
    type: cardType,
    home_document: homeWithWindow(),
    bindings: [...bindings, ...extraBindings],
  });
  document.body.append(card);
  await settle(card);

  const stage = find(card, '.stage');

  if (!stage) throw new Error('no stage');

  vi.spyOn(stage, 'clientWidth', 'get').mockReturnValue(size.width);
  vi.spyOn(stage, 'clientHeight', 'get').mockReturnValue(size.height);
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

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

async function open(card: EstanzaCard, key: string): Promise<void> {
  const [scopeType, scopeId] = key.split(':');
  const surface =
    find(card, 'estanza-plan-view') ?? find(card, 'estanza-scene-view');

  surface?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture: 'press', x: 195, y: 180 },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

function pointer(
  target: Element,
  type: string,
  y: number,
  timeStamp: number,
): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: 7,
    pointerType: 'touch',
    clientX: 195,
    clientY: y,
  });

  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  target.dispatchEvent(event);
}

async function swipe(
  card: EstanzaCard,
  from: Element,
  steps: [number, number][],
): Promise<void> {
  const [first, ...rest] = steps;

  pointer(from, 'pointerdown', first[0], first[1]);

  for (const [y, at] of rest) pointer(from, 'pointermove', y, at);

  const [y, at] = steps[steps.length - 1];

  pointer(from, 'pointerup', y, at);
  await settle(card);
}

function sheetOf(card: EstanzaCard): HTMLElement {
  const sheet = find(card, '.sheet');

  if (!sheet) throw new Error('no sheet');

  return sheet;
}

function services(card: EstanzaCard): string[] {
  return (card.hass as MockHass).serviceCalls.map(
    (call) => `${call.domain}.${call.service}`,
  );
}

function hexes(style: string | null): string[] {
  return style?.match(/#[0-9a-f]{6}/gi) ?? [];
}

function rgbOf(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 25, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement): number {
      return this.classList.contains('sheet') ? SHEET_PX : 0;
    },
  );
  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(() => ({
    x: 195,
    y: 180,
  }));

  for (const surface of [EstanzaSceneView, EstanzaPlanView]) {
    vi.spyOn(surface.prototype, 'roomFootprints').mockImplementation(
      (slugs: readonly string[]) =>
        new Map(slugs.map((slug) => [slug, { floor: house, top: [] }])),
    );
  }
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a downward swipe on a bottom sheet', () => {
  it('draws a grip as the place to take hold of the sheet', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    expect(sheetOf(card).classList).toContain('bottom');
    expect(find(card, '.sheet.bottom > .grip')).not.toBeNull();
  });

  it('follows the finger down from the grip', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const grip = find(card, '.sheet .grip');

    if (!grip) throw new Error('no grip');

    pointer(grip, 'pointerdown', 400, 0);
    pointer(grip, 'pointermove', 460, 400);

    expect(sheetOf(card).style.transform).toBe('translateY(60px)');
  });

  it('closes the sheet when released past a quarter of its height', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const grip = find(card, '.sheet .grip');

    if (!grip) throw new Error('no grip');

    await swipe(card, grip, [
      [340, 0],
      [400, 600],
      [440, 1200],
    ]);
    await vi.advanceTimersByTimeAsync(MOTION_MS);
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
  });

  it('closes the sheet on a fast flick from its title', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const title = find(card, '.sheet .sheet-head');

    if (!title) throw new Error('no title');

    await swipe(card, title, [
      [340, 0],
      [350, 10],
      [370, 10 + 20 / (SWIPE_FLICK_PX_PER_MS * 2)],
    ]);
    await vi.advanceTimersByTimeAsync(MOTION_MS);
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
  });

  it('snaps back from a short slow drag and stays open', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const grip = find(card, '.sheet .grip');

    if (!grip) throw new Error('no grip');

    await swipe(card, grip, [
      [340, 0],
      [370, 800],
      [380, 1600],
    ]);
    await vi.advanceTimersByTimeAsync(MOTION_MS);
    await settle(card);

    expect(find(card, '.sheet')).not.toBeNull();
    expect(sheetOf(card).style.transform).toBe('');
  });

  it('never moves or closes the sheet from a drag among its rows', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const row = find(card, '.sheet .readout.row');

    if (!row) throw new Error('no row');

    pointer(row, 'pointerdown', 500, 0);
    pointer(row, 'pointermove', 700, 100);

    expect(sheetOf(card).style.transform).toBe('');

    pointer(row, 'pointerup', 700, 100);
    await vi.advanceTimersByTimeAsync(MOTION_MS);
    await settle(card);

    expect(find(card, '.sheet')).not.toBeNull();
  });

  it('opens the next sheet where it belongs after one was swiped away', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const grip = find(card, '.sheet .grip');

    if (!grip) throw new Error('no grip');

    await swipe(card, grip, [
      [340, 0],
      [460, 600],
    ]);
    await vi.advanceTimersByTimeAsync(MOTION_MS);
    await settle(card);
    await open(card, 'room:bathroom');

    expect(sheetOf(card).style.transform).toBe('');
    expect(sheetOf(card).style.transition).toBe('');
  });
});

describe('the controls above a bottom sheet', () => {
  it('tells the stage how high the sheet rises, so the controls stay above it', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    expect(
      find(card, '.stage')?.style.getPropertyValue('--ez-sheet-rise'),
    ).toBe(`${SHEET_PX}px`);
  });
});

describe('the rows of a room sheet', () => {
  it('reads the lock of a door beside whether it is shut', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');

    const row = find(card, '.sheet .readout.row[data-key="door:d1"]');

    expect(row?.textContent?.replace(/\s+/g, ' ')).toMatch(/Closed.*locked/i);
  });

  it('names a window after its room', async () => {
    const card = await mountCard();

    await open(card, 'room:bathroom');

    const row = find(card, '.sheet .readout.row[data-key="window:win1"]');

    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(
      /^Bathroom window\b/,
    );
  });
});

describe('where a sheet docks', () => {
  const kinds = ['room:living-space', 'light:lamp'];

  it('rises from the bottom for a room and a light alike in a phone-portrait viewport', async () => {
    const card = await mountCard({ width: 390, height: 640, viewport: 390 });

    for (const key of kinds) {
      await open(card, key);

      expect(sheetOf(card).classList, key).toContain('bottom');
    }
  });

  it('docks top right on a 560 by 351 card in a desktop viewport, leaving 40% of it free', async () => {
    const card = await mountCard({ width: 560, height: 351, viewport: 1920 });

    for (const key of kinds) {
      await open(card, key);

      const sheet = sheetOf(card);

      expect(sheet.classList, key).not.toContain('bottom');
      expect(sheet.style.left, key).toBe(
        `${560 - SHEET_EDGE_PX - SHEET_WIDTH_PX}px`,
      );
      expect(sheet.style.width, key).toBe(`${SHEET_WIDTH_PX}px`);
      expect(sheet.style.maxHeight, key).toBe(`${351 - 2 * SHEET_EDGE_PX}px`);
    }
  });

  it('covers a 468 by 351 masonry card, which a docked sheet would leave under 40% free', async () => {
    const card = await mountCard({ width: 468, height: 351, viewport: 1920 });

    for (const key of kinds) {
      await open(card, key);

      const sheet = sheetOf(card);

      expect(sheet.classList, key).not.toContain('bottom');
      expect(sheet.style.left, key).toBe(`${SHEET_EDGE_PX}px`);
      expect(sheet.style.width, key).toBe(`${468 - 2 * SHEET_EDGE_PX}px`);
    }
  });

  it('docks top right on a wide but short card, capped at its height and scrolling inside', async () => {
    const card = await mountCard({ width: 1280, height: 300 });

    for (const key of kinds) {
      await open(card, key);

      const sheet = sheetOf(card);

      expect(sheet.classList, key).not.toContain('bottom');
      expect(sheet.style.maxHeight, key).toBe(`${300 - 2 * SHEET_EDGE_PX}px`);
    }
  });

  it('docks at the right of a phone turned to landscape', async () => {
    const card = await mountCard({ width: 844, height: 296 });

    await open(card, 'room:living-space');

    const sheet = sheetOf(card);

    expect(sheet.classList).not.toContain('bottom');
    expect(Number.parseFloat(sheet.style.left)).toBe(
      844 - SHEET_EDGE_PX - SHEET_WIDTH_PX,
    );
    expect(sheet.style.maxHeight).toBe(`${296 - 2 * SHEET_EDGE_PX}px`);
  });

  it('starts below the armed-alarm shield', async () => {
    const card = await mountCard({ width: 1280, height: 800 }, [
      mockEntityState('alarm_control_panel.house', 'armed_away'),
    ]);

    await open(card, 'room:living-space');

    expect(find(card, '.status')).not.toBeNull();
    expect(Number.parseFloat(sheetOf(card).style.top)).toBe(68);
  });
});

describe('the white swatches of a light sheet', () => {
  it('paints warm, neutral and cool white far enough apart to tell at a glance', async () => {
    const card = await mountCard();

    await open(card, 'light:lamp');

    const paints = [
      ...(card.shadowRoot?.querySelectorAll('.sheet .tb.swatch span') ?? []),
    ].flatMap((span) => hexes(span.getAttribute('style')));

    expect(paints).toHaveLength(3);

    for (const [index, one] of paints.entries()) {
      for (const other of paints.slice(index + 1)) {
        const [a, b] = [rgbOf(one), rgbOf(other)];
        const apart = Math.hypot(...a.map((value, at) => value - b[at]));

        expect(apart, `${one} against ${other}`).toBeGreaterThanOrEqual(60);
      }
    }

    expect(rgbOf(paints[0])[2]).toBeLessThan(rgbOf(paints[1])[2]);
    expect(rgbOf(paints[1])[2]).toBeLessThan(rgbOf(paints[2])[2]);
  });

  it('presses the white a light reports only as a colour', async () => {
    const card = await mountCard();
    const hass = card.hass as MockHass;

    await open(card, 'light:lamp');

    const cases: [Record<string, unknown>, string | null][] = [
      [{ hs_color: [49, 1] }, 'Cool white'],
      [{ hs_color: [26, 34], rgb_color: [255, 207, 168] }, 'Neutral white'],
      [{ hs_color: [28, 65], rgb_color: [255, 166, 89] }, 'Warm white'],
      [{ hs_color: [0, 100], rgb_color: [255, 0, 0] }, null],
    ];

    for (const [colour, white] of cases) {
      await report(card, hass, colour);

      const pressed = [
        ...(card.shadowRoot?.querySelectorAll<HTMLElement>(
          '.sheet .tb.swatch[aria-pressed="true"]',
        ) ?? []),
      ].map((swatch) => swatch.getAttribute('aria-label'));

      expect(pressed, JSON.stringify(colour)).toEqual(white ? [white] : []);
    }
  });
});

async function report(
  card: EstanzaCard,
  hass: MockHass,
  colour: Record<string, unknown>,
): Promise<void> {
  hass.setState('light.lamp', 'on', {
    friendly_name: 'Lamp',
    supported_color_modes: ['hs'],
    color_mode: 'hs',
    brightness: 200,
    ...colour,
  });
  card.hass = { ...hass };
  await settle(card);
}

describe('a sheet closing', () => {
  type Played = { element: Element; frames: Keyframe[]; ms: number };

  function recordFades(): Played[] {
    const played: Played[] = [];

    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value(
        this: Element,
        frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        played.push({ element: this, frames, ms: Number(options.duration) });

        return {
          finished: new Promise(() => undefined),
          cancel: () => undefined,
        };
      },
    });

    return played;
  }

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    motionLive.reduced = false;
  });

  it('fades the sheet out from the next frame over the time it fades in, while taps pass through it', async () => {
    const played = recordFades();
    const card = await mountCard();

    await open(card, 'room:living-space');
    find(card, '.sheet button[aria-label="Close"]')?.click();
    await settle(card);

    const unplayed = played.length;

    vi.advanceTimersByTime(20);

    const ghost = find(card, '.sheets > .sheet.leaving');
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');
    const appear = /\.sheet \{[^}]*animation: ez-appear (\d+)ms/.exec(rules);

    expect(unplayed).toBe(0);
    expect(ghost).not.toBeNull();
    expect(ghost?.hasAttribute('inert')).toBe(true);
    expect(ghost?.querySelector('[id]')).toBeNull();
    expect(find(card, '.sheets > .sheet:not(.leaving)')).toBeNull();
    expect(played).toHaveLength(1);
    expect(played[0].element).toBe(ghost);
    expect(played[0].frames.map((frame) => frame.opacity)).toEqual([1, 0]);
    expect(played[0].ms).toBe(Number(appear?.[1]));
    expect(rules).toMatch(/\.sheet\.leaving \{[^}]*pointer-events: none/);
  });

  it('never replays the fade-in on the copy that fades out', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(/\.sheet\.leaving \{[^}]*animation: none/);
  });

  it('shows and hides the sheet at once, with no fade, when the reader asks for less motion', async () => {
    const played = recordFades();
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');
    const reduced = rules.slice(rules.indexOf('prefers-reduced-motion'));

    motionLive.reduced = true;

    const card = await mountCard();

    await open(card, 'room:living-space');
    find(card, '.sheet button[aria-label="Close"]')?.click();
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
    expect(played).toHaveLength(0);
    expect(reduced).toMatch(/\.sheet \{[^}]*animation: none/);
  });
});

describe('the click a touch tap leaves behind', () => {
  function heatingRow(card: EstanzaCard): HTMLElement | null {
    return find(
      card,
      '.sheet .device[data-key="entity:climate.bath"] .device-name',
    );
  }

  function touch(target: Element, type: string): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
      }),
    );
  }

  function clickOn(target: Element | null): void {
    target?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }),
    );
  }

  async function mountWatched(): Promise<[EstanzaCard, string[]]> {
    const card = await mountCard(
      STAGE,
      [mockClimate('climate.bath')],
      [
        {
          scope: { type: 'room', id: 'bathroom' },
          entity_ids: ['climate.bath'],
        },
      ],
    );
    const opened: string[] = [];

    card.addEventListener('hass-more-info', (event) =>
      opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId),
    );

    return [card, opened];
  }

  it('never reaches a sheet row that the tap opened under the finger', async () => {
    const [card, opened] = await mountWatched();
    const surface = find(card, 'estanza-scene-view');

    if (!surface) throw new Error('no scene');

    touch(surface, 'pointerdown');
    touch(surface, 'pointerup');
    await open(card, 'room:bathroom');
    vi.advanceTimersByTime(30);
    clickOn(heatingRow(card));
    await settle(card);

    expect(heatingRow(card)).not.toBeNull();
    expect(opened).toEqual([]);
  });

  it('still lets the next tap on that row through', async () => {
    const [card, opened] = await mountWatched();

    await open(card, 'room:bathroom');
    vi.advanceTimersByTime(1000);

    const row = heatingRow(card);

    if (!row) throw new Error('no row');

    touch(row, 'pointerdown');
    touch(row, 'pointerup');
    clickOn(row.querySelector('.row-text'));

    expect(opened).toEqual(['climate.bath']);
  });
});

describe('an open sheet and the view and floor controls', () => {
  it('stays open across a switch to the plan and back', async () => {
    const card = await mountCard();

    await open(card, 'room:living-space');
    find(card, '.views button[data-view="2d"]')?.click();
    await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS * 2);
    await settle(card);

    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();

    find(card, '.views button[data-view="3d"]')?.click();
    await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS * 2);
    await settle(card);

    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
  });
});

describe('the lamp chip of a room sheet', () => {
  it('stays when no device row switches the room light', async () => {
    const card = await mountCard();

    await open(card, 'room:bathroom');

    expect(find(card, '.sheet .lamp')).not.toBeNull();
  });

  it('is dropped when a device row switches the same one light', async () => {
    const card = await mountCard(
      STAGE,
      [],
      [
        {
          scope: { type: 'light', id: 'bathroom-light' },
          entity_id: 'light.bath',
        },
      ],
    );

    await open(card, 'room:bathroom');

    expect(
      find(card, '.sheet .device[data-key="light:bathroom-light"]'),
    ).not.toBeNull();
    expect(find(card, '.sheet .lamp')).toBeNull();
  });
});

describe('a door row of a room sheet', () => {
  it('unlocks inline on a second tap after the gap, and the sheet stays open', async () => {
    const card = await mountCard();
    const row = (): HTMLElement | null =>
      find(card, '.sheet .readout.row[data-key="door:d1"]');

    await open(card, 'room:living-space');
    row()?.click();
    await settle(card);

    expect(services(card)).toEqual([]);
    expect(row()?.classList).toContain('armed');
    expect(row()?.querySelector('.drain')).not.toBeNull();

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    row()?.click();
    await settle(card);

    expect(services(card)).toEqual(['lock.unlock']);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
  });

  it('says the pending unlock on the armed row, with the turn the mark draws', async () => {
    const card = await mountCard();
    const row = (): HTMLElement | null =>
      find(card, '.sheet .readout.row[data-key="door:d1"]');

    await open(card, 'room:living-space');

    const shown = row()?.querySelector('.row-state')?.textContent?.trim();

    row()?.click();
    await settle(card);

    expect(shown).not.toBe('Tap again to unlock');
    expect(row()?.querySelector('.row-state')?.textContent?.trim()).toBe(
      'Tap again to unlock',
    );
    expect(row()?.querySelectorAll('svg')).toHaveLength(2);
    expect(row()?.querySelector('.turn')).not.toBeNull();
  });

  it('draws the padlock its mark draws, locked and unlocked', async () => {
    for (const state of ['locked', 'unlocked']) {
      const card = await mountCard(STAGE, [mockLock('lock.d1', state)]);

      await open(card, 'room:living-space');

      const glyph = find(
        card,
        '.sheet .readout.row[data-key="door:d1"] svg',
      )?.innerHTML;
      const mark = find(card, '.mark[data-key="door:d1"] .disc svg')?.innerHTML;

      expect(mark).toBeTruthy();
      expect(glyph).toBe(mark);

      card.remove();
    }
  });

  it('locks inline on one tap', async () => {
    const card = await mountCard(STAGE, [mockLock('lock.d1', 'unlocked')]);

    await open(card, 'room:living-space');
    find(card, '.sheet .readout.row[data-key="door:d1"]')?.click();
    await settle(card);

    expect(services(card)).toEqual(['lock.lock']);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
  });
});

describe('a thermostat with no object of its own', () => {
  const climate: SceneBinding[] = [
    { scope: { type: 'room', id: 'bathroom' }, entity_ids: ['climate.bath'] },
    {
      scope: { type: 'prop', id: 'gone-thermostat' },
      entity_id: 'climate.bath',
    },
  ];

  it('is a row of its room, with its heating state and a way into more-info', async () => {
    const card = await mountCard(STAGE, [mockClimate('climate.bath')], climate);
    const opened: string[] = [];

    card.addEventListener('hass-more-info', (event) =>
      opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId),
    );
    await open(card, 'room:bathroom');

    const row = find(card, '.sheet .device[data-key="entity:climate.bath"]');

    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Bath Heating');

    row?.querySelector<HTMLElement>('.device-name')?.click();

    expect(opened).toEqual(['climate.bath']);
  });
});
