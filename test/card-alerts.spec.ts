import '../src/card.js';

import { motionLive } from '@estanza/scene/env.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alertStyles,
  PIN_FADE_MS,
  PIN_HEAD_PX,
  PIN_STEM_PX,
} from '../src/alert-view.js';
import { cardType, type SceneBinding, scopeKey } from '../src/bindings.js';
import type { Rect } from '../src/camera-rig.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import type { HassEntityState } from '../src/hass-state.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { REFRAME_WAIT_MS } from '../src/tablet.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
  mockLight,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const MINUTE = 60 * 1000;

const bindings: SceneBinding[] = [
  {
    scope: { type: 'room', id: 'bathroom' },
    entity_ids: ['binary_sensor.bathroom_leak', 'binary_sensor.bathroom_smoke'],
  },
  {
    scope: { type: 'room', id: 'cellar' },
    entity_ids: ['binary_sensor.cellar_leak', 'binary_sensor.cellar_problem'],
  },
  { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.front_door' },
  {
    scope: { type: 'light', id: 'bedroom-light' },
    entity_id: 'light.bedroom',
  },
];

const quiet: HassEntityState[] = [
  mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', false),
  mockBinarySensor('binary_sensor.bathroom_smoke', 'smoke', false),
  mockBinarySensor('binary_sensor.cellar_leak', 'moisture', false),
  mockBinarySensor('binary_sensor.cellar_problem', 'problem', false),
  mockBinarySensor('binary_sensor.front_door', 'door', false),
  mockLight('light.bedroom', { on: true }),
  mockEntityState('alarm_control_panel.house', 'disarmed'),
];

let hass: MockHass;
let flyTo: ReturnType<typeof vi.spyOn>;

async function mountCard(
  layout: string | undefined = undefined,
  extra: Record<string, unknown> = {},
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({ states: quiet });
  card.hass = hass;
  card.layout = layout;
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    grid_options: { rows: 4 },
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
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(card);
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

async function set(
  card: EstanzaCard,
  entityId: string,
  state: string,
  msAgo = 0,
): Promise<void> {
  const current = hass.states[entityId];
  const at = new Date(Date.now() - msAgo).toISOString();

  hass = {
    ...hass,
    states: {
      ...hass.states,
      [entityId]: {
        ...(current ?? mockEntityState(entityId, state)),
        state,
        last_changed: at,
        last_updated: at,
      },
    },
  };
  card.hass = hass;
  await settle(card);
}

function banner(card: EstanzaCard): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>('.banner') ?? null;
}

function pin(card: EstanzaCard, entityId: string): HTMLElement | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(
      `.pin[data-alert="${entityId}"]`,
    ) ?? null
  );
}

function bannerAt(): Rect {
  const box = { left: 112, top: 12, right: 1268, bottom: 56 };

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return DOMRect.fromRect(
        this.classList.contains('banner')
          ? {
              x: box.left,
              y: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
            }
          : {},
      );
    },
  );

  return box;
}

function stageTall(height: number): void {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('stage') ? height : 0;
    },
  );
}

function stageSized(width: number, height: number): void {
  stageTall(height);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('stage') ? width : 0;
    },
  );
}

function pinAt(at: Point): void {
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    (scopes) => new Map(scopes.map((scope) => [scopeKey(scope), at])),
  );
}

function dotOf(card: EstanzaCard, floor: string): string | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(
      `.floors button[data-floor="${floor}"] .dot`,
    )?.style.background ?? null
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  flyTo = vi.spyOn(EstanzaSceneView.prototype, 'flyTo');
});

afterEach(() => {
  document.body.replaceChildren();
  motionLive.reduced = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a critical alert', () => {
  it('fills its room, stands a pin over it and runs a banner', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on', 2 * MINUTE);

    expect(card.roomMarks.bathroom?.danger).toBe('room');
    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).toContain(
      'critical',
    );
    expect(banner(card)?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Bathroom leak · Leak detected · 2 min',
    );
  });

  it('switches to the floor it is on and then flies to the room', async () => {
    const card = await mountCard();

    expect(sceneOf(card)?.floor).toBe('f1');

    await set(card, 'binary_sensor.cellar_leak', 'on');

    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(flyTo).not.toHaveBeenCalled();

    await wait(card, REFRAME_WAIT_MS);

    expect(flyTo).toHaveBeenCalledWith(
      { type: 'room', id: 'cellar' },
      expect.anything(),
      expect.any(Number),
    );
  });

  it('ends a drag in progress before it takes the camera', async () => {
    const endDrag = vi.spyOn(EstanzaSceneView.prototype, 'endDrag');
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_leak', 'on');

    expect(endDrag).toHaveBeenCalledOnce();
  });

  it('follows an alert that came while a dashboard column held the card out of the page', async () => {
    const card = await mountCard();

    card.remove();
    await set(card, 'binary_sensor.cellar_leak', 'on');
    document.body.append(card);
    await settle(card);
    await wait(card, REFRAME_WAIT_MS);

    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(flyTo).toHaveBeenCalledWith(
      { type: 'room', id: 'cellar' },
      expect.anything(),
      expect.any(Number),
    );
  });

  it('flies at once when the room is already on screen', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await wait(card, 0);

    expect(sceneOf(card)?.floor).toBe('f1');
    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it('closes an open sheet before it flies', async () => {
    const card = await mountCard();

    sceneOf(card)?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: 'bathroom',
          gesture: 'tap',
          x: 120,
          y: 80,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);

    expect(card.shadowRoot?.querySelector('.sheet')).not.toBeNull();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(card.shadowRoot?.querySelector('.sheet')).toBeNull();
  });

  it('keeps the view clear of the banner and of the pin below it on a tall card', async () => {
    const box = bannerAt();

    stageTall(800);

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await wait(card, 0);

    expect(sceneOf(card)?.clear).toContainEqual({
      ...box,
      bottom: box.bottom + PIN_HEAD_PX + PIN_STEM_PX,
    });
  });

  it('keeps only the banner clear on a short card, where the pin hangs low instead', async () => {
    const box = bannerAt();

    stageTall(230);

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await wait(card, 0);

    expect(sceneOf(card)?.clear).toContainEqual(box);
    expect(flyTo).toHaveBeenCalledWith(
      { type: 'room', id: 'bathroom' },
      expect.objectContaining({ y: 0 }),
      expect.any(Number),
    );

    await set(card, 'binary_sensor.bathroom_leak', 'off');
    await wait(card, PIN_FADE_MS);

    expect(sceneOf(card)?.clear).not.toContainEqual(
      expect.objectContaining({ left: box.left, top: box.top }),
    );
  });

  it('hangs the pin below its room when it would stand up into the banner', async () => {
    bannerAt();
    pinAt({ x: 300, y: 56 + PIN_STEM_PX });

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).toContain(
      'low',
    );
  });

  it('stands the pin up over its room when the banner is clear of it', async () => {
    bannerAt();
    pinAt({ x: 300, y: 56 + PIN_HEAD_PX + PIN_STEM_PX + 20 });

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).not.toContain(
      'low',
    );
  });

  it('leaves the lamp mark of its room on its lamp and stands the pin aside, clear of it', async () => {
    const foot = { x: 400, y: 300 };

    pinAt(foot);
    vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
      (scope) =>
        scope.id === 'bathroom-light' ? { x: foot.x, y: foot.y + 17 } : null,
    );

    const card = await mountCard(undefined, {
      bindings: [
        ...bindings,
        {
          scope: { type: 'light', id: 'bathroom-light' },
          entity_id: 'light.bedroom',
        },
      ],
    });

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    card.requestUpdate();
    await settle(card);

    const lamp = card.shadowRoot?.querySelector<HTMLElement>(
      '.mark[data-key="light:bathroom-light"]',
    );
    const at = {
      x: parseFloat(lamp?.style.left ?? 'NaN'),
      y: parseFloat(lamp?.style.top ?? 'NaN'),
    };
    const stood = pin(card, 'binary_sensor.bathroom_leak');
    const stem = {
      x: parseFloat(stood?.style.left ?? 'NaN'),
      y: parseFloat(stood?.style.top ?? 'NaN'),
    };
    const disc = 14;

    expect(Number.isFinite(at.x)).toBe(true);
    expect(at).toEqual({ x: foot.x, y: foot.y + 17 });
    expect(stem.y).toBe(foot.y);
    expect(
      Math.hypot(at.x - stem.x, at.y - stem.y) - disc,
    ).toBeGreaterThanOrEqual(8);
  });

  it('hangs the pin rather than stand it up past the top of the card', async () => {
    stageSized(1280, 800);
    pinAt({ x: 300, y: 20 });

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).toContain(
      'low',
    );
  });

  it('stands the pin up rather than hang it past the bottom of the card', async () => {
    stageSized(1280, 800);
    pinAt({ x: 300, y: 790 });

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).not.toContain(
      'low',
    );
  });

  it('draws no pin at all where the card has no room for the whole of it', async () => {
    stageSized(1280, PIN_STEM_PX);
    pinAt({ x: 300, y: PIN_STEM_PX / 2 });

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(banner(card)).not.toBeNull();
    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).toContain(
      'unplaced',
    );
  });

  it('turns the floor dot danger', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_leak', 'on');

    expect(dotOf(card, 'bfloor')).toBe('var(--ez-danger-fill)');
  });

  it('does not move the card again for an alert it has already followed', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_leak', 'on');
    await wait(card, REFRAME_WAIT_MS);
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.floors button[data-floor="f1"]')
      ?.click();
    await set(card, 'light.bedroom', 'off');

    expect(sceneOf(card)?.floor).toBe('f1');
    expect(flyTo).toHaveBeenCalledTimes(1);
  });
});

describe('several critical alerts', () => {
  it('show the newest in the banner with a count of the rest', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_leak', 'on', 5 * MINUTE);
    await set(card, 'binary_sensor.bathroom_smoke', 'on');

    const text = banner(card)?.querySelector('.banner-text')?.textContent;

    expect(text).toBe('Bathroom smoke · Smoke detected · now');
    expect(
      banner(card)?.querySelector('.banner-count')?.textContent?.trim(),
    ).toBe('+1');
    expect(sceneOf(card)?.floor).toBe('f1');
  });

  it('step through on a tap, each one taking the card to its room', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_leak', 'on', 5 * MINUTE);
    await set(card, 'binary_sensor.bathroom_smoke', 'on');
    await wait(card, REFRAME_WAIT_MS);
    flyTo.mockClear();

    banner(card)?.querySelector<HTMLButtonElement>('.banner-count')?.click();
    await settle(card);

    expect(banner(card)?.querySelector('.banner-text')?.textContent).toBe(
      'Basement leak · Leak detected · 5 min',
    );
    expect(sceneOf(card)?.floor).toBe('bfloor');

    await wait(card, REFRAME_WAIT_MS);

    expect(flyTo).toHaveBeenCalledWith(
      { type: 'room', id: 'cellar' },
      expect.anything(),
      expect.any(Number),
    );

    banner(card)?.querySelector<HTMLButtonElement>('.banner-count')?.click();
    await settle(card);

    expect(banner(card)?.querySelector('.banner-text')?.textContent).toBe(
      'Bathroom smoke · Smoke detected · now',
    );
  });

  it('keep the "ago" current while the banner is up', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await wait(card, 3 * MINUTE);

    expect(banner(card)?.querySelector('.banner-text')?.textContent).toBe(
      'Bathroom leak · Leak detected · 3 min',
    );
  });
});

describe('a notice', () => {
  it('stands a quiet pin on the door, with no fill, no banner and a muted dot', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.front_door', 'on', 12 * MINUTE);

    expect(pin(card, 'binary_sensor.front_door')?.classList).toContain(
      'notice',
    );
    expect(banner(card)).toBeNull();
    expect(Object.values(card.roomMarks).map((mark) => mark.danger)).toEqual(
      Object.values(card.roomMarks).map(() => null),
    );
    expect(card.idleHold).toBeNull();
  });

  it('never switches floors', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.cellar_problem', 'on');
    await wait(card, REFRAME_WAIT_MS);

    expect(sceneOf(card)?.floor).toBe('f1');
    expect(flyTo).not.toHaveBeenCalled();
    expect(dotOf(card, 'bfloor')).toBe('var(--ez-text-muted)');
  });

  it('appears when a door has been open for ten minutes, not before', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.front_door', 'on', 9 * MINUTE);

    expect(pin(card, 'binary_sensor.front_door')).toBeNull();

    await wait(card, MINUTE - 1);

    expect(pin(card, 'binary_sensor.front_door')).toBeNull();

    await wait(card, 1);

    expect(pin(card, 'binary_sensor.front_door')).not.toBeNull();
  });

  it('waits the time the card is configured with', async () => {
    const card = await mountCard(undefined, { open_alert_after: 2 });

    await set(card, 'binary_sensor.front_door', 'on');
    await wait(card, 2 * MINUTE);

    expect(pin(card, 'binary_sensor.front_door')).not.toBeNull();
  });
});

describe('a cleared alert', () => {
  it('fades its pin over 300ms, then removes it', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await set(card, 'binary_sensor.bathroom_leak', 'off');

    expect(pin(card, 'binary_sensor.bathroom_leak')?.classList).toContain(
      'leaving',
    );
    expect(banner(card)).toBeNull();
    expect(card.roomMarks.bathroom?.danger).toBeNull();

    await wait(card, PIN_FADE_MS);

    expect(pin(card, 'binary_sensor.bathroom_leak')).toBeNull();
  });

  it('goes at once when the reader asks for less motion', async () => {
    motionLive.reduced = true;

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');
    await set(card, 'binary_sensor.bathroom_leak', 'off');

    expect(pin(card, 'binary_sensor.bathroom_leak')).toBeNull();
  });

  it('keeps the same pin element while the alert lasts, so it drops only once', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    const first = pin(card, 'binary_sensor.bathroom_leak');

    await set(card, 'light.bedroom', 'off');
    await wait(card, 5 * MINUTE);

    expect(pin(card, 'binary_sensor.bathroom_leak')).toBe(first);
  });
});

describe('the pin motion', () => {
  const styles = alertStyles.cssText;

  it('drops in over 250ms and rings three times over three seconds', () => {
    expect(styles).toMatch(/animation: ez-drop 0\.25s ease-out 1;/);
    expect(styles).toMatch(/animation: ez-rings 1s ease-out 3;/);
  });

  it('hangs a low pin from its tip, the head under the stem', () => {
    const flat = styles.replace(/\s+/g, ' ');

    expect(flat).toMatch(/\.pin\.low \{[^}]*translate: -50% 0;/);
    expect(flat).toMatch(/\.pin\.low \.pin-head \{[^}]*order: 1;/);
  });

  it('has no animation that runs for ever', () => {
    expect(styles).not.toMatch(/infinite/);
  });

  it('drops and rings nothing when the reader asks for less motion', () => {
    const reduced = styles.slice(styles.indexOf('prefers-reduced-motion'));

    expect(reduced).toMatch(/\.pin\.critical \.pin-head::after/);
    expect(reduced).toMatch(/animation: none/);
  });
});

describe('the banner on a narrow card', () => {
  const styles = alertStyles.cssText.replace(/\s+/g, ' ');
  const rule = (selector: string): string =>
    new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(
      styles,
    )?.[1] ?? '';

  it('puts the kind, the room and the time in boxes of their own', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_leak', 'on');

    const parts = ['.banner-kind', '.banner-state', '.banner-ago'].map(
      (part) => banner(card)?.querySelector(part)?.textContent,
    );

    expect(parts).toEqual(['Bathroom leak', ' · Leak detected', ' · now']);
  });

  it('keeps one line, dropping the time before it cuts the room', () => {
    expect(rule('.banner-text')).toMatch(/white-space: nowrap;/);
    expect(rule('.banner-rest')).toMatch(/flex-wrap: wrap;/);
    expect(rule('.banner-rest')).toMatch(/overflow: hidden;/);
    expect(rule('.banner-rest')).toMatch(/height: 1\.3em;/);
    expect(rule('.banner-kind')).toMatch(/flex: none;/);
    expect(rule('.banner-state')).toMatch(/text-overflow: ellipsis;/);
    expect(rule('.banner-state')).toMatch(/white-space: pre;/);
    expect(rule('.banner-ago')).toMatch(/flex: none;/);
  });
});

describe('the banner count under a finger', () => {
  const styles = alertStyles.cssText.replace(/\s+/g, ' ');
  const coarse = styles.slice(styles.indexOf('@media (pointer: coarse)'));
  const rule = /\.banner-count \{([^}]*)\}/.exec(coarse)?.[1] ?? '';

  it('grows its hit area to 44px with a transparent border, not a pseudo-element', () => {
    expect(styles).toContain('@media (pointer: coarse)');
    expect(rule).toMatch(/height: 44px;/);
    expect(rule).toMatch(/border-block: 4px solid transparent;/);
    expect(rule).toMatch(/background-clip: padding-box;/);
    expect(coarse).not.toMatch(/banner-count::before/);
  });

  it('keeps the banner its own height by pulling the growth back in', () => {
    expect(rule).toMatch(/margin-block: -6px;/);
  });
});

describe('a triggered alarm with no room', () => {
  it('rims every room of the house and names the whole house', async () => {
    const card = await mountCard();

    await set(card, 'alarm_control_panel.house', 'triggered');

    expect(banner(card)?.querySelector('.banner-text')?.textContent).toBe(
      'House alarm · Triggered · now',
    );
    expect(
      ['living-space', 'bathroom', 'hall', 'cellar', 'bedroom'].map(
        (room) => card.roomMarks[room]?.danger,
      ),
    ).toEqual(['rim', 'rim', 'rim', 'rim', 'rim']);
    expect(card.shadowRoot?.querySelector('.pin')).toBeNull();
    expect(sceneOf(card)?.floor).toBe('f1');
  });
});

describe('the room of an active alert', () => {
  it('opens its sheet from the alert mark, with the alert as the first row', async () => {
    pinAt({ x: 300, y: 300 });
    stageSized(1280, 800);

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_smoke', 'on');
    pin(card, 'binary_sensor.bathroom_smoke')
      ?.querySelector<HTMLElement>('button.pin-head')
      ?.click();
    await settle(card);

    const sheet = card.shadowRoot?.querySelector('.sheet[data-kind="room"]');
    const first = sheet?.querySelector('.room-body .readout.row');

    expect(sheet?.querySelector('.sheet-title')?.textContent).toBe('Bathroom');
    expect(first?.classList).toContain('alert');
    expect(first?.getAttribute('data-alert')).toBe(
      'binary_sensor.bathroom_smoke',
    );
    expect(first?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Bathroom smoke Smoke detected · now',
    );
  });

  it('names the alert once, the same on its pin, the banner and its row', async () => {
    pinAt({ x: 300, y: 300 });
    stageSized(1280, 800);

    const card = await mountCard();

    await set(card, 'binary_sensor.bathroom_smoke', 'on');

    const head = pin(card, 'binary_sensor.bathroom_smoke')?.querySelector(
      'button.pin-head',
    );

    expect(head?.getAttribute('aria-label')).toBe('Bathroom smoke');
    expect(banner(card)?.querySelector('.banner-kind')?.textContent).toBe(
      'Bathroom smoke',
    );
    expect(banner(card)?.querySelector('.banner-state')?.textContent).toBe(
      ' · Smoke detected',
    );

    (head as HTMLElement | null)?.click();
    await settle(card);

    const row = card.shadowRoot?.querySelector('.row.alert');

    expect(row?.querySelector('.row-state')?.textContent).toBe(
      'Smoke detected · now',
    );
    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(
      /^Bathroom smoke /,
    );
  });

  it('opens the sensor in more-info from the alert row', async () => {
    pinAt({ x: 300, y: 300 });
    stageSized(1280, 800);

    const card = await mountCard();
    const opened: string[] = [];

    card.addEventListener('hass-more-info', (event) =>
      opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId),
    );
    await set(card, 'binary_sensor.bathroom_smoke', 'on');
    pin(card, 'binary_sensor.bathroom_smoke')
      ?.querySelector<HTMLElement>('button.pin-head')
      ?.click();
    await settle(card);
    card.shadowRoot?.querySelector<HTMLElement>('.row.alert')?.click();

    expect(opened).toEqual(['binary_sensor.bathroom_smoke']);
  });
});

describe('an armed alarm', () => {
  it('shows a shield in the top right that opens the alarm in more-info', async () => {
    const card = await mountCard();
    const opened: string[] = [];

    card.addEventListener('hass-more-info', (event) =>
      opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId),
    );
    await set(card, 'alarm_control_panel.house', 'armed_away');

    const shield =
      card.shadowRoot?.querySelector<HTMLElement>('.status button');

    expect(shield?.getAttribute('aria-label')).toBe('Alarm armed away');
    expect(banner(card)).toBeNull();

    shield?.click();

    expect(opened).toEqual(['alarm_control_panel.house']);
  });

  it('draws a different shield for armed home and armed away', async () => {
    const card = await mountCard();
    const glyph = async (state: string): Promise<string | undefined> => {
      await set(card, 'alarm_control_panel.house', state);

      return card.shadowRoot?.querySelector('.status button svg')?.innerHTML;
    };

    const home = await glyph('armed_home');
    const away = await glyph('armed_away');

    expect(home).toBeTruthy();
    expect(away).toBeTruthy();
    expect(home).not.toBe(away);
    expect(
      card.shadowRoot?.querySelector('.status button')?.getAttribute('title'),
    ).toBe('Alarm armed away');
  });

  it('takes the shield away when disarmed', async () => {
    const card = await mountCard();

    await set(card, 'alarm_control_panel.house', 'armed_home');
    await set(card, 'alarm_control_panel.house', 'disarmed');

    expect(card.shadowRoot?.querySelector('.status')).toBeNull();
  });
});

describe('an alert on a wall tablet', () => {
  it('holds the floor and room of a critical alert, and lets go when it clears', async () => {
    const card = await mountCard('panel');

    await set(card, 'binary_sensor.cellar_leak', 'on');

    expect(card.idleHold).toEqual({
      floor: 'bfloor',
      room: { type: 'room', id: 'cellar' },
    });

    await set(card, 'binary_sensor.cellar_leak', 'off');

    expect(card.idleHold).toBeNull();
  });

  it('goes back to the room of the alert when idle, not home', async () => {
    const goHome = vi.spyOn(EstanzaSceneView.prototype, 'goHome');
    const card = await mountCard('panel');

    await set(card, 'binary_sensor.cellar_leak', 'on');
    await wait(card, REFRAME_WAIT_MS);
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.floors button[data-floor="f1"]')
      ?.click();
    card.dispatchEvent(new Event('pointerdown'));
    flyTo.mockClear();
    await wait(card, 45_000 + REFRAME_WAIT_MS);

    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(flyTo).toHaveBeenCalledWith(
      { type: 'room', id: 'cellar' },
      expect.anything(),
      expect.any(Number),
    );
    expect(goHome).not.toHaveBeenCalled();
  });

  it('keeps pins and the banner in late night, when temperatures hide', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 23, 30));

    const card = await mountCard('panel', { idle_seconds: 5 });

    await wait(card, 5000);
    await set(card, 'binary_sensor.bathroom_leak', 'on');

    expect(card.lateNight).toBe(true);
    expect(banner(card)).not.toBeNull();
    expect(pin(card, 'binary_sensor.bathroom_leak')).not.toBeNull();
  });
});

describe('leaving the page', () => {
  it('stops the alert clocks', async () => {
    const card = await mountCard();

    await set(card, 'binary_sensor.front_door', 'on', 9 * MINUTE);
    card.remove();

    expect(vi.getTimerCount()).toBe(0);
  });
});
