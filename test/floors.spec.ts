import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultFloor,
  floorName,
  floorOfScope,
  floorShortName,
  isMarked,
  linksByFloor,
  readFloorChoice,
  reframes,
  sceneStoreys,
  shellOutline,
  storeys,
  storeyView,
  writeFloorChoice,
} from '../src/floors.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage, refusingStorage } from './memory-storage.js';
import { threeStoreyHome } from './storeys.js';

const home = threeStoreyHome();
const floors = deriveFloors(home);

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the storeys of a home', () => {
  it('lists them top first with the webapp full and short names', () => {
    expect(storeys(floors).map(({ name, label }) => ({ name, label }))).toEqual(
      [
        { name: 'First floor', label: '1st' },
        { name: 'Ground floor', label: 'Grd' },
        { name: 'Basement', label: 'B' },
      ],
    );
  });
});

describe('the name a storey is shown by', () => {
  it('names every storey by its level, as the webapp does', () => {
    expect([-3, -1, 0, 1, 2, 3, 4, 5].map(floorName)).toEqual([
      'Basement 3',
      'Basement',
      'Ground floor',
      'First floor',
      'Second floor',
      'Third floor',
      'Fourth floor',
      'Floor 5',
    ]);
  });

  it('shortens every storey the way the webapp floors bar does', () => {
    expect([-3, -1, 0, 1, 2, 3, 4, 5].map(floorShortName)).toEqual([
      'B3',
      'B',
      'Grd',
      '1st',
      '2nd',
      '3rd',
      '4th',
      '5',
    ]);
  });

  it('ignores a stored floor name, which the webapp never shows', () => {
    const renamed = deriveFloors({
      ...home,
      plan: {
        ...home.plan,
        floors: home.plan.floors?.map((floor) => ({ ...floor, name: 'Loft' })),
      },
    });

    expect(storeys(renamed).map(({ name }) => name)).toEqual([
      'First floor',
      'Ground floor',
      'Basement',
    ]);
  });
});

describe('the storey a bound object stands on', () => {
  it('finds a light by the room it sits in', () => {
    expect(
      floorOfScope(home, floors, { type: 'light', id: 'cellar-light' }),
    ).toBe('bfloor');
  });

  it('finds a room by its slug', () => {
    expect(floorOfScope(home, floors, { type: 'room', id: 'bedroom' })).toBe(
      'ufloor',
    );
  });

  it('finds a door by the wall it opens in', () => {
    expect(floorOfScope(home, floors, { type: 'door', id: 'ud1' })).toBe(
      'ufloor',
    );
  });

  it('knows nothing of an object the home does not hold', () => {
    expect(
      floorOfScope(home, floors, { type: 'light', id: 'ghost' }),
    ).toBeNull();
  });
});

describe('the scene for a chosen storey', () => {
  it('keeps the storey and the ones below it, and drops the ones above', () => {
    const view = storeyView(home, floors, 'f1');

    expect(view.floors.map((floor) => floor.id)).toEqual(['bfloor', 'f1']);
    expect(view.explode).toBe(0);
  });

  it('drops the lights of the storeys above', () => {
    const slugs = storeyView(home, floors, 'f1').home.additions.lights.map(
      (light) => light.slug,
    );

    expect(slugs).toContain('cellar-light');
    expect(slugs).toContain('living-space-light');
    expect(slugs).not.toContain('bedroom-light');
  });

  it('pulls every storey apart for all floors', () => {
    const view = storeyView(home, floors, null);

    expect(view.floors).toHaveLength(3);
    expect(view.home).toBe(home);
    expect(view.explode).toBeGreaterThanOrEqual(1.5);
  });

  it('never pulls a single storey home apart', () => {
    const flat = homeDocumentSchema.parse(homeFixture);

    expect(storeyView(flat, deriveFloors(flat), null).explode).toBe(0);
  });

  it('shows everything for a storey it does not know', () => {
    expect(storeyView(home, floors, 'gone').floors).toHaveLength(3);
  });
});

describe('the storeys built into the scene', () => {
  const lit: HomeDocument = {
    ...home,
    additions: {
      ...home.additions,
      lights: home.additions.lights.map((light) => ({ ...light, on: true })),
    },
  };

  it('ghosts every other storey, above and below, by default', () => {
    const built = sceneStoreys(lit, floors, 'f1');

    expect([...built.faded].sort()).toEqual(['bfloor', 'ufloor']);
    expect(built.hidden.size).toBe(0);
    expect(built.home.additions.lights.map((light) => light.slug)).toEqual(
      lit.additions.lights.map((light) => light.slug),
    );
  });

  it('hides every other storey when the other floors are hidden', () => {
    const built = sceneStoreys(lit, floors, 'ufloor', 'hidden');

    expect([...built.hidden].sort()).toEqual(['bfloor', 'f1']);
    expect(built.faded.size).toBe(0);
  });

  it('keeps all floors paged on a phone as it was: the storeys above hidden, the ones below lit', () => {
    const built = sceneStoreys(lit, floors, 'f1', 'paged');
    const on = (slug: string) =>
      built.home.additions.lights.find((light) => light.slug === slug)?.on;

    expect([...built.hidden]).toEqual(['ufloor']);
    expect(built.faded.size).toBe(0);
    expect(on('bedroom-light')).toBe(false);
    expect(on('cellar-light')).toBe(true);
  });

  it('frames the storeys below the one on show, as the house was framed before', () => {
    expect([...sceneStoreys(lit, floors, 'ufloor').framed].sort()).toEqual([
      'bfloor',
      'f1',
    ]);
    expect([...sceneStoreys(lit, floors, 'f1', 'hidden').framed]).toEqual([
      'bfloor',
    ]);
    expect(sceneStoreys(lit, floors, 'bfloor').framed.size).toBe(0);
  });

  it('links only the storeys one level from the one on show, for their stairs', () => {
    expect([...sceneStoreys(lit, floors, 'ufloor').linked]).toEqual(['f1']);
    expect([...sceneStoreys(lit, floors, 'f1').linked].sort()).toEqual([
      'bfloor',
      'ufloor',
    ]);
  });

  it('puts out the lights of every storey not on show, and only those', () => {
    const lights = sceneStoreys(lit, floors, 'f1').home.additions.lights;
    const on = (slug: string) =>
      lights.find((light) => light.slug === slug)?.on;

    expect(on('bedroom-light')).toBe(false);
    expect(on('cellar-light')).toBe(false);
    expect(on('living-space-light')).toBe(true);
  });

  it('leaves every storey alone for all floors', () => {
    expect(sceneStoreys(lit, floors, null)).toEqual({
      home: lit,
      hidden: new Set(),
      faded: new Set(),
      linked: new Set(),
      framed: new Set(),
    });
    expect(sceneStoreys(lit, floors, null, 'hidden').hidden.size).toBe(0);
  });
});

describe('the storeys that carry room marks', () => {
  function marked(choice: string | null): string[] {
    const view = storeyView(home, floors, choice);

    return view.floors
      .filter((floor) => isMarked(view, floor))
      .map((floor) => floor.id);
  }

  it('marks only the chosen storey, not the ones under its floor', () => {
    expect(marked('f1')).toEqual(['f1']);
    expect(marked('ufloor')).toEqual(['ufloor']);
  });

  it('marks every storey when they are pulled apart', () => {
    expect(marked(null)).toHaveLength(3);
  });
});

describe('reframing on a new choice', () => {
  it('reframes when one storey follows another', () => {
    expect(reframes('f1', 'bfloor')).toBe(true);
  });

  it('reframes between a storey and all floors', () => {
    expect(reframes('f1', null)).toBe(true);
    expect(reframes(null, 'f1')).toBe(true);
  });

  it('keeps the frame when nothing changed or nothing was chosen before', () => {
    expect(reframes('f1', 'f1')).toBe(false);
    expect(reframes(null, null)).toBe(false);
    expect(reframes(undefined, 'f1')).toBe(false);
  });
});

function shellHome(): HomeDocument {
  const source = structuredClone(threeStoreyHome());

  for (const floor of source.plan.floors) {
    if (floor.id === 'f1') floor.rooms = [];
  }

  return homeDocumentSchema.parse(source);
}

describe('the storey a card opens on', () => {
  it('opens on the storey with the most linked things', () => {
    const links = new Map([
      ['bfloor', 1],
      ['ufloor', 3],
      ['f1', 2],
    ]);

    expect(defaultFloor(floors, links)).toBe('ufloor');
  });

  it('breaks a tie on links by the storey with the most rooms', () => {
    const ground = floors.find((floor) => floor.id === 'f1');
    const roomy = floors.find((floor) => floor.id === 'ufloor');
    const more = floors.map((floor) =>
      floor === roomy
        ? { ...floor, rooms: [...(ground?.rooms ?? []), ...floor.rooms] }
        : floor,
    );

    expect(
      defaultFloor(
        more,
        new Map([
          ['f1', 1],
          ['ufloor', 1],
        ]),
      ),
    ).toBe('ufloor');
  });

  it('never opens on a storey with no rooms, however many links it holds', () => {
    const shell = deriveFloors(shellHome());

    expect(defaultFloor(shell, new Map([['f1', 9]]))).toBe('ufloor');
  });

  it('opens a single storey home on the whole home', () => {
    const flat = homeDocumentSchema.parse(homeFixture);

    expect(defaultFloor(deriveFloors(flat), new Map())).toBeNull();
  });
});

describe('the linked things on each storey', () => {
  it('counts each linked thing once, on the storey it stands on', () => {
    const links = linksByFloor(home, floors, [
      { scope: { type: 'room', id: 'bedroom' }, entity_id: 'sensor.a' },
      { scope: { type: 'room', id: 'bedroom' }, entity_id: 'sensor.b' },
      { scope: { type: 'light', id: 'cellar-light' }, entity_id: 'light.c' },
      { scope: { type: 'light', id: 'ghost' }, entity_id: 'light.d' },
    ]);

    expect(Object.fromEntries(links)).toEqual({ ufloor: 1, bfloor: 1 });
  });
});

describe('a storey with no rooms', () => {
  const shell = shellHome();
  const shellFloors = deriveFloors(shell);

  it('keeps its walls, doors and windows under all floors, as the storey it is', () => {
    const view = storeyView(shell, shellFloors, null);
    const ground = view.floors.find((floor) => floor.id === 'f1');
    const source = shellFloors.find((floor) => floor.id === 'f1');

    expect(ground?.floor.walls).toEqual(source?.floor.walls);
    expect(ground?.floor.doors).toEqual(source?.floor.doors);
  });

  it('keeps its walls under a chosen storey above it', () => {
    const view = storeyView(shell, shellFloors, 'ufloor');

    expect(
      view.floors.find((floor) => floor.id === 'f1')?.floor.walls.length,
    ).toBeGreaterThan(0);
  });

  it('gets a floor laid inside its walls, alone and under all floors', () => {
    for (const choice of ['f1', 'ufloor', null]) {
      const view = storeyView(shell, shellFloors, choice);

      expect([...view.slabs.keys()]).toEqual(['f1']);
      expect(view.slabs.get('f1')?.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('gets a floor laid even when no storey shown has rooms', () => {
    const bare = structuredClone(homeFixture);

    bare.plan.floors[0].rooms = [];

    const parsed = homeDocumentSchema.parse(bare);

    expect(storeyView(parsed, deriveFloors(parsed), null).slabs.size).toBe(1);
  });

  it('lays no floor under a storey that has its rooms', () => {
    expect(storeyView(home, floors, null).slabs.size).toBe(0);
  });
});

describe('the outline of a shell', () => {
  const wall = (x0: number, y0: number, x1: number, y1: number) => ({
    id: `${x0}${y0}${x1}${y1}`,
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
    thickness: 15,
    height: 280,
  });

  it('follows walls that close a loop, whichever way each is drawn', () => {
    const outline = shellOutline([
      wall(0, 0, 400, 0),
      wall(400, 300, 400, 0),
      wall(400, 300, 0, 300),
      wall(0, 300, 0, 0),
    ]);

    expect(outline).toEqual([
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ]);
  });

  it('falls back to the box around walls that do not close', () => {
    expect(shellOutline([wall(0, 0, 400, 0), wall(100, 50, 100, 300)])).toEqual(
      [
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300],
      ],
    );
  });
});

describe('the remembered storey', () => {
  it('reads back the storey it was given', () => {
    writeFloorChoice('card-a', 'f1');

    expect(readFloorChoice('card-a')).toBe('f1');
  });

  it('reads back all floors', () => {
    writeFloorChoice('card-a', null);

    expect(readFloorChoice('card-a')).toBeNull();
  });

  it('keeps each card apart', () => {
    writeFloorChoice('card-a', 'f1');

    expect(readFloorChoice('card-b')).toBeUndefined();
  });

  it('ignores a value it did not write', () => {
    localStorage.setItem('estanza-card.floor:card-a', '{oops');

    expect(readFloorChoice('card-a')).toBeUndefined();
  });

  it('carries on when the browser refuses storage', () => {
    vi.stubGlobal('localStorage', refusingStorage());

    expect(() => writeFloorChoice('card-a', 'f1')).not.toThrow();
    expect(readFloorChoice('card-a')).toBeUndefined();
  });
});
