import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';
import { plotColor } from '@estanza/plan-engine/geometry/plot.js';
import { basementBounds, wallBounds } from '@estanza/scene/ground.js';
import { Children, isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import {
  BuriedLawn,
  buriedPit,
  coverPlane,
  coverTone,
  groundCover,
  lidPlane,
  PitLid,
} from '../src/buried-lawn.js';
import { EstanzaSceneView } from '../src/scene-view.js';

const auroraHome = (): HomeDocument => homeDocumentSchema.parse(aurora);
const floors = deriveFloors(auroraHome());
const basement = floors.filter((floor) => floor.level < 0);

type Drawn = {
  sceneTree: (source: HomeDocument, frameloop: 'demand') => ReactElement;
};

type LawnProps = { floors: DerivedFloor[]; shown: DerivedFloor[] };

function lawnOf(floor: string): ReactElement<LawnProps> | undefined {
  const home = auroraHome();
  const view = document.createElement('estanza-scene-view');

  view.homeDocument = home;
  view.floor = floor;
  document.body.append(view);

  expect(view).toBeInstanceOf(EstanzaSceneView);

  const tree = (view as unknown as Drawn).sceneTree(home, 'demand');

  return Children.toArray(
    (tree.props as { children: ReactElement[] }).children,
  ).find(
    (child): child is ReactElement<LawnProps> =>
      isValidElement(child) && child.type === BuriedLawn,
  );
}

function centreOf(all: DerivedFloor[]): [number, number] {
  const bounds = wallBounds(all);

  return [
    ((bounds?.minX ?? 0) + (bounds?.maxX ?? 0)) / 2,
    ((bounds?.minY ?? 0) + (bounds?.maxY ?? 0)) / 2,
  ];
}

function inTriangle(
  point: [number, number],
  a: number[],
  b: number[],
  c: number[],
): boolean {
  const side = (p: number[], q: number[]) =>
    (q[0] - p[0]) * (point[1] - p[1]) - (q[1] - p[1]) * (point[0] - p[0]);
  const ab = side(a, b);
  const bc = side(b, c);
  const ca = side(c, a);

  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

function covers(
  geometry: ReturnType<typeof coverPlane>,
  plan: [number, number],
): boolean {
  const [cx, cy] = centreOf(floors);
  const point: [number, number] = [(plan[0] - cx) / 100, -(plan[1] - cy) / 100];
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const at = (i: number) => [position.getX(i), position.getY(i)];

  for (let t = 0; t < (index?.count ?? 0); t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => at(index?.getX(t + k) ?? 0));

    if (inTriangle(point, a, b, c)) return true;
  }

  return false;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the lawn around a basement shown alone', () => {
  it('opens a pit around the basement so it sits in the ground', () => {
    const pit = buriedPit(basement);

    expect(pit).not.toBeNull();
    expect((pit?.maxX ?? 0) - (pit?.minX ?? 0)).toBeGreaterThan(0);
    expect((pit?.minX ?? 0) + (pit?.maxX ?? 0)).toBeCloseTo(0, 5);
    expect((pit?.minY ?? 0) + (pit?.maxY ?? 0)).toBeCloseTo(0, 5);
  });

  it('leaves the ground to the scene when a storey above ground is shown', () => {
    expect(buriedPit(floors)).toBeNull();
    expect(groundCover(floors, floors)).toBeNull();
    expect(
      groundCover(
        floors,
        floors.filter((floor) => floor.level >= 0),
      ),
    ).toBeNull();
  });

  it('paints the lawn over the hidden storeys in the ground zone the basement is dug into', () => {
    expect(coverTone(auroraHome(), floors)).toBe(plotColor('grass'));
  });

  it('keeps the plain lawn tone when no ground zone wraps the basement', () => {
    const bare = auroraHome();

    bare.additions.groundZones = [];

    expect(coverTone(bare, floors)).toBeNull();
  });

  it('hands the lawn every storey and the basement on show', () => {
    const lawn = lawnOf(basement[0]?.id ?? '');

    expect(lawn?.props.floors).toHaveLength(floors.length);
    expect(lawn?.props.shown.map((floor) => floor.id)).toEqual(
      basement.map((floor) => floor.id),
    );
  });

  it('cuts the lawn over the hidden storeys exactly around the basement', () => {
    const cover = groundCover(floors, basement);
    const [cx, cy] = centreOf(floors);
    const dug = basementBounds(floors);

    expect(cover).not.toBeNull();
    expect(cover?.pit.minX).toBeCloseTo(((dug?.minX ?? 0) - cx) / 100, 5);
    expect(cover?.pit.maxX).toBeCloseTo(((dug?.maxX ?? 0) - cx) / 100, 5);
    expect(cover?.pit.minY).toBeCloseTo(((dug?.minY ?? 0) - cy) / 100, 5);
    expect(cover?.pit.maxY).toBeCloseTo(((dug?.maxY ?? 0) - cy) / 100, 5);
  });

  it('lays lawn over the ground of the hidden storeys but not over the basement floor', () => {
    const cover = groundCover(floors, basement);
    const plane = coverPlane(cover);
    let outside = 0;

    for (const floor of floors.filter((floor) => floor.level >= 0)) {
      for (const room of floor.rooms) {
        const [x, y] = room.poly.reduce(
          ([sx, sy], [px, py]) => [
            sx + px / room.poly.length,
            sy + py / room.poly.length,
          ],
          [0, 0],
        );
        const dug = basementBounds(floors);
        const inPit =
          x >= (dug?.minX ?? 0) &&
          x <= (dug?.maxX ?? 0) &&
          y >= (dug?.minY ?? 0) &&
          y <= (dug?.maxY ?? 0);

        if (!inPit) outside += 1;
        expect(covers(plane, [x, y])).toBe(!inPit);
      }
    }

    expect(outside).toBeGreaterThan(0);

    for (const room of basement.flatMap((floor) => floor.rooms)) {
      for (const [x, y] of room.poly) expect(covers(plane, [x, y])).toBe(false);
    }
  });
});

describe('the lid over a basement pit', () => {
  function lidOf(floor: string | null): ReactElement | undefined {
    const home = auroraHome();
    const view = document.createElement('estanza-scene-view');

    view.homeDocument = home;
    view.floor = floor;
    document.body.append(view);

    const tree = (view as unknown as Drawn).sceneTree(home, 'demand');

    return Children.toArray(
      (tree.props as { children: ReactElement[] }).children,
    ).find(
      (child): child is ReactElement =>
        isValidElement(child) && child.type === PitLid,
    );
  }

  const storeyAt = (level: number): string =>
    floors.find((floor) => floor.level === level)?.id ?? '';

  it('grasses the pit over when a storey above the ground is in focus', () => {
    expect(lidOf(storeyAt(1))).toBeDefined();
  });

  it('leaves the pit open for the basement, the ground and all floors', () => {
    expect(lidOf(storeyAt(-1))).toBeUndefined();
    expect(lidOf(storeyAt(0))).toBeUndefined();
    expect(lidOf(null)).toBeUndefined();
  });

  it('covers every basement room and nothing else', () => {
    const [cx, cy] = centreOf(floors);
    const dug = basementBounds(floors);
    const lid = lidPlane({
      minX: ((dug?.minX ?? 0) - cx) / 100,
      maxX: ((dug?.maxX ?? 0) - cx) / 100,
      minY: ((dug?.minY ?? 0) - cy) / 100,
      maxY: ((dug?.maxY ?? 0) - cy) / 100,
    });
    const middle = (poly: number[][]): [number, number] => [
      poly.reduce((sum, [x]) => sum + x / poly.length, 0),
      poly.reduce((sum, [, y]) => sum + y / poly.length, 0),
    ];

    for (const room of basement.flatMap((floor) => floor.rooms)) {
      expect(covers(lid, middle(room.poly))).toBe(true);
    }

    expect(covers(lid, [(dug?.maxX ?? 0) + 100, (dug?.maxY ?? 0) + 100])).toBe(
      false,
    );
  });
});
