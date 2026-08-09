import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';
import {
  balconyAnchor,
  balconyCorners,
} from '@estanza/plan-engine/geometry/plot.js';
import { type CanvasState, drawPlan, fitCamera } from '@estanza/plan2d';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import type { SceneScope } from '../src/bindings.js';
import type { Rect } from '../src/camera-rig.js';
import {
  boxInside,
  covered,
  insidePolygon,
  type MarkBox,
  overlapsRing,
} from '../src/living.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { NAME_PAD_PX } from '../src/room-tags.js';

vi.mock('@estanza/plan2d', async (original) => {
  const real = await original<typeof import('@estanza/plan2d')>();

  return { ...real, drawPlan: vi.fn(fittedDraw) };
});

type Point = { x: number; y: number };

const home = homeDocumentSchema.parse(aurora);
const floors = deriveFloors(home);
const dashboards: [string, number, number][] = [
  ['phone panel', 390, 750],
  ['phone sections', 372, 464],
  ['phone masonry', 372, 279],
  ['tablet panel', 820, 1086],
  ['sections', 498, 464],
  ['tablet masonry', 396, 297],
  ['desktop panel', 1280, 806],
  ['desktop masonry', 308, 231],
  ['wide panel', 1920, 986],
  ['wide masonry', 468, 351],
];
const INK_PX = 12;
const EDGE_REACH_PX = 60;
const controls: Rect[] = [{ left: 0, top: 0, right: 110, bottom: 300 }];

function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {
    font: '12px sans-serif',
    measureText(this: { font: string }, text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);

      return { width: text.length * px * 0.6 };
    },
  };

  return new Proxy(store, {
    get: (target, key) =>
      key in target ? target[key] : () => ({ addColorStop: () => undefined }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fittedDraw(
  ctx: CanvasRenderingContext2D,
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

class QuietResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

function allTargets(): SceneScope[] {
  return [
    ...floors.flatMap((floor) =>
      floor.rooms.map((room) => ({ type: 'room' as const, id: room.slug })),
    ),
    ...home.additions.lights.map((light) => ({
      type: 'light' as const,
      id: light.slug,
    })),
    ...floors.flatMap((floor) => [
      ...floor.floor.doors.map((door) => ({
        type: 'door' as const,
        id: door.id,
      })),
      ...floor.floor.windows.map((pane) => ({
        type: 'window' as const,
        id: pane.id,
      })),
    ]),
  ];
}

async function mount(
  width: number,
  height: number,
  active: string | null,
  scheme: 'light' | 'dark' = 'light',
): Promise<EstanzaPlanView> {
  const element = document.createElement('estanza-plan-view');

  element.scheme = scheme;
  element.home = home;
  element.floors = floors;
  element.active = active;
  element.targets = allTargets();
  element.clear = controls;
  Object.defineProperty(element, 'clientWidth', { value: width });
  Object.defineProperty(element, 'clientHeight', { value: height });
  document.body.append(element);
  await element.updateComplete;

  return element;
}

function innerRing(element: EstanzaPlanView, slug: string): Point[] {
  const room = floors
    .flatMap((floor: DerivedFloor) => floor.rooms)
    .find((candidate) => candidate.slug === slug);
  const ring = element.roomFootprints([slug]).get(slug)?.floor;

  if (!room || !ring) return [];

  const xs = room.poly.map(([x]) => x);
  const screenXs = ring.map((point) => point.x);
  const zoom =
    (Math.max(...screenXs) - Math.min(...screenXs)) /
    (Math.max(...xs) - Math.min(...xs));
  const [first] = room.poly;
  const from = {
    x: ring[0].x - first[0] * zoom,
    y: ring[0].y - first[1] * zoom,
  };
  const inner =
    room.innerPoly && room.innerPoly.length > 2 ? room.innerPoly : room.poly;

  return inner.map(([x, y]) => ({
    x: from.x + x * zoom,
    y: from.y + y * zoom,
  }));
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as never,
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('room names on every dashboard the card ships in', () => {
  const choices: [string, string | null][] = [
    ...floors.map((floor): [string, string | null] => [floor.id, floor.id]),
    ['all floors', null],
  ];

  for (const [dashboard, width, height] of dashboards) {
    for (const [shown, active] of choices) {
      it(`writes every name of ${shown} inside its own room, or leads it back in, on the ${dashboard} card, ${width} by ${height}`, async () => {
        const element = await mount(width, height, active);
        const words = element.wordBoxes();
        const names = words.filter((box) => box.key.startsWith('name:'));
        const misplaced = names.flatMap((name) => {
          const slug = name.key.slice(5);
          const lead = words.filter((box) => box.key === `lead:${slug}`).at(-1);
          const inner = innerRing(element, slug);

          if (element.loose.includes(slug)) return [];
          if (lead) {
            return insidePolygon(lead, inner)
              ? []
              : [`${slug} leads out of its room`];
          }

          return boxInside(name, name.width - 2 * NAME_PAD_PX, INK_PX, inner)
            ? []
            : [`${slug} at ${Math.round(name.x)},${Math.round(name.y)}`];
        });

        expect(misplaced).toEqual([]);
      });
    }
  }
});

function onDeck(
  element: EstanzaPlanView,
  names: readonly (MarkBox & { key: string })[],
): string[] {
  const decks = floors.flatMap((floor) => {
    const room = floor.rooms.find(
      (candidate) => element.roomFootprints([candidate.slug]).size > 0,
    );
    const ring = room && element.roomFootprints([room.slug]).get(room.slug);

    if (!room || !ring) return [];

    const xs = room.poly.map(([x]) => x);
    const screenXs = ring.floor.map((point) => point.x);
    const zoom =
      (Math.max(...screenXs) - Math.min(...screenXs)) /
      (Math.max(...xs) - Math.min(...xs));
    const [first] = room.poly;
    const from = {
      x: ring.floor[0].x - first[0] * zoom,
      y: ring.floor[0].y - first[1] * zoom,
    };

    return (home.additions.balconies ?? []).flatMap((balcony) => {
      const anchor = balconyAnchor(balcony, floors);

      if (!anchor || anchor.fd.id !== floor.id) return [];

      return [
        balconyCorners(balcony, anchor).map(([x, y]) => ({
          x: from.x + x * zoom,
          y: from.y + y * zoom,
        })),
      ];
    });
  });

  return names
    .map((name) => ({
      ...name,
      width: name.width - 2 * NAME_PAD_PX,
      height: INK_PX,
    }))
    .filter((name) =>
      decks.some(
        (deck) =>
          [-1, 0, 1].some((sx) =>
            [-1, 0, 1].some((sy) =>
              insidePolygon(
                {
                  x: name.x + (sx * name.width) / 2,
                  y: name.y + (sy * name.height) / 2,
                },
                deck,
              ),
            ),
          ) ||
          deck.some(
            (corner) =>
              Math.abs(corner.x - name.x) < name.width / 2 &&
              Math.abs(corner.y - name.y) < name.height / 2,
          ),
      ),
    )
    .map((name) => name.key);
}

function adrift(
  element: EstanzaPlanView,
  names: readonly (Point & { key: string })[],
  slugs: readonly string[],
): string[] {
  const corners = [...element.roomFootprints(slugs).values()].flatMap(
    (footprint) => footprint.floor,
  );
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return names
    .filter(
      (name) =>
        name.x < Math.min(...xs) - EDGE_REACH_PX ||
        name.x > Math.max(...xs) + EDGE_REACH_PX ||
        name.y < Math.min(...ys) - EDGE_REACH_PX ||
        name.y > Math.max(...ys) + EDGE_REACH_PX,
    )
    .map((name) => name.key);
}

describe('a room name is never left out', () => {
  const choices: [string, string | null][] = [
    ...floors.map((floor): [string, string | null] => [floor.id, floor.id]),
    ['all floors', null],
  ];
  const named = floors.flatMap((floor) =>
    floor.rooms
      .filter((room) => !room.nameHidden && room.label.trim())
      .map((room) => room.slug),
  );

  for (const scheme of ['light', 'dark'] as const) {
    for (const [dashboard, width, height] of dashboards) {
      for (const [shown, active] of choices) {
        it(`names every room of ${shown} on the ${dashboard} card, ${width} by ${height}, ${scheme}`, async () => {
          const element = await mount(width, height, active, scheme);
          const drawn = [...element.roomFootprints(named).keys()];
          const names = element
            .wordBoxes()
            .filter((box) => box.key.startsWith('name:'));
          const keys = new Set(names.map((box) => box.key.slice(5)));
          const offStage = names.filter(
            (box) =>
              box.x - box.width / 2 < 0 ||
              box.x + box.width / 2 > width ||
              box.y - box.height / 2 < 0 ||
              box.y + box.height / 2 > height,
          );
          const stacked = names.filter((box) =>
            names.some((other) => other !== box && covered(box, [other])),
          );

          expect(drawn.length).toBeGreaterThan(0);
          expect(drawn.filter((slug) => !keys.has(slug))).toEqual([]);
          expect(offStage.map((box) => box.key)).toEqual([]);
          expect(stacked.map((box) => box.key)).toEqual([]);
          expect(adrift(element, names, named)).toEqual([]);
          expect(onDeck(element, names)).toEqual([]);
        });
      }
    }
  }
});

describe('tapping a name', () => {
  it('opens the room it names, even inside the reach of a mark', async () => {
    const element = await mount(390, 750, 'f1');
    const names = element
      .wordBoxes()
      .filter((box) => box.key.startsWith('name:'));

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(element.pickAt(name), name.key).toEqual({
        type: 'room',
        id: name.key.slice(5),
      });
    }
  });
});

describe('the size of a room name', () => {
  const tallest = (element: EstanzaPlanView) =>
    Math.max(
      ...element
        .wordBoxes()
        .filter((box) => box.key.startsWith('name:'))
        .map((box) => box.height),
    );

  it('writes the names larger on a plan drawn larger than the desktop panel', async () => {
    const sections = await mount(498, 464, 'f1');
    const normal = tallest(sections);

    document.body.replaceChildren();

    const wide = await mount(1920, 986, 'f1');

    expect(tallest(wide)).toBeGreaterThan(normal);
  });

  it('writes no room names on a still plan', async () => {
    const element = document.createElement('estanza-plan-view');

    element.still = true;
    element.home = home;
    element.floors = floors;
    element.active = 'f1';
    Object.defineProperty(element, 'clientWidth', { value: 1920 });
    Object.defineProperty(element, 'clientHeight', { value: 986 });
    document.body.append(element);
    await element.updateComplete;

    expect(
      element.wordBoxes().filter((box) => box.key.startsWith('name:')),
    ).toEqual([]);
  });
});

describe('a name set beside its room', () => {
  const panels = dashboards.filter(([dashboard]) =>
    ['phone panel', 'desktop panel', 'wide panel'].includes(dashboard),
  );

  for (const [dashboard, width, height] of panels) {
    it(`never crosses a wall on the ${dashboard} card, ${width} by ${height}`, async () => {
      const element = await mount(width, height, null);
      const words = element.wordBoxes();
      const rings = [
        ...element
          .roomFootprints(
            floors.flatMap((floor) => floor.rooms.map((room) => room.slug)),
          )
          .values(),
      ].map((footprint) => footprint.floor);
      const crossing = words
        .filter((box) => box.key.startsWith('name:'))
        .filter(
          (name) =>
            !element.loose.includes(name.key.slice(5)) &&
            words.some((box) => box.key === `lead:${name.key.slice(5)}`),
        )
        .filter((name) =>
          rings.some((ring) =>
            overlapsRing(
              { ...name, width: name.width - 2 * NAME_PAD_PX, height: INK_PX },
              ring,
            ),
          ),
        );

      expect(crossing.map((name) => name.key)).toEqual([]);
    });
  }
});
