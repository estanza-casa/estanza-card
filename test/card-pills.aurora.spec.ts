import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { cardType, type SceneBinding, scopeKey } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import {
  covered,
  LABEL_HEIGHT,
  type LabelSize,
  labelWidth,
  type MarkBox,
  pillInside,
  placePills,
  strandedPills,
} from '../src/living.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaSceneView, type RoomFootprint } from '../src/scene-view.js';
import floorScreens from './fixtures/aurora-floor-screens.json';
import screens from './fixtures/aurora-screens.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockLight,
  mockSensor,
} from './mock-hass.js';

vi.mock('../src/living.js', async (original) => {
  const real = await original<typeof import('../src/living.js')>();

  return {
    ...real,
    placePills: vi.fn(real.placePills),
    strandedPills: vi.fn(real.strandedPills),
  };
});

type ScreenRoom = {
  floor: Point[];
  top: Point[];
  anchor: Point | null;
  name: Point | null;
  light: Point | null;
};

type Screen = {
  stage: { width: number; height: number };
  rooms: Record<string, ScreenRoom>;
  words: (MarkBox & { key?: string })[];
  stairs: MarkBox[];
  furniture: MarkBox[];
  keepClear: MarkBox[];
};

const realNow = performance.now.bind(performance);

const shots: Record<string, Screen> = screens;
const floorShots: Record<string, Screen> = floorScreens;

const readings: Record<string, number> = {
  hall: 18.5,
  'living-room': 19.2,
  kitchen: 19.9,
  study: 20.6,
  washroom: 18.5,
  garage: 20.6,
};

const upstairs: Record<string, number> = {
  landing: 19.2,
  'guest-room': 19.9,
  bedroom: 20.6,
  suite: 18.5,
  bathroom: 19.2,
  'suite-bathroom': 19.9,
};

const slugs = Object.keys(readings);

function entityOf(slug: string): string {
  return slug.replaceAll('-', '_');
}

function bindingsOf(rooms: readonly string[]): SceneBinding[] {
  return rooms.flatMap((slug) => [
    {
      scope: { type: 'room' as const, id: slug },
      temperature_entity_id: `sensor.${entityOf(slug)}_temperature`,
    },
    {
      scope: { type: 'light' as const, id: `${slug}-light` },
      entity_id: `light.${entityOf(slug)}_light`,
    },
  ]);
}

function showOn(screen: Screen): void {
  const rooms = (wanted: readonly string[]): Map<string, RoomFootprint> =>
    new Map(
      wanted.flatMap((slug) => {
        const room = screen.rooms[slug];

        return room ? [[slug, { floor: room.floor, top: room.top }]] : [];
      }),
    );
  const anchors = (wanted: readonly string[]): Map<string, Point> =>
    new Map(
      wanted.flatMap((slug) => {
        const anchor = screen.rooms[slug]?.anchor;

        return anchor ? [[slug, anchor]] : [];
      }),
    );
  const lights = new Map(
    Object.keys(screen.rooms).flatMap((slug) => {
      const light = screen.rooms[slug]?.light;

      return light ? [[`light:${slug}-light`, light]] : [];
    }),
  );

  vi.spyOn(EstanzaSceneView.prototype, 'roomFootprints').mockImplementation(
    rooms,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
    anchors,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
  );
  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
    (scope) => lights.get(scopeKey(scope)) ?? null,
  );
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
    await card.shadowRoot?.querySelector('estanza-plan-view')?.updateComplete;
  }
}

async function mountAurora(
  view: '2d' | '3d',
  screen: Screen,
  floor = 'f1',
  door: string | null = null,
): Promise<EstanzaCard> {
  showOn(screen);

  const card = document.createElement('estanza-card');
  const shown = floor === 'f1' ? readings : upstairs;
  const rooms = Object.keys(shown);
  const sensor = `binary_sensor.door_${door}`;

  card.hass = createMockHass({
    states: [
      ...rooms.flatMap((slug) => [
        mockSensor(
          `sensor.${entityOf(slug)}_temperature`,
          'temperature',
          shown[slug],
          '°C',
        ),
        mockLight(`light.${entityOf(slug)}_light`, { on: false }),
      ]),
      ...(door ? [mockBinarySensor(sensor, 'door', false)] : []),
    ],
  });
  card.setConfig({
    type: cardType,
    home_document: homeDocumentSchema.parse(aurora),
    bindings: [
      ...bindingsOf(rooms),
      ...(door
        ? [{ scope: { type: 'door' as const, id: door }, entity_id: sensor }]
        : []),
    ],
  });
  document.body.append(card);
  await settle(card);

  const stage = card.shadowRoot?.querySelector('.stage');

  if (stage) {
    Object.defineProperty(stage, 'clientWidth', {
      value: screen.stage.width,
      configurable: true,
    });
    Object.defineProperty(stage, 'clientHeight', {
      value: screen.stage.height,
      configurable: true,
    });
  }

  card.shadowRoot
    ?.querySelector<HTMLButtonElement>(`.floors button[data-floor="${floor}"]`)
    ?.click();
  await settle(card);

  if (view === '2d') {
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.views button[data-view="2d"]')
      ?.click();

    for (let step = 0; step < 3; step += 1) {
      await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
      await settle(card);
    }
  }

  card.requestUpdate();
  await settle(card);

  return card;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 25, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(hover: none)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(placePills).mockReset();
  vi.mocked(strandedPills).mockReset();
});

function spotOf(element: HTMLElement): Point {
  return {
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
  };
}

function roomHasSpace(
  ring: readonly Point[],
  size: LabelSize,
  taken: readonly MarkBox[],
): boolean {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);

  for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) {
      const box = { x, y, ...size };

      if (
        pillInside(box, size.width, size.height, ring) &&
        !covered(box, taken)
      ) {
        return true;
      }
    }
  }

  return false;
}

describe('the temperature pills of Casa Aurora on a touch screen', () => {
  it.each(['390-3d', '1280-3d'])(
    'draws every ground floor pill inside its room at %s whenever the room has space beside its drawn light',
    async (shot) => {
      const screen = shots[shot];
      const card = await mountAurora('3d', screen);
      const pills = [
        ...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? []),
      ];
      const discs = [
        ...(card.shadowRoot?.querySelectorAll<HTMLElement>(
          '.mark.light, .bubble',
        ) ?? []),
      ].map((mark) => ({
        ...spotOf(mark),
        width: mark.classList.contains('bubble') ? 58 : 38,
        height: 38,
      }));
      const taken = [
        ...discs,
        ...screen.words,
        ...screen.stairs,
        ...screen.keepClear,
      ];

      expect(discs.length).toBeGreaterThan(0);
      expect(pills.map((pill) => pill.dataset.room).sort()).toEqual(
        [...slugs].sort(),
      );

      const outside = pills.flatMap((pill) => {
        const slug = pill.dataset.room ?? '';
        const size = {
          width: labelWidth(pill.textContent?.trim() ?? ''),
          height: LABEL_HEIGHT,
        };
        const ring = screen.rooms[slug].top;

        if (pillInside(spotOf(pill), size.width, size.height, ring)) return [];

        return roomHasSpace(ring, size, taken) ? [slug] : [];
      });

      expect(outside).toEqual([]);
    },
  );
});

function shifted(screen: Screen, by: number): Screen {
  const move = (point: Point): Point => ({ x: point.x + by, y: point.y });
  const moveRoom = (room: ScreenRoom): ScreenRoom => ({
    floor: room.floor.map(move),
    top: room.top.map(move),
    anchor: room.anchor && move(room.anchor),
    name: room.name && move(room.name),
    light: room.light && move(room.light),
  });

  return {
    ...screen,
    rooms: Object.fromEntries(
      Object.entries(screen.rooms).map(([slug, room]) => [
        slug,
        moveRoom(room),
      ]),
    ),
  };
}

function pillSpots(card: EstanzaCard): Map<string, Point> {
  return new Map(
    [...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? [])].map(
      (pill) => [pill.dataset.room ?? '', spotOf(pill)],
    ),
  );
}

describe('the temperature pills of Casa Aurora while the camera moves', () => {
  it('runs no placement search while the camera moves, and one once it settles', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const before = pillSpots(card);
    const scene = card.shadowRoot?.querySelector('estanza-scene-view');

    vi.mocked(placePills).mockClear();

    for (let frame = 1; frame <= 12; frame += 1) {
      showOn(shifted(screen, frame * 2));
      scene?.dispatchEvent(new Event('view-change'));
      await settle(card);
      card.requestUpdate();
      await settle(card);
    }

    const during = pillSpots(card);

    expect(placePills).not.toHaveBeenCalled();
    expect([...during.keys()].sort()).toEqual([...before.keys()].sort());

    for (const [slug, spot] of before) {
      expect(during.get(slug)?.x).toBeCloseTo(spot.x + 24);
      expect(during.get(slug)?.y).toBeCloseTo(spot.y);
    }

    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    expect(placePills).toHaveBeenCalled();
    expect(pillSpots(card).size).toBe(slugs.length);
  });

  function ontoHallLight(screen: Screen, start: Point): Screen {
    const light = screen.rooms.hall.light;

    if (!light) throw new Error('no hall light');

    return {
      ...screen,
      rooms: Object.fromEntries(
        Object.entries(screen.rooms).map(([slug, room]) => [
          slug,
          {
            ...room,
            anchor: room.anchor && {
              x: room.anchor.x + light.x - start.x,
              y: room.anchor.y + light.y - start.y,
            },
          },
        ]),
      ),
    };
  }

  async function moveTo(card: EstanzaCard, screen: Screen): Promise<void> {
    showOn(screen);
    card.shadowRoot
      ?.querySelector('estanza-scene-view')
      ?.dispatchEvent(new Event('view-change'));
    await settle(card);
    card.requestUpdate();
    await settle(card);
  }

  it('steps a carried pill off a light glyph it slides onto, and paints the glyphs above the pills', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const start = pillSpots(card).get('hall');

    if (!start) throw new Error('no hall pill');

    vi.mocked(placePills).mockClear();
    await moveTo(card, ontoHallLight(screen, start));

    const glyphs = [
      ...(card.shadowRoot?.querySelectorAll<HTMLElement>(
        '.mark.light, .bubble',
      ) ?? []),
    ].map((mark) => ({ ...spotOf(mark), width: 32, height: 32 }));
    const under = [
      ...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? []),
    ].filter((pill) =>
      covered(
        {
          ...spotOf(pill),
          width: labelWidth(pill.textContent?.trim() ?? ''),
          height: LABEL_HEIGHT,
        },
        glyphs,
      ),
    );
    const temps = card.shadowRoot?.querySelector('.temps');
    const marks = card.shadowRoot?.querySelector('.marks');

    expect(placePills).not.toHaveBeenCalled();
    expect(pillSpots(card).size).toBe(slugs.length);
    expect(under.map((pill) => pill.dataset.room)).not.toContain('hall');
    expect(
      temps && marks
        ? temps.compareDocumentPosition(marks) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
  });

  it('steps a carried pill off a door dot it slides onto, and keeps the dot drawn', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen, 'f1', 'd1');
    const start = pillSpots(card).get('hall');

    if (!start) throw new Error('no hall pill');

    const door = { x: start.x + 10, y: start.y };
    const moved = shifted(screen, 10);

    await moveTo(card, moved);

    const light = (slug: string): Point | null =>
      moved.rooms[slug]?.light ?? null;

    vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
      (scope) =>
        scopeKey(scope) === 'door:d1'
          ? door
          : scope.type === 'light'
            ? light(scope.id.replace(/-light$/, ''))
            : null,
    );
    card.shadowRoot
      ?.querySelector('estanza-scene-view')
      ?.dispatchEvent(new Event('view-change'));
    await settle(card);

    const hall = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );

    if (!hall) throw new Error('no hall pill');

    const at = spotOf(hall);
    const half = labelWidth(hall.textContent?.trim() ?? '', true) / 2;

    expect(
      card.shadowRoot?.querySelector('.mark[data-key="door:d1"]'),
    ).not.toBeNull();
    expect(
      Math.abs(at.x - door.x) < half &&
        Math.abs(at.y - door.y) < LABEL_HEIGHT / 2,
    ).toBe(false);
  });

  it('never steps a carried pill off a glyph and over the top edge of the stage', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const start = pillSpots(card).get('hall');
    const light = screen.rooms.hall.light;

    if (!start || !light) throw new Error('no hall pill or light');

    const onto = ontoHallLight(screen, start);
    const up = (point: Point): Point => ({
      x: point.x,
      y: point.y + 27 - light.y,
    });
    const cutOff = [
      { x: light.x - 8, y: -300 },
      { x: light.x + 8, y: -300 },
      { x: light.x + 8, y: 40 },
      { x: light.x - 8, y: 40 },
    ];

    await moveTo(card, {
      ...onto,
      rooms: Object.fromEntries(
        Object.entries(onto.rooms).map(([slug, room]) => [
          slug,
          {
            floor: slug === 'hall' ? cutOff : room.floor.map(up),
            top: slug === 'hall' ? cutOff : room.top.map(up),
            anchor: room.anchor && up(room.anchor),
            name: room.name && up(room.name),
            light: room.light && up(room.light),
          },
        ]),
      ),
    });

    const hall = pillSpots(card).get('hall');

    expect(hall).toBeDefined();
    expect((hall?.y ?? 0) - LABEL_HEIGHT / 2).toBeGreaterThanOrEqual(0);
  });

  it('leaves the tapped pill where the house carried it when it lands a few pixels clear of a light', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const hall = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );
    const light = screen.rooms.hall.light;

    if (!hall || !light) throw new Error('no hall pill or light');

    hall.click();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    const held = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );

    if (!held) throw new Error('no held hall pill');

    const start = spotOf(held);
    const half =
      labelWidth(
        held.textContent?.trim() ?? '',
        held.classList.contains('small'),
      ) / 2;
    const target = { x: light.x + half + 14 + 6, y: light.y };
    const by = { x: target.x - start.x, y: target.y - start.y };

    await moveTo(card, {
      ...screen,
      rooms: Object.fromEntries(
        Object.entries(screen.rooms).map(([slug, room]) => [
          slug,
          {
            ...room,
            anchor: room.anchor && {
              x: room.anchor.x + by.x,
              y: room.anchor.y + by.y,
            },
          },
        ]),
      ),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    const end = pillSpots(card).get('hall');

    expect(end?.x).toBeCloseTo(target.x, 0);
    expect(end?.y).toBeCloseTo(target.y, 0);
  });

  it('keeps carrying the tapped pill while its room is briefly hidden mid-move', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);

    card.shadowRoot
      ?.querySelector<HTMLElement>('.temp[data-room="hall"]')
      ?.click();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    const before = pillSpots(card).get('hall');
    const moved = shifted(screen, 10);

    showOn(moved);
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (wanted, hidden = false) =>
        new Map(
          wanted.flatMap((slug) => {
            const anchor = moved.rooms[slug]?.anchor;

            return anchor && (hidden || slug !== 'hall')
              ? [[slug, anchor]]
              : [];
          }),
        ),
    );
    card.shadowRoot
      ?.querySelector('estanza-scene-view')
      ?.dispatchEvent(new Event('view-change'));
    await settle(card);
    card.requestUpdate();
    await settle(card);

    const hall = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );

    expect(hall?.classList.contains('selected')).toBe(true);
    expect(pillSpots(card).get('hall')?.x).toBeCloseTo((before?.x ?? 0) + 10);
  });

  it('still shows the tapped pill on a small card when a resize leaves it no calm spot', async () => {
    const screen = shots['390-3d'];
    const card = await mountAurora('3d', screen);
    const stage = card.shadowRoot?.querySelector('.stage');
    const real =
      await vi.importActual<typeof import('../src/living.js')>(
        '../src/living.js',
      );

    if (!stage) throw new Error('no stage');

    card.shadowRoot
      ?.querySelector<HTMLElement>('.temp[data-room="hall"]')
      ?.click();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    vi.mocked(placePills).mockImplementation((...args) =>
      real.placePills(...args).filter((label) => label.key !== 'hall'),
    );
    vi.mocked(strandedPills).mockImplementation(
      (pills, taken, glyphs, anywhere) =>
        real
          .strandedPills(pills, taken, glyphs, anywhere)
          .filter((label) => anywhere || label.key !== 'hall'),
    );
    Object.defineProperty(stage, 'clientWidth', {
      value: screen.stage.width - 12,
      configurable: true,
    });
    await moveTo(card, screen);
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    expect(
      card.shadowRoot
        ?.querySelector('.temp[data-room="hall"]')
        ?.classList.contains('selected'),
    ).toBe(true);
  });

  it('brings the tapped pill back onto its storey on a small card when placement puts it in the sky', async () => {
    const screen = shots['390-3d'];
    const card = await mountAurora('3d', screen);
    const stage = card.shadowRoot?.querySelector('.stage');
    const real =
      await vi.importActual<typeof import('../src/living.js')>(
        '../src/living.js',
      );
    const ground = Object.values(screen.rooms).flatMap((room) => [
      ...room.floor,
      ...room.top,
    ]);
    const top = Math.min(...ground.map((point) => point.y));
    const bottom = Math.max(...ground.map((point) => point.y));

    if (!stage) throw new Error('no stage');

    card.shadowRoot
      ?.querySelector<HTMLElement>('.temp[data-room="hall"]')
      ?.click();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    vi.mocked(placePills).mockImplementation((...args) =>
      real
        .placePills(...args)
        .map((label) =>
          label.key === 'hall' ? { ...label, y: top - 60 } : label,
        ),
    );
    Object.defineProperty(stage, 'clientWidth', {
      value: screen.stage.width - 12,
      configurable: true,
    });
    await moveTo(card, screen);
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    const hall = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );
    const spot = hall ? spotOf(hall) : null;

    expect(hall?.classList.contains('selected')).toBe(true);
    expect(spot?.y).toBeGreaterThanOrEqual(top - 8);
    expect(spot?.y).toBeLessThanOrEqual(bottom + 8);
  });

  it('seats the tapped pill on its storey on a small card when placement loses it among the others', async () => {
    const screen = shots['390-3d'];
    const card = await mountAurora('3d', screen);
    const stage = card.shadowRoot?.querySelector('.stage');
    const real =
      await vi.importActual<typeof import('../src/living.js')>(
        '../src/living.js',
      );
    const ground = Object.values(screen.rooms).flatMap((room) => [
      ...room.floor,
      ...room.top,
    ]);
    const top = Math.min(...ground.map((point) => point.y));
    const bottom = Math.max(...ground.map((point) => point.y));
    const lost = new Set(['hall', 'kitchen']);

    if (!stage) throw new Error('no stage');

    card.shadowRoot
      ?.querySelector<HTMLElement>('.temp[data-room="hall"]')
      ?.click();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    vi.mocked(placePills).mockImplementation((...args) =>
      real.placePills(...args).filter((label) => !lost.has(label.key)),
    );
    vi.mocked(strandedPills).mockImplementation((pills, ...rest) =>
      real
        .strandedPills(pills, ...rest)
        .filter((label) => label.key !== 'hall' || pills.length === 1),
    );
    Object.defineProperty(stage, 'clientWidth', {
      value: screen.stage.width - 12,
      configurable: true,
    });
    await moveTo(card, screen);
    await vi.advanceTimersByTimeAsync(1000);
    await settle(card);

    const hall = card.shadowRoot?.querySelector<HTMLElement>(
      '.temp[data-room="hall"]',
    );
    const spot = hall ? spotOf(hall) : null;

    expect(hall?.classList.contains('selected')).toBe(true);
    expect(spot?.y).toBeGreaterThanOrEqual(top - 8);
    expect(spot?.y).toBeLessThanOrEqual(bottom + 8);
  });

  it('keeps carrying every other pill when one room leaves the view mid-move', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const before = pillSpots(card);
    const moved = shifted(screen, 10);

    vi.mocked(placePills).mockClear();
    await moveTo(card, {
      ...moved,
      rooms: { ...moved.rooms, study: { ...moved.rooms.study, anchor: null } },
    });

    const during = pillSpots(card);

    expect(placePills).not.toHaveBeenCalled();
    expect([...during.keys()].sort()).toEqual(
      slugs.filter((slug) => slug !== 'study').sort(),
    );

    for (const [slug, spot] of during) {
      expect(spot.x).toBeCloseTo((before.get(slug)?.x ?? 0) + 10);
    }
  });

  it('places the pills afresh when the card resizes mid-move, never carrying the old layout', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const stage = card.shadowRoot?.querySelector('.stage');

    if (!stage) throw new Error('no stage');

    vi.mocked(placePills).mockClear();
    Object.defineProperty(stage, 'clientWidth', {
      value: Math.round(screen.stage.width * 0.6),
      configurable: true,
    });
    await moveTo(card, shifted(screen, 10));

    expect(placePills).toHaveBeenCalled();
  });

  it('places the pills again while the camera coasts slowly to a stop', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);

    await moveTo(card, shifted(screen, 24));
    vi.mocked(placePills).mockClear();

    for (let frame = 1; frame <= 30; frame += 1) {
      await vi.advanceTimersByTimeAsync(20);
      await moveTo(card, shifted(screen, 24 + frame * 0.3));
    }

    expect(placePills).toHaveBeenCalled();
  });

  it('places the pills afresh on the way back to 3D, never carrying the plan layout', async () => {
    const card = await mountAurora('2d', shots['1280-2d']);

    vi.mocked(placePills).mockClear();
    showOn(shots['1280-3d']);
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.views button[data-view="3d"]')
      ?.click();

    let first = 0;

    for (let step = 0; step < 200 && first === 0; step += 1) {
      await vi.advanceTimersByTimeAsync(16);
      card.requestUpdate();
      await settle(card);
      first = pillSpots(card).size;
    }

    expect(first).toBeGreaterThan(0);
    expect(placePills).toHaveBeenCalled();
  });

  it('keeps gliding a pill off a light while its settled spot still shifts with a slow camera', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const start = pillSpots(card).get('hall');

    if (!start) throw new Error('no hall pill');

    const onLight = ontoHallLight(screen, start);

    await moveTo(card, onLight);

    const carried = pillSpots(card).get('hall');

    for (let frame = 1; frame <= 45; frame += 1) {
      await vi.advanceTimersByTimeAsync(10);
      await moveTo(card, shifted(onLight, frame * 0.3));
    }

    const end = pillSpots(card).get('hall');
    const travel =
      carried && end ? Math.hypot(end.x - carried.x, end.y - carried.y) : 0;

    expect(travel).toBeGreaterThan(20);
  });

  it('keeps the pills in sight while the camera moves and glides them to their settled spot once it stops', async () => {
    const screen = shots['1280-3d'];
    const card = await mountAurora('3d', screen);
    const stage = card.shadowRoot?.querySelector('.stage');
    const start = pillSpots(card).get('hall');

    if (!start) throw new Error('no hall pill');

    await moveTo(card, ontoHallLight(screen, start));

    const carried = pillSpots(card).get('hall');

    expect(stage?.classList.contains('pills-moving')).toBe(true);
    expect(pillSpots(card).size).toBe(slugs.length);

    const path: Point[] = [];

    for (let step = 0; step < 40; step += 1) {
      await vi.advanceTimersByTimeAsync(20);
      await settle(card);

      const spot = pillSpots(card).get('hall');

      if (spot) path.push(spot);
    }

    const end = path[path.length - 1];
    const steps = path
      .slice(1)
      .map((spot, index) =>
        Math.hypot(spot.x - path[index].x, spot.y - path[index].y),
      );
    const travel = carried
      ? Math.hypot(end.x - carried.x, end.y - carried.y)
      : 0;

    expect(stage?.classList.contains('pills-moving')).toBe(false);
    expect(path).toHaveLength(40);
    expect(travel).toBeGreaterThan(20);
    expect(Math.max(...steps.slice(-5))).toBeLessThan(0.5);
  });
});

describe('taps while a sheet reframes the house', () => {
  function pill(card: EstanzaCard, room: string): HTMLButtonElement | null {
    return (
      card.shadowRoot?.querySelector<HTMLButtonElement>(
        `button.temp[data-room="${room}"]`,
      ) ?? null
    );
  }

  function sheetRoom(card: EstanzaCard): string | null {
    return (
      card.shadowRoot?.querySelector('.sheet .sheet-title')?.textContent ?? null
    );
  }

  it('ignores a tap on the house until the view has settled beside the sheet it just opened', async () => {
    const card = await mountAurora('3d', shots['1280-3d']);
    const reframing = vi
      .spyOn(EstanzaSceneView.prototype, 'reframing', 'get')
      .mockReturnValue(true);

    pill(card, 'hall')?.click();
    await settle(card);

    const opened = sheetRoom(card);

    pill(card, 'kitchen')?.click();
    await settle(card);

    expect(opened).toMatch(/hall/i);
    expect(sheetRoom(card)).toBe(opened);

    reframing.mockReturnValue(false);
    pill(card, 'kitchen')?.click();
    await settle(card);

    expect(sheetRoom(card)).toMatch(/kitchen/i);
  });
});

describe('marks before the 3D view first frames the house', () => {
  function markCount(card: EstanzaCard): number {
    return card.shadowRoot?.querySelectorAll('.marks > *').length ?? 0;
  }

  it('draws no mark over a canvas that is still hidden, and draws them once it frames', async () => {
    const card = await mountAurora('3d', shots['1280-3d']);
    const shown = markCount(card);
    const unframed = vi
      .spyOn(EstanzaSceneView.prototype, 'unframed', 'get')
      .mockReturnValue(true);

    card.requestUpdate();
    await settle(card);

    const hidden = markCount(card);

    unframed.mockReturnValue(false);
    card.requestUpdate();
    await settle(card);

    expect(shown).toBeGreaterThan(0);
    expect(hidden).toBe(0);
    expect(markCount(card)).toBe(shown);
  });
});

describe('the temperature pills of Casa Aurora seen from the floor', () => {
  it.each([
    ['390-70', 8],
    ['390-80', 8],
    ['390-max', 8],
    ['1280-70', 4],
    ['1280-80', 4],
    ['1280-max', 4],
  ] as const)(
    'place in one pass at %s in under %s ms',
    async (shot, budget) => {
      const card = await mountAurora('3d', floorShots[shot]);
      const real =
        await vi.importActual<typeof import('../src/living.js')>(
          '../src/living.js',
        );
      let spent = 0;

      vi.mocked(placePills).mockImplementation((...args) => {
        const start = realNow();

        try {
          return real.placePills(...args);
        } finally {
          spent += realNow() - start;
        }
      });

      const passes: number[] = [];

      for (let run = 0; run < 5; run += 1) {
        spent = 0;
        card.requestUpdate();
        await settle(card);
        passes.push(spent);
      }

      expect(Math.min(...passes)).toBeLessThan(budget);
    },
  );
});
