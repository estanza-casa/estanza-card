import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CameraRig,
  homePose,
  houseFrame,
  overheadPose,
  type Pose,
  type RigControls,
  type RigStage,
  zoomReach,
} from '../src/camera-rig.js';

const wide = { width: 1280, height: 800 };
const storey = new Box3(new Vector3(-6, 0, -4), new Vector3(6, 2.8, 4));
const place = { orbit: 0, x: 0, y: 0 };
const SWITCH_MS = 500;
const FRAME_MS = 16;

type Gesture = 'drag' | 'wheel' | 'pinch';

type Scene = {
  rig: CameraRig;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  element: HTMLElement;
  now: number;
};

const gestures: Gesture[] = ['drag', 'wheel', 'pinch'];
const mounted: Scene[] = [];

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

function mount(): Scene {
  const camera = new PerspectiveCamera(50, wide.width / wide.height, 0.1, 200);
  const element = document.createElement('div');

  Object.defineProperty(element, 'clientWidth', { value: wide.width });
  Object.defineProperty(element, 'clientHeight', { value: wide.height });
  element.getBoundingClientRect = () =>
    new DOMRect(0, 0, wide.width, wide.height);
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  document.body.append(element);

  const controls = new OrbitControls(camera, element);

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  const rig = new CameraRig(
    () => undefined,
    () => corners(storey),
  );
  const stage: RigStage = {
    camera,
    controls: controls as unknown as RigControls,
    frame: () => {
      const frame = houseFrame(corners(storey), camera) ?? {
        center: new Vector3(),
        distance: 20,
      };
      const reach = zoomReach(frame);

      controls.minDistance = reach.min;
      controls.maxDistance = reach.max;

      return frame;
    },
    size: wide,
    invalidate: () => undefined,
  };

  camera.position.set(9, 11, 9);
  rig.setFraming({ raise: 0, zoom: 1, house: true });
  rig.setClear([
    { left: 12, top: 12, right: 110, bottom: 64 },
    { left: 12, top: 72, right: 64, bottom: 262 },
  ]);
  rig.attach(stage);

  const scene = { rig, camera, controls, element, now: 10 * 60 * 1000 };

  mounted.push(scene);
  rig.goHome(place, 0);
  frames(scene, 200);

  return scene;
}

function frames(scene: Scene, ms: number): void {
  const end = scene.now + ms;

  while (scene.now < end) {
    scene.now += FRAME_MS;
    scene.controls.update();
    scene.rig.step(scene.now);
  }
}

function restartClock(scene: Scene): void {
  scene.now = 0;
}

function pointer(
  scene: Scene,
  type: string,
  id: number,
  touch: boolean,
  at: { x: number; y: number },
): void {
  const target = type === 'pointerdown' ? scene.element : document;

  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: touch ? 'touch' : 'mouse',
      isPrimary: id === 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
      bubbles: true,
    }),
  );
}

function abuse(scene: Scene, gesture: Gesture): void {
  const { rig } = scene;
  const cx = wide.width / 2;
  const cy = wide.height / 2;

  if (gesture === 'wheel') {
    for (let tick = 0; tick < 6; tick += 1) {
      rig.cancel();
      scene.element.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: tick % 2 ? 240 : -480,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }),
      );
      frames(scene, FRAME_MS);
    }

    return;
  }

  if (gesture === 'drag') {
    rig.cancel();
    pointer(scene, 'pointerdown', 1, false, { x: cx, y: cy });

    for (let step = 1; step <= 10; step += 1) {
      pointer(scene, 'pointermove', 1, false, {
        x: cx + step * 12,
        y: cy + step * 4,
      });
      frames(scene, FRAME_MS);
    }

    pointer(scene, 'pointerup', 1, false, { x: cx + 120, y: cy + 40 });

    return;
  }

  rig.cancel();
  pointer(scene, 'pointerdown', 1, true, { x: cx - 40, y: cy });
  rig.cancel();
  pointer(scene, 'pointerdown', 2, true, { x: cx + 40, y: cy });

  for (let step = 1; step <= 10; step += 1) {
    pointer(scene, 'pointermove', 1, true, { x: cx - 40 - step * 8, y: cy });
    pointer(scene, 'pointermove', 2, true, { x: cx + 40 + step * 8, y: cy });
    frames(scene, FRAME_MS);
  }

  pointer(scene, 'pointerup', 2, true, { x: cx + 120, y: cy });
  pointer(scene, 'pointerup', 1, true, { x: cx - 120, y: cy });
}

function toPlan(scene: Scene, gesture: Gesture | null, at: number): void {
  const start = scene.now;

  scene.rig.tiltDown(place, SWITCH_MS);
  frames(scene, at);

  if (gesture) abuse(scene, gesture);

  frames(scene, start + 2 * SWITCH_MS - scene.now);
  restartClock(scene);
}

function toScene(scene: Scene, gesture: Gesture | null, at: number): void {
  const early = gesture !== null && at < SWITCH_MS;

  if (early) {
    frames(scene, at);
    abuse(scene, gesture);
    frames(scene, SWITCH_MS - at);
  } else {
    frames(scene, SWITCH_MS);
  }

  scene.rig.tiltUp(place, SWITCH_MS);

  if (gesture && !early) {
    frames(scene, at - SWITCH_MS);
    abuse(scene, gesture);
  }

  frames(scene, 3 * SWITCH_MS);
}

function home(scene: Scene): Pose {
  const frame = houseFrame(corners(storey), scene.camera);

  if (!frame) throw new Error('no house');

  return homePose(frame.center, frame.distance, place.orbit);
}

function screenBox(scene: Scene): {
  left: number;
  right: number;
  high: number;
  low: number;
} {
  scene.camera.updateMatrixWorld();

  const points = corners(storey).map((point) => {
    const ndc = point.project(scene.camera);

    return {
      x: ((ndc.x + 1) / 2) * wide.width,
      y: ((1 - ndc.y) / 2) * wide.height,
    };
  });

  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    high: Math.min(...points.map((point) => point.y)),
    low: Math.max(...points.map((point) => point.y)),
  };
}

function expectHouseFramed(scene: Scene, label: string): void {
  const box = screenBox(scene);

  expect(Number.isFinite(scene.camera.zoom), label).toBe(true);
  expect(scene.camera.position.toArray().every(Number.isFinite), label).toBe(
    true,
  );
  expect(box.left, label).toBeGreaterThanOrEqual(0);
  expect(box.right, label).toBeLessThanOrEqual(wide.width);
  expect(box.high, label).toBeGreaterThanOrEqual(0);
  expect(box.low, label).toBeLessThanOrEqual(wide.height);
  expect((box.right - box.left) / wide.width, label).toBeGreaterThan(0.3);
}

function expectHouseInView(scene: Scene, label: string): void {
  const box = screenBox(scene);
  const middle = storey.getCenter(new Vector3()).project(scene.camera);

  expect(Number.isFinite(scene.camera.zoom), label).toBe(true);
  expect(scene.camera.position.toArray().every(Number.isFinite), label).toBe(
    true,
  );
  expect(Math.abs(middle.x), label).toBeLessThan(1);
  expect(Math.abs(middle.y), label).toBeLessThan(1);
  expect((box.right - box.left) / wide.width, label).toBeGreaterThan(0.3);
}

afterEach(() => {
  for (const scene of mounted.splice(0)) {
    scene.controls.dispose();
    scene.element.remove();
  }
});

describe('input while the view switches between 3D and the plan', () => {
  it('frames the house on the way back to 3D after any gesture during the tilt down', () => {
    for (const gesture of gestures) {
      for (const at of [50, 200, 400]) {
        const scene = mount();

        const label = `${gesture} at ${at}ms`;

        toPlan(scene, gesture, at);
        toScene(scene, null, 0);

        expect(
          scene.camera.position.distanceTo(home(scene).position),
          label,
        ).toBeLessThan(1e-3);
        expectHouseFramed(scene, label);
      }
    }
  });

  it('frames the house on 3D after any gesture while the plan leaves', () => {
    for (const gesture of gestures) {
      for (const at of [100, 400]) {
        const scene = mount();
        const label = `${gesture} at ${at}ms`;

        toPlan(scene, null, 0);
        toScene(scene, gesture, at);

        expect(
          scene.camera.position.distanceTo(home(scene).position),
          label,
        ).toBeLessThan(1e-3);
        expectHouseFramed(scene, label);
      }
    }
  });

  it('hands the reader the house in view after any gesture while the camera rises', () => {
    for (const gesture of gestures) {
      for (const at of [600, 850]) {
        const scene = mount();
        const label = `${gesture} at ${at}ms`;

        toPlan(scene, null, 0);
        toScene(scene, gesture, at);

        expectHouseInView(scene, label);
      }
    }
  });

  it('lands on 3D at once when the reader takes over the rise from the plan', () => {
    const scene = mount();

    toPlan(scene, null, 0);
    frames(scene, SWITCH_MS);
    scene.rig.tiltUp(place, SWITCH_MS);
    frames(scene, 100);
    scene.rig.cancel();

    expect(scene.camera.position.distanceTo(home(scene).position)).toBeLessThan(
      1e-6,
    );
    expect(scene.rig.moving).toBe(false);
  });

  it('lands on the plan view at once when the reader takes over the tilt down', () => {
    const scene = mount();
    const frame = houseFrame(corners(storey), scene.camera);

    if (!frame) throw new Error('no house');

    scene.rig.tiltDown(place, SWITCH_MS);
    frames(scene, 100);
    scene.rig.cancel();

    expect(
      scene.camera.position.distanceTo(overheadPose(frame).position),
    ).toBeLessThan(1e-6);
    expect(scene.rig.moving).toBe(false);
  });

  it('lands on the plan view when a drag started before the switch goes on through it', () => {
    for (const touch of [false, true]) {
      const scene = mount();
      const frame = houseFrame(corners(storey), scene.camera);
      const cx = wide.width / 2;
      const cy = wide.height / 2;

      if (!frame) throw new Error('no house');

      scene.rig.cancel();
      pointer(scene, 'pointerdown', 1, touch, { x: cx, y: cy });

      for (let step = 1; step <= 40; step += 1) {
        if (step === 5) scene.rig.tiltDown(place, SWITCH_MS);

        pointer(scene, 'pointermove', 1, touch, {
          x: cx + step * 12,
          y: cy + step * 4,
        });
        frames(scene, FRAME_MS);
      }

      pointer(scene, 'pointerup', 1, touch, { x: cx + 480, y: cy + 160 });
      frames(scene, 2 * SWITCH_MS);

      expect(
        scene.camera.position.distanceTo(overheadPose(frame).position),
        touch ? 'touch' : 'mouse',
      ).toBeLessThan(1e-3);
    }
  });

  it('gives the camera back to a drag once the house has risen from the plan', () => {
    const scene = mount();
    const cx = wide.width / 2;
    const cy = wide.height / 2;

    toPlan(scene, null, 0);
    toScene(scene, null, 0);

    const before = scene.camera.position.clone();

    scene.rig.cancel();
    pointer(scene, 'pointerdown', 1, false, { x: cx, y: cy });

    for (let step = 1; step <= 10; step += 1) {
      pointer(scene, 'pointermove', 1, false, { x: cx + step * 12, y: cy });
      frames(scene, FRAME_MS);
    }

    pointer(scene, 'pointerup', 1, false, { x: cx + 120, y: cy });

    expect(scene.camera.position.distanceTo(before)).toBeGreaterThan(0.5);
  });

  it('lands an alert flight raised mid-drag and ignores the rest of that drag', () => {
    const scene = mount();
    const cx = wide.width / 2;
    const cy = wide.height / 2;
    const spot = { centre: new Vector3(4, 0, 2), axis: null };
    let x = cx;

    const drag = (steps: number): void => {
      for (let step = 0; step < steps; step += 1) {
        x += 14;
        pointer(scene, 'pointermove', 1, false, { x, y: cy + 3 });
        frames(scene, FRAME_MS);
      }
    };

    scene.rig.cancel();
    pointer(scene, 'pointerdown', 1, false, { x: cx, y: cy });
    drag(6);
    scene.rig.holdInput();
    scene.rig.flyTo(() => spot, place, SWITCH_MS);
    drag(Math.ceil((SWITCH_MS + 200) / FRAME_MS));

    const landed = scene.camera.position.clone();

    drag(20);
    pointer(scene, 'pointerup', 1, false, { x, y: cy });
    scene.rig.releaseInput();
    frames(scene, 1000);

    expect(scene.camera.position.distanceTo(landed)).toBeLessThan(1e-3);
    expect(scene.controls.enabled).toBe(true);
  });

  it('keeps the plan still after an alert ends a drag on it', () => {
    const scene = mount();

    toPlan(scene, null, 0);
    scene.rig.holdInput();
    scene.rig.releaseInput();

    expect(scene.controls.enabled).toBe(false);
  });

  it('frames the house again when the camera was left somewhere impossible', () => {
    const scene = mount();

    scene.camera.position.set(Number.NaN, 4, 2);
    frames(scene, 100);

    expect(scene.camera.position.distanceTo(home(scene).position)).toBeLessThan(
      1e-3,
    );
    expectHouseFramed(scene, 'after a lost camera');
  });
});
