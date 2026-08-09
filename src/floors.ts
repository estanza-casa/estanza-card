import type { HomeDocument } from '@estanza/plan-engine';
import {
  type Anchored,
  defaultFloorName,
  type DerivedFloor,
  floorOfItem,
  groundFloor,
  type PlanWall,
  resolvePosition,
  type Vec2,
} from '@estanza/plan-engine/geometry/geometry.js';

import {
  DEFAULT_OTHER_FLOORS,
  type OtherFloors,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from './bindings.js';

export type FloorChoice = string | null;

export type Storey = {
  id: string;
  name: string;
  level: number;
  label: string;
};

export type StoreyView = {
  home: HomeDocument;
  floors: DerivedFloor[];
  explode: number;
  slabs: Map<string, Vec2[]>;
};

export type SceneStoreys = {
  home: HomeDocument;
  hidden: Set<string>;
  faded: Set<string>;
  linked: Set<string>;
  framed: Set<string>;
};

export const ALL_FLOORS_EXPLODE = 3;

const STORAGE_PREFIX = 'estanza-card.floor:';

export function storeys(floors: DerivedFloor[]): Storey[] {
  return [...floors]
    .sort((a, b) => b.level - a.level)
    .map((floor) => ({
      id: floor.id,
      name: floorName(floor.level),
      level: floor.level,
      label: floorShortName(floor.level),
    }));
}

export function floorName(level: number): string {
  return defaultFloorName(level);
}

// Copied from the webapp's floorShortName and its English catalogue
// (apps/webapp/src/app/shared/i18n/floor-name.ts, locales/en.json), which no package publishes.
const SHORT_NAMES: Record<string, string> = {
  '-1': 'B',
  '0': 'Grd',
  '1': '1st',
  '2': '2nd',
  '3': '3rd',
  '4': '4th',
};

export function floorShortName(level: number): string {
  const named = SHORT_NAMES[String(level)];

  if (named) return named;

  return level < 0 ? `B${String(-level)}` : String(level);
}

export function floorOfScope(
  home: HomeDocument,
  floors: DerivedFloor[],
  scope: SceneScope,
): string | null {
  const { type, id } = scope;

  if (type === 'room') {
    return floors.find((floor) => floor.roomsBySlug.has(id))?.id ?? null;
  }

  if (type === 'door' || type === 'window') {
    const openings = (floor: DerivedFloor) =>
      type === 'door' ? floor.floor.doors : floor.floor.windows;

    return (
      floors.find((floor) => openings(floor).some((item) => item.id === id))
        ?.id ?? null
    );
  }

  const items = type === 'light' ? home.additions.lights : home.additions.props;
  const item = items.find((candidate) => candidate.slug === id);

  return item && floors.length > 0 ? floorOfItem(item, floors).id : null;
}

export function roomOfPiece(
  home: HomeDocument,
  floors: DerivedFloor[],
  scope: SceneScope,
): string | null {
  const items: readonly (Anchored & { slug: string })[] =
    scope.type === 'light'
      ? home.additions.lights
      : scope.type === 'prop'
        ? home.additions.props
        : [];
  const piece = items.find((candidate) => candidate.slug === scope.id);

  if (!piece || floors.length === 0) return null;

  const floor = floorOfItem(piece, floors);

  if (piece.room && floor.roomsBySlug.has(piece.room)) return piece.room;

  return (
    floor.roomAt(resolvePosition(piece, floor.roomsBySlug, [floor]))?.slug ??
    null
  );
}

export function roomOfOpening(
  floors: readonly DerivedFloor[],
  scope: SceneScope,
): string | null {
  if (scope.type !== 'door' && scope.type !== 'window') return null;

  for (const floor of floors) {
    const openings =
      scope.type === 'door' ? floor.floor.doors : floor.floor.windows;
    const opening = openings.find((item) => item.id === scope.id);

    if (!opening) continue;

    return (
      floor.rooms.find((room) => room.walls.includes(opening.wallId))?.slug ??
      null
    );
  }

  return null;
}

export function storeyView(
  home: HomeDocument,
  floors: DerivedFloor[],
  choice: FloorChoice,
): StoreyView {
  const chosen = floors.find((floor) => floor.id === choice);

  if (!chosen) {
    return withSlabs({
      home,
      floors,
      explode: floors.length > 1 ? ALL_FLOORS_EXPLODE : 0,
    });
  }

  const above = new Set(
    floors
      .filter((floor) => floor.level > chosen.level)
      .map((floor) => floor.id),
  );

  if (above.size === 0) return withSlabs({ home, floors, explode: 0 });

  const below = <TItem extends Anchored>(items: TItem[]): TItem[] =>
    items.filter((item) => !above.has(floorOfItem(item, floors).id));

  return withSlabs({
    home: {
      ...home,
      additions: {
        ...home.additions,
        lights: below(home.additions.lights),
        props: below(home.additions.props),
      },
    },
    floors: floors.filter((floor) => !above.has(floor.id)),
    explode: 0,
  });
}

export function sceneStoreys(
  home: HomeDocument,
  floors: DerivedFloor[],
  choice: FloorChoice,
  others: OtherFloors | 'paged' = DEFAULT_OTHER_FLOORS,
): SceneStoreys {
  const chosen = floors.find((floor) => floor.id === choice);

  if (!chosen) {
    return {
      home,
      hidden: new Set(),
      faded: new Set(),
      linked: new Set(),
      framed: new Set(),
    };
  }

  const rest = floors.filter(
    (floor) =>
      floor !== chosen && (others !== 'paged' || floor.level > chosen.level),
  );
  const away = new Set(rest.map((floor) => floor.id));
  const linked = new Set(
    rest
      .filter((floor) => Math.abs(floor.level - chosen.level) === 1)
      .map((floor) => floor.id),
  );
  const framed = new Set(
    floors
      .filter((floor) => floor.level < chosen.level)
      .map((floor) => floor.id),
  );
  const lights = home.additions.lights.map((light) =>
    light.on && away.has(floorOfItem(light, floors).id)
      ? { ...light, on: false }
      : light,
  );

  return {
    home: { ...home, additions: { ...home.additions, lights } },
    hidden: others === 'ghosted' ? new Set() : away,
    faded: others === 'ghosted' ? away : new Set(),
    linked: others === 'ghosted' ? linked : new Set(),
    framed,
  };
}

function withSlabs(view: Omit<StoreyView, 'slabs'>): StoreyView {
  const slabs = new Map<string, Vec2[]>();

  for (const floor of view.floors) {
    if (floor.rooms.length > 0 || floor.floor.walls.length === 0) continue;

    slabs.set(floor.id, shellOutline(floor.floor.walls));
  }

  return { ...view, slabs };
}

export function isMarked(view: StoreyView, floor: DerivedFloor): boolean {
  if (view.explode > 0) return true;

  return floor.level >= Math.max(...view.floors.map((shown) => shown.level));
}

export function reframes(
  previous: FloorChoice | undefined,
  next: FloorChoice,
): boolean {
  return previous !== undefined && previous !== next;
}

export function defaultFloor(
  floors: DerivedFloor[],
  links: Map<string, number>,
): FloorChoice {
  if (floors.length < 2) return null;

  return busiestFloor(floors, links);
}

export function busiestFloor(
  floors: DerivedFloor[],
  links: Map<string, number>,
): string | null {
  const linksOn = (floor: DerivedFloor): number => links.get(floor.id) ?? 0;
  const [busiest] = floors
    .filter((floor) => floor.rooms.length > 0)
    .sort(
      (a, b) =>
        linksOn(b) - linksOn(a) ||
        b.rooms.length - a.rooms.length ||
        Math.abs(a.level) - Math.abs(b.level) ||
        b.level - a.level,
    );

  if (busiest) return busiest.id;

  return floors.length > 0 ? groundFloor(floors).id : null;
}

export function linksByFloor(
  home: HomeDocument,
  floors: DerivedFloor[],
  bindings: readonly SceneBinding[],
): Map<string, number> {
  const scopes = new Map<string, SceneScope>();

  for (const binding of bindings)
    scopes.set(scopeKey(binding.scope), binding.scope);

  const links = new Map<string, number>();

  for (const scope of scopes.values()) {
    const floor = floorOfScope(home, floors, scope);

    if (floor) links.set(floor, (links.get(floor) ?? 0) + 1);
  }

  return links;
}

export function shellOutline(walls: readonly PlanWall[]): Vec2[] {
  return wallLoop(walls) ?? wallBox(walls);
}

function wallLoop(walls: readonly PlanWall[]): Vec2[] | null {
  if (walls.length < 3) return null;

  const key = ({ x, y }: { x: number; y: number }): string =>
    `${Math.round(x)},${Math.round(y)}`;
  const unused = new Set(walls);
  const first = walls[0];
  const loop: Vec2[] = [[first.start.x, first.start.y]];
  let at = first.end;

  unused.delete(first);

  while (unused.size > 0) {
    const next = [...unused].find(
      (wall) => key(wall.start) === key(at) || key(wall.end) === key(at),
    );

    if (!next) return null;

    loop.push([at.x, at.y]);
    unused.delete(next);
    at = key(next.start) === key(at) ? next.end : next.start;
  }

  return key(at) === key(first.start) ? loop : null;
}

function wallBox(walls: readonly PlanWall[]): Vec2[] {
  const xs = walls.flatMap((wall) => [wall.start.x, wall.end.x]);
  const ys = walls.flatMap((wall) => [wall.start.y, wall.end.y]);

  if (xs.length === 0) return [];

  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];

  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function floorStorageKey(
  shareId: string,
  document: HomeDocument,
): string {
  return `${location.pathname}|${shareId || document.plan.id}`;
}

export function readFloorChoice(key: string): FloorChoice | undefined {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);

    if (stored === null) return undefined;

    const parsed: unknown = JSON.parse(stored);

    return parsed === null || typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeFloorChoice(key: string, choice: FloorChoice): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(choice));
  } catch {
    return;
  }
}
