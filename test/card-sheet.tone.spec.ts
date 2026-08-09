import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { controlStyles } from '../src/control-view.js';
import type { Point } from '../src/gesture.js';
import type { HassEntityState } from '../src/hass-state.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockCover,
  mockEntityState,
  mockLight,
  mockLock,
  mockSwitch,
} from './mock-hass.js';

const STAGE = { width: 900, height: 600, viewport: 1280 };
const ROOM = 'room:living-space';

type Thing = {
  kind: string;
  key: string;
  row: string;
  on: HassEntityState[];
  off: HassEntityState[];
  tone: string;
  offTone: string | null;
};

const things: Thing[] = [
  {
    kind: 'light',
    key: 'light:living-space-light',
    row: '.device[data-key="light:living-space-light"]',
    on: [mockLight('light.living', { on: true })],
    off: [mockLight('light.living', { on: false })],
    tone: 'lamp',
    offTone: null,
  },
  {
    kind: 'switch (the TV plug)',
    key: 'prop:tv',
    row: '.device[data-key="prop:tv"]',
    on: [mockSwitch('switch.tv', true)],
    off: [mockSwitch('switch.tv', false)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'window',
    key: 'window:win1',
    row: '.readout.row[data-key="window:win1"]',
    on: [mockBinarySensor('binary_sensor.win1', 'window', true)],
    off: [mockBinarySensor('binary_sensor.win1', 'window', false)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'door',
    key: 'door:d2',
    row: '.readout.row[data-key="door:d2"]',
    on: [mockBinarySensor('binary_sensor.d2', 'door', true)],
    off: [mockBinarySensor('binary_sensor.d2', 'door', false)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'lock',
    key: 'door:d1',
    row: '.readout.row[data-key="door:d1"]',
    on: [
      mockBinarySensor('binary_sensor.d1', 'door', false),
      mockLock('lock.d1', 'unlocked'),
    ],
    off: [
      mockBinarySensor('binary_sensor.d1', 'door', false),
      mockLock('lock.d1', 'locked'),
    ],
    tone: 'accent',
    offTone: 'lock',
  },
  {
    kind: 'garage cover',
    key: 'door:d3',
    row: '.readout.row[data-key="door:d3"]',
    on: [mockCover('cover.garage', 40)],
    off: [mockCover('cover.garage', 0)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'blind cover',
    key: 'prop:blind',
    row: '.device[data-key="prop:blind"]',
    on: [blind('open', 60)],
    off: [blind('closed', 0)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'binary sensor',
    key: 'prop:motion',
    row: '.device[data-key="prop:motion"]',
    on: [mockBinarySensor('binary_sensor.motion', 'motion', true)],
    off: [mockBinarySensor('binary_sensor.motion', 'motion', false)],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'TV media player',
    key: 'prop:player',
    row: '.device[data-key="prop:player"]',
    on: [
      mockEntityState('media_player.tv', 'playing', { friendly_name: 'TV' }),
    ],
    off: [mockEntityState('media_player.tv', 'idle', { friendly_name: 'TV' })],
    tone: 'accent',
    offTone: null,
  },
  {
    kind: 'alarm',
    key: 'prop:alarm',
    row: '.device[data-key="prop:alarm"]',
    on: [alarm('armed_away')],
    off: [alarm('disarmed')],
    tone: 'accent',
    offTone: null,
  },
];

const openings = things.filter((thing) => thing.row.startsWith('.readout'));

const bindings: SceneBinding[] = [
  { scope: { type: 'room', id: 'living-space' }, entity_id: 'light.living' },
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  { scope: { type: 'prop', id: 'tv' }, entity_id: 'switch.tv' },
  { scope: { type: 'window', id: 'win1' }, entity_id: 'binary_sensor.win1' },
  { scope: { type: 'door', id: 'd2' }, entity_id: 'binary_sensor.d2' },
  {
    scope: { type: 'door', id: 'd1' },
    entity_ids: ['binary_sensor.d1', 'lock.d1'],
  },
  { scope: { type: 'door', id: 'd3' }, entity_id: 'cover.garage' },
  { scope: { type: 'prop', id: 'blind' }, entity_id: 'cover.blind' },
  {
    scope: { type: 'prop', id: 'motion' },
    entity_id: 'binary_sensor.motion',
    tap_action: { action: 'more-info' },
  },
  {
    scope: { type: 'prop', id: 'player' },
    entity_id: 'media_player.tv',
    tap_action: { action: 'more-info' },
  },
  {
    scope: { type: 'prop', id: 'alarm' },
    entity_id: 'alarm_control_panel.house',
    tap_action: { action: 'more-info' },
  },
];

const spots: Record<string, Point> = Object.fromEntries(
  things.map((thing, index) => [
    thing.key,
    { x: 60 + (index % 4) * 110, y: 80 + Math.floor(index / 4) * 110 },
  ]),
);

function blind(state: string, position: number): HassEntityState {
  return mockEntityState('cover.blind', state, {
    device_class: 'blind',
    current_position: position,
    friendly_name: 'Blind',
  });
}

function alarm(state: string): HassEntityState {
  return mockEntityState('alarm_control_panel.house', state, {
    friendly_name: 'House alarm',
  });
}

function prop(slug: string) {
  return {
    slug,
    type: 'catalog',
    catalogId: 'desk',
    room: 'living-space',
    at: [100, 100],
    rotation: 0,
    width: 40,
    depth: 40,
  };
}

function home() {
  const [ground, ...upper] = homeFixture.plan.floors;
  const win1 = {
    id: 'win1',
    wallId: 'w1',
    position: 0.3,
    width: 100,
    height: 120,
    sillHeight: 90,
    type: 'standard',
  };
  const d3 = {
    id: 'd3',
    wallId: 'w4',
    position: 0.5,
    width: 240,
    height: 205,
  };

  return homeDocumentSchema.parse({
    ...homeFixture,
    plan: {
      ...homeFixture.plan,
      floors: [
        { ...ground, windows: [win1], doors: [...ground.doors, d3] },
        ...upper,
      ],
    },
    additions: {
      ...homeFixture.additions,
      props: ['tv', 'blind', 'motion', 'player', 'alarm'].map(prop),
    },
  });
}

function anchorAt(scope: SceneScope): Point | null {
  const key = scopeKey(scope);

  return Object.hasOwn(spots, key) ? spots[key] : null;
}

async function mountCard(state: 'on' | 'off'): Promise<EstanzaCard> {
  vi.stubGlobal('innerWidth', STAGE.viewport);

  const card = document.createElement('estanza-card');

  card.hass = createMockHass({
    states: things.flatMap((thing) => thing[state]),
  });
  card.setConfig({ type: cardType, home_document: home(), bindings });
  document.body.append(card);
  await settle(card);

  const stage = card.shadowRoot?.querySelector<HTMLElement>('.stage');

  if (!stage) throw new Error('no stage');

  vi.spyOn(stage, 'clientWidth', 'get').mockReturnValue(STAGE.width);
  vi.spyOn(stage, 'clientHeight', 'get').mockReturnValue(STAGE.height);
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

async function openRoom(card: EstanzaCard): Promise<void> {
  const [scopeType, scopeId] = ROOM.split(':');
  const surface =
    card.shadowRoot?.querySelector('estanza-plan-view') ??
    card.shadowRoot?.querySelector('estanza-scene-view');

  surface?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture: 'press', x: 700, y: 500 },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
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

function markTone(card: EstanzaCard, key: string): string | null | undefined {
  const mark = card.shadowRoot?.querySelector(`.mark[data-key="${key}"]`);

  if (!mark) return undefined;

  return mark.getAttribute('data-tone');
}

function rowTone(
  card: EstanzaCard,
  selector: string,
): string | null | undefined {
  const row = card.shadowRoot?.querySelector(`.sheet ${selector}`);

  if (!row) return undefined;

  return row.querySelector('[data-tone]')?.getAttribute('data-tone') ?? null;
}

function tones(card: EstanzaCard, state: 'on' | 'off') {
  return things.map((thing) => ({
    kind: thing.kind,
    mark: markTone(card, thing.key),
    row: rowTone(card, thing.row),
    wanted: state === 'on' ? thing.tone : thing.offTone,
  }));
}

function expectAgreement(card: EstanzaCard, state: 'on' | 'off'): void {
  for (const seen of tones(card, state)) {
    expect(seen, seen.kind).toEqual({
      ...seen,
      mark: seen.wanted,
      row: seen.wanted,
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 28, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

  for (const surface of [EstanzaSceneView, EstanzaPlanView]) {
    vi.spyOn(surface.prototype, 'anchorOf').mockImplementation(anchorAt);
  }
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a room sheet row and the mark of the same thing', () => {
  it('share the active tone of every kind in 3D', async () => {
    const card = await mountCard('on');

    await openRoom(card);
    expectAgreement(card, 'on');
  });

  it('share the resting tone of every kind in 3D', async () => {
    const card = await mountCard('off');

    await openRoom(card);

    for (const seen of tones(card, 'off')) {
      expect(seen.row, seen.kind).toBe(seen.wanted);

      if (seen.mark !== undefined)
        expect(seen.mark, seen.kind).toBe(seen.wanted);
    }
  });

  it('share the active tone of every kind on the plan', async () => {
    const card = await mountCard('on');

    await showPlan(card);
    await openRoom(card);
    expectAgreement(card, 'on');
  });
});

describe('the icon of a door or window row', () => {
  function drawnIcon(element: Element | null | undefined): string | null {
    return element?.querySelector('.icon')?.innerHTML.trim() ?? null;
  }

  it('is the icon its open mark draws, garage door included', async () => {
    const card = await mountCard('on');

    await openRoom(card);

    for (const thing of openings) {
      const root = card.shadowRoot;
      const mark = drawnIcon(
        root?.querySelector(`.mark[data-key="${thing.key}"] .disc`),
      );
      const row = drawnIcon(
        root?.querySelector(`.sheet ${thing.row} .row-icon`),
      );

      expect(mark, thing.kind).not.toBeNull();
      expect(row, thing.kind).toBe(mark);
    }
  });
});

describe('the colour of a tone', () => {
  const css = controlStyles.cssText.replace(/\s+/g, ' ');

  function background(selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css)?.[1];

    return /background: ([^;]+);/.exec(block ?? '')?.[1] ?? null;
  }

  it.each(['lamp', 'accent', 'lock'])(
    'paints the %s disc of a mark and of a row the same',
    (tone) => {
      const mark = background(`.mark[data-tone='${tone}'] .disc`);

      expect(mark).not.toBeNull();
      expect(background(`[data-tone='${tone}'] .lamp-icon`)).toBe(mark);
    },
  );
});
