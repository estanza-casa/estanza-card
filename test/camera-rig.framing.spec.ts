import { ORBIT_MAX_POLAR } from '@estanza/scene/orbit.js';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  CameraRig,
  HOUSE_SHARE,
  houseFrame,
  type Rect,
  type RigControls,
  type RigStage,
} from '../src/camera-rig.js';

type Size = { width: number; height: number };

type Box = { left: number; right: number; high: number; low: number };

type Shot = {
  rig: CameraRig;
  camera: PerspectiveCamera;
  controls: RigControls & { maxPolarAngle?: number };
  size: Size;
  box: (house?: Box3) => Box;
};

const storey = new Box3(new Vector3(-6, 0, -4), new Vector3(6, 2.8, 4));
const square = new Box3(new Vector3(-5, 0, -5), new Vector3(5, 2.8, 5));
const twoTall = new Box3(new Vector3(-5, 0, -4), new Vector3(5, 8.4, 4));
const home = { orbit: 0, x: 0, y: 0 };
const phoneControls = [
  { left: 12, top: 12, right: 110, bottom: 64 },
  { left: 12, top: 72, right: 64, bottom: 124 },
];
const deskControls = [
  { left: 12, top: 12, right: 98, bottom: 58 },
  { left: 12, top: 66, right: 58, bottom: 232 },
];

function corners(box: Box3): Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (corner) =>
      new Vector3(
        corner & 1 ? box.max.x : box.min.x,
        corner & 2 ? box.max.y : box.min.y,
        corner & 4 ? box.max.z : box.min.z,
      ),
  );
}

function withGarage(): Vector3[] {
  const outline = [
    [-6, -6.75],
    [6, -6.75],
    [6, 1.25],
    [-1.5, 1.25],
    [-1.5, 6.75],
    [-6, 6.75],
  ];

  return [0, 2.8].flatMap((height) =>
    outline.map(([x, z]) => new Vector3(x, height, z)),
  );
}

function run(rig: CameraRig, from: number, to: number): void {
  for (let now = from; now <= to; now += 16) rig.step(now);
}

function lawn(): Vector3[] {
  return corners(new Box3(new Vector3(-12, 0, -8), new Vector3(24, 0, 28)));
}

function shoot(
  house: Box3 | Vector3[],
  size: Size,
  clear: Rect[],
  ground: Vector3[] = [],
  drawn?: Vector3[],
): Shot {
  const points = Array.isArray(house) ? house : corners(house);
  const camera = new PerspectiveCamera(50, size.width / size.height, 0.1, 400);
  const controls: Shot['controls'] = {
    target: new Vector3(),
    update: () => camera.lookAt(controls.target),
  };
  const rig = new CameraRig(
    () => undefined,
    () => points,
    () => ground,
    undefined,
    () => drawn ?? points,
  );
  const stage: RigStage = {
    camera,
    controls,
    frame: () => {
      const frame = houseFrame(points, camera) ?? {
        center: new Vector3(),
        distance: 20,
      };

      Object.assign(controls, rig.limits(frame));

      return frame;
    },
    size,
    invalidate: () => undefined,
  };

  camera.position.set(9, 11, 9);
  rig.setFraming({ raise: 0, zoom: 1, house: true });
  rig.setClear(clear);
  rig.attach(stage);
  rig.goHome(home, 0);
  run(rig, 0, 3000);

  const box = (shown: Box3 | Vector3[] = points): Box => {
    camera.updateMatrixWorld();

    const drawn = (Array.isArray(shown) ? shown : corners(shown)).map(
      (point) => {
        const ndc = point.clone().project(camera);

        return {
          x: ((ndc.x + 1) / 2) * size.width,
          y: ((1 - ndc.y) / 2) * size.height,
        };
      },
    );

    return {
      left: Math.min(...drawn.map((point) => point.x)),
      right: Math.max(...drawn.map((point) => point.x)),
      high: Math.min(...drawn.map((point) => point.y)),
      low: Math.max(...drawn.map((point) => point.y)),
    };
  };

  return { rig, camera, controls, size, box };
}

function inside(box: Box, size: Size): void {
  expect(box.high).toBeGreaterThanOrEqual(-1);
  expect(box.low).toBeLessThanOrEqual(size.height + 1);
  expect(box.left).toBeGreaterThanOrEqual(-1);
  expect(box.right).toBeLessThanOrEqual(size.width + 1);
}

function share(box: Box, size: Size): number {
  return (
    ((box.right - box.left) * (box.low - box.high)) / (size.width * size.height)
  );
}

describe('the home view fitted to the shape of the card', () => {
  const phone = { width: 390, height: 750 };
  const tablet = { width: 820, height: 1086 };

  it('turns a house with a garage to fill more of a phone than the diagonal view does', () => {
    const box = shoot(withGarage(), phone, phoneControls, lawn()).box();

    expect((box.low - box.high) / phone.height).toBeGreaterThanOrEqual(0.4);
    expect(share(box, phone)).toBeGreaterThanOrEqual(0.3);
  });

  it('fills a square house across a phone', () => {
    const box = shoot(square, phone, phoneControls, lawn()).box();

    expect((box.low - box.high) / phone.height).toBeGreaterThanOrEqual(0.4);
  });

  it('turns a long house to run down a phone', () => {
    const long = new Box3(new Vector3(-8, 0, -3), new Vector3(8, 2.8, 3));
    const box = shoot(long, phone, phoneControls).box(long);

    expect(box.low - box.high).toBeGreaterThan(0.8 * (box.right - box.left));
  });

  it('keeps the diagonal view on a wide card', () => {
    const wide = { width: 1280, height: 806 };
    const shot = shoot(storey, wide, deskControls);
    const offset = shot.camera.position.clone().sub(shot.controls.target);

    expect(Math.abs(offset.x - offset.z)).toBeLessThan(1e-6);
  });

  it('fits a tablet in portrait on the house, centred, not on the lawn', () => {
    const box = shoot(storey, tablet, phoneControls, lawn()).box();
    const middle = (box.high + box.low) / 2;
    const centres = [
      tablet.height / 2,
      (phoneControls[1].bottom + tablet.height) / 2,
    ];

    expect(box.right - box.left).toBeGreaterThanOrEqual(
      HOUSE_SHARE * tablet.width - 1,
    );
    expect(box.low).toBeGreaterThanOrEqual(0.6 * tablet.height);
    expect(
      Math.min(...centres.map((centre) => Math.abs(middle - centre))),
    ).toBeLessThanOrEqual(0.05 * tablet.height);
  });

  it('keeps a tall two-storey house whole above the bottom of a wide card', () => {
    const wide = { width: 1280, height: 806 };
    const box = shoot(twoTall, wide, deskControls).box();

    expect(box.high).toBeGreaterThanOrEqual(0);
    expect(box.low).toBeLessThanOrEqual(wide.height - 16);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(wide.width);
  });
});

describe('the view while the reader moves the camera', () => {
  const desk = { width: 1280, height: 706 };
  const phone = { width: 390, height: 750 };

  function turn(shot: Shot, polar: number, azimuth: number, far = 1): void {
    const offset = shot.camera.position.clone().sub(shot.controls.target);
    const reach = offset.length() * far;

    shot.rig.cancel();
    shot.camera.position
      .setFromSphericalCoords(reach, Math.max(polar, 1e-6), azimuth)
      .add(shot.controls.target);
    shot.controls.update();
    run(shot.rig, 3016, 6000);
  }

  function lensOf(shot: Shot): { zoom: number; x: number; y: number } {
    const view = shot.camera.view?.enabled ? shot.camera.view : null;

    return {
      zoom: shot.camera.zoom,
      x: view?.offsetX ?? 0,
      y: view?.offsetY ?? 0,
    };
  }

  function polarOf(shot: Shot): number {
    return Math.acos(
      (shot.camera.position.y - shot.controls.target.y) /
        shot.camera.position.distanceTo(shot.controls.target),
    );
  }

  it('leaves the framing alone when tilted to look straight down', () => {
    const shot = shoot(withGarage(), desk, deskControls, lawn());
    const lens = lensOf(shot);

    turn(shot, 0, Math.PI / 4);

    expect(lensOf(shot)).toEqual(lens);
  });

  it('leaves the framing alone when zoomed right out', () => {
    const shot = shoot(withGarage(), desk, deskControls, lawn());
    const lens = lensOf(shot);

    turn(shot, polarOf(shot), Math.PI / 4, 3);

    expect(lensOf(shot)).toEqual(lens);
  });

  it('leaves the framing alone at every turn of an orbit across a phone', () => {
    const shot = shoot(withGarage(), phone, phoneControls, lawn());
    const lens = lensOf(shot);
    const polar = polarOf(shot);

    for (let step = 0; step < 8; step += 1) {
      turn(shot, polar, (step * Math.PI) / 4);

      expect(lensOf(shot)).toEqual(lens);
    }
  });

  it('leaves the framing alone at the lowest tilt the editor allows', () => {
    const shot = shoot(withGarage(), phone, phoneControls, lawn());
    const lens = lensOf(shot);

    for (let step = 0; step < 8; step += 1) {
      turn(shot, ORBIT_MAX_POLAR, (step * Math.PI) / 4);

      expect(lensOf(shot)).toEqual(lens);
    }
  });

  it('leaves the framing alone when orbiting away from a room it flew to', () => {
    const shot = shoot(withGarage(), phone, phoneControls, lawn());
    const room = { centre: new Vector3(4, 0, -4), axis: null };

    shot.rig.flyTo(() => room, home, 0);
    run(shot.rig, 3016, 6000);

    const lens = lensOf(shot);
    const polar = polarOf(shot);

    for (let step = 1; step < 8; step += 1) {
      turn(shot, polar, (step * Math.PI) / 4);

      expect(lensOf(shot)).toEqual(lens);
    }
  });

  it('still lets the reader pan the house across the card', () => {
    const shot = shoot(storey, desk, deskControls, lawn());
    const before = shot.box();

    shot.rig.cancel();
    shot.controls.target.add(new Vector3(3, 0, 0));
    shot.camera.position.add(new Vector3(3, 0, 0));
    shot.controls.update();
    run(shot.rig, 3016, 6000);

    const after = shot.box();

    expect(Math.abs(after.left - before.left)).toBeGreaterThan(40);
  });
});

describe('all floors standing apart', () => {
  const desk = { width: 1280, height: 706 };
  const stack = new Box3(
    new Vector3(-6, -2.8, -6.75),
    new Vector3(6, 17.4, 6.75),
  );

  it('fills the free height of the card with the stack', () => {
    const shot = shoot(stack, desk, deskControls, lawn());

    shot.rig.setStacked(true);
    shot.rig.goHome(home, 0);
    run(shot.rig, 3016, 6000);

    const box = shot.box();

    expect((box.low - box.high) / desk.height).toBeGreaterThanOrEqual(0.8);
    inside(box, desk);
  });

  it('glides out from the storey on screen to the whole stack, never nearer than it started nor past where it lands', () => {
    const points = corners(storey);
    const shot = shoot(points, desk, deskControls, lawn(), corners(storey));

    orbitReach(shot);
    points.splice(0, points.length, ...corners(stack));
    shot.rig.setStacked(true);
    shot.rig.switchFloor();
    shot.rig.sceneCommitted();

    const path = flight(shot, 3016);

    expect(path.length).toBeGreaterThan(20);
    onThePath(path);
    inside(shot.box(), desk);
  });

  it('glides in from the stack to a storey without a first frame pulled in by the new reach', () => {
    const points = corners(stack);
    const shot = shoot(points, desk, deskControls, lawn());

    orbitReach(shot);
    shot.rig.setStacked(true);
    shot.rig.goHome(home, 0);
    run(shot.rig, 3016, 6000);

    points.splice(0, points.length, ...corners(storey));
    shot.rig.setStacked(false);
    shot.rig.switchFloor();
    shot.rig.sceneCommitted();

    const path = flight(shot, 6016);

    expect(path.length).toBeGreaterThan(20);
    onThePath(path);
    inside(shot.box(), desk);
  });

  it.each([
    ['a desk', desk, deskControls],
    ['a tall wall tablet', { width: 1080, height: 1824 }, phoneControls],
  ])(
    'keeps the storeys in %s card all the way out to All, and at every height they then rise to',
    (_, card, controls) => {
      const points = corners(storey);
      const shot = shoot(points, card, controls, lawn(), corners(storey));

      orbitReach(shot);
      points.splice(0, points.length, ...corners(stack));
      shot.rig.switchFloor();
      shot.rig.setStacked(true);
      shot.rig.sceneCommitted();

      for (let now = 3016; shot.rig.moving || now === 3016; now += 16) {
        shot.rig.step(now);
        inside(shot.box(storey), card);
      }

      for (const rise of [0, 0.25, 0.5, 0.75, 1]) {
        const rising = new Box3(
          storey.min.clone().lerp(stack.min, rise),
          storey.max.clone().lerp(stack.max, rise),
        );

        inside(shot.box(rising), card);
      }
    },
  );
});

function orbitReach(shot: Shot): void {
  // OrbitControls puts the camera back inside its distance range on every update.
  shot.controls.update = () => {
    const offset = shot.camera.position.clone().sub(shot.controls.target);

    offset.setLength(
      Math.min(
        Math.max(offset.length(), shot.controls.minDistance ?? 0),
        shot.controls.maxDistance ?? Infinity,
      ),
    );
    shot.camera.position.copy(shot.controls.target).add(offset);
    shot.camera.lookAt(shot.controls.target);
  };
}

function flight(shot: Shot, from: number): number[] {
  const scales = [scaleOf(shot)];

  for (let now = from; shot.rig.moving || now === from; now += 16) {
    shot.rig.step(now);
    scales.push(scaleOf(shot));
  }

  return scales;
}

function scaleOf(shot: Shot): number {
  return (
    shot.camera.zoom /
    shot.camera.position.distanceTo(shot.controls.target.clone())
  );
}

function onThePath(path: number[]): void {
  const start = path[0];
  const end = path[path.length - 1];
  const low = Math.min(start, end) * 0.99;
  const high = Math.max(start, end) * 1.01;
  const widest = Math.max(
    ...path.slice(1).map((scale, index) => Math.abs(scale - path[index])),
  );

  for (const scale of path) {
    expect(scale).toBeGreaterThanOrEqual(low);
    expect(scale).toBeLessThanOrEqual(high);
  }

  expect(widest).toBeLessThan(0.2 * Math.abs(end - start));
}

describe('the view after a room sheet closes', () => {
  it('returns to the framing it had before the sheet opened, when the reader moved the camera meanwhile', () => {
    const size = { width: 390, height: 750 };
    const shot = shoot(storey, size, phoneControls);
    const before = {
      zoom: shot.camera.zoom,
      x: shot.camera.view?.offsetX ?? 0,
      y: shot.camera.view?.offsetY ?? 0,
    };
    const corner = new Box3(new Vector3(2, 0, 1), new Vector3(6, 2.8, 4));

    shot.rig.setSheet({
      key: 'room:corner',
      room: () => corners(corner),
      covered: { left: 0, top: 300, right: size.width, bottom: size.height },
    });
    run(shot.rig, 3016, 3400);
    shot.rig.cancel();
    run(shot.rig, 3416, 6000);

    expect(
      Math.abs((shot.camera.view?.offsetY ?? 0) - before.y) +
        Math.abs((shot.camera.view?.offsetX ?? 0) - before.x),
    ).toBeGreaterThan(20);

    shot.rig.setSheet(null);
    run(shot.rig, 6016, 9000);

    expect(shot.camera.zoom).toBeCloseTo(before.zoom, 3);
    expect(shot.camera.view?.offsetX ?? 0).toBeCloseTo(before.x, 0);
    expect(shot.camera.view?.offsetY ?? 0).toBeCloseTo(before.y, 0);
  });

  it('holds the framing beside an open sheet still while the reader orbits', () => {
    const size = { width: 390, height: 750 };
    const shot = shoot(storey, size, phoneControls);
    const corner = new Box3(new Vector3(2, 0, 1), new Vector3(6, 2.8, 4));

    shot.rig.setSheet({
      key: 'room:corner',
      room: () => corners(corner),
      covered: { left: 0, top: 300, right: size.width, bottom: size.height },
    });
    run(shot.rig, 3016, 3400);

    const lens = () => ({
      zoom: shot.camera.zoom,
      x: shot.camera.view?.offsetX ?? 0,
      y: shot.camera.view?.offsetY ?? 0,
    });
    const held = lens();
    const reach = shot.camera.position.distanceTo(shot.controls.target);

    for (let step = 1; step < 8; step += 1) {
      shot.rig.cancel();
      shot.camera.position
        .setFromSphericalCoords(reach, Math.PI / 4, (step * Math.PI) / 4)
        .add(shot.controls.target);
      shot.controls.update();
      run(shot.rig, 3416 + step * 1000, 3416 + step * 1000 + 600);

      expect(lens()).toEqual(held);
    }
  });
});

describe('the top-down view under the plan', () => {
  it('lays the tops of the walls over the place the plan draws the house before the plan fades in', () => {
    const size = { width: 1280, height: 806 };
    const plan = { left: 220, top: 120, right: 1060, bottom: 680 };
    const shot = shoot(storey, size, deskControls);

    shot.rig.setPlanFrame(plan);
    shot.rig.tiltDown(home, 500);
    run(shot.rig, 3016, 6000);

    const wallTops = new Box3(
      new Vector3(storey.min.x, storey.max.y, storey.min.z),
      new Vector3(storey.max.x, storey.max.y, storey.max.z),
    );
    const box = shot.box(wallTops);

    expect(box.left).toBeCloseTo(plan.left, -0.5);
    expect(box.right).toBeCloseTo(plan.right, -0.5);
    expect(box.high).toBeCloseTo(plan.top, -0.5);
    expect(box.low).toBeCloseTo(plan.bottom, -0.5);
  });
});
