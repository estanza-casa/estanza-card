import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  deriveFloors,
  doorLeafReaches,
  doorSwingSide,
  wallFrame,
} from '@estanza/plan-engine/geometry/geometry.js';
import {
  type CanvasState,
  drawPlan,
  drawProp,
  fitCamera,
  NO_FIT_RESERVE,
  planPalette,
  propFootprint,
  screenOf,
  silhouetteOf,
  worldOf,
} from '@estanza/plan2d';
import { tokens } from '@estanza/tokens';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { PIN_HEAD_PX, PIN_STEM_PX } from '../src/alert-view.js';
import type { SceneScope } from '../src/bindings.js';
import { type Rect, SHEET_GLIDE_MS } from '../src/camera-rig.js';
import { LONG_PRESS_MS } from '../src/gesture.js';
import {
  boxInside,
  covered,
  insidePolygon,
  type MarkBox,
} from '../src/living.js';
import { litFill, openingSpan } from '../src/plan.js';
import { EstanzaPlanView, planWords, RETILE_MS } from '../src/plan-view.js';
import { DANGER_FILL, markColour } from '../src/room-marks.js';
import {
  emptyOverlay,
  type SceneOverlay,
  type ScopeSelectDetail,
} from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { threeStoreyHome } from './storeys.js';

vi.mock('@estanza/plan2d', async (original) => {
  const real = await original<typeof import('@estanza/plan2d')>();

  return { ...real, drawPlan: vi.fn(fakeDraw), drawProp: vi.fn(real.drawProp) };
});

const WIDTH = 800;
const HEIGHT = 600;
const GLYPH_CLEARANCE_PX = 16 + 8;
const TAG_GAP_PX = 2;
const home = homeDocumentSchema.parse(homeFixture);
const floors = deriveFloors(home);
const windowed = homeDocumentSchema.parse({
  ...homeFixture,
  plan: {
    ...homeFixture.plan,
    floors: [
      {
        ...homeFixture.plan.floors[0],
        windows: [
          {
            id: 'win-north',
            wallId: 'w1',
            position: 0.5,
            width: 120,
            height: 120,
            sillHeight: 90,
          },
        ],
      },
    ],
  },
});
const windowedFloors = deriveFloors(windowed);
const stairHome = homeDocumentSchema.parse({
  ...homeFixture,
  plan: {
    ...homeFixture.plan,
    floors: [
      {
        ...homeFixture.plan.floors[0],
        stairs: [
          {
            id: 's1',
            position: { x: 0, y: -20 },
            rotation: 0,
            width: 40,
            depth: 240,
            riserCount: 12,
            stairType: 'straight',
            direction: 'up',
          },
        ],
      },
    ],
  },
});
const lowHallHome = homeDocumentSchema.parse({
  ...homeFixture,
  plan: {
    ...homeFixture.plan,
    floors: [
      {
        ...homeFixture.plan.floors[0],
        walls: homeFixture.plan.floors[0].walls.map((wall) => {
          if (wall.id === 'w8') {
            return {
              ...wall,
              start: { x: -200, y: 210 },
              end: { x: -200, y: 250 },
            };
          }

          if (wall.id === 'w9') {
            return {
              ...wall,
              start: { x: -200, y: 250 },
              end: { x: 200, y: 250 },
            };
          }

          if (wall.id === 'w10') {
            return {
              ...wall,
              start: { x: 200, y: 250 },
              end: { x: 200, y: 210 },
            };
          }

          return wall;
        }),
      },
    ],
  },
});

const lowHallWindowed = homeDocumentSchema.parse({
  ...lowHallHome,
  plan: {
    ...lowHallHome.plan,
    floors: [
      {
        ...lowHallHome.plan.floors[0],
        windows: [
          {
            id: 'hall-window',
            wallId: 'w9',
            position: 0.5,
            width: 120,
            height: 120,
            sillHeight: 90,
          },
        ],
      },
    ],
  },
});
const smallPanes = homeDocumentSchema.parse({
  ...homeFixture,
  plan: {
    ...homeFixture.plan,
    floors: [
      {
        ...homeFixture.plan.floors[0],
        windows: [
          { id: 'pane-a', wallId: 'w1', position: 0.5 },
          { id: 'pane-b', wallId: 'w1', position: 0.58 },
        ].map((pane) => ({ ...pane, width: 30, height: 120, sillHeight: 90 })),
      },
    ],
  },
});

function withDesk(
  at: { x: number; y: number },
  width: number,
  depth: number,
): HomeDocument {
  return homeDocumentSchema.parse({
    ...homeFixture,
    additions: {
      ...homeFixture.additions,
      props: [
        {
          slug: 'desk',
          type: 'catalog',
          catalogId: 'desk',
          room: 'living-space',
          at: [at.x, at.y],
          rotation: 0,
          width,
          depth,
        },
      ],
    },
  });
}

type Canvas2d = CanvasRenderingContext2D;

function fakeContext(spies: Record<string, unknown> = {}): Canvas2d {
  const store: Record<string | symbol, unknown> = { ...spies };

  return new Proxy(store, {
    get: (target, key) =>
      key in target ? target[key] : () => ({ addColorStop: () => undefined }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as Canvas2d;
}

function fakeDraw(
  ctx: Canvas2d,
  view: Parameters<typeof drawPlan>[1],
): CanvasState {
  const points = view.floors.flatMap((floor) =>
    floor.rooms.flatMap((room) => room.poly),
  );
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const cs = {
    ctx,
    width: view.width,
    height: view.height,
    zoom: Math.min(view.width / spanX, view.height / spanY) * 0.8,
    camX: (Math.max(...xs) + Math.min(...xs)) / 2,
    camY: (Math.max(...ys) + Math.min(...ys)) / 2,
    palette: view.palette,
    units: view.units,
    words: view.words,
    labels: [],
  } as unknown as CanvasState;

  view.overlay?.(cs);

  return cs;
}

class QuietResizeObserver {
  static callbacks: (() => void)[] = [];

  constructor(callback: () => void) {
    QuietResizeObserver.callbacks.push(callback);
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

function strokesOf(): unknown[] {
  const strokes: unknown[] = [];

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      fakeContext({
        stroke(this: Canvas2d) {
          strokes.push(this.strokeStyle);
        },
      }) as never,
  );

  return strokes;
}

function lit(): SceneOverlay['lights'][string] {
  return { on: true, brightness: 1, color: '#ffd4ab' };
}

function lastView(): Parameters<typeof drawPlan>[1] {
  const calls = vi.mocked(drawPlan).mock.calls;

  return calls[calls.length - 1][1];
}

function gardenDrawn(): string[] {
  return vi.mocked(drawProp).mock.calls.map(([, item]) => item.slug);
}

type Drawn = {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  font: unknown;
  alpha: unknown;
  composite: unknown;
};

function recorded(): Drawn[] {
  const drawn: Drawn[] = [];

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const saved: Record<string | symbol, unknown>[] = [];
    const state: Record<string | symbol, unknown> = {
      save: () => saved.push({ ...state }),
      restore: () => Object.assign(state, saved.pop()),
      fillStyle: '',
      strokeStyle: '',
      font: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      measureText: (text: string) => ({ width: text.length * 7 }),
    };

    return new Proxy(state, {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args: unknown[]) => {
              drawn.push({
                name: String(key),
                args,
                fillStyle: target.fillStyle,
                strokeStyle: target.strokeStyle,
                font: target.font,
                alpha: target.globalAlpha,
                composite: target.globalCompositeOperation,
              });

              return { addColorStop: () => undefined };
            },
      set: (target, key, value) => {
        target[key] = value;

        return true;
      },
    }) as never;
  });

  return drawn;
}

function sized(element: EstanzaPlanView, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: height,
  });
}

async function mountPlan(
  apply: (element: EstanzaPlanView) => void = () => undefined,
): Promise<EstanzaPlanView> {
  const element = document.createElement('estanza-plan-view');

  element.home = home;
  element.floors = floors;
  element.targets = [
    { type: 'room', id: 'hall' },
    { type: 'room', id: 'bathroom' },
    { type: 'light', id: 'hall-light' },
  ];
  sized(element, WIDTH, HEIGHT);
  apply(element);
  document.body.append(element);
  await element.updateComplete;

  return element;
}

function marked(element: EstanzaPlanView): void {
  element.glyphs = element.targets
    .filter((scope) => scope.type !== 'room')
    .map((scope) => ({ scope, nudge: { x: 0, y: 0 } }));
}

async function change(
  element: EstanzaPlanView,
  apply: (element: EstanzaPlanView) => void,
): Promise<void> {
  apply(element);
  await element.updateComplete;
}

function screenPoint(
  element: EstanzaPlanView,
  scope: Parameters<EstanzaPlanView['anchorOf']>[0],
): { x: number; y: number } {
  const at = element.anchorOf(scope);

  if (!at) throw new Error(`${scope.type}:${scope.id} is not on the plan`);

  return at;
}

function flightBox(element: EstanzaPlanView): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const results = vi.mocked(drawPlan).mock.results;
  const cs = results[results.length - 1].value as CanvasState;
  const centre = screenOf(cs, 0, -20);

  return {
    x: centre.x + element.shift.x,
    y: centre.y + element.shift.y,
    width: 40 * cs.zoom,
    height: 240 * cs.zoom,
  };
}

function onPlan(
  element: EstanzaPlanView,
  x: number,
  y: number,
): { x: number; y: number } {
  const results = vi.mocked(drawPlan).mock.results;
  const at = screenOf(results[results.length - 1].value as CanvasState, x, y);

  return { x: at.x + element.shift.x, y: at.y + element.shift.y };
}

function pointer(
  element: EstanzaPlanView,
  type: string,
  at: { x: number; y: number },
  button = 0,
): MouseEvent {
  const event = new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    button,
    bubbles: true,
    cancelable: true,
  });

  element.shadowRoot?.querySelector('canvas')?.dispatchEvent(event);

  return event;
}

function rightClick(
  element: EstanzaPlanView,
  at: { x: number; y: number },
): MouseEvent {
  pointer(element, 'pointerdown', at, 2);

  const menu = pointer(element, 'contextmenu', at, 2);

  pointer(element, 'pointerup', at, 2);

  return menu;
}

function selections(element: EstanzaPlanView): ScopeSelectDetail[] {
  const seen: ScopeSelectDetail[] = [];

  element.addEventListener('scope-select', (event) =>
    seen.push((event as CustomEvent<ScopeSelectDetail>).detail),
  );

  return seen;
}

beforeEach(() => {
  QuietResizeObserver.callbacks = [];
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as never,
  );
  vi.mocked(drawPlan).mockClear();
  vi.mocked(drawProp).mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('drawing the plan', () => {
  it('draws the plan onto its own canvas at the device pixel ratio', async () => {
    vi.stubGlobal('devicePixelRatio', 2);

    const element = await mountPlan();
    const canvas = element.shadowRoot?.querySelector('canvas');

    expect(drawPlan).toHaveBeenCalledTimes(1);
    expect(canvas?.width).toBe(WIDTH * 2);
    expect(canvas?.height).toBe(HEIGHT * 2);
    expect(lastView()).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      labels: false,
      fit: 'building',
      fitPaddingCm: 200,
    });
  });

  it('draws the door leaves in the muted plan ink', async () => {
    await mountPlan();

    expect(lastView().neutralDoorLeaves).toBe(true);
  });

  it('draws the door leaves of a still plan in the muted plan ink too', async () => {
    await mountPlan((view) => {
      view.still = true;
    });

    expect(lastView().neutralDoorLeaves).toBe(true);
  });

  it('writes the stair words of a still plan at the small room name size', async () => {
    await mountPlan((view) => {
      view.still = true;
    });

    expect(lastView().stairWordSize).toBe(10);
  });

  it('leaves the stair words of a live plan to scale with the zoom', async () => {
    await mountPlan();

    expect(lastView().stairWordSize).toBeUndefined();
  });

  it('draws a still plan without furniture or fittings, fitted closer', async () => {
    const furnished = homeDocumentSchema.parse({
      ...homeFixture,
      additions: {
        ...homeFixture.additions,
        props: [
          {
            slug: 'hall-rug',
            type: 'catalog',
            catalogId: 'runner_rug',
            room: 'hall',
            at: [100, 100],
            rotation: 0,
          },
        ],
      },
    });

    await mountPlan((view) => {
      view.home = furnished;
      view.still = true;
    });

    expect(lastView().home.additions.props).toEqual([]);
    expect(lastView().home.additions.lights).toEqual([]);
    expect(lastView().words).toEqual(planWords);
    expect(lastView().fitPaddingCm).toBeLessThan(200);
  });

  it('draws every garden piece beside the furniture', async () => {
    const garden = homeDocumentSchema.parse({
      ...homeFixture,
      additions: {
        ...homeFixture.additions,
        props: [
          {
            slug: 'hall-rug',
            type: 'catalog',
            catalogId: 'runner_rug',
            room: 'hall',
            at: [100, 100],
            rotation: 0,
          },
          ...[
            ['oak', 'outdoor_tree_oak'],
            ['bush', 'outdoor_plant_bushLarge'],
            ['rock', 'outdoor_rock_largeA'],
            ['fence', 'outdoor_fence_simple'],
            ['patio-table', 'dining_table'],
          ].map(([slug, catalogId], index) => ({
            slug,
            type: 'catalog',
            catalogId,
            at: [-340, -150 + index * 90],
            rotation: 0,
            width: 50,
            depth: 50,
          })),
        ],
      },
    });

    const element = await mountPlan((view) => {
      view.home = garden;
    });

    expect(lastView().home.additions.props.map((prop) => prop.slug)).toEqual([
      'hall-rug',
    ]);
    expect(gardenDrawn()).toEqual([
      'oak',
      'bush',
      'rock',
      'fence',
      'patio-table',
    ]);
    expect(element.furnitureBoxes()).toHaveLength(6);
  });

  it('draws the trees, bushes, rocks and plants of Casa Aurora with their plan symbols', async () => {
    const auroraHome = homeDocumentSchema.parse(aurora);
    const planted = auroraHome.additions.props.filter((prop) =>
      /^outdoor_(tree|plant|rock)/.test(String(prop.catalogId)),
    );

    recorded();
    await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = deriveFloors(auroraHome);
      view.active = 'f1';
      sized(view, 2400, 1800);
    });

    expect(planted.length).toBeGreaterThan(0);
    expect(planted.filter((prop) => silhouetteOf(prop) === null)).toEqual([]);
    expect(gardenDrawn().length).toBeGreaterThan(0);
  });

  it('draws a garden piece at the footprint the scene gives it, and none cut by the edge of the stage', async () => {
    const auroraHome = homeDocumentSchema.parse(aurora);
    const element = await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = deriveFloors(auroraHome);
      view.active = 'f1';
      sized(view, 390, 520);
    });
    const boxes = element.furnitureBoxes();

    expect(boxes.length).toBeGreaterThan(0);

    for (const box of boxes) {
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width / 2).toBeLessThanOrEqual(390);
      expect(box.y - box.height / 2).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height / 2).toBeLessThanOrEqual(520);
    }

    for (const [, item] of vi.mocked(drawProp).mock.calls) {
      expect(propFootprint(item)).toEqual([item.width, item.depth]);
    }
  });

  it('draws nothing while it has no size', async () => {
    await mountPlan((element) => sized(element, 0, 0));

    expect(drawPlan).not.toHaveBeenCalled();
  });

  it('draws a door with no sensor closed, even one the home saved open', async () => {
    const saved = homeDocumentSchema.parse({
      ...homeFixture,
      overrides: {
        ...homeFixture.overrides,
        doors: { d1: { open: 1, type: 'sliding' }, d2: { open: 1 } },
      },
    });

    await mountPlan((view) => {
      view.home = saved;
      view.floors = deriveFloors(saved);
    });

    const doors = lastView().floors.flatMap((floor) => floor.floor.doors);

    expect(doors.map((door) => [door.id, door.open])).toEqual([
      ['d1', 0],
      ['d2', 0],
    ]);
  });

  it('draws a door open as far as its sensor reads', async () => {
    await mountPlan((view) => {
      view.overlay = { ...emptyOverlay(), doors: { d1: 1 } };
    });

    const doors = lastView().floors.flatMap((floor) => floor.floor.doors);

    expect(doors.map((door) => [door.id, door.open])).toEqual([
      ['d1', 0.8],
      ['d2', 0],
    ]);
  });

  it('hands the plan every door at its live open share, a shut one at 0', async () => {
    await mountPlan((view) => {
      view.overlay = { ...emptyOverlay(), doors: { d1: 1 } };
    });

    expect([...(lastView().openFractions ?? [])]).toEqual([
      ['d1', 0.8],
      ['d2', 0],
    ]);
  });

  it('draws on the light or the dark paper it is given', async () => {
    const element = await mountPlan();

    expect(lastView().palette).toEqual(planPalette('light'));

    await change(element, (view) => {
      view.scheme = 'dark';
    });

    expect(lastView().palette).toEqual(planPalette('dark'));
  });

  it('keeps the paper it was given and shades the unlit rooms for the night look', async () => {
    const element = await mountPlan();

    expect(lastView().roomFills?.has('bathroom')).toBe(false);

    await change(element, (view) => {
      view.night = true;
    });

    expect(lastView().palette).toEqual(planPalette('light'));
    expect(lastView().roomFills?.has('bathroom')).toBe(true);
  });

  it('leaves the rooms in daylight on dark paper by day', async () => {
    await mountPlan((view) => {
      view.scheme = 'dark';
    });

    expect(lastView().palette).toEqual(planPalette('dark'));
    expect(lastView().roomFills?.has('bathroom')).toBe(false);
  });

  it('outlines an occupied room in the ink of its paper, not of the sun', async () => {
    const strokes: unknown[] = [];

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          stroke(this: Canvas2d) {
            strokes.push(this.strokeStyle);
          },
        }) as never,
    );

    await mountPlan((view) => {
      view.night = true;
      view.roomMarks = { hall: { occupied: true, tint: null, danger: null } };
    });

    expect(strokes).toContain(markColour(false));
    expect(strokes).not.toContain(markColour(true));
  });

  it('hands the warm fill of a lit room to the plan', async () => {
    await mountPlan((element) => {
      element.overlay = {
        ...emptyOverlay(),
        lights: { 'hall-light': lit() },
      };
    });

    expect(lastView().roomFills?.get('hall')).toBe(
      litFill('#7fa8c9', '#ffd4ab', 1),
    );
  });

  it('hands the danger fill of a room with a critical alert to the plan', async () => {
    await mountPlan((element) => {
      element.roomMarks = {
        bathroom: { occupied: false, tint: null, danger: 'room' },
      };
    });

    expect(lastView().roomFills?.get('bathroom')).toBe(DANGER_FILL);
  });

  it('keeps a wide plan clear of the corner mark by giving up width', async () => {
    await mountPlan((view) => {
      sized(view, 1600, 400);
      view.corner = 68;
    });

    expect(lastView().reserve).toMatchObject({ top: 0, right: 68 });
  });

  it('keeps a tall plan clear of the corner mark by giving up height', async () => {
    await mountPlan((view) => {
      sized(view, 400, 1600);
      view.corner = 68;
    });

    expect(lastView().reserve).toMatchObject({ top: 68, right: 0 });
  });

  it('keeps the reserve it is given while no corner mark shows', async () => {
    await mountPlan((view) => {
      view.reserve = { top: 10, right: 0, bottom: 0, left: 112 };
    });

    expect(lastView().reserve).toEqual(
      expect.objectContaining({ top: 10, left: 112 }),
    );
  });

  it('fits a tall card below the controls it is kept clear of', async () => {
    await mountPlan((view) => {
      sized(view, 390, 504);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });

    expect(lastView().reserve).toEqual(
      expect.objectContaining({ top: 124, right: 0, left: 0 }),
    );
  });

  it('grows a plan on a portrait card out to the side margins', async () => {
    await mountPlan((view) => {
      sized(view, 390, 700);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });

    const wallSpan = 720;
    const across = 390 - 2 * 16;

    expect(lastView().reserve).toMatchObject({ top: 124, left: 0, right: 0 });
    expect(lastView().fitPaddingCm).toBeCloseTo(
      (2 * 16 * wallSpan) / across,
      1,
    );
  });

  it('keeps the wider margin around a plan on a landscape card', async () => {
    await mountPlan((view) => {
      sized(view, 1280, 700);
    });

    expect(lastView().fitPaddingCm).toBe(200);
  });

  it('fits a wide card beside the controls it is kept clear of', async () => {
    await mountPlan((view) => {
      sized(view, 1600, 400);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 300 }];
    });

    expect(lastView().reserve).toEqual(
      expect.objectContaining({ top: 0, bottom: 0, left: 110 }),
    );
  });

  it('still keeps clear of the corner mark beside the controls', async () => {
    await mountPlan((view) => {
      sized(view, 1600, 400);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 300 }];
      view.corner = 68;
    });

    const { reserve } = lastView();

    expect(reserve).toEqual(
      expect.objectContaining({ top: 0, bottom: 0, left: 110 }),
    );
    expect(reserve?.right).toBeGreaterThanOrEqual(68);
  });

  it('draws the storey it is given', async () => {
    const stack = threeStoreyHome();
    const element = await mountPlan((view) => {
      view.home = stack;
      view.floors = deriveFloors(stack);
      view.active = 'ufloor';
    });

    expect(lastView().active).toBe('ufloor');

    await change(element, (view) => {
      view.active = 'bfloor';
    });

    expect(lastView().active).toBe('bfloor');
  });

  it('draws no accent line along an open window, leaving its state to the mark', async () => {
    const strokes = strokesOf();

    await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
      view.overlay = { ...emptyOverlay(), windows: { 'win-north': 1 } };
    });

    expect(strokes).not.toContain(tokens.themes.light.accent);
  });

  it('draws a shut window with no accent at all', async () => {
    const strokes = strokesOf();

    await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
      view.overlay = { ...emptyOverlay(), windows: { 'win-north': 0 } };
    });

    expect(strokes).not.toContain(tokens.themes.light.accent);
  });

  it('hands the plan a window at its live open share, a shut one at 0', async () => {
    await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
      view.overlay = { ...emptyOverlay(), windows: { 'win-north': 0.5 } };
    });

    const fractions = lastView().openFractions;
    const panes = windowedFloors.flatMap((floor) => floor.floor.windows);

    expect(fractions?.get('win-north')).toBe(0.5);
    expect(
      panes
        .filter((pane) => pane.id !== 'win-north')
        .map((pane) => fractions?.get(pane.id)),
    ).toEqual(panes.filter((pane) => pane.id !== 'win-north').map(() => 0));
  });

  it('draws no accent line along an open door on dark paper either', async () => {
    const strokes = strokesOf();

    await mountPlan((view) => {
      view.scheme = 'dark';
      view.overlay = { ...emptyOverlay(), doors: { d1: 0.6 } };
    });

    expect(strokes).not.toContain(tokens.themes.dark.accent);
  });

  it('marks an open window just inside its room, clear of the line along the wall', async () => {
    const element = await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
      view.overlay = { ...emptyOverlay(), windows: { 'win-north': 1 } };
    });
    const at = screenPoint(element, { type: 'window', id: 'win-north' });
    const ring =
      element.roomFootprints(['living-space']).get('living-space')?.floor ?? [];
    const wall = Math.min(...ring.map((point) => point.y));

    expect(insidePolygon(at, ring)).toBe(true);
    expect(at.y - wall).toBeGreaterThanOrEqual(14);
  });

  it('marks a shut window on its wall', async () => {
    const element = await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
    });
    const at = screenPoint(element, { type: 'window', id: 'win-north' });
    const ring =
      element.roomFootprints(['living-space']).get('living-space')?.floor ?? [];
    const wall = Math.min(...ring.map((point) => point.y));

    expect(Math.abs(at.y - wall)).toBeLessThan(1);
  });

  it('keeps a room name out from under an alert pin', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 60 }) }) as never,
    );

    const element = await mountPlan();
    const [name] = element.wordBoxes();

    expect(name).toBeDefined();

    const pin = { x: name.x, y: name.y, width: 40, height: 62 };

    await change(element, (view) => {
      view.covers = [pin];
    });

    expect(covered(pin, element.wordBoxes())).toBe(false);
  });

  it('keeps a room name off the swing of an open door', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 40 }) }) as never,
    );

    const element = await mountPlan((view) => {
      view.overlay = { ...emptyOverlay(), doors: { d2: 1 } };
    });
    const name = element.wordBoxes().find((box) => box.key === 'name:hall');

    expect(name).toBeDefined();
    expect(
      element.keepClearBoxes().filter((box) => name && covered(box, [name])),
    ).toEqual([]);
  });

  it('keeps a room name off the outline of a stair', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 60 }) }) as never,
    );

    const element = await mountPlan((view) => {
      view.home = stairHome;
      view.floors = deriveFloors(stairHome);
    });
    const name = element
      .wordBoxes()
      .find((box) => box.key === 'name:living-space');

    expect(name).toBeDefined();
    expect(
      covered(name ?? { x: 0, y: 0, width: 0, height: 0 }, [
        flightBox(element),
      ]),
    ).toBe(false);
  });

  it('reports the outline of each stair it draws', async () => {
    const element = await mountPlan((view) => {
      view.home = stairHome;
      view.floors = deriveFloors(stairHome);
    });

    expect(element.stairBoxes()).toEqual([flightBox(element)]);
  });

  it('moves a room name off furniture when a clear spot is near', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 60 }) }) as never,
    );

    const bare = await mountPlan();
    const before = bare
      .wordBoxes()
      .find((box) => box.key === 'name:living-space');
    const results = vi.mocked(drawPlan).mock.results;
    const cs = results[results.length - 1].value as CanvasState;

    bare.remove();

    if (!before) throw new Error('the living space has no name');

    const at = {
      x: (before.x - WIDTH / 2) / cs.zoom + cs.camX,
      y: (before.y - HEIGHT / 2) / cs.zoom + cs.camY,
    };
    const desked = withDesk(at, 100, 30);
    const element = await mountPlan((view) => {
      view.home = desked;
      view.floors = deriveFloors(desked);
    });
    const [desk] = element.furnitureBoxes();
    const after = element
      .wordBoxes()
      .find((box) => box.key === 'name:living-space');

    expect(desk).toBeDefined();
    expect(after).toBeDefined();
    expect(covered(after ?? before, [desk])).toBe(false);
    expect(
      Math.hypot((after?.x ?? 0) - before.x, (after?.y ?? 0) - before.y),
    ).toBeLessThan(60);
  });

  it('keeps a room name on furniture that fills its room', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 60 }) }) as never,
    );

    const filled = withDesk({ x: 0, y: 0 }, 500, 400);
    const element = await mountPlan((view) => {
      view.home = filled;
      view.floors = deriveFloors(filled);
    });

    expect(
      element.wordBoxes().some((box) => box.key === 'name:living-space'),
    ).toBe(true);
  });

  it('moves a name out from under an open sheet while its room still shows', async () => {
    const element = await mountPlan();
    const before = element
      .wordBoxes()
      .find((box) => box.key === 'name:living-space');

    if (!before) throw new Error('the living space has no name');

    const sheet = { ...before, width: before.width + 20, height: 80 };

    await change(element, (view) => {
      view.sheets = [sheet];
    });

    const after = element
      .wordBoxes()
      .find((box) => box.key === 'name:living-space');

    expect(element.veiled).toEqual([]);
    expect(after && covered(after, [sheet])).toBe(false);
  });

  it('leaves out the name of a room an open sheet mostly covers and keeps its place', async () => {
    const written: string[] = [];

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          measureText: (text: string) => ({ width: text.length * 7 }),
          fillText: (text: string) => written.push(text),
        }) as never,
    );

    const element = await mountPlan();
    const before = element
      .wordBoxes()
      .find((box) => box.key === 'name:bathroom');
    const ring = element.roomFootprints(['bathroom']).get('bathroom')?.floor;

    if (!before || !ring) throw new Error('the bathroom has no name');

    const xs = ring.map((point) => point.x);
    const ys = ring.map((point) => point.y);
    const left = Math.min(...xs, before.x - before.width / 2);
    const right = Math.max(...xs, before.x + before.width / 2);
    const top = Math.min(...ys, before.y - before.height / 2);
    const bottom = Math.max(...ys, before.y + before.height / 2);

    written.length = 0;
    await change(element, (view) => {
      view.sheets = [
        {
          x: (left + right) / 2,
          y: (top + bottom) / 2,
          width: right - left,
          height: bottom - top,
        },
      ];
    });

    const after = element
      .wordBoxes()
      .find((box) => box.key === 'name:bathroom');

    expect(element.veiled).toEqual(['bathroom']);
    expect(written).not.toContain('Bathroom');
    expect(after?.x).toBeCloseTo(before.x);
    expect(after?.y).toBeCloseTo(before.y);
  });

  it('leaves the stair word to the plan and keeps names off the plate it draws', async () => {
    const written: string[] = [];

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          measureText: (text: string) => ({ width: text.length * 7 }),
          fillText: (text: string) => written.push(text),
        }) as never,
    );

    const element = await mountPlan((view) => {
      view.home = stairHome;
      view.floors = deriveFloors(stairHome);
    });
    const word = element.wordBoxes().find((box) => box.key === 'stair:s1');
    const flight = flightBox(element);

    expect(lastView().words).toEqual(planWords);
    expect(written).not.toContain('Up');
    expect(word?.x).toBeCloseTo(flight.x, 3);
    expect(word?.y).toBeCloseTo(flight.y, 3);
    expect(word?.width).toBeGreaterThan(0);
    expect(word?.height).toBeGreaterThan(0);
  });

  it('names every room clear of a mark on every thing', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          measureText: (text: string) => ({ width: text.length * 7 }),
        }) as never,
    );

    const auroraHome = homeDocumentSchema.parse(aurora);
    const auroraFloors = deriveFloors(auroraHome);
    const ground = auroraFloors.find((floor) => floor.level === 0);
    const everything = [
      ...auroraHome.additions.lights.map((light) => ({
        type: 'light' as const,
        id: light.slug,
      })),
      ...(ground?.floor.doors ?? []).map((door) => ({
        type: 'door' as const,
        id: door.id,
      })),
      ...(ground?.floor.windows ?? []).map((pane) => ({
        type: 'window' as const,
        id: pane.id,
      })),
      ...auroraHome.additions.props.map((prop) => ({
        type: 'prop' as const,
        id: prop.slug,
      })),
    ];
    const element = await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = auroraFloors;
      view.active = ground?.id ?? null;
      view.targets = everything;
      marked(view);
      sized(view, 760, 570);
    });
    const marks = everything.flatMap((scope) => {
      const at = element.anchorOf(scope);

      return at ? [{ ...at, width: 32, height: 32 }] : [];
    });
    const names = element
      .wordBoxes()
      .filter((box) => box.key.startsWith('name:'));

    expect(names.map((box) => box.key).sort()).toEqual(
      (ground?.rooms ?? []).map((room) => `name:${room.slug}`).sort(),
    );
    const near = (box: MarkBox, mark: MarkBox): boolean =>
      Math.abs(box.x - mark.x) < (box.width + mark.width) / 2 + TAG_GAP_PX &&
      Math.abs(box.y - mark.y) < (box.height + mark.height) / 2 + TAG_GAP_PX;

    expect(
      names.filter((box) => marks.some((mark) => near(box, mark))),
    ).toEqual([]);
  });

  describe('room names on Casa Aurora', () => {
    const auroraHome = homeDocumentSchema.parse(aurora);
    const auroraFloors = deriveFloors(auroraHome);
    const labels = new Map(
      auroraFloors.flatMap((floor) =>
        floor.rooms.map((room) => [room.slug, room.label] as const),
      ),
    );

    type Written = { text: string; px: number };

    function measuredContext(written: Written[]): Canvas2d {
      const pxOf = (font: unknown): number =>
        Number(/(\d+(?:\.\d+)?)px/.exec(String(font))?.[1] ?? 10);

      return fakeContext({
        font: '10px sans-serif',
        measureText(this: Canvas2d, text: string) {
          return { width: text.length * pxOf(this.font) * 0.6 };
        },
        fillText(this: Canvas2d, text: string) {
          written.push({ text, px: pxOf(this.font) });
        },
      });
    }

    async function drawAurora(
      level: number,
      width: number,
      height: number,
      dress?: (view: EstanzaPlanView) => void,
    ): Promise<{ element: EstanzaPlanView; written: Written[] }> {
      const written: Written[] = [];

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => measuredContext(written) as never,
      );
      document.body.replaceChildren();

      const floor = auroraFloors.find((one) => one.level === level);
      const element = await mountPlan((view) => {
        view.home = auroraHome;
        view.floors = auroraFloors;
        view.active = floor?.id ?? null;
        view.targets = auroraHome.additions.lights.map((light) => ({
          type: 'light' as const,
          id: light.slug,
        }));
        dress?.(view);
        marked(view);
        sized(view, width, height);
      });

      return { element, written };
    }

    const nameBoxes = (element: EstanzaPlanView) =>
      element.wordBoxes().filter((box) => box.key.startsWith('name:'));

    it('writes each name as the home stores it, never in capitals', async () => {
      const { element, written } = await drawAurora(0, 1024, 640);
      const named = nameBoxes(element).map((box) => box.key.slice(5));

      expect(named.length).toBeGreaterThan(0);
      expect(written.map((entry) => entry.text)).toEqual(
        expect.arrayContaining(named.map((slug) => labels.get(slug))),
      );
      expect(written.some((entry) => entry.text === 'LIVING ROOM')).toBe(false);
    });

    it('names every ground floor room at a desktop width', async () => {
      const { element } = await drawAurora(0, 1024, 640);
      const ground = auroraFloors.find((floor) => floor.level === 0);

      expect(
        nameBoxes(element)
          .map((box) => box.key)
          .sort(),
      ).toEqual(
        (ground?.rooms ?? []).map((room) => `name:${room.slug}`).sort(),
      );
    });

    it('names at least the larger ground floor rooms at a phone width', async () => {
      const { element } = await drawAurora(0, 358, 420);
      const keys = nameBoxes(element).map((box) => box.key);

      expect(keys).toEqual(
        expect.arrayContaining([
          'name:living-room',
          'name:kitchen',
          'name:garage',
        ]),
      );
    });

    it('names all six ground floor rooms at the scale a 390 wide card draws, with every mark and reading, each inside its room or led back into it', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const { element } = await drawAurora(0, 448, 750, (view) => {
        view.targets = [
          ...view.targets,
          ...(ground?.floor.doors ?? []).map((door) => ({
            type: 'door' as const,
            id: door.id,
          })),
          ...(ground?.floor.windows ?? []).map((pane) => ({
            type: 'window' as const,
            id: pane.id,
          })),
        ];
        view.readings = Object.fromEntries(
          (ground?.rooms ?? []).map((room) => [room.slug, '20.4°']),
        );
      });

      expect(ground?.rooms).toHaveLength(6);
      expect(
        nameBoxes(element)
          .map((box) => box.key)
          .sort(),
      ).toEqual(
        (ground?.rooms ?? []).map((room) => `name:${room.slug}`).sort(),
      );

      const rings = new Map(
        (ground?.rooms ?? []).map((room) => [
          room.slug,
          element.roomFootprints([room.slug]).get(room.slug)?.floor ?? [],
        ]),
      );
      const leads = element
        .wordBoxes()
        .filter((box) => box.key.startsWith('lead:'));

      for (const box of nameBoxes(element)) {
        const slug = box.key.slice(5);
        const lead = leads.filter((one) => one.key === `lead:${slug}`);

        if (lead.length > 0) {
          expect(
            lead.some((one) => insidePolygon(one, rings.get(slug) ?? [])),
            slug,
          ).toBe(true);

          continue;
        }

        expect(
          boxInside(box, box.width, box.height, rings.get(slug) ?? []),
          slug,
        ).toBe(true);
      }
    });

    it('never writes a name below 10 px, cut short, overlapping another or over a light', async () => {
      for (const level of [-1, 0, 1]) {
        for (const [width, height] of [
          [358, 420],
          [1024, 640],
        ]) {
          const { element, written } = await drawAurora(level, width, height);
          const boxes = nameBoxes(element);
          const lights = element.targets.flatMap((scope) => {
            const at = element.anchorOf(scope);

            return at ? [{ ...at, width: 28, height: 28 }] : [];
          });
          const names = written.filter((entry) =>
            [...labels.values()].includes(entry.text),
          );

          expect(names.length).toBe(boxes.length);

          for (const entry of names)
            expect(entry.px).toBeGreaterThanOrEqual(10);

          for (const [index, box] of boxes.entries()) {
            expect(covered(box, lights)).toBe(false);
            expect(covered(box, boxes.slice(index + 1))).toBe(false);
          }
        }
      }
    });

    it('keeps a name inside its room on furniture rather than lead it out', async () => {
      const { element } = await drawAurora(1, 358, 420);
      const suite = nameBoxes(element).find((box) => box.key === 'name:suite');
      const ring = element.roomFootprints(['suite']).get('suite')?.floor ?? [];

      expect(element.furnitureBoxes().length).toBeGreaterThan(0);
      expect(suite && insidePolygon(suite, ring)).toBe(true);
      expect(element.wordBoxes().some((box) => box.key === 'lead:suite')).toBe(
        false,
      );
    });

    it('keeps the living room name inside its room and off every mark at the scale a 390 and a 1280 wide card draws', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const openings: SceneScope[] = [
        ...(ground?.floor.doors ?? []).map((door) => ({
          type: 'door' as const,
          id: door.id,
        })),
        ...(ground?.floor.windows ?? []).map((pane) => ({
          type: 'window' as const,
          id: pane.id,
        })),
      ];
      const dress = (view: EstanzaPlanView): void => {
        view.targets = [...view.targets, ...openings];
        view.readings = Object.fromEntries(
          (ground?.rooms ?? []).map((room) => [room.slug, '20.4°']),
        );
      };

      for (const [width, height, cardZoom] of [
        [448, 750, 0.2983],
        [874, 1200, 0.5827],
      ]) {
        const { element } = await drawAurora(0, width, height, dress);
        const marks = element.targets.flatMap((scope) => {
          const at = scope.type === 'room' ? null : element.anchorOf(scope);

          return at ? [{ ...at, width: 32, height: 32 }] : [];
        });
        const ring =
          element.roomFootprints(['living-room']).get('living-room')?.floor ??
          [];
        const living = nameBoxes(element).find(
          (box) => box.key === 'name:living-room',
        );

        expect(living).toBeDefined();
        expect(
          (vi.mocked(drawPlan).mock.results.at(-1)?.value as CanvasState).zoom,
        ).toBeCloseTo(cardZoom, 3);
        expect(living && insidePolygon(living, ring)).toBe(true);
        expect(
          covered(living ?? { x: 0, y: 0, width: 0, height: 0 }, marks),
        ).toBe(false);
      }
    });

    it('sets every pill centred under its own name, clear of the lights, at the scale a 1280 wide card draws', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const { element } = await drawAurora(0, 874, 1200, (view) => {
        view.readings = Object.fromEntries(
          (ground?.rooms ?? []).map((room) => [room.slug, '20.4°']),
        );
      });
      const lights = element.targets.flatMap((scope) => {
        const at = element.anchorOf(scope);

        return at ? [{ ...at, width: 32, height: 32 }] : [];
      });
      const names = new Map(
        nameBoxes(element).map((box) => [box.key.slice(5), box]),
      );
      const pills = element.tagLabels();

      expect(lights.length).toBeGreaterThan(0);
      expect(pills.map((pill) => pill.key).sort()).toEqual(
        (ground?.rooms ?? []).map((room) => room.slug).sort(),
      );

      for (const pill of pills) {
        const name = names.get(pill.key);
        const bounds = element.tagBounds(pill.key);

        expect(pill.x, pill.key).toBeCloseTo(name?.x ?? NaN);
        expect(pill.y, pill.key).toBeGreaterThan(name?.y ?? NaN);
        expect(bounds && pill.y < bounds.bottom, pill.key).toBe(true);
        expect(
          covered({ x: pill.x, y: pill.y, width: 1, height: 1 }, lights),
          pill.key,
        ).toBe(false);
      }
    });

    it('at the scale a 390 wide card draws with every opening marked, keeps the study name inside its room or leads it from inside, and keeps the washroom tag off the lamp that fills its room', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const openings: SceneScope[] = [
        ...(ground?.floor.doors ?? []).map((door) => ({
          type: 'door' as const,
          id: door.id,
        })),
        ...(ground?.floor.windows ?? []).map((pane) => ({
          type: 'window' as const,
          id: pane.id,
        })),
      ];
      const dress = (view: EstanzaPlanView): void => {
        view.targets = [...view.targets, ...openings];
        view.readings = Object.fromEntries(
          (ground?.rooms ?? []).map((room) => [room.slug, '20.4°']),
        );
      };
      const { element } = await drawAurora(0, 390, 750, dress);
      const ringOf = (slug: string) =>
        (ground?.rooms.find((one) => one.slug === slug)?.poly ?? []).map(
          ([x, y]) => onPlan(element, x, y),
        );
      const study = nameBoxes(element).find((box) => box.key === 'name:study');
      const lead = element
        .wordBoxes()
        .filter((box) => box.key === 'lead:study')
        .at(-1);

      expect(study).toBeDefined();
      expect(
        lead
          ? boxInside(lead, 0, 0, ringOf('study'))
          : study &&
              boxInside(study, study.width, study.height, ringOf('study')),
      ).toBe(true);

      const washroom = ringOf('washroom');
      const lamp = element.targets.flatMap((scope) => {
        const at = ['room', 'door', 'window'].includes(scope.type)
          ? null
          : element.anchorOf(scope);

        return at && boxInside(at, 0, 0, washroom) ? [at] : [];
      });
      const ys = washroom.map((corner) => corner.y);
      const smallest = 10 * 1.4;

      expect(lamp.length).toBeGreaterThan(0);
      expect(
        lamp.every(
          (at) =>
            at.y - 16 - Math.min(...ys) < smallest &&
            Math.max(...ys) - at.y - 16 < smallest,
        ),
      ).toBe(true);
      const named = nameBoxes(element).find(
        (box) => box.key === 'name:washroom',
      );

      expect(
        named &&
          covered(
            named,
            lamp.map((at) => ({ ...at, width: 32, height: 32 })),
          ),
      ).toBe(false);
    });

    it('stands the pin of a door or window on the opening it names', async () => {
      const { element } = await drawAurora(0, 390, 520);
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const scopes: SceneScope[] = [
        ...(ground?.floor.doors ?? []).map((door) => ({
          type: 'door' as const,
          id: door.id,
        })),
        ...(ground?.floor.windows ?? []).map((pane) => ({
          type: 'window' as const,
          id: pane.id,
        })),
      ];
      const pins = element.pinAnchors(scopes);

      expect(pins.size).toBe(scopes.length);

      for (const scope of scopes) {
        const span = openingSpan(auroraFloors, ground?.id ?? null, scope);
        const pin = pins.get(`${scope.type}:${scope.id}`);
        const opening = span ? onPlan(element, span.at[0], span.at[1]) : null;

        expect(
          pin && opening
            ? Math.hypot(pin.x - opening.x, pin.y - opening.y)
            : NaN,
        ).toBeLessThan(1);
      }
    });

    it('stands the pin of a room beside its lamps, never over one', async () => {
      for (const [level, width, height] of [
        [0, 390, 520],
        [1, 390, 520],
        [1, 1024, 640],
      ]) {
        const { element } = await drawAurora(level, width, height);
        const floor = auroraFloors.find((one) => one.level === level);
        const rooms = (floor?.rooms ?? []).map((room) => ({
          type: 'room' as const,
          id: room.slug,
        }));
        const openings = auroraFloors.flatMap((one) => [
          ...one.floor.doors.map((door) => ({
            type: 'door' as const,
            id: door.id,
          })),
          ...one.floor.windows.map((pane) => ({
            type: 'window' as const,
            id: pane.id,
          })),
        ]);
        element.targets = [...element.targets, ...rooms, ...openings];

        const pins = element.pinAnchors(rooms);

        element.targets = rooms;
        const lamps = auroraHome.additions.lights.flatMap((light) => {
          const at = element.anchorOf({ type: 'light', id: light.slug });

          return at ? [at] : [];
        });

        for (const room of rooms) {
          const tip = pins.get(`room:${room.id}`);

          expect(tip).toBeDefined();

          if (!tip) continue;

          const body = {
            left: tip.x - PIN_HEAD_PX / 2 - GLYPH_CLEARANCE_PX,
            right: tip.x + PIN_HEAD_PX / 2 + GLYPH_CLEARANCE_PX,
            top: tip.y - PIN_HEAD_PX - PIN_STEM_PX - GLYPH_CLEARANCE_PX,
            bottom: tip.y + GLYPH_CLEARANCE_PX,
          };
          const under = lamps.filter(
            (lamp) =>
              lamp.x > body.left &&
              lamp.x < body.right &&
              lamp.y > body.top &&
              lamp.y < body.bottom,
          );

          expect(under, `${room.id} at ${width}`).toEqual([]);
          expect(element.pickAt(tip)).toEqual(room);
        }
      }
    });

    it('stands the whole pin of a room inside the room wherever the room is big enough to hold it', async () => {
      for (const [level, width, height] of [
        [0, 390, 520],
        [1, 390, 520],
        [0, 1024, 640],
        [1, 1024, 640],
      ]) {
        const { element } = await drawAurora(level, width, height);
        const floor = auroraFloors.find((one) => one.level === level);
        const rooms = (floor?.rooms ?? []).map((room) => ({
          type: 'room' as const,
          id: room.slug,
        }));

        element.targets = [...element.targets, ...rooms];

        const pins = element.pinAnchors(rooms);
        const body = PIN_HEAD_PX + PIN_STEM_PX;

        for (const room of floor?.rooms ?? []) {
          const ring = room.poly.map(([x, y]) => onPlan(element, x, y));
          const xs = ring.map((point) => point.x);
          const ys = ring.map((point) => point.y);
          const roomy =
            Math.max(...xs) - Math.min(...xs) > 3 * PIN_HEAD_PX &&
            Math.max(...ys) - Math.min(...ys) > 2 * body;
          const tip = pins.get(`room:${room.slug}`);

          if (!roomy || !tip) continue;

          expect(
            boxInside(
              { x: tip.x, y: tip.y - body / 2 },
              PIN_HEAD_PX,
              body,
              ring,
            ),
            `${room.slug} at ${width}`,
          ).toBe(true);
        }
      }
    });

    it('keeps every name off the mark of every doorway', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const scopes: SceneScope[] = [
        ...(ground?.floor.doors ?? []).map((door) => ({
          type: 'door' as const,
          id: door.id,
        })),
        ...(ground?.floor.windows ?? [])
          .filter((pane) => pane.sliding)
          .map((pane) => ({ type: 'window' as const, id: pane.id })),
      ];

      expect(scopes.some((scope) => scope.type === 'window')).toBe(true);

      for (const [width, height] of [
        [358, 420],
        [1024, 640],
      ]) {
        const { element } = await drawAurora(0, width, height, (view) => {
          view.targets = [...view.targets, ...scopes];
        });
        const doorways = scopes.flatMap((scope) => {
          const at = element.anchorOf(scope);

          return at ? [{ ...at, width: 32, height: 32 }] : [];
        });

        expect(doorways.length).toBe(scopes.length);
        expect(
          nameBoxes(element)
            .filter((box) => covered(box, doorways))
            .map((box) => box.key),
        ).toEqual([]);
      }
    });

    it('lays the garden ground out to every edge of the ground floor plan, once', async () => {
      for (const [width, height] of [
        [358, 420],
        [1024, 640],
      ]) {
        await drawAurora(0, width, height, (view) => {
          view.shift = { x: 3, y: -2 };
        });

        const cs = vi.mocked(drawPlan).mock.results.at(-1)
          ?.value as CanvasState;
        const lawns = (lastView().home.additions.groundZones ?? []).filter(
          (zone) => zone.material === 'grass',
        );
        const xs = lawns[0]?.points.map(([x]) => x) ?? [];
        const ys = lawns[0]?.points.map(([, y]) => y) ?? [];
        const corners = [
          [0, 0],
          [width, 0],
          [0, height],
          [width, height],
        ].map(([x, y]) => worldOf(cs, x - 3, y + 2));

        expect(lawns).toHaveLength(1);
        expect(lawns[0]?.floor).toBeUndefined();

        for (const corner of corners) {
          expect(corner.x).toBeGreaterThan(Math.min(...xs));
          expect(corner.x).toBeLessThan(Math.max(...xs));
          expect(corner.y).toBeGreaterThan(Math.min(...ys));
          expect(corner.y).toBeLessThan(Math.max(...ys));
        }
      }
    });

    it('lays a still ground floor on paper with no garden, as the storeys above it are', async () => {
      await drawAurora(0, 358, 420, (view) => {
        view.still = true;
      });

      expect(auroraHome.additions.groundZones.length).toBeGreaterThan(0);
      expect(lastView().home.additions.groundZones).toEqual([]);
      expect(lastView().home.additions.paths).toEqual([]);
      expect(lastView().home.additions.gardenSteps).toEqual([]);
    });

    it('reports every doorway and the swing of every open door it keeps pills off', async () => {
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const open = Object.fromEntries(
        (ground?.floor.doors ?? []).map((door) => [door.id, 1]),
      );

      for (const [width, height] of [
        [358, 420],
        [1024, 640],
      ]) {
        const { element } = await drawAurora(0, width, height, (view) => {
          view.shift = { x: 5, y: 7 };
          view.overlay = { ...emptyOverlay(), doors: open };
        });
        const cs = vi.mocked(drawPlan).mock.results.at(-1)
          ?.value as CanvasState;
        const clear = element.keepClearBoxes();
        const onCard = (x: number, y: number) => {
          const at = screenOf(cs, x, y);

          return { x: at.x + 5, y: at.y + 7, width: 1, height: 1 };
        };
        const points = (ground?.floor.doors ?? []).flatMap((door) => {
          const wall = ground?.floor.walls.find(({ id }) => id === door.wallId);
          const span = openingSpan(auroraFloors, ground?.id ?? null, {
            type: 'door',
            id: door.id,
          });

          if (!wall || !span || !ground) return [];

          const { normal } = wallFrame(wall);
          const face = doorSwingSide(wall, door, ground.roomAt);
          const reaches = doorLeafReaches(door);
          const leaf = (door.width / reaches.length) * 0.8;
          const tips = reaches.map((along) => {
            const [x, y] = along > 0 ? span.from : span.to;

            return onCard(
              x + normal[0] * face * leaf,
              y + normal[1] * face * leaf,
            );
          });

          return [onCard(span.at[0], span.at[1]), ...tips];
        });

        expect(points.length).toBeGreaterThan(0);
        expect(points.filter((point) => !covered(point, clear))).toEqual([]);
      }
    });

    it('leaves the swing of a shut door free for a pill, since the plan draws no swing there', async () => {
      const { element } = await drawAurora(0, 1024, 640);
      const cs = vi.mocked(drawPlan).mock.results.at(-1)?.value as CanvasState;
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const clear = element.keepClearBoxes();
      const tips = (ground?.floor.doors ?? []).flatMap((door) => {
        const wall = ground?.floor.walls.find(({ id }) => id === door.wallId);
        const span = openingSpan(auroraFloors, ground?.id ?? null, {
          type: 'door',
          id: door.id,
        });

        if (!wall || !span || !ground) return [];

        const { normal } = wallFrame(wall);
        const face = doorSwingSide(wall, door, ground.roomAt);
        const [x, y] = span.at;
        const at = screenOf(
          cs,
          x + normal[0] * face * door.width * 0.6,
          y + normal[1] * face * door.width * 0.6,
        );

        return [{ ...at, width: 1, height: 1 }];
      });

      expect(tips.length).toBeGreaterThan(0);
      expect(tips.filter((tip) => covered(tip, clear))).toEqual([]);
    });

    it('names every room even where neither its room nor the paper beside it can hold the name, setting it loose rather than dropping it', async () => {
      const { element, written } = await drawAurora(0, 120, 90);
      const leads = new Map(
        element
          .wordBoxes()
          .filter((box) => box.key.startsWith('lead:'))
          .map((box) => [box.key.slice(5), box]),
      );
      const rings = element.roomFootprints([...labels.keys()]);
      const astray = nameBoxes(element).filter((box) => {
        const slug = box.key.slice(5);
        const ring = rings.get(slug)?.floor ?? [];
        const lead = leads.get(slug);

        if (element.loose.includes(slug)) return false;

        return lead
          ? !insidePolygon(lead, ring)
          : !boxInside(box, box.width, box.height, ring);
      });
      const boxes = nameBoxes(element);

      expect(astray).toEqual([]);
      expect(boxes).toHaveLength(rings.size);
      expect(
        written.filter((entry) => [...labels.values()].includes(entry.text)),
      ).toHaveLength(nameBoxes(element).length);
    });

    it('writes every name of a storey at the one size, dropping none', async () => {
      const { written } = await drawAurora(0, 358, 420);
      const ground = auroraFloors.find((floor) => floor.level === 0);
      const names = written.filter((entry) =>
        [...labels.values()].includes(entry.text),
      );

      expect(names).toHaveLength(ground?.rooms.length ?? 0);
      expect(new Set(names.map((entry) => entry.px)).size).toBe(1);
    });
  });

  it('names a low room beside its light when there is no room above or below it', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext({ measureText: () => ({ width: 40 }) }) as never,
    );

    const element = await mountPlan((view) => {
      view.home = lowHallHome;
      view.floors = deriveFloors(lowHallHome);
      marked(view);
    });
    const name = element.wordBoxes().find((box) => box.key === 'name:hall');
    const light = screenPoint(element, { type: 'light', id: 'hall-light' });

    expect(name).toBeDefined();
    expect(
      Math.abs((name?.x ?? 0) - light.x) > (name?.width ?? 0) / 2 ||
        Math.abs((name?.y ?? 0) - light.y) > (name?.height ?? 0) / 2,
    ).toBe(true);
  });
});

function footprintBox(element: EstanzaPlanView, slugs: string[]) {
  const points = [...element.roomFootprints(slugs).values()].flatMap(
    (footprint) => footprint.floor,
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function fittedDraw(
  ctx: Canvas2d,
  view: Parameters<typeof drawPlan>[1],
): CanvasState {
  const ends = view.floors
    .filter((floor) => view.active === null || floor.id === view.active)
    .flatMap((floor) =>
      floor.floor.walls.flatMap((wall) => [wall.start, wall.end]),
    );
  const xs = ends.map((end) => end.x);
  const ys = ends.map((end) => end.y);
  const camera = fitCamera(
    {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
    view.width,
    view.height,
    view.fitPaddingCm ?? 0,
    4,
    view.reserve,
  );
  const cs = {
    ctx,
    width: view.width,
    height: view.height,
    ...camera,
    palette: view.palette,
    units: view.units,
    words: view.words,
    labels: [],
  } as unknown as CanvasState;

  view.overlay?.(cs);

  return cs;
}

describe('the plan in the middle of the stage', () => {
  const slugs = floors.flatMap((floor) => floor.rooms.map((room) => room.slug));

  beforeEach(() => {
    vi.mocked(drawPlan).mockImplementation(fittedDraw);
  });

  afterEach(() => {
    vi.mocked(drawPlan).mockImplementation(fakeDraw);
  });

  it('centres a phone plan in the whole stage instead of below the controls', async () => {
    const element = await mountPlan((view) => {
      sized(view, 390, 750);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });
    const box = footprintBox(element, slugs);

    expect((box.top + box.bottom) / 2).toBeCloseTo(375, 0);
    expect((box.left + box.right) / 2).toBeCloseTo(195, 0);
  });

  it('still keeps the plan below the controls when the middle would run under them', async () => {
    const element = await mountPlan((view) => {
      sized(view, 390, 520);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });
    const box = footprintBox(element, slugs);

    expect(box.top).toBeGreaterThanOrEqual(124);
  });

  it('reports where it drew the house, around every room', async () => {
    const element = await mountPlan((view) => {
      sized(view, 390, 750);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });
    const rooms = footprintBox(element, slugs);
    const house = element.houseFrame();

    expect(house).not.toBeNull();
    expect(house?.left).toBeLessThanOrEqual(rooms.left + 1);
    expect(house?.right).toBeGreaterThanOrEqual(rooms.right - 1);
    expect(house?.top).toBeLessThanOrEqual(rooms.top + 1);
    expect(house?.bottom).toBeGreaterThanOrEqual(rooms.bottom - 1);
    expect(((house?.top ?? 0) + (house?.bottom ?? 0)) / 2).toBeCloseTo(375, 0);
    expect(element.cellFrames()).toEqual([]);
  });

  it('picks the room under a point of the centred plan', async () => {
    const element = await mountPlan((view) => {
      view.targets = [{ type: 'room', id: 'hall' }];
      sized(view, 390, 750);
      view.clear = [{ left: 12, top: 12, right: 110, bottom: 124 }];
    });
    const [ring] = element.roomFootprints(['hall']).values();
    const xs = ring.floor.map((point) => point.x);
    const ys = ring.floor.map((point) => point.y);

    expect(
      element.pickAt({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      }),
    ).toEqual({ type: 'room', id: 'hall' });
  });
});

describe('every storey on the plan at once', () => {
  const stack = threeStoreyHome();
  const stackFloors = deriveFloors(stack);
  const bySlug = (floor: string) =>
    stackFloors
      .find((candidate) => candidate.id === floor)
      ?.rooms.map((room) => room.slug) ?? [];

  beforeEach(() => {
    vi.mocked(drawPlan).mockImplementation(fittedDraw);
  });

  afterEach(() => {
    vi.mocked(drawPlan).mockImplementation(fakeDraw);
  });

  async function mountAll(width: number, height: number) {
    return mountPlan((view) => {
      view.home = stack;
      view.floors = stackFloors;
      view.active = null;
      view.targets = [
        { type: 'room', id: 'hall' },
        { type: 'room', id: 'bedroom' },
        { type: 'room', id: 'cellar' },
      ];
      sized(view, width, height);
    });
  }

  function overlap(a: Rect, b: Rect): boolean {
    return (
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom
    );
  }

  it('moves the storeys into the part a docked sheet leaves free, and back, easing over the pan time', async () => {
    const element = await mountAll(1280, 700);
    const moves: boolean[] = [];
    const frames: FrameRequestCallback[] = [];
    const finish = () => frames.shift()?.(performance.now() + RETILE_MS);

    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) =>
      frames.push(run),
    );
    element.addEventListener('plan-move', (event) =>
      moves.push((event as CustomEvent<boolean>).detail),
    );
    await change(element, (view) => {
      view.beside = { ...NO_FIT_RESERVE, right: 500 };
    });

    expect(moves).toEqual([true]);

    finish();

    expect(moves).toEqual([true, false]);

    for (const floor of ['ufloor', 'f1', 'bfloor']) {
      expect(footprintBox(element, bySlug(floor)).right).toBeLessThanOrEqual(
        780,
      );
    }

    await change(element, (view) => {
      view.beside = NO_FIT_RESERVE;
    });
    finish();

    expect(moves).toEqual([true, false, true, false]);
  });

  it('draws each storey on its own, never one over another', async () => {
    await mountAll(1280, 700);

    const drawn = vi
      .mocked(drawPlan)
      .mock.calls.map(([, view]) => view.active)
      .sort();

    expect(drawn).toEqual(['bfloor', 'f1', 'ufloor']);
  });

  for (const [width, height] of [
    [1280, 700],
    [390, 750],
  ]) {
    it(`lays the storeys side by side inside a ${width} wide card, whole and apart`, async () => {
      const element = await mountAll(width, height);
      const boxes = ['ufloor', 'f1', 'bfloor'].map((floor) =>
        footprintBox(element, bySlug(floor)),
      );

      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(box.bottom).toBeLessThanOrEqual(height);
      }

      expect(overlap(boxes[0], boxes[1])).toBe(false);
      expect(overlap(boxes[1], boxes[2])).toBe(false);
      expect(overlap(boxes[0], boxes[2])).toBe(false);
    });
  }

  it('draws every storey on the same plain paper, with no lawn behind any of them', async () => {
    const auroraHome = homeDocumentSchema.parse(aurora);

    await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = deriveFloors(auroraHome);
      view.active = null;
      sized(view, 1280, 700);
    });

    const drawn = vi.mocked(drawPlan).mock.calls.slice(-3);
    const lawns = Object.fromEntries(
      drawn.map(([, view]) => [
        view.active,
        view.home.additions.groundZones.map((zone) => zone.slug),
      ]),
    );

    expect(lawns.f1).toEqual([]);
    expect(lawns.f2).toEqual([]);
    expect(lawns.f3).toEqual([]);

    for (const [, { home }] of drawn) {
      expect(home.additions.paths).toEqual([]);
      expect(
        home.additions.props.filter((prop) =>
          String(prop.catalogId).startsWith('outdoor_'),
        ),
      ).toEqual([]);
      expect(home.additions.props.length).toBeGreaterThan(0);
    }
  });

  it('names each storey above its walls, where the marks keep clear of it', async () => {
    const element = await mountAll(1280, 700);
    const names = element
      .wordBoxes()
      .filter((box) => box.key.startsWith('caption:'));

    expect(names.map((box) => box.key).sort()).toEqual([
      'caption:bfloor',
      'caption:f1',
      'caption:ufloor',
    ]);

    for (const name of names) {
      const floor = name.key.slice('caption:'.length);
      const walls = footprintBox(element, bySlug(floor));

      expect(name.y).toBeLessThan(walls.top);
    }
  });

  it('centres the name of each storey over its walls and keeps it off them', async () => {
    const element = await mountAll(1280, 700);
    const names = element
      .wordBoxes()
      .filter((box) => box.key.startsWith('caption:'));

    expect(names).toHaveLength(3);

    for (const name of names) {
      const floor = name.key.slice('caption:'.length);
      const walls = footprintBox(element, bySlug(floor));

      expect(name.x).toBeGreaterThan(walls.left);
      expect(name.x).toBeLessThan(walls.right);
      expect(name.y + name.height / 2).toBeLessThanOrEqual(walls.top);
    }
  });

  it('reports the centre and the scale it drew each storey at', async () => {
    const element = await mountAll(1280, 700);
    const cells = element.cellFrames();

    expect(cells.map((cell) => cell.floor).sort()).toEqual(
      stackFloors.map((floor) => floor.id).sort(),
    );

    const middle = (values: number[]): number =>
      (Math.min(...values) + Math.max(...values)) / 2;

    for (const cell of cells) {
      const floor = stackFloors.find((one) => one.id === cell.floor);
      const ends = floor?.floor.walls.flatMap((wall) => [wall.start, wall.end]);
      const corners = floor?.rooms.flatMap((room) => room.poly) ?? [];
      const rooms = footprintBox(element, bySlug(cell.floor));
      const walls = {
        x: middle(ends?.map((end) => end.x) ?? []),
        y: middle(ends?.map((end) => end.y) ?? []),
      };

      expect(
        cell.centre.x +
          cell.scale * (middle(corners.map(([x]) => x)) - walls.x),
      ).toBeCloseTo((rooms.left + rooms.right) / 2, 0);
      expect(
        cell.centre.y +
          cell.scale * (middle(corners.map(([, y]) => y)) - walls.y),
      ).toBeCloseTo((rooms.top + rooms.bottom) / 2, 0);
    }
  });

  it('writes no room name over the name of its storey', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          measureText: (text: string) => ({ width: text.length * 7 }),
        }) as never,
    );

    const auroraHome = homeDocumentSchema.parse(aurora);
    const element = await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = deriveFloors(auroraHome);
      view.active = null;
      view.targets = [];
      sized(view, 1024, 806);
    });
    const words = element.wordBoxes();
    const storeyNames = words.filter((box) => box.key.startsWith('caption:'));
    const roomNames = words.filter((box) => box.key.startsWith('name:'));

    expect(storeyNames).toHaveLength(3);
    expect(roomNames.length).toBeGreaterThan(0);

    for (const storey of storeyNames) {
      expect(roomNames.filter((name) => covered(name, [storey]))).toEqual([]);
    }
  });

  it('draws every storey at one scale, a narrow one too', async () => {
    const source = structuredClone(stack);
    const basement = source.plan.floors.find((floor) => floor.id === 'bfloor');
    const halved = ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y });

    for (const wall of basement?.walls ?? []) {
      wall.start = halved(wall.start);
      wall.end = halved(wall.end);
    }

    await mountPlan((view) => {
      view.home = source;
      view.floors = deriveFloors(source);
      view.active = null;
      sized(view, 390, 750);
    });

    const zooms = vi
      .mocked(drawPlan)
      .mock.results.map((result) => (result.value as CanvasState).zoom);

    expect(zooms).toHaveLength(3);

    for (const zoom of zooms) expect(zoom).toBeCloseTo(zooms[0], 6);
  });

  function tiles() {
    const { calls, results } = vi.mocked(drawPlan).mock;

    return calls
      .map(([, view], index) => {
        const cs = results[index].value as CanvasState;
        const corners = view.floors
          .filter((floor) => floor.id === view.active)
          .flatMap((floor) =>
            floor.floor.walls.flatMap((wall) => [wall.start, wall.end]),
          )
          .map((end) => screenOf(cs, end.x, end.y));
        const xs = corners.map((corner) => corner.x);
        const ys = corners.map((corner) => corner.y);

        return {
          floor: view.active,
          width: view.width,
          height: view.height,
          lead: view.reserve?.left ?? 0,
          trail: view.reserve?.right ?? 0,
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        };
      })
      .slice(-3);
  }

  function centreOf(box: Rect) {
    return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  }

  it('lays the storeys in one row on a 1280 by 700 card, top floor first', async () => {
    await rowOrder(1280, 700);
  });

  it('wraps the storeys on a square card, where two rows draw them larger than one', async () => {
    const element = await mountAll(700, 700);
    const [top, middle, bottom] = ['ufloor', 'f1', 'bfloor'].map((floor) =>
      footprintBox(element, bySlug(floor)),
    );

    expect(middle.left).toBeGreaterThan(top.right);
    expect(bottom.top).toBeGreaterThan(Math.max(top.bottom, middle.bottom));
    expect(Math.min(...zooms())).toBeGreaterThan(oneRowZoom(700, 700));
  });

  function oneRowZoom(width: number, height: number): number {
    const spans = ['ufloor', 'f1', 'bfloor'].map((id) => {
      const ends = stackFloors
        .filter((floor) => floor.id === id)
        .flatMap((floor) =>
          floor.floor.walls.flatMap((wall) => [wall.start, wall.end]),
        );
      const xs = ends.map((end) => end.x);
      const ys = ends.map((end) => end.y);

      return {
        x: Math.max(...xs) - Math.min(...xs) + 200,
        y: Math.max(...ys) - Math.min(...ys) + 200,
      };
    });
    const across = spans.reduce((sum, span) => sum + span.x, 0);

    return Math.min(
      width / across,
      (height - 28) / Math.max(...spans.map((span) => span.y)),
    );
  }

  async function rowOrder(width: number, height: number) {
    const element = await mountAll(width, height);
    const boxes = ['ufloor', 'f1', 'bfloor'].map((floor) =>
      footprintBox(element, bySlug(floor)),
    );
    const centres = boxes.map(centreOf);

    expect(centres[0].x).toBeLessThan(centres[1].x);
    expect(centres[1].x).toBeLessThan(centres[2].x);

    for (const box of boxes) expect(box.top).toBeLessThan(centres[0].y);
    for (const box of boxes) expect(box.bottom).toBeGreaterThan(centres[0].y);
  }

  it('lays the storeys in one column on a tall card, top floor first', async () => {
    const element = await mountAll(390, 1200);
    const boxes = ['ufloor', 'f1', 'bfloor'].map((floor) =>
      footprintBox(element, bySlug(floor)),
    );
    const centres = boxes.map(centreOf);

    expect(centres[0].y).toBeLessThan(centres[1].y);
    expect(centres[1].y).toBeLessThan(centres[2].y);

    for (const box of boxes) expect(box.left).toBeLessThan(centres[0].x);
    for (const box of boxes) expect(box.right).toBeGreaterThan(centres[0].x);
  });

  it('wraps the storeys onto a second row only when one row would be too small to read', async () => {
    const element = await mountAll(520, 520);
    const [top, middle, bottom] = ['ufloor', 'f1', 'bfloor'].map((floor) =>
      footprintBox(element, bySlug(floor)),
    );

    expect(middle.left).toBeGreaterThan(top.right);
    expect(bottom.top).toBeGreaterThan(Math.max(top.bottom, middle.bottom));
    expect(tiles().find((tile) => tile.floor === 'bfloor')?.width).toBe(520);
  });

  for (const [width, height] of [
    [1280, 700],
    [390, 750],
    [390, 1200],
    [700, 700],
    [520, 520],
  ]) {
    it(`fills a ${width} by ${height} card with tiles and leaves none empty`, async () => {
      await mountAll(width, height);

      const area = tiles().reduce(
        (sum, tile) => sum + tile.width * tile.height,
        0,
      );

      expect(area).toBeCloseTo(width * height, 0);
    });
  }

  for (const [width, height, left] of [
    [1280, 700, 100],
    [390, 750, 0],
    [600, 560, 100],
    [700, 700, 0],
    [520, 520, 0],
  ]) {
    it(`centres every storey across the free part of its own tile on a ${width} by ${height} card`, async () => {
      await mountPlan((view) => {
        view.home = stack;
        view.floors = stackFloors;
        view.active = null;
        view.reserve = { top: 0, right: 0, bottom: 0, left };
        sized(view, width, height);
      });

      for (const tile of tiles()) {
        expect((tile.left + tile.right) / 2).toBeCloseTo(
          (tile.lead + tile.width - tile.trail) / 2,
          0,
        );
        expect(tile.top - 28).toBeLessThanOrEqual(
          tile.height - tile.bottom + 1,
        );
      }
    });
  }

  it('lines every storey in a row up on one top edge', async () => {
    await mountAurora(1280, 805);

    const tops = tiles().map((tile) => tile.top);

    expect(tops).toHaveLength(3);

    for (const top of tops) expect(top).toBeCloseTo(tops[0], 0);
  });

  it('lays every storey out beside a sheet docked on the right', async () => {
    const sheet = { left: 992, top: 16, right: 1264, bottom: 449 };
    const element = await mountAurora(1280, 806, (view) => {
      view.clear = [{ left: 12, top: 12, right: 98, bottom: 58 }, sheet];
    });
    const auroraHome = homeDocumentSchema.parse(aurora);
    const slugs = deriveFloors(auroraHome).flatMap((floor) =>
      floor.rooms.map((room) => room.slug),
    );
    const under = [...element.roomFootprints(slugs)].flatMap(([slug, ring]) =>
      ring.floor.some(
        (point) =>
          point.x > sheet.left &&
          point.x < sheet.right &&
          point.y > sheet.top &&
          point.y < sheet.bottom,
      )
        ? [slug]
        : [],
    );

    expect(element.pages).toEqual([]);
    expect(under).toEqual([]);
  });

  it('centres a row of storeys up and down in the card, with no empty band under it', async () => {
    await mountAurora(1280, 805);

    const drawn = tiles();
    const above = Math.min(...drawn.map((tile) => tile.top - 28));
    const below = Math.min(...drawn.map((tile) => tile.height - tile.bottom));

    expect(Math.abs(above - below)).toBeLessThan(2);
  });

  it('names every Aurora room on a wide card, leading out only the long suite bathroom name', async () => {
    measuredText();

    const element = await mountAurora(1280, 805, (view) => {
      view.reserve = { top: 0, right: 0, bottom: 0, left: 100 };
    });
    const rooms = deriveFloors(homeDocumentSchema.parse(aurora)).flatMap(
      (floor) => floor.rooms.map((room) => `name:${room.slug}`),
    );
    const words = element.wordBoxes();

    expect(
      words
        .filter((box) => box.key.startsWith('name:'))
        .map((box) => box.key)
        .sort(),
    ).toEqual(rooms.sort());
    expect(
      new Set(
        words
          .filter((box) => box.key.startsWith('lead:'))
          .map((box) => box.key),
      ),
    ).toEqual(new Set(['lead:suite-bathroom']));
  });

  it('keeps the first storey clear of the controls beside it', async () => {
    const element = await mountPlan((view) => {
      view.home = stack;
      view.floors = stackFloors;
      view.active = null;
      view.reserve = { top: 0, right: 0, bottom: 0, left: 100 };
      sized(view, 1280, 700);
    });

    expect(footprintBox(element, bySlug('ufloor')).left).toBeGreaterThanOrEqual(
      100,
    );
  });

  it('picks a room on the storey drawn under the point', async () => {
    const element = await mountAll(1280, 700);

    for (const slug of ['bedroom', 'cellar', 'hall']) {
      const [ring] = element.roomFootprints([slug]).values();
      const xs = ring.floor.map((point) => point.x);
      const ys = ring.floor.map((point) => point.y);
      const middle = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };

      expect(element.pickAt(middle)).toEqual({ type: 'room', id: slug });
    }
  });

  function zooms(): number[] {
    return vi
      .mocked(drawPlan)
      .mock.results.map((result) => (result.value as CanvasState).zoom);
  }

  async function mountAurora(
    width: number,
    height: number,
    setup: (view: EstanzaPlanView) => void = () => {},
  ) {
    const auroraHome = homeDocumentSchema.parse(aurora);

    return mountPlan((view) => {
      view.home = auroraHome;
      view.floors = deriveFloors(auroraHome);
      view.active = null;
      view.targets = [];
      sized(view, width, height);
      setup(view);
    });
  }

  function measuredText(): void {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          measureText: (text: string) => ({ width: text.length * 7 }),
        }) as never,
    );
  }

  it('gives each storey a tile as wide as its plan, so the plans are drawn larger', async () => {
    await mountAurora(1280, 805);

    expect(zooms()).toHaveLength(3);
    expect(Math.min(...zooms())).toBeGreaterThan(0.35);
  });

  it('keeps every room name off the name of its storey at a wide card', async () => {
    measuredText();

    const element = await mountAurora(1280, 805);
    const words = element.wordBoxes();
    const storeyNames = words.filter((box) => box.key.startsWith('caption:'));
    const roomNames = words.filter((box) => box.key.startsWith('name:'));

    expect(storeyNames).toHaveLength(3);

    expect(roomNames.length).toBeGreaterThan(0);
    expect(
      roomNames
        .filter((name) => covered(name, storeyNames))
        .map((name) => name.key),
    ).toEqual([]);
  });

  it('keeps every room name whole inside its own tile when a sheet moves the plan', async () => {
    measuredText();

    const auroraHome = homeDocumentSchema.parse(aurora);
    const storeyOf = new Map(
      deriveFloors(auroraHome).flatMap((floor) =>
        floor.rooms.map((room) => [room.slug, floor.id] as const),
      ),
    );
    const shift = { x: -150, y: -60 };
    const element = await mountAurora(1280, 805, (view) => {
      view.shift = shift;
    });
    const drawn = tiles();
    const edges = new Map<string, { left: number; right: number }>();
    let left = 0;

    for (const tile of drawn) {
      edges.set(tile.floor ?? '', { left, right: left + tile.width });
      left += tile.width;
    }

    const names = element
      .wordBoxes()
      .filter(
        (box) =>
          box.key.startsWith('name:') &&
          !element.veiled.includes(box.key.slice(5)),
      );

    expect(names.length).toBeGreaterThan(0);

    const cut = names.filter((name) => {
      const edge = edges.get(storeyOf.get(name.key.slice(5)) ?? '');
      const shownLeft = Math.max(0, (edge?.left ?? 0) + shift.x);
      const shownRight = Math.min(1280, (edge?.right ?? 0) + shift.x);
      const left = name.x - name.width / 2;
      const right = name.x + name.width / 2;
      const whole = left >= shownLeft - 0.5 && right <= shownRight + 0.5;
      const gone = right <= shownLeft || left >= shownRight;

      return !whole && !gone;
    });

    expect(cut.map((name) => name.key)).toEqual([]);
  });

  it('keeps the lawn to the edges of the card when a sheet moves the plan', async () => {
    const rects: number[][] = [];

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        fakeContext({
          rect: (...box: number[]) => rects.push(box),
        }) as never,
    );

    await mountAurora(1280, 805, (view) => {
      view.shift = { x: 150, y: 60 };
    });

    const [first] = rects;
    const last = rects[2];
    const tile = tiles()[2];

    expect(first[0]).toBeLessThanOrEqual(-150);
    expect(first[1]).toBeLessThanOrEqual(-60);
    expect(last[0] + last[2]).toBeGreaterThanOrEqual(tile.width);
    expect(last[1] + last[3]).toBeGreaterThanOrEqual(805);
  });

  describe('on a phone', () => {
    it('shows one storey at a time, the ground floor first, and offers every storey as a page', async () => {
      const element = await mountAurora(390, 750);
      const drawn = vi
        .mocked(drawPlan)
        .mock.calls.map(([, view]) => view.active);

      expect(drawn).toEqual(['f1']);
      expect(element.pages).toEqual(['f2', 'f1', 'f3']);
      expect(element.shownPage).toBe('f1');
    });

    it('draws the chosen page as large as that floor on its own', async () => {
      await mountAurora(390, 750, (view) => {
        view.active = 'f2';
      });

      const alone = zooms()[0];

      vi.mocked(drawPlan).mockClear();

      const element = await mountAurora(390, 750, (view) => {
        view.page = 'f2';
      });

      expect(element.shownPage).toBe('f2');
      expect(zooms()).toHaveLength(1);
      expect(zooms()[0]).toBeCloseTo(alone, 6);
    });

    it('draws the lawn under the page like any single floor', async () => {
      await mountAurora(390, 750);

      expect(lastView().home.additions.groundZones[0]?.slug).toBe(
        'card-ground',
      );
    });

    it('gives no anchor to a room on another page', async () => {
      const element = await mountAurora(390, 750, (view) => {
        view.page = 'f2';
      });

      expect(element.anchorOf({ type: 'room', id: 'kitchen' })).toBeNull();
      expect(element.anchorOf({ type: 'room', id: 'bedroom' })).not.toBeNull();
    });

    it('turns to the next or the previous storey with a swipe', async () => {
      const element = await mountAurora(390, 750);
      const turned: string[] = [];

      element.addEventListener('page-change', (event) =>
        turned.push((event as CustomEvent<string>).detail),
      );

      pointer(element, 'pointerdown', { x: 300, y: 400 });
      pointer(element, 'pointerup', { x: 150, y: 420 });
      pointer(element, 'pointerdown', { x: 100, y: 400 });
      pointer(element, 'pointerup', { x: 260, y: 390 });

      expect(turned).toEqual(['f3', 'f2']);
    });

    it('treats a short or a mostly vertical drag as no swipe', async () => {
      const element = await mountAurora(390, 750);
      const turned: string[] = [];

      element.addEventListener('page-change', (event) =>
        turned.push((event as CustomEvent<string>).detail),
      );

      pointer(element, 'pointerdown', { x: 200, y: 400 });
      pointer(element, 'pointerup', { x: 180, y: 400 });
      pointer(element, 'pointerdown', { x: 200, y: 200 });
      pointer(element, 'pointerup', { x: 120, y: 500 });

      expect(turned).toEqual([]);
    });

    it('keeps the storeys side by side on a wide card, with no pages', async () => {
      const element = await mountAurora(1280, 805);

      expect(element.pages).toEqual([]);
    });
  });

  it('draws one storey alone when the home has only one', async () => {
    await mountPlan((view) => {
      view.active = null;
    });

    expect(drawPlan).toHaveBeenCalledTimes(1);
  });
});

describe('redrawing the plan', () => {
  it('does not redraw when nothing it shows has changed', async () => {
    const element = await mountPlan();

    await change(element, (view) => {
      view.overlay = { ...emptyOverlay() };
      view.targets = [...view.targets];
      view.reserve = { ...view.reserve };
    });
    QuietResizeObserver.callbacks.forEach((callback) => callback());

    expect(drawPlan).toHaveBeenCalledTimes(1);
  });

  it('redraws when a light turns on', async () => {
    const element = await mountPlan();

    await change(element, (view) => {
      view.overlay = { ...emptyOverlay(), lights: { 'hall-light': lit() } };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('redraws when a room becomes occupied', async () => {
    const element = await mountPlan();

    await change(element, (view) => {
      view.roomMarks = { hall: { occupied: true, tint: null, danger: null } };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('redraws when a door opens', async () => {
    const element = await mountPlan();
    const door = floors[0].floor.doors[0].id;

    await change(element, (view) => {
      view.overlay = { ...emptyOverlay(), doors: { [door]: 1 } };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('redraws when a window opens', async () => {
    const element = await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
    });

    await change(element, (view) => {
      view.overlay = { ...emptyOverlay(), windows: { 'win-north': 1 } };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('redraws when it is resized', async () => {
    const element = await mountPlan();

    sized(element, 640, 480);
    QuietResizeObserver.callbacks.forEach((callback) => callback());

    expect(drawPlan).toHaveBeenCalledTimes(2);
    expect(lastView()).toMatchObject({ width: 640, height: 480 });
  });

  it('redraws when the burn-in shift moves it', async () => {
    const element = await mountPlan();

    await change(element, (view) => {
      view.shift = { x: 6, y: -4 };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('does not redraw for a light, a door or a mark on another storey', async () => {
    const stack = threeStoreyHome();
    const stacked = deriveFloors(stack);
    const cellarDoor = stacked.find((floor) => floor.id === 'bfloor')?.floor
      .doors[0].id;
    const element = await mountPlan((view) => {
      view.home = stack;
      view.floors = stacked;
      view.active = 'ufloor';
    });

    await change(element, (view) => {
      view.overlay = {
        ...emptyOverlay(),
        lights: { 'cellar-light': lit() },
        doors: { [cellarDoor ?? '']: 1 },
      };
      view.roomMarks = {
        cellar: { occupied: true, tint: null, danger: 'room' },
      };
    });

    expect(drawPlan).toHaveBeenCalledTimes(1);
  });

  it('redraws when a light on its own storey changes', async () => {
    const stack = threeStoreyHome();
    const element = await mountPlan((view) => {
      view.home = stack;
      view.floors = deriveFloors(stack);
      view.active = 'ufloor';
    });

    await change(element, (view) => {
      view.overlay = {
        ...emptyOverlay(),
        lights: { 'bedroom-light': lit() },
      };
    });

    expect(drawPlan).toHaveBeenCalledTimes(2);
  });

  it('tells the card the view moved after each draw', async () => {
    const element = document.createElement('estanza-plan-view');
    const moved = vi.fn();

    element.addEventListener('view-change', moved);
    element.home = home;
    element.floors = floors;
    sized(element, WIDTH, HEIGHT);
    document.body.append(element);
    await element.updateComplete;

    expect(moved).toHaveBeenCalledTimes(1);
  });

  it('dims itself late at night', async () => {
    const element = await mountPlan((view) => {
      view.dim = true;
    });

    expect(element.hasAttribute('dim')).toBe(true);
  });
});

describe('picking on the plan', () => {
  it('picks a device glyph within its target radius', async () => {
    const element = await mountPlan();
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    expect(element.pickAt({ x: bulb.x + 20, y: bulb.y })).toEqual({
      type: 'light',
      id: 'hall-light',
    });
  });

  it('picks the room under a point clear of every glyph', async () => {
    const element = await mountPlan();
    const at = screenPoint(element, { type: 'room', id: 'bathroom' });

    expect(element.pickAt(at)).toEqual({ type: 'room', id: 'bathroom' });
  });

  it('picks nothing outside the home', async () => {
    const element = await mountPlan();

    expect(element.pickAt({ x: 1, y: 1 })).toBeNull();
  });

  it('picks nothing that is not a target', async () => {
    const element = await mountPlan((view) => {
      view.targets = [];
    });
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    expect(element.pickAt(bulb)).toBeNull();
  });

  it('picks a light where the card drew its mark, not where the plan put it', async () => {
    const element = await mountPlan();
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });
    const drawn = { x: bulb.x + 60, y: bulb.y };

    element.markSpots = {
      shown: [{ key: 'light:hall-light', ...drawn }],
      tucked: new Set(),
    };

    expect(element.pickAt(drawn)).toEqual({ type: 'light', id: 'hall-light' });
    expect(element.pickAt(bulb)).toEqual({ type: 'room', id: 'hall' });
  });

  it('hands a press on a nearer mark with nothing to do to the room under it, not to the light beside it', async () => {
    const element = await mountPlan();
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    element.markSpots = {
      shown: [
        { key: 'light:hall-light', ...bulb },
        { key: 'door:d2', x: bulb.x + 16, y: bulb.y },
      ],
      tucked: new Set(),
    };

    expect(element.pickAt({ x: bulb.x + 12, y: bulb.y })).toEqual({
      type: 'room',
      id: 'hall',
    });
    expect(element.pickAt({ x: bulb.x + 2, y: bulb.y })).toEqual({
      type: 'light',
      id: 'hall-light',
    });
  });

  it('leaves a light folded into a bubble to the bubble', async () => {
    const element = await mountPlan();
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    element.markSpots = { shown: [], tucked: new Set(['light:hall-light']) };

    expect(element.pickAt(bulb)).toEqual({ type: 'room', id: 'hall' });
  });

  it('reads a tap on a glyph as a tap on its device', async () => {
    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb);
    pointer(element, 'pointerup', bulb);

    expect(seen).toEqual([
      expect.objectContaining({
        scopeType: 'light',
        scopeId: 'hall-light',
        gesture: 'tap',
      }),
    ]);
  });

  it('reads a held press on a glyph as a press', async () => {
    vi.useFakeTimers();

    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    pointer(element, 'pointerup', bulb);

    expect(seen).toEqual([
      expect.objectContaining({ scopeId: 'hall-light', gesture: 'press' }),
    ]);
  });

  it('reads the next tap after a press whose release a dialog swallowed', async () => {
    vi.useFakeTimers();

    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    pointer(element, 'pointerdown', bulb);
    pointer(element, 'pointerup', bulb);

    expect(seen.map((detail) => detail.gesture)).toEqual(['press', 'tap']);
  });

  it('reads a tap inside a room as a tap on the room', async () => {
    const element = await mountPlan();
    const seen = selections(element);
    const at = screenPoint(element, { type: 'room', id: 'bathroom' });

    pointer(element, 'pointerdown', at);
    pointer(element, 'pointerup', at);

    expect(seen).toEqual([
      expect.objectContaining({
        scopeType: 'room',
        scopeId: 'bathroom',
        gesture: 'tap',
      }),
    ]);
  });

  it('reads a right-click on a glyph as a press and keeps the browser menu shut', async () => {
    vi.useFakeTimers();

    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });
    const menu = rightClick(element, bulb);

    vi.advanceTimersByTime(LONG_PRESS_MS + 10);

    expect(menu.defaultPrevented).toBe(true);
    expect(seen).toEqual([
      expect.objectContaining({
        scopeType: 'light',
        scopeId: 'hall-light',
        gesture: 'press',
      }),
    ]);
  });

  it('reads a right-click whose menu comes after the release as one press', async () => {
    vi.useFakeTimers();

    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb, 2);
    pointer(element, 'pointerup', bulb, 2);

    const menu = pointer(element, 'contextmenu', bulb, 2);

    vi.advanceTimersByTime(LONG_PRESS_MS + 10);

    expect(menu.defaultPrevented).toBe(true);
    expect(seen.map((detail) => detail.gesture)).toEqual(['press']);
  });

  it('never reads a right button press as a tap or a hold of its own', async () => {
    vi.useFakeTimers();

    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb, 2);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    pointer(element, 'pointerup', bulb, 2);

    expect(seen).toEqual([]);
  });

  it('opens nothing on a right-click outside the home, and keeps the browser menu shut', async () => {
    const element = await mountPlan();
    const seen = selections(element);
    const menu = rightClick(element, { x: 1, y: 1 });

    expect(menu.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
  });

  it('opens no press from a menu the keyboard or a touch hold asked for', async () => {
    const element = await mountPlan();
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });
    const menu = pointer(element, 'contextmenu', bulb);

    expect(menu.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
  });

  it('leaves the browser menu alone while it is not interactive', async () => {
    const element = await mountPlan((view) => {
      view.interactive = false;
    });
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });
    const menu = rightClick(element, bulb);

    expect(menu.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
  });

  it('ignores every touch while it is not interactive', async () => {
    const element = await mountPlan((view) => {
      view.interactive = false;
    });
    const seen = selections(element);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });

    pointer(element, 'pointerdown', bulb);
    pointer(element, 'pointerup', bulb);

    expect(seen).toEqual([]);
  });

  it('keeps a hit area at least 44px across around a light', async () => {
    const element = await mountPlan(marked);
    const bulb = screenPoint(element, { type: 'light', id: 'hall-light' });
    const light = { type: 'light', id: 'hall-light' } as const;

    for (const [dx, dy] of [
      [21, 0],
      [-21, 0],
      [0, 21],
      [0, -21],
    ]) {
      expect(element.pickAt({ x: bulb.x + dx, y: bulb.y + dy })).toEqual(light);
    }
  });

  it('grows the hit area of a window narrower than a finger to 44px along its wall', async () => {
    const element = await mountPlan((view) => {
      view.home = smallPanes;
      view.floors = deriveFloors(smallPanes);
      view.targets = [
        { type: 'room', id: 'living-space' },
        { type: 'window', id: 'pane-a' },
      ];
    });
    const pane = { type: 'window', id: 'pane-a' } as const;
    const wall = onPlan(element, 0, -210);
    const mark = screenPoint(element, pane);

    expect(element.pickAt({ x: wall.x - 21, y: wall.y })).toEqual(pane);
    expect(element.pickAt({ x: wall.x + 21, y: wall.y })).toEqual(pane);
    expect(element.pickAt({ x: mark.x, y: mark.y + 21 })).toEqual(pane);
    expect(element.pickAt({ x: wall.x + 60, y: wall.y + 30 })).toEqual({
      type: 'room',
      id: 'living-space',
    });
  });

  it('picks a long window anywhere along the line it draws on its wall', async () => {
    const element = await mountPlan((view) => {
      view.home = lowHallWindowed;
      view.floors = deriveFloors(lowHallWindowed);
      view.targets = [
        { type: 'room', id: 'hall' },
        { type: 'window', id: 'hall-window' },
      ];
    });
    const pane = { type: 'window', id: 'hall-window' } as const;

    expect(element.pickAt(onPlan(element, -55, 250))).toEqual(pane);
    expect(element.pickAt(onPlan(element, 55, 250))).toEqual(pane);
  });

  it('never lets an opening reach past the centre line of the room it opens into', async () => {
    const element = await mountPlan((view) => {
      view.home = lowHallWindowed;
      view.floors = deriveFloors(lowHallWindowed);
      view.targets = [
        { type: 'room', id: 'hall' },
        { type: 'window', id: 'hall-window' },
      ];
      marked(view);
    });
    const hall = { type: 'room', id: 'hall' } as const;
    const centre = onPlan(element, 0, 230);
    const wall = onPlan(element, 0, 250);
    const mark = screenPoint(element, { type: 'window', id: 'hall-window' });

    expect(element.pickAt(centre)).toEqual(hall);
    expect(element.pickAt({ x: centre.x, y: centre.y + 0.5 })).toEqual(hall);
    expect(element.pickAt({ x: centre.x + 40, y: centre.y - 1 })).toEqual(hall);
    expect(element.pickAt({ x: centre.x, y: centre.y + 3 })).toEqual({
      type: 'window',
      id: 'hall-window',
    });
    expect(mark.y).toBeGreaterThan(centre.y);
    expect(mark.y).toBeCloseTo(wall.y, 6);
  });

  it('opens the room, not its door, at the centre of a narrow hall', async () => {
    const element = await mountPlan((view) => {
      view.home = lowHallHome;
      view.floors = deriveFloors(lowHallHome);
      view.targets = [
        { type: 'room', id: 'hall' },
        { type: 'room', id: 'living-space' },
        { type: 'door', id: 'd2' },
      ];
    });

    expect(element.pickAt(onPlan(element, 0, 230))).toEqual({
      type: 'room',
      id: 'hall',
    });
    expect(element.pickAt(onPlan(element, 0, 212))).toEqual({
      type: 'door',
      id: 'd2',
    });
  });

  it('gives an overlapped tap to the nearer of two marks', async () => {
    const element = await mountPlan((view) => {
      view.home = smallPanes;
      view.floors = deriveFloors(smallPanes);
      view.targets = [
        { type: 'window', id: 'pane-a' },
        { type: 'window', id: 'pane-b' },
      ];
    });
    const a = screenPoint(element, { type: 'window', id: 'pane-a' });
    const b = screenPoint(element, { type: 'window', id: 'pane-b' });
    const gap = b.x - a.x;

    expect(gap).toBeLessThan(44);
    expect(element.pickAt({ x: a.x + gap * 0.4, y: a.y })).toEqual({
      type: 'window',
      id: 'pane-a',
    });
    expect(element.pickAt({ x: a.x + gap * 0.6, y: a.y })).toEqual({
      type: 'window',
      id: 'pane-b',
    });
  });

  it('measures the nearness of an opening from the line it draws on its wall', async () => {
    const lamp = homeDocumentSchema.parse({
      ...windowed,
      additions: {
        ...windowed.additions,
        lights: [
          {
            slug: 'reading-lamp',
            room: 'living-space',
            style: 'flush',
            color: '#ffd4ab',
            on: true,
            at: [55, -190],
          },
        ],
      },
    });
    const element = await mountPlan((view) => {
      view.home = lamp;
      view.floors = windowedFloors;
      view.targets = [
        { type: 'window', id: 'win-north' },
        { type: 'light', id: 'reading-lamp' },
      ];
    });
    const bulb = screenPoint(element, { type: 'light', id: 'reading-lamp' });
    const onWall = onPlan(element, 55, -210);

    expect(Math.hypot(bulb.x - onWall.x, bulb.y - onWall.y)).toBeLessThan(22);
    expect(element.pickAt(onWall)).toEqual({ type: 'window', id: 'win-north' });
    expect(element.pickAt(bulb)).toEqual({
      type: 'light',
      id: 'reading-lamp',
    });
  });

  it('finds the outline of a room on screen', async () => {
    const element = await mountPlan();

    expect(element.outlineOf({ type: 'room', id: 'hall' })?.fill).toMatch(
      /^M.*Z$/,
    );
    expect(element.roomFootprints(['hall']).get('hall')?.floor.length).toBe(
      floors[0].roomsBySlug.get('hall')?.poly.length,
    );
  });
});

describe('the paper and the marks of the plan', () => {
  it('draws the ground floor on its lawn and every storey above or below it on plain paper', async () => {
    const auroraHome = homeDocumentSchema.parse(aurora);
    const auroraFloors = deriveFloors(auroraHome);
    const lawn = () =>
      lastView().home.additions.groundZones.map((zone) => zone.slug);
    const element = await mountPlan((view) => {
      view.home = auroraHome;
      view.floors = auroraFloors;
      view.active = 'f1';
    });

    expect(lawn()).toContain('card-ground');

    const others = auroraFloors.filter((floor) => floor.level !== 0);

    expect(others).toHaveLength(2);

    for (const floor of others) {
      await change(element, (view) => {
        view.active = floor.id;
      });

      expect(lawn()).toEqual([]);
      expect(lastView().home.additions.paths).toEqual([]);
      expect(lastView().home.additions.gardenSteps).toEqual([]);
    }
  });

  it('leaves doorways on dark paper to the plan, with no second coat over them', async () => {
    const drawn = recorded();
    const element = await mountPlan((view) => {
      view.home = windowed;
      view.floors = windowedFloors;
    });

    await change(element, (view) => {
      view.scheme = 'dark';
    });

    expect(lastView().palette.opening).toBe(planPalette('dark').opening);
    expect(drawn.filter((call) => call.composite === 'lighten')).toEqual([]);
  });

  it('carries the grid across the whole stage when a sheet shifts the plan', async () => {
    const drawn = recorded();

    await mountPlan((view) => {
      view.shift = { x: -95, y: 0 };
    });

    const behind = drawn.filter(
      (call) => call.composite === 'destination-over',
    );

    expect(
      behind.some(
        (call) =>
          call.name === 'moveTo' &&
          Number(call.args[0]) > WIDTH - 95 &&
          Number(call.args[0]) < WIDTH,
      ),
    ).toBe(true);
    expect(
      behind.some(
        (call) =>
          call.name === 'fillRect' &&
          call.fillStyle === planPalette('light').page,
      ),
    ).toBe(true);
  });

  it('highlights the room whose sheet is open, not only its pill', async () => {
    const drawn = recorded();
    const accent = planPalette('light').accent;
    const ringed = () =>
      drawn.some(
        (call) => call.name === 'stroke' && call.strokeStyle === accent,
      );
    const element = await mountPlan();

    expect(ringed()).toBe(false);

    await change(element, (view) => {
      view.selected = 'hall';
    });

    expect(ringed()).toBe(true);
  });

  it('fills a room with a critical alert in a clear red over its floor', async () => {
    const drawn = recorded();

    await mountPlan((view) => {
      view.roomMarks = {
        bathroom: { occupied: false, tint: null, danger: 'room' },
      };
    });

    expect(
      drawn.some(
        (call) =>
          call.name === 'fill' &&
          call.fillStyle === DANGER_FILL &&
          Number(call.alpha) >= 0.5,
      ),
    ).toBe(true);
  });

  it('sets every name once for where a moving plan will settle, and keeps it there when the move ends', async () => {
    vi.useFakeTimers();
    recorded();

    const probe = await mountPlan((view) => {
      sized(view, 390, 520);
    });
    const hall = probe.wordBoxes().find((box) => box.key === 'name:hall');

    if (!hall) throw new Error('the hall has no name');

    const move = hall.width + 20;
    const control = { ...hall, x: hall.x + move };

    document.body.replaceChildren();

    const element = await mountPlan((view) => {
      sized(view, 390, 520);
      view.covers = [control];
    });
    await change(element, (view) => {
      view.shift = { x: move, y: 0 };
    });

    const moving = element.wordBoxes();
    const hallMoving = moving.find((box) => box.key === 'name:hall');

    expect(element.veiled).not.toContain('hall');
    expect(hallMoving && covered(hallMoving, [control])).toBe(false);

    await vi.advanceTimersByTimeAsync(SHEET_GLIDE_MS);

    expect(element.veiled).not.toContain('hall');
    expect(element.wordBoxes()).toEqual(moving);
  });

  it('paints past its edges while a sheet glides it, so the glide never shows the stage behind, and trims back once the move settles', async () => {
    vi.useFakeTimers();

    const drawn = recorded();
    const element = await mountPlan((view) => {
      sized(view, 390, 520);
    });
    const canvas = element.shadowRoot?.querySelector('canvas');

    drawn.length = 0;
    await change(element, (view) => {
      view.shift = { x: -60, y: 40 };
    });

    expect(element.hasAttribute('overscan')).toBe(true);
    expect([canvas?.width, canvas?.height]).toEqual([450, 560]);
    expect(canvas?.style.marginLeft).toBe('-60px');
    expect(canvas?.style.width).toBe('calc(100% + 60px)');
    expect(canvas?.style.height).toBe('calc(100% + 40px)');
    expect(
      drawn.some(
        (call) =>
          call.composite === 'destination-over' &&
          call.name === 'fillRect' &&
          Number(call.args[2]) >= 450 &&
          Number(call.args[3]) >= 560,
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(SHEET_GLIDE_MS);

    expect(element.hasAttribute('overscan')).toBe(false);
    expect([canvas?.width, canvas?.height]).toEqual([390, 520]);
    expect(canvas?.style.marginLeft).toBe('');
  });

  it('keeps every room name whole inside the stage when the plan is shifted past its edge, leading in to a room that still shows in part', async () => {
    recorded();

    const element = await mountPlan((view) => {
      sized(view, 390, 520);
      view.shift = { x: 90, y: -60 };
    });
    const names = element
      .wordBoxes()
      .filter(
        (box) =>
          box.key.startsWith('name:') &&
          !element.veiled.includes(box.key.slice(5)),
      );

    expect(names.map((box) => box.key).sort()).toEqual([
      'name:bathroom',
      'name:hall',
      'name:living-space',
    ]);

    const lead = element
      .wordBoxes()
      .filter((box) => box.key === 'lead:bathroom')
      .at(-1);

    expect(lead && lead.x >= 0 && lead.x <= 390).toBe(true);
    expect(lead && lead.y >= 0 && lead.y <= 520).toBe(true);

    for (const box of names) {
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width / 2).toBeLessThanOrEqual(390);
      expect(box.y - box.height / 2).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height / 2).toBeLessThanOrEqual(520);
    }
  });
});
