import '../src/scene-view.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EstanzaSceneView } from '../src/scene-view.js';

type Seen = { type: string; id: number };

type Staged = { sceneState: { get: () => unknown } | null };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mounted(): Promise<{
  view: EstanzaSceneView;
  mark: HTMLElement;
  seen: Seen[];
}> {
  const view = document.createElement('estanza-scene-view');
  const mark = document.createElement('span');

  document.body.append(view, mark);
  await view.updateComplete;

  const stage = view.shadowRoot?.querySelector<HTMLElement>('#stage');

  if (!stage) throw new Error('no stage');

  const surface = document.createElement('div');
  const seen: Seen[] = [];
  const record = (event: Event): void => {
    seen.push({ type: event.type, id: (event as PointerEvent).pointerId });
  };

  stage.append(surface);
  surface.addEventListener('pointerdown', record);
  surface.addEventListener('pointercancel', record);
  document.addEventListener('pointerup', record);
  (view as unknown as Staged).sceneState = {
    get: () => ({
      controls: { domElement: surface },
      gl: { domElement: document.createElement('canvas') },
    }),
  };

  return { view, mark, seen };
}

function finger(target: EventTarget, type: string, id: number): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: id,
    pointerType: 'touch',
  });

  target.dispatchEvent(event);

  return event;
}

function dragFrom(view: EstanzaSceneView, mark: HTMLElement, id: number): void {
  finger(mark, 'pointerdown', id);

  const moving = new PointerEvent('pointermove', {
    bubbles: true,
    composed: true,
    pointerId: id,
    pointerType: 'touch',
  });

  mark.addEventListener('pointermove', () => view.orbitFrom(moving), {
    once: true,
  });
  mark.dispatchEvent(moving);
}

function outstanding(seen: readonly Seen[]): Map<number, number> {
  const held = new Map<number, number>();

  for (const { type, id } of seen) {
    const count = held.get(id) ?? 0;

    held.set(id, type === 'pointerdown' ? count + 1 : Math.max(0, count - 1));
  }

  return new Map([...held].filter(([, count]) => count > 0));
}

describe('a finger handed from a mark to the camera controls', () => {
  it('ends on the controls when the mark it started on is gone before it lifts', async () => {
    const { view, mark, seen } = await mounted();

    dragFrom(view, mark, 12);
    mark.remove();
    finger(mark, 'pointerup', 12);

    expect(outstanding(seen)).toEqual(new Map());
  });

  it('ends on the controls when the browser cancels it over the mark', async () => {
    const { view, mark, seen } = await mounted();

    dragFrom(view, mark, 12);
    finger(mark, 'pointercancel', 12);

    expect(outstanding(seen)).toEqual(new Map());
  });

  it('is handed over once when it lifts normally', async () => {
    const { view, mark, seen } = await mounted();

    dragFrom(view, mark, 12);
    finger(mark, 'pointerup', 12);

    expect(seen).toEqual([
      { type: 'pointerdown', id: 12 },
      { type: 'pointerup', id: 12 },
    ]);
  });

  it('never holds one finger twice across a phone orbit and pinch, and logs nothing', async () => {
    const errors = vi.spyOn(console, 'error');
    const { view, mark, seen } = await mounted();
    let most = 0;

    for (let round = 0; round < 3; round += 1) {
      dragFrom(view, mark, 11);
      dragFrom(view, mark, 12);
      most = Math.max(most, ...outstanding(seen).values());
      mark.remove();
      finger(mark, 'pointerup', 11);
      finger(mark, 'pointerup', 12);
      document.body.append(mark);
    }

    expect(most).toBe(1);
    expect(outstanding(seen)).toEqual(new Map());
    expect(errors).not.toHaveBeenCalled();
  });
});
