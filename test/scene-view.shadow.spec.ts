import { BoxGeometry, Mesh, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';

import { covered } from '../src/living.js';
import { shadowBoxes } from '../src/scene-view.js';

const size = { width: 400, height: 400 };

function lookingDown(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);

  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return camera;
}

function block(width: number, depth: number, x = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, 0.1, depth));

  mesh.position.set(x, 0, 0);
  mesh.updateMatrixWorld();

  return mesh;
}

describe('the screen shadow of a balcony', () => {
  it('covers the middle of a deck and leaves the rest of the card free', () => {
    const boxes = shadowBoxes([block(2, 2)], lookingDown(), size);
    const spot = (x: number, y: number) => ({ x, y, width: 2, height: 2 });

    expect(covered(spot(200, 200), boxes)).toBe(true);
    expect(covered(spot(40, 40), boxes)).toBe(false);
    expect(covered(spot(360, 200), boxes)).toBe(false);
  });

  it('keeps a post thinner than a cell', () => {
    const boxes = shadowBoxes([block(0.02, 3, 1)], lookingDown(), size);

    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.x > 200)).toBe(true);
  });

  it('draws nothing for a piece behind the camera', () => {
    const camera = lookingDown();
    const above = block(2, 2);

    above.position.set(0, 20, 0);
    above.updateMatrixWorld();

    expect(shadowBoxes([above], camera, size)).toEqual([]);
  });
});
