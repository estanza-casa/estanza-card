import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { CONFIRM_GAP_MS } from '../src/control.js';
import { controlStyles } from '../src/control-view.js';
import { LONG_PRESS_MS, type Point } from '../src/gesture.js';
import { LABEL_HEIGHT, labelWidth } from '../src/living.js';
import { TOUCH_PX } from '../src/mark-layout.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockCover,
  mockEntityState,
  type MockHass,
  mockLight,
  mockSensor,
  mockSwitch,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const SPOT = { x: 200, y: 200 };
const LAMPS = 12;
const DISC_PX = Number(
  /\.mark \.disc \{[^}]*width: (\d+)px/.exec(controlStyles.cssText)?.[1],
);

const lamps = Array.from({ length: LAMPS }, (_, index) => `lamp-${index}`);

function crowdedHome(windows: readonly string[]) {
  const draft = structuredClone(homeFixture);

  draft.additions.lights.push(
    ...lamps.map((slug) => ({
      slug,
      room: 'living-space',
      style: 'flush',
      color: '#ffd4ab',
      on: false,
    })),
  );

  Object.assign(draft.plan.floors[0], {
    windows: windows.map((id, index) => ({
      id,
      wallId: index % 2 === 0 ? 'w1' : 'w4',
      position: 0.1 + (Math.floor(index / 2) % 9) * 0.1,
      width: 20,
      height: 120,
      sillHeight: 90,
    })),
  });

  return homeDocumentSchema.parse(draft);
}

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.door_d1' },
  { scope: { type: 'door', id: 'd2' }, entity_id: 'cover.door_d2' },
  ...lamps.map((slug) => ({
    scope: { type: 'light' as const, id: slug },
    entity_id: `light.${slug.replace('-', '_')}`,
  })),
];

const roomBinding: SceneBinding = {
  scope: { type: 'room', id: 'living-space' },
  temperature_entity_id: 'sensor.living_temperature',
};

type MountOptions = {
  d1Open?: boolean;
  d2Position?: number;
  room?: boolean;
  plug?: boolean;
  neighbours?: boolean;
  windows?: number;
};

const plugBinding: SceneBinding = {
  scope: { type: 'prop', id: 'tv-plug' },
  entity_id: 'switch.tv_plug',
};

const neighbours = ['bathroom-light', 'hall-light'];

const neighbourBindings: SceneBinding[] = neighbours.map((slug) => ({
  scope: { type: 'light', id: slug },
  entity_id: `light.${slug.replace('-', '_')}`,
}));

function windowIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `n${index + 1}`);
}

function windowBindings(count: number): SceneBinding[] {
  return windowIds(count).map((id) => ({
    scope: { type: 'window', id },
    entity_id: `binary_sensor.window_${id}`,
  }));
}

let hass: MockHass;

async function mountCard(options: MountOptions = {}): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');
  const windows = options.windows ?? 0;

  hass = createMockHass({
    states: [
      mockLight('light.living', { on: false }),
      mockBinarySensor(
        'binary_sensor.door_d1',
        'door',
        options.d1Open ?? false,
      ),
      mockCover('cover.door_d2', options.d2Position ?? 0),
      mockSensor('sensor.living_temperature', 'temperature', 21.4, '°C'),
      ...lamps.map((slug) =>
        mockLight(`light.${slug.replace('-', '_')}`, { on: false }),
      ),
      mockSwitch('switch.tv_plug', true),
      ...neighbours.map((slug) =>
        mockLight(`light.${slug.replace('-', '_')}`, { on: false }),
      ),
      ...windowIds(windows).map((id) =>
        mockBinarySensor(`binary_sensor.window_${id}`, 'window', true),
      ),
    ],
  });
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: crowdedHome(windowIds(windows)),
    bindings: [
      ...bindings,
      ...(options.room ? [roomBinding] : []),
      ...(options.plug ? [plugBinding] : []),
      ...(options.neighbours ? neighbourBindings : []),
      ...windowBindings(windows),
    ],
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
  }
}

function press(
  element: HTMLElement | null,
  type: string,
  at: Point,
  pointerType = 'touch',
): void {
  element?.dispatchEvent(
    Object.assign(
      new MouseEvent(type, {
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        composed: true,
      }),
      { pointerType, isPrimary: true },
    ),
  );
}

function click(element: HTMLElement | null, at: Point): void {
  element?.dispatchEvent(
    new MouseEvent('click', {
      clientX: at.x,
      clientY: at.y,
      bubbles: true,
      composed: true,
      detail: 1,
    }),
  );
}

function screenThatHovers(hovers: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(hover: none)' && !hovers,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function placeIn3d(where: Record<string, Point>): void {
  const at = (scope: SceneScope): Point | null =>
    Object.hasOwn(where, scopeKey(scope)) ? where[scopeKey(scope)] : null;

  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(at);
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
  );
}

function crowdStorey(): void {
  vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
    (slugs) =>
      new Map(slugs.map((slug) => [slug, { x: SPOT.x, y: SPOT.y + 32 }])),
  );
  vi.spyOn(EstanzaSceneView.prototype, 'balconyBoxes').mockReturnValue([
    { ...SPOT, width: 2000, height: 2000 },
  ]);
}

function markup(element: Element | null): string {
  return element?.innerHTML.replace(/<!--.*?-->/g, '').trim() ?? '';
}

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function all(card: EstanzaCard, selector: string): HTMLElement[] {
  return [...(card.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}

function spotOf(element: HTMLElement | null): Point {
  return {
    x: parseFloat(element?.style.left ?? 'NaN'),
    y: parseFloat(element?.style.top ?? 'NaN'),
  };
}

function sceneOf(card: EstanzaCard): EstanzaSceneView {
  const scene = card.shadowRoot?.querySelector('estanza-scene-view');

  if (!scene) throw new Error('no scene');

  Object.assign(scene, {
    sceneState: {
      size: { width: 400, height: 400 },
      camera: new PerspectiveCamera(),
      gl: {},
      scene: {
        children: [],
        updateMatrixWorld: () => undefined,
        traverse: () => undefined,
      },
      raycaster: {
        setFromCamera: () => undefined,
        intersectObjects: () => [],
      },
      get() {
        return this;
      },
    },
  });

  return scene;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 24, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marks laid out on the 3D view', () => {
  it('moves an open door out from under a light glyph and leads it back to its door', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard({ d2Position: 50 });

    const light = spotOf(
      find(card, '.mark[data-key="light:living-space-light"]'),
    );
    const door = spotOf(find(card, '.mark[data-key="door:d2"]'));

    expect(light).toEqual(SPOT);
    expect(
      Math.abs(door.x - light.x) >= TOUCH_PX ||
        Math.abs(door.y - light.y) >= TOUCH_PX,
    ).toBe(true);
    expect(find(card, '.mark-leader[data-key="door:d2"]')).not.toBeNull();
  });

  it('keeps the mark of a light or door the house hides from the eye', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 120, y: SPOT.y },
    });
    vi.spyOn(EstanzaSceneView.prototype, 'outOfSight').mockImplementation(
      (scope) => scopeKey(scope) !== 'door:d2',
    );

    const card = await mountCard();

    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
    expect(find(card, '.mark[data-key="door:d2"]')).not.toBeNull();
  });

  it('keeps the mark of the light whose sheet is open, even once the house hides it', async () => {
    placeIn3d({ 'light:living-space-light': SPOT });

    const card = await mountCard();
    const mark = find(card, '.mark[data-key="light:living-space-light"]');

    press(mark, 'pointerdown', SPOT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press(mark, 'pointerup', SPOT);
    await settle(card);

    expect(find(card, '.sheet')).not.toBeNull();

    vi.spyOn(EstanzaSceneView.prototype, 'outOfSight').mockReturnValue(true);
    card.requestUpdate();
    await settle(card);

    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
  });

  it('keeps a shut door under a light glyph where it sits, with no leader and no bubble', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard();

    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
    expect(find(card, '.mark[data-key="door:d2"]')).not.toBeNull();
    expect(find(card, '.mark-leader')).toBeNull();
    expect(find(card, '.bubble')).toBeNull();
  });

  it('never gives two shut doors that meet a bubble of their own', async () => {
    placeIn3d({
      'door:d1': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard();

    expect(all(card, '.mark.dot').map((mark) => mark.dataset.key)).toEqual([
      'door:d1',
      'door:d2',
    ]);
    expect(find(card, '.mark-leader')).toBeNull();
    expect(find(card, '.bubble')).toBeNull();
  });

  it('lists a hidden shut door in its room sheet and opens it from there with the same confirm', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard({ room: true });

    find(card, 'estanza-scene-view')?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: 'living-space',
          gesture: 'press',
          x: 120,
          y: 120,
        },
      }),
    );
    await settle(card);

    const row = find(card, '.sheet .row[data-key="door:d2"]');

    expect(row?.textContent).toContain('Closed');

    row?.click();
    await settle(card);

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
    expect(
      find(card, '.sheet .row[data-key="door:d2"]')?.classList.contains(
        'armed',
      ),
    ).toBe(true);

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    find(card, '.sheet .row[data-key="door:d2"]')?.click();
    await settle(card);

    expect(hass.serviceCalls.map((call) => call.service)).toEqual(['toggle']);
    expect(find(card, '.sheet[data-kind="room"]')).not.toBeNull();
  });

  it('names each door in its room sheet as its own mark does, never by its id', async () => {
    placeIn3d({
      'door:d1': { x: 60, y: 60 },
      'door:d2': { x: 300, y: 300 },
    });

    const card = await mountCard({ room: true, d1Open: true, d2Position: 50 });
    const own = ['d1', 'd2'].map((door) =>
      find(card, `.mark[data-key="door:${door}"]`)?.getAttribute('aria-label'),
    );

    find(card, 'estanza-scene-view')?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: 'living-space',
          gesture: 'press',
          x: 120,
          y: 120,
        },
      }),
    );
    await settle(card);

    const rows = ['d1', 'd2'].map((door) =>
      find(card, `.sheet .row[data-key="door:${door}"]`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    );

    expect(own.every(Boolean)).toBe(true);
    expect(own.join(' ')).not.toMatch(/\bd[12]\b/);
    expect(rows).toEqual([`${own[0]} Open`, `${own[1]} Open`]);
  });

  it('lists every door of the room in its sheet, drawn or hidden, in plan order', async () => {
    const rowsWith = async (where: Record<string, Point>) => {
      vi.restoreAllMocks();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      placeIn3d(where);

      const card = await mountCard({ room: true });

      find(card, 'estanza-scene-view')?.dispatchEvent(
        new CustomEvent('scope-select', {
          detail: {
            scopeType: 'room',
            scopeId: 'living-space',
            gesture: 'press',
            x: 120,
            y: 120,
          },
        }),
      );
      await settle(card);

      const keys = all(card, '.sheet .row').map((row) => row.dataset.key);

      card.remove();

      return keys;
    };

    const drawn = await rowsWith({
      'door:d1': { x: 80, y: 300 },
      'door:d2': SPOT,
    });
    const hidden = await rowsWith({
      'light:living-space-light': SPOT,
      'door:d1': { x: SPOT.x - 8, y: SPOT.y + 3 },
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    expect(drawn).toEqual(['door:d1', 'door:d2']);
    expect(hidden).toEqual(drawn);
  });

  it('never lets two marks other than shut doors overlap after projection', async () => {
    placeIn3d(
      Object.fromEntries([
        ['light:living-space-light', SPOT],
        ['door:d1', { x: SPOT.x - 8, y: SPOT.y + 3 }],
        ['door:d2', { x: SPOT.x + 6, y: SPOT.y + 4 }],
        ...lamps.map((slug, index) => [
          `light:${slug}`,
          { x: SPOT.x + (index % 4) * 3, y: SPOT.y + index },
        ]),
      ]),
    );

    const card = await mountCard();

    const shown = all(card, '.mark:not(.dot), .bubble').map(spotOf);

    expect(all(card, '.mark.dot')).toHaveLength(2);

    for (const [index, one] of shown.entries()) {
      for (const other of shown.slice(index + 1)) {
        expect(
          Math.abs(one.x - other.x) >= TOUCH_PX - 0.01 ||
            Math.abs(one.y - other.y) >= TOUCH_PX - 0.01,
        ).toBe(true);
      }
    }
  });

  it('folds the marks that cannot move clear into a count bubble with their icon', async () => {
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    const bubble = find(card, '.bubble');
    const shown = all(card, '.mark[data-key^="light:lamp-"]').length;

    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('.icon')).not.toBeNull();
    expect(Number(bubble?.textContent?.trim())).toBe(LAMPS - shown);
    expect(bubble?.getAttribute('aria-label')).toBe(`${LAMPS - shown} lights`);
  });

  it('opens a chooser from the bubble that lists each folded mark', async () => {
    vi.stubGlobal('innerWidth', 390);
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    const bubble = find(card, '.bubble');
    const count = Number(bubble?.textContent?.trim());

    bubble?.click();
    await settle(card);

    const chooser = find(card, '.sheet.chooser');

    expect(chooser).not.toBeNull();
    expect(chooser?.classList).toContain('bottom');
    expect(all(card, '.sheet.chooser .choice')).toHaveLength(count);
    expect(find(card, '.sheet.chooser .sheet-title')?.textContent?.trim()).toBe(
      `${count} lights`,
    );
  });

  it('marks the bubble that opened the chooser while it is open', async () => {
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    expect(find(card, '.bubble')?.getAttribute('aria-expanded')).toBe('false');

    find(card, '.bubble')?.click();
    await settle(card);

    expect(find(card, '.bubble')?.classList).toContain('selected');
    expect(find(card, '.bubble')?.getAttribute('aria-expanded')).toBe('true');

    find(card, '.sheet.chooser button[data-act="close"]')?.click();
    await settle(card);

    expect(find(card, '.bubble')?.classList).not.toContain('selected');
  });

  it('lets no mark or temperature peek out from under the chooser', async () => {
    vi.stubGlobal('innerWidth', 390);

    const chooser = new DOMRect(0, 180, 400, 220);
    const inside = (at: Point): boolean =>
      at.x > chooser.left &&
      at.x < chooser.right &&
      at.y > chooser.top &&
      at.y < chooser.bottom;

    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard({ room: true });
    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('sheet') ? chooser : real.call(this);
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement): number {
        return this.classList.contains('sheet') ? chooser.height : 0;
      },
    );
    card.requestUpdate();
    await settle(card);

    expect(
      all(card, '.mark:not(.under)').filter((mark) => inside(spotOf(mark))),
    ).not.toEqual([]);

    find(card, '.bubble')?.click();
    await settle(card);

    expect(find(card, '.sheet.chooser.bottom')).not.toBeNull();
    expect(
      all(card, '.mark:not(.under), .bubble:not(.under), .temp')
        .filter((shown) => inside(spotOf(shown)))
        .map((shown) => shown.dataset.key ?? shown.dataset.room),
    ).toEqual([]);
  });

  it('opens the sheet of the mark picked from the chooser', async () => {
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    find(card, '.bubble')?.click();
    await settle(card);

    const choice = find(card, '.sheet.chooser .choice');
    const key = choice?.dataset.key;

    choice?.click();
    await settle(card);

    expect(find(card, '.sheet.chooser')).toBeNull();
    expect(find(card, '.sheet[data-kind="light"]')).not.toBeNull();
    expect(find(card, `.mark.selected[data-key="${key}"]`)).not.toBeNull();
  });

  it('names a door in the chooser as its sheet does, never by its id', async () => {
    placeIn3d(
      Object.fromEntries([
        ...lamps.map((slug) => [`light:${slug}`, SPOT]),
        ['door:d2', SPOT],
      ]),
    );

    const card = await mountCard();
    const hass = card.hass;

    if (hass) {
      card.hass = {
        ...hass,
        states: {
          ...hass.states,
          'cover.door_d2': mockEntityState('cover.door_d2', 'open', {
            device_class: 'door',
            current_position: 50,
          }),
        },
      };
    }

    await settle(card);

    const bubble = all(card, '.bubble').find((element) =>
      element.getAttribute('aria-label')?.includes('door'),
    );

    bubble?.click();
    await settle(card);

    const row = find(card, '.sheet.chooser .choice[data-key="door:d2"]');
    const name = row?.querySelector('.choice-name')?.textContent?.trim();
    const state = row?.querySelector('.choice-state')?.textContent?.trim();

    row?.click();
    await settle(card);

    expect(name).toBeTruthy();
    expect(name).not.toMatch(/\bd2\b/);
    expect(state).toBe('Open');
    expect(find(card, '.sheet .sheet-title')?.textContent?.trim()).toBe(name);
  });

  it('keeps a moved mark where it stands when its sheet opens', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard({ d2Position: 50 });

    const before = spotOf(find(card, '.mark[data-key="door:d2"]'));

    card.shadowRoot?.querySelector('estanza-scene-view')?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'door',
          scopeId: 'd2',
          gesture: 'press',
          ...before,
        },
      }),
    );
    await settle(card);

    expect(find(card, '.sheet[data-kind="cover"]')).not.toBeNull();
    expect(spotOf(find(card, '.mark[data-key="door:d2"]'))).toEqual(before);
  });

  it('ignores a click on a bubble when the press began somewhere else', async () => {
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    find(card, 'estanza-scene-view')?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, composed: true }),
    );
    find(card, '.bubble')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }),
    );
    await settle(card);

    expect(find(card, '.sheet.chooser')).toBeNull();
  });

  it('closes the chooser with its close button', async () => {
    placeIn3d(Object.fromEntries(lamps.map((slug) => [`light:${slug}`, SPOT])));

    const card = await mountCard();

    find(card, '.bubble')?.click();
    await settle(card);

    expect(find(card, '.sheet.chooser')).not.toBeNull();

    find(card, '.sheet.chooser button[aria-label="Close"]')?.click();
    await settle(card);

    expect(find(card, '.sheet.chooser')).toBeNull();
  });
});

describe('marks that follow the camera', () => {
  it('moves a door mark with the view when nothing else is floating', async () => {
    placeIn3d({ 'door:d2': SPOT });

    const card = await mountCard();

    vi.restoreAllMocks();
    placeIn3d({ 'door:d2': { x: SPOT.x + 50, y: SPOT.y } });
    find(card, 'estanza-scene-view')?.dispatchEvent(
      new CustomEvent('view-change'),
    );
    await settle(card);

    expect(spotOf(find(card, '.mark[data-key="door:d2"]'))).toEqual({
      x: SPOT.x + 50,
      y: SPOT.y,
    });
  });
});

describe('marks on a home of several storeys', () => {
  it('shows no mark for a light on a storey out of view', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'light:cellar-light': { x: SPOT.x + 100, y: SPOT.y },
    });

    const card = document.createElement('estanza-card');

    card.hass = createMockHass({
      states: [
        mockLight('light.living', { on: false }),
        mockLight('light.cellar', { on: false }),
      ],
    });
    card.setConfig({
      type: cardType,
      home_document: threeStoreyHome(),
      bindings: [
        {
          scope: { type: 'light', id: 'living-space-light' },
          entity_id: 'light.living',
        },
        {
          scope: { type: 'light', id: 'cellar-light' },
          entity_id: 'light.cellar',
        },
      ],
    });
    document.body.append(card);
    await settle(card);
    find(card, '.floors button[data-floor="f1"]')?.click();
    await settle(card);

    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
    expect(find(card, '.mark[data-key="light:cellar-light"]')).toBeNull();
  });
});

describe('picking the marks drawn on the 3D view', () => {
  it('picks an open door where its mark is drawn once it moved out from under a light', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 6, y: SPOT.y + 4 },
    });

    const card = await mountCard({ d2Position: 50 });

    const door = spotOf(find(card, '.mark[data-key="door:d2"]'));
    const scene = sceneOf(card);

    expect(door).not.toEqual({ x: SPOT.x + 6, y: SPOT.y + 4 });
    expect(scene.pickAt(door)).toEqual({ type: 'door', id: 'd2' });
    expect(scene.pickAt(SPOT)).toEqual({
      type: 'light',
      id: 'living-space-light',
    });
  });

  it('draws a shut door beside a light glyph where it sits and picks it there', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d2': { x: SPOT.x + 20, y: SPOT.y },
    });

    const card = await mountCard();
    const door = spotOf(find(card, '.mark[data-key="door:d2"]'));
    const scene = sceneOf(card);

    expect(door).toEqual({ x: SPOT.x + 20, y: SPOT.y });
    expect(scene.pickAt({ x: SPOT.x + 30, y: SPOT.y })).toEqual({
      type: 'door',
      id: 'd2',
    });
  });

  it('picks a door that only reports its state where its mark is drawn', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d1': { x: SPOT.x + 30, y: SPOT.y },
    });

    const card = await mountCard();
    const door = spotOf(find(card, '.mark[data-key="door:d1"]'));
    const scene = sceneOf(card);

    expect(door).toEqual({ x: SPOT.x + 30, y: SPOT.y });
    expect(scene.pickAt({ x: SPOT.x + 18, y: SPOT.y })).toEqual({
      type: 'door',
      id: 'd1',
    });
  });

  it('shows the details of a door that only reports its state when its mark is pressed', async () => {
    placeIn3d({ 'door:d1': SPOT });

    const card = await mountCard();
    const shown: unknown[] = [];

    card.addEventListener('hass-more-info', (event) =>
      shown.push((event as CustomEvent).detail),
    );
    card.shadowRoot?.querySelector('estanza-scene-view')?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'door',
          scopeId: 'd1',
          gesture: 'tap',
          ...SPOT,
        },
      }),
    );
    await settle(card);

    expect(shown).toEqual([{ entityId: 'binary_sensor.door_d1' }]);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('shows the details of an open door that only reports its state from its room sheet, once a crowd hides its mark', async () => {
    placeIn3d(
      Object.fromEntries([
        ...lamps.map((slug) => [`light:${slug}`, SPOT]),
        ['door:d1', SPOT],
      ]),
    );

    const card = await mountCard({ d1Open: true, room: true });
    const shown: unknown[] = [];

    card.addEventListener('hass-more-info', (event) =>
      shown.push((event as CustomEvent).detail),
    );
    find(card, 'estanza-scene-view')?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: 'living-space',
          gesture: 'press',
          x: 120,
          y: 120,
        },
      }),
    );
    await settle(card);

    const row = find(card, '.sheet .row[data-key="door:d1"]');

    expect(find(card, '.mark[data-key="door:d1"]')).toBeNull();
    expect(row?.textContent).toContain('Open');

    row?.click();
    await settle(card);

    expect(shown).toEqual([{ entityId: 'binary_sensor.door_d1' }]);
  });
});

describe('a drawn mark as its own tap target', () => {
  async function drawnLight(): Promise<{
    card: EstanzaCard;
    mark: HTMLElement | null;
  }> {
    placeIn3d({ 'light:living-space-light': SPOT });

    const card = await mountCard();

    return {
      card,
      mark: find(card, '.mark[data-key="light:living-space-light"]'),
    };
  }

  it('toggles its light when the mark itself is tapped', async () => {
    const { card, mark } = await drawnLight();

    press(mark, 'pointerdown', SPOT);
    press(mark, 'pointerup', SPOT);
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'toggle',
        data: { entity_id: 'light.living' },
      },
    ]);
  });

  it('keeps a tapped light drawn where it stood when it had moved clear of the view switch', async () => {
    const views = { x: SPOT.x - 20, y: SPOT.y - 20, width: 40, height: 40 };

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const box = this.classList.contains('views')
          ? views
          : { x: 0, y: 0, width: 0, height: 0 };

        return {
          ...box,
          left: box.x,
          top: box.y,
          right: box.x + box.width,
          bottom: box.y + box.height,
          toJSON: () => box,
        };
      },
    );

    const { card, mark } = await drawnLight();
    const before = spotOf(mark);

    expect(before).not.toEqual(SPOT);

    press(mark, 'pointerdown', before);
    press(mark, 'pointerup', before);
    await settle(card);

    expect(hass.serviceCalls).toHaveLength(1);
    expect(
      spotOf(find(card, '.mark[data-key="light:living-space-light"]')),
    ).toEqual(before);
    expect(find(card, '.bubble')).toBeNull();
  });

  it('counts six taps under 150 ms apart on its mark as one toggle, and never opens a room sheet', async () => {
    screenThatHovers(false);

    const { card, mark } = await drawnLight();

    for (let turn = 0; turn < 6; turn += 1) {
      press(mark, 'pointerdown', SPOT);
      press(mark, 'pointerup', SPOT);
      click(mark, SPOT);
      vi.advanceTimersByTime(120);
    }

    await settle(card);

    expect(find(card, '.sheet')).toBeNull();
    expect(hass.serviceCalls).toHaveLength(1);
  });

  it('drops the click a browser moves to a nearby button after a touch on the mark', async () => {
    const { card, mark } = await drawnLight();
    const planButton = find(card, '.views button[data-view="2d"]');

    press(mark, 'pointerdown', SPOT);
    press(mark, 'pointerup', SPOT);
    click(planButton, SPOT);
    await settle(card);

    expect(planButton?.getAttribute('aria-pressed')).toBe('false');
    expect(hass.serviceCalls).toHaveLength(1);
  });

  it('lets a real tap on a nearby button through half a second after a touch on the mark', async () => {
    const { card, mark } = await drawnLight();
    const planButton = find(card, '.views button[data-view="2d"]');

    press(mark, 'pointerdown', SPOT);
    press(mark, 'pointerup', SPOT);
    vi.advanceTimersByTime(500);
    click(planButton, SPOT);
    await settle(card);

    expect(planButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('never drops a mouse click that follows a click on the mark', async () => {
    const { card, mark } = await drawnLight();
    const planButton = find(card, '.views button[data-view="2d"]');

    press(mark, 'pointerdown', SPOT, 'mouse');
    press(mark, 'pointerup', SPOT, 'mouse');
    click(planButton, SPOT);
    await settle(card);

    expect(hass.serviceCalls).toHaveLength(1);
    expect(planButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the sheet of its light when the mark is held', async () => {
    const { card, mark } = await drawnLight();

    press(mark, 'pointerdown', SPOT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press(mark, 'pointerup', SPOT);
    await settle(card);

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).not.toBeNull();
  });

  it('hands a touch drag that starts on the mark to the orbit once it has moved 8px, and toggles nothing', async () => {
    const { card, mark } = await drawnLight();
    const orbit = vi.spyOn(EstanzaSceneView.prototype, 'orbitFrom');

    press(mark, 'pointerdown', SPOT);
    press(mark, 'pointermove', { x: SPOT.x + 5, y: SPOT.y });

    expect(orbit).not.toHaveBeenCalled();

    press(mark, 'pointermove', { x: SPOT.x + 12, y: SPOT.y });
    press(mark, 'pointermove', { x: SPOT.x + 40, y: SPOT.y });
    press(mark, 'pointerup', { x: SPOT.x + 40, y: SPOT.y });
    await settle(card);

    expect(orbit).toHaveBeenCalledTimes(1);
    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('hands a drag that starts on a temperature pill to the orbit, and opens no sheet', async () => {
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, SPOT])),
    );

    const card = await mountCard({ room: true });
    const pill = find(card, 'button.temp');
    const orbit = vi.spyOn(EstanzaSceneView.prototype, 'orbitFrom');

    expect(pill).not.toBeNull();

    press(pill, 'pointerdown', SPOT);
    press(pill, 'pointermove', { x: SPOT.x, y: SPOT.y + 30 });
    press(pill, 'pointerup', { x: SPOT.x, y: SPOT.y + 30 });
    click(pill, { x: SPOT.x, y: SPOT.y + 30 });
    await settle(card);

    expect(orbit).toHaveBeenCalledTimes(1);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('keeps following a mouse that presses a mark and drags off it, so the drag never becomes a hold', async () => {
    const capture = vi.fn();

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: capture,
    });

    try {
      const { mark } = await drawnLight();

      mark?.dispatchEvent(
        Object.assign(
          new MouseEvent('pointerdown', {
            clientX: SPOT.x,
            clientY: SPOT.y,
            bubbles: true,
            composed: true,
          }),
          { pointerType: 'mouse', isPrimary: true, pointerId: 3 },
        ),
      );

      expect(capture).toHaveBeenCalledWith(3);
      expect(capture.mock.contexts[0]).toBe(mark);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    }
  });

  it('does nothing when the finger slides away from the mark', async () => {
    const { card, mark } = await drawnLight();
    const away = { x: SPOT.x + 20, y: SPOT.y };

    press(mark, 'pointerdown', SPOT);
    press(mark, 'pointermove', away);
    press(mark, 'pointerup', away);
    await settle(card);

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('keeps a light drawn on a screen that cannot hover, long after the first touch', async () => {
    screenThatHovers(false);
    placeIn3d({ 'light:living-space-light': SPOT });

    const card = await mountCard();

    press(find(card, 'estanza-scene-view'), 'pointerdown', SPOT);
    vi.advanceTimersByTime(10_000);
    await settle(card);

    const light = find(card, '.mark[data-key="light:living-space-light"]');

    expect(light).not.toBeNull();
    expect(light?.classList).not.toContain('hint');
  });

  it('keeps a plug drawn on a screen that cannot hover, as its only way in', async () => {
    screenThatHovers(false);
    placeIn3d({ 'prop:tv-plug': SPOT });

    const card = await mountCard({ plug: true });

    press(find(card, 'estanza-scene-view'), 'pointerdown', SPOT);
    vi.advanceTimersByTime(10_000);
    await settle(card);

    const plug = find(card, '.mark[data-key="prop:tv-plug"]');

    expect(plug).not.toBeNull();
    expect(plug?.classList).toContain('on');
  });

  it('draws every light on a screen that can hover before the pointer comes over the card', async () => {
    screenThatHovers(true);
    placeIn3d({ 'light:living-space-light': SPOT });

    const card = await mountCard();

    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
  });

  it('keeps every mark and pill where it stands as the pointer comes over the card and leaves it', async () => {
    screenThatHovers(true);
    placeIn3d(
      Object.fromEntries(
        lamps.map((slug, index) => [
          `light:${slug}`,
          { x: 60 + 40 * (index % 6), y: 120 + 60 * Math.floor(index / 6) },
        ]),
      ),
    );
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, { x: 150, y: 150 }])),
    );

    const card = await mountCard({ room: true });
    const layout = (): string =>
      JSON.stringify(
        all(card, '.mark, .bubble, .temp').map((element) => [
          element.dataset.key ?? element.dataset.room,
          spotOf(element),
        ]),
      );
    const before = layout();
    const stage = find(card, '.stage');

    stage?.dispatchEvent(
      Object.assign(new MouseEvent('pointerenter'), { pointerType: 'mouse' }),
    );
    await settle(card);

    const over = layout();

    stage?.dispatchEvent(
      Object.assign(new MouseEvent('pointerleave'), { pointerType: 'mouse' }),
    );
    await settle(card);

    expect(all(card, '.mark').length).toBeGreaterThan(0);
    expect(over).toBe(before);
    expect(layout()).toBe(before);
  });

  it('reaches the view switch first, then each room pill right before its own marks', async () => {
    placeIn3d({ 'light:living-space-light': SPOT });
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) =>
        new Map(slugs.map((slug) => [slug, { x: SPOT.x, y: SPOT.y + 60 }])),
    );

    const card = await mountCard({ room: true });
    const stops = all(card, 'button:not([tabindex="-1"])');
    const pill = stops.findIndex((stop) =>
      stop.matches('.temp[data-room="living-space"]'),
    );

    expect(stops[0]?.closest('.dock')).not.toBeNull();
    expect(pill).toBeGreaterThan(0);
    expect(stops[pill + 1]?.dataset.key).toBe('light:living-space-light');
  });

  it('keeps the doors of a room right after its pill, even the ones drawn above it', async () => {
    placeIn3d({
      'door:d1': { x: 300, y: 60 },
      'light:living-space-light': { x: 120, y: 260 },
      'door:d2': { x: 500, y: 330 },
    });
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, { x: 300, y: 200 }])),
    );

    const card = await mountCard({ room: true });
    const stops = all(card, 'button:not([tabindex="-1"])');
    const pill = stops.findIndex((stop) =>
      stop.matches('.temp[data-room="living-space"]'),
    );

    expect(pill).toBeGreaterThan(0);
    expect(
      stops.slice(pill + 1, pill + 4).map((stop) => stop.dataset.key),
    ).toEqual(['door:d1', 'light:living-space-light', 'door:d2']);
  });

  it('keeps a temperature pill off the drawn disc of a glyph', async () => {
    placeIn3d({ 'light:living-space-light': SPOT });
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) =>
        new Map(slugs.map((slug) => [slug, { x: SPOT.x, y: SPOT.y + 10 }])),
    );

    const card = await mountCard({ room: true });

    const pill = find(card, '.temp[data-room="living-space"]');
    const at = spotOf(pill);
    const half = { width: labelWidth('21°') / 2, height: LABEL_HEIGHT / 2 };
    const disc = DISC_PX / 2;

    expect(Number.isFinite(at.x)).toBe(true);
    expect(
      at.x + half.width > SPOT.x - disc &&
        at.x - half.width < SPOT.x + disc &&
        at.y + half.height > SPOT.y - disc &&
        at.y - half.height < SPOT.y + disc,
    ).toBe(false);
  });

  it('keeps a temperature pill off a door dot in 3D, and the dot drawn', async () => {
    placeIn3d({ 'door:d1': SPOT });
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, SPOT])),
    );

    const card = await mountCard({ room: true });
    const pill = find(card, '.temp[data-room="living-space"]');
    const at = spotOf(pill);
    const half = { width: labelWidth('21°') / 2, height: LABEL_HEIGHT / 2 };

    expect(find(card, '.mark[data-key="door:d1"]')).not.toBeNull();
    expect(Number.isFinite(at.x)).toBe(true);
    expect(
      at.x + half.width > SPOT.x &&
        at.x - half.width < SPOT.x &&
        at.y + half.height > SPOT.y &&
        at.y - half.height < SPOT.y,
    ).toBe(false);
  });

  it('hides the door sensors of a storey whose pills have no room, and keeps its light', async () => {
    placeIn3d({
      'light:living-space-light': SPOT,
      'door:d1': { x: SPOT.x + 60, y: SPOT.y },
    });
    crowdStorey();

    const card = await mountCard({ room: true });

    expect(find(card, '.temp')).toBeNull();
    expect(find(card, '.bubble')).toBeNull();
    expect(
      find(card, '.mark[data-key="light:living-space-light"]'),
    ).not.toBeNull();
    expect(find(card, '.mark[data-key="door:d1"]')).toBeNull();
  });

  it('never folds the lights of two rooms into one bubble', async () => {
    placeIn3d(
      Object.fromEntries(
        [...lamps, ...neighbours].map((slug) => [`light:${slug}`, SPOT]),
      ),
    );

    const card = await mountCard({ neighbours: true });

    expect(find(card, '.bubble')).not.toBeNull();

    for (const slug of neighbours) {
      expect(
        find(card, `.mark[data-key="light:${slug}"]`),
        slug,
      ).not.toBeNull();
    }
  });

  it('groups a storey whose pills have no room room by room, never as one bubble', async () => {
    placeIn3d(
      Object.fromEntries(
        [...lamps, ...neighbours].map((slug) => [`light:${slug}`, SPOT]),
      ),
    );
    crowdStorey();

    const card = await mountCard({ room: true, neighbours: true });

    expect(find(card, '.bubble[data-key^="bubble:floor:"]')).toBeNull();

    for (const slug of neighbours) {
      expect(
        find(card, `.mark[data-key="light:${slug}"]`),
        slug,
      ).not.toBeNull();
    }
  });

  it('hides a door sensor that cannot move clear before it folds a light', async () => {
    placeIn3d(
      Object.fromEntries([
        ['door:d1', SPOT],
        ...lamps.map((slug) => [`light:${slug}`, SPOT]),
      ]),
    );

    const card = await mountCard({ d1Open: true });
    const folded = all(card, '.bubble').map((bubble) =>
      Number(bubble.textContent?.trim()),
    );
    const drawn = all(card, '.mark[data-key^="light:lamp-"]').length;

    expect(find(card, '.mark[data-key="door:d1"]')).toBeNull();
    expect(
      all(card, '.bubble').filter((bubble) =>
        bubble.getAttribute('aria-label')?.includes('door'),
      ),
    ).toEqual([]);
    expect(drawn + folded.reduce((sum, count) => sum + count, 0)).toBe(LAMPS);
  });

  it('gives a group the icon of its lights, even where window sensors outnumber them', async () => {
    const windows = 14;

    placeIn3d(
      Object.fromEntries([
        ...lamps.map((slug) => [`light:${slug}`, SPOT]),
        ...windowIds(windows).map((id) => [`window:${id}`, SPOT]),
      ]),
    );
    crowdStorey();

    const card = await mountCard({ room: true, windows });
    const bulb = find(card, '.mark[data-key^="light:lamp-"] .icon');
    const bubbles = all(card, '.bubble');

    expect(bulb).not.toBeNull();
    expect(bubbles).not.toEqual([]);

    for (const bubble of bubbles) {
      expect(markup(bubble.querySelector('.icon'))).toBe(markup(bulb));
    }
  });

  it('keeps a pill out of the touch reach of a glyph, so the two never read as one', async () => {
    placeIn3d({ 'light:living-space-light': SPOT });
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) =>
        new Map(slugs.map((slug) => [slug, { x: SPOT.x, y: SPOT.y + 32 }])),
    );

    const card = await mountCard({ room: true });
    const pill = find(card, '.temp[data-room="living-space"]');
    const mark = find(card, '.mark[data-key="light:living-space-light"]');
    const at = spotOf(pill);
    const half = { width: labelWidth('21°') / 2, height: LABEL_HEIGHT / 2 };
    const reach = TOUCH_PX / 2;

    expect(mark).not.toBeNull();
    expect(Number.isFinite(at.x)).toBe(true);
    expect(
      at.x + half.width > SPOT.x - reach &&
        at.x - half.width < SPOT.x + reach &&
        at.y + half.height > SPOT.y - reach &&
        at.y - half.height < SPOT.y + reach,
    ).toBe(false);
  });

  it('takes no focus from a press, so no ring is left on a tapped mark', async () => {
    const { mark } = await drawnLight();
    const down = new MouseEvent('mousedown', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });

    mark?.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
  });

  it('rings a mark only for keyboard focus, round like its disc', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(/\.mark:focus-visible \{[^}]*outline: none;/);
    expect(rules).toMatch(
      /\.mark:focus-visible \.disc \{[^}]*outline: 2px solid var\(--ez-focus\);/,
    );
    expect(rules).not.toMatch(/\.mark:focus[ ,{]/);
  });

  it('lets a drawn glyph take the pointer and a shut dot only on its drawn disc', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(/\.mark \{[^}]*pointer-events: none;/);
    expect(rules).toMatch(
      /:is\(\.mark, \.bubble\)::before \{[^}]*inset: var\(--hit-t, 0px\) var\(--hit-r, 0px\) var\(--hit-b, 0px\) var\(--hit-l, 0px\);[^}]*pointer-events: auto;/,
    );
    expect(rules).toMatch(
      /:is\(\.mark\.under, \.mark\.dot, \.bubble\.under\)::before \{[^}]*pointer-events: none;/,
    );
    expect(rules).toMatch(/\.mark\.under \{[^}]*pointer-events: none;/);
    expect(rules).toMatch(/\.mark\.dot \{[^}]*pointer-events: none;/);
    expect(rules).toMatch(/\.mark\.dot \.disc \{[^}]*pointer-events: auto;/);
  });
});

describe('a right-click on the card', () => {
  function rightButton(
    element: Element | null,
    type: string,
    at: Point,
  ): MouseEvent {
    const event = Object.assign(
      new MouseEvent(type, {
        clientX: at.x,
        clientY: at.y,
        button: 2,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
      { pointerType: 'mouse', isPrimary: true },
    );

    element?.dispatchEvent(event);

    return event;
  }

  function rightClick(element: Element | null, at: Point): MouseEvent {
    rightButton(element, 'pointerdown', at);

    const menu = rightButton(element, 'contextmenu', at);

    rightButton(element, 'pointerup', at);

    return menu;
  }

  async function drawnLight(): Promise<{
    card: EstanzaCard;
    mark: HTMLElement | null;
  }> {
    placeIn3d({ 'light:living-space-light': SPOT });

    const card = await mountCard();

    return {
      card,
      mark: find(card, '.mark[data-key="light:living-space-light"]'),
    };
  }

  it('opens the sheet of a light on a right-click on its mark, and keeps the browser menu shut', async () => {
    const { card, mark } = await drawnLight();
    const menu = rightClick(mark, SPOT);

    vi.advanceTimersByTime(LONG_PRESS_MS);
    await settle(card);

    expect(menu.defaultPrevented).toBe(true);
    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).not.toBeNull();
  });

  it('opens the sheet of a light when the menu comes after the release', async () => {
    const { card, mark } = await drawnLight();

    rightButton(mark, 'pointerdown', SPOT);
    rightButton(mark, 'pointerup', SPOT);

    const menu = rightButton(mark, 'contextmenu', SPOT);

    vi.advanceTimersByTime(LONG_PRESS_MS);
    await settle(card);

    expect(menu.defaultPrevented).toBe(true);
    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).not.toBeNull();
  });

  it('never toggles or holds a light on a right button press of its own', async () => {
    const { card, mark } = await drawnLight();

    rightButton(mark, 'pointerdown', SPOT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    rightButton(mark, 'pointerup', SPOT);
    await settle(card);

    expect(hass.serviceCalls).toEqual([]);
    expect(find(card, '.sheet')).toBeNull();
  });

  it('never orbits on a right button drag that starts on a mark', async () => {
    const { card, mark } = await drawnLight();
    const orbit = vi.spyOn(EstanzaSceneView.prototype, 'orbitFrom');
    const away = { x: SPOT.x + 40, y: SPOT.y };

    rightButton(mark, 'pointerdown', SPOT);
    rightButton(mark, 'pointermove', away);
    rightButton(mark, 'pointerup', away);
    await settle(card);

    expect(orbit).not.toHaveBeenCalled();
    expect(hass.serviceCalls).toEqual([]);
  });

  it('opens the room sheet on a right-click on a temperature pill', async () => {
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, SPOT])),
    );

    const card = await mountCard({ room: true });
    const menu = rightClick(find(card, 'button.temp'), SPOT);

    await settle(card);

    expect(menu.defaultPrevented).toBe(true);
    expect(find(card, '.sheet')).not.toBeNull();
  });

  it('keeps an open sheet open on a right-click clear of every thing', async () => {
    const { card, mark } = await drawnLight();

    rightClick(mark, SPOT);
    await settle(card);
    rightClick(find(card, 'estanza-scene-view'), { x: 380, y: 20 });
    await settle(card);

    expect(find(card, '.sheet')).not.toBeNull();
    expect(hass.serviceCalls).toEqual([]);
  });

  it('leaves the browser menu alone over the view switch', async () => {
    const { card } = await drawnLight();
    const menu = rightClick(find(card, '.views button[data-view="2d"]'), SPOT);

    await settle(card);

    expect(menu.defaultPrevented).toBe(false);
    expect(find(card, '.sheet')).toBeNull();
  });
});
