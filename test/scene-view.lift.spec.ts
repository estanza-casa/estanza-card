import HomeScene from '@estanza/scene/components/HomeScene.js';
import { Children, isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameraRig } from '../src/camera-rig.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { threeStoreyHome } from './storeys.js';

type Drawn = {
  sceneTree: (
    source: ReturnType<typeof threeStoreyHome>,
    frameloop: 'demand',
  ) => ReactElement;
};

const home = threeStoreyHome();

function everything(tree: ReactElement): ReactElement[] {
  const children = (tree.props as { children?: unknown }).children;

  return Children.toArray(children as ReactElement[])
    .filter((child): child is ReactElement => isValidElement(child))
    .flatMap((child) => [child, ...everything(child)]);
}

function liftOf(view: EstanzaSceneView): number {
  const tree = (view as unknown as Drawn).sceneTree(home, 'demand');
  const scene = everything(tree).find((child) => child.type === HomeScene);

  return (scene?.props as { explode: number }).explode;
}

function standingOn(floor: string | null): EstanzaSceneView {
  const view = new EstanzaSceneView();

  view.homeDocument = home;
  view.floor = floor;
  document.body.append(view);

  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the storeys lifting apart on the way to All floors', () => {
  it('wait on the ground while the camera is still flying out', () => {
    const view = standingOn('ufloor');

    liftOf(view);
    vi.spyOn(CameraRig.prototype, 'flying', 'get').mockReturnValue(true);
    view.floor = null;

    expect(liftOf(view)).toBe(0);
  });

  it('lift once the camera has landed', () => {
    const view = standingOn('ufloor');
    const flying = vi
      .spyOn(CameraRig.prototype, 'flying', 'get')
      .mockReturnValue(true);

    liftOf(view);
    view.floor = null;
    liftOf(view);
    flying.mockReturnValue(false);

    expect(liftOf(view)).toBeGreaterThan(0);
  });

  it('settle at once when a storey is chosen, without waiting on the camera', () => {
    const view = standingOn(null);

    liftOf(view);
    vi.spyOn(CameraRig.prototype, 'flying', 'get').mockReturnValue(true);
    view.floor = 'ufloor';

    expect(liftOf(view)).toBe(0);
  });
});
