import '../src/scene-view.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CameraRig } from '../src/camera-rig.js';
import type { EstanzaSceneView } from '../src/scene-view.js';

type Rigged = { rig: CameraRig };

afterEach(() => {
  document.body.replaceChildren();
});

async function mounted(): Promise<{
  view: EstanzaSceneView;
  stage: HTMLElement;
  hold: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}> {
  const view = document.createElement('estanza-scene-view');

  document.body.append(view);
  await view.updateComplete;

  const rig = (view as unknown as Rigged).rig;
  const hold = vi.fn();
  const release = vi.fn();

  rig.holdInput = hold;
  rig.releaseInput = release;

  const stage = view.shadowRoot?.querySelector<HTMLElement>('#stage');

  if (!stage) throw new Error('no stage');

  return { view, stage, hold, release };
}

function press(stage: HTMLElement, type: string, id: number): void {
  stage.dispatchEvent(
    new PointerEvent(type, { pointerId: id, isPrimary: id === 1 }),
  );
}

describe('an alert that takes the camera during a drag', () => {
  it('leaves the controls alone when nothing is being dragged', async () => {
    const { view, hold } = await mounted();

    view.endDrag();

    expect(hold).not.toHaveBeenCalled();
  });

  it('ends the drag and gives the controls back when the last finger lifts', async () => {
    const { view, stage, hold, release } = await mounted();

    press(stage, 'pointerdown', 1);
    press(stage, 'pointerdown', 2);
    view.endDrag();

    expect(hold).toHaveBeenCalledOnce();

    press(stage, 'pointerup', 2);

    expect(release).not.toHaveBeenCalled();

    press(stage, 'pointercancel', 1);

    expect(release).toHaveBeenCalledOnce();
  });

  it('gives nothing back when no drag was ended', async () => {
    const { stage, release } = await mounted();

    press(stage, 'pointerdown', 1);
    press(stage, 'pointerup', 1);

    expect(release).not.toHaveBeenCalled();
  });

  it('gives the controls back on the next touch when a lift never arrived', async () => {
    const { view, stage, release } = await mounted();

    press(stage, 'pointerdown', 1);
    view.endDrag();
    press(stage, 'pointerdown', 1);

    expect(release).toHaveBeenCalledOnce();
  });
});
