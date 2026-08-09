import {
  ORBIT_DAMPING,
  ORBIT_MAX_POLAR,
  ORBIT_MIN_DISTANCE,
  ORBIT_MOUSE,
  orbitCeiling,
} from '@estanza/scene/orbit.js';
import { Box3, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CameraRig,
  houseFrame,
  ORBIT_SETUP,
  type RigControls,
  type RigStage,
} from '../src/camera-rig.js';

type Size = { width: number; height: number };

type Gesture =
  | 'drag'
  | 'drag down'
  | 'right drag'
  | 'middle drag'
  | 'wheel in'
  | 'wheel out'
  | 'pinch in'
  | 'pinch out';

type Twin = {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  element: HTMLElement;
};

type Pair = { card: Twin; editor: Twin; rig: CameraRig; now: number };

type Lens = { zoom: number; x: number; y: number };

const FRAME_MS = 16;
const storey = new Box3(new Vector3(-6, 0, -4), new Vector3(6, 2.8, 4));
const place = { orbit: 0, x: 0, y: 0 };
const cards: {
  size: Size;
  clear: { left: number; top: number; right: number; bottom: number }[];
}[] = [
  {
    size: { width: 1280, height: 800 },
    clear: [
      { left: 12, top: 12, right: 110, bottom: 64 },
      { left: 12, top: 72, right: 64, bottom: 262 },
    ],
  },
  {
    size: { width: 390, height: 750 },
    clear: [
      { left: 12, top: 12, right: 110, bottom: 64 },
      { left: 12, top: 72, right: 64, bottom: 124 },
    ],
  },
];
const gestures: Gesture[] = [
  'drag',
  'drag down',
  'right drag',
  'middle drag',
  'wheel in',
  'wheel out',
  'pinch in',
  'pinch out',
];
const mounted: Twin[] = [];

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

function twin(size: Size): Twin {
  const camera = new PerspectiveCamera(50, size.width / size.height, 0.1, 400);
  const element = document.createElement('div');

  Object.defineProperty(element, 'clientWidth', { value: size.width });
  Object.defineProperty(element, 'clientHeight', { value: size.height });
  element.getBoundingClientRect = () =>
    new DOMRect(0, 0, size.width, size.height);
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  document.body.append(element);

  const controls = new OrbitControls(camera, element);
  const made = { camera, controls, element };

  mounted.push(made);

  return made;
}

function mount({ size, clear }: (typeof cards)[number]): Pair {
  const card = twin(size);
  const points = corners(storey);

  Object.assign(card.controls, ORBIT_SETUP);

  const rig = new CameraRig(
    () => undefined,
    () => points,
  );
  const stage: RigStage = {
    camera: card.camera,
    controls: card.controls as unknown as RigControls,
    frame: () => {
      const frame = houseFrame(points, card.camera) ?? {
        center: new Vector3(),
        distance: 20,
      };

      Object.assign(card.controls, rig.limits(frame));

      return frame;
    },
    size,
    invalidate: () => undefined,
  };

  card.camera.position.set(9, 11, 9);
  rig.setFraming({ raise: 0, zoom: 1, house: true });
  rig.setClear(clear);
  rig.attach(stage);
  rig.goHome(place, 0);

  const pair = { card, editor: twin(size), rig, now: 1000 };

  frames(pair, 400);

  const frame = houseFrame(points, card.camera);
  const editor = pair.editor;

  editor.controls.enableDamping = true;
  editor.controls.dampingFactor = ORBIT_DAMPING;
  editor.controls.minDistance = ORBIT_MIN_DISTANCE;
  editor.controls.maxDistance = orbitCeiling(frame?.distance ?? 20);
  editor.controls.maxPolarAngle = ORBIT_MAX_POLAR;
  editor.controls.mouseButtons = {
    ...ORBIT_MOUSE,
  } as OrbitControls['mouseButtons'];
  editor.camera.position.copy(card.camera.position);
  editor.controls.target.copy(card.controls.target);
  editor.controls.update();
  editor.camera.updateMatrixWorld();

  return pair;
}

function frames(pair: Pair, ms: number, log?: () => void): void {
  const end = pair.now + ms;

  while (pair.now < end) {
    pair.now += FRAME_MS;
    pair.card.controls.update();
    pair.rig.step(pair.now);
    pair.editor.controls.update();
    pair.card.camera.updateMatrixWorld();
    pair.editor.camera.updateMatrixWorld();
    log?.();
  }
}

function lensOf(camera: PerspectiveCamera): Lens {
  const view = camera.view?.enabled ? camera.view : null;

  return { zoom: camera.zoom, x: view?.offsetX ?? 0, y: view?.offsetY ?? 0 };
}

function orbitOf({ camera, controls }: Twin): Spherical {
  return new Spherical().setFromVector3(
    camera.position.clone().sub(controls.target),
  );
}

function pointer(
  pair: Pair,
  type: string,
  id: number,
  at: { x: number; y: number },
  { touch = false, button = 0 }: { touch?: boolean; button?: number } = {},
): void {
  if (type === 'pointerdown') pair.rig.cancel();

  const targets =
    type === 'pointerdown'
      ? [pair.card.element, pair.editor.element]
      : [document];

  for (const target of targets) {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: touch ? 'touch' : 'mouse',
        isPrimary: id === 1,
        button,
        buttons: type === 'pointerup' ? 0 : 1 << [0, 2, 1][button],
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
      }),
    );
  }
}

function wheel(pair: Pair, deltaY: number, at: { x: number; y: number }): void {
  pair.rig.cancel();

  for (const side of [pair.card, pair.editor]) {
    side.element.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

function perform(
  pair: Pair,
  gesture: Gesture,
  size: Size,
  log: () => void,
): void {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const step = (): void => frames(pair, FRAME_MS, log);

  if (gesture.startsWith('wheel')) {
    for (let tick = 0; tick < 24; tick += 1) {
      wheel(pair, gesture === 'wheel in' ? -120 : 120, { x: cx, y: cy });
      step();
    }

    return;
  }

  if (gesture.includes('drag')) {
    const button =
      gesture === 'right drag' ? 2 : gesture === 'middle drag' ? 1 : 0;
    const down = gesture === 'drag down';

    pointer(pair, 'pointerdown', 1, { x: cx, y: cy }, { button });

    for (let move = 1; move <= 20; move += 1) {
      pointer(
        pair,
        'pointermove',
        1,
        { x: cx + (down ? 0 : move * 14), y: cy + move * (down ? 18 : 3) },
        { button },
      );
      step();
    }

    pointer(pair, 'pointerup', 1, { x: cx, y: cy }, { button });

    return;
  }

  const spread = gesture === 'pinch out' ? 6 : -4;

  pointer(pair, 'pointerdown', 1, { x: cx - 90, y: cy }, { touch: true });
  pointer(pair, 'pointerdown', 2, { x: cx + 90, y: cy }, { touch: true });

  for (let move = 1; move <= 20; move += 1) {
    pointer(
      pair,
      'pointermove',
      1,
      { x: cx - 90 - move * spread, y: cy },
      { touch: true },
    );
    pointer(
      pair,
      'pointermove',
      2,
      { x: cx + 90 + move * spread, y: cy },
      { touch: true },
    );
    step();
  }

  pointer(pair, 'pointerup', 2, { x: cx, y: cy }, { touch: true });
  pointer(pair, 'pointerup', 1, { x: cx, y: cy }, { touch: true });
}

afterEach(() => {
  for (const side of mounted.splice(0)) {
    side.controls.dispose();
    side.element.remove();
  }
});

describe('the card camera under the reader, the same as the editor', () => {
  it('sets up its orbit controls the way the editor does', () => {
    expect(ORBIT_SETUP).toEqual({
      enableDamping: true,
      dampingFactor: ORBIT_DAMPING,
      maxPolarAngle: ORBIT_MAX_POLAR,
      mouseButtons: ORBIT_MOUSE,
    });
  });

  it('reaches as near, as far and as low as the editor once the house is framed', () => {
    for (const card of cards) {
      const pair = mount(card);
      const frame = houseFrame(corners(storey), pair.card.camera);

      expect(pair.card.controls.minDistance).toBe(ORBIT_MIN_DISTANCE);
      expect(pair.card.controls.maxDistance).toBe(
        orbitCeiling(frame?.distance ?? 0),
      );
      expect(pair.card.controls.maxPolarAngle).toBe(ORBIT_MAX_POLAR);
      expect(pair.card.controls.minPolarAngle).toBe(0);
    }
  });

  it.each(gestures)(
    'moves the camera exactly as the editor does, frame by frame, for a %s',
    (gesture) => {
      for (const card of cards) {
        const pair = mount(card);
        const drawn: string[] = [];
        const log = (): void => {
          const a = orbitOf(pair.card);
          const b = orbitOf(pair.editor);
          const moved = pair.card.controls.target.distanceTo(
            pair.editor.controls.target,
          );

          drawn.push(
            [a.radius - b.radius, a.phi - b.phi, a.theta - b.theta, moved]
              .map((gap) => (Math.abs(gap) < 1e-9 ? 0 : gap))
              .join(' '),
          );
        };

        perform(pair, gesture, card.size, log);
        frames(pair, 1500, log);

        expect(drawn.filter((gap) => gap !== '0 0 0 0')).toEqual([]);
      }
    },
  );

  it.each(gestures)(
    'leaves the framing of the picture alone for a %s, with no reframe during or after it',
    (gesture) => {
      for (const card of cards) {
        const pair = mount(card);
        const lens = lensOf(pair.card.camera);
        const drifts: Lens[] = [];
        const log = (): void => {
          const now = lensOf(pair.card.camera);

          if (
            Math.abs(now.zoom - lens.zoom) > 1e-9 ||
            Math.abs(now.x - lens.x) > 1e-6 ||
            Math.abs(now.y - lens.y) > 1e-6
          ) {
            drifts.push(now);
          }
        };

        perform(pair, gesture, card.size, log);
        frames(pair, 1500, log);

        expect(drifts).toEqual([]);
      }
    },
  );
});
