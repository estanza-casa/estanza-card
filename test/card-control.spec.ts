import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import { CONFIRM_GAP_MS } from '../src/control.js';
import type { EstanzaSceneView, SceneGesture } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import {
  createHouseHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
} from './mock-hass.js';

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'kitchen-strip' },
    entity_id: 'light.kitchen_strip',
  },
  {
    scope: { type: 'light', id: 'fountain' },
    entity_id: 'switch.garden_fountain',
  },
  { scope: { type: 'door', id: 'garage-door' }, entity_id: 'cover.garage' },
  { scope: { type: 'door', id: 'front-door' }, entity_id: 'lock.front_door' },
  { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
  {
    scope: { type: 'light', id: 'hall-light' },
    entity_id: 'light.hall_ceiling',
  },
];

let hass: MockHass;

async function mountCard(extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

  const card = document.createElement('estanza-card');

  hass = createHouseHass();
  card.hass = hass;
  card.setConfig({ type: cardType, share_id: 'abc123', bindings, ...extra });
  document.body.append(card);
  await card.updateComplete;

  return card;
}

function sceneOf(card: EstanzaCard): EstanzaSceneView {
  const scene = card.shadowRoot?.querySelector('estanza-scene-view');

  if (!scene) throw new Error('no scene');

  return scene;
}

async function act(
  card: EstanzaCard,
  key: string,
  gesture: SceneGesture = 'tap',
): Promise<void> {
  const [scopeType, scopeId] = key.split(':');

  sceneOf(card).dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture, x: 120, y: 80 },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

async function settle(card: EstanzaCard): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await card.updateComplete;
}

async function publish(card: EstanzaCard): Promise<void> {
  card.hass = { ...hass };
  await settle(card);
}

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function mark(card: EstanzaCard, key: string): HTMLElement | null {
  return find(card, `.mark[data-key="${key}"]`);
}

function styleRules(): string {
  return EstanzaCard.styles.cssText.replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tapping a light', () => {
  it('toggles it through hass.callService', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'toggle',
        data: { entity_id: 'light.kitchen_strip' },
      },
    ]);
  });

  it('draws the light off at once and rings it while pending', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');

    expect(sceneOf(card).overlay.lights['kitchen-strip']?.on).toBe(false);
    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('pending');
  });

  it('closes the ring once Home Assistant confirms', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');
    hass.setState('light.kitchen_strip', 'off', {});
    await publish(card);

    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('confirmed');

    vi.advanceTimersByTime(150);
    await settle(card);

    expect(mark(card, 'light:kitchen-strip')).toBeNull();
    expect(sceneOf(card).overlay.lights['kitchen-strip']?.on).toBe(false);
  });

  it('asks for the opposite of the last tap when tapped again while pending', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');
    await act(card, 'light:kitchen-strip');
    await act(card, 'light:kitchen-strip');

    expect(hass.serviceCalls.map((call) => call.service)).toEqual([
      'toggle',
      'turn_on',
      'toggle',
    ]);
    expect(sceneOf(card).overlay.lights['kitchen-strip']?.on).toBe(false);
  });

  it('waits for the state of the last tap, not the first', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');
    vi.advanceTimersByTime(3000);
    hass.setState('light.kitchen_strip', 'off', {});
    await act(card, 'light:kitchen-strip');

    expect(hass.serviceCalls.map((call) => call.service)).toEqual([
      'toggle',
      'turn_on',
    ]);
    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('pending');

    await publish(card);
    vi.advanceTimersByTime(3000);
    await settle(card);

    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('pending');

    hass.setState('light.kitchen_strip', 'on', {});
    await publish(card);

    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('confirmed');
  });
});

describe('a call that fails', () => {
  it('rolls the light back and says so', async () => {
    const card = await mountCard();

    hass.callService = vi.fn().mockRejectedValue(new Error('refused'));
    card.hass = { ...hass };
    await act(card, 'light:kitchen-strip');
    await settle(card);

    expect(sceneOf(card).overlay.lights['kitchen-strip']?.on).toBe(true);
    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('failed');
    expect(find(card, '.toast')?.textContent).toContain(
      'Kitchen strip did not respond',
    );
  });

  it('rolls back when Home Assistant never confirms within 5 seconds', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip');
    vi.advanceTimersByTime(5000);
    await settle(card);

    expect(sceneOf(card).overlay.lights['kitchen-strip']?.on).toBe(true);
    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('failed');
  });

  it('clears the failed mark after 4 seconds and the toast after 6.5', async () => {
    const card = await mountCard();

    hass.callService = vi.fn().mockRejectedValue(new Error('refused'));
    card.hass = { ...hass };
    await act(card, 'light:kitchen-strip');
    await settle(card);

    vi.advanceTimersByTime(4000);
    await settle(card);

    expect(mark(card, 'light:kitchen-strip')).toBeNull();
    expect(find(card, '.toast')).not.toBeNull();

    vi.advanceTimersByTime(2500);
    await settle(card);

    expect(find(card, '.toast')).toBeNull();
  });

  it('tries the same call again from the toast', async () => {
    const card = await mountCard();
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValue(undefined);

    hass.callService = call;
    card.hass = { ...hass };
    await act(card, 'light:kitchen-strip');
    await settle(card);

    find(card, '.toast button[data-act="retry"]')?.click();
    await settle(card);

    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]).toEqual([
      'light',
      'toggle',
      { entity_id: 'light.kitchen_strip' },
    ]);
  });
});

describe('an unavailable entity', () => {
  it('only raises a toast', async () => {
    const card = await mountCard();

    await act(card, 'light:hall-light');

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.toast')?.textContent).toContain(
      'Hall light is unavailable',
    );
    expect(find(card, '.toast button')).toBeNull();
  });
});

describe('tapping a switch, a cover and a lock', () => {
  it('toggles a switch', async () => {
    const card = await mountCard();

    await act(card, 'light:fountain');

    expect(hass.serviceCalls[0]).toMatchObject({
      domain: 'switch',
      service: 'toggle',
    });
  });

  it('toggles a cover', async () => {
    const card = await mountCard();

    await act(card, 'door:garage-door');

    expect(hass.serviceCalls[0]).toMatchObject({
      domain: 'cover',
      service: 'toggle',
    });
    expect(sceneOf(card).overlay.doors['garage-door']).toBe(0);
  });

  it('asks before it unlocks a door', async () => {
    const card = await mountCard();

    await act(card, 'door:front-door');

    expect(hass.serviceCalls).toEqual([]);
    expect(mark(card, 'door:front-door')?.classList).toContain('armed');
  });

  it('unlocks on a second tap of the confirm target', async () => {
    const card = await mountCard();

    await act(card, 'door:front-door');
    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    mark(card, 'door:front-door')?.click();
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'lock',
        service: 'unlock',
        data: { entity_id: 'lock.front_door' },
      },
    ]);
  });

  it('unlocks on a second tap of the door itself', async () => {
    const card = await mountCard();

    await act(card, 'door:front-door');
    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await act(card, 'door:front-door');

    expect(hass.serviceCalls[0]?.service).toBe('unlock');
  });

  it('locks an unlocked door on one tap', async () => {
    const card = await mountCard();

    hass.setState('lock.front_door', 'unlocked');
    await publish(card);
    await act(card, 'door:front-door');

    expect(hass.serviceCalls[0]?.service).toBe('lock');
  });

  it('closes the confirm target after 4 seconds', async () => {
    const card = await mountCard();

    await act(card, 'door:front-door');
    vi.advanceTimersByTime(4000);
    await settle(card);
    await act(card, 'door:front-door');

    expect(hass.serviceCalls).toEqual([]);
    expect(mark(card, 'door:front-door')?.classList).toContain('armed');
  });
});

describe('a tap or a hold chosen for a thing', () => {
  function withActions(
    key: string,
    actions: Pick<SceneBinding, 'tap_action' | 'hold_action'>,
  ): SceneBinding[] {
    return bindings.map((binding) =>
      `${binding.scope.type}:${binding.scope.id}` === key
        ? { ...binding, ...actions }
        : binding,
    );
  }

  function listen(card: EstanzaCard): ReturnType<typeof vi.fn> {
    const opened = vi.fn();

    card.addEventListener('hass-more-info', (event) =>
      opened((event as CustomEvent).detail),
    );

    return opened;
  }

  it('asks before it opens a garage on a tap set to open, even when it is already part open', async () => {
    const card = await mountCard({
      bindings: withActions('door:garage-door', {
        tap_action: {
          action: 'perform-action',
          perform_action: 'cover.open_cover',
        },
      }),
    });

    await act(card, 'door:garage-door');

    expect(hass.serviceCalls).toEqual([]);

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await act(card, 'door:garage-door');

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'cover',
        service: 'open_cover',
        data: { entity_id: 'cover.garage' },
      },
    ]);
  });

  it('opens Home Assistant’s details of a light on a hold set to details', async () => {
    const card = await mountCard({
      bindings: withActions('light:kitchen-strip', {
        hold_action: { action: 'more-info' },
      }),
    });
    const opened = listen(card);

    await act(card, 'light:kitchen-strip', 'press');

    expect(opened).toHaveBeenCalledWith({ entityId: 'light.kitchen_strip' });
    expect(find(card, '.sheet')).toBeNull();
    expect(hass.serviceCalls).toEqual([]);
  });

  it('does nothing on a tap set to nothing', async () => {
    const card = await mountCard({
      bindings: withActions('light:kitchen-strip', {
        tap_action: { action: 'none' },
      }),
    });

    await act(card, 'light:kitchen-strip');

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('toggles a light on a hold set to toggle', async () => {
    const card = await mountCard({
      bindings: withActions('light:kitchen-strip', {
        hold_action: { action: 'toggle' },
      }),
    });

    await act(card, 'light:kitchen-strip', 'press');

    expect(hass.serviceCalls[0]).toMatchObject({
      domain: 'light',
      service: 'toggle',
    });
  });

  it('still asks before it unlocks on a tap set to unlock', async () => {
    const card = await mountCard({
      bindings: withActions('door:front-door', {
        tap_action: { action: 'perform-action', perform_action: 'lock.unlock' },
      }),
    });

    await act(card, 'door:front-door');

    expect(hass.serviceCalls).toEqual([]);

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await act(card, 'door:front-door');

    expect(hass.serviceCalls[0]?.service).toBe('unlock');
  });

  it('says a lock is already locked instead of asking to lock it again', async () => {
    const card = await mountCard({
      bindings: withActions('door:front-door', {
        tap_action: { action: 'perform-action', perform_action: 'lock.lock' },
      }),
    });

    await act(card, 'door:front-door');

    expect(hass.serviceCalls).toEqual([]);
    expect(mark(card, 'door:front-door')?.classList ?? []).not.toContain(
      'armed',
    );
    expect(find(card, '.toast')?.textContent).toContain('already locked');
  });

  it('opens a sensor-only door’s details when asked, and leaves it alone otherwise', async () => {
    const sensorDoor: SceneBinding = {
      scope: { type: 'door', id: 'hall-door' },
      entity_id: 'binary_sensor.front_door',
    };
    const plain = await mountCard({ bindings: [...bindings, sensorDoor] });

    await act(plain, 'door:hall-door');
    await act(plain, 'door:hall-door', 'press');

    expect(find(plain, '.toast')).toBeNull();

    document.body.replaceChildren();

    const card = await mountCard({
      bindings: [
        ...bindings,
        { ...sensorDoor, tap_action: { action: 'more-info' } },
      ],
    });
    const opened = listen(card);

    await act(card, 'door:hall-door');

    expect(opened).toHaveBeenCalledWith({
      entityId: 'binary_sensor.front_door',
    });
  });
});

describe('tapping a room', () => {
  it('opens the room sheet and never toggles on its own', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
  });

  it('shows the room humidity in the sheet', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(find(card, '.sheet .readout.humidity')?.textContent?.trim()).toBe(
      '47%',
    );
  });

  it('shows the room temperature the way its pill does, one decimal and no unit letter', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(find(card, '.sheet .readout.temperature')?.textContent?.trim()).toBe(
      '21.4°',
    );
  });

  it('switches the room lights with the one large toggle', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    find(card, '.sheet button[data-act="room-toggle"]')?.click();
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'turn_off',
        data: { entity_id: ['light.kitchen_ceiling', 'light.kitchen_strip'] },
      },
    ]);
    expect(sceneOf(card).overlay.rooms.kitchen?.on).toBe(false);
  });

  it('says on the light toggle whether the room lights are on', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(
      find(card, '.sheet button[data-act="room-toggle"]')?.textContent?.trim(),
    ).toBe('On');
  });

  it('opens the sheet of a room with no lights without a light toggle', async () => {
    const card = await mountCard({
      bindings: [
        ...bindings,
        { scope: { type: 'room', id: 'garage' }, area_id: 'garage' },
      ],
    });

    await act(card, 'room:garage');

    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
    expect(find(card, '.sheet button[data-act="room-toggle"]')).toBeNull();
    expect(find(card, '.toast')).toBeNull();
  });

  it('names a window after its room, never by its device', async () => {
    const card = await mountCard({
      bindings: [
        ...bindings,
        {
          scope: { type: 'room', id: 'study' },
          entity_ids: ['binary_sensor.study_window'],
        },
      ],
    });

    hass.states['binary_sensor.study_window'] = {
      ...mockBinarySensor('binary_sensor.study_window', 'window', true),
      attributes: {
        device_class: 'window',
        friendly_name: 'Aqara Door/Window Sensor - C - 1',
      },
    };
    await publish(card);
    await act(card, 'room:study');

    const row = find(card, '.sheet [data-row="window"]');

    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Study window Open',
    );
  });

  it('numbers two windows of one room in order, and leaves a lone door bare', async () => {
    const card = await mountCard({
      bindings: [
        ...bindings,
        {
          scope: { type: 'room', id: 'study' },
          entity_ids: [
            'binary_sensor.study_window_b',
            'binary_sensor.study_window_a',
            'binary_sensor.study_door',
          ],
        },
      ],
    });

    hass.states['binary_sensor.study_window_a'] = mockBinarySensor(
      'binary_sensor.study_window_a',
      'window',
      true,
    );
    hass.states['binary_sensor.study_window_b'] = mockBinarySensor(
      'binary_sensor.study_window_b',
      'window',
      false,
    );
    hass.states['binary_sensor.study_door'] = mockBinarySensor(
      'binary_sensor.study_door',
      'door',
      false,
    );
    await publish(card);
    await act(card, 'room:study');

    const rows = [
      ...(card.shadowRoot?.querySelectorAll('.sheet .openings .row') ?? []),
    ].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

    expect(rows).toEqual([
      'Door to outside Closed',
      'Study window 1 Open',
      'Study window 2 Closed',
    ]);
  });

  it('lists a window of the room open, and keeps it listed as shut once it shuts', async () => {
    const card = await mountCard({
      bindings: [
        ...bindings,
        {
          scope: { type: 'room', id: 'study' },
          entity_ids: ['binary_sensor.study_window'],
        },
      ],
    });

    hass.states['binary_sensor.study_window'] = mockBinarySensor(
      'binary_sensor.study_window',
      'window',
      true,
    );
    await publish(card);
    await act(card, 'room:study');

    expect(
      find(card, '.sheet [data-row="window"]')?.textContent?.trim(),
    ).not.toBe('');
    expect(
      find(card, '.sheet [data-row="window"] .row-state')?.textContent?.trim(),
    ).toBe('Open');

    hass.states['binary_sensor.study_window'] = mockBinarySensor(
      'binary_sensor.study_window',
      'window',
      false,
    );
    await publish(card);

    expect(
      find(card, '.sheet [data-row="window"] .row-state')?.textContent?.trim(),
    ).toBe('Closed');
  });

  it('puts the temperature, the humidity and the light on one line, wrapping only when full', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    const line = find(card, '.sheet .room-line');
    const title = find(card, '.sheet .sheet-title');

    expect(
      ['.readout.temperature', '.readout.humidity', '.lamp'].map(
        (selector) => find(card, `.sheet ${selector}`)?.parentElement,
      ),
    ).toEqual([line, line, line]);
    expect(title?.compareDocumentPosition(line as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(styleRules()).toMatch(
      /\.room-line \{[^}]*display: flex;[^}]*flex-wrap: wrap;/,
    );
    expect(styleRules()).not.toMatch(/\.room-line \{[^}]*flex-direction/);
  });

  it('lists the open doors and windows under that line, one to a row', async () => {
    const card = await mountCard();

    hass.states['binary_sensor.kitchen_window'] = mockBinarySensor(
      'binary_sensor.kitchen_window',
      'window',
      true,
    );
    await publish(card);
    await act(card, 'room:kitchen');

    const line = find(card, '.sheet .room-line');
    const row = find(card, '.sheet [data-row="window"]');

    expect(row).not.toBeNull();
    expect(row?.closest('.room-line')).toBeNull();
    expect(line?.compareDocumentPosition(row as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('lists a light linked in the room, lights first, with its own toggle', async () => {
    const card = await mountCard({
      home_document: homeFixture,
      bindings: [
        { scope: { type: 'room', id: 'living-space' }, area_id: 'garage' },
        { scope: { type: 'door', id: 'd2' }, entity_id: 'binary_sensor.d2' },
        {
          scope: { type: 'light', id: 'living-space-light' },
          entity_id: 'light.bedroom_ceiling',
        },
        {
          scope: { type: 'light', id: 'hall-light' },
          entity_id: 'light.kitchen_ceiling',
        },
      ],
    });

    hass.states['binary_sensor.d2'] = mockEntityState(
      'binary_sensor.d2',
      'on',
      { device_class: 'door' },
    );
    await publish(card);
    await act(card, 'room:living-space');

    const rows = [
      ...(card.shadowRoot?.querySelectorAll<HTMLElement>('.sheet [data-row]') ??
        []),
    ];
    const light = find(card, '.sheet [data-row="light"]');
    const toggle = light?.querySelector<HTMLButtonElement>(
      'button[data-act="device-toggle"]',
    );

    expect(rows.map((row) => row.dataset.row)).toEqual(['light', 'door']);
    expect(light?.dataset.key).toBe('light:living-space-light');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.textContent?.trim()).toBe('');

    toggle?.click();
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'toggle',
        data: { entity_id: 'light.bedroom_ceiling' },
      },
    ]);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();

    light?.querySelector<HTMLButtonElement>('.device-name')?.click();
    await settle(card);

    expect(find(card, '.sheet[data-kind="light"]')).not.toBeNull();
  });

  it('closes the room sheet from its close button', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    find(card, '.sheet button[data-act="close"]')?.click();
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
  });
});

describe('a docked room sheet', () => {
  it('has no size or padding of its own, so it matches a device sheet', () => {
    const own = [...styleRules().matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector, body]) =>
        /\.sheet\.room(?:\.bottom|:not\(\.bottom\))?\s*$/.test(selector) &&
        /(?:^|[\s;])(?:max-|min-)?(?:width|padding|gap):/.test(body),
    );

    expect(own.map(([, selector]) => selector.trim())).toEqual([]);
  });
});

describe('where a sheet opens on a card', () => {
  async function openOn(
    screen: number,
    card: { width: number; height: number },
  ): Promise<HTMLElement | null> {
    vi.stubGlobal('innerWidth', screen);

    const mounted = await mountCard();
    const stage = find(mounted, '.stage');

    if (!stage) throw new Error('no stage');

    vi.spyOn(stage, 'clientWidth', 'get').mockReturnValue(card.width);
    vi.spyOn(stage, 'clientHeight', 'get').mockReturnValue(card.height);
    await act(mounted, 'room:kitchen');
    await settle(mounted);

    return find(mounted, '.sheet');
  }

  it('docks the sheet inside a card narrower than 500 px on a wide screen', async () => {
    const sheet = await openOn(1280, { width: 498, height: 600 });
    const left = parseFloat(sheet?.style.left ?? 'NaN');
    const top = parseFloat(sheet?.style.top ?? 'NaN');

    expect(sheet?.classList).not.toContain('bottom');
    expect(left).toBeGreaterThanOrEqual(16);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(left + 260).toBeLessThanOrEqual(498 - 16);
    expect(top + 132).toBeLessThanOrEqual(600 - 16);
  });

  it('holds the docked sheet still while the view moves the room out from under it', async () => {
    const sheet = await openOn(1280, { width: 498, height: 600 });
    const before = [sheet?.style.left, sheet?.style.top];
    const card = document.querySelector('estanza-card');

    if (!card) throw new Error('no card');

    vi.spyOn(sceneOf(card), 'roomFootprints').mockReturnValue(
      new Map([
        [
          'kitchen',
          {
            floor: [
              { x: 300, y: 380 },
              { x: 420, y: 380 },
              { x: 420, y: 480 },
              { x: 300, y: 480 },
            ],
            top: [],
          },
        ],
      ]),
    );
    await publish(card);

    const after = find(card, '.sheet');

    expect([after?.style.left, after?.style.top]).toEqual(before);
  });

  it('keeps the bottom sheet for a narrow screen', async () => {
    const sheet = await openOn(390, { width: 390, height: 700 });

    expect(sheet?.classList).toContain('bottom');
  });

  it('docks and caps the sheet on a card too short to hold it', async () => {
    const sheet = await openOn(1280, { width: 498, height: 150 });

    expect(sheet?.classList).not.toContain('bottom');
    expect(sheet?.style.maxHeight).toBe('118px');
  });
});

describe('a bottom sheet on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390);
  });

  it('spans the whole card, in a wall tablet panel too', () => {
    const fixed = [...styleRules().matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector, body]) =>
        /\.sheet(?:\.[\w-]+)*\s*$/.test(selector) &&
        /(?:^|[\s;])width: \d/.test(body) &&
        selector.trim() !== '.sheet' &&
        !selector.includes('::') &&
        !selector.includes(':not(.bottom)'),
    );

    expect(fixed.map(([, selector]) => selector.trim())).toEqual([]);
  });

  it('keeps the view and floor controls shown above it while it is open', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(find(card, '.stage')?.classList).toContain('sheet-up');
    expect(styleRules()).not.toMatch(
      /(?<!\.undrawn )\.dock \{[^}]*visibility: hidden;/,
    );
    expect(styleRules()).toMatch(
      /\.stage\.sheet-up \.dock \{[^}]*max-height: calc\(100% - 24px - var\(--ez-sheet-rise, 0px\)\);/,
    );

    find(card, '.sheet button[data-act="close"]')?.click();
    await settle(card);

    expect(find(card, '.stage')?.classList).not.toContain('sheet-up');
  });

  it('keeps clear of the safe area at the foot of the screen', () => {
    expect(styleRules()).toMatch(
      /\.sheet\.bottom \{[^}]*padding: 16px 12px calc\( ?12px \+ env\(safe-area-inset-bottom, 0px\) ?\);/,
    );
  });

  it('keeps the token padding under its last row as well as the safe area', async () => {
    const card = await mountCard();

    hass.states['binary_sensor.kitchen_window'] = mockBinarySensor(
      'binary_sensor.kitchen_window',
      'window',
      false,
    );
    await publish(card);
    await act(card, 'room:kitchen');

    expect(find(card, '.sheet.bottom')?.classList).toContain('rows');
    expect(styleRules()).not.toMatch(/\.sheet[.\w]*\.rows \{[^}]*padding/);
  });

  it('moves a toast above it so the retry stays reachable', () => {
    expect(styleRules()).toMatch(
      /\.stage\.sheet-up \.toast \{[^}]*top: 14px;[^}]*bottom: auto;/,
    );
  });
});

describe('marks near an open sheet on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390);
  });

  function sheetAt(top: number, bottom: number): void {
    const measure = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (!this.classList.contains('sheet')) return measure.call(this);

        return new DOMRect(0, top, 390, bottom - top);
      },
    );
  }

  it('hides a mark that the sheet would cover, and brings it back on close', async () => {
    const card = await mountCard();

    sheetAt(60, 300);
    await act(card, 'light:kitchen-strip', 'press');
    await publish(card);

    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('under');

    find(card, '.sheet button[data-act="close"]')?.click();
    await publish(card);

    expect(find(card, '.mark.under')).toBeNull();
  });

  it('keeps the mark of the thing it is about when the sheet is clear of it', async () => {
    const card = await mountCard();

    sheetAt(500, 750);
    await act(card, 'light:kitchen-strip', 'press');
    await publish(card);

    const shown = mark(card, 'light:kitchen-strip');

    expect(shown).not.toBeNull();
    expect(shown?.classList).not.toContain('under');
  });

  it('fades a hidden mark out and lets taps through', () => {
    expect(styleRules()).toMatch(
      /\.mark\.under \{[^}]*opacity: 0;[^}]*pointer-events: none;/,
    );
  });
});

describe('closing a sheet', () => {
  function pointer(card: EstanzaCard, type: string, x: number, y: number) {
    sceneOf(card).dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        composed: true,
        clientX: x,
        clientY: y,
      }),
    );
  }

  it('closes on Escape', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
  });

  it('closes on a tap on empty scene', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    pointer(card, 'pointerdown', 300, 200);
    pointer(card, 'pointerup', 302, 201);
    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
  });

  it('stays open for a tap that lands on something', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    pointer(card, 'pointerdown', 300, 200);
    await act(card, 'light:kitchen-strip', 'press');
    pointer(card, 'pointerup', 300, 200);
    await settle(card);

    expect(find(card, '.sheet[data-kind="light"]')).not.toBeNull();
  });

  it('stays open while the view is dragged', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');
    pointer(card, 'pointerdown', 300, 200);
    pointer(card, 'pointerup', 380, 240);
    await settle(card);

    expect(find(card, '.sheet')).not.toBeNull();
  });
});

describe('holding a light', () => {
  it('opens our own sheet with a brightness bar in the bulb colour', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip', 'press');

    const fill = find(card, '.sheet[data-kind="light"] .bar .fill');

    expect(hass.serviceCalls).toEqual([]);
    expect(fill?.style.background).toBe('rgb(255, 110, 168)');
    expect(fill?.style.width).toBe('35%');
  });

  it('rings the object while its sheet is open', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip', 'press');

    expect(mark(card, 'light:kitchen-strip')?.classList).toContain('selected');
  });

  it('sets the brightness from the bar', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip', 'press');

    const bar = find(card, '.sheet input[type="range"]') as HTMLInputElement;

    bar.value = '60';
    bar.dispatchEvent(new Event('change'));
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'turn_on',
        data: { entity_id: 'light.kitchen_strip', brightness_pct: 60 },
      },
    ]);
  });

  it('opens the Home Assistant dialog from the ellipsis', async () => {
    const card = await mountCard();
    const opened = vi.fn();

    card.addEventListener('hass-more-info', (event) =>
      opened((event as CustomEvent).detail),
    );
    await act(card, 'light:kitchen-strip', 'press');
    find(card, '.sheet button[data-act="more"]')?.click();

    expect(opened).toHaveBeenCalledWith({ entityId: 'light.kitchen_strip' });
  });

  it('keeps warm colour for lights, never an open cover', async () => {
    const card = await mountCard();

    await act(card, 'door:garage-door', 'press');

    expect(mark(card, 'door:garage-door')?.classList).not.toContain('on');
  });

  it('opens a cover sheet with a position bar', async () => {
    const card = await mountCard();

    await act(card, 'door:garage-door', 'press');

    expect(
      find(card, '.sheet[data-kind="cover"] input[type="range"]'),
    ).not.toBeNull();
  });
});

describe('sheet headings', () => {
  it('names the room as the home document does', async () => {
    const card = await mountCard({
      home_document: homeFixture,
      bindings: [
        ...bindings,
        { scope: { type: 'room', id: 'bathroom' }, area_id: 'kitchen' },
      ],
    });

    await act(card, 'room:bathroom');

    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(
      'Bathroom',
    );
  });

  it('falls back to the area name without a home document', async () => {
    const card = await mountCard();

    await act(card, 'room:kitchen');

    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(
      'Kitchen',
    );
  });

  it('names a light by its entity', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip', 'press');

    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(
      hass.states['light.kitchen_strip']?.attributes.friendly_name,
    );
  });

  it('names a light with no entity name by its label in the home', async () => {
    const labelled = structuredClone(homeFixture);

    labelled.additions.lights = labelled.additions.lights.map((light) =>
      light.slug === 'bathroom-light'
        ? { ...light, label: 'Mirror lamp' }
        : light,
    );

    const card = await mountCard({
      home_document: labelled,
      bindings: [
        {
          scope: { type: 'light', id: 'bathroom-light' },
          entity_id: 'light.kitchen_strip',
        },
      ],
    });
    const strip = hass.states['light.kitchen_strip'];

    hass.states['light.kitchen_strip'] = {
      ...strip,
      attributes: { ...strip.attributes, friendly_name: undefined },
    };
    await publish(card);
    await act(card, 'light:bathroom-light', 'press');

    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(
      'Mirror lamp',
    );
  });

  it('names a light by the home alone, with no entity name below', async () => {
    const labelled = structuredClone(homeFixture);

    labelled.additions.lights = labelled.additions.lights.map((light) =>
      light.slug === 'bathroom-light'
        ? { ...light, label: 'Suite bedside' }
        : light,
    );

    const card = await mountCard({
      home_document: labelled,
      bindings: [
        {
          scope: { type: 'light', id: 'bathroom-light' },
          entity_id: 'light.kitchen_strip',
        },
      ],
    });

    await act(card, 'light:bathroom-light', 'press');

    expect(find(card, '.sheet .sheet-names')?.textContent?.trim()).toBe(
      'Suite bedside',
    );
  });

  it('names a door by the rooms it joins even when its device has a name', async () => {
    const card = await mountCard({
      home_document: homeFixture,
      bindings: [
        { scope: { type: 'door', id: 'd1' }, entity_id: 'cover.patio' },
      ],
    });

    hass.states['cover.patio'] = mockEntityState('cover.patio', 'closed', {
      device_class: 'door',
      current_position: 0,
      friendly_name: 'Aqara Door/Window Sensor - C - 2',
    });
    await publish(card);
    await act(card, 'door:d1', 'press');

    expect(find(card, '.sheet .sheet-names')?.textContent?.trim()).toBe(
      'Door between Living Space and Bathroom',
    );
    expect(mark(card, 'door:d1')?.getAttribute('aria-label')).toBe(
      'Door between Living Space and Bathroom',
    );
  });

  it('names a door with no entity name by the rooms it joins, never by its id', async () => {
    const card = await mountCard({
      home_document: homeFixture,
      bindings: [
        { scope: { type: 'door', id: 'd1' }, entity_id: 'cover.patio' },
      ],
    });

    hass.states['cover.patio'] = mockEntityState('cover.patio', 'closed', {
      device_class: 'door',
      current_position: 0,
    });
    await publish(card);
    await act(card, 'door:d1', 'press');

    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(
      'Door between Living Space and Bathroom',
    );
    expect(mark(card, 'door:d1')?.getAttribute('aria-label')).toBe(
      'Door between Living Space and Bathroom',
    );
  });

  it('keeps the controls icon-only', async () => {
    const card = await mountCard();

    await act(card, 'light:kitchen-strip', 'press');

    const buttons = card.shadowRoot?.querySelectorAll('.sheet button') ?? [];

    for (const button of buttons) {
      expect(button.textContent?.trim()).toBe('');
    }
  });
});

describe('read only', () => {
  it('tells the scene not to answer taps', async () => {
    const card = await mountCard({ interaction: 'none' });

    expect(sceneOf(card).interactive).toBe(false);
  });

  it('calls nothing even if a tap arrives', async () => {
    const card = await mountCard({ interaction: 'none' });

    await act(card, 'light:kitchen-strip');
    await act(card, 'room:kitchen', 'press');

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).toBeNull();
    expect(find(card, '.mark')).toBeNull();
  });

  it('lets the scene answer taps by default', async () => {
    const card = await mountCard();

    expect(sceneOf(card).interactive).toBe(true);
  });
});
