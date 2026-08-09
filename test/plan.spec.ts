import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  litFill,
  openingSpan,
  PLAN_WARM,
  planFills,
  planFloor,
  planGlows,
  planPoint,
  readViewChoice,
  roomAtPoint,
  roomLight,
  viewKey,
  visualCentre,
  writeViewChoice,
} from '../src/plan.js';
import { DANGER_FILL, type RoomMarks } from '../src/room-marks.js';
import type { SceneOverlay } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage, refusingStorage } from './memory-storage.js';
import { threeStoreyHome } from './storeys.js';

const home = homeDocumentSchema.parse(homeFixture);
const floors = deriveFloors(home);
const windowedFloors = deriveFloors(
  homeDocumentSchema.parse({
    ...homeFixture,
    plan: {
      ...homeFixture.plan,
      floors: [
        {
          ...homeFixture.plan.floors[0],
          windows: [
            { id: 'win-north', wallId: 'w1', position: 0.5, width: 120 },
            { id: 'win-west', wallId: 'w4', position: 0.5, width: 100 },
          ].map((opening) => ({ ...opening, height: 120, sillHeight: 90 })),
        },
      ],
    },
  }),
);
const lamp = '#ffd4ab';

function overlay(parts: Partial<SceneOverlay> = {}): SceneOverlay {
  return { lights: {}, rooms: {}, doors: {}, windows: {}, ...parts };
}

function lit(brightness: number | null = 1, color: string | null = lamp) {
  return { on: true, brightness, color };
}

function channels(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function distance(a: string, b: string): number {
  const [x, y] = [channels(a), channels(b)];

  return Math.hypot(...x.map((channel, index) => channel - y[index]));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the storey the plan draws', () => {
  it('draws the only floor of a one storey home without choosing', () => {
    expect(planFloor(floors, null)).toBeNull();
    expect(planFloor(floors, 'f1')).toBeNull();
  });

  it('draws the ground floor when all floors are chosen', () => {
    const stack = deriveFloors(threeStoreyHome());

    expect(planFloor(stack, null)).toBe('f1');
  });

  it('draws the storey the reader picked', () => {
    const stack = deriveFloors(threeStoreyHome());

    expect(planFloor(stack, 'ufloor')).toBe('ufloor');
    expect(planFloor(stack, 'bfloor')).toBe('bfloor');
  });

  it('falls back to the ground floor for a storey that no longer exists', () => {
    const stack = deriveFloors(threeStoreyHome());

    expect(planFloor(stack, 'gone')).toBe('f1');
  });

  it('draws the lowest storey with rooms when the ground floor has none', () => {
    const source = structuredClone(threeStoreyHome());

    for (const floor of source.plan.floors) {
      if (floor.id !== 'ufloor') floor.rooms = [];
    }

    expect(
      planFloor(deriveFloors(homeDocumentSchema.parse(source)), null),
    ).toBe('ufloor');
  });
});

describe('the fill of a lit room', () => {
  it('turns a lit room the warm colour of its lamp', () => {
    const fills = planFills(
      home,
      floors,
      overlay({ lights: { 'bathroom-light': lit() } }),
      {},
    );

    expect(fills.get('bathroom')).toBe(litFill('#a5c8a2', lamp, 1));
    expect(fills.has('hall')).toBe(false);
  });

  it('lights a room whose area is on even without a fixture state', () => {
    const fills = planFills(
      home,
      floors,
      overlay({ rooms: { hall: lit(0.5) } }),
      {},
    );

    expect(fills.get('hall')).toBe(litFill('#7fa8c9', lamp, 0.5));
  });

  it('grows warmer with brightness', () => {
    const base = '#a5c8a2';
    const dim = litFill(base, lamp, 0.1);
    const half = litFill(base, lamp, 0.5);
    const full = litFill(base, lamp, 1);

    expect(distance(base, dim)).toBeLessThan(distance(base, half));
    expect(distance(base, half)).toBeLessThan(distance(base, full));
  });

  it('shows a lamp that is on at its lowest brightness', () => {
    expect(litFill('#a5c8a2', lamp, 0)).not.toBe('#a5c8a2');
  });

  it('uses the plan warm colour for a white or unknown lamp', () => {
    expect(litFill('#a5c8a2', '#ffffff', 1)).toBe(PLAN_WARM);
    expect(litFill('#a5c8a2', null, 1)).toBe(PLAN_WARM);
  });

  it('keeps the hue of a coloured lamp', () => {
    const [r, g, b] = channels(litFill('#a5c8a2', '#3060ff', 1));

    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('takes the brightest of a room and its lights', () => {
    const light = roomLight(
      home,
      'hall',
      overlay({
        rooms: { hall: lit(0.2) },
        lights: { 'hall-light': lit(0.9) },
      }),
    );

    expect(light?.brightness).toBe(0.9);
  });

  it('reads a room with every light off as unlit', () => {
    expect(
      roomLight(
        home,
        'hall',
        overlay({ lights: { 'hall-light': { ...lit(), on: false } } }),
      ),
    ).toBeNull();
  });
});

describe('the fill of a room in danger', () => {
  const marks: RoomMarks = {
    bathroom: { occupied: false, tint: null, danger: 'room' },
    hall: { occupied: true, tint: '#88aacc', danger: null },
  };

  it('fills a room with a critical alert in the danger colour, lit or not', () => {
    const fills = planFills(
      home,
      floors,
      overlay({ lights: { 'bathroom-light': lit() } }),
      marks,
    );

    expect(fills.get('bathroom')).toBe(DANGER_FILL);
  });

  it('keeps a temperature tint on an unlit room', () => {
    expect(planFills(home, floors, overlay(), marks).get('hall')).toBe(
      '#88aacc',
    );
  });
});

describe('the fill of a room at night', () => {
  it('darkens every unlit room', () => {
    const fills = planFills(home, floors, overlay(), {}, true);

    expect(luminance(fills.get('hall') ?? '#ffffff')).toBeLessThan(
      luminance('#7fa8c9'),
    );
    expect(fills.size).toBe(3);
  });

  it('leaves a lit room glowing', () => {
    const fills = planFills(
      home,
      floors,
      overlay({ lights: { 'hall-light': lit() } }),
      {},
      true,
    );

    expect(fills.get('hall')).toBe(litFill('#7fa8c9', lamp, 1));
  });
});

describe('the pools of light', () => {
  it('pools light at every lamp that is on, in its room', () => {
    const glows = planGlows(
      home,
      floors,
      null,
      overlay({ lights: { 'hall-light': lit(0.4) } }),
    );

    expect(glows).toHaveLength(1);
    expect(glows[0]).toMatchObject({ room: 'hall', strength: 0.4 });
  });

  it('pools nothing when every lamp is off', () => {
    expect(planGlows(home, floors, null, overlay())).toEqual([]);
  });

  it('pools nothing for a storey that is not drawn', () => {
    const stack = threeStoreyHome();
    const glows = planGlows(
      stack,
      deriveFloors(stack),
      'ufloor',
      overlay({ lights: { 'cellar-light': lit() } }),
    );

    expect(glows).toEqual([]);
  });
});

describe('where things sit on the plan', () => {
  it('puts a room at a point inside it', () => {
    const at = planPoint(home, floors, null, { type: 'room', id: 'hall' });

    expect(at).not.toBeNull();
    expect(roomAtPoint(floors, null, at ?? [0, 0])).toBe('hall');
  });

  it('puts a light inside the room it lights', () => {
    const at = planPoint(home, floors, null, {
      type: 'light',
      id: 'bathroom-light',
    });

    expect(roomAtPoint(floors, null, at ?? [0, 0])).toBe('bathroom');
  });

  it('puts a door on its wall', () => {
    const door = floors[0].floor.doors[0];
    const wall = floors[0].floor.walls.find(
      (entry) => entry.id === door.wallId,
    );
    const at = planPoint(home, floors, null, { type: 'door', id: door.id });

    if (!wall) throw new Error('the fixture door has no wall');

    expect(at).toEqual([
      wall.start.x + (wall.end.x - wall.start.x) * door.position,
      wall.start.y + (wall.end.y - wall.start.y) * door.position,
    ]);
  });

  it('spans a window along its wall, as wide as the window, facing into its room', () => {
    const span = openingSpan(windowedFloors, null, {
      type: 'window',
      id: 'win-north',
    });

    expect(span?.from).toEqual([-60, -210]);
    expect(span?.to).toEqual([60, -210]);
    expect(span?.inward[0]).toBeCloseTo(0);
    expect(span?.inward[1]).toBeCloseTo(1);
    expect(span?.thickness).toBe(15);
  });

  it('faces a window into its room whichever way its wall runs', () => {
    const span = openingSpan(windowedFloors, null, {
      type: 'window',
      id: 'win-west',
    });

    expect(span?.inward[0]).toBeCloseTo(1);
    expect(span?.inward[1]).toBeCloseTo(0);
  });

  it('measures how far the centre line of the room on each side lies from an opening', () => {
    const door = openingSpan(floors, null, { type: 'door', id: 'd2' });
    const pane = openingSpan(windowedFloors, null, {
      type: 'window',
      id: 'win-north',
    });

    expect(door?.inner).toBeCloseTo(210, 0);
    expect(door?.outer).toBeCloseTo(90, 0);
    expect(pane?.inner).toBeCloseTo(210, 0);
    expect(pane?.outer).toBeNull();
  });

  it('spans nothing for an opening on a storey that is not drawn', () => {
    const stack = deriveFloors(threeStoreyHome());

    expect(
      openingSpan(stack, 'ufloor', { type: 'door', id: 'bd1' }),
    ).toBeNull();
    expect(
      openingSpan(stack, 'bfloor', { type: 'door', id: 'bd1' }),
    ).not.toBeNull();
  });

  it('places nothing from a storey that is not drawn', () => {
    const stack = threeStoreyHome();
    const derived = deriveFloors(stack);

    expect(
      planPoint(stack, derived, 'ufloor', { type: 'room', id: 'cellar' }),
    ).toBeNull();
    expect(
      planPoint(stack, derived, 'bfloor', { type: 'room', id: 'cellar' }),
    ).not.toBeNull();
  });

  it('finds no room outside the walls', () => {
    expect(roomAtPoint(floors, null, [-100000, -100000])).toBeNull();
  });

  it('finds a point inside a room shaped like an L', () => {
    const ell: [number, number][] = [
      [0, 0],
      [400, 0],
      [400, 100],
      [100, 100],
      [100, 400],
      [0, 400],
    ];
    const [x, y] = visualCentre(ell);

    expect(x < 100 || y < 100).toBe(true);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it('finds the middle of a plain rectangle', () => {
    const [x, y] = visualCentre([
      [0, 0],
      [400, 0],
      [400, 200],
      [0, 200],
    ]);

    expect(x).toBeCloseTo(200, 0);
    expect(y).toBeCloseTo(100, 0);
  });

  it('puts the visual centre of an L in its widest part, clear of the walls', () => {
    const ell: [number, number][] = [
      [0, 0],
      [600, 0],
      [600, 300],
      [150, 300],
      [150, 600],
      [0, 600],
    ];
    const [x, y] = visualCentre(ell);

    expect(y).toBeLessThan(300);
    expect(x).toBeGreaterThan(150);
    expect(Math.min(y, 300 - y)).toBeGreaterThan(120);
  });

  it('finds the middle of a square exactly', () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];

    expect(visualCentre(square)).toEqual([50, 50]);
  });
});

describe('the remembered view', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps one choice per card', () => {
    const one = viewKey({ type: 'custom:estanza-card', home: 'a' });
    const two = viewKey({ type: 'custom:estanza-card', home: 'b' });

    writeViewChoice(one, '2d');

    expect(one).not.toBe(two);
    expect(readViewChoice(one)).toBe('2d');
    expect(readViewChoice(two)).toBeNull();
  });

  it('gives the same card the same key every time', () => {
    const config = { type: 'custom:estanza-card', home: 'a' };

    expect(viewKey(config)).toBe(viewKey({ ...config }));
  });

  it('stores the choice under the card view prefix', () => {
    writeViewChoice('card-a', '2d');

    expect(localStorage.getItem('estanza-card.view:card-a')).toBe('2d');
  });

  it('ignores a stored value that is not a view', () => {
    localStorage.setItem('estanza-card.view:card-a', 'plan');

    expect(readViewChoice('card-a')).toBeNull();
  });

  it('carries on when storage is refused', () => {
    vi.stubGlobal('localStorage', refusingStorage());

    expect(() => writeViewChoice('card-a', '2d')).not.toThrow();
    expect(readViewChoice('card-a')).toBeNull();
  });
});
