import '../src/scene-view.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  frameWindow,
  NAMED_TIERS,
  type NamedTier,
  type QualityTier,
  resumeMeter,
  tierSettings,
  TOP_TIER,
} from '@estanza/scene/quality.js';
import type { PerspectiveCamera, Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyOverlay,
  type EstanzaSceneView,
  type SceneOverlay,
} from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';

type Subscriber = () => void;

type FakeGl = {
  domElement: HTMLCanvasElement;
  toneMappingExposure: number;
  render: () => void;
};

type FakeState = {
  gl: FakeGl;
  camera: PerspectiveCamera;
  scene: Scene;
  size: { width: number; height: number };
  setSize: () => void;
  invalidate: () => void;
  get: () => FakeState;
};

type CanvasProps = {
  children?: unknown;
  dpr?: [number, number];
  frameloop?: string;
  shadows?: unknown;
  onCreated?: (state: FakeState) => void;
};

type SceneProps = {
  shadowMap: number;
  bulbShadows: boolean;
  outlineWindows?: readonly string[];
};

const loop = vi.hoisted(() => ({
  subscribers: new Set<() => void>(),
  mounts: 0,
  state: null as FakeState | null,
  outlined: [] as (readonly string[])[],
}));

vi.mock('@react-three/fiber', async () => {
  const { createElement, useEffect, useRef } = await import('react');
  const { PerspectiveCamera, Scene } = await import('three');

  return {
    Canvas: ({ children, dpr, frameloop, shadows, onCreated }: CanvasProps) => {
      useEffect(() => {
        const state: FakeState = {
          gl: {
            domElement: document.createElement('canvas'),
            toneMappingExposure: 1,
            render: () => undefined,
          },
          camera: new PerspectiveCamera(),
          scene: new Scene(),
          size: { width: 400, height: 300 },
          setSize: () => undefined,
          invalidate: () => undefined,
          get: () => state,
        };

        loop.mounts += 1;
        loop.state = state;
        onCreated?.(state);
      }, []);

      return createElement(
        'div',
        {
          'data-testid': 'canvas',
          'data-dpr': JSON.stringify(dpr),
          'data-frameloop': frameloop,
          'data-shadows': String(shadows),
        },
        children as never,
      );
    },
    useFrame: (callback: Subscriber) => {
      const latest = useRef(callback);

      latest.current = callback;

      useEffect(() => {
        const run = (): void => latest.current();

        loop.subscribers.add(run);

        return () => {
          loop.subscribers.delete(run);
        };
      }, []);
    },
    addEffect: () => () => undefined,
    addTail: () => () => undefined,
  };
});

vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

vi.mock('@estanza/scene/components/HomeScene.js', async () => {
  const { createElement } = await import('react');

  return {
    default: ({ shadowMap, bulbShadows, outlineWindows }: SceneProps) => {
      loop.outlined.push(outlineWindows ?? []);

      return createElement('i', {
        'data-testid': 'scene',
        'data-shadow-map': String(shadowMap),
        'data-bulb-shadows': String(bulbShadows),
      });
    },
  };
});

const home = homeDocumentSchema.parse(homeFixture);

let clock = 0;
let visibility: DocumentVisibilityState = 'visible';

function drawFrame(costMs: number): void {
  for (const run of loop.subscribers) run();

  clock += costMs;
  loop.state?.gl.render();
  clock += 16;
}

function drawFrames(count: number, costMs: number): void {
  Array.from({ length: count }).forEach(() => drawFrame(costMs));
}

function canvasOf(view: EstanzaSceneView): HTMLElement | null {
  return view.shadowRoot?.querySelector('[data-testid="canvas"]') ?? null;
}

function sceneOf(view: EstanzaSceneView): HTMLElement | null {
  return view.shadowRoot?.querySelector('[data-testid="scene"]') ?? null;
}

function shows(view: EstanzaSceneView, tier: NamedTier): boolean {
  const settings = tierSettings(tier);

  return (
    canvasOf(view)?.dataset.dpr === JSON.stringify(settings.dpr) &&
    sceneOf(view)?.dataset.shadowMap === String(settings.sunShadowMap) &&
    sceneOf(view)?.dataset.bulbShadows === String(settings.bulbShadows)
  );
}

async function mountScene(): Promise<EstanzaSceneView> {
  const view = document.createElement('estanza-scene-view');

  view.homeDocument = home;
  document.body.append(view);
  await vi.waitFor(() => expect(loop.state).not.toBeNull());

  return view;
}

async function stepTo(view: EstanzaSceneView, tier: NamedTier): Promise<void> {
  drawFrames(130, 50);
  await vi.waitFor(() => expect(view.qualityTier).toBe(tier));
  await vi.waitFor(() => expect(shows(view, tier)).toBe(true));
}

function turnPage(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  clock = 0;
  visibility = 'visible';
  loop.subscribers.clear();
  loop.mounts = 0;
  loop.state = null;
  loop.outlined = [];
  resumeMeter();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as RenderingContext,
  );
  vi.stubGlobal('ResizeObserver', undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the quality the card draws at', () => {
  it('opens every device at the top tier', async () => {
    const view = await mountScene();

    expect(view.qualityTier).toBe(TOP_TIER);
    await vi.waitFor(() => expect(shows(view, TOP_TIER)).toBe(true));
  });

  it('takes the pixel ratio and the shadows from the tier it is at', async () => {
    const view = await mountScene();

    await stepTo(view, 'sharp');
    await stepTo(view, 'balanced');
    await stepTo(view, 'saver');

    expect(sceneOf(view)?.dataset.shadowMap).toBe('0');
    expect(sceneOf(view)?.dataset.bulbShadows).toBe('false');
  });

  it('steps down one tier after sustained slow frames', async () => {
    const view = await mountScene();

    await stepTo(view, 'sharp');

    expect(view.qualityTier).toBe('sharp');
  });

  it('keeps the canvas and its renderer through a step', async () => {
    const view = await mountScene();
    const canvas = canvasOf(view);
    const state = loop.state;

    await stepTo(view, 'sharp');

    expect(canvasOf(view)).toBe(canvas);
    expect(loop.state).toBe(state);
    expect(loop.mounts).toBe(1);
  });

  it('never demotes a machine whose frames are healthy', async () => {
    const view = await mountScene();

    drawFrames(600, 4);
    await view.updateComplete;

    expect(view.qualityTier).toBe(TOP_TIER);
    expect(shows(view, TOP_TIER)).toBe(true);
  });

  it('never climbs back once it has stepped down', async () => {
    const view = await mountScene();

    await stepTo(view, 'sharp');
    drawFrames(600, 1);
    await view.updateComplete;

    expect(view.qualityTier).toBe('sharp');
  });

  it('samples nothing while the page is hidden', async () => {
    const view = await mountScene();

    turnPage('hidden');
    await view.updateComplete;
    drawFrames(200, 200);

    expect(frameWindow()).toHaveLength(0);
    expect(view.qualityTier).toBe(TOP_TIER);
  });

  it('skips the first draw after the page comes back', async () => {
    const view = await mountScene();

    turnPage('hidden');
    turnPage('visible');
    await view.updateComplete;
    drawFrame(900);

    expect(frameWindow()).toHaveLength(0);

    drawFrame(5);

    expect(frameWindow()).toEqual([5]);
  });

  it('asks for the shadow map three.js still supports, not the deprecated soft one', async () => {
    const view = await mountScene();

    expect(canvasOf(view)?.dataset.shadows).toBe('percentage');
  });

  it('stops drawing while the page is hidden', async () => {
    const view = await mountScene();

    turnPage('hidden');

    await vi.waitFor(() =>
      expect(canvasOf(view)?.dataset.frameloop).toBe('never'),
    );
  });
});

describe('a quality the reader picked', () => {
  async function mountAt(quality: QualityTier): Promise<EstanzaSceneView> {
    const view = document.createElement('estanza-scene-view');

    view.quality = quality;
    view.homeDocument = home;
    document.body.append(view);
    await vi.waitFor(() => expect(loop.state).not.toBeNull());

    return view;
  }

  it.each(NAMED_TIERS)('draws at %s when that tier is picked', async (tier) => {
    const view = await mountAt(tier);

    expect(view.qualityTier).toBe(tier);
    await vi.waitFor(() => expect(shows(view, tier)).toBe(true));
  });

  it('holds a picked tier against a slow meter', async () => {
    const view = await mountAt('sharp');

    drawFrames(600, 200);
    await view.updateComplete;

    expect(view.qualityTier).toBe('sharp');
    expect(shows(view, 'sharp')).toBe(true);
  });

  it('still steps down on Auto', async () => {
    const view = await mountAt('auto');

    await stepTo(view, 'sharp');

    expect(view.qualityTier).toBe('sharp');
  });

  it('moves to a newly picked tier without a new canvas', async () => {
    const view = await mountAt('auto');
    const canvas = canvasOf(view);

    view.quality = 'saver';
    await vi.waitFor(() => expect(shows(view, 'saver')).toBe(true));

    expect(canvasOf(view)).toBe(canvas);
    expect(loop.mounts).toBe(1);
  });

  it('opens at the top tier again when the reader goes back to Auto', async () => {
    const view = await mountAt('saver');

    view.quality = 'auto';
    await vi.waitFor(() => expect(shows(view, TOP_TIER)).toBe(true));

    expect(view.qualityTier).toBe(TOP_TIER);
  });
});

describe('a linked door or window in 3D', () => {
  async function outlinedWith(overlay: SceneOverlay): Promise<string[]> {
    const view = await mountScene();
    const before = loop.outlined.length;

    view.overlay = overlay;
    await vi.waitFor(() =>
      expect(loop.outlined.length).toBeGreaterThan(before),
    );

    return [...new Set(loop.outlined.flat())];
  }

  it.each([
    ['an open', 1],
    ['a shut', 0],
  ])('draws no outline around %s window', async (_, open) => {
    const outlined = await outlinedWith({
      ...emptyOverlay(),
      windows: { n1: open },
    });

    expect(outlined).toEqual([]);
  });

  it('draws no outline around an open door', async () => {
    const outlined = await outlinedWith({
      ...emptyOverlay(),
      doors: { d1: 1 },
    });

    expect(outlined).toEqual([]);
  });
});
