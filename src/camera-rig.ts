import { motionLive } from '@estanza/scene/env.js';
import { glideStep } from '@estanza/scene/explode.js';
import {
  ORBIT_DAMPING,
  ORBIT_MAX_POLAR,
  ORBIT_MIN_DISTANCE,
  ORBIT_MOUSE,
  orbitCeiling,
} from '@estanza/scene/orbit.js';
import { useBounds } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  Box3,
  MathUtils,
  type Object3D,
  PerspectiveCamera,
  Spherical,
  Vector3,
} from 'three';

import {
  type Framing,
  type HomePlace,
  HOUSE_BAND,
  HOUSE_MARGIN_PX,
  IDLE_RETURN_MS,
  PORTRAIT_CONTROLS_PX,
} from './tablet.js';

export const HOME_CAMERA: [number, number, number] = [9, 11, 9];

const PORTRAIT_ASPECT = 0.5;
const PHONE_ASPECT = 0.7;
const PORTRAIT_PITCH = MathUtils.degToRad(64);

export const STACK_PITCH = MathUtils.degToRad(40);
export const STACK_TOP_PITCH = MathUtils.degToRad(45);
export const STACK_LOW_PITCH = MathUtils.degToRad(35);

export type Pose = { position: Vector3; target: Vector3 };

export type RigControls = {
  target: Vector3;
  update: () => void;
  dispatchEvent?: (event: { type: 'start' }) => void;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  enableDamping?: boolean;
  enabled?: boolean;
};

export type RigFrame = { center: Vector3; distance: number; turn?: number };

export type RigStage = {
  camera: PerspectiveCamera;
  controls: RigControls | null;
  frame: () => RigFrame;
  size: { width: number; height: number };
  invalidate: () => void;
};

type Shift = { x: number; y: number };

export type Lens = { zoom: number; x: number; y: number };

export type Rect = { left: number; top: number; right: number; bottom: number };

export type PlanCell = {
  floor: string;
  centre: { x: number; y: number };
  scale: number;
};

type Insets = Rect;

type ScreenBox = { left: number; right: number; high: number; low: number };

type Rest = 'home' | 'plan' | 'spot' | 'free';

type SheetGlide = { from: Lens | null; start: number | null };

type Aim = 'home' | 'overhead' | 'fit' | 'back';

type Left = {
  pose: Pose;
  rest: Rest;
  focus: Focus | null;
  size: { width: number; height: number };
};

export type Spot = { centre: Vector3; axis: Vector3 | null };

export type Focus = () => Spot | null;

export type House = () => Vector3[];

export type RigSheet = {
  key: string;
  room: House;
  covered: Rect;
  reach?: Rect;
};

export type SheetMove = { scale: number; x: number; y: number };

type Reach = Pick<RigControls, 'minDistance' | 'maxDistance'>;

type Course = {
  start: number;
  from: Pose & { shift: Shift; lens: Lens; flat: number };
  to: Pose & { lens: Lens };
  reach: Reach | null;
};

type Ease = {
  place: HomePlace;
  ms: number;
  course: Course | null;
  focus: Focus | null;
  aim: Aim;
  landsOnInput: boolean;
  switching: boolean;
  waiting: { since: number | null } | null;
};

export const SPOT_PITCH_DEG = 65;
export const OVERHEAD_PHI = 0.01;
export const PLAN_THETA = 0;
export const FIT_MARGIN = 1.15;
export const PORTRAIT_TURN_DEG = 45;
export const HOUSE_AIR = 0.06;
export const HOUSE_SHARE = 0.7;
export const ROOM_LEGIBLE_PX = 48;
export const SHEET_FRAME_MARGIN_PX = 16;
export const ORBIT_SETUP = {
  enableDamping: true,
  dampingFactor: ORBIT_DAMPING,
  maxPolarAngle: ORBIT_MAX_POLAR,
  mouseButtons: ORBIT_MOUSE,
};

const UP = new Vector3(0, 1, 0);
const TURN_STEP_DEG = 5;
const TURN_GAIN = 1.01;
export const LENS_EASE_MS = 200;
export const SHEET_GLIDE_MS = 250;
const LENS_STEP_MS = 50;
const SWITCH_WAIT_MS = 250;
const LENS_GAP_MS = 2000;
const LENS_ZOOM_SNAP = 1e-3;
const LENS_PX_SNAP = 0.5;
const FLAT_ENOUGH = 0.999;
const SHOWN_AREA_SNAP_PX = 1;
const NO_INSETS: Insets = { left: 0, top: 0, right: 0, bottom: 0 };

export function clearInsets(
  clear: readonly Rect[],
  size: { width: number; height: number },
): Insets[] {
  return clear.reduce<Insets[]>(
    (options, rect) =>
      options.flatMap((insets) => [
        { ...insets, left: Math.max(insets.left, rect.right) },
        { ...insets, top: Math.max(insets.top, rect.bottom) },
        { ...insets, right: Math.max(insets.right, size.width - rect.left) },
        {
          ...insets,
          bottom: Math.max(insets.bottom, size.height - rect.top),
        },
      ]),
    [NO_INSETS],
  );
}

export function uncoveredAreas(
  covered: readonly Rect[],
  size: { width: number; height: number },
  margin = SHEET_FRAME_MARGIN_PX,
): Rect[] {
  return clearInsets(covered, size)
    .map((insets) => ({
      left: insets.left + margin,
      top: insets.top + margin,
      right: size.width - insets.right - margin,
      bottom: size.height - insets.bottom - margin,
    }))
    .filter((area) => area.right > area.left && area.bottom > area.top);
}

export function sheetFraming(
  room: Rect,
  house: Rect,
  areas: readonly Rect[],
): SheetMove {
  if (areas.some((area) => within(room, area))) return { scale: 1, x: 0, y: 0 };

  const pans = areas.flatMap((area): SheetMove[] => {
    const x = shortestPan([room.left, room.right], [area.left, area.right]);
    const y = shortestPan([room.top, room.bottom], [area.top, area.bottom]);

    return x === null || y === null ? [] : [{ scale: 1, x, y }];
  });

  if (pans.length > 0) {
    return pans.reduce((best, next) => (better(next, best) ? next : best));
  }

  const framings = areas.map((area) => {
    const move = fillInto(room, house, area);

    return { move, shown: shownOf(house, area, move) };
  });

  if (framings.length === 0) return { scale: 1, x: 0, y: 0 };

  return framings.reduce((best, next) => (fuller(next, best) ? next : best))
    .move;
}

export function stackFraming(house: Rect, areas: readonly Rect[]): SheetMove {
  if (areas.some((area) => within(house, area))) {
    return { scale: 1, x: 0, y: 0 };
  }

  const moves = areas.map((area): SheetMove => {
    const scale = Math.min(1, fitScale(house, area));

    return {
      scale,
      x:
        (area.left + area.right) / 2 - (scale * (house.left + house.right)) / 2,
      y:
        (area.top + area.bottom) / 2 - (scale * (house.top + house.bottom)) / 2,
    };
  });

  if (moves.length === 0) return { scale: 1, x: 0, y: 0 };

  return moves.reduce((best, next) => (better(next, best) ? next : best));
}

export function sheetPlacement(
  room: Rect,
  house: Rect,
  covers: readonly [Rect, ...Rect[]],
  clear: readonly Rect[],
  size: { width: number; height: number },
): { cover: Rect; move: SheetMove } {
  const placed = covers.map((cover) => ({
    cover,
    move: sheetFraming(room, house, uncoveredAreas([...clear, cover], size)),
  }));
  const opened = placed[0];

  if (opened.move.scale === 1) return opened;

  return placed.reduce((best, next) =>
    better(next.move, best.move) ? next : best,
  );
}

export function planSheetPlacement(
  room: Rect,
  cover: Rect,
  clear: readonly Rect[],
  size: { width: number; height: number },
  tag: Rect | null = null,
): SheetMove {
  const whole = tag ? unionOf(room, tag) : room;
  const options = clearInsets([...clear, cover], size);
  const seen = options.some(
    (insets) =>
      room.left >= insets.left &&
      room.top >= insets.top &&
      room.right <= size.width - insets.right &&
      room.bottom <= size.height - insets.bottom,
  );

  if (seen) return { scale: 1, x: 0, y: 0 };

  const areas = options.map((insets) => ({
    left: insets.left > 0 ? insets.left + SHEET_FRAME_MARGIN_PX : 0,
    top: insets.top > 0 ? insets.top + SHEET_FRAME_MARGIN_PX : 0,
    right:
      size.width -
      (insets.right > 0 ? insets.right + SHEET_FRAME_MARGIN_PX : 0),
    bottom:
      size.height -
      (insets.bottom > 0 ? insets.bottom + SHEET_FRAME_MARGIN_PX : 0),
  }));
  const pans = areas
    .filter((area) => area.right > area.left && area.bottom > area.top)
    .map((area) => {
      const fits = fitsIn(whole, area) ? 2 : 0;
      const x = clearing([whole.left, whole.right], [area.left, area.right]);
      const y = clearing([whole.top, whole.bottom], [area.top, area.bottom]);

      if (fits || !tag || !fitsIn(tag, area)) return { fits, x, y };

      return {
        fits: 1,
        x: clampTo(
          clearing([room.left, room.right], [area.left, area.right]),
          area.left - tag.left,
          area.right - tag.right,
        ),
        y: clampTo(
          clearing([room.top, room.bottom], [area.top, area.bottom]),
          area.top - tag.top,
          area.bottom - tag.bottom,
        ),
      };
    });
  const best = pans.reduce<(typeof pans)[number] | null>(
    (kept, next) =>
      !kept ||
      next.fits > kept.fits ||
      (next.fits === kept.fits &&
        Math.hypot(next.x, next.y) < Math.hypot(kept.x, kept.y))
        ? next
        : kept,
    null,
  );

  return { scale: 1, x: best?.x ?? 0, y: best?.y ?? 0 };
}

function unionOf(one: Rect, two: Rect): Rect {
  return {
    left: Math.min(one.left, two.left),
    top: Math.min(one.top, two.top),
    right: Math.max(one.right, two.right),
    bottom: Math.max(one.bottom, two.bottom),
  };
}

function fitsIn(box: Rect, area: Rect): boolean {
  return (
    box.right - box.left <= area.right - area.left &&
    box.bottom - box.top <= area.bottom - area.top
  );
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function clearing(
  [low, high]: [number, number],
  [from, to]: [number, number],
): number {
  if (high - low > to - from || low < from) return from - low;
  if (high > to) return to - high;

  return 0;
}

function better(move: SheetMove, than: SheetMove): boolean {
  if (Math.abs(move.scale - than.scale) > LENS_ZOOM_SNAP) {
    return move.scale > than.scale;
  }

  return Math.hypot(move.x, move.y) < Math.hypot(than.x, than.y);
}

function fuller(
  framing: { move: SheetMove; shown: number },
  than: { move: SheetMove; shown: number },
): boolean {
  const sameScale =
    Math.abs(framing.move.scale - than.move.scale) <= LENS_ZOOM_SNAP;

  if (sameScale && Math.abs(framing.shown - than.shown) > SHOWN_AREA_SNAP_PX) {
    return framing.shown > than.shown;
  }

  return better(framing.move, than.move);
}

function shownOf(house: Rect, area: Rect, move: SheetMove): number {
  const width =
    Math.min(area.right, move.scale * house.right + move.x) -
    Math.max(area.left, move.scale * house.left + move.x);
  const height =
    Math.min(area.bottom, move.scale * house.bottom + move.y) -
    Math.max(area.top, move.scale * house.top + move.y);

  return Math.max(0, width) * Math.max(0, height);
}

export function sheetLens(
  lens: Lens,
  move: SheetMove,
  centre: { x: number; y: number },
): Lens {
  return {
    zoom: lens.zoom * move.scale,
    x: (1 - move.scale) * centre.x + move.scale * lens.x - move.x,
    y: (1 - move.scale) * centre.y + move.scale * lens.y - move.y,
  };
}

function fillInto(room: Rect, house: Rect, area: Rect): SheetMove {
  const roomFit = Math.min(1, fitScale(room, area));
  const needed = Math.min(
    1,
    ROOM_LEGIBLE_PX / Math.min(room.right - room.left, room.bottom - room.top),
  );
  const scale =
    roomFit >= needed ? roomFit : Math.min(1, fitScale(house, area));

  return {
    scale,
    x: along(
      [room.left, room.right],
      [house.left, house.right],
      [area.left, area.right],
      scale,
    ),
    y: along(
      [room.top, room.bottom],
      [house.top, house.bottom],
      [area.top, area.bottom],
      scale,
    ),
  };
}

function moved(box: Rect, move: SheetMove): Rect {
  return {
    left: move.scale * box.left + move.x,
    top: move.scale * box.top + move.y,
    right: move.scale * box.right + move.x,
    bottom: move.scale * box.bottom + move.y,
  };
}

function grown(box: Rect, by?: Rect): Rect {
  if (!by) return box;

  return {
    left: box.left - by.left,
    top: box.top - by.top,
    right: box.right + by.right,
    bottom: box.bottom + by.bottom,
  };
}

function within(box: Rect, area: Rect): boolean {
  return (
    box.left >= area.left &&
    box.right <= area.right &&
    box.top >= area.top &&
    box.bottom <= area.bottom
  );
}

function shortestPan(
  box: [number, number],
  area: [number, number],
): number | null {
  if (box[1] - box[0] > area[1] - area[0]) return null;

  return Math.min(Math.max(0, area[0] - box[0]), area[1] - box[1]);
}

function fitScale(box: Rect, area: Rect): number {
  return Math.min(
    (area.right - area.left) / (box.right - box.left),
    (area.bottom - area.top) / (box.bottom - box.top),
  );
}

function along(
  room: [number, number],
  house: [number, number],
  area: [number, number],
  scale: number,
): number {
  const [low, high] = area;
  const middle = (low + high) / 2;

  if (scale * (room[1] - room[0]) > high - low) {
    return middle - (scale * (room[0] + room[1])) / 2;
  }

  const centred = middle - (scale * (house[0] + house[1])) / 2;

  return Math.min(
    Math.max(centred, low - scale * room[0]),
    high - scale * room[1],
  );
}

export function groundPoints(grounds: readonly Object3D[]): Vector3[] {
  const points: Vector3[] = [];

  for (const ground of grounds) {
    const box = new Box3().setFromObject(ground);

    if (box.isEmpty()) continue;

    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        points.push(new Vector3(x, box.min.y, z), new Vector3(x, box.max.y, z));
      }
    }
  }

  return points;
}

export function houseFrame(
  house: readonly Vector3[],
  camera: Pick<PerspectiveCamera, 'fov' | 'aspect'>,
  least = 0,
): RigFrame | null {
  if (house.length === 0) return null;

  const { center, distance } = houseReach(house, camera);

  return {
    center,
    distance,
    turn: portraitTurn(house, center, distance, camera, least),
  };
}

function houseReach(
  house: readonly Vector3[],
  camera: Pick<PerspectiveCamera, 'fov' | 'aspect'>,
): { center: Vector3; distance: number } {
  const box = new Box3().setFromPoints([...house]);
  const size = box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const tall = largest / (2 * Math.atan((Math.PI * camera.fov) / 360));

  return {
    center: box.getCenter(new Vector3()),
    distance: FIT_MARGIN * Math.max(tall, tall / camera.aspect),
  };
}

function portraitTurn(
  house: readonly Vector3[],
  center: Vector3,
  distance: number,
  camera: Pick<PerspectiveCamera, 'fov' | 'aspect'>,
  least: number,
): number {
  if (camera.aspect >= 1) return 0;

  const eye = new PerspectiveCamera(camera.fov, camera.aspect, 0.01, 1000);
  const fill = (turn: number): number => {
    const pose = homePose(center, distance, turn, camera.aspect, least);

    eye.position.copy(pose.position);
    eye.lookAt(pose.target);
    eye.updateMatrixWorld();

    const box = screenBox(house, eye, { width: 2, height: 2 });

    return Math.min(2 / (box.right - box.left), 2 / (box.low - box.high));
  };
  const steps = PORTRAIT_TURN_DEG / TURN_STEP_DEG;
  const turns = Array.from({ length: steps }, (_, step) => [
    (step + 1) * TURN_STEP_DEG,
    -(step + 1) * TURN_STEP_DEG,
  ]).flat();

  return turns.reduce(
    (best, turn) => {
      const filled = fill(turn);

      return filled > best.filled * TURN_GAIN ? { turn, filled } : best;
    },
    { turn: 0, filled: fill(0) },
  ).turn;
}

export function zoomReach(home: RigFrame): { min: number; max: number } {
  return { min: ORBIT_MIN_DISTANCE, max: orbitCeiling(home.distance) };
}

export function houseLens(
  house: readonly Vector3[],
  pose: Pose,
  fov: number,
  size: { width: number; height: number },
  clear?: readonly Rect[],
  ground: readonly Vector3[] = [],
  fill = false,
  under = 0,
): Lens {
  const { width, height } = size;
  const eye = eyeAt(pose, fov, size);
  const box = screenBox(house, eye, size);
  const { left, right, high, low } = box;

  if (clear) {
    const whole = screenBox([...house, ...ground], eye, size);
    const options = clearInsets(clear, size);
    const underBanner =
      under > 0 ? options.filter((insets) => insets.top === under) : [];
    const lenses = (underBanner.length > 0 ? underBanner : options).map(
      (insets) => centredLens(box, whole, insets, size, fill, undefined, under),
    );

    return nearestLens(lenses, box, size);
  }

  const top = HOUSE_MARGIN_PX;
  const bottom = height - PORTRAIT_CONTROLS_PX - HOUSE_MARGIN_PX;
  const zoom = Math.min(
    (width - 2 * HOUSE_MARGIN_PX) / (right - left),
    (bottom - top) / (low - high),
  );
  const tall = zoom * (low - high);
  const middle = MathUtils.clamp(
    (top + height * HOUSE_BAND) / 2,
    top + tall / 2,
    bottom - tall / 2,
  );

  return {
    zoom,
    x: zoom * ((left + right) / 2 - width / 2),
    y: height / 2 + zoom * ((high + low) / 2 - height / 2) - middle,
  };
}

function eyeAt(
  pose: Pose,
  fov: number,
  size: { width: number; height: number },
): PerspectiveCamera {
  const eye = new PerspectiveCamera(fov, size.width / size.height, 0.01, 1000);

  eye.position.copy(pose.position);
  eye.lookAt(pose.target);
  eye.updateMatrixWorld();

  return eye;
}

function nearestLens(
  lenses: readonly Lens[],
  box: ScreenBox,
  size: { width: number; height: number },
): Lens {
  const drift = (lens: Lens): number =>
    Math.hypot(
      lens.zoom * ((box.left + box.right) / 2 - size.width / 2) - lens.x,
      lens.zoom * ((box.high + box.low) / 2 - size.height / 2) - lens.y,
    );

  return lenses.reduce((best, lens) => {
    const nearer = drift(lens) < drift(best);

    if (lens.zoom > best.zoom + LENS_ZOOM_SNAP) return lens;
    if (lens.zoom > best.zoom - LENS_ZOOM_SNAP && nearer) return lens;

    return best;
  });
}

export function planLens(
  house: readonly Vector3[],
  pose: Pose,
  fov: number,
  size: { width: number; height: number },
  frame: Rect,
): Lens {
  const { width, height } = size;
  const eye = new PerspectiveCamera(fov, width / height, 0.01, 1000);
  const box = new Box3().setFromPoints([...house]);
  const top = box.max.y;
  const ring = [
    new Vector3(box.min.x, top, box.min.z),
    new Vector3(box.max.x, top, box.min.z),
    new Vector3(box.max.x, top, box.max.z),
    new Vector3(box.min.x, top, box.max.z),
  ];

  eye.position.copy(pose.position);
  eye.lookAt(pose.target);
  eye.updateMatrixWorld();

  const shown = screenBox(ring, eye, size);
  const zoom =
    ((frame.right - frame.left) / (shown.right - shown.left) +
      (frame.bottom - frame.top) / (shown.low - shown.high)) /
    2;

  return {
    zoom,
    x:
      zoom * ((shown.left + shown.right) / 2 - width / 2) +
      width / 2 -
      (frame.left + frame.right) / 2,
    y:
      zoom * ((shown.high + shown.low) / 2 - height / 2) +
      height / 2 -
      (frame.top + frame.bottom) / 2,
  };
}

function screenBox(
  points: readonly Vector3[],
  eye: PerspectiveCamera,
  size: { width: number; height: number },
): ScreenBox {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const point of points) {
    const projected = point.clone().project(eye);

    xs.push(((projected.x + 1) / 2) * size.width);
    ys.push(((1 - projected.y) / 2) * size.height);
  }

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    high: Math.min(...ys),
    low: Math.max(...ys),
  };
}

function centredLens(
  house: ScreenBox,
  whole: ScreenBox,
  insets: Insets,
  size: { width: number; height: number },
  fill = false,
  fixed?: number,
  under = 0,
): Lens {
  const { width, height } = size;
  const { left, right, top, bottom } = frameArea(insets, size);
  const banner = under > 0 && insets.top >= under;
  const band = frameArea({ ...insets, top: under }, size);
  const houseWide = house.right - house.left;
  const houseTall = house.low - house.high;
  const fits = Math.min((right - left) / houseWide, (bottom - top) / houseTall);
  const share = HOUSE_SHARE * Math.min(width / houseWide, height / houseTall);
  const framesGround = Math.min(
    (right - left) / (whole.right - whole.left),
    (bottom - top) / (whole.low - whole.high),
  );
  const tight = fill || width / height < PHONE_ASPECT;
  const zoom =
    fixed ?? (tight ? fits : Math.min(fits, Math.max(framesGround, share)));
  const framed = tight ? house : whole;

  return {
    zoom,
    x: lensOffset(
      zoom,
      width,
      [left, right],
      [house.left, house.right],
      [framed.left, framed.right],
    ),
    y: banner
      ? lensOffset(
          zoom,
          height,
          [top, bottom],
          [house.high, house.low],
          [house.high, house.low],
          (band.top + band.bottom) / 2,
        )
      : lensOffset(
          zoom,
          height,
          [top, bottom],
          [house.high, house.low],
          [framed.high, framed.low],
        ),
  };
}

function frameArea(
  insets: Insets,
  size: { width: number; height: number },
): Rect {
  const across = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * size.width);
  const down = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * size.height);

  return {
    left: insets.left + across,
    right: size.width - insets.right - across,
    top: insets.top + down,
    bottom: size.height - insets.bottom - down,
  };
}

function lensOffset(
  zoom: number,
  full: number,
  [from, to]: [number, number],
  [houseFrom, houseTo]: [number, number],
  [wholeFrom, wholeTo]: [number, number],
  aim = full / 2,
): number {
  const framesWhole = zoom * (wholeTo - wholeFrom) <= to - from + LENS_PX_SNAP;
  const [start, end] = framesWhole
    ? [wholeFrom, wholeTo]
    : [houseFrom, houseTo];
  const middle = (start + end) / 2;
  const low = from - zoom * (start - middle);
  const high = to - zoom * (end - middle);
  const placed = low > high ? (from + to) / 2 : MathUtils.clamp(aim, low, high);

  return full / 2 + zoom * (middle - full / 2) - placed;
}

// Two framings that each hold the house can lose it between them while the view turns and pulls back.
function keptInView(
  lens: Lens,
  shift: Shift,
  box: ScreenBox,
  size: { width: number; height: number },
): Lens {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  const x = lens.x - shift.x;
  const y = lens.y - shift.y;
  const reach = Math.max(
    (lens.zoom * (box.right - halfWidth) - x) / halfWidth,
    (x - lens.zoom * (box.left - halfWidth)) / halfWidth,
    (lens.zoom * (box.low - halfHeight) - y) / halfHeight,
    (y - lens.zoom * (box.high - halfHeight)) / halfHeight,
  );

  if (!(reach > 1)) return lens;

  return {
    zoom: lens.zoom / reach,
    x: x / reach + shift.x,
    y: y / reach + shift.y,
  };
}

function blendLens(from: Lens, to: Lens, k: number): Lens {
  return {
    zoom: MathUtils.lerp(from.zoom, to.zoom, k),
    x: MathUtils.lerp(from.x, to.x, k),
    y: MathUtils.lerp(from.y, to.y, k),
  };
}

function cameraPose(camera: PerspectiveCamera): Pose {
  camera.updateMatrixWorld();

  const position = camera.getWorldPosition(new Vector3());

  return {
    position,
    target: position.clone().add(camera.getWorldDirection(new Vector3())),
  };
}

function nearLens(a: Lens, b: Lens): boolean {
  return (
    Math.abs(a.zoom - b.zoom) < LENS_ZOOM_SNAP &&
    Math.abs(a.x - b.x) < LENS_PX_SNAP &&
    Math.abs(a.y - b.y) < LENS_PX_SNAP
  );
}

function finiteLens(lens: Lens): boolean {
  return Number.isFinite(lens.zoom + lens.x + lens.y) && lens.zoom > 0;
}

function finiteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x + vector.y + vector.z);
}

function calmControls(
  controls: RigControls | null,
  camera: PerspectiveCamera,
): void {
  if (!controls) return;

  const position = camera.position.clone();
  const target = controls.target.clone();
  const damping = controls.enableDamping;

  // OrbitControls drops a leftover fling only on an update without damping.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  camera.position.copy(position);
  controls.target.copy(target);
}

export function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rect, index) =>
        rect.left === b[index].left &&
        rect.top === b[index].top &&
        rect.right === b[index].right &&
        rect.bottom === b[index].bottom,
    )
  );
}

export function homePose(
  center: Vector3,
  distance: number,
  orbit: number,
  aspect = 1,
  least = 0,
): Pose {
  const toCamera = new Vector3(...HOME_CAMERA).sub(center).normalize();
  const level = Math.max(Math.asin(toCamera.y), least);
  const portrait = MathUtils.clamp((1 - aspect) / (1 - PORTRAIT_ASPECT), 0, 1);
  const pitch =
    least > 0
      ? Math.min(level, STACK_TOP_PITCH)
      : MathUtils.lerp(level, Math.max(level, PORTRAIT_PITCH), portrait);
  const flat = toCamera.setY(0).normalize();
  const direction = flat
    .multiplyScalar(Math.cos(pitch))
    .setY(Math.sin(pitch))
    .applyAxisAngle(UP, MathUtils.degToRad(orbit));

  return {
    target: center.clone(),
    position: center.clone().addScaledVector(direction, distance),
  };
}

export function spotPose(spot: Spot, home: RigFrame, orbit: number): Pose {
  const toHome = new Vector3(...HOME_CAMERA).sub(home.center).setY(0);
  const along = spot.axis?.clone().setY(0).normalize() ?? toHome.clone();

  if (along.dot(toHome) < 0) along.negate();

  const pitch = MathUtils.degToRad(SPOT_PITCH_DEG);
  const direction = along
    .normalize()
    .applyAxisAngle(UP, MathUtils.degToRad(orbit))
    .multiplyScalar(Math.cos(pitch))
    .setY(Math.sin(pitch));

  return {
    target: spot.centre.clone(),
    position: spot.centre.clone().addScaledVector(direction, home.distance),
  };
}

export function overheadPose(home: RigFrame): Pose {
  const offset = new Vector3().setFromSpherical(
    new Spherical(home.distance, OVERHEAD_PHI, PLAN_THETA),
  );

  return {
    target: home.center.clone(),
    position: home.center.clone().add(offset),
  };
}

export function fitPose(home: RigFrame, from: Pose, least = 0): Pose {
  const bearing = new Spherical().setFromVector3(
    from.position.clone().sub(home.center),
  );
  const direction = new Vector3().setFromSpherical(
    new Spherical(1, Math.min(bearing.phi, Math.PI / 2 - least), bearing.theta),
  );

  return {
    target: home.center.clone(),
    position: home.center.clone().addScaledVector(direction, home.distance),
  };
}

function aimedPose(
  ease: Ease,
  from: Pose,
  spot: Spot | null,
  home: RigFrame,
  camera: PerspectiveCamera,
  least: number,
): Pose {
  if (ease.aim === 'overhead') return overheadPose(home);
  if (ease.aim === 'fit') return fitPose(home, from, least);
  if (spot && camera.aspect >= 1) return spotPose(spot, home, ease.place.orbit);

  return homePose(
    home.center,
    home.distance,
    ease.place.orbit + (home.turn ?? 0),
    camera.aspect,
    least,
  );
}

export function withinReach(pose: Pose, controls: RigControls | null): Pose {
  const offset = pose.position.clone().sub(pose.target);
  const reach = MathUtils.clamp(
    offset.length(),
    controls?.minDistance ?? 0,
    controls?.maxDistance ?? Infinity,
  );

  return {
    target: pose.target.clone(),
    position: pose.target.clone().add(offset.setLength(reach)),
  };
}

export function blendPose(from: Pose, to: Pose, k: number): Pose {
  const target = from.target.clone().lerp(to.target, k);
  const a = new Spherical().setFromVector3(
    from.position.clone().sub(from.target),
  );
  const b = new Spherical().setFromVector3(to.position.clone().sub(to.target));
  const turn = Math.atan2(
    Math.sin(b.theta - a.theta),
    Math.cos(b.theta - a.theta),
  );
  const offset = new Vector3().setFromSpherical(
    new Spherical(
      MathUtils.lerp(a.radius, b.radius, k),
      MathUtils.lerp(a.phi, b.phi, k),
      a.theta + turn * k,
    ),
  );

  return { target, position: target.clone().add(offset) };
}

export class CameraRig {
  private stage: RigStage | null = null;

  private ease: Ease | null = null;

  private shift: Shift = { x: 0, y: 0 };

  private framing: Framing = { raise: 0, zoom: 1, house: false };

  private lens: Lens = { zoom: 1, x: 0, y: 0 };

  private rest: Rest = 'home';

  private place: HomePlace = { orbit: 0, x: 0, y: 0 };

  private lastSettle: number | null = null;

  private lastNow: number | null = null;

  private clear: readonly Rect[] | undefined = undefined;

  private under = 0;

  private sheet: RigSheet | null = null;

  private sheetPending = false;

  private sheetGlide: SheetGlide | null = null;

  private base: Lens = { zoom: 1, x: 0, y: 0 };

  private freeLens: Lens | null = null;

  private freeSheet: Lens | null = null;

  private planFrame: Rect | null = null;

  private flat = 0;

  private framed = false;

  private stacked = false;

  private focus: Focus | null = null;

  private held = false;

  private dragHeld = false;

  private left: Left | null = null;

  private rising = false;

  private shown = false;

  constructor(
    private readonly onMove: () => void,
    private readonly house: House = () => [],
    private readonly ground: House = () => [],
    private readonly planHouse: House = house,
    private readonly drawnHouse: House = house,
  ) {}

  get moving(): boolean {
    return this.ease !== null;
  }

  get flatness(): number {
    return this.flat;
  }

  get reframing(): boolean {
    return this.sheetPending;
  }

  get tilting(): boolean {
    return this.rising;
  }

  get landed(): boolean {
    return this.shown;
  }

  get flying(): boolean {
    return this.rising || this.ease?.switching === true;
  }

  get flatAndStill(): boolean {
    return this.ease === null && this.flat > FLAT_ENOUGH;
  }

  housePoints(): Vector3[] {
    return this.house();
  }

  get leastPitch(): number {
    return this.stacked ? STACK_PITCH : 0;
  }

  setStacked(stacked: boolean): void {
    this.stacked = stacked;
  }

  attach(stage: RigStage): void {
    this.stage = stage;
    this.hold(this.held);

    if (!this.framing.house) this.lens = this.restingLens(stage, this.rest);

    this.applyView();
    this.onMove();

    if (this.ease || this.framing.house) stage.invalidate();
  }

  detach(stage: RigStage): void {
    if (this.stage === stage) this.stage = null;
  }

  forgetScene(): void {
    this.framed = false;
    this.shown = false;
  }

  setFraming(framing: Framing): void {
    const { raise, zoom, house } = this.framing;

    if (
      framing.raise === raise &&
      framing.zoom === zoom &&
      framing.house === house
    ) {
      return;
    }

    this.framing = { ...framing };

    if (this.rest === 'free') this.rest = 'home';
    if (this.stage) this.lens = this.restingLens(this.stage, this.rest);

    this.applyView();
    this.stage?.invalidate();
    this.onMove();
  }

  setClear(clear: readonly Rect[], under = 0): void {
    if (this.clear && sameRects(this.clear, clear) && this.under === under) {
      return;
    }

    this.clear = clear.map((rect) => ({ ...rect }));
    this.under = under;
    this.stage?.invalidate();
  }

  setSheet(sheet: RigSheet | null): void {
    const was = this.sheet;
    const same =
      sheet && was
        ? sheet.key === was.key && sameRects([sheet.covered], [was.covered])
        : sheet === was;

    this.sheet =
      sheet && was?.reach && same ? { ...sheet, reach: was.reach } : sheet;

    if (same) return;

    this.freeSheet = null;
    this.sheetPending = sheet !== null && this.stage !== null;
    this.sheetGlide = { from: null, start: null };
    this.stage?.invalidate();
  }

  setPlanFrame(frame: Rect | null): void {
    const was = this.planFrame;

    if (frame && was ? sameRects([frame], [was]) : frame === was) return;

    this.planFrame = frame ? { ...frame } : null;

    const course = this.ease?.aim === 'overhead' ? this.ease.course : null;

    if (course && this.stage) {
      course.to.lens = this.restingLens(this.stage, 'plan', course.to);
    } else if (!this.ease && this.rest === 'plan' && this.stage) {
      this.lens = this.restingLens(this.stage, 'plan');
      this.applyView();
    }

    this.stage?.invalidate();
  }

  goHome(place: HomePlace, ms: number): void {
    this.begin(place, ms, null, 'home');
  }

  flyTo(focus: Focus, place: HomePlace, ms: number): void {
    this.begin(place, ms, focus, 'home');
  }

  tiltDown(place: HomePlace, ms: number): void {
    const stage = this.stage;

    if (stage && !this.rising) {
      this.left = {
        pose: {
          position: stage.camera.position.clone(),
          target: stage.controls?.target.clone() ?? stage.frame().center,
        },
        rest: this.rest,
        focus: this.landedFocus(),
        size: { ...stage.size },
      };
    }

    this.rising = false;
    this.hold(true);
    this.begin(place, ms, null, 'overhead', true);
  }

  tiltUp(place: HomePlace, ms: number): void {
    const left = this.left;
    const size = this.stage?.size;
    const back =
      left !== null &&
      size !== undefined &&
      left.size.width === size.width &&
      left.size.height === size.height;

    this.rising = this.stage !== null;
    this.hold(false);
    this.begin(
      place,
      ms,
      back ? left.focus : null,
      back ? 'back' : 'home',
      true,
    );
  }

  private hold(held: boolean): void {
    const controls = this.stage?.controls;

    this.held = held;

    if (controls) controls.enabled = !held && !this.dragHeld;
  }

  refit(): void {
    // HomeScene refits when the lifted storeys land, which is halfway through a floor switch.
    if (this.ease?.switching) return;

    this.reaim(false);
  }

  switchFloor(): void {
    if (this.rest !== 'plan') this.rest = 'home';

    // With no scene drawn yet, the renderer's first fit frames the new storeys.
    if (this.stage) this.reaim(true);
  }

  private reaim(switching: boolean): void {
    const ease = this.ease;

    if (ease?.aim === 'overhead') {
      this.begin(this.place, ease.ms, null, 'overhead', true, switching);

      return;
    }

    const flight = ease ? ease.focus : this.landedFocus();

    if (flight) {
      this.begin(
        this.place,
        this.framed ? IDLE_RETURN_MS : 0,
        flight,
        'home',
        false,
        switching,
      );

      return;
    }

    const aims: Record<Rest, Aim> = {
      home: 'home',
      plan: 'overhead',
      spot: 'fit',
      free: 'fit',
    };

    this.begin(
      this.place,
      this.framed && this.rest !== 'plan' ? IDLE_RETURN_MS : 0,
      null,
      aims[this.rest],
      false,
      switching,
    );
  }

  private begin(
    place: HomePlace,
    ms: number,
    focus: Focus | null,
    aim: Aim,
    landsOnInput = false,
    switching = false,
  ): void {
    this.framed = true;
    this.place = place;
    this.focus = focus;
    this.ease = {
      place,
      ms,
      course: null,
      focus,
      aim,
      landsOnInput,
      switching,
      waiting: switching ? { since: null } : null,
    };
    this.stage?.invalidate();
  }

  sceneCommitted(): void {
    if (!this.ease?.waiting) return;

    this.ease.waiting = null;
    this.stage?.invalidate();
  }

  private landedFocus(): Focus | null {
    return this.rest === 'spot' ? this.focus : null;
  }

  cancel(): void {
    const ease = this.ease;
    const stage = this.stage;

    this.ease = null;

    if (ease && stage && (ease.landsOnInput || !this.shown)) {
      this.follow(ease, this.chart(ease, stage, this.lastNow ?? 0), stage, 1);
      stage.invalidate();
    }
    if (stage?.controls) {
      Object.assign(stage.controls, this.tiltRange(), ease?.course?.reach);
    }

    if (this.rising || ease?.switching) {
      this.rising = false;
      this.onMove();
    }

    if (this.rest !== 'home' && this.rest !== 'spot') return;

    this.rest = 'free';
    this.freeLens = this.sheet ? { ...this.base } : { ...this.lens };
    this.freeSheet = this.sheet && !this.sheetGlide ? { ...this.lens } : null;
  }

  holdInput(): void {
    this.dragHeld = true;
    this.hold(this.held);
  }

  releaseInput(): void {
    this.dragHeld = false;
    this.hold(this.held);
  }

  step(now: number): void {
    const stage = this.stage;

    if (!stage || !Number.isFinite(now)) return;

    this.keepTime(now);
    this.recover(stage);

    const ease = this.ease;

    if (!ease) {
      this.settle(now, stage);

      return;
    }

    this.lastSettle = null;

    if (this.waits(ease, now)) {
      stage.invalidate();

      return;
    }

    stage.controls?.dispatchEvent?.({ type: 'start' });

    const course = this.chart(ease, stage, now);
    const { value, done } = glideStep(
      { from: 0, to: 1, start: course.start, ms: ease.ms },
      now,
    );

    this.follow(ease, course, stage, value);

    if (done) this.ease = null;
    if (done && stage.controls) {
      Object.assign(stage.controls, this.tiltRange(), course.reach);
    }
    if (done && (this.rising || ease.switching)) {
      this.rising = false;
      this.onMove();
    }
    if (!done || this.framing.house) stage.invalidate();
  }

  // A floor switch charts its flight from the new storeys and ground, which the renderer has not committed yet.
  private waits(ease: Ease, now: number): boolean {
    const waiting = ease.waiting;

    if (!waiting) return false;

    waiting.since ??= now;

    if (now - waiting.since < SWITCH_WAIT_MS) return true;

    ease.waiting = null;

    return false;
  }

  private keepTime(now: number): void {
    const last = this.lastNow;

    this.lastNow = now;

    if (last === null || now >= last) return;

    // The renderer restarts its clock at zero whenever its frame loop changes.
    const back = now - last;

    if (this.ease?.course) this.ease.course.start += back;
    if (typeof this.ease?.waiting?.since === 'number') {
      this.ease.waiting.since += back;
    }
    if (this.lastSettle !== null) this.lastSettle += back;
    if (typeof this.sheetGlide?.start === 'number')
      this.sheetGlide.start += back;
  }

  private recover(stage: RigStage): void {
    const { camera, controls } = stage;
    const lost =
      !finiteVector(camera.position) ||
      (controls !== null && !finiteVector(controls.target));

    if (lost) {
      const home = stage.frame();
      const pose = homePose(
        home.center,
        home.distance,
        this.place.orbit + (home.turn ?? 0),
        camera.aspect,
        this.leastPitch,
      );

      calmControls(controls, camera);
      camera.position.copy(pose.position);

      if (controls) {
        controls.target.copy(pose.target);
        controls.update();
      } else {
        camera.lookAt(pose.target);
      }

      this.ease = null;
      this.rest = 'home';
    }

    if (!lost && finiteLens(this.lens)) return;
    if (this.rest === 'free') this.rest = 'home';

    const lens = this.restingLens(stage, this.rest);

    this.lens = finiteLens(lens) ? lens : { zoom: 1, x: 0, y: 0 };
    this.applyView();
  }

  private chart(ease: Ease, stage: RigStage, now: number): Course {
    if (ease.course) return ease.course;

    const { camera, controls } = stage;
    const home = stage.frame();

    calmControls(controls, camera);

    const from = {
      position: camera.position.clone(),
      target: controls?.target.clone() ?? home.center.clone(),
      shift: { ...this.shift },
      lens: { ...this.lens },
      flat: this.flat,
    };
    const spot = ease.focus?.() ?? null;
    const left = ease.aim === 'back' ? this.left : null;
    const pose = withinReach(
      left
        ? {
            position: left.pose.position.clone(),
            target: left.pose.target.clone(),
          }
        : aimedPose(ease, from, spot, home, camera, this.leastPitch),
      controls,
    );

    if (ease.aim === 'overhead') this.rest = 'plan';
    else if (left) this.rest = left.rest;
    else if (ease.aim === 'home' || ease.aim === 'back') {
      this.rest = spot ? 'spot' : 'home';
    }

    ease.ms = motionLive.reduced ? 0 : ease.ms;
    ease.course = {
      start: now,
      from,
      to: { ...pose, lens: this.restingLens(stage, this.rest, pose) },
      reach: controls
        ? {
            minDistance: controls.minDistance,
            maxDistance: controls.maxDistance,
          }
        : null,
    };

    if (controls) {
      // OrbitControls clamps every update to the new home's reach, which would jump the first frame.
      const lengths = [from, pose].map(({ position, target }) =>
        position.distanceTo(target),
      );

      controls.minDistance = Math.min(controls.minDistance ?? 0, ...lengths);
      controls.maxDistance = Math.max(
        controls.maxDistance ?? Infinity,
        ...lengths,
      );
    }

    return ease.course;
  }

  private follow(
    ease: Ease,
    course: Course,
    stage: RigStage,
    value: number,
  ): void {
    const { camera, controls } = stage;
    const { from, to } = course;
    const pose = blendPose(from, to, value);

    camera.position.copy(pose.position);

    if (controls) {
      Object.assign(controls, this.tiltRange());
      controls.target.copy(pose.target);
      controls.update();
    } else {
      camera.lookAt(pose.target);
    }

    camera.updateMatrixWorld();
    this.shift = {
      x: MathUtils.lerp(from.shift.x, ease.place.x, value),
      y: MathUtils.lerp(from.shift.y, ease.place.y, value),
    };
    this.lens = blendLens(from.lens, to.lens, value);

    if (ease.switching) this.keepDrawnInView(stage, pose);

    this.flat = MathUtils.lerp(
      from.flat,
      ease.aim === 'overhead' ? 1 : 0,
      value,
    );

    if (value >= 1) this.shown = true;

    this.applyView();
    this.onMove();
  }

  private keepDrawnInView(stage: RigStage, pose: Pose): void {
    const { camera, controls, size } = stage;
    const eye = eyeAt(
      { position: camera.position, target: controls?.target ?? pose.target },
      camera.fov,
      size,
    );
    const points = this.drawnHouse();
    const ahead = points.every(
      (point) => point.clone().applyMatrix4(eye.matrixWorldInverse).z < 0,
    );

    if (!ahead) return;

    this.lens = keptInView(
      this.lens,
      this.shift,
      screenBox(points, eye, size),
      size,
    );
  }

  private settle(now: number, stage: RigStage): void {
    const goal = this.restingLens(stage, this.rest);
    const last = this.lastSettle;

    this.lastSettle = now;

    if (this.sheetGlide) {
      this.glideForSheet(this.sheetGlide, goal, now, stage);

      return;
    }

    const lens = this.lens;

    if (nearLens(lens, goal)) {
      this.sheetPending = false;

      return;
    }

    const gap = last === null ? Infinity : now - last;
    const ms = gap > LENS_GAP_MS ? LENS_STEP_MS : Math.max(0, gap);
    const k = motionLive.reduced ? 1 : 1 - Math.exp(-ms / LENS_EASE_MS);
    const next = blendLens(lens, goal, k);

    this.lens = nearLens(next, goal) ? goal : next;
    this.sheetPending = this.sheet !== null && this.lens !== goal;
    this.applyView();
    stage.invalidate();
    this.onMove();
  }

  private glideForSheet(
    glide: SheetGlide,
    goal: Lens,
    now: number,
    stage: RigStage,
  ): void {
    if (glide.start === null && nearLens(this.lens, goal)) {
      this.sheetGlide = null;
      this.sheetPending = false;

      return;
    }

    glide.from ??= { ...this.lens };
    glide.start ??= now;

    const { value, done } = glideStep(
      {
        from: 0,
        to: 1,
        start: glide.start,
        ms: motionLive.reduced ? 0 : SHEET_GLIDE_MS,
      },
      now,
    );

    this.lens = done ? goal : blendLens(glide.from, goal, value);

    if (done) this.sheetGlide = null;

    this.sheetPending = this.sheet !== null && !done;
    this.applyView();
    stage.invalidate();
    this.onMove();
  }

  limits(
    home: RigFrame,
  ): Required<
    Pick<
      RigControls,
      'minDistance' | 'maxDistance' | 'minPolarAngle' | 'maxPolarAngle'
    >
  > {
    const reach = zoomReach(home);

    return {
      minDistance: reach.min,
      maxDistance: reach.max,
      ...this.tiltRange(),
    };
  }

  private tiltRange(): Required<
    Pick<RigControls, 'minPolarAngle' | 'maxPolarAngle'>
  > {
    if (this.ease || !this.stacked || this.rest === 'plan') {
      return { minPolarAngle: 0, maxPolarAngle: ORBIT_MAX_POLAR };
    }

    return {
      minPolarAngle: Math.PI / 2 - STACK_TOP_PITCH,
      maxPolarAngle: Math.PI / 2 - STACK_LOW_PITCH,
    };
  }

  private restingLens(stage: RigStage, rest: Rest, pose?: Pose): Lens {
    const lens = this.baseLens(stage, rest, pose);
    const sheet = this.sheet;
    const { camera, size } = stage;

    if (rest !== 'free') this.base = lens;

    if (!sheet || size.width === 0 || size.height === 0) return lens;
    if (rest === 'free' && this.freeSheet) return this.freeSheet;

    const house = this.house();
    const room = sheet.room();

    if (house.length === 0 || room.length === 0) return lens;
    if (room.some((point) => !Number.isFinite(point.x + point.y + point.z))) {
      return lens;
    }

    const eye = new PerspectiveCamera(
      camera.fov,
      size.width / size.height,
      0.01,
      1000,
    );
    const at = pose ?? cameraPose(camera);

    eye.position.copy(at.position);
    eye.lookAt(at.target);
    eye.updateMatrixWorld();

    const centre = {
      x: size.width / 2 + this.shift.x,
      y: size.height / 2 + this.shift.y,
    };
    const shown = (points: readonly Vector3[]): Rect => {
      const box = screenBox(points, eye, size);
      const place = (x: number, y: number) => ({
        x: lens.zoom * (x - size.width / 2) + centre.x - lens.x,
        y: lens.zoom * (y - size.height / 2) + centre.y - lens.y,
      });
      const from = place(box.left, box.high);
      const to = place(box.right, box.low);

      return { left: from.x, top: from.y, right: to.x, bottom: to.y };
    };
    const areas = uncoveredAreas([...(this.clear ?? []), sheet.covered], size);
    const target = grown(shown(room), sheet.reach);
    const stack = this.stacked ? stackFraming(shown(house), areas) : null;
    const move =
      stack && areas.some((area) => within(moved(target, stack), area))
        ? stack
        : sheetFraming(target, shown(house), areas);

    const framed = sheetLens(lens, move, centre);

    if (rest === 'free' && !this.sheetGlide) this.freeSheet = framed;

    return framed;
  }

  private baseLens(stage: RigStage, rest: Rest, pose?: Pose): Lens {
    const { framing } = this;
    const { camera, size } = stage;
    const plain = { zoom: framing.zoom, x: 0, y: framing.raise * size.height };

    if (!framing.house) return plain;
    if (rest === 'free') return this.freeLens ?? this.lens;
    if (size.width === 0 || size.height === 0) return plain;

    const points = this.house();

    if (points.length === 0) return plain;

    const planned =
      rest === 'plan' && this.planFrame
        ? planLens(
            this.planHouse(),
            pose ?? cameraPose(camera),
            camera.fov,
            size,
            this.planFrame,
          )
        : null;

    if (planned && finiteLens(planned)) return planned;

    const lens = houseLens(
      points,
      pose ?? cameraPose(camera),
      camera.fov,
      size,
      this.clear,
      this.ground(),
      this.stacked,
      this.under,
    );

    return Number.isFinite(lens.zoom) && lens.zoom > 0 ? lens : plain;
  }

  private applyView(): void {
    const stage = this.stage;

    if (!stage) return;

    const { camera, size } = stage;
    const x = -this.shift.x + this.lens.x;
    const y = -this.shift.y + this.lens.y;

    camera.zoom = this.lens.zoom;

    if ((x === 0 && y === 0) || size.width === 0 || size.height === 0) {
      if (camera.view?.enabled) camera.clearViewOffset();
      else camera.updateProjectionMatrix();

      return;
    }

    camera.setViewOffset(
      size.width,
      size.height,
      x,
      y,
      size.width,
      size.height,
    );
  }
}

export function RigDriver({ rig }: { rig: CameraRig }): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const invalidate = useThree((state) => state.invalidate);
  const bounds = useBounds();

  useEffect(() => {
    const stage: RigStage = {
      camera: camera as PerspectiveCamera,
      controls: controls as unknown as RigControls | null,
      frame: () => {
        const drawn = bounds.getSize();
        const frame = houseFrame(
          rig.housePoints(),
          camera as PerspectiveCamera,
          rig.leastPitch,
        ) ?? { center: drawn.center, distance: drawn.distance };
        const orbit = controls as unknown as RigControls | null;

        if (orbit) Object.assign(orbit, rig.limits(frame));

        return frame;
      },
      size: { width, height },
      invalidate,
    };

    rig.attach(stage);

    return () => rig.detach(stage);
  }, [rig, camera, controls, width, height, invalidate, bounds]);

  useFrame(({ clock }) => rig.step(clock.elapsedTime * 1000));

  return null;
}
