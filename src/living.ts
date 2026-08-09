import type { NightSource } from './bindings.js';
import type { Rect } from './camera-rig.js';
import type { FloorChoice } from './floors.js';
import type { Point } from './gesture.js';
import type { HomeAssistant } from './hass-state.js';
import { isLateNight, msToLateNightChange } from './tablet.js';

export type ComfortBand = { min: number; max: number };

export type Band = 'cold' | 'comfort' | 'hot';

export type ComfortConfig = { comfort_min?: number; comfort_max?: number };

export type LabelSize = { width: number; height: number };

export type MarkBox = Point & LabelSize;

export type PillRequest = MarkBox & {
  key: string;
  priority: number;
  room: readonly Point[] | null;
  floor?: readonly Point[];
  inner?: readonly Point[];
  others?: readonly (readonly Point[])[];
  storey?: readonly (readonly Point[])[];
  floors?: readonly (readonly Point[])[];
};

export type StoreyPlace = LabelSize &
  Pick<PillRequest, 'room' | 'floor' | 'storey' | 'floors'>;

export type PlacedLabel = {
  key: string;
  x: number;
  y: number;
  anchor?: Point;
};

type Fit = 'whole' | 'centre' | 'near' | 'over';

type Spot = { spot: Point; anchor: Point | null };

export type Budget = { work: number };

type BoundRing = { ring: readonly Point[]; bounds: Rect };

type RingOffset = Point & { radius: number };

type RingSpot = RingOffset & { order: number };

export type Vec2 = [number, number];

export type Flag = 'cold' | 'hot';

export type Theme = 'light' | 'dark';

export type Look = { theme: Theme; night: boolean };

export type SunAngles = { elevation: number; azimuth: number };

export const NIGHT_ELEVATION = -3;

const CLOCK_DAY_FROM = 7 * 60;
const CLOCK_NIGHT_FROM = 20 * 60;

export const COMFORT_CELSIUS: ComfortBand = { min: 18, max: 26 };

export const OUTLIER_CELSIUS = 2;

export const TINT_OPACITY = 0.3;

export const LABEL_HEIGHT = 22;

export const SMALL_LABEL_HEIGHT = 18;

export const TABLET_LABEL_HEIGHT = 26;

export const TABLET_LABEL_SCALE = 1.2;

export const LEADER_REACH_PX = 48;

const LEADER_DOT_PX = 10;
const COLD_TINT = '#8296cf';
const HOT_TINT = '#d06855';
const DIGIT_WIDTH = 7.6;
const LABEL_PADDING = 16;
const SMALL_DIGIT_WIDTH = 6.8;
const SMALL_LABEL_PADDING = 12;
export const LABEL_GAP = 4;
const MAX_SHIFT_HEIGHTS = 2.5;
const SPOT_STEP_PX = 4;
const CLEAR_STEP_PX = 4;
const LINE_STEP_PX = 4;
const SIDES = [-1, 1];
const SPOT_REACH_PX = 200;
const SOFT_REACH_PX = 48;
const SEARCH_WORK = 1_700_000;
const OVER_WORK = SEARCH_WORK / 20;
const STRANDED_WORK = 6 * SEARCH_WORK;
const UNCROSS_PASSES = 6;
const STRANDED_STEP_PX = 8;
const STRANDED_REACH_PX = 160;
const SPOT_WORK = 50;
const RING_WORK = 6;
const BOX_WORK = 4;
const STOREY_WORK = 9 * BOX_WORK;
const REGION_SLACK_PX = 1;
const STOREY_SLACK_PX = 8;
const WALL_GRAZE_PX = 3;
const WALL_SIDE_PX = 2;
const WALL_CLEAR_PX = 6;
const CLEAN_REACH_PX = 40;
const NUDGE_STEP_PX = 0.5;
const NUDGE_STEPS = 4;
const NUDGE_REACH_PX = NUDGE_STEPS * NUDGE_STEP_PX;
const NUDGES = Array.from({ length: 2 * NUDGE_STEPS + 1 }, (_, row) =>
  Array.from({ length: 2 * NUDGE_STEPS + 1 }, (_, column) => ({
    x: (column - NUDGE_STEPS) * NUDGE_STEP_PX,
    y: (row - NUDGE_STEPS) * NUDGE_STEP_PX,
  })),
)
  .flat()
  .filter((nudge) => nudge.x !== 0 || nudge.y !== 0)
  .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
const FINE_RINGS = [...ringOffsets(SPOT_REACH_PX, SPOT_STEP_PX)];
const CARRY_REACH_PX = 48;
const CARRY_RINGS = FINE_RINGS.filter(
  (offset) => offset.radius > 0 && offset.radius <= CARRY_REACH_PX,
);
const RINGS = Array.from(
  { length: SPOT_REACH_PX / SPOT_STEP_PX + 1 },
  (_, ring): RingSpot[] =>
    FINE_RINGS.filter((offset) => offset.radius === ring * SPOT_STEP_PX)
      .map((offset, order) => ({ ...offset, order }))
      .sort((a, b) => a.y - b.y),
);

export function comfortBand(
  config: ComfortConfig,
  unit: string | null,
): ComfortBand {
  const fallback = inUnit(COMFORT_CELSIUS, unit);

  return {
    min: config.comfort_min ?? fallback.min,
    max: config.comfort_max ?? fallback.max,
  };
}

export function bandOf(temperature: number, band: ComfortBand): Band {
  if (temperature < band.min) return 'cold';
  if (temperature > band.max) return 'hot';

  return 'comfort';
}

export function formatTemperature(
  value: number,
  unit: string | null,
  system: string | null,
): string {
  const shown =
    unit && system && unit !== system
      ? fromCelsius(toCelsius(value, unit), system)
      : value;

  return `${shown.toFixed(1)}°`;
}

export function formatHumidity(value: number): string {
  return `${Math.round(value)}%`;
}

export function tintOf(band: Band): string | null {
  if (band === 'cold') return COLD_TINT;
  if (band === 'hot') return HOT_TINT;

  return null;
}

export function hasLocation(hass: HomeAssistant | undefined): boolean {
  const latitude = hass?.config?.latitude;
  const longitude = hass?.config?.longitude;

  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return false;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    return false;
  }

  return latitude !== 0 || longitude !== 0;
}

export function followsClock(
  source: NightSource,
  hass: HomeAssistant | undefined,
): boolean {
  if (source !== 'auto') return false;

  return !hasLocation(hass) || !hass?.states['sun.sun'];
}

export function msToClockNightChange(now: Date): number {
  return msToLateNightChange(now, CLOCK_NIGHT_FROM, CLOCK_DAY_FROM);
}

export function sunOf(
  source: NightSource,
  hass: HomeAssistant | undefined,
): SunAngles | null {
  if (source !== 'auto' || followsClock(source, hass)) return null;

  const attributes = hass?.states['sun.sun']?.attributes;
  const elevation = attributes?.elevation;
  const azimuth = attributes?.azimuth;

  if (typeof elevation !== 'number' || !Number.isFinite(elevation)) {
    return null;
  }
  if (typeof azimuth !== 'number' || !Number.isFinite(azimuth)) return null;

  return { elevation, azimuth };
}

export function isNight(
  source: NightSource,
  hass: HomeAssistant | undefined,
  now: Date = new Date(),
): boolean {
  if (source === 'day') return false;
  if (source === 'night') return true;
  if (followsClock(source, hass)) {
    return isLateNight(now, CLOCK_NIGHT_FROM, CLOCK_DAY_FROM);
  }

  const sun = sunOf(source, hass);

  if (sun) return sun.elevation <= NIGHT_ELEVATION;

  return hass?.states['sun.sun']?.state === 'below_horizon';
}

export function lookOf(
  source: NightSource,
  hass: HomeAssistant | undefined,
  now: Date = new Date(),
): Look {
  return {
    theme: hass?.themes?.darkMode ? 'dark' : 'light',
    night: isNight(source, hass, now),
  };
}

export function roomsInView(
  slugs: string[],
  choice: FloorChoice,
  floorOf: (slug: string) => string | null,
): string[] {
  if (choice === null) return slugs;

  return slugs.filter((slug) => floorOf(slug) === choice);
}

export function flagOf(
  value: number,
  all: readonly number[],
  band: ComfortBand,
  unit: string | null,
): Flag | null {
  if (value < band.min) return 'cold';
  if (value > band.max) return 'hot';

  const gap = unit === '°F' ? OUTLIER_CELSIUS * 1.8 : OUTLIER_CELSIUS;
  const middle = medianOf(all);

  if (value >= Math.max(...all) && value - middle >= gap) return 'hot';
  if (value <= Math.min(...all) && middle - value >= gap) return 'cold';

  return null;
}

export function labelWidth(text: string, small = false): number {
  if (small) return text.length * SMALL_DIGIT_WIDTH + SMALL_LABEL_PADDING;

  return text.length * DIGIT_WIDTH + LABEL_PADDING;
}

export function insidePolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

    if (crosses) inside = !inside;
  }

  return inside;
}

export function boxInside(
  at: Point,
  width: number,
  height: number,
  ring: readonly Point[],
): boolean {
  return [-1, 0, 1].every((sx) =>
    [-1, 0, 1].every((sy) =>
      insidePolygon(
        { x: at.x + (sx * width) / 2, y: at.y + (sy * height) / 2 },
        ring,
      ),
    ),
  );
}

export function pillInside(
  at: Point,
  width: number,
  height: number,
  ring: readonly Point[],
): boolean {
  const radius = height / 2;
  const straight = Math.max(width / 2 - radius, 0);
  const slant = radius * Math.SQRT1_2;
  const outline = [
    [straight + radius, 0],
    [straight + slant, slant],
    [straight, radius],
    [0, radius],
    [0, 0],
  ];

  for (const [dx, dy] of outline) {
    for (const sx of SIDES) {
      for (const sy of SIDES) {
        const point = { x: at.x + sx * dx, y: at.y + sy * dy };

        if (!insidePolygon(point, ring)) return false;
      }
    }
  }

  return true;
}

export function placePills(
  pills: readonly PillRequest[],
  taken: readonly MarkBox[],
  soft: readonly MarkBox[] = [],
  loose = true,
): PlacedLabel[] {
  const blocked: MarkBox[] = [...taken];
  const found = new Map<string, Spot>();
  const budget: Budget = { work: SEARCH_WORK };
  const ordered = pills
    .filter((pill) => !pill.room || holdsDot(pill.room))
    .sort((a, b) => b.priority - a.priority);
  const seat = (pill: PillRequest, fits: readonly Fit[], waiting: number) => {
    const allowance = budget.work / waiting;
    const share: Budget = { work: allowance };
    const spot = firstFit(pill, blocked, soft, fits, share);

    budget.work -= allowance - Math.max(share.work, 0);

    if (!spot) return;

    blocked.push({ ...spot.spot, width: pill.width, height: pill.height });

    if (spot.anchor) {
      blocked.push(dotAt(spot.anchor), ...lineBoxes(spot.spot, spot.anchor));
    }

    found.set(pill.key, spot);
  };

  ordered.forEach((pill, index) => {
    seat(pill, ['whole'], ordered.length - index);
  });

  const strays = loose
    ? ordered.filter((pill) => pill.room && !found.has(pill.key))
    : [];

  strays.forEach((pill, index) => {
    seat(
      pill,
      ['centre', pill.storey ? 'over' : 'near'],
      strays.length - index,
    );
  });

  return ordered.flatMap((pill) => {
    const spot = found.get(pill.key);

    if (!spot) return [];

    const { anchor } = spot;

    return [{ key: pill.key, ...spot.spot, ...(anchor ? { anchor } : {}) }];
  });
}

export function placedBoxes(label: PlacedLabel, size: LabelSize): MarkBox[] {
  const box = { x: label.x, y: label.y, ...size };

  return label.anchor
    ? [box, dotAt(label.anchor), ...lineBoxes(label, label.anchor)]
    : [box];
}

export function uncrossed<T extends PlacedLabel>(
  labels: readonly T[],
  sizeOf: (label: T) => LabelSize,
  blocked: readonly MarkBox[],
  fixed: ReadonlySet<string>,
): T[] {
  const out = [...labels];
  const boxOf = (label: T): MarkBox => ({
    x: label.x,
    y: label.y,
    ...sizeOf(label),
  });

  for (let pass = 0; pass < UNCROSS_PASSES; pass += 1) {
    const pair = crossingPair(out, fixed);

    if (!pair) break;

    const [one, two] = pair;
    const a = { ...out[one], x: out[two].x, y: out[two].y };
    const b = { ...out[two], x: out[one].x, y: out[one].y };
    const others = out
      .filter((_, index) => index !== one && index !== two)
      .map(boxOf);
    const clear = [a, b].every(
      (label) => !covered(boxOf(label), [...others, ...blocked]),
    );

    if (!clear) break;

    out[one] = a;
    out[two] = b;
  }

  return out;
}

export function overStorey(
  spot: Point,
  storey: readonly (readonly Point[])[] | undefined,
): boolean {
  if (!storey) return true;

  return withinRect(
    spot.x,
    spot.y,
    insetBy(boundsOf(storey.flat()), -STOREY_SLACK_PX),
  );
}

export function sitsOnStorey(
  label: PlacedLabel,
  place: StoreyPlace,
  glyphs: readonly MarkBox[],
): boolean {
  if (!place.storey) return true;
  if (!centreOnStorey(label, ringsOf(place.storey), place)) return false;
  if (!label.anchor) return true;
  if (covered(dotAt(label.anchor), glyphs)) return false;

  const box = {
    x: label.x,
    y: label.y,
    width: place.width,
    height: place.height,
  };

  return leaderAtHome(box, label.anchor, place);
}

export function strayKeys(
  labels: readonly PlacedLabel[],
  placeOf: (key: string) => StoreyPlace | undefined,
  glyphs: readonly MarkBox[],
  fixed: ReadonlySet<string>,
  dots: readonly MarkBox[] = [],
): Set<string> {
  const strays = new Set(
    labels
      .filter((label) => {
        const place = placeOf(label.key);

        if (fixed.has(label.key) || place === undefined) return false;

        return (
          !sitsOnStorey(label, place, glyphs) ||
          covered({ ...label, width: place.width, height: place.height }, dots)
        );
      })
      .map((label) => label.key),
  );
  const out = labels.filter((label) => !strays.has(label.key));

  for (
    let pair = crossingPair(out, new Set());
    pair;
    pair = crossingPair(out, new Set())
  ) {
    const [one, two] = pair;
    const drop = fixed.has(out[two].key) ? one : two;

    if (fixed.has(out[drop].key)) break;

    strays.add(out[drop].key);
    out.splice(drop, 1);
  }

  return strays;
}

export function homedPills(
  pills: readonly PillRequest[],
  taken: readonly MarkBox[],
  glyphs: readonly MarkBox[],
): { labels: PlacedLabel[]; stuck: Set<string> } {
  const blocked = [...taken];
  const stuck = new Set<string>();
  const labels = pills.map((pill) => {
    const found =
      ownRoomLabel(pill, blocked, glyphs) ?? besideLabel(pill, blocked, glyphs);
    const label = found ?? { key: pill.key, x: pill.x, y: pill.y };

    if (!found) stuck.add(pill.key);

    blocked.push(...placedBoxes(label, pill));

    return label;
  });

  return { labels, stuck };
}

export function nudgedPills(
  pills: readonly PillRequest[],
  taken: readonly MarkBox[],
): PlacedLabel[] {
  const blocked = [...taken];

  return pills.map((pill) => {
    const own = ownRings(pill);
    const home = own.find((ring) => insidePolygon(pill, ring));
    const spot = !covered(pill, blocked)
      ? pill
      : (CARRY_RINGS.map((offset) => ({
          x: pill.x + offset.x,
          y: pill.y + offset.y,
        })).find(
          (at) =>
            (!home || insidePolygon(at, home)) &&
            !covered({ ...pill, ...at }, blocked),
        ) ?? pill);

    blocked.push({ ...pill, ...spot });

    return { key: pill.key, x: spot.x, y: spot.y };
  });
}

function ownRoomLabel(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  discs: readonly MarkBox[],
): PlacedLabel | null {
  const own = ownRings(pill);

  for (const offset of FINE_RINGS) {
    const spot = { x: pill.x + offset.x, y: pill.y + offset.y };
    const box = { ...pill, ...spot };

    if (!own.some((ring) => insidePolygon(spot, ring))) continue;
    if (covered(box, blocked) || covered(box, discs)) continue;

    return { key: pill.key, ...spot };
  }

  return null;
}

function besideLabel(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  discs: readonly MarkBox[],
): PlacedLabel | null {
  const own = ownRings(pill);
  const rooms = ringsOf(pill.floors ?? pill.storey ?? []);
  const home = own.find((ring) => insidePolygon(pill, ring)) ?? own[0];

  if (!home) return null;

  const dots = freeDots(home, [...blocked, ...discs], { work: Infinity });

  if (dots.length === 0) return null;

  const anchor = dots.reduce((best, dot) =>
    Math.hypot(dot.x - pill.x, dot.y - pill.y) <
    Math.hypot(best.x - pill.x, best.y - pill.y)
      ? dot
      : best,
  );
  const reach = LEADER_REACH_PX + Math.max(pill.width, pill.height) / 2;

  for (const offset of ringOffsets(reach, STRANDED_STEP_PX)) {
    const spot = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const box = { ...pill, ...spot };
    const host = rooms.find(({ ring, bounds }) =>
      insideRing(spot, ring, bounds),
    );

    if (!host || own.some((ring) => insidePolygon(spot, ring))) continue;
    if (covered(box, blocked) || covered(box, discs)) continue;
    if (!oneWallAway(box, anchor, [...own, host.ring])) continue;

    return { key: pill.key, ...spot, anchor };
  }

  return null;
}

function oneWallAway(
  box: MarkBox,
  anchor: Point,
  rooms: readonly (readonly Point[])[],
): boolean {
  const steps = Math.ceil(Math.hypot(anchor.x - box.x, anchor.y - box.y) / 2);

  for (let step = 1; step < steps; step += 1) {
    const point = {
      x: box.x + ((anchor.x - box.x) * step) / steps,
      y: box.y + ((anchor.y - box.y) * step) / steps,
    };

    if (!rooms.some((ring) => distanceTo(point, ring) <= WALL_GRAZE_PX)) {
      return false;
    }
  }

  return true;
}

function ownRings(pill: PillRequest): (readonly Point[])[] {
  return [pill.room, pill.floor, pill.inner].flatMap((ring) =>
    ring ? [ring] : [],
  );
}

function crossingPair(
  labels: readonly PlacedLabel[],
  fixed: ReadonlySet<string>,
): [number, number] | null {
  for (let one = 0; one < labels.length; one += 1) {
    for (let two = one + 1; two < labels.length; two += 1) {
      const a = labels[one];
      const b = labels[two];

      if (!a.anchor || !b.anchor) continue;
      if (fixed.has(a.key) || fixed.has(b.key)) continue;
      if (segmentsCross(a, a.anchor, b, b.anchor)) return [one, two];
    }
  }

  return null;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point): number =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

export function covered(box: MarkBox, others: readonly MarkBox[]): boolean {
  return others.some((other) => clash(box, other));
}

type StrandedPass = 'on' | 'near' | 'free';

export function strandedPills(
  pills: readonly PillRequest[],
  taken: readonly MarkBox[],
  glyphs: readonly MarkBox[] = [],
  anywhere = true,
): PlacedLabel[] {
  const blocked = [...taken, ...glyphs];
  const soft = new Set(glyphs);
  const budget: Budget = { work: STRANDED_WORK };

  return pills.flatMap((pill, index) => {
    const allowance = budget.work / (pills.length - index);
    const share: Budget = { work: allowance };
    const spot = strandedSpot(pill, blocked, soft, anywhere, share);

    budget.work -= allowance - Math.max(share.work, 0);

    if (!spot) return [];

    const { anchor } = spot;

    blocked.push({ ...spot.spot, width: pill.width, height: pill.height });

    if (anchor) {
      blocked.push(dotAt(anchor), ...lineBoxes(spot.spot, anchor));
    }

    return [{ key: pill.key, ...spot.spot, ...(anchor ? { anchor } : {}) }];
  });
}

function strandedSpot(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  soft: ReadonlySet<MarkBox>,
  anywhere: boolean,
  budget: Budget,
): Spot | null {
  const ring = pill.inner ?? pill.room;
  const reach = STRANDED_REACH_PX + Math.max(pill.width, pill.height);
  const near = blockedNear(
    blocked,
    {
      left: pill.x - reach,
      top: pill.y - reach,
      right: pill.x + reach,
      bottom: pill.y + reach,
    },
    pill,
  );
  const discs = near.filter((box) => soft.has(box)).map(discOf);
  const dotBlocks = pill.storey
    ? [...near.filter((box) => !soft.has(box)), ...discs]
    : near;
  const free = ring ? freeDots(ring, dotBlocks, budget) : [];
  const dots = free.length > 0 ? free : [pill];
  const anchor = dots.reduce<Point | null>(
    (best, dot) =>
      !best ||
      Math.hypot(dot.x - pill.x, dot.y - pill.y) <
        Math.hypot(best.x - pill.x, best.y - pill.y)
        ? dot
        : best,
    null,
  );

  if (!anchor) return null;

  const crossed = near.filter((box) => !covered(dotAt(anchor), [box]));
  const hard = crossed.filter((box) => !soft.has(box));
  const storey = pill.storey ? ringsOf(pill.storey) : null;
  const outline = pill.storey
    ? insetBy(boundsOf(pill.storey.flat()), -STOREY_SLACK_PX)
    : null;
  const walls = [
    ...(storey ?? []),
    ...ringsOf([...(pill.room ? [pill.room] : []), ...(pill.others ?? [])]),
  ];
  const loose: [StrandedPass, readonly MarkBox[], boolean][] = [
    ['free', crossed, false],
    ['free', hard, false],
  ];
  const passes: [StrandedPass, readonly MarkBox[], boolean][] =
    storey && outline
      ? [
          ['on', crossed, true],
          ['near', crossed, true],
          ['on', crossed, false],
          ['near', crossed, false],
          ['on', hard, false],
          ['near', hard, false],
          ...(anywhere ? loose : []),
        ]
      : loose;

  const offsets = [...ringOffsets(STRANDED_REACH_PX, STRANDED_STEP_PX)];
  const onStoreyAt = new Map<number, boolean>();
  const clashAt = new Map<number, boolean>();
  const centreAt = new Map<number, boolean>();
  const homeAt = new Map<number, boolean>();
  const buried = covered(dotAt(anchor), discs);
  const homeReach = 2 * LEADER_REACH_PX + Math.max(pill.width, pill.height) / 2;

  for (const [pass, lines, clean] of passes) {
    for (const [index, offset] of offsets.entries()) {
      if (clean && offset.radius > CLEAN_REACH_PX) break;
      if (pass !== 'free' && offset.radius > homeReach) break;

      const spot = { x: anchor.x + offset.x, y: anchor.y + offset.y };
      const box = { ...pill, ...spot };

      if (pass !== 'free' && outline && !withinRect(box.x, box.y, outline)) {
        continue;
      }
      if (pass !== 'free' && storey) {
        if (!centreAt.has(index)) {
          budget.work -= SPOT_WORK + RING_WORK * storey.length;
          centreAt.set(index, centreOnStorey(spot, storey, pill));
        }
        if (!centreAt.get(index)) continue;
      }
      if (pass === 'on' && storey && outline) {
        if (!onStoreyAt.has(index)) {
          budget.work -= SPOT_WORK;
          onStoreyAt.set(index, onStorey(box, storey, outline));
        }
        if (!onStoreyAt.get(index)) continue;
      }
      if (!clashAt.has(index)) {
        budget.work -= SPOT_WORK + BOX_WORK * near.length;
        clashAt.set(index, covered(box, near));
      }
      if (budget.work < 0) return null;
      if (clashAt.get(index)) continue;
      if (clean && straddles(box, walls)) continue;

      const under =
        Math.abs(anchor.x - spot.x) < pill.width / 2 &&
        Math.abs(anchor.y - spot.y) < pill.height / 2;

      if (under) return { spot, anchor: null };
      if (!lineClear(box, anchor, lines)) continue;
      if (pass === 'free') return { spot, anchor };
      if (buried) continue;
      if (!homeAt.has(index)) {
        budget.work -= STOREY_WORK * walls.length;
        homeAt.set(index, leaderAtHome(box, anchor, pill));
      }
      if (homeAt.get(index)) return { spot, anchor };
    }
  }

  return null;
}

function firstFit(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  soft: readonly MarkBox[],
  fits: readonly Fit[],
  budget: Budget,
): Spot | null {
  const spilling = fits.filter((fit) => fit !== 'whole');
  const tries: [Fit, boolean][] = [
    ...fits.map((fit): [Fit, boolean] => [fit, true]),
    ...spilling.map((fit): [Fit, boolean] => [fit, false]),
  ];

  for (const [fit, clean] of tries) {
    const cushioned =
      soft.length > 0 && fit !== 'near' && fit !== 'over'
        ? freeSpot(pill, [...blocked, ...soft], fit, true, budget, clean)
        : null;

    if (cushioned) return cushioned;

    const bare =
      fit === 'over'
        ? cappedSpot(pill, blocked, clean, budget)
        : freeSpot(pill, blocked, fit, false, budget, clean);

    if (bare) return bare;
  }

  return null;
}

function cappedSpot(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  clean: boolean,
  budget: Budget,
): Spot | null {
  const allowed = Math.min(budget.work, OVER_WORK);
  const share = { work: allowed };
  const spot = freeSpot(pill, blocked, 'over', false, share, clean);

  budget.work -= allowed - Math.max(share.work, 0);

  return spot;
}

function holdsDot(room: readonly Point[]): boolean {
  const bounds = boundsOf(room);

  return (
    bounds.right - bounds.left >= LEADER_DOT_PX &&
    bounds.bottom - bounds.top >= LEADER_DOT_PX
  );
}

function reachable(size: LabelSize, room: readonly Point[], fit: Fit): Rect {
  const bounds = boundsOf(room);
  const grow = (by: Point): Rect => ({
    left: bounds.left - by.x - REGION_SLACK_PX,
    top: bounds.top - by.y - REGION_SLACK_PX,
    right: bounds.right + by.x + REGION_SLACK_PX,
    bottom: bounds.bottom + by.y + REGION_SLACK_PX,
  });

  if (fit === 'centre') return grow({ x: 0, y: 0 });
  if (fit === 'near' || fit === 'over')
    return grow({ x: LEADER_REACH_PX, y: LEADER_REACH_PX });

  return grow({
    x: NUDGE_REACH_PX - size.width / 2,
    y: NUDGE_REACH_PX - size.height / 2,
  });
}

function farthest(from: Point, region: Rect): number {
  return Math.max(
    Math.hypot(from.x - region.left, from.y - region.top),
    Math.hypot(from.x - region.right, from.y - region.top),
    Math.hypot(from.x - region.left, from.y - region.bottom),
    Math.hypot(from.x - region.right, from.y - region.bottom),
  );
}

function blockedNear(
  blocked: readonly MarkBox[],
  region: Rect,
  size: LabelSize,
): MarkBox[] {
  const halfWidth = Math.max(size.width, LEADER_DOT_PX) / 2 + LABEL_GAP;
  const halfHeight = Math.max(size.height, LEADER_DOT_PX) / 2 + LABEL_GAP;

  return blocked.filter(
    (box) =>
      box.x + box.width / 2 + halfWidth >= region.left &&
      box.x - box.width / 2 - halfWidth <= region.right &&
      box.y + box.height / 2 + halfHeight >= region.top &&
      box.y - box.height / 2 - halfHeight <= region.bottom,
  );
}

function insideRing(
  point: Point,
  ring: readonly Point[],
  bounds: Rect,
): boolean {
  if (point.x < bounds.left || point.x > bounds.right) return false;
  if (point.y < bounds.top || point.y > bounds.bottom) return false;

  return insidePolygon(point, ring);
}

function freeSpot(
  pill: PillRequest,
  blocked: readonly MarkBox[],
  fit: Fit,
  soft: boolean,
  budget: Budget,
  clean = false,
): Spot | null {
  const room = pill.room;
  const faces = pill.inner ?? room;
  const reach = room ? SPOT_REACH_PX : MAX_SHIFT_HEIGHTS * pill.height;
  const bounds = room ? boundsOf(room) : null;
  const within = faces ? boundsOf(faces) : null;
  const region = room ? reachable(pill, room, fit) : null;

  if (region && (region.left > region.right || region.top > region.bottom)) {
    return null;
  }

  const limit = Math.min(
    soft ? Math.min(reach, SOFT_REACH_PX) : reach,
    region ? farthest(pill, region) : reach,
  );
  const near = region ? blockedNear(blocked, region, pill) : blocked;
  const others = (pill.others ?? []).map((ring) => ({
    ring,
    bounds: boundsOf(ring),
  }));
  const storey = pill.storey?.map((ring) => ({ ring, bounds: boundsOf(ring) }));
  const outline = pill.storey
    ? insetBy(boundsOf(pill.storey.flat()), -STOREY_SLACK_PX)
    : null;
  let clear: Rect | null | undefined;

  for (const spot of spotsWithin(pill, limit, region, budget)) {
    budget.work -= SPOT_WORK + BOX_WORK * near.length;

    if (budget.work < 0) return null;

    const box = { ...pill, ...spot };

    if (covered(box, near)) continue;
    if (
      fit !== 'over' &&
      others.some((other) => insideRing(spot, other.ring, other.bounds))
    ) {
      continue;
    }
    if (!room || !bounds || !faces || !within) return { spot, anchor: null };

    if (wholeInside(box, faces, within)) return { spot, anchor: null };

    if (fit === 'whole') {
      const nudged = insidePolygon(spot, faces)
        ? nudgedInside(pill, spot, faces, within, near, budget)
        : null;

      if (nudged) return { spot: nudged, anchor: null };

      continue;
    }

    const gapped = {
      ...spot,
      width: pill.width + 2 * LABEL_GAP,
      height: pill.height + 2 * LABEL_GAP,
    };

    if (
      fit !== 'over' &&
      pill.inner &&
      overlapsAny(gapped, [...others, ...ringsOf([room])])
    ) {
      continue;
    }
    if (clean && straddles(box, [...others, ...ringsOf([room])])) {
      continue;
    }

    const reaches =
      fit === 'centre'
        ? insidePolygon(spot, faces)
        : distanceTo(spot, room) <= LEADER_REACH_PX;

    if (!reaches) continue;

    if (storey && outline) {
      budget.work -= STOREY_WORK * storey.length;

      if (!onStorey(box, storey, outline)) continue;
    }

    clear =
      clear === undefined ? clearDots(faces, within, near, budget) : clear;

    const anchor = leaderAnchor(faces, box, near, fit, budget, clear);

    if (anchor && lineClear(box, anchor, near)) return { spot, anchor };
  }

  return null;
}

function freeDots(
  room: readonly Point[],
  blocked: readonly MarkBox[],
  budget: Budget,
): Point[] {
  const bounds = boundsOf(room);
  const xs = evenSteps(bounds.left, bounds.right, LEADER_DOT_PX / 2);
  const ys = evenSteps(bounds.top, bounds.bottom, LEADER_DOT_PX / 2);

  budget.work -=
    xs.length * ys.length * (SPOT_WORK + BOX_WORK * blocked.length);

  const free = ys.flatMap((y) =>
    xs.flatMap((x) => {
      const spot = { x, y };

      return insidePolygon(spot, room) && !covered(dotAt(spot), blocked)
        ? [spot]
        : [];
    }),
  );
  const whole = free.filter((spot) =>
    boxInside(spot, LEADER_DOT_PX, LEADER_DOT_PX, room),
  );

  return whole.length > 0 ? whole : free;
}

function ringsOf(rings: readonly (readonly Point[])[]): BoundRing[] {
  return rings.map((ring) => ({ ring, bounds: boundsOf(ring) }));
}

function overlapsAny(box: MarkBox, rings: readonly BoundRing[]): boolean {
  return rings.some(
    ({ ring, bounds }) =>
      box.x + box.width / 2 >= bounds.left &&
      box.x - box.width / 2 <= bounds.right &&
      box.y + box.height / 2 >= bounds.top &&
      box.y - box.height / 2 <= bounds.bottom &&
      overlapsRing(box, ring),
  );
}

function straddles(box: MarkBox, rings: readonly BoundRing[]): boolean {
  const padded = {
    ...box,
    width: box.width + 2 * WALL_CLEAR_PX,
    height: box.height + 2 * WALL_CLEAR_PX,
  };

  return rings.some(
    ({ ring, bounds }) =>
      overlapsAny(padded, [{ ring, bounds }]) &&
      !boxInside(padded, padded.width, padded.height, ring),
  );
}

export function overlapsRing(box: MarkBox, ring: readonly Point[]): boolean {
  const cornerInside = [-1, 0, 1].some((sx) =>
    [-1, 0, 1].some((sy) =>
      insidePolygon(
        { x: box.x + (sx * box.width) / 2, y: box.y + (sy * box.height) / 2 },
        ring,
      ),
    ),
  );

  return (
    cornerInside ||
    ring.some(
      (corner) =>
        Math.abs(corner.x - box.x) < box.width / 2 &&
        Math.abs(corner.y - box.y) < box.height / 2,
    )
  );
}

function nudgedInside(
  size: LabelSize,
  spot: Point,
  room: readonly Point[],
  bounds: Rect,
  blocked: readonly MarkBox[],
  budget: Budget,
): Point | null {
  const core = 2 * NUDGE_REACH_PX * Math.SQRT2;

  if (!pillInside(spot, size.width - core, size.height - core, room)) {
    return null;
  }

  budget.work -= NUDGES.length * SPOT_WORK;

  for (const nudge of NUDGES) {
    const at = { x: spot.x + nudge.x, y: spot.y + nudge.y };
    const box = { ...at, width: size.width, height: size.height };

    if (wholeInside(box, room, bounds) && !covered(box, blocked)) return at;
  }

  return null;
}

function wholeInside(
  box: MarkBox,
  room: readonly Point[],
  bounds: Rect,
): boolean {
  if (box.x - box.width / 2 < bounds.left) return false;
  if (box.x + box.width / 2 > bounds.right) return false;
  if (box.y - box.height / 2 < bounds.top) return false;
  if (box.y + box.height / 2 > bounds.bottom) return false;

  return pillInside(box, box.width, box.height, room);
}

function onStorey(
  box: MarkBox,
  storey: readonly { ring: readonly Point[]; bounds: Rect }[],
  outline: Rect,
): boolean {
  if (
    !withinRect(box.x - box.width / 2, box.y - box.height / 2, outline) ||
    !withinRect(box.x + box.width / 2, box.y + box.height / 2, outline)
  ) {
    return false;
  }

  return [-1, 0, 1].every((sx) =>
    [-1, 0, 1].every((sy) => {
      const point = {
        x: box.x + (sx * box.width) / 2,
        y: box.y + (sy * box.height) / 2,
      };

      return (
        storey.some(({ ring, bounds }) => insideRing(point, ring, bounds)) ||
        storey.some(
          ({ ring, bounds }) =>
            withinRect(point.x, point.y, insetBy(bounds, -STOREY_SLACK_PX)) &&
            distanceTo(point, ring) <= STOREY_SLACK_PX,
        )
      );
    }),
  );
}

function centreOnStorey(
  spot: Point,
  storey: readonly BoundRing[],
  own: Pick<PillRequest, 'room' | 'floor'>,
): boolean {
  if (storey.some(({ ring, bounds }) => insideRing(spot, ring, bounds))) {
    return true;
  }

  return [own.room, own.floor].some(
    (ring) => ring && edgeDistance(spot, ring) <= WALL_SIDE_PX,
  );
}

function leaderAtHome(
  box: MarkBox,
  anchor: Point,
  place: Pick<PillRequest, 'room' | 'floor' | 'storey' | 'floors'>,
): boolean {
  const own = [place.room, place.floor].flatMap((ring) => (ring ? [ring] : []));
  const rings = ringsOf(place.floors ?? place.storey ?? []);
  const steps = Math.ceil(Math.hypot(anchor.x - box.x, anchor.y - box.y) / 2);

  for (let step = 1; step < steps; step += 1) {
    const point = {
      x: box.x + ((anchor.x - box.x) * step) / steps,
      y: box.y + ((anchor.y - box.y) * step) / steps,
    };
    const underPill =
      Math.abs(point.x - box.x) < box.width / 2 &&
      Math.abs(point.y - box.y) < box.height / 2;

    if (underPill || own.some((ring) => insidePolygon(point, ring))) continue;

    const crossed = rings.some(
      ({ ring, bounds }) =>
        insideRing(point, ring, bounds) &&
        edgeDistance(point, ring) > WALL_GRAZE_PX,
    );

    if (crossed) return false;
  }

  return true;
}

function leaderAnchor(
  room: readonly Point[],
  box: MarkBox,
  blocked: readonly MarkBox[],
  fit: Fit,
  budget: Budget,
  clear: Rect | null,
): Point | null {
  const region = reachable(box, room, 'centre');
  const reach = Math.min(
    LEADER_REACH_PX + box.width / 2,
    farthest(box, region),
  );
  const cost = { budget, blocked: blocked.length };
  const open = firstSpot(
    box,
    clear && overlap(region, clear),
    reach,
    cost,
    (spot) =>
      dotInside(spot, room, box) &&
      !covered(dotAt(spot), blocked) &&
      lineClear(box, spot, blocked),
  );

  if (open) return open;

  const under = firstSpot(
    box,
    overlap(region, insetBy(region, LEADER_DOT_PX / 2)),
    reach,
    cost,
    (spot) => dotInside(spot, room, box) && covered(dotAt(spot), blocked),
  );

  if (under || fit === 'centre') return under;

  return firstSpot(
    box,
    region,
    reach,
    cost,
    (spot) => insidePolygon(spot, room) && !clash(dotAt(spot), box),
  );
}

function firstSpot(
  from: Point,
  rect: Rect | null,
  reach: number,
  cost: { budget: Budget; blocked: number },
  fits: (spot: Point) => boolean,
): Point | null {
  if (!rect) return null;

  const first = Math.floor(closest(from, rect) / SPOT_STEP_PX);
  const last = Math.min(
    RINGS.length - 1,
    Math.floor(Math.min(reach, farthest(from, rect)) / SPOT_STEP_PX),
  );

  for (let ring = first; ring <= last; ring += 1) {
    const hits = ringHits(RINGS[ring], from, rect);

    cost.budget.work -= RING_WORK * (hits.scanned + 1);

    for (const offset of hits.inside) {
      cost.budget.work -= SPOT_WORK + BOX_WORK * cost.blocked;

      if (cost.budget.work < 0) return null;

      const spot = { x: from.x + offset.x, y: from.y + offset.y };

      if (fits(spot)) return spot;
    }
  }

  return null;
}

function ringHits(
  ring: readonly RingSpot[],
  from: Point,
  rect: Rect,
): { inside: RingSpot[]; scanned: number } {
  const low = rect.top - from.y;
  const high = rect.bottom - from.y;
  const inside: RingSpot[] = [];
  let start = 0;
  let end = ring.length;

  while (start < end) {
    const middle = (start + end) >> 1;

    if (ring[middle].y < low) start = middle + 1;
    else end = middle;
  }

  let index = start;

  for (; index < ring.length && ring[index].y <= high; index += 1) {
    const x = from.x + ring[index].x;

    if (x >= rect.left && x <= rect.right) inside.push(ring[index]);
  }

  inside.sort((a, b) => a.order - b.order);

  return { inside, scanned: index - start };
}

function dotInside(spot: Point, room: readonly Point[], box: MarkBox): boolean {
  return (
    insidePolygon(spot, room) &&
    !clash(dotAt(spot), box) &&
    boxInside(spot, LEADER_DOT_PX, LEADER_DOT_PX, room)
  );
}

function overlap(a: Rect, b: Rect): Rect | null {
  const both = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };

  return both.left <= both.right && both.top <= both.bottom ? both : null;
}

function closest(from: Point, rect: Rect): number {
  return Math.hypot(
    Math.max(rect.left - from.x, 0, from.x - rect.right),
    Math.max(rect.top - from.y, 0, from.y - rect.bottom),
  );
}

function clearDots(
  room: readonly Point[],
  bounds: Rect,
  blocked: readonly MarkBox[],
  budget: Budget,
): Rect | null {
  const xs = evenSteps(bounds.left, bounds.right, LEADER_DOT_PX / 2);
  const ys = evenSteps(bounds.top, bounds.bottom, LEADER_DOT_PX / 2);
  const clear = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };

  budget.work -=
    xs.length * ys.length * (SPOT_WORK + BOX_WORK * blocked.length);

  if (budget.work < 0) return null;

  for (const y of ys) {
    for (const x of xs) {
      const spot = { x, y };

      if (!boxInside(spot, LEADER_DOT_PX, LEADER_DOT_PX, room)) continue;
      if (covered(dotAt(spot), blocked)) continue;

      clear.left = Math.min(clear.left, x);
      clear.top = Math.min(clear.top, y);
      clear.right = Math.max(clear.right, x);
      clear.bottom = Math.max(clear.bottom, y);
    }
  }

  if (clear.left > clear.right) return null;

  return insetBy(clear, -CLEAR_STEP_PX);
}

function insetBy(rect: Rect, by: number): Rect {
  return {
    left: rect.left + by,
    top: rect.top + by,
    right: rect.right - by,
    bottom: rect.bottom - by,
  };
}

function evenSteps(from: number, to: number, inset: number): number[] {
  const first = from + inset;
  const last = to - inset;

  if (last < first) return [];

  const count = Math.ceil((last - first) / CLEAR_STEP_PX);

  return Array.from(
    { length: count + 1 },
    (_, index) => first + (count === 0 ? 0 : ((last - first) * index) / count),
  );
}

function withinRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function lineClear(
  box: MarkBox,
  to: Point,
  blocked: readonly MarkBox[],
): boolean {
  const steps = Math.ceil(Math.hypot(to.x - box.x, to.y - box.y) / 2);

  for (let step = 1; step < steps; step += 1) {
    const x = box.x + ((to.x - box.x) * step) / steps;
    const y = box.y + ((to.y - box.y) * step) / steps;
    const underPill =
      Math.abs(x - box.x) < box.width / 2 &&
      Math.abs(y - box.y) < box.height / 2;

    if (!underPill && covered({ x, y, width: 0, height: 0 }, blocked)) {
      return false;
    }
  }

  return true;
}

function lineBoxes(from: Point, to: Point): MarkBox[] {
  const steps = Math.ceil(
    Math.hypot(to.x - from.x, to.y - from.y) / LINE_STEP_PX,
  );

  return Array.from({ length: steps }, (_, step) => ({
    x: from.x + ((to.x - from.x) * step) / steps,
    y: from.y + ((to.y - from.y) * step) / steps,
    width: LINE_STEP_PX,
    height: LINE_STEP_PX,
  }));
}

function dotAt(at: Point): MarkBox {
  return { ...at, width: LEADER_DOT_PX, height: LEADER_DOT_PX };
}

function discOf(glyph: MarkBox): MarkBox {
  return {
    ...glyph,
    width: Math.max(glyph.width - LEADER_DOT_PX, 0),
    height: Math.max(glyph.height - LEADER_DOT_PX, 0),
  };
}

function distanceTo(point: Point, ring: readonly Point[]): number {
  if (insidePolygon(point, ring)) return 0;

  return edgeDistance(point, ring);
}

function edgeDistance(point: Point, ring: readonly Point[]): number {
  return Math.min(
    ...ring.map((a, index) => {
      const b = ring[(index + 1) % ring.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const along = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) /
            (dx * dx + dy * dy || 1),
        ),
      );

      return Math.hypot(point.x - a.x - along * dx, point.y - a.y - along * dy);
    }),
  );
}

function boundsOf(ring: readonly Point[]): Rect {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function* spotsAround(
  anchor: Point,
  reach: number,
  step = SPOT_STEP_PX,
): Generator<Point> {
  for (const offset of ringOffsets(reach, step)) {
    yield { x: anchor.x + offset.x, y: anchor.y + offset.y };
  }
}

function* ringOffsets(reach: number, step: number): Generator<RingOffset> {
  yield { x: 0, y: 0, radius: 0 };

  for (let radius = step; radius <= reach; radius += step) {
    const turns = Math.max(8, Math.ceil((Math.PI * 2 * radius) / step));

    for (let turn = 0; turn < turns; turn += 1) {
      const side = turn % 2 === 0 ? 1 : -1;
      const angle =
        Math.PI / 2 + side * Math.ceil(turn / 2) * ((Math.PI * 2) / turns);

      yield {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        radius,
      };
    }
  }
}

function spotsWithin(
  from: Point,
  reach: number,
  region: Rect | null,
  budget: Budget,
): Point[] {
  const spots: Point[] = [];

  for (const offset of FINE_RINGS) {
    if (offset.radius > reach) break;

    const x = from.x + offset.x;
    const y = from.y + offset.y;

    budget.work -= RING_WORK;

    if (region && !withinRect(x, y, region)) continue;

    spots.push({ x, y });
  }

  return spots;
}

export function insetPolygon(poly: Vec2[], by: number): Vec2[] {
  const inward = signedArea(poly) > 0 ? 1 : -1;

  return poly.map((vertex, index) => {
    const before = poly[(index - 1 + poly.length) % poly.length];
    const after = poly[(index + 1) % poly.length];
    const d1 = direction(before, vertex);
    const d2 = direction(vertex, after);
    const n1: Vec2 = [-d1[1] * inward * by, d1[0] * inward * by];
    const n2: Vec2 = [-d2[1] * inward * by, d2[0] * inward * by];
    const turn = cross(d1, d2);

    if (Math.abs(turn) < 1e-9) return [vertex[0] + n1[0], vertex[1] + n1[1]];

    const along = cross([n2[0] - n1[0], n2[1] - n1[1]], d2) / turn;

    return [
      vertex[0] + n1[0] + d1[0] * along,
      vertex[1] + n1[1] + d1[1] * along,
    ];
  });
}

function inUnit(band: ComfortBand, unit: string | null): ComfortBand {
  return { min: fromCelsius(band.min, unit), max: fromCelsius(band.max, unit) };
}

function fromCelsius(value: number, unit: string | null): number {
  if (unit === '°F') return value * 1.8 + 32;
  if (unit === 'K') return value + 273.15;

  return value;
}

function toCelsius(value: number, unit: string): number {
  if (unit === '°F') return (value - 32) / 1.8;
  if (unit === 'K') return value - 273.15;

  return value;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[half]
    : (sorted[half - 1] + sorted[half]) / 2;
}

function clash(a: MarkBox, b: MarkBox): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + LABEL_GAP &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + LABEL_GAP
  );
}

function signedArea(poly: Vec2[]): number {
  let sum = 0;

  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];

    sum += x0 * y1 - x1 * y0;
  }

  return sum / 2;
}

function direction(from: Vec2, to: Vec2): Vec2 {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;

  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}
