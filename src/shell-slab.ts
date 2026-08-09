import type { Vec2 } from '@estanza/plan-engine/geometry/geometry.js';
import { ROOM_FLOOR_Y } from '@estanza/scene/components/Rooms.js';
import { createElement, type ReactElement, useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three';

export const SHELL_SLAB = 'shell-slab';

export const SHELL_FLOOR = { day: '#d9d3c7', night: '#7c8496' };

export const STOREY_EDGE = 'storey-edge';

export const STOREY_EDGE_COLOR = { day: '#1f2a44', night: '#e8ecf4' };

export function storeyEdgePoints(loops: readonly Vec2[][]): Vector3[] {
  return loops.flatMap((loop) =>
    loop.flatMap(([x, y], index) => {
      const [nx, ny] = loop[(index + 1) % loop.length];

      return [
        new Vector3(x, ROOM_FLOOR_Y, y),
        new Vector3(nx, ROOM_FLOOR_Y, ny),
      ];
    }),
  );
}

function unpickable(): void {}

export function StoreyEdge({
  loops,
  night,
}: {
  loops: Vec2[][];
  night: boolean;
}): ReactElement | null {
  const edge = useMemo(
    () => new BufferGeometry().setFromPoints(storeyEdgePoints(loops)),
    [loops],
  );

  useEffect(() => () => edge.dispose(), [edge]);

  if (loops.length === 0) return null;

  return createElement(
    'lineSegments',
    { name: STOREY_EDGE, geometry: edge, raycast: unpickable },
    createElement('lineBasicMaterial', {
      color: night ? STOREY_EDGE_COLOR.night : STOREY_EDGE_COLOR.day,
      transparent: true,
      opacity: 0.7,
    }),
  );
}

export function ShellSlab({
  outline,
  night,
}: {
  outline: Vec2[];
  night: boolean;
}): ReactElement | null {
  const fill = useMemo(
    () =>
      new ShapeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y)))),
    [outline],
  );

  useEffect(() => () => fill.dispose(), [fill]);

  if (outline.length < 3) return null;

  return createElement(
    'mesh',
    {
      name: SHELL_SLAB,
      geometry: fill,
      position: [0, ROOM_FLOOR_Y, 0],
      rotation: [Math.PI / 2, 0, 0],
    },
    createElement('meshBasicMaterial', {
      color: night ? SHELL_FLOOR.night : SHELL_FLOOR.day,
      side: DoubleSide,
    }),
  );
}
