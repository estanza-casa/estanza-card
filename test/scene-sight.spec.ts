import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import {
  type Faded,
  FADED_OPACITY,
  fadePieces,
  inSight,
  markSeen,
  roomSamples,
  screening,
} from '../src/scene-sight.js';

function block(x: number, y: number, z: number, size: number[]): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(size[0], size[1], size[2]),
    new MeshStandardMaterial(),
  );

  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);

  return mesh;
}

describe('what the camera can see', () => {
  const eye = new Vector3(0, 1, 10);
  const wall = block(0, 1.25, 5, [4, 2.5, 0.2]);

  it('sees a spot with nothing between it and the eye', () => {
    expect(inSight(eye, new Vector3(6, 1, 0), [wall], 0.05)).toBe(true);
  });

  it('does not see a spot behind a wall', () => {
    expect(inSight(eye, new Vector3(0, 0.3, 0), [wall], 0.05)).toBe(false);
  });

  it('sees over a wall once the eye is high enough', () => {
    const above = new Vector3(0, 12, 10);

    expect(inSight(above, new Vector3(0, 0.3, 0), [wall], 0.05)).toBe(true);
  });

  it('still sees a spot that sits inside the wall that holds it', () => {
    expect(inSight(eye, new Vector3(0, 1, 5), [wall], 0.35)).toBe(true);
  });

  it('keeps a mark it saw while the eye grazes the wall that holds it, and does not show one it had hidden', () => {
    const grazing = new Vector3(8, 1, 7);
    const window = [new Vector3(0, 1, 5)];

    expect(markSeen(grazing, window, [wall], false)).toBe(false);
    expect(markSeen(grazing, window, [wall], true)).toBe(true);
  });

  it('shows a mark with nothing to look at', () => {
    expect(markSeen(eye, [], [wall], false)).toBe(true);
  });

  it('samples a room at its middle and inside each corner', () => {
    const samples = roomSamples(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [5, 5],
      0.3,
    );

    expect(samples.map(({ x, y, z }) => [x, y, z])).toEqual([
      [5, 0.3, 5],
      [1.5, 0.3, 1.5],
      [8.5, 0.3, 1.5],
      [8.5, 0.3, 8.5],
      [1.5, 0.3, 8.5],
    ]);
  });
});

describe('trees between the camera and the house', () => {
  const eye = new Vector3(0, 1.5, 20);
  const house = [new Vector3(0, 1, 0), new Vector3(3, 1, 0)];

  function tree(x: number, z: number): Group {
    const group = new Group();

    group.add(block(0, 3, 0, [2, 6, 2]));
    group.position.set(x, 0, z);
    group.updateMatrixWorld(true);

    return group;
  }

  it('picks out the tree that stands in the line of sight', () => {
    const front = tree(0, 10);
    const beside = tree(15, 10);
    const behind = tree(0, -10);

    expect(screening(eye, house, [front, beside, behind])).toEqual(
      new Set([front]),
    );
  });

  it('fades a screening tree and gives its own look back once it stops screening', () => {
    const scene = new Scene();
    const front = tree(0, 10);
    const faded: Faded = new WeakMap();
    const mesh = front.children[0] as Mesh;
    const shared = mesh.material;

    scene.add(front);

    expect(fadePieces([front], new Set([front]), faded)).toBe(true);
    expect(mesh.material).not.toBe(shared);
    expect(mesh.material).toMatchObject({
      transparent: true,
      opacity: FADED_OPACITY,
      depthWrite: false,
    });
    expect(shared).toMatchObject({ transparent: false, opacity: 1 });
    expect(fadePieces([front], new Set([front]), faded)).toBe(false);

    expect(fadePieces([front], new Set(), faded)).toBe(true);
    expect(mesh.material).toBe(shared);
    expect(fadePieces([front], new Set(), faded)).toBe(false);
  });
});
