import type {
  DerivedFloor,
  DerivedRoom,
  PlanWall,
} from '@estanza/plan-engine/geometry/geometry.js';
import { motionLive } from '@estanza/scene/env.js';
import { type Glide, glideStep } from '@estanza/scene/explode.js';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createElement,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type Group,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';

import { insetPolygon, TINT_OPACITY, type Vec2 } from './living.js';

export const dangerLooks = ['room', 'rim'] as const;

export type DangerLook = (typeof dangerLooks)[number];

export type RoomMark = {
  occupied: boolean;
  tint: string | null;
  danger: DangerLook | null;
};

export type RoomMarks = Record<string, RoomMark>;

export type Point3 = [number, number, number];

export const OUTLINE_MS = 300;
export const RIM_LIFT_CM = 2;
export const DANGER_FILL = '#d06855';
export const DANGER_OPACITY = 0.85;
export const DANGER_LID_OPACITY = 0.4;

const DANGER_LIFT_CM = 2;
const DANGER_RIM_LIFT_CM = 1;

export const dangerPeaks: Record<string, (floor: number) => number> = {
  glaze: (floor) => floor,
  fill: (floor) => floor * DANGER_OPACITY,
  lid: (floor) => floor * DANGER_LID_OPACITY,
};

const OUTLINE_DAY = '#16295e';
const OUTLINE_NIGHT = '#ffffff';
const OUTLINE_INSET_CM = 6;
const OUTLINE_LIFT_CM = 4;
const TINT_LIFT_CM = 1.5;
const OUTLINE_WIDTH_PX = 2;
const RIM_WIDTH_PX = 3;

function outlineOf(room: DerivedRoom): Vec2[] {
  return room.innerPoly && room.innerPoly.length >= 3
    ? room.innerPoly
    : room.poly;
}

function closedRing(points: Vec2[], height: number): Point3[] {
  const ring = points.map(([x, y]): Point3 => [x, height, y]);

  return [...ring, ring[0]];
}

export function markColour(night: boolean): string {
  return night ? OUTLINE_NIGHT : OUTLINE_DAY;
}

export function rimOf(
  room: DerivedRoom,
  walls: readonly PlanWall[],
): Point3[] | null {
  const own = new Set(room.walls);
  const heights = walls
    .filter((wall) => own.has(wall.id))
    .map((wall) => wall.height);

  if (heights.length === 0) return null;

  return closedRing(outlineOf(room), Math.max(...heights) + RIM_LIFT_CM);
}

export function dangerLid(
  room: DerivedRoom,
  walls: readonly PlanWall[],
): number | null {
  return rimOf(room, walls)?.[0][1] ?? null;
}

export function floorGeometry(room: DerivedRoom): ShapeGeometry {
  const shape = new Shape(outlineOf(room).map(([x, y]) => new Vector2(x, -y)));
  const built = new ShapeGeometry(shape);

  built.rotateX(-Math.PI / 2);

  return built;
}

function Tint({ room, colour }: { room: DerivedRoom; colour: string }) {
  const geometry = useMemo(() => floorGeometry(room), [room]);

  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: TINT_OPACITY,
        depthWrite: false,
        toneMapped: false,
      }),
    [colour],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return createElement('mesh', {
    geometry,
    material,
    position: [0, TINT_LIFT_CM, 0],
  });
}

function useFade(on: boolean, show: (value: number) => void): void {
  const invalidate = useThree((state) => state.invalidate);
  const level = useRef(on ? 1 : 0);
  const glide = useRef<Glide | null>(null);

  useLayoutEffect(() => show(level.current));

  useEffect(() => {
    const target = on ? 1 : 0;

    if (target === (glide.current?.to ?? level.current)) return;

    glide.current = {
      from: level.current,
      to: target,
      start: null,
      ms: motionLive.reduced ? 0 : OUTLINE_MS,
    };
    invalidate();
  }, [on, invalidate]);

  useFrame(({ clock }) => {
    const running = glide.current;

    if (!running) return;

    running.start ??= clock.elapsedTime * 1000;

    const { value, done } = glideStep(running, clock.elapsedTime * 1000);

    level.current = value;
    show(value);

    if (done) glide.current = null;
    else invalidate();
  });
}

function Danger({
  room,
  walls,
  look,
}: {
  room: DerivedRoom;
  walls: readonly PlanWall[];
  look: DangerLook | null;
}): ReactElement {
  const holder = useRef<Group>(null);
  const shown = useRef<DangerLook>(look ?? 'rim');

  if (look) shown.current = look;

  const geometry = useMemo(() => floorGeometry(room), [room]);
  const glaze = useMemo(
    () =>
      new MeshBasicMaterial({
        color: DANGER_FILL,
        transparent: true,
        opacity: 0,
        blending: MultiplyBlending,
        premultipliedAlpha: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: DANGER_FILL,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const glass = useMemo(
    () =>
      new MeshBasicMaterial({
        color: DANGER_FILL,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const rim = useMemo(
    () =>
      rimOf(room, walls)?.map(([x, y, z]): Point3 => [
        x,
        y + DANGER_RIM_LIFT_CM,
        z,
      ]) ?? null,
    [room, walls],
  );
  const lid = useMemo(() => dangerLid(room, walls), [room, walls]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => glaze.dispose(), [glaze]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => glass.dispose(), [glass]);

  useFade(look !== null, (value) => {
    const floor = Number(shown.current === 'room');

    for (const child of holder.current?.children ?? []) {
      const drawn = child as Mesh;
      const peak = dangerPeaks[drawn.name]?.(floor) ?? 1;

      (drawn.material as Material).opacity = value * peak;
      drawn.visible = value * peak > 0;
    }
  });

  return createElement(
    'group',
    { ref: holder },
    createElement('mesh', {
      key: 'glaze',
      name: 'glaze',
      geometry,
      material: glaze,
      position: [0, DANGER_LIFT_CM, 0],
    }),
    createElement('mesh', {
      key: 'fill',
      name: 'fill',
      geometry,
      material,
      position: [0, DANGER_LIFT_CM, 0],
      renderOrder: 1,
    }),
    lid === null
      ? null
      : createElement('mesh', {
          key: 'lid',
          name: 'lid',
          geometry,
          material: glass,
          position: [0, lid, 0],
          renderOrder: 1,
        }),
    rim
      ? createElement(Line, {
          key: 'rim',
          points: rim,
          color: DANGER_FILL,
          lineWidth: RIM_WIDTH_PX,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        })
      : null,
  );
}

function Outline({
  room,
  walls,
  occupied,
  night,
}: {
  room: DerivedRoom;
  walls: readonly PlanWall[];
  occupied: boolean;
  night: boolean;
}): ReactElement {
  const holder = useRef<Group>(null);

  const points = useMemo(
    () =>
      closedRing(
        insetPolygon(outlineOf(room), OUTLINE_INSET_CM),
        OUTLINE_LIFT_CM,
      ),
    [room],
  );
  const rim = useMemo(() => rimOf(room, walls), [room, walls]);

  useFade(occupied, (value) => {
    for (const child of holder.current?.children ?? []) {
      const drawn = child as Mesh;

      (drawn.material as Material).opacity = value;
      drawn.visible = value > 0;
    }
  });

  const colour = markColour(night);

  return createElement(
    'group',
    { ref: holder },
    createElement(Line, {
      key: 'floor',
      points,
      color: colour,
      lineWidth: OUTLINE_WIDTH_PX,
      transparent: true,
      depthWrite: false,
    }),
    rim
      ? createElement(Line, {
          key: 'rim',
          points: rim,
          color: colour,
          lineWidth: RIM_WIDTH_PX,
          transparent: true,
          depthWrite: false,
        })
      : null,
  );
}

export function RoomMarksLayer({
  floor,
  marks,
  night,
}: {
  floor: DerivedFloor;
  marks: RoomMarks;
  night: boolean;
}): ReactElement {
  return createElement(
    'group',
    null,
    floor.rooms.flatMap((room) => {
      const mark = Object.hasOwn(marks, room.slug) ? marks[room.slug] : null;

      if (!mark) return [];

      return [
        createElement(Outline, {
          key: `outline:${room.id}`,
          room,
          walls: floor.floor.walls,
          occupied: mark.occupied,
          night,
        }),
        mark.tint
          ? createElement(Tint, {
              key: `tint:${room.id}`,
              room,
              colour: mark.tint,
            })
          : null,
        createElement(Danger, {
          key: `danger:${room.id}`,
          room,
          walls: floor.floor.walls,
          look: mark.danger,
        }),
      ];
    }),
  );
}
