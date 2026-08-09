import {
  Box3,
  type Material,
  type Mesh,
  type Object3D,
  Ray,
  Raycaster,
  Vector3,
} from 'three';

import type { Vec2 } from './living.js';

export const FADED_OPACITY = 0.25;

const SAMPLE_INSET = 0.3;
const MARK_SLACK = 0.35;
const KEPT_MARK_SLACK = 0.6;

export type Faded = WeakMap<Mesh, Material | Material[]>;

export function inSight(
  eye: Vector3,
  spot: Vector3,
  blockers: readonly Object3D[],
  slack: number,
): boolean {
  const reach = eye.distanceTo(spot);

  if (reach <= slack) return true;

  const ray = new Raycaster(
    eye,
    spot.clone().sub(eye).normalize(),
    0,
    reach - slack,
  );

  return ray.intersectObjects([...blockers], false).length === 0;
}

export function markSeen(
  eye: Vector3,
  spots: readonly Vector3[],
  blockers: readonly Object3D[],
  wasSeen: boolean,
): boolean {
  const slack = wasSeen ? KEPT_MARK_SLACK : MARK_SLACK;

  return (
    spots.length === 0 ||
    spots.some((spot) => inSight(eye, spot, blockers, slack))
  );
}

export function roomSamples(
  poly: readonly Vec2[],
  centre: Vec2,
  height: number,
): Vector3[] {
  const [cx, cz] = centre;
  const inset = poly.map(
    ([x, z]) =>
      new Vector3(
        x + (cx - x) * SAMPLE_INSET,
        height,
        z + (cz - z) * SAMPLE_INSET,
      ),
  );

  return [new Vector3(cx, height, cz), ...inset];
}

export function screening(
  eye: Vector3,
  targets: readonly Vector3[],
  pieces: readonly Object3D[],
): Set<Object3D> {
  const screens = new Set<Object3D>();
  const box = new Box3();
  const hit = new Vector3();

  for (const piece of pieces) {
    box.setFromObject(piece);

    if (box.isEmpty() || box.containsPoint(eye)) continue;

    const blocks = targets.some((target) => {
      const ray = new Ray(eye, target.clone().sub(eye).normalize());

      return (
        ray.intersectBox(box, hit) !== null &&
        eye.distanceTo(hit) < eye.distanceTo(target)
      );
    });

    if (blocks) screens.add(piece);
  }

  return screens;
}

export function fadePieces(
  pieces: readonly Object3D[],
  screens: ReadonlySet<Object3D>,
  faded: Faded,
): boolean {
  let changed = false;

  for (const piece of pieces) {
    const fade = screens.has(piece);

    piece.traverse((object) => {
      const mesh = object as Mesh;

      if (!mesh.isMesh) return;

      const original = faded.get(mesh);

      if (fade && !original) {
        faded.set(mesh, mesh.material);
        mesh.material = see(mesh.material);
        changed = true;
      }

      if (!fade && original) {
        dispose(mesh.material);
        mesh.material = original;
        faded.delete(mesh);
        changed = true;
      }
    });
  }

  return changed;
}

function see(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map(seeOne);

  return seeOne(material);
}

function seeOne(material: Material): Material {
  const clone = material.clone();

  clone.transparent = true;
  clone.opacity = FADED_OPACITY;
  clone.depthWrite = false;

  return clone;
}

function dispose(material: Material | Material[]): void {
  for (const one of Array.isArray(material) ? material : [material]) {
    one.dispose();
  }
}
