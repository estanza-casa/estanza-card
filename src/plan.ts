import type { HomeDocument } from '@estanza/plan-engine';
import {
  type DerivedFloor,
  floorOfItem,
  groundFloor,
  resolvePosition,
} from '@estanza/plan-engine/geometry/geometry.js';
import { ROOM_FILL } from '@estanza/plan-engine/geometry/plan-drawing.js';

import type { SceneScope, View } from './bindings.js';
import type { FloorChoice } from './floors.js';
import type { Vec2 } from './living.js';
import { DANGER_FILL, type RoomMarks } from './room-marks.js';
import type { SceneLightOverlay, SceneOverlay } from './scene-view.js';

export const VIEW_SWITCH_MS = 600;
export const VIEW_FADE_MS = 200;
export const PLAN_WARM = '#f59a3d';
export const LIT_FLOOR = 0.45;
export const NIGHT_SHADE = '#0b1839';
export const NIGHT_DROP = 2 / 3;
export const NAME_HEIGHT_PX = 20;
export const NAME_STACK_GAP_PX = 4;

const LIT_SATURATION = 0.85;
const LIT_LIGHTNESS = 0.58;
const GREY_SATURATION = 0.1;
const INSIDE_SAMPLES = 16;
const REFINE_ROUNDS = 4;
const REFINE_CELLS = 8;
const CENTRE_PULL = 0.1;
const INWARD_PROBE_CM = 20;
const STORAGE_PREFIX = 'estanza-card.view:';

type Hsl = { h: number; s: number; l: number };

const centres = new WeakMap<readonly Vec2[], Vec2>();

export function planFloor(
  floors: readonly DerivedFloor[],
  choice: FloorChoice,
): string | null {
  if (floors.length < 2) return null;
  if (choice && floors.some((floor) => floor.id === choice)) return choice;

  const roomed = floors.filter((floor) => floor.rooms.length > 0);

  return groundFloor(roomed.length > 0 ? roomed : [...floors]).id;
}

export function planFills(
  home: HomeDocument,
  floors: readonly DerivedFloor[],
  overlay: SceneOverlay,
  marks: RoomMarks,
  night = false,
): Map<string, string> {
  const fills = new Map<string, string>();

  for (const floor of floors) {
    for (const room of floor.rooms) {
      const mark = own(marks, room.slug);
      const base = room.floorColor ?? ROOM_FILL;
      const light = roomLight(home, room.slug, overlay);

      if (mark?.danger === 'room') fills.set(room.slug, DANGER_FILL);
      else if (light) {
        fills.set(room.slug, litFill(base, light.color, light.brightness ?? 1));
      } else if (mark?.tint) fills.set(room.slug, mark.tint);
      else if (night)
        fills.set(room.slug, mixHex(base, NIGHT_SHADE, NIGHT_DROP));
    }
  }

  return fills;
}

export function roomLight(
  home: HomeDocument,
  slug: string,
  overlay: SceneOverlay,
): SceneLightOverlay | null {
  const states = [
    own(overlay.rooms, slug),
    ...home.additions.lights
      .filter((light) => light.room === slug)
      .map((light) => own(overlay.lights, light.slug)),
  ];
  const lit = states.filter(
    (state): state is SceneLightOverlay => state?.on === true,
  );

  if (lit.length === 0) return null;

  const brightest = Math.max(...lit.map((state) => state.brightness ?? 1));

  return {
    on: true,
    brightness: brightest,
    color: lit.find((state) => state.color)?.color ?? null,
  };
}

export type Glow = {
  room: string;
  at: Vec2;
  colour: string;
  strength: number;
};

export type OpeningSpan = {
  at: Vec2;
  from: Vec2;
  to: Vec2;
  inward: Vec2;
  thickness: number;
  inner: number | null;
  outer: number | null;
};

export function planGlows(
  home: HomeDocument,
  floors: readonly DerivedFloor[],
  active: string | null,
  overlay: SceneOverlay,
): Glow[] {
  const glows: Glow[] = [];
  const fitted = new Set<string>();

  for (const light of home.additions.lights) {
    const state =
      own(overlay.lights, light.slug) ??
      (light.room ? own(overlay.rooms, light.room) : undefined);
    const at = planPoint(home, floors, active, {
      type: 'light',
      id: light.slug,
    });
    const room = at ? roomAtPoint(floors, active, at) : null;

    if (light.room) fitted.add(light.room);
    if (!state?.on || !at || !room) continue;

    glows.push({
      room,
      at,
      colour: deepen(state.color),
      strength: Math.min(1, Math.max(0, state.brightness ?? 1)),
    });
  }

  for (const [slug, state] of Object.entries(overlay.rooms)) {
    if (!state.on || fitted.has(slug)) continue;

    const at = planPoint(home, floors, active, { type: 'room', id: slug });

    if (!at) continue;

    glows.push({
      room: slug,
      at,
      colour: deepen(state.color),
      strength: Math.min(1, Math.max(0, state.brightness ?? 1)),
    });
  }

  return glows;
}

export function litFill(
  base: string,
  lamp: string | null,
  brightness: number,
): string {
  const strength = Math.min(1, Math.max(0, brightness));

  return mixHex(base, deepen(lamp), LIT_FLOOR + (1 - LIT_FLOOR) * strength);
}

function deepen(lamp: string | null): string {
  const colour = lamp ? hexToHsl(lamp) : null;

  if (!colour || colour.s < GREY_SATURATION) return PLAN_WARM;

  return hslToHex({
    h: colour.h,
    s: Math.max(colour.s, LIT_SATURATION),
    l: LIT_LIGHTNESS,
  });
}

export function planPoint(
  home: HomeDocument,
  floors: readonly DerivedFloor[],
  active: string | null,
  scope: SceneScope,
): Vec2 | null {
  const shown = (id: string) => active === null || id === active;
  const all = [...floors];

  if (scope.type === 'room') {
    const floor = all.find((entry) => entry.roomsBySlug.has(scope.id));
    const room = floor?.roomsBySlug.get(scope.id);

    return floor && room && shown(floor.id) ? visualCentre(room.poly) : null;
  }

  if (scope.type === 'door' || scope.type === 'window') {
    return openingSpan(floors, active, scope)?.at ?? null;
  }

  const items =
    scope.type === 'light' ? home.additions.lights : home.additions.props;
  const item = items.find((entry) => entry.slug === scope.id);

  if (!item || all.length === 0 || !shown(floorOfItem(item, all).id)) {
    return null;
  }

  const rooms = new Map(all.flatMap((floor) => [...floor.roomsBySlug]));

  return resolvePosition(item, rooms, all);
}

export function openingSpan(
  floors: readonly DerivedFloor[],
  active: string | null,
  scope: SceneScope,
): OpeningSpan | null {
  if (scope.type !== 'door' && scope.type !== 'window') return null;

  for (const floor of floors) {
    const openings =
      scope.type === 'door' ? floor.floor.doors : floor.floor.windows;
    const opening = openings.find((item) => item.id === scope.id);
    const wall = floor.floor.walls.find(
      (entry) => entry.id === opening?.wallId,
    );

    if (!opening || !wall) continue;
    if (active !== null && floor.id !== active) return null;

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const along: Vec2 = [dx / length, dy / length];
    const side: Vec2 = [-along[1], along[0]];
    const at: Vec2 = [
      wall.start.x + dx * opening.position,
      wall.start.y + dy * opening.position,
    ];
    const half = opening.width / 2;
    const reach = wall.thickness / 2 + INWARD_PROBE_CM;
    const onSide = (facing: Vec2) =>
      floor.roomAt([at[0] + facing[0] * reach, at[1] + facing[1] * reach]);
    const roomward = onSide(side);
    const inward: Vec2 = roomward ? side : [-side[0], -side[1]];
    const outward: Vec2 = [-inward[0], -inward[1]];
    const depth = (facing: Vec2): number | null => {
      const room = onSide(facing);

      if (!room || room.poly.length < 3) return null;

      const [x, y] = visualCentre(room.poly);
      const ahead = (x - at[0]) * facing[0] + (y - at[1]) * facing[1];

      return ahead > wall.thickness / 2 ? ahead : null;
    };

    return {
      at,
      from: [at[0] - along[0] * half, at[1] - along[1] * half],
      to: [at[0] + along[0] * half, at[1] + along[1] * half],
      inward,
      thickness: wall.thickness,
      inner: depth(inward),
      outer: depth(outward),
    };
  }

  return null;
}

export function roomAtPoint(
  floors: readonly DerivedFloor[],
  active: string | null,
  point: Vec2,
): string | null {
  for (const floor of floors) {
    if (active !== null && floor.id !== active) continue;

    const room = floor.roomAt(point);

    if (room) return room.slug;
  }

  return null;
}

export function visualCentre(poly: readonly Vec2[]): Vec2 {
  if (poly.length < 3) return poly[0] ?? [0, 0];

  const known = centres.get(poly);

  if (known) return known;

  const found = searchCentre(poly);

  centres.set(poly, found);

  return found;
}

function searchCentre(poly: readonly Vec2[]): Vec2 {
  const middle: Vec2 = [
    poly.reduce((sum, [x]) => sum + x, 0) / poly.length,
    poly.reduce((sum, [, y]) => sum + y, 0) / poly.length,
  ];
  const score = (point: Vec2): number =>
    inside(point, poly)
      ? edgeDistance(point, poly) -
        CENTRE_PULL * Math.hypot(point[0] - middle[0], point[1] - middle[1])
      : -Infinity;
  const xs = poly.map(([x]) => x);
  const ys = poly.map(([, y]) => y);
  let step =
    Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ) / INSIDE_SAMPLES;
  let best: Vec2 = middle;
  let bestScore = score(middle);
  let from: Vec2 = [Math.min(...xs), Math.min(...ys)];
  let cells = INSIDE_SAMPLES;

  for (let round = 0; round < REFINE_ROUNDS; round += 1) {
    for (let i = 0; i <= cells; i += 1) {
      for (let j = 0; j <= cells; j += 1) {
        const point: Vec2 = [from[0] + i * step, from[1] + j * step];
        const value = score(point);

        if (value > bestScore) {
          best = point;
          bestScore = value;
        }
      }
    }

    from = [best[0] - step, best[1] - step];
    step /= REFINE_CELLS / 2;
    cells = REFINE_CELLS;
  }

  return best;
}

export function viewKey(config: object): string {
  return `${location.pathname}|${hashOf(JSON.stringify(config))}`;
}

export function readViewChoice(key: string): View | null {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);

    return stored === '2d' || stored === '3d' ? stored : null;
  } catch {
    return null;
  }
}

export function writeViewChoice(key: string, view: View): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, view);
  } catch {
    return;
  }
}

function own<TValue>(
  record: Record<string, TValue>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function hashOf(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

function inside([x, y]: Vec2, poly: readonly Vec2[]): boolean {
  let hit = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[j];

    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      hit = !hit;
    }
  }

  return hit;
}

function edgeDistance([x, y]: Vec2, poly: readonly Vec2[]): number {
  let nearest = Infinity;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t =
      span === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / span));

    nearest = Math.min(nearest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }

  return nearest;
}

function mixHex(from: string, to: string, k: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);

  if (!a || !b) return to;

  return hexOf(a.map((channel, index) => channel + (b[index] - channel) * k));
}

function rgbOf(hex: string): number[] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());

  if (!match) return null;

  const value = Number.parseInt(match[1], 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hexOf(rgb: number[]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function hexToHsl(hex: string): Hsl | null {
  const rgb = rgbOf(hex);

  if (!rgb) return null;

  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];

  return hexOf([r, g, b].map((channel) => (channel + m) * 255));
}
