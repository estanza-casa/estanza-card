import type { HomeDocument } from '@estanza/plan-engine';
import type { Light } from '@estanza/plan-engine/document';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { sceneConfig } from '@estanza/scene/config.js';
import { motionLive } from '@estanza/scene/env.js';
import {
  GARDEN_NIGHT,
  PLAIN_GROUND,
  PLAIN_GROUND_NIGHT,
} from '@estanza/scene/ground.js';
import type { RootState } from '@react-three/fiber';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BoxGeometry,
  BufferGeometry,
  Clock,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  warn,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../package.json';
import { CameraRig } from '../src/camera-rig.js';
import type { Point } from '../src/gesture.js';
import {
  aboveOf,
  applyOverlay,
  boundMeshes,
  CANVAS_RESIZE,
  centreOf,
  emptyOverlay,
  EstanzaSceneView,
  floorsFor,
  furnitureNotice,
  gardenPiece,
  ghostStorey,
  groundPieces,
  inScene,
  isVeiled,
  keepVeiled,
  lowestMesh,
  markSpot,
  ModelGuard,
  overlayBrightness,
  pickedScope,
  pinSpot,
  projectOutline,
  REVALIDATE_MS,
  sceneFrameloop,
  type SceneOverlay,
  sceneSun,
  sightSpots,
  slidingWindows,
  storeyPoints,
  unsupportedNotice,
  veilStorey,
  withFloorColours,
  withoutCatalogProps,
} from '../src/scene-view.js';
import { SHELL_FLOOR, SHELL_SLAB } from '../src/shell-slab.js';
import homeFixture from './fixtures/home.json';

const home = homeDocumentSchema.parse(homeFixture);
const sharedHome = { name: 'Test Home', document: home, watermark: true };

type Observation = { target: Element };

class RecordingResizeObserver {
  static observations: Observation[] = [];

  observe(target: Element): void {
    RecordingResizeObserver.observations.push({ target });
  }

  unobserve(): void {}

  disconnect(): void {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respondWith(body: unknown, status = 200): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(body, status));
}

function servedHome(): () => Promise<Response> {
  return respondWith({ home: sharedHome });
}

async function settle(element: EstanzaSceneView): Promise<void> {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
}

async function mountView(
  apply: (element: EstanzaSceneView) => void,
): Promise<EstanzaSceneView> {
  const element = document.createElement('estanza-scene-view');

  apply(element);
  document.body.append(element);
  await settle(element);

  return element;
}

beforeEach(() => {
  RecordingResizeObserver.observations = [];
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function overlayWith(patch: Partial<SceneOverlay>): SceneOverlay {
  return { ...emptyOverlay(), ...patch };
}

function lightNamed(document: HomeDocument, slug: string): Light | undefined {
  return document.additions.lights.find((entry) => entry.slug === slug);
}

describe('brightness handed to the renderer', () => {
  it('passes the brightness a lit bulb reports, by light', () => {
    expect(
      overlayBrightness(
        home,
        overlayWith({
          lights: {
            'living-space-light': { on: true, brightness: 0.3, color: null },
          },
        }),
      ),
    ).toEqual({ 'living-space-light': 0.3 });
  });

  it('passes the brightness of a room to every light in it', () => {
    expect(
      overlayBrightness(
        home,
        overlayWith({
          rooms: { 'living-space': { on: true, brightness: 0.5, color: null } },
        }),
      ),
    ).toEqual({ 'living-space-light': 0.5 });
  });

  it('prefers the light binding over its room', () => {
    expect(
      overlayBrightness(
        home,
        overlayWith({
          lights: {
            'living-space-light': { on: true, brightness: 0.2, color: null },
          },
          rooms: { 'living-space': { on: true, brightness: 0.9, color: null } },
        }),
      ),
    ).toEqual({ 'living-space-light': 0.2 });
  });

  it('leaves out a bulb that reports no brightness, so it glows in full', () => {
    expect(
      overlayBrightness(
        home,
        overlayWith({
          lights: {
            'living-space-light': { on: true, brightness: null, color: null },
          },
        }),
      ),
    ).toEqual({});
  });

  it('leaves out a light that is off', () => {
    expect(
      overlayBrightness(
        home,
        overlayWith({
          lights: {
            'living-space-light': { on: false, brightness: 0.4, color: null },
          },
        }),
      ),
    ).toEqual({});
  });
});

describe('overlay application', () => {
  it('switches off every light when nothing is bound, keeping each fixture', () => {
    const next = applyOverlay(home, emptyOverlay());

    expect(next.additions.lights).toHaveLength(home.additions.lights.length);
    expect(next.additions.lights.map((light) => light.on)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('switches off a light no binding reaches while a bound one stays lit', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: true, brightness: null, color: null },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.on).toBe(true);
    expect(lightNamed(next, 'bathroom-light')?.on).toBe(false);
    expect(lightNamed(next, 'hall-light')?.on).toBe(false);
  });

  it('switches off a light when only a door is bound', () => {
    const next = applyOverlay(home, overlayWith({ doors: { d1: 1 } }));

    expect(next.additions.lights.some((light) => light.on)).toBe(false);
  });

  it('turns a bound light off when its entity is off', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: false, brightness: null, color: null },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.on).toBe(false);
  });

  it('turns every light of a bound room on', () => {
    const dark = {
      ...home,
      additions: {
        ...home.additions,
        lights: home.additions.lights.map((light) => ({
          ...light,
          on: false,
        })),
      },
    };

    const next = applyOverlay(
      dark,
      overlayWith({
        rooms: { 'living-space': { on: true, brightness: null, color: null } },
      }),
    );

    expect(next.additions.lights.filter((light) => light.on)).toHaveLength(1);
    expect(lightNamed(next, 'living-space-light')?.on).toBe(true);
  });

  it('prefers a light binding over the room it sits in', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: false, brightness: null, color: null },
        },
        rooms: { 'living-space': { on: true, brightness: null, color: null } },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.on).toBe(false);
  });

  it('takes the entity colour over the one stored in the document', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': {
            on: true,
            brightness: null,
            color: '#ff6ea8',
          },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.color).toBe('#ff6ea8');
  });

  it('keeps the true colour of a dim bulb, since its spill carries the brightness', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: true, brightness: 0.1, color: '#4f7cff' },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.color).toBe('#4f7cff');
  });

  it('keeps the stored colour of a dim bulb that reports none', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: true, brightness: 0, color: null },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.color).toBe('#ffd4ab');
  });

  it('keeps the stored colour for a light that is off', () => {
    const next = applyOverlay(
      home,
      overlayWith({
        lights: {
          'living-space-light': { on: false, brightness: 0, color: null },
        },
      }),
    );

    expect(lightNamed(next, 'living-space-light')?.color).toBe('#ffd4ab');
  });

  it('opens a bound door part way and closes a door with no sensor', () => {
    const next = applyOverlay(home, overlayWith({ doors: { d1: 0.5 } }));

    expect(next.overrides.doors.d1?.open).toBeCloseTo(0.4);
    expect(next.overrides.doors.d2?.open).toBe(0);
  });

  it('closes a door with no sensor that the home saved open, keeping the rest of it', () => {
    const saved = {
      ...home,
      overrides: {
        ...home.overrides,
        doors: { d2: { open: 1, color: '#b96d43' } },
      },
    };

    const next = applyOverlay(saved, emptyOverlay());

    expect(next.overrides.doors.d2).toEqual({ open: 0, color: '#b96d43' });
  });

  it('closes a bound door when its sensor reads shut', () => {
    const next = applyOverlay(home, overlayWith({ doors: { d1: 0 } }));

    expect(next.overrides.doors.d1?.open).toBe(0);
  });

  it('ignores a room name that only exists on the object prototype', () => {
    const odd = {
      ...home,
      additions: {
        ...home.additions,
        lights: [{ ...home.additions.lights[0], room: 'constructor' }],
      },
    };

    const next = applyOverlay(odd, overlayWith({ doors: { d1: 1 } }));

    expect(next.additions.lights[0]?.on).toBe(false);
  });

  it('leaves the source document untouched', () => {
    applyOverlay(home, overlayWith({ doors: { d1: 1 } }));

    expect(home.overrides.doors.d1).toBeUndefined();
  });

  it('opens a bound window as far as its sensor reads', () => {
    const next = applyOverlay(home, overlayWith({ windows: { n1: 0.4 } }));

    expect(next.overrides.windows.n1?.open).toBeCloseTo(0.4);
  });

  it('keeps an open window inside the range the scene can draw', () => {
    const next = applyOverlay(home, overlayWith({ windows: { n1: 3 } }));

    expect(next.overrides.windows.n1?.open).toBe(1);
  });

  it('keeps what the home already says about a window it opens', () => {
    const lit = {
      ...home,
      overrides: { ...home.overrides, windows: { n1: { litAtNight: true } } },
    };

    const next = applyOverlay(lit, overlayWith({ windows: { n1: 1 } }));

    expect(next.overrides.windows.n1).toEqual({ litAtNight: true, open: 1 });
  });
});

describe('furniture that will not load', () => {
  it('keeps built pieces and drops the catalog ones', () => {
    const furnished = {
      ...home,
      additions: {
        ...home.additions,
        props: [
          { slug: 'sofa', type: 'catalog', catalogId: 'loungeSofa' },
          { slug: 'socket', type: 'plug' },
        ],
      },
    };

    expect(
      withoutCatalogProps(furnished).additions.props.map((prop) => prop.slug),
    ).toEqual(['socket']);
  });

  it('draws what it guards while nothing fails', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onFailure = vi.fn();

    flushSync(() => {
      root.render(
        createElement(
          ModelGuard,
          { onFailure },
          createElement('p', null, 'home'),
        ),
      );
    });

    expect(host.textContent).toBe('home');
    expect(onFailure).not.toHaveBeenCalled();
    root.unmount();
  });

  it('reports a model that fails to load instead of taking the scene down', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onFailure = vi.fn();
    const failure = new Error(
      'Unexpected token <, "<!doctype "... is not valid JSON',
    );
    const Broken = (): never => {
      throw failure;
    };

    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    flushSync(() => {
      root.render(
        createElement(ModelGuard, { onFailure }, createElement(Broken)),
      );
    });

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(host.textContent).toBe('');
    root.unmount();
  });

  it('says out loud that the furniture could not load', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const view = await mountView((element) => {
      element.homeDocument = home;
    });

    view.furnitureFailed(new Error('not a model'));
    await settle(view);

    expect(view.rendererNotice).toBe(furnitureNotice);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'https://app.estanza.casa/assets/props',
    );
  });

  it('tries the furniture again once the models origin changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await mountView((element) => {
      element.homeDocument = home;
    });

    view.furnitureFailed(new Error('not a model'));
    await settle(view);
    view.modelsOrigin = 'http://homeassistant.local:8080';
    await settle(view);

    expect(view.rendererNotice).not.toBe(furnitureNotice);
  });
});

describe('derived floors across state changes', () => {
  const lit = overlayWith({
    lights: {
      'living-space-light': { on: true, brightness: 0.5, color: '#ffaa00' },
    },
  });

  it('keeps the same floors when only a light changes', () => {
    const first = floorsFor(null, home, emptyOverlay());

    expect(floorsFor(first, home, lit).floors).toBe(first.floors);
  });

  it('derives the floors again when a door moves', () => {
    const first = floorsFor(null, home, emptyOverlay());
    const opened = floorsFor(first, home, overlayWith({ doors: { d1: 1 } }));

    expect(opened.floors).not.toBe(first.floors);
    expect(
      opened.floors[0].floor.doors.find((door) => door.id === 'd1')?.open,
    ).toBeGreaterThan(0);
  });

  it('derives every door with no sensor closed', () => {
    const doors = floorsFor(null, home, emptyOverlay()).floors.flatMap(
      (floor) => floor.floor.doors,
    );

    expect(doors.map((door) => door.open)).toEqual([0, 0]);
  });

  it('derives the floors again when a window opens', () => {
    const [ground, ...upper] = home.plan.floors;
    const glazed = {
      ...home,
      plan: {
        ...home.plan,
        floors: [
          {
            ...ground,
            windows: [
              {
                id: 'n1',
                wallId: 'w1',
                position: 0.5,
                width: 120,
                height: 120,
                sillHeight: 90,
              },
            ],
          },
          ...upper,
        ],
      },
    };
    const first = floorsFor(null, glazed, emptyOverlay());
    const opened = floorsFor(
      first,
      glazed,
      overlayWith({ windows: { n1: 1 } }),
    );

    expect(opened.floors).not.toBe(first.floors);
    expect(opened.floors[0].floor.windows[0]?.open).toBe(1);
  });

  it('slides a window the home calls sliding, at its own sill', () => {
    const [ground, ...upper] = home.plan.floors;
    const pane = {
      wallId: 'w1',
      position: 0.5,
      width: 120,
      height: 100,
      sillHeight: 90,
    };
    const glazed = {
      ...home,
      plan: {
        ...home.plan,
        floors: [
          {
            ...ground,
            windows: [
              { ...pane, id: 'n1', type: 'sliding' },
              { ...pane, id: 'n2', position: 0.2 },
              { ...pane, id: 'n3', position: 0.8, type: 'fixed' },
            ],
          },
          ...upper,
        ],
      },
      overrides: { ...home.overrides, windows: { n2: { type: 'sliding' } } },
    };
    const windows = floorsFor(
      null,
      glazed,
      overlayWith({ windows: { n1: 1, n2: 1, n3: 1 } }),
    ).floors[0].floor.windows;

    expect(
      windows.map((window) => [window.id, window.sliding === true]),
    ).toEqual([
      ['n1', true],
      ['n2', true],
      ['n3', false],
    ]);
    expect(windows[0]?.sillHeight).toBe(90);
    expect(slidingWindows(glazed).overrides.windows.n1).toEqual({
      sliding: true,
    });
  });

  it('derives the floors again for a new document', () => {
    const first = floorsFor(null, home, emptyOverlay());

    expect(floorsFor(first, { ...home }, emptyOverlay()).floors).not.toBe(
      first.floors,
    );
  });
});

describe('three.js warnings on the console', () => {
  it('leaves out the clock deprecation the renderer library raises on every canvas', () => {
    const shown = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    new Clock();

    expect(shown).not.toHaveBeenCalled();
  });

  it('passes every other warning on', () => {
    const shown = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warn('WebGLRenderer: something went wrong', 3);

    expect(shown).toHaveBeenCalledWith(
      'THREE.WebGLRenderer: something went wrong',
      3,
    );
  });
});

describe('demand rendering', () => {
  it('draws only when something changes while the page is on screen', () => {
    expect(sceneFrameloop('visible')).toBe('demand');
  });

  it('draws nothing while the page is hidden', () => {
    expect(sceneFrameloop('hidden')).toBe('never');
  });

  it('draws nothing while the floor plan covers the scene', () => {
    expect(sceneFrameloop('visible', true)).toBe('never');
    expect(sceneFrameloop('visible', false)).toBe('demand');
  });

  it('follows the page going out of sight and coming back', async () => {
    const listen = vi.spyOn(document, 'addEventListener');
    const forget = vi.spyOn(document, 'removeEventListener');
    const view = await mountView(() => {});

    expect(listen).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );

    view.remove();

    expect(forget).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  });
});

describe('the sun handed to the renderer', () => {
  it('turns the degrees Home Assistant reports into radians', () => {
    const sun = sceneSun({ elevation: 30, azimuth: 180 });

    expect(sun?.elevation).toBeCloseTo(Math.PI / 6);
    expect(sun?.azimuth).toBeCloseTo(Math.PI);
  });

  it('hands over no sun when there is none', () => {
    expect(sceneSun(null)).toBeUndefined();
  });

  it('ignores a drift too small to see, so the scene does not redraw', () => {
    expect(sceneSun({ elevation: 12.31, azimuth: 231.44 })).toEqual(
      sceneSun({ elevation: 12.34, azimuth: 231.41 }),
    );
  });

  it('moves with a tenth of a degree', () => {
    expect(sceneSun({ elevation: 12.3, azimuth: 231.4 })).not.toEqual(
      sceneSun({ elevation: 12.4, azimuth: 231.4 }),
    );
  });

  it('has no sun until the card hands one over', async () => {
    const view = await mountView(() => {});

    expect(view.sun).toBeNull();
  });
});

describe('scope picking', () => {
  it('reads the nearest selectable ancestor of the hit object', () => {
    const parent = { userData: { sel: { type: 'room', id: 'living-space' } } };
    const scope = pickedScope([{ object: { parent } }]);

    expect(scope).toEqual({ scopeType: 'room', scopeId: 'living-space' });
  });

  it('returns nothing when no ancestor carries a selection', () => {
    expect(pickedScope([{ object: {} }])).toBeNull();
  });
});

describe('the outline of a room floor on screen', () => {
  function floorAt(y: number): Mesh {
    const shape = new Shape([
      new Vector2(-1, -1),
      new Vector2(1, -1),
      new Vector2(1, 1),
      new Vector2(-1, 1),
    ]);
    const geometry = new ShapeGeometry(shape);

    geometry.rotateX(Math.PI / 2);

    const mesh = new Mesh(geometry);

    mesh.position.y = y;
    mesh.updateMatrixWorld();

    return mesh;
  }

  function camera(): OrthographicCamera {
    const view = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);

    view.position.set(0, 10, 0);
    view.lookAt(0, 0, 0);
    view.updateMatrixWorld();

    return view;
  }

  it('fills the floor and draws only its outer edge', () => {
    const outline = projectOutline(floorAt(0), camera(), {
      width: 400,
      height: 400,
    });

    expect(outline?.fill.match(/M/g)).toHaveLength(2);
    expect(outline?.edge.match(/M/g)).toHaveLength(4);
    expect(outline?.edge).toContain('100,100');
    expect(outline?.edge).toContain('300,300');
  });

  it('takes the floor rather than the ceiling above it', () => {
    const floor = floorAt(0);
    const lid = floorAt(3);

    expect(lowestMesh([lid, floor])).toBe(floor);
  });
});

describe('reduced motion', () => {
  function preferring(reduce: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: reduce,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  }

  afterEach(() => {
    motionLive.reduced = false;
  });

  it('lands the storeys in one frame when the reader asks for less motion', async () => {
    preferring(true);
    await mountView(() => {});

    expect(motionLive.reduced).toBe(true);
  });

  it('glides them otherwise', async () => {
    motionLive.reduced = true;
    preferring(false);
    await mountView(() => {});

    expect(motionLive.reduced).toBe(false);
  });

  it('opens where the browser has no media queries', async () => {
    vi.stubGlobal('matchMedia', undefined);

    const view = await mountView(() => {});

    expect(view.isConnected).toBe(true);
  });
});

describe('the ground drawn around a storey', () => {
  function piece(sel: { type: string; id: string } | null, name = ''): Group {
    const group = new Group();

    group.name = name;

    if (sel) group.userData = { sel };

    return group;
  }

  it('finds the garden, the paths, the steps, the balconies and the slab', () => {
    const scene = new Group();
    const found = [
      piece({ type: 'groundZone', id: 'grass' }),
      piece({ type: 'path', id: 'path' }),
      piece({ type: 'gardenSteps', id: 'steps' }),
      piece({ type: 'balcony', id: 'balcony' }),
      piece(null, SHELL_SLAB),
    ];

    scene.add(...found, piece({ type: 'light', id: 'lamp' }), piece(null));

    expect(groundPieces(scene)).toEqual(found);
  });

  it('keeps the ground of a veiled storey below the one on show, so the framing holds', () => {
    const scene = new Group();
    const below = new Group();
    const above = new Group();
    const grass = piece({ type: 'groundZone', id: 'grass' });

    below.userData = { estanzaVeiled: true, estanzaFramed: true };
    above.userData = { estanzaVeiled: true };
    below.add(grass);
    above.add(piece({ type: 'balcony', id: 'balcony' }));
    scene.add(below, above);

    expect(groundPieces(scene)).toEqual([grass]);
  });
});

describe('the floors a storey is drawn on', () => {
  function luminance(hex: string): number {
    const value = Number.parseInt(hex.slice(1), 16);

    return (
      0.2126 * ((value >> 16) & 255) +
      0.7152 * ((value >> 8) & 255) +
      0.0722 * (value & 255)
    );
  }

  const uncoloured = deriveFloors(
    homeDocumentSchema.parse({ ...homeFixture, rooms: {} }),
  );

  it('gives a room with no floor colour of its own a floor lighter than the ground', () => {
    const rooms = withFloorColours(uncoloured).flatMap((floor) => floor.rooms);

    expect(rooms.length).toBeGreaterThan(0);

    for (const room of rooms) {
      expect(luminance(room.floorColor ?? '#000000')).toBeGreaterThan(
        luminance(PLAIN_GROUND),
      );
    }
  });

  it('keeps the floor colour a room has', () => {
    const coloured = deriveFloors(home);
    const own = coloured.flatMap((floor) => floor.rooms);

    expect(
      withFloorColours(coloured)
        .flatMap((floor) => floor.rooms)
        .map((room) => room.floorColor),
    ).toEqual(own.map((room) => room.floorColor ?? SHELL_FLOOR.day));
  });

  it('finds a coloured room by its slug too', () => {
    const [floor] = withFloorColours(uncoloured);
    const [room] = floor.rooms;

    expect(floor.roomsBySlug.get(room.slug)).toBe(room);
  });

  it('lays a storey with walls and no rooms on a floor lighter than the ground, by day and by night', () => {
    expect(luminance(SHELL_FLOOR.day)).toBeGreaterThan(luminance(PLAIN_GROUND));
    expect(luminance(SHELL_FLOOR.night)).toBeGreaterThan(
      luminance(GARDEN_NIGHT),
    );
    expect(luminance(SHELL_FLOOR.night)).toBeGreaterThan(
      luminance(PLAIN_GROUND_NIGHT),
    );
  });
});

describe('the house a storey is framed by', () => {
  const shell = homeDocumentSchema.parse({
    ...homeFixture,
    plan: {
      ...homeFixture.plan,
      floors: [{ ...homeFixture.plan.floors[0], rooms: [] }],
    },
  });

  it('frames every wall of a storey that has no rooms, at full height', () => {
    const [floor] = deriveFloors(shell);
    const anchor = new Group();

    anchor.scale.setScalar(0.01);
    anchor.updateMatrixWorld();

    const points = storeyPoints(floor, anchor.matrixWorld);
    const ends = floor.floor.walls.flatMap((wall) => [wall.start, wall.end]);
    const xs = ends.map((end) => end.x / 100);
    const tallest = Math.max(...floor.floor.walls.map((wall) => wall.height));

    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(
      Math.min(...xs),
    );
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(
      Math.max(...xs),
    );
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(
      tallest / 100,
    );
  });

  it('follows the storey where the renderer lifted it', () => {
    const [floor] = deriveFloors(home);
    const anchor = new Group();

    anchor.scale.setScalar(0.01);
    anchor.position.y = 5.6;
    anchor.updateMatrixWorld();

    expect(
      Math.min(
        ...storeyPoints(floor, anchor.matrixWorld).map((point) => point.y),
      ),
    ).toBeCloseTo(5.6);
  });
});

describe('a storey built ahead of time', () => {
  function storeyWithLamp() {
    const storey = new Group();
    const wall = new Mesh(new BoxGeometry(1, 1, 1));
    const bulb = new PointLight();
    const unlit = new Mesh(new BoxGeometry(0.1, 0.1, 0.1));

    unlit.visible = false;
    storey.add(wall, bulb, unlit);

    return { storey, wall, bulb, unlit };
  }

  it('hides what it draws but keeps its lights in the scene, so no shader is rebuilt', () => {
    const { storey, wall, bulb } = storeyWithLamp();
    const hidden = new Set<Object3D>();

    expect(veilStorey(storey, true, hidden)).toBe(1);
    expect(wall.visible).toBe(false);
    expect(bulb.visible).toBe(true);
    expect(storey.visible).toBe(true);
  });

  it('keeps its garden when another storey is shown alone', () => {
    const { storey, wall } = storeyWithLamp();
    const lawn = new Mesh(new BoxGeometry(1, 1, 1));

    lawn.userData = { sel: { type: 'groundZone', id: 'lawn' } };
    storey.add(lawn);

    veilStorey(storey, true, new Set(), (object) =>
      gardenPiece(object, new Set()),
    );

    expect(wall.visible).toBe(false);
    expect(lawn.visible).toBe(true);
  });

  it('hides its garden with the rest when it is shown with other storeys', () => {
    const { storey } = storeyWithLamp();
    const lawn = new Mesh(new BoxGeometry(1, 1, 1));

    lawn.userData = { sel: { type: 'groundZone', id: 'lawn' } };
    storey.add(lawn);

    veilStorey(storey, true, new Set());

    expect(lawn.visible).toBe(false);
  });

  it('hides a piece that arrives while it is hidden', () => {
    const { storey } = storeyWithLamp();
    const hidden = new Set<Object3D>();
    const late = new Mesh(new BoxGeometry(1, 1, 1));

    veilStorey(storey, true, hidden);
    storey.add(late);

    expect(veilStorey(storey, true, hidden)).toBe(1);
    expect(late.visible).toBe(false);
  });

  it('shows again only what it hid', () => {
    const { storey, wall, unlit } = storeyWithLamp();
    const hidden = new Set<Object3D>();

    veilStorey(storey, true, hidden);
    veilStorey(storey, false, hidden);

    expect(wall.visible).toBe(true);
    expect(unlit.visible).toBe(false);
    expect(isVeiled(wall)).toBe(false);
  });

  it('readies the shader of a late piece at once, never by polling after it may be disposed', () => {
    const { storey } = storeyWithLamp();
    const hidden = new Set<Object3D>();
    const gl = { compile: vi.fn(), compileAsync: vi.fn() };
    const frame = {
      gl: gl as unknown as RootState['gl'],
      scene: new Scene(),
      camera: new PerspectiveCamera(),
    };

    keepVeiled(storey, hidden, frame);
    keepVeiled(storey, hidden, frame);

    expect(gl.compile).toHaveBeenCalledTimes(1);
    expect(gl.compileAsync).not.toHaveBeenCalled();
  });
});

describe('a storey ghosted behind the one on show', () => {
  function ghostable() {
    const storey = new Group();
    const wall = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const flight = new Group();
    const step = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const lawn = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());

    flight.userData = { sel: { type: 'stairs', id: 'main' } };
    lawn.userData = { sel: { type: 'groundZone', id: 'lawn' } };
    flight.add(step);
    storey.add(wall, flight, lawn);

    return { storey, wall, step, lawn };
  }

  function opacity(mesh: Mesh): number {
    return (mesh.material as MeshStandardMaterial).opacity;
  }

  it('fades to the web editor ghost, with the flight to the floor on show veiled at 0.42', () => {
    const { storey, wall, step } = ghostable();

    ghostStorey(storey, { linked: true });

    expect(opacity(wall)).toBe(0.05);
    expect(
      `#${(wall.material as MeshStandardMaterial).color.getHexString()}`,
    ).toBe('#8e99a6');
    expect(opacity(step)).toBe(0.42);
  });

  it('lets a tap pass through it, and takes taps again once it is on show', () => {
    const { storey, wall } = ghostable();

    const stop = ghostStorey(storey, { linked: false });

    expect(isVeiled(wall)).toBe(true);

    stop();

    expect(isVeiled(wall)).toBe(false);
    expect(opacity(wall)).toBe(1);
  });

  it('keeps its garden solid while its rooms fade, and a tap still passes through it', () => {
    const { storey, wall, lawn } = ghostable();
    const oak = new Group();
    const trunk = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
    );

    oak.userData = { sel: { type: 'prop', id: 'oak' } };
    oak.add(trunk);
    storey.add(oak);

    ghostStorey(storey, {
      linked: false,
      keep: (object) => gardenPiece(object, new Set(['oak'])),
    });

    expect(opacity(lawn)).toBe(1);
    expect(opacity(trunk)).toBe(1);
    expect(opacity(wall)).toBe(0.05);
    expect(isVeiled(lawn)).toBe(true);
  });
});

describe('the garden of a storey', () => {
  function piece(sel: { type: string; id: string } | null): Mesh {
    const holder = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));

    if (sel) holder.userData = { sel };
    holder.add(mesh);

    return mesh;
  }

  it.each([
    ['a lawn', { type: 'groundZone', id: 'lawn' }],
    ['a path', { type: 'path', id: 'drive' }],
    ['garden steps', { type: 'gardenSteps', id: 'steps' }],
    ['a tree standing outside', { type: 'prop', id: 'oak' }],
  ])('counts %s', (_name, sel) => {
    expect(gardenPiece(piece(sel), new Set(['oak']))).toBe(true);
  });

  it.each([
    ['a wall', { type: 'wall', id: 'w1' }],
    ['a balcony', { type: 'balcony', id: 'b1' }],
    ['furniture in a room', { type: 'prop', id: 'sofa' }],
    ['a piece with no selection', null],
  ])('leaves out %s', (_name, sel) => {
    expect(gardenPiece(piece(sel), new Set(['oak']))).toBe(false);
  });
});

describe('targets on a lifted storey', () => {
  function liftedLight(): { storey: Group; scene: Group } {
    const scene = new Group();
    const storey = new Group();
    const light = new Group();

    light.userData = { sel: { type: 'light', id: 'kitchen-light' } };
    light.position.set(1, 2, 0);
    light.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2)));
    storey.add(light);
    scene.add(storey);
    scene.updateMatrixWorld();

    return { storey, scene };
  }

  it('finds the meshes of each bound object', () => {
    const { scene } = liftedLight();
    const meshes = boundMeshes(scene, new Set(['light:kitchen-light']));

    expect(meshes.get('light:kitchen-light')).toHaveLength(1);
  });

  it('follows the storey as it rises', () => {
    const { storey, scene } = liftedLight();
    const meshes = boundMeshes(scene, new Set(['light:kitchen-light']));

    storey.position.y = 2.8;
    scene.updateMatrixWorld();

    expect(centreOf(meshes.get('light:kitchen-light') ?? [])?.y).toBeCloseTo(
      4.8,
    );
  });

  it('marks a window above its frame', () => {
    const pane = new Mesh(new BoxGeometry(1, 1.2, 0.1));

    pane.position.set(2, 1.5, 0);
    pane.updateMatrixWorld();

    const above = aboveOf([pane]);

    expect(above?.x).toBeCloseTo(2);
    expect(above?.y).toBeCloseTo(2.5);
  });

  it('marks an open window over its frame, not over the sash swung out of it', () => {
    const wall = new Group();
    const frame = new Mesh(new BoxGeometry(1, 1.2, 0.1));
    const hinge = new Group();
    const sash = new Mesh(new BoxGeometry(0.5, 1.2, 0.05));

    frame.position.set(2, 1.5, 0);
    hinge.position.set(1.5, 1.5, 0);
    hinge.rotation.y = -1.2;
    sash.position.set(0.25, 0, 0);
    hinge.add(sash);
    wall.add(frame, hinge);
    wall.updateMatrixWorld();

    const above = aboveOf([frame, sash]);

    expect(above?.x).toBeCloseTo(2);
    expect(above?.z).toBeCloseTo(0);
    expect(above?.y).toBeCloseTo(2.5);
  });

  it('pins an open window on its frame, not on the sash swung out of it', () => {
    const wall = new Group();
    const frame = new Mesh(new BoxGeometry(1, 1.2, 0.1));
    const hinge = new Group();
    const sash = new Mesh(new BoxGeometry(0.5, 1.2, 0.05));

    frame.position.set(2, 1.5, 0);
    hinge.position.set(1.5, 1.5, 0);
    hinge.rotation.y = -1.2;
    sash.position.set(0.25, 0, 0);
    hinge.add(sash);
    wall.add(frame, hinge);
    wall.updateMatrixWorld();

    const spot = pinSpot({ type: 'window', id: 'n1' }, [frame, sash]);

    expect(spot?.x).toBeCloseTo(2);
    expect(spot?.y).toBeCloseTo(1.5);
    expect(spot?.z).toBeCloseTo(0);
  });

  function doubleDoor(swing: number) {
    const wall = new Group();
    const leaves = [-1, 1].map((side) => {
      const hinge = new Group();
      const leaf = new Mesh(new BoxGeometry(1.2, 2, 0.05));

      hinge.position.set(side * 1.25, 1, 0);
      hinge.rotation.y = -side * swing;
      leaf.position.set(-side * 0.62, 0, 0);
      hinge.add(leaf);
      wall.add(hinge);

      return leaf;
    });

    wall.position.set(-3.75, 0, 6.75);
    wall.rotation.y = Math.PI;
    wall.updateMatrixWorld();

    return leaves;
  }

  it('marks a door on its opening, so the mark stays put while the leaves swing', () => {
    const shut = markSpot({ type: 'door', id: 'd7' }, doubleDoor(0));
    const open = markSpot({ type: 'door', id: 'd7' }, doubleDoor(1.13));

    expect(open?.distanceTo(shut ?? new Vector3())).toBeCloseTo(0, 6);
    expect(shut?.x).toBeCloseTo(-3.75);
    expect(shut?.z).toBeCloseTo(6.75);
  });

  it('looks for a window at the middle and the top of its frame', () => {
    const frame = new Mesh(new BoxGeometry(1, 1.2, 0.1));

    frame.position.set(2, 1.5, 0);
    frame.updateMatrixWorld();

    const spots = sightSpots({ type: 'window', id: 'n1' }, [frame]);

    expect(spots).toHaveLength(2);
    expect(spots[0].distanceTo(new Vector3(2, 1.5, 0))).toBeCloseTo(0);
    expect(spots[1].distanceTo(new Vector3(2, 2.1, 0))).toBeCloseTo(0);
  });

  it('pins a light on the middle of the whole lamp', () => {
    const { scene } = liftedLight();
    const meshes = boundMeshes(scene, new Set(['light:kitchen-light']));

    expect(
      pinSpot(
        { type: 'light', id: 'kitchen-light' },
        meshes.get('light:kitchen-light') ?? [],
      )?.y,
    ).toBeCloseTo(2);
  });

  it('skips objects nobody bound', () => {
    const { scene } = liftedLight();

    expect(boundMeshes(scene, new Set(['light:other'])).size).toBe(0);
  });

  it('skips the meshes of a storey built ahead but hidden', () => {
    const { storey, scene } = liftedLight();

    veilStorey(storey, true, new Set());

    expect(boundMeshes(scene, new Set(['light:kitchen-light'])).size).toBe(0);
    expect(isVeiled(storey.children[0].children[0])).toBe(true);
  });

  it('knows a mesh is still drawn while its storey hangs in the scene', () => {
    const { storey, scene } = liftedLight();

    expect(inScene(storey.children[0].children[0], scene)).toBe(true);
  });

  it('counts a mesh as gone once the renderer has taken its storey out', () => {
    const { storey, scene } = liftedLight();
    const mesh = storey.children[0].children[0];

    scene.remove(storey);

    expect(inScene(mesh, scene)).toBe(false);
  });

  it('counts a mesh as gone once the renderer has cut it loose', () => {
    const { storey, scene } = liftedLight();
    const mesh = storey.children[0].children[0];

    mesh.removeFromParent();

    expect(inScene(mesh, scene)).toBe(false);
  });
});

describe('furniture whose model replaces its placeholder', () => {
  const tv = { type: 'prop', id: 'living-room-television' } as const;
  const size = { width: 400, height: 400 };

  type Staged = {
    view: EstanzaSceneView;
    camera: OrthographicCamera;
    swap: () => Vector3;
  };

  function staged(): Staged {
    const scene = new Scene();
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const placeholder = new Mesh<BufferGeometry>(
      new BoxGeometry(1.2, 0.6, 0.4),
    );

    camera.position.set(0, 20, 0.001);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    placeholder.position.set(-3, 0.3, 2);
    placeholder.userData = { sel: tv };
    scene.add(placeholder);
    scene.updateMatrixWorld();

    const view = document.createElement('estanza-scene-view');

    view.targets = [tv];
    view.sheet = {
      scope: tv,
      covered: { left: 0, top: 0, right: 0, bottom: 0 },
    };
    const state = { scene, camera, size, get: () => state };

    Object.assign(view, { sceneState: state });

    const swap = (): Vector3 => {
      const model = new Group();

      model.position.set(3, 1, -2);
      model.userData = { sel: tv };
      model.add(new Mesh(new BoxGeometry(1, 0.6, 0.1)));
      placeholder.removeFromParent();
      placeholder.geometry = new BufferGeometry();
      scene.add(model);
      scene.updateMatrixWorld();

      return model.position.clone();
    };

    return { view, camera, swap };
  }

  function onScreen(spot: Vector3, camera: OrthographicCamera): Point {
    const projected = spot.clone().project(camera);

    return {
      x: ((projected.x + 1) / 2) * size.width,
      y: ((1 - projected.y) / 2) * size.height,
    };
  }

  function rigRoom(view: EstanzaSceneView): Vector3[] {
    const rigged = view as unknown as {
      rigSheet: () => { room: () => Vector3[] } | null;
    };

    return rigged.rigSheet()?.room() ?? [];
  }

  it('marks the model, not the placeholder it replaced', () => {
    const { view, camera, swap } = staged();

    view.anchorOf(tv);

    const model = onScreen(swap(), camera);
    const mark = view.anchorOf(tv);

    expect(mark?.x).toBeCloseTo(model.x);
    expect(mark?.y).toBeCloseTo(model.y);
  });

  it('pins the model, not the placeholder it replaced', () => {
    const { view, camera, swap } = staged();

    view.pinAnchors([tv]);

    const model = onScreen(swap(), camera);
    const pin = view.pinAnchors([tv]).get('prop:living-room-television');

    expect(pin?.x).toBeCloseTo(model.x);
    expect(pin?.y).toBeCloseTo(model.y);
  });

  it('measures a placeholder by the footprint box it carries', () => {
    const { view } = staged();
    const corners = rigRoom(view);

    expect(corners).toHaveLength(8);
    expect(
      corners.every((corner) => corner.toArray().every(Number.isFinite)),
    ).toBe(true);
    expect(Math.min(...corners.map((corner) => corner.x))).toBeCloseTo(-3.6);
  });

  it('never hands the rig the empty bounds of a placeholder its model replaced', () => {
    const { view, swap } = staged();

    rigRoom(view);

    const model = swap();
    const corners = rigRoom(view);

    expect(
      corners.every((corner) => corner.toArray().every(Number.isFinite)),
    ).toBe(true);
    expect(
      corners
        .reduce((sum, corner) => sum.add(corner), new Vector3())
        .divideScalar(8).x,
    ).toBeCloseTo(model.x);
  });
});

describe('marks after the renderer is resized', () => {
  const lamp = { type: 'light', id: 'hall-lamp' } as const;

  function resizedView(): { view: EstanzaSceneView; expected: Point } {
    const scene = new Scene();
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const bulb = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    const opened = { width: 400, height: 400 };
    const resized = { width: 800, height: 600 };

    camera.position.set(0, 20, 0.001);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    bulb.position.set(2, 1, 1);
    bulb.userData = { sel: lamp };
    scene.add(bulb);
    scene.updateMatrixWorld();

    const view = document.createElement('estanza-scene-view');
    const live = { scene, camera, size: resized };
    const projected = bulb.position.clone().project(camera);

    view.targets = [lamp];
    Object.assign(view, {
      sceneState: { scene, camera, size: opened, get: () => live },
    });

    return {
      view,
      expected: {
        x: ((projected.x + 1) / 2) * resized.width,
        y: ((1 - projected.y) / 2) * resized.height,
      },
    };
  }

  it('places a mark by the size the renderer draws at now, not the size it opened at', () => {
    const { view, expected } = resizedView();
    const mark = view.anchorOf(lamp);

    expect(mark?.x).toBeCloseTo(expected.x);
    expect(mark?.y).toBeCloseTo(expected.y);
  });

  it('places a pin by the size the renderer draws at now', () => {
    const { view, expected } = resizedView();
    const pin = view.pinAnchors([lamp]).get('light:hall-lamp');

    expect(pin?.x).toBeCloseTo(expected.x);
    expect(pin?.y).toBeCloseTo(expected.y);
  });
});

describe('marks and pills the house hides', () => {
  const lamp = { type: 'light', id: 'hall-lamp' } as const;
  const lantern = { type: 'light', id: 'porch-lantern' } as const;
  const hall = { type: 'room', id: 'hall' } as const;
  const size = { width: 400, height: 400 };

  type Staged = {
    view: EstanzaSceneView;
    camera: PerspectiveCamera;
    tree: Group;
    shared: Material;
    scene: Scene;
  };

  function staged(eye: Vector3, front = 'wall'): Staged {
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    const floor = new Mesh(new BoxGeometry(400, 2, 400));
    const bulb = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    const wall = new Mesh(new BoxGeometry(6, 2.5, 0.2));
    const tree = new Group();
    const crown = new Mesh(new BoxGeometry(1.5, 5, 1.5));
    const lanternBody = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));

    camera.position.copy(eye);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld();
    floor.userData = { sel: hall };
    floor.scale.setScalar(0.01);
    bulb.position.set(0, 2.3, 0);
    bulb.userData = { sel: lamp };
    wall.position.set(0, 1.25, 2.5);
    wall.userData = { sel: { type: front, id: 'w1' } };
    crown.position.set(0, 2.5, 0);
    tree.add(crown);
    tree.position.set(0, 0, 8);
    tree.userData = { sel: { type: 'prop', id: 'oak' } };
    lanternBody.position.set(2, 1.5, 3);
    lanternBody.userData = { sel: lantern };
    scene.add(floor, bulb, wall, tree, lanternBody);
    scene.updateMatrixWorld();

    const view = document.createElement('estanza-scene-view');
    const raycaster = new Raycaster();
    const state = { scene, camera, size, raycaster, get: () => state };

    view.targets = [lamp, lantern, hall];
    Object.assign(view, {
      sceneState: state,
      roomCentres: new Map([['hall', [0, 0]]]),
      roomTops: new Map([['hall', 0]]),
      roomPolys: new Map([
        [
          'hall',
          [
            [-200, -200],
            [200, -200],
            [200, 200],
            [-200, 200],
          ],
        ],
      ]),
      itemRooms: new Map([['light:hall-lamp', 'hall']]),
      outdoorProps: new Set(['oak']),
    });

    return { view, camera, tree, shared: crown.material as Material, scene };
  }

  it('keeps the pill of a room an outside wall hides from the eye', () => {
    const { view } = staged(new Vector3(0, 1.6, 12));

    expect(view.outOfSight(hall)).toBe(true);
    expect(view.outOfSight(lamp)).toBe(true);
    expect(view.roomAnchors(['hall']).has('hall')).toBe(true);
  });

  it('shows the room, its pill and its lamp again once the eye looks in over the wall', () => {
    const { view } = staged(new Vector3(0, 14, 8));

    expect(view.outOfSight(hall)).toBe(false);
    expect(view.outOfSight(lamp)).toBe(false);
    expect(view.roomAnchors(['hall']).has('hall')).toBe(true);
  });

  it('still places a room that has slid off the stage when asked for hidden anchors', () => {
    const { view, camera } = staged(new Vector3(0, 14, 8));

    camera.lookAt(40, 0.5, 0);
    camera.updateMatrixWorld();

    const beside = view.roomAnchors(['hall'], true).get('hall');

    expect(view.roomAnchors(['hall']).has('hall')).toBe(false);
    expect(beside?.x).toBeLessThan(0);
  });

  it('gives no hidden anchor for a room behind the eye', () => {
    const { view, camera } = staged(new Vector3(0, 14, 8));

    camera.lookAt(0, 14, 40);
    camera.updateMatrixWorld();

    expect(view.roomAnchors(['hall'], true).has('hall')).toBe(false);
  });

  it('sees past the walls of a storey built ahead but hidden', () => {
    const { view, scene } = staged(new Vector3(0, 14, 8));
    const storey = new Group();
    const upper = new Mesh(new BoxGeometry(40, 0.2, 40));

    upper.position.set(0, 7, 0);
    upper.userData = { sel: { type: 'wall', id: 'w-upper' } };
    storey.add(upper);
    veilStorey(storey, true, new Set());
    scene.add(storey);
    scene.updateMatrixWorld();

    expect(view.outOfSight(hall)).toBe(false);
    expect(view.outOfSight(lamp)).toBe(false);
  });

  it('hides a room the eye sees only through the glass of a window', () => {
    const { view } = staged(new Vector3(0, 1.6, 12), 'window');

    expect(view.outOfSight(hall)).toBe(true);
    expect(view.outOfSight(lamp)).toBe(true);
    expect(view.outOfSight(lantern)).toBe(false);
  });

  it('keeps a room in sight while the eye sees into it over a wall that hides its floor', () => {
    const { view } = staged(new Vector3(0, 5, 8));

    Object.assign(view, { roomTops: new Map([['hall', 250]]) });

    expect(view.outOfSight(hall)).toBe(false);
  });

  it('frames a room sheet around the tops of its walls, not only its floor', () => {
    const { view } = staged(new Vector3(0, 14, 8));
    const rigged = view as unknown as {
      rigSheet: () => { room: () => Vector3[] } | null;
    };

    Object.assign(view, { roomTops: new Map([['hall', 250]]) });
    view.sheet = {
      scope: hall,
      covered: { left: 0, top: 0, right: 0, bottom: 0 },
    };

    const points = rigged.rigSheet()?.room() ?? [];

    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(2.5);
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(2);
  });

  it('hides a lamp standing behind the near wall of a room the eye sees into over that wall', () => {
    const { view, scene } = staged(new Vector3(0, 5, 8));
    const bulb = scene.children.find(
      (child) => child.userData.sel?.id === lamp.id,
    );

    Object.assign(view, { roomTops: new Map([['hall', 250]]) });
    bulb?.position.set(0, 0.5, 2.2);
    scene.updateMatrixWorld();

    expect(view.outOfSight(hall)).toBe(false);
    expect(view.outOfSight(lamp)).toBe(true);
  });

  function storeyAbove(
    scene: Scene,
    view: EstanzaSceneView,
    depth: number,
    z: number,
  ): void {
    const upper = new Mesh(new BoxGeometry(400, 2, depth * 100));

    upper.scale.setScalar(0.01);
    upper.position.set(0, 3, z);
    upper.userData = { sel: { type: 'room', id: 'suite' } };
    scene.add(upper);
    scene.updateMatrixWorld();
    Object.assign(view, {
      roomCentres: new Map([
        ['hall', [0, 0]],
        ['suite', [0, 0]],
      ]),
    });
  }

  function onScreen(spot: Vector3, camera: PerspectiveCamera): Point {
    const projected = spot.clone().project(camera);

    return {
      x: ((projected.x + 1) / 2) * size.width,
      y: ((1 - projected.y) / 2) * size.height,
    };
  }

  it('stands no alert pin over the storey above when that storey hides the whole room', () => {
    const { view, scene } = staged(new Vector3(0, 14, 8));

    storeyAbove(scene, view, 8, 0);

    expect(view.pinAnchors([hall]).has('room:hall')).toBe(false);
  });

  it('stands an alert pin on the part of its room the storey above leaves in sight', () => {
    const { view, scene, camera } = staged(new Vector3(0, 14, 8));

    storeyAbove(scene, view, 2, 1.5);

    const pin = view.pinAnchors([hall]).get('room:hall');
    const centre = onScreen(new Vector3(0, 0.01, 0), camera);

    expect(pin).toBeDefined();
    expect(
      Math.hypot((pin?.x ?? 0) - centre.x, (pin?.y ?? 0) - centre.y),
    ).toBeGreaterThan(10);
  });

  it('picks nothing where a lamp the house hides would be drawn', () => {
    const { view } = staged(new Vector3(0, 1.6, 12));
    const shown = staged(new Vector3(0, 14, 8)).view;
    const at = shown.anchorOf(lamp);
    const low = view.anchorOf(lamp);

    expect(at && shown.pickAt(at)).toEqual(lamp);
    expect(low && view.pickAt(low)).not.toEqual(lamp);
  });

  it('keeps a light that stands outside in sight while nothing screens it', () => {
    const { view } = staged(new Vector3(0, 1.6, 12));

    expect(view.outOfSight(lantern)).toBe(false);
  });

  it('fades a tree between the eye and the house, and brings it back once the eye moves past it', () => {
    const { view, camera, tree, shared } = staged(new Vector3(0, 2, 16));
    const crown = tree.children[0] as Mesh;

    view.fadeScreens();

    expect(crown.material).not.toBe(shared);
    expect((crown.material as Material).opacity).toBeLessThan(1);

    camera.position.set(14, 14, -6);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld();
    view.fadeScreens();

    expect(crown.material).toBe(shared);
  });

  it('fades a tree that screens the side of a room though not its middle', () => {
    const { view, tree, shared } = staged(new Vector3(0, 2, 16));
    const crown = tree.children[0] as Mesh;

    tree.position.set(1.2, 0, 8);
    tree.updateMatrixWorld();
    view.fadeScreens();

    expect(crown.material).not.toBe(shared);
  });
});

describe('a new set of storeys on show', () => {
  async function switches(change: (view: EstanzaSceneView) => void) {
    const view = await mountView((element) => {
      element.homeDocument = home;
    });
    const switchFloor = vi.spyOn(CameraRig.prototype, 'switchFloor');

    change(view);
    await settle(view);

    return switchFloor;
  }

  it('flies the camera to a new floor', async () => {
    expect(
      await switches((view) => {
        view.floor = 'f1';
      }),
    ).toHaveBeenCalledOnce();
  });

  it('flies the camera when the storeys are laid out side by side, and back', async () => {
    const view = await mountView((element) => {
      element.homeDocument = home;
    });
    const switchFloor = vi.spyOn(CameraRig.prototype, 'switchFloor');

    view.paging = true;
    await settle(view);
    view.paging = false;
    await settle(view);

    expect(switchFloor).toHaveBeenCalledTimes(2);
  });

  it('leaves the camera alone for a change that shows the same storeys', async () => {
    expect(
      await switches((view) => {
        view.interactive = false;
      }),
    ).not.toHaveBeenCalled();
  });

  it('leaves the first framing to the renderer when it opens paged', async () => {
    const switchFloor = vi.spyOn(CameraRig.prototype, 'switchFloor');

    await mountView((element) => {
      element.homeDocument = home;
      element.paging = true;
    });

    expect(switchFloor).not.toHaveBeenCalled();
  });
});

describe('scene gestures', () => {
  function pointer(type: string, x: number, y: number): Event {
    return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  }

  async function gesturingView(interactive = true) {
    const view = await mountView((element) => {
      element.homeDocument = home;
      element.interactive = interactive;
    });
    const picked = vi
      .spyOn(view, 'pickAt')
      .mockReturnValue({ type: 'light', id: 'living-space-light' });
    const heard = vi.fn();

    view.addEventListener('scope-select', (event) =>
      heard((event as CustomEvent).detail),
    );

    return {
      view,
      picked,
      heard,
      stage: view.shadowRoot?.querySelector('#stage') as HTMLElement,
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a tap on a bound object', async () => {
    const { stage, heard } = await gesturingView();

    stage.dispatchEvent(pointer('pointerdown', 50, 60));
    stage.dispatchEvent(pointer('pointerup', 50, 60));

    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'light',
        scopeId: 'living-space-light',
        gesture: 'tap',
      }),
    );
  });

  it('pages storeys on a sideways one-finger swipe while paging, and reports no tap', async () => {
    const { view, stage, heard } = await gesturingView();
    const paged = vi.fn();
    const touch = (type: string, x: number): Event =>
      Object.assign(pointer(type, x, 60), {
        pointerType: 'touch',
        pointerId: 7,
      });

    view.paging = true;
    view.addEventListener('page-swipe', (event) =>
      paged((event as CustomEvent<number>).detail),
    );
    stage.dispatchEvent(touch('pointerdown', 150));
    stage.dispatchEvent(touch('pointerup', 50));

    expect(paged).toHaveBeenCalledWith(1);
    expect(heard).not.toHaveBeenCalled();
  });

  it('tells the card when the reader takes the camera', async () => {
    const { view, stage } = await gesturingView();
    const input = vi.fn();

    view.addEventListener('camera-input', input);
    stage.dispatchEvent(pointer('pointerdown', 50, 60));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));

    expect(input).toHaveBeenCalledTimes(2);
  });

  it('orbits on a drag of more than 8px and reports nothing', async () => {
    const { stage, heard, picked } = await gesturingView();

    stage.dispatchEvent(pointer('pointerdown', 50, 60));
    stage.dispatchEvent(pointer('pointermove', 59, 60));
    stage.dispatchEvent(pointer('pointerup', 59, 60));

    expect(heard).not.toHaveBeenCalled();
    expect(picked).not.toHaveBeenCalled();
  });

  it('reports a long press once, and no tap after it', async () => {
    const { stage, heard } = await gesturingView();

    vi.useFakeTimers();
    stage.dispatchEvent(pointer('pointerdown', 50, 60));
    vi.advanceTimersByTime(450);
    stage.dispatchEvent(pointer('pointerup', 50, 60));

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({ gesture: 'press' }),
    );
  });

  it('answers no tap while read only', async () => {
    const { stage, heard } = await gesturingView(false);

    stage.dispatchEvent(pointer('pointerdown', 50, 60));
    stage.dispatchEvent(pointer('pointerup', 50, 60));

    expect(heard).not.toHaveBeenCalled();
  });
});

describe('document loading', () => {
  it('fetches the configured share id from the api', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/abc123',
    );
    expect(view.sceneStatus).toBe('ready');
    expect(view.sharedHome?.name).toBe('Test Home');
  });

  it('honours a custom api origin', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    await mountView((element) => {
      element.shareId = 'abc123';
      element.apiOrigin = 'http://homeassistant.local:8930';
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://homeassistant.local:8930/v1/integrations/home-assistant/abc123',
    );
  });

  it('points the scene at the models the public webapp serves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(servedHome()));

    await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(sceneConfig.modelBase).toBe('https://app.estanza.casa/assets/props');
  });

  it('points the scene at a self hosted models origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(servedHome()));

    await mountView((element) => {
      element.shareId = 'abc123';
      element.modelsOrigin = 'http://homeassistant.local:8080';
    });

    expect(sceneConfig.modelBase).toBe(
      'http://homeassistant.local:8080/assets/props',
    );
  });

  it('stays idle with nothing configured', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView(() => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.sceneStatus).toBe('idle');
  });

  it('reports a share that is no longer published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(respondWith({ error: 'Not found' }, 404)),
    );

    const view = await mountView((element) => {
      element.shareId = 'gone';
    });

    expect(view.sceneStatus).toBe('missing');
    expect(view.sharedHome).toBeNull();
  });

  it('reports an unreachable api', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(view.sceneStatus).toBe('failed');
  });

  it('reports a response that carries no document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(respondWith({})));

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(view.sceneStatus).toBe('failed');
  });

  it('reports a document the renderer cannot read instead of going blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        respondWith({
          home: { name: 'Skewed', document: { rooms: {} }, watermark: false },
        }),
      ),
    );

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(view.sceneStatus).toBe('failed');
    expect(view.sharedHome).toBeNull();
  });

  it('fetches once for a stable share id across rerenders', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    view.overlay = {
      ...emptyOverlay(),
      lights: {
        'living-space-light': { on: true, brightness: null, color: null },
      },
    };
    await settle(view);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the share id changes', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    view.shareId = 'def456';
    await settle(view);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/def456',
    );
  });

  it('renders a configured home document with no network request', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.homeDocument = home;
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.sceneStatus).toBe('ready');
    expect(view.sharedHome?.document).toBe(home);
  });

  it('prefers a configured home document over a share id', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
      element.homeDocument = home;
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.sceneStatus).toBe('ready');
  });

  it('abandons an in-flight request when the card is removed', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;

        return new Promise(() => undefined);
      });

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    view.remove();

    expect(signal?.aborted).toBe(true);
  });

  it('retries the abandoned request when the card comes back', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    view.remove();
    document.body.append(view);
    await settle(view);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.sceneStatus).toBe('ready');
  });

  it('keeps the loaded home when the card is moved in the dashboard', async () => {
    const fetchMock = vi.fn().mockImplementation(servedHome());

    vi.stubGlobal('fetch', fetchMock);

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    view.remove();
    document.body.append(view);
    await settle(view);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(view.sceneStatus).toBe('ready');
  });
});

describe('keeping a shared home up to date', () => {
  let visibility: DocumentVisibilityState = 'visible';

  function tagged(body: unknown, etag: string): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', etag },
    });
  }

  function republished(): typeof sharedHome {
    return {
      ...sharedHome,
      document: {
        ...home,
        additions: {
          ...home.additions,
          lights: home.additions.lights.slice(1),
        },
      },
    };
  }

  function sentTag(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
    const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;

    return (init?.headers as Record<string, string> | undefined)?.[
      'if-none-match'
    ];
  }

  async function flush(view: EstanzaSceneView, ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await view.updateComplete;
  }

  async function sharedView(
    fetchMock: ReturnType<typeof vi.fn>,
  ): Promise<EstanzaSceneView> {
    vi.stubGlobal('fetch', fetchMock);

    const view = document.createElement('estanza-scene-view');

    view.shareId = 'abc123';
    document.body.append(view);
    await flush(view);

    return view;
  }

  function turnPage(state: DocumentVisibilityState): void {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    visibility = 'visible';
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again every five minutes, sending the ETag it holds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);

    await flush(view, REVALIDATE_MS - 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(view, 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTag(fetchMock, 1)).toBe('"v1"');

    await flush(view, REVALIDATE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('asks again as soon as the page comes back into view', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);

    turnPage('hidden');
    await flush(view, 1000);
    turnPage('visible');
    await flush(view);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTag(fetchMock, 1)).toBe('"v1"');
  });

  it('does nothing at all when the home has not changed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);
    const before = view.sharedHome;
    const redraw = vi.spyOn(view, 'requestUpdate');
    const announced = vi.fn();

    view.addEventListener('home-change', announced);
    await flush(view, REVALIDATE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.sharedHome).toBe(before);
    expect(redraw).not.toHaveBeenCalled();
    expect(announced).not.toHaveBeenCalled();
  });

  it('swaps a republished home in place without going back to loading', async () => {
    const next = republished();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockResolvedValueOnce(tagged({ home: next }, '"v2"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);
    const statuses: string[] = [];
    const announced = vi.fn();

    view.addEventListener('home-change', () => {
      statuses.push(view.sceneStatus);
      announced();
    });
    await flush(view, REVALIDATE_MS);

    expect(view.sceneStatus).toBe('ready');
    expect(statuses).toEqual(['ready']);
    expect(view.sharedHome?.document.additions.lights).toHaveLength(
      home.additions.lights.length - 1,
    );

    await flush(view, REVALIDATE_MS);

    expect(sentTag(fetchMock, 2)).toBe('"v2"');
    expect(announced).toHaveBeenCalledOnce();
  });

  it('says the link could not be read once it is revoked, never that sharing stopped', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(respondWith({ error: 'Not found' }, 404));
    const view = await sharedView(fetchMock);

    await flush(view, REVALIDATE_MS);

    expect(view.sceneStatus).toBe('missing');
    expect(view.sharedHome).toBeNull();
    expect(view.shadowRoot?.textContent).toContain(
      'Could not read this link. Copy the share link again in Estanza',
    );
    expect(view.shadowRoot?.textContent).not.toContain('no longer shared');

    await flush(view, REVALIDATE_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the home on screen through a network error and tries again next time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);
    const before = view.sharedHome;

    await flush(view, REVALIDATE_MS);

    expect(view.sceneStatus).toBe('ready');
    expect(view.sharedHome).toBe(before);

    await flush(view, REVALIDATE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentTag(fetchMock, 2)).toBe('"v1"');
  });

  it('never asks while the page is hidden', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);

    turnPage('hidden');
    await flush(view, REVALIDATE_MS * 4);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind once the card is removed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tagged({ home: sharedHome }, '"v1"'))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 304 })),
      );
    const view = await sharedView(fetchMock);

    expect(vi.getTimerCount()).toBe(1);

    view.remove();
    await vi.advanceTimersByTimeAsync(REVALIDATE_MS * 2);

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never asks about a home pasted into the config', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const view = document.createElement('estanza-scene-view');

    view.homeDocument = home;
    document.body.append(view);
    await flush(view, REVALIDATE_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the card update verdict', () => {
  function verdict(
    update: string | null,
    body: unknown = { home: sharedHome },
    status = 200,
  ): Response {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      etag: '"v1"',
    };

    if (update !== null) headers['X-Estanza-Card-Update'] = update;

    return new Response(status === 304 ? null : JSON.stringify(body), {
      status,
      headers,
    });
  }

  function sentCard(
    fetchMock: ReturnType<typeof vi.fn>,
    call: number,
  ): unknown {
    const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;

    return new Headers(init?.headers).get('X-Estanza-Card');
  }

  async function flush(view: EstanzaSceneView, ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await view.updateComplete;
  }

  async function sharedView(
    fetchMock: ReturnType<typeof vi.fn>,
  ): Promise<EstanzaSceneView> {
    vi.stubGlobal('fetch', fetchMock);

    const view = document.createElement('estanza-scene-view');

    view.shareId = 'abc123';
    document.body.append(view);
    await flush(view);

    return view;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the card version on the first request and on every revalidation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verdict('ok'))
      .mockImplementation(() => Promise.resolve(verdict('ok', null, 304)));
    const view = await sharedView(fetchMock);

    await flush(view, REVALIDATE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentCard(fetchMock, 0)).toBe(packageJson.version);
    expect(sentCard(fetchMock, 1)).toBe(packageJson.version);
  });

  it('draws the home and keeps the verdict when an update is only suggested', async () => {
    const view = await sharedView(
      vi.fn().mockImplementation(() => Promise.resolve(verdict('suggested'))),
    );

    expect(view.sceneStatus).toBe('ready');
    expect(view.cardUpdate).toBe('suggested');
  });

  it('draws no home when the first answer requires a newer card', async () => {
    const announced = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(verdict('required')));

    vi.stubGlobal('fetch', fetchMock);

    const view = document.createElement('estanza-scene-view');

    view.addEventListener('home-change', announced);
    view.shareId = 'abc123';
    document.body.append(view);
    await flush(view);

    expect(view.sceneStatus).toBe('outdated');
    expect(view.cardUpdate).toBe('required');
    expect(view.sharedHome).toBeNull();
    expect(announced).toHaveBeenCalled();
  });

  it('reads the verdict on a 304 and takes the home away', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verdict('ok'))
      .mockImplementation(() =>
        Promise.resolve(verdict('required', null, 304)),
      );
    const view = await sharedView(fetchMock);

    expect(view.sceneStatus).toBe('ready');

    await flush(view, REVALIDATE_MS);

    expect(view.sceneStatus).toBe('outdated');
    expect(view.sharedHome).toBeNull();

    await flush(view, REVALIDATE_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads the verdict on a 404', async () => {
    const view = await sharedView(
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(verdict('required', { error: 'Not found' }, 404)),
        ),
    );

    expect(view.sceneStatus).toBe('outdated');
  });

  it('still says the link could not be read when the 404 carries no verdict', async () => {
    const view = await sharedView(
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(verdict(null, { error: 'Not found' }, 404)),
        ),
    );

    expect(view.sceneStatus).toBe('missing');
    expect(view.cardUpdate).toBe('ok');
  });

  it('draws the home when the verdict is unreadable', async () => {
    const view = await sharedView(
      vi.fn().mockImplementation(() => Promise.resolve(verdict('blocked'))),
    );

    expect(view.sceneStatus).toBe('ready');
    expect(view.cardUpdate).toBe('ok');
  });

  it('draws no home that is newer than the card understands', async () => {
    const newer = {
      ...sharedHome,
      document: { ...home, version: home.version + 1 },
    };
    const view = await sharedView(
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(verdict('ok', { home: newer })),
        ),
    );

    expect(view.sceneStatus).toBe('outdated');
    expect(view.sharedHome).toBeNull();
  });

  it('takes the home away when a republished home is too new', async () => {
    const newer = {
      ...sharedHome,
      document: { ...home, version: home.version + 1 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verdict('ok'))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ home: newer }), {
            status: 200,
            headers: { 'content-type': 'application/json', etag: '"v2"' },
          }),
        ),
      );
    const view = await sharedView(fetchMock);

    await flush(view, REVALIDATE_MS);

    expect(view.sceneStatus).toBe('outdated');
    expect(view.sharedHome).toBeNull();
  });
});

describe('renderer mounting', () => {
  it('explains itself when the browser has no webgl', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(servedHome()));

    const view = await mountView((element) => {
      element.shareId = 'abc123';
    });

    expect(view.rendererNotice).toBe(unsupportedNotice);
  });

  it('loads the home without a renderer or a WebGL context when headless', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(servedHome()));

    const probe = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const view = await mountView((element) => {
      element.headless = true;
      element.shareId = 'abc123';
    });

    expect(view.sharedHome?.document).toEqual(home);
    expect(probe).not.toHaveBeenCalled();
    expect(view.shadowRoot?.querySelector('#stage canvas')).toBeNull();
    expect(view.rendererNotice).toBe('');
  });

  it('keeps its own stage inside the shadow root', async () => {
    const view = await mountView((element) => {
      element.shareId = '';
    });

    expect(view.shadowRoot?.querySelector('#stage')).not.toBeNull();
  });

  it('lays its stage over its own box, so the canvas never sets its height', () => {
    const rules = EstanzaSceneView.styles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(/ \.stage \{ position: absolute; inset: 0;/);
    expect(rules).not.toMatch(/ \.stage \{[^}]*height:/);
  });

  it('sizes the canvas by its layout box, so a dialog that scales in never shrinks it', () => {
    expect(CANVAS_RESIZE).toEqual({ offsetSize: true, scroll: false });
  });

  it('watches its own box so the scene resizes with the card', async () => {
    const view = await mountView((element) => {
      element.shareId = '';
    });

    expect(RecordingResizeObserver.observations[0]?.target).toBe(view);
  });

  it('stops watching once the card is removed', async () => {
    const view = await mountView((element) => {
      element.shareId = '';
    });
    const stop = vi.spyOn(RecordingResizeObserver.prototype, 'disconnect');

    view.remove();

    expect(stop).toHaveBeenCalled();
  });

  it('defaults to daylight', async () => {
    const view = await mountView(() => {});

    expect(view.night).toBe(false);
  });

  it('spills light on the floors and walls by default', async () => {
    const view = await mountView(() => {});

    expect(view.spill).toBe('wash');
  });
});
