import type {
  DerivedRoom,
  PlanWall,
} from '@estanza/plan-engine/geometry/geometry.js';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  DANGER_LID_OPACITY,
  dangerLid,
  dangerPeaks,
  floorGeometry,
  markColour,
  OUTLINE_MS,
  RIM_LIFT_CM,
  rimOf,
} from '../src/room-marks.js';

function wall(id: string, height: number): PlanWall {
  return {
    id,
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    thickness: 10,
    height,
  };
}

const hall: DerivedRoom = {
  id: 'r1',
  slug: 'hall',
  label: 'Hall',
  nameHidden: false,
  floorColor: null,
  kind: null,
  walls: ['w1', 'w2', 'w3', 'w4'],
  poly: [
    [-5, -5],
    [305, -5],
    [305, 205],
    [-5, 205],
  ],
  innerPoly: [
    [0, 0],
    [300, 0],
    [300, 200],
    [0, 200],
  ],
  area: 6,
  center: [150, 100],
};

const walls = [
  wall('w1', 250),
  wall('w2', 270),
  wall('w3', 250),
  wall('w4', 250),
  wall('w9', 400),
];

describe('the rim along the top of an occupied room', () => {
  it('runs along the top of the tallest wall around the room', () => {
    const rim = rimOf(hall, walls);

    expect(rim?.every(([, y]) => y === 270 + RIM_LIFT_CM)).toBe(true);
  });

  it('ignores walls that belong to other rooms', () => {
    const rim = rimOf(hall, walls);

    expect(rim?.[0][1]).toBeLessThan(400);
  });

  it('follows the inside face of the walls and closes on itself', () => {
    const rim = rimOf(hall, walls);

    expect(rim?.map(([x, , z]) => [x, z])).toEqual([
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
      [0, 0],
    ]);
  });

  it('falls back to the room outline when there is no inside face', () => {
    const rim = rimOf({ ...hall, innerPoly: undefined }, walls);

    expect(rim?.[0]).toEqual([-5, 270 + RIM_LIFT_CM, -5]);
  });

  it('draws nothing for a room with no walls of its own', () => {
    expect(rimOf({ ...hall, walls: ['w0'] }, walls)).toBeNull();
  });

  it('is navy by day and white by night', () => {
    expect(markColour(false)).toBe('#16295e');
    expect(markColour(true)).toBe('#ffffff');
  });

  it('fades in over 300ms', () => {
    expect(OUTLINE_MS).toBe(300);
  });
});

describe('a room in danger', () => {
  it('lays red glass over the top of its walls, where the walls cannot hide it', () => {
    expect(dangerLid(hall, walls)).toBe(270 + RIM_LIFT_CM);
  });

  it('keeps the glass light enough to see the room through, and strong enough to read as red', () => {
    expect(dangerPeaks.lid(1)).toBeGreaterThanOrEqual(0.3);
    expect(dangerPeaks.lid(1)).toBeLessThanOrEqual(0.5);
  });

  it('uses one glass strength on every storey, so a room below ground stays as readable as one above', () => {
    expect(dangerPeaks.lid.length).toBe(1);
    expect(dangerPeaks.lid(1)).toBe(DANGER_LID_OPACITY);
  });

  it('draws no glass over a room only on a house-wide alert', () => {
    expect(dangerPeaks.lid(0)).toBe(0);
  });

  it('lays no glass over a room with no walls of its own', () => {
    expect(dangerLid({ ...hall, walls: ['w0'] }, walls)).toBeNull();
  });
});

describe('the shape a tint or a danger fill is drawn on', () => {
  it('lies on the room floor where the plan puts it', () => {
    const shape = floorGeometry(hall);

    shape.computeBoundingBox();

    const box = shape.boundingBox;

    expect(box?.min.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-9);
    expect(box?.max.distanceTo(new Vector3(300, 0, 200))).toBeLessThan(1e-9);
  });

  it('faces up, so a camera above the house sees it', () => {
    const normals = floorGeometry(hall).getAttribute('normal');

    for (let index = 0; index < normals.count; index += 1) {
      expect(normals.getY(index)).toBeCloseTo(1, 9);
    }
  });

  it('winds every triangle towards the sky', () => {
    const shape = floorGeometry(hall);
    const position = shape.getAttribute('position');
    const index = shape.getIndex();
    const corners = index ? Array.from(index.array) : [];
    const at = (corner: number): Vector3 =>
      new Vector3().fromBufferAttribute(position, corner);

    for (let start = 0; start < corners.length; start += 3) {
      const [a, b, c] = corners.slice(start, start + 3).map(at);
      const facing = new Vector3().crossVectors(
        b.clone().sub(a),
        c.clone().sub(a),
      );

      expect(facing.y).toBeGreaterThan(0);
    }
  });
});
