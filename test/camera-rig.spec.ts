import { motionLive } from '@estanza/scene/env.js';
import {
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  orbitCeiling,
} from '@estanza/scene/orbit.js';
import {
  Box3,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  blendPose,
  CameraRig,
  clearInsets,
  fitPose,
  groundPoints,
  HOME_CAMERA,
  homePose,
  HOUSE_AIR,
  HOUSE_SHARE,
  houseFrame,
  OVERHEAD_PHI,
  overheadPose,
  PLAN_THETA,
  planSheetPlacement,
  type Pose,
  type Rect,
  type RigStage,
  SHEET_FRAME_MARGIN_PX,
  SHEET_GLIDE_MS,
  sheetFraming,
  sheetPlacement,
  type Spot,
  SPOT_PITCH_DEG,
  spotPose,
  STACK_PITCH,
  stackFraming,
  zoomReach,
} from '../src/camera-rig.js';
import {
  burnInPlaces,
  HOUSE_BAND,
  HOUSE_MARGIN_PX,
  PORTRAIT_CONTROLS_PX,
} from '../src/tablet.js';

const centre = new Vector3(0.4, 1.2, -0.3);
const distance = 14;
const storey = new Box3(new Vector3(-6, 0, -4), new Vector3(6, 2.8, 4));
const stack = new Box3(new Vector3(-6, -2.8, -4), new Vector3(6, 11, 4));

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

function room(): Spot {
  return { centre: new Vector3(3, 1.3, -2), axis: new Vector3(0, 0, 1) };
}

function horizontalAngle(from: Vector3, around: Vector3): number {
  return Math.atan2(from.x - around.x, from.z - around.z);
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function stage(): RigStage & {
  camera: PerspectiveCamera;
  controls: { target: Vector3; update: () => void; events: string[] };
  frames: number;
} {
  const camera = new PerspectiveCamera(50, 1280 / 800, 0.1, 200);
  const events: string[] = [];
  const built = {
    camera,
    controls: {
      target: new Vector3(3, 0, 1),
      update: () => camera.lookAt(built.controls.target),
      dispatchEvent: (event: { type: string }) => events.push(event.type),
      events,
    },
    frame: () => ({ center: centre.clone(), distance }),
    size: { width: 1280, height: 800 },
    invalidate: () => {
      built.frames += 1;
    },
    frames: 0,
  };

  camera.position.set(-6, 4, 12);

  return built;
}

function run(rig: CameraRig, from: number, to: number): void {
  for (let now = from; now <= to; now += 16) rig.step(now);
}

afterEach(() => {
  motionLive.reduced = false;
});

describe('the home pose', () => {
  it('is the pose the renderer frames a home from on open', () => {
    const pose = homePose(centre, distance, 0);
    const expected = new Vector3(...HOME_CAMERA)
      .sub(centre)
      .normalize()
      .multiplyScalar(distance)
      .add(centre);

    expect(pose.target.toArray()).toEqual(centre.toArray());
    expect(pose.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('orbits a burn-in position about the home, keeping height and distance', () => {
    const home = homePose(centre, distance, 0);
    const turned = homePose(centre, distance, 3);

    expect(
      degrees(
        horizontalAngle(turned.position, centre) -
          horizontalAngle(home.position, centre),
      ),
    ).toBeCloseTo(3, 6);
    expect(turned.position.y).toBeCloseTo(home.position.y, 9);
    expect(turned.position.distanceTo(centre)).toBeCloseTo(distance, 9);
  });
});

describe('the pose a flight to a room ends in', () => {
  const home = { center: centre, distance };

  function pitchOf(pose: Pose): number {
    const offset = pose.position.clone().sub(pose.target);

    return degrees(Math.asin(offset.y / offset.length()));
  }

  it('looks down into the room steeply enough to see over its walls', () => {
    expect(pitchOf(spotPose(room(), home, 0))).toBeCloseTo(SPOT_PITCH_DEG, 6);
    expect(SPOT_PITCH_DEG).toBeGreaterThanOrEqual(55);
    expect(SPOT_PITCH_DEG).toBeLessThanOrEqual(65);
  });

  it('centres on the room', () => {
    const spot = room();

    expect(spotPose(spot, home, 0).target.toArray()).toEqual(
      spot.centre.toArray(),
    );
  });

  it('looks along the length of the room, from the side the home view is on', () => {
    for (const axis of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0)]) {
      const spot = { ...room(), axis };
      const pose = spotPose(spot, home, 0);

      expect(pose.position.z).toBeCloseTo(spot.centre.z, 6);
      expect(pose.position.x).toBeGreaterThan(spot.centre.x);
    }
  });

  it('keeps to the home side when the room has no length to look along', () => {
    const spot = { ...room(), axis: null };
    const pose = spotPose(spot, home, 0);
    const toHome = new Vector3(...HOME_CAMERA).sub(centre).setY(0);

    expect(
      pose.position.clone().sub(spot.centre).setY(0).angleTo(toHome),
    ).toBeLessThan(1e-6);
  });

  it('turns with the burn-in orbit', () => {
    const spot = room();
    const still = spotPose(spot, home, 0);
    const turned = spotPose(spot, home, 3);

    expect(
      degrees(
        horizontalAngle(turned.position, spot.centre) -
          horizontalAngle(still.position, spot.centre),
      ),
    ).toBeCloseTo(3, 6);
  });

  it('stands as far back as the home view, so the lens fits the storey without a fisheye', () => {
    const pose = spotPose(room(), home, 0);

    expect(pose.position.distanceTo(pose.target)).toBeCloseTo(distance, 6);
  });
});

describe('a blend between two poses', () => {
  const from = {
    position: new Vector3(10, 5, 0),
    target: new Vector3(0, 0, 0),
  };
  const to = { position: new Vector3(1, 5, 11), target: new Vector3(1, 0, 1) };

  it('starts at one and ends at the other', () => {
    expect(
      blendPose(from, to, 0).position.distanceTo(from.position),
    ).toBeLessThan(1e-9);
    expect(
      blendPose(from, to, 1).position.distanceTo(to.position),
    ).toBeLessThan(1e-9);
    expect(blendPose(from, to, 1).target.toArray()).toEqual(
      to.target.toArray(),
    );
  });

  it('swings round the target instead of cutting through the house', () => {
    const half = blendPose(from, to, 0.5);

    expect(half.position.distanceTo(half.target)).toBeCloseTo(
      from.position.distanceTo(from.target),
      6,
    );
  });
});

describe('the camera rig', () => {
  it('eases the camera home over the time it is given, then stops asking for frames', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const goal = homePose(centre, distance, 0);

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 1000, 1000 + 600);

    expect(built.camera.position.distanceTo(goal.position)).toBeGreaterThan(
      0.1,
    );
    expect(rig.moving).toBe(true);

    run(rig, 1616, 1000 + 1300);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(built.controls.target.distanceTo(goal.target)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);

    const asked = built.frames;

    run(rig, 2400, 4000);

    expect(built.frames).toBe(asked);
  });

  it('flies to a room and looks down into it, then stops', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const spot = room();
    const goal = spotPose(spot, { center: centre, distance }, 0);

    rig.attach(built);
    rig.flyTo(() => spot, { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 1300);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(built.controls.target.distanceTo(spot.centre)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);
  });

  it('on a portrait card, frames an alerted storey as the reader picking it would', () => {
    const flown = new CameraRig(() => undefined);
    const picked = new CameraRig(() => undefined);
    const flying = stage();
    const picking = stage();

    for (const built of [flying, picking]) {
      built.camera.aspect = 0.46;
      built.camera.updateProjectionMatrix();
    }

    flown.attach(flying);
    picked.attach(picking);
    flown.flyTo(() => room(), { orbit: 0, x: 0, y: 0 }, 1200);
    picked.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(flown, 0, 1300);
    run(picked, 0, 1300);

    expect(
      flying.camera.position.distanceTo(picking.camera.position),
    ).toBeLessThan(1e-6);
    expect(
      flying.controls.target.distanceTo(picking.controls.target),
    ).toBeLessThan(1e-6);
  });

  it('tilts straight down over the home for the floor plan, then stops', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 0, 250);

    expect(rig.moving).toBe(true);

    run(rig, 266, 600);

    const look = built.camera.position.clone().sub(built.controls.target);

    expect(built.controls.target.distanceTo(centre)).toBeLessThan(1e-6);
    expect(look.length()).toBeCloseTo(distance, 6);
    expect(look.angleTo(new Vector3(0, 1, 0))).toBeCloseTo(OVERHEAD_PHI, 6);
    expect(rig.moving).toBe(false);
  });

  it('turns to the orientation of the floor plan when it tilts down', () => {
    const pose = overheadPose({ center: centre, distance });

    expect(horizontalAngle(pose.position, centre)).toBeCloseTo(PLAN_THETA, 6);
  });

  it('lines the overhead view up with the plan however the reader orbited', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.cancel();
    built.camera.position.set(20, 6, -8);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 16, 1000);

    const right = new Vector3(1, 0, 0).applyQuaternion(built.camera.quaternion);

    expect(right.x).toBeCloseTo(1, 3);
  });

  it('tilts back up to the orbit the reader left for the plan, and says it is tilting until it lands', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const left = new Vector3(20, 6, -8);

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.cancel();
    built.camera.position.copy(left);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 16, 1000);

    expect(rig.tilting).toBe(false);

    rig.tiltUp({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 1016, 1200);

    expect(rig.tilting).toBe(true);

    run(rig, 1216, 2000);

    expect(rig.tilting).toBe(false);
    expect(built.camera.position.distanceTo(left)).toBeLessThan(1e-3);
  });

  it('lays the storeys flat as it tilts down for the plan, and stands them back up as it tilts up', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);

    expect(rig.flatness).toBe(0);

    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 0, 250);

    expect(rig.flatness).toBeGreaterThan(0);
    expect(rig.flatness).toBeLessThan(1);

    run(rig, 266, 1000);

    expect(rig.flatness).toBe(1);

    rig.tiltUp({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 1016, 1250);

    expect(rig.flatness).toBeGreaterThan(0);
    expect(rig.flatness).toBeLessThan(1);

    run(rig, 1266, 2000);

    expect(rig.flatness).toBe(0);
  });

  it('reports flat and still only once the tilt down has landed', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 500);
    run(rig, 0, 250);

    expect(rig.flatAndStill).toBe(false);

    run(rig, 266, 1000);

    expect(rig.flatAndStill).toBe(true);

    rig.tiltUp({ orbit: 0, x: 0, y: 0 }, 500);

    expect(rig.flatAndStill).toBe(false);
  });

  it('stays over the plan when the storey changes while it rests there', () => {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();
    const frame = { left: 200, top: 100, right: 800, bottom: 500 };

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setPlanFrame(frame);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);

    const before = { ...built.camera.view };

    rig.switchFloor();
    run(rig, 16, 2000);

    expect(rig.flatAndStill).toBe(true);
    expect(built.camera.view?.offsetX).toBeCloseTo(before.offsetX ?? 0, 3);
    expect(built.camera.view?.width).toBeCloseTo(before.width ?? 0, 3);
  });

  it('lines the overhead view up with the plan from the storeys laid out as the plan draws them', () => {
    const laid = new Box3(new Vector3(-18, 0, -4), new Vector3(18, 2.8, 4));
    const rig = new CameraRig(
      () => undefined,
      () => corners(stack),
      () => [],
      () => corners(laid),
    );
    const built = stage();
    const frame = { left: 100, top: 300, right: 1180, bottom: 540 };

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setPlanFrame(frame);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);

    const drawn = [laid.min.x, laid.max.x].flatMap((x) =>
      [laid.min.z, laid.max.z].map((z) => {
        const point = new Vector3(x, laid.max.y, z).project(built.camera);

        return {
          x: ((point.x + 1) / 2) * built.size.width,
          y: ((1 - point.y) / 2) * built.size.height,
        };
      }),
    );
    const xs = drawn.map((point) => point.x);
    const ys = drawn.map((point) => point.y);

    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(640, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(420, 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1080, -1);
  });

  it('fits a new plan frame at once while it rests over the plan, with no frame drawn', () => {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();
    const frame = { left: 200, top: 100, right: 800, bottom: 500 };

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setPlanFrame({ left: 400, top: 200, right: 1100, bottom: 700 });
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.setPlanFrame(frame);

    const drawn = [storey.min.x, storey.max.x].flatMap((x) =>
      [storey.min.z, storey.max.z].map((z) => {
        const point = new Vector3(x, storey.max.y, z).project(built.camera);

        return {
          x: ((point.x + 1) / 2) * built.size.width,
          y: ((1 - point.y) / 2) * built.size.height,
        };
      }),
    );
    const xs = drawn.map((point) => point.x);
    const ys = drawn.map((point) => point.y);

    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(500, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(300, 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(600, -1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(400, -1);
  });

  it('lands on its first framing in one frame, and eases the ones after', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const goal = homePose(centre, distance, 0);

    rig.attach(built);
    rig.refit();
    rig.step(0);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);

    built.camera.position.set(-6, 4, 12);
    rig.switchFloor();
    rig.step(16);
    rig.step(100);

    expect(rig.moving).toBe(true);
  });

  it('is not landed until its first framing is drawn, and again after the scene is thrown away', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);

    expect(rig.landed).toBe(false);

    rig.refit();
    rig.step(0);

    expect(rig.landed).toBe(true);

    rig.forgetScene();

    expect(rig.landed).toBe(false);

    rig.refit();
    rig.step(16);

    expect(rig.landed).toBe(true);
    expect(
      built.camera.position.distanceTo(homePose(centre, distance, 0).position),
    ).toBeLessThan(1e-6);
  });

  it('lands the first framing at once when the reader touches before it is drawn', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.refit();
    rig.cancel();

    expect(rig.landed).toBe(true);
    expect(
      built.camera.position.distanceTo(homePose(centre, distance, 0).position),
    ).toBeLessThan(1e-6);
  });

  it('stays unlanded when the reader touches before any framing was asked for', () => {
    const rig = new CameraRig(() => undefined);

    rig.attach(stage());
    rig.cancel();

    expect(rig.landed).toBe(false);
  });

  it('flies through a floor switch until it lands, and a refit on the way does not restart it', () => {
    const moves: number[] = [];
    const rig = new CameraRig(() => moves.push(1));
    const built = stage();

    rig.attach(built);
    rig.refit();
    rig.step(0);
    built.camera.position.set(-6, 4, 12);
    rig.switchFloor();
    rig.sceneCommitted();

    expect(rig.flying).toBe(true);

    rig.step(16);
    rig.step(400);

    const midway = built.camera.position.clone();

    rig.refit();
    rig.step(400);

    expect(built.camera.position.distanceTo(midway)).toBeLessThan(1e-9);
    expect(rig.flying).toBe(true);

    const landing = moves.length;

    run(rig, 416, 2000);

    expect(rig.flying).toBe(false);
    expect(moves.length).toBeGreaterThan(landing);
  });

  it('holds the pose on screen after a floor switch until the new storeys are committed', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.refit();
    rig.step(0);
    built.camera.position.set(-6, 4, 12);
    built.controls.update();
    rig.switchFloor();
    run(rig, 16, 200);

    expect(built.camera.position.toArray()).toEqual([-6, 4, 12]);
    expect(rig.flying).toBe(true);

    rig.sceneCommitted();
    run(rig, 216, 400);

    expect(
      built.camera.position.distanceTo(new Vector3(-6, 4, 12)),
    ).toBeGreaterThan(0.1);
  });

  it('flies a floor switch anyway when no commit comes', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.refit();
    rig.step(0);
    built.camera.position.set(-6, 4, 12);
    rig.switchFloor();
    run(rig, 16, 3000);

    expect(
      built.camera.position.distanceTo(homePose(centre, distance, 0).position),
    ).toBeLessThan(1e-6);
    expect(rig.flying).toBe(false);
  });

  it('stops flying a floor switch when the reader takes the camera', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.refit();
    rig.step(0);
    rig.switchFloor();
    rig.step(16);
    rig.cancel();

    expect(rig.flying).toBe(false);
  });

  it('keeps a tilt down asked for before the home was framed, and lands it flat in one frame', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.attach(built);
    rig.refit();
    rig.step(0);

    expect(rig.flatAndStill).toBe(true);
  });

  it('snaps to a new framing while it rests under the plan, where no one sees it move', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.refit();
    rig.step(16);

    expect(rig.flatAndStill).toBe(true);
  });

  it('fits the home from the bearing the camera had', () => {
    const from = homePose(centre, distance * 2, 40);
    const pose = fitPose({ center: centre, distance }, from);

    expect(pose.target.toArray()).toEqual(centre.toArray());
    expect(pose.position.distanceTo(centre)).toBeCloseTo(distance, 9);
    expect(horizontalAngle(pose.position, centre)).toBeCloseTo(
      horizontalAngle(from.position, centre),
      9,
    );
  });

  it('frames a new storey from the burn-in place it last went home to', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const place = burnInPlaces[2];
    const goal = homePose(centre, distance, place.orbit);

    rig.attach(built);
    rig.goHome(place, 0);
    rig.step(0);
    built.camera.position.set(-6, 4, 12);
    rig.switchFloor();
    run(rig, 16, 3000);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(built.controls.target.distanceTo(goal.target)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);
  });

  it('refits from the bearing the reader left the camera at', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.cancel();
    built.camera.position.set(20, 6, -8);

    const goal = fitPose(
      { center: centre, distance },
      { position: built.camera.position.clone(), target: centre.clone() },
    );

    rig.refit();
    run(rig, 16, 3000);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);
  });

  it('raises a low bearing the reader left, so the storeys pulled apart are seen into', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.cancel();
    built.camera.position.set(20, 6, -8);
    rig.setStacked(true);
    rig.refit();
    run(rig, 16, 3000);

    const look = built.camera.position.clone().sub(built.controls.target);

    expect(Math.asin(look.y / look.length())).toBeCloseTo(STACK_PITCH, 6);
    expect(look.length()).toBeCloseTo(distance, 6);
    expect(horizontalAngle(built.camera.position, centre)).toBeCloseTo(
      horizontalAngle(new Vector3(20, 6, -8), centre),
      6,
    );
  });

  it('keeps a floor plan tilt when the scene refits under it', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.tiltDown({ orbit: 0, x: 0, y: 0 }, 0);
    rig.step(0);
    rig.refit();
    run(rig, 16, 3000);

    const look = built.camera.position.clone().sub(built.controls.target);

    expect(look.angleTo(new Vector3(0, 1, 0))).toBeLessThan(0.02);
  });

  it('flies home when the room it was sent to is not drawn', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const goal = homePose(centre, distance, 0);

    rig.attach(built);
    rig.flyTo(() => null, { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 1300);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
  });

  it('asks for the first frame itself, so a still scene starts moving', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);

    expect(built.frames).toBe(1);
  });

  it('jumps in one frame when the reader asks for less motion', () => {
    motionLive.reduced = true;

    const rig = new CameraRig(() => undefined);
    const built = stage();
    const goal = homePose(centre, distance, 2);

    rig.attach(built);
    rig.goHome({ orbit: 2, x: 0, y: 0 }, 1200);
    rig.step(5000);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
    expect(rig.moving).toBe(false);
  });

  it('stops where it is when the reader takes over', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 300);
    rig.cancel();

    const held = built.camera.position.clone();

    run(rig, 316, 2000);

    expect(built.camera.position.toArray()).toEqual(held.toArray());
    expect(rig.moving).toBe(false);
  });

  it('shifts the picture by the burn-in pixels, eased with the camera', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 10, y: -6 }, 3000);
    run(rig, 0, 3100);

    expect(built.camera.view?.enabled).toBe(true);
    expect(built.camera.view?.offsetX).toBeCloseTo(-10, 6);
    expect(built.camera.view?.offsetY).toBeCloseTo(6, 6);
  });

  it('raises the house into the upper part of the screen for portrait', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    built.size = { width: 800, height: 1280 };
    rig.attach(built);
    rig.setFraming({ raise: 1 / 6, zoom: 1, house: false });

    expect(built.camera.view?.offsetY).toBeCloseTo(1280 / 6, 6);
  });

  it('brings the house closer on a wide screen', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1.2, house: false });

    expect(built.camera.zoom).toBe(1.2);
  });

  it('leaves the projection alone when nothing is shifted', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1, house: false });

    expect(built.camera.view?.enabled ?? false).toBe(false);
    expect(built.camera.zoom).toBe(1);
  });

  it('stops the renderer framing the camera somewhere else while it moves', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    rig.step(0);

    expect(built.controls.events).toContain('start');
  });

  it('tells the card the view moved on every step', () => {
    const moved = vi.fn();
    const rig = new CameraRig(moved);
    const built = stage();

    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 160);

    expect(moved.mock.calls.length).toBeGreaterThan(5);
  });

  it('tells the card the view moved when the stage it draws on is resized', () => {
    const moved = vi.fn();
    const rig = new CameraRig(moved);

    rig.attach(stage());
    moved.mockClear();
    rig.attach({ ...stage(), size: { width: 300, height: 500 } });

    expect(moved).toHaveBeenCalled();
  });

  it('keeps the landscape zoom through a flight home and back', () => {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();

    rig.attach(built);
    rig.setFraming({ raise: 0, zoom: 1.2, house: false });
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 1300);

    expect(built.camera.zoom).toBe(1.2);
    expect(built.camera.view?.enabled ?? false).toBe(false);
  });

  it('waits for a stage before it moves anything', () => {
    const rig = new CameraRig(() => undefined);
    const built = stage();
    const goal = homePose(centre, distance, 0);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    rig.attach(built);
    rig.step(0);

    expect(built.camera.position.distanceTo(goal.position)).toBeLessThan(1e-6);
  });
});

describe('the portrait home view', () => {
  const tall = { width: 800, height: 1280 };
  const tolerance = 1;
  const top = HOUSE_MARGIN_PX;
  const bottom = tall.height - PORTRAIT_CONTROLS_PX - HOUSE_MARGIN_PX;

  function portrait(house: Box3): {
    rig: CameraRig;
    built: ReturnType<typeof stage>;
  } {
    const rig = new CameraRig(
      () => undefined,
      () => corners(house),
    );
    const built = stage();

    built.camera.aspect = tall.width / tall.height;
    built.size = tall;
    rig.setFraming({ raise: 1 / 6, zoom: 1, house: true });
    rig.attach(built);

    return { rig, built };
  }

  function onScreen(
    house: Box3,
    camera: PerspectiveCamera,
  ): { left: number; right: number; high: number; low: number } {
    const points = corners(house).map((point) => {
      const ndc = point.project(camera);

      return {
        x: ((ndc.x + 1) / 2) * tall.width,
        y: ((1 - ndc.y) / 2) * tall.height,
      };
    });

    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      high: Math.min(...points.map((point) => point.y)),
      low: Math.max(...points.map((point) => point.y)),
    };
  }

  it('fits one storey across the width, in the upper two thirds', () => {
    const { rig, built } = portrait(storey);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const box = onScreen(storey, built.camera);

    expect(box.left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
    expect(tall.width - box.right).toBeCloseTo(HOUSE_MARGIN_PX, 0);
    expect(box.high).toBeGreaterThanOrEqual(top - tolerance);
    expect(box.low).toBeLessThanOrEqual(tall.height * HOUSE_BAND + tolerance);
    expect((box.high + box.low) / 2).toBeCloseTo(
      (top + tall.height * HOUSE_BAND) / 2,
      0,
    );
  });

  it('fits the exploded stack between the top and the controls row', () => {
    const { rig, built } = portrait(stack);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const box = onScreen(stack, built.camera);
    const fills =
      Math.abs(box.right - box.left - (tall.width - 2 * HOUSE_MARGIN_PX)) <
        tolerance || Math.abs(box.low - box.high - (bottom - top)) < tolerance;

    expect(fills).toBe(true);
    expect(box.left).toBeGreaterThanOrEqual(HOUSE_MARGIN_PX - tolerance);
    expect(box.right).toBeLessThanOrEqual(
      tall.width - HOUSE_MARGIN_PX + tolerance,
    );
    expect(box.high).toBeGreaterThanOrEqual(top - tolerance);
    expect(box.low).toBeLessThanOrEqual(bottom + tolerance);
  });

  it('keeps the house on screen and off the controls at every burn-in position', () => {
    for (const house of [storey, stack]) {
      const { rig, built } = portrait(house);

      for (const place of burnInPlaces) {
        rig.goHome(place, 1200);
        run(rig, 0, 3000);

        const box = onScreen(house, built.camera);

        expect(box.left).toBeGreaterThan(0);
        expect(box.right).toBeLessThan(tall.width);
        expect(box.high).toBeGreaterThan(0);
        expect(box.low).toBeLessThan(tall.height - PORTRAIT_CONTROLS_PX);
      }
    }
  });

  it('lands on the fitted view in one frame when the reader asks for less motion', () => {
    motionLive.reduced = true;

    const { rig, built } = portrait(storey);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    rig.step(5000);

    const box = onScreen(storey, built.camera);

    expect(box.left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
    expect(tall.width - box.right).toBeCloseTo(HOUSE_MARGIN_PX, 0);
  });

  it('keeps the storey fitted through a flight into a room and back home', () => {
    const { rig, built } = portrait(storey);

    rig.flyTo(() => room(), { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const box = onScreen(storey, built.camera);

    expect(box.left).toBeGreaterThanOrEqual(HOUSE_MARGIN_PX - tolerance);
    expect(box.right).toBeLessThanOrEqual(
      tall.width - HOUSE_MARGIN_PX + tolerance,
    );
    expect(box.low).toBeLessThanOrEqual(bottom + tolerance);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 3016, 6000);

    expect(onScreen(storey, built.camera).left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
  });

  it('fits the house from wherever the renderer framed the camera', () => {
    const { rig, built } = portrait(storey);

    built.camera.position.set(20, 14, 26);
    built.controls.target.set(1, 0.5, -1);
    built.controls.update();
    run(rig, 0, 3000);

    const box = onScreen(storey, built.camera);

    expect(box.left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
    expect(tall.width - box.right).toBeCloseTo(HOUSE_MARGIN_PX, 0);
    expect(box.low).toBeLessThanOrEqual(tall.height * HOUSE_BAND + tolerance);
  });

  it('holds the lens while the reader has taken over, and fits again on a new framing', () => {
    const { rig, built } = portrait(storey);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);
    rig.cancel();

    const held = built.camera.zoom;

    built.camera.position.multiplyScalar(0.8);
    built.controls.update();
    run(rig, 3016, 6000);

    expect(built.camera.zoom).toBe(held);

    rig.switchFloor();
    run(rig, 6016, 9000);

    expect(onScreen(storey, built.camera).left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
  });

  it('refits after a flight home when the house changed while it flew', () => {
    let house = storey;
    const rig = new CameraRig(
      () => undefined,
      () => corners(house),
    );
    const built = stage();

    built.camera.aspect = tall.width / tall.height;
    built.size = tall;
    rig.setFraming({ raise: 1 / 6, zoom: 1, house: true });
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);
    rig.step(0);
    house = stack;

    let now = 16;
    let counted = 0;

    while (built.frames > counted && now < 20000) {
      counted = built.frames;
      rig.step(now);
      now += 16;
    }

    const box = onScreen(stack, built.camera);

    expect(box.high).toBeGreaterThanOrEqual(top - tolerance);
    expect(box.low).toBeLessThanOrEqual(bottom + tolerance);
    expect(box.left).toBeGreaterThanOrEqual(HOUSE_MARGIN_PX - tolerance);
  });

  it('refits once more when the camera moved after its last look', () => {
    const { rig, built } = portrait(storey);
    const start = new Vector3(24, 18, 26);
    const end = new Vector3(20, 14, 22);
    let now = 0;
    let counted = 0;

    built.controls.target.set(0, 1, 0);

    for (let frame = 0; frame <= 20; frame += 1) {
      counted = built.frames;
      rig.step(now);
      now += 16;
      built.camera.position.lerpVectors(start, end, frame / 20);
      built.controls.update();
    }

    while (built.frames > counted && now < 20000) {
      counted = built.frames;
      rig.step(now);
      now += 16;
    }

    expect(onScreen(storey, built.camera).left).toBeCloseTo(HOUSE_MARGIN_PX, 0);
  });

  it('eases home in one move when the controls hold the camera nearer than the home view', () => {
    const reach = 40;
    const { rig, built } = portrait(stack);
    const clamped = {
      ...built.controls,
      maxDistance: reach,
      update: () => {
        const offset = built.camera.position.clone().sub(clamped.target);

        built.camera.position
          .copy(clamped.target)
          .add(offset.clampLength(0, reach));
        built.camera.lookAt(clamped.target);
      },
    };

    built.controls = clamped;
    built.frame = () => ({ center: centre.clone(), distance: 60 });
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 1200);

    const zooms: number[] = [];
    let now = 0;
    let counted = -1;

    while (built.frames > counted && now < 20000) {
      counted = built.frames;
      rig.step(now);
      zooms.push(built.camera.zoom);
      now += 16;
    }

    const steps = zooms.slice(1).map((zoom, index) => zoom - zooms[index]);
    const rising = steps.filter((step) => step > 1e-9).length;
    const falling = steps.filter((step) => step < -1e-9).length;

    expect(Math.min(rising, falling)).toBe(0);
    expect(built.camera.position.distanceTo(clamped.target)).toBeCloseTo(
      reach,
      6,
    );
    expect(now).toBeLessThanOrEqual(1200 + 16 * 4);
  });

  it('returns to a storey in one move without passing the reach of the controls', () => {
    const reach = 40;
    let house = stack;
    const rig = new CameraRig(
      () => undefined,
      () => corners(house),
    );
    const built = stage();
    const clamped = {
      ...built.controls,
      maxDistance: reach,
      update: () => {
        const offset = built.camera.position.clone().sub(clamped.target);

        built.camera.position
          .copy(clamped.target)
          .add(offset.clampLength(0, reach));
        built.camera.lookAt(clamped.target);
      },
    };

    built.camera.aspect = tall.width / tall.height;
    built.size = tall;
    built.controls = clamped;
    built.frame = () => ({ center: centre.clone(), distance: 46 });
    rig.setFraming({ raise: 1 / 6, zoom: 1, house: true });
    rig.attach(built);
    rig.goHome(burnInPlaces[1], 0);
    rig.step(0);

    house = storey;
    built.frame = () => ({ center: new Vector3(0.4, 0, -0.3), distance: 46 });
    rig.switchFloor();

    const distances: number[] = [];
    const zooms: number[] = [];
    let now = 16;
    let counted = -1;

    while ((built.frames > counted || now <= 900) && now < 20000) {
      if (now === 16 + 16 * 50) rig.goHome(burnInPlaces[1], 1200);

      counted = built.frames;
      rig.step(now);
      distances.push(built.camera.position.distanceTo(clamped.target));
      zooms.push(built.camera.zoom);
      now += 16;
    }

    const steps = zooms.slice(1).map((zoom, index) => zoom - zooms[index]);
    const rising = steps.filter((step) => step > 1e-9).length;
    const falling = steps.filter((step) => step < -1e-9).length;
    const widest = Math.max(
      ...steps.map((step, index) => Math.abs(step) / zooms[index]),
    );

    expect(Math.max(...distances)).toBeLessThanOrEqual(reach + 1e-9);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(reach - 1e-9);
    expect(Math.min(rising, falling)).toBe(0);
    expect(widest).toBeLessThan(0.02);
  });

  it('stops asking for frames at home while the controls still drift the camera by a hair', () => {
    const { rig, built } = portrait(stack);

    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);

    let drift = 1e-3;
    let now = 3016;
    let counted = -1;

    while (built.frames > counted && now < 20000) {
      counted = built.frames;
      drift *= 0.92;
      built.camera.position.x += drift;
      built.controls.update();
      rig.step(now);
      now += 16;
    }

    expect(now).toBeLessThanOrEqual(3016 + 16 * 2);
  });

  it('follows the house when it changes, then stops asking for frames', () => {
    let house = storey;
    const rig = new CameraRig(
      () => undefined,
      () => corners(house),
    );
    const built = stage();

    built.camera.aspect = tall.width / tall.height;
    built.size = tall;
    rig.setFraming({ raise: 1 / 6, zoom: 1, house: true });
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);
    house = stack;
    run(rig, 3016, 6000);

    const asked = built.frames;
    const box = onScreen(stack, built.camera);

    run(rig, 6016, 9000);

    expect(built.frames).toBe(asked);
    expect(box.high).toBeGreaterThanOrEqual(top - tolerance);
    expect(box.low).toBeLessThanOrEqual(bottom + tolerance);
  });
});

describe('the home view clear of the card controls', () => {
  const wide = { width: 1280, height: 800 };
  const phone = { width: 390, height: 504 };
  const tolerance = 1;

  function fitted(
    size: { width: number; height: number },
    clear: Rect[],
    orbit = 0,
  ): { left: number; right: number; high: number; low: number } {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();

    built.camera.aspect = size.width / size.height;
    built.size = size;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear(clear);
    rig.attach(built);
    rig.goHome({ orbit, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);

    const points = corners(storey).map((point) => {
      const ndc = point.project(built.camera);

      return {
        x: ((ndc.x + 1) / 2) * size.width,
        y: ((1 - ndc.y) / 2) * size.height,
      };
    });

    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      high: Math.min(...points.map((point) => point.y)),
      low: Math.max(...points.map((point) => point.y)),
    };
  }

  function overlaps(
    box: { left: number; right: number; high: number; low: number },
    rect: Rect,
  ): boolean {
    return (
      box.left < rect.right - tolerance &&
      box.right > rect.left + tolerance &&
      box.high < rect.bottom - tolerance &&
      box.low > rect.top + tolerance
    );
  }

  it('keeps the house a margin away from the controls in the top left corner', () => {
    const controls = [
      { left: 12, top: 12, right: 112, bottom: 64 },
      { left: 12, top: 72, right: 64, bottom: 240 },
    ];
    const box = fitted(wide, controls);
    const beside = box.left >= 112 + HOUSE_MARGIN_PX - tolerance;
    const below = box.high >= 240 + HOUSE_MARGIN_PX - tolerance;

    expect(beside || below).toBe(true);
    expect(box.right).toBeLessThanOrEqual(
      wide.width - HOUSE_MARGIN_PX + tolerance,
    );
    expect(box.low).toBeLessThanOrEqual(
      wide.height - HOUSE_MARGIN_PX + tolerance,
    );
  });

  it('never lets the house run under a control at any burn-in position', () => {
    const controls = [{ left: 12, top: 12, right: 112, bottom: 64 }];

    for (const place of burnInPlaces) {
      const box = fitted(phone, controls, place.orbit);

      expect(overlaps(box, controls[0])).toBe(false);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(phone.width);
    }
  });

  it('keeps the house clear of a dock along the bottom', () => {
    const dock = { left: 200, top: 1180, right: 600, bottom: 1264 };
    const box = fitted({ width: 800, height: 1280 }, [dock]);

    expect(box.low).toBeLessThanOrEqual(1180 - HOUSE_MARGIN_PX + tolerance);
  });

  it('centres the house in the whole card when there are no controls', () => {
    const box = fitted(wide, []);

    expect((box.left + box.right) / 2).toBeCloseTo(wide.width / 2, 0);
    expect((box.high + box.low) / 2).toBeCloseTo(wide.height / 2, 0);
  });

  it('offers the reader of a clear card every side to fit against', () => {
    expect(
      clearInsets([{ left: 12, top: 12, right: 112, bottom: 64 }], wide),
    ).toEqual([
      { left: 112, top: 0, right: 0, bottom: 0 },
      { left: 0, top: 64, right: 0, bottom: 0 },
      { left: 0, top: 0, right: 1268, bottom: 0 },
      { left: 0, top: 0, right: 0, bottom: 788 },
    ]);
  });
});

describe('the view with a room sheet open', () => {
  const card = { width: 372, height: 464 };
  const corner = new Box3(new Vector3(1, 0, 0), new Vector3(6, 2.8, 4));
  const tolerance = 1;

  function framed(
    size: { width: number; height: number },
    covered: Rect,
    room: Box3,
  ): { room: Rect; house: Rect } {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();

    built.camera.aspect = size.width / size.height;
    built.size = size;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear([]);
    rig.setSheet({ key: 'room:corner', room: () => corners(room), covered });
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);

    const onScreen = (box: Box3): Rect => {
      const points = corners(box).map((point) => {
        const ndc = point.project(built.camera);

        return {
          x: ((ndc.x + 1) / 2) * size.width,
          y: ((1 - ndc.y) / 2) * size.height,
        };
      });

      return {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
    };

    return { room: onScreen(room), house: onScreen(storey) };
  }

  function within(box: Rect, area: Rect): boolean {
    return (
      box.left >= area.left - tolerance &&
      box.right <= area.right + tolerance &&
      box.top >= area.top - tolerance &&
      box.bottom <= area.bottom + tolerance
    );
  }

  function opened(covered: Rect): { rig: CameraRig; built: RigStage } {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();

    built.camera.aspect = card.width / card.height;
    built.size = card;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear([]);
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);
    rig.setSheet({ key: 'room:corner', room: () => corners(corner), covered });

    return { rig, built };
  }

  it('reports a reframe until the view has settled beside a sheet that covered the room', () => {
    const { rig, built } = opened({
      left: 0,
      top: 162,
      right: card.width,
      bottom: card.height,
    });
    const before = built.camera.view?.offsetY ?? 0;

    expect(rig.reframing).toBe(true);

    run(rig, 3016, 3100);

    expect(rig.reframing).toBe(true);
    expect(built.camera.view?.offsetY ?? 0).not.toBeCloseTo(before);

    run(rig, 3116, 6000);

    expect(rig.reframing).toBe(false);
  });

  it('glides to the room over the pan easing even when the first frame comes late', () => {
    const covered = {
      left: 0,
      top: 162,
      right: card.width,
      bottom: card.height,
    };
    const { rig, built } = opened(covered);
    const start = built.camera.view?.offsetY ?? 0;

    rig.step(3600);
    const first = built.camera.view?.offsetY ?? 0;

    rig.step(3600 + SHEET_GLIDE_MS / 2);
    const middle = built.camera.view?.offsetY ?? 0;

    rig.step(3600 + SHEET_GLIDE_MS + 16);
    const end = built.camera.view?.offsetY ?? 0;
    const progress = (middle - start) / (end - start);

    expect(first).toBeCloseTo(start);
    expect(progress).toBeGreaterThan(0.2);
    expect(progress).toBeLessThan(0.8);
    expect(rig.reframing).toBe(false);
  });

  it('moves to the room in one frame when motion is reduced', () => {
    motionLive.reduced = true;

    const covered = {
      left: 0,
      top: 162,
      right: card.width,
      bottom: card.height,
    };
    const { rig, built } = opened(covered);
    const start = built.camera.view?.offsetY ?? 0;

    rig.step(3016);

    expect(built.camera.view?.offsetY ?? 0).not.toBeCloseTo(start);
    expect(rig.reframing).toBe(false);
  });

  it('leaves the view still and reports no reframe when the room already shows beside the sheet', () => {
    const { rig, built } = opened({
      left: 0,
      top: card.height - 20,
      right: card.width,
      bottom: card.height,
    });
    const before = built.camera.projectionMatrix.clone();

    run(rig, 3016, 3050);

    expect(rig.reframing).toBe(false);
    expect(built.camera.projectionMatrix.equals(before)).toBe(true);
  });

  it('settles back from a closed sheet within about a second even when every frame is slow', () => {
    const { rig, built } = opened({
      left: 0,
      top: 162,
      right: card.width,
      bottom: card.height,
    });

    run(rig, 3016, 8000);
    rig.setSheet(null);

    let frames = 0;
    let last = built.camera.projectionMatrix.clone();

    for (let now = 8500; now <= 30000; now += 500) {
      rig.step(now);
      frames += 1;

      if (built.camera.projectionMatrix.equals(last)) break;

      last = built.camera.projectionMatrix.clone();
    }

    expect(frames).toBeLessThanOrEqual(5);
  });

  it('frames the picked room in the stage a bottom sheet leaves uncovered', () => {
    const sheet = { left: 0, top: 162, right: card.width, bottom: card.height };
    const { room } = framed(card, sheet, corner);

    expect(within(room, { ...sheet, top: 0, bottom: sheet.top })).toBe(true);
  });

  it('pans the house up only until the picked room clears a bottom sheet', () => {
    const sheet = { left: 0, top: 300, right: card.width, bottom: card.height };
    const { room } = framed(card, sheet, corner);
    const above = { ...sheet, top: 0, bottom: sheet.top };

    expect(within(room, above)).toBe(true);
    expect(room.bottom).toBeCloseTo(sheet.top - SHEET_FRAME_MARGIN_PX, 0);
  });

  it('frames the picked room beside a floating sheet that would cover it', () => {
    const wide = { width: 498, height: 464 };
    const sheet = { left: 200, top: 100, right: 456, bottom: 358 };
    const { room } = framed(wide, sheet, corner);
    const beside = [
      { left: 0, top: 0, right: sheet.left, bottom: wide.height },
      { left: 0, top: 0, right: wide.width, bottom: sheet.top },
      { left: sheet.right, top: 0, right: wide.width, bottom: wide.height },
      { left: 0, top: sheet.bottom, right: wide.width, bottom: wide.height },
    ];

    expect(beside.some((area) => within(room, area))).toBe(true);
  });

  it('keeps the house in view when the thing under the sheet has no size yet', () => {
    const sheet = { left: 0, top: 300, right: card.width, bottom: card.height };
    const unmeasured = new Box3(
      new Vector3(NaN, NaN, NaN),
      new Vector3(NaN, NaN, NaN),
    );
    const { house } = framed(card, sheet, unmeasured);

    expect(
      [house.left, house.top, house.right, house.bottom].every(Number.isFinite),
    ).toBe(true);
  });

  it('fits the whole house above the sheet when the room would be too small there', () => {
    const sheet = { left: 0, top: 70, right: card.width, bottom: card.height };
    const { room, house } = framed(card, sheet, corner);
    const above = { ...sheet, top: 0, bottom: sheet.top };

    expect(within(house, above)).toBe(true);
    expect(within(room, above)).toBe(true);
  });
});

describe('where a floating sheet settles beside its room', () => {
  const stage = { width: 498, height: 464 };
  const house = { left: 20, top: 20, right: 478, bottom: 444 };
  const middle = { left: 130, top: 100, right: 386, bottom: 358 };
  const flushRight = { left: 230, top: 100, right: 486, bottom: 358 };
  const flushLeft = { left: 12, top: 100, right: 268, bottom: 358 };

  it('moves the sheet to the stage edge that leaves the room room to show whole', () => {
    const room = { left: 280, top: 100, right: 420, bottom: 255 };
    const placed = sheetPlacement(
      room,
      house,
      [middle, flushRight, flushLeft],
      [],
      stage,
    );

    expect(placed.cover).toEqual(flushLeft);
    expect(placed.move.scale).toBe(1);
  });

  it('keeps the sheet where it opened when a pan alone shows the whole room', () => {
    const wide = { width: 1024, height: 806 };
    const opened = { left: 700, top: 400, right: 956, bottom: 670 };
    const room = { left: 600, top: 300, right: 780, bottom: 480 };
    const placed = sheetPlacement(
      room,
      { left: 100, top: 50, right: 900, bottom: 750 },
      [opened, { left: 16, top: 400, right: 272, bottom: 670 }],
      [],
      wide,
    );

    expect(placed.cover).toEqual(opened);
    expect(placed.move.scale).toBe(1);
  });

  it('keeps the sheet where it opened when the room is already clear of it', () => {
    const room = { left: 40, top: 100, right: 180, bottom: 255 };
    const placed = sheetPlacement(
      room,
      house,
      [flushRight, middle, flushLeft],
      [],
      stage,
    );

    expect(placed.cover).toEqual(flushRight);
    expect(placed.move.scale).toBe(1);
  });
});

describe('the plan beside a floating sheet', () => {
  const size = { width: 1024, height: 806 };
  const sheet = { left: 584, top: 184, right: 820, bottom: 458 };

  it('leaves the plan still when the tapped room already shows beside the sheet', () => {
    const room = { left: 200, top: 300, right: 400, bottom: 420 };

    expect(planSheetPlacement(room, sheet, [], size)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('leaves the plan still when the tapped room already shows above the sheet', () => {
    const room = { left: 600, top: 40, right: 800, bottom: 150 };

    expect(planSheetPlacement(room, sheet, [], size)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('leaves the plan still when the tapped room shows whole beside the sheet, even inside the framing margin', () => {
    const room = { left: 470, top: 300, right: 580, bottom: 400 };

    expect(planSheetPlacement(room, sheet, [], size)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('leaves the plan still when the tapped room shows whole, even with its tag under the sheet', () => {
    const room = { left: 200, top: 300, right: 400, bottom: 420 };
    const tag = { left: 600, top: 200, right: 700, bottom: 222 };

    expect(planSheetPlacement(room, sheet, [], size, tag)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('pans a covered room the shortest way out from under the sheet, at the zoom the reader had', () => {
    const room = { left: 520, top: 300, right: 640, bottom: 400 };
    const move = planSheetPlacement(room, sheet, [], size);

    expect(move.scale).toBe(1);
    expect(move.y).toBe(0);
    expect(room.right + move.x).toBeCloseTo(sheet.left - SHEET_FRAME_MARGIN_PX);
  });

  it('keeps a pan clear of the controls as well as the sheet', () => {
    const room = { left: 20, top: 300, right: 120, bottom: 400 };
    const controls = { left: 0, top: 0, right: 140, bottom: 806 };
    const move = planSheetPlacement(room, sheet, [controls], size);

    expect(move.scale).toBe(1);
    expect(room.left + move.x).toBeGreaterThanOrEqual(
      controls.right + SHEET_FRAME_MARGIN_PX - 1e-6,
    );
    expect(room.right + move.x).toBeLessThanOrEqual(
      sheet.left - SHEET_FRAME_MARGIN_PX + 1e-6,
    );
  });

  it('keeps the tapped tag beside the sheet, and as much of its room as fits, when both will not fit', () => {
    const narrow = { width: 468, height: 351 };
    const docked = { left: 184, top: 16, right: 456, bottom: 335 };
    const room = { left: 210, top: 60, right: 300, bottom: 105 };
    const tag = { left: 82, top: 255, right: 190, bottom: 273 };
    const move = planSheetPlacement(room, docked, [], narrow, tag);

    expect(move.scale).toBe(1);
    expect(tag.left + move.x).toBeGreaterThanOrEqual(0);
    expect(tag.right + move.x).toBeLessThanOrEqual(
      docked.left - SHEET_FRAME_MARGIN_PX + 1e-6,
    );
    expect(room.left + move.x).toBeLessThan(docked.left);
  });
});

describe('the stack of all floors beside a sheet', () => {
  const stack = { left: 100, top: 0, right: 500, bottom: 600 };

  it('stays still when the whole stack already shows beside the sheet', () => {
    const beside = { left: 0, top: 0, right: 600, bottom: 700 };

    expect(stackFraming(stack, [beside])).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('fits the whole stack into the free area and centres it there', () => {
    const left = { left: 0, top: 0, right: 300, bottom: 600 };
    const move = stackFraming(stack, [left]);
    const shown = {
      left: move.scale * stack.left + move.x,
      right: move.scale * stack.right + move.x,
      top: move.scale * stack.top + move.y,
      bottom: move.scale * stack.bottom + move.y,
    };

    expect(shown.left).toBeGreaterThanOrEqual(left.left);
    expect(shown.right).toBeLessThanOrEqual(left.right);
    expect(shown.top).toBeGreaterThanOrEqual(left.top);
    expect(shown.bottom).toBeLessThanOrEqual(left.bottom);
    expect((shown.left + shown.right) / 2).toBeCloseTo(150, 6);
  });
});

describe('the move that brings a room out from under a sheet', () => {
  const house = { left: 0, top: 0, right: 400, bottom: 300 };

  it('leaves the view alone when the room already shows whole in an uncovered area', () => {
    const small = { left: 0, top: 200, right: 300, bottom: 300 };
    const room = { left: 0, top: 200, right: 100, bottom: 300 };
    const area = { left: 0, top: 0, right: 400, bottom: 400 };

    expect(sheetFraming(room, small, [area])).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('pans a room that must move the shortest way into the uncovered area, at the same scale', () => {
    const small = { left: 0, top: 200, right: 300, bottom: 300 };
    const room = { left: 0, top: 200, right: 100, bottom: 300 };
    const area = { left: 20, top: 0, right: 400, bottom: 400 };

    expect(sheetFraming(room, small, [area])).toEqual({
      scale: 1,
      x: 20,
      y: 0,
    });
  });

  it('pans a room that shows whole but inside the framing margin until it keeps the margin', () => {
    const room = { left: 100, top: 200, right: 200, bottom: 290 };
    const framed = { left: 16, top: 16, right: 384, bottom: 284 };

    expect(sheetFraming(room, house, [framed])).toEqual({
      scale: 1,
      x: 0,
      y: -6,
    });
  });

  it('pans a phone room half under the bottom sheet up only until it clears it', () => {
    const phone = { left: 0, top: 0, right: 390, bottom: 750 };
    const hall = { left: 184, top: 257, right: 247, bottom: 457 };
    const above = { left: 122, top: 16, right: 374, bottom: 359 };

    expect(sheetFraming(hall, phone, [above])).toEqual({
      scale: 1,
      x: 0,
      y: -98,
    });
  });

  it('leaves the view alone when the house already sits in the middle of the uncovered area', () => {
    const room = { left: 20, top: 20, right: 120, bottom: 100 };

    expect(
      sheetFraming(room, house, [
        { left: 0, top: -50, right: 400, bottom: 350 },
      ]),
    ).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('pans a room under the sheet just far enough to clear it', () => {
    const room = { left: 100, top: 200, right: 200, bottom: 280 };
    const area = { left: 0, top: 0, right: 400, bottom: 150 };

    expect(sheetFraming(room, house, [area])).toEqual({
      scale: 1,
      x: 0,
      y: -130,
    });
  });

  it('pans a room sideways out from under a sheet beside it', () => {
    const room = { left: 300, top: 100, right: 380, bottom: 200 };
    const area = { left: 0, top: 0, right: 200, bottom: 300 };
    const move = sheetFraming(room, house, [area]);

    expect(move).toEqual({ scale: 1, x: -180, y: 0 });
  });

  it('picks the uncovered area that needs the shortest pan', () => {
    const room = { left: 400, top: 100, right: 500, bottom: 250 };
    const wide = { left: 100, top: 0, right: 500, bottom: 300 };
    const above = { left: 0, top: 0, right: 600, bottom: 150 };
    const beside = { left: 0, top: 0, right: 420, bottom: 400 };
    const move = sheetFraming(room, wide, [above, beside]);

    expect(move).toEqual({ scale: 1, x: -80, y: 0 });
  });

  it('shrinks a room that is too big for the area, while it stays legible', () => {
    const room = { left: 0, top: 100, right: 400, bottom: 300 };
    const area = { left: 0, top: 0, right: 400, bottom: 100 };
    const move = sheetFraming(room, house, [area]);

    expect(move.scale).toBeCloseTo(0.5);
    expect(100 * move.scale + move.y).toBeCloseTo(0);
  });

  it('fits the whole house when the room would be too small to read', () => {
    const room = { left: 0, top: 100, right: 400, bottom: 300 };
    const area = { left: 0, top: 0, right: 400, bottom: 40 };
    const move = sheetFraming(room, house, [area]);

    expect(move.scale).toBeCloseTo(40 / 300);
    expect(house.bottom * move.scale + move.y).toBeLessThanOrEqual(40 + 1e-9);
  });
});

describe('the home view of a whole storey', () => {
  const desktop = { width: 1264, height: 670 };
  const controls = [
    { left: 12, top: 12, right: 110, bottom: 64 },
    { left: 12, top: 72, right: 60, bottom: 246 },
  ];
  const phone = { width: 390, height: 570 };
  const phoneControls = [
    { left: 12, top: 12, right: 110, bottom: 64 },
    { left: 12, top: 72, right: 64, bottom: 124 },
  ];
  const tolerance = 1;

  type ScreenBox = { left: number; right: number; high: number; low: number };

  function lawn(width: number, depth: number): Mesh {
    const mesh = new Mesh(new PlaneGeometry(width, depth));

    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld();

    return mesh;
  }

  function fitted(
    size: { width: number; height: number },
    clear: Rect[],
    ground: () => Vector3[] = () => [],
  ): (shown: Box3) => ScreenBox {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
      ground,
    );
    const built = stage();

    built.camera.aspect = size.width / size.height;
    built.size = size;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear(clear);
    rig.attach(built);
    rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
    run(rig, 0, 3000);

    return (shown) => {
      const points = corners(shown).map((point) => {
        const ndc = point.project(built.camera);

        return {
          x: ((ndc.x + 1) / 2) * size.width,
          y: ((1 - ndc.y) / 2) * size.height,
        };
      });

      return {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        high: Math.min(...points.map((point) => point.y)),
        low: Math.max(...points.map((point) => point.y)),
      };
    };
  }

  it('leaves a share of the card as air on every side of a wide card', () => {
    const box = fitted(desktop, controls)(storey);
    const across = HOUSE_AIR * desktop.width;
    const down = HOUSE_AIR * desktop.height;

    expect(box.right).toBeLessThanOrEqual(desktop.width - across + tolerance);
    expect(box.high).toBeGreaterThanOrEqual(down - tolerance);
    expect(box.low).toBeLessThanOrEqual(desktop.height - down + tolerance);
    expect(box.left).toBeGreaterThanOrEqual(110 + across - tolerance);
  });

  it('frames a garden a little bigger than the house whole, clear of the controls', () => {
    const garden = new Box3(new Vector3(-7, 0, -5), new Vector3(7, 0, 5));
    const box = fitted(desktop, controls, () => groundPoints([lawn(14, 10)]))(
      garden,
    );

    expect(box.left).toBeGreaterThanOrEqual(110 - tolerance);
    expect(box.right).toBeLessThanOrEqual(desktop.width - tolerance);
    expect(box.high).toBeGreaterThanOrEqual(0);
    expect(box.low).toBeLessThanOrEqual(desktop.height - tolerance);
  });

  it('keeps the house across most of a phone and lets a big lawn crop', () => {
    const shot = fitted(phone, phoneControls, () =>
      groundPoints([lawn(60, 60)]),
    );
    const house = shot(storey);
    const margin = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * phone.width);

    expect(house.right - house.left).toBeGreaterThanOrEqual(
      HOUSE_SHARE * phone.width - tolerance,
    );
    expect(house.left).toBeGreaterThanOrEqual(margin - tolerance);
    expect(house.right).toBeLessThanOrEqual(phone.width - margin + tolerance);
    expect(house.high).toBeGreaterThanOrEqual(124 - tolerance);
    expect(house.low).toBeLessThanOrEqual(phone.height);
  });

  it('spans a phone with the house from margin to margin, in the middle of the stage', () => {
    const tall = { width: 390, height: 750 };
    const house = fitted(tall, phoneControls, () =>
      groundPoints([lawn(60, 60)]),
    )(storey);
    const margin = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * tall.width);

    expect(house.right - house.left).toBeGreaterThanOrEqual(
      tall.width - 2 * margin - tolerance,
    );
    expect(
      Math.abs((house.high + house.low) / 2 - tall.height / 2),
    ).toBeLessThanOrEqual(0.05 * tall.height);
  });

  it('looks down more steeply on a phone, so the lawn and not the sky fills round the house', () => {
    const pitch = (aspect: number): number => {
      const pose = homePose(centre, 20, 0, aspect);
      const offset = pose.position.clone().sub(pose.target);

      return Math.asin(offset.y / offset.length());
    };

    expect(pitch(390 / 750)).toBeGreaterThan(pitch(1280 / 800) + 0.2);
    expect(pitch(1280 / 800)).toBeCloseTo(pitch(1), 6);
  });

  it('looks down into every storey when the storeys stand apart', () => {
    const pitchHome = (stacked: boolean): number => {
      const rig = new CameraRig(() => undefined);
      const built = stage();

      rig.attach(built);
      rig.setStacked(stacked);
      rig.goHome({ orbit: 0, x: 0, y: 0 }, 0);
      run(rig, 0, 32);

      const offset = built.camera.position.clone().sub(built.controls.target);

      return Math.asin(offset.y / offset.length());
    };
    const alone = homePose(centre, distance, 0);
    const level = alone.position.clone().sub(alone.target).normalize().y;

    expect(pitchHome(false)).toBeCloseTo(Math.asin(level), 6);
    expect(pitchHome(true)).toBeCloseTo(STACK_PITCH, 6);
    expect(STACK_PITCH).toBeGreaterThan(Math.asin(level));
  });

  it('keeps the whole house inside the margins when a big lawn crops on a wide card', () => {
    const house = fitted(desktop, controls, () => groundPoints([lawn(60, 60)]))(
      storey,
    );

    expect(house.left).toBeGreaterThanOrEqual(110 - tolerance);
    expect(house.right).toBeLessThanOrEqual(desktop.width - tolerance);
    expect(house.high).toBeGreaterThanOrEqual(0);
    expect(house.low).toBeLessThanOrEqual(desktop.height - tolerance);
  });

  describe('in a near-square card with a garden out in front', () => {
    const cellControls = [
      { left: 12, top: 12, right: 110, bottom: 64 },
      { left: 12, top: 72, right: 61, bottom: 246 },
    ];
    const cards = [
      { name: 'a sections cell', width: 500, height: 463 },
      { name: 'a square card', width: 720, height: 690 },
      { name: 'a tall sections cell', width: 780, height: 800 },
      { name: 'a 4:3 card', width: 800, height: 600 },
      { name: 'a 3:4 card', width: 600, height: 800 },
    ];

    function frontGarden(): Vector3[] {
      const mesh = lawn(40, 40);

      mesh.position.set(10, 0, 10);
      mesh.updateMatrixWorld();

      return groundPoints([mesh]);
    }

    for (const card of cards) {
      it(`spans the house across 70% of the side it is bound by in ${card.name}`, () => {
        const house = fitted(card, cellControls, frontGarden)(storey);
        const wide = (house.right - house.left) / card.width;
        const tall = (house.low - house.high) / card.height;

        expect(Math.max(wide, tall)).toBeGreaterThanOrEqual(
          HOUSE_SHARE - tolerance / card.width,
        );
      });

      it(`centres the house instead of the cropped garden in ${card.name}`, () => {
        const house = fitted(card, cellControls, frontGarden)(storey);
        const across = (house.left + house.right) / 2;
        const middle = (house.high + house.low) / 2;

        expect(Math.abs(across - card.width / 2)).toBeLessThanOrEqual(
          0.1 * card.width,
        );
        expect(Math.abs(middle - card.height / 2)).toBeLessThanOrEqual(
          0.1 * card.height,
        );
      });

      it(`keeps the house whole and a margin away from every control in ${card.name}`, () => {
        const house = fitted(card, cellControls, frontGarden)(storey);
        const across = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * card.width);
        const down = Math.max(HOUSE_MARGIN_PX, HOUSE_AIR * card.height);

        expect(house.left).toBeGreaterThanOrEqual(across - tolerance);
        expect(house.right).toBeLessThanOrEqual(
          card.width - across + tolerance,
        );
        expect(house.high).toBeGreaterThanOrEqual(down - tolerance);
        expect(house.low).toBeLessThanOrEqual(card.height - down + tolerance);

        for (const control of cellControls) {
          const clear =
            house.left >= control.right + across - tolerance ||
            house.high >= control.bottom + down - tolerance;

          expect(clear).toBe(true);
        }
      });
    }
  });

  it('has no ground points when nothing is drawn around the storey', () => {
    expect(groundPoints([])).toEqual([]);
    expect(groundPoints([new Group()])).toEqual([]);
  });
});

describe('an alert flight', () => {
  const wide = { width: 1264, height: 806 };
  const small = { width: 308, height: 232 };
  const dock = [
    { left: 12, top: 12, right: 98, bottom: 58 },
    { left: 12, top: 66, right: 58, bottom: 330 },
  ];
  const banner = { left: 112, top: 12, right: 1252, bottom: 118 };
  const tolerance = 1;

  function flown(
    size: { width: number; height: number },
    clear: Rect[],
    before: (rig: CameraRig) => void = () => undefined,
  ): { rig: CameraRig; built: ReturnType<typeof stage>; box: () => Rect } {
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
    );
    const built = stage();

    built.camera.aspect = size.width / size.height;
    built.size = size;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear(clear);
    before(rig);
    rig.attach(built);

    const box = (): Rect => {
      const points = corners(storey).map((point) => {
        const ndc = point.project(built.camera);

        return {
          x: ((ndc.x + 1) / 2) * size.width,
          y: ((1 - ndc.y) / 2) * size.height,
        };
      });

      return {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
    };

    return { rig, built, box };
  }

  it('shows the whole storey, clear of the banner and the controls, around the room', () => {
    const { rig, box } = flown(wide, [...dock, banner]);

    rig.flyTo(() => room(), { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const house = box();

    expect(house.top).toBeGreaterThanOrEqual(banner.bottom - tolerance);
    expect(house.left).toBeGreaterThanOrEqual(0);
    expect(house.right).toBeLessThanOrEqual(wide.width);
    expect(house.bottom).toBeLessThanOrEqual(wide.height);
  });

  it('centres the storey in the space under the banner, whatever garden lies behind it', () => {
    const garden = new Box3(new Vector3(-8, 0, -14), new Vector3(8, 0, 5));
    const rig = new CameraRig(
      () => undefined,
      () => corners(storey),
      () => corners(garden),
    );
    const built = stage();

    built.camera.aspect = wide.width / wide.height;
    built.size = wide;
    rig.setFraming({ raise: 0, zoom: 1, house: true });
    rig.setClear([...dock, banner], banner.bottom);
    rig.attach(built);
    run(rig, 0, 3000);

    const points = corners(storey).map((point) => point.project(built.camera));
    const ys = points.map((ndc) => ((1 - ndc.y) / 2) * wide.height);
    const house = { top: Math.min(...ys), bottom: Math.max(...ys) };

    expect((house.top + house.bottom) / 2).toBeCloseTo(
      (banner.bottom + wide.height) / 2,
      -1,
    );
  });

  it('keeps a small card whole below the banner too', () => {
    const cramped = { left: 112, top: 12, right: 296, bottom: 118 };
    const { rig, box } = flown(small, [dock[0], cramped]);

    rig.flyTo(() => room(), { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const house = box();

    expect(house.top).toBeGreaterThanOrEqual(cramped.bottom - tolerance);
    expect(house.left).toBeGreaterThanOrEqual(0);
    expect(house.right).toBeLessThanOrEqual(small.width);
    expect(house.bottom).toBeLessThanOrEqual(small.height);
  });

  it('looks down into the room from its side, steeply', () => {
    const { rig, built } = flown(wide, [...dock, banner]);
    const spot = room();

    rig.flyTo(() => spot, { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);

    const look = built.camera.position.clone().sub(built.controls.target);

    expect(built.controls.target.distanceTo(spot.centre)).toBeLessThan(1e-6);
    expect(degrees(Math.asin(look.y / look.length()))).toBeCloseTo(
      SPOT_PITCH_DEG,
      6,
    );
  });

  it('still flies when the scene fits itself between the alert and the first frame', () => {
    const spot = room();
    const { rig, built } = flown(wide, [...dock, banner], (early) =>
      early.flyTo(() => spot, { orbit: 0, x: 0, y: 0 }, 1200),
    );

    rig.refit();
    run(rig, 0, 3000);

    expect(built.controls.target.distanceTo(spot.centre)).toBeLessThan(1e-6);
  });

  it('stays on the room when the scene refits after the flight landed', () => {
    const spot = room();
    const { rig, built } = flown(wide, [...dock, banner]);

    rig.flyTo(() => spot, { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);
    rig.refit();
    run(rig, 3016, 6000);

    expect(built.controls.target.distanceTo(spot.centre)).toBeLessThan(1e-6);
  });

  it('lets the reader take the camera away from the room for good', () => {
    const spot = room();
    const { rig, built } = flown(wide, [...dock, banner]);

    rig.flyTo(() => spot, { orbit: 0, x: 0, y: 0 }, 1200);
    run(rig, 0, 3000);
    rig.cancel();
    built.controls.target.set(-2, 0, 1);
    rig.refit();
    run(rig, 3016, 6000);

    expect(built.controls.target.distanceTo(spot.centre)).toBeGreaterThan(1);
  });
});

describe('the frame the home is fitted in', () => {
  const camera = new PerspectiveCamera(50, 1280 / 800, 0.1, 200);

  it('centres on the rooms it is given and nothing else', () => {
    const frame = houseFrame(corners(storey), camera);

    expect(frame?.center.toArray()).toEqual([0, 1.4, 0]);
  });

  it('stands further back for a bigger house', () => {
    const near = houseFrame(corners(storey), camera)?.distance ?? 0;
    const far = houseFrame(corners(stack), camera)?.distance ?? 0;

    expect(far).toBeGreaterThan(near);
  });

  it('has no frame without rooms, so the renderer frames what it drew', () => {
    expect(houseFrame([], camera)).toBeNull();
  });
});

describe('the reach of wheel and pinch zoom', () => {
  it('zooms in as close as the editor, whatever the size of the house', () => {
    for (const distance of [1, 5, 20, 60]) {
      expect(zoomReach({ center: centre, distance }).min).toBe(
        ORBIT_MIN_DISTANCE,
      );
    }
  });

  it('zooms out as far as the editor, and further for a house the editor would pull back from', () => {
    expect(zoomReach({ center: centre, distance: 5 }).max).toBe(
      ORBIT_MAX_DISTANCE,
    );
    expect(zoomReach({ center: centre, distance: 20 }).max).toBe(
      orbitCeiling(20),
    );
    expect(orbitCeiling(20)).toBeGreaterThan(ORBIT_MAX_DISTANCE);
  });
});
