import '../src/card.js';

import {
  applyTemplate,
  EMPTY_ADDITIONS,
  EMPTY_OVERRIDES,
  emptyPlan,
  type HomeDocument,
  TEMPLATES,
} from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import type { HassEntityState } from '../src/hass-state.js';
import {
  boxInside,
  insidePolygon,
  type MarkBox,
  overlapsRing,
} from '../src/living.js';
import type { EstanzaPlanView } from '../src/plan-view.js';
import { NAME_INK_SHARE, NAME_PAD_PX } from '../src/room-tags.js';
import narrow from './fixtures/narrow-rooms.json';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass, mockLight, mockSensor } from './mock-hass.js';

type Size = { width: number; height: number };

type Dashboard = {
  name: string;
  viewport: number;
  stage: Size;
  layout: string | undefined;
};

type Room = { slug: string; floor: string; ring: Point[]; inner: Point[] };

type Tag = {
  slug: string;
  name: MarkBox;
  lead: Point[] | null;
  veiled: boolean;
  loose: boolean;
  plate: boolean;
};

type Shot = {
  label: string;
  size: Size;
  single: boolean;
  tags: Map<string, Tag>;
  rooms: Map<string, Room>;
  lights: MarkBox[];
  furniture: MarkBox[];
};

const SPEC_TIMEOUT_MS = 600_000;
const SETTLE_MS = 1200;
const SLACK_PX = 0.5;
const LIGHT_SYMBOL_PX = 12;
const SAME_SIZE_SHARE = 0.02;
const SHEET_PX = 330;

const dashboards: Dashboard[] = [
  {
    name: 'short phone',
    viewport: 390,
    stage: { width: 390, height: 560 },
    layout: 'panel',
  },
  {
    name: 'phone',
    viewport: 390,
    stage: { width: 390, height: 750 },
    layout: 'panel',
  },
  {
    name: 'phone masonry',
    viewport: 390,
    stage: { width: 372, height: 279 },
    layout: undefined,
  },
  {
    name: 'tablet',
    viewport: 820,
    stage: { width: 820, height: 1086 },
    layout: 'panel',
  },
  {
    name: 'desktop',
    viewport: 1280,
    stage: { width: 1280, height: 806 },
    layout: 'panel',
  },
];

function templateHome(id: string): HomeDocument {
  return applyTemplate(
    {
      version: 1,
      rev: 0,
      plan: emptyPlan(id, id),
      rooms: {},
      overrides: EMPTY_OVERRIDES(),
      additions: EMPTY_ADDITIONS(),
      meta: { kind: 'drawn', label: id },
    },
    id,
  );
}

const homes: [string, HomeDocument][] = [
  ['the narrow rooms fixture', homeDocumentSchema.parse(narrow)],
  ...Object.keys(TEMPLATES).map((id): [string, HomeDocument] => [
    `the ${id} template`,
    templateHome(id),
  ]),
];

let stage: Size = { width: 0, height: 0 };

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
      key in target
        ? target[key]
        : () => ({ addColorStop: () => undefined, width: 0 }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function rect(left: number, top: number, right: number, bottom: number) {
  return {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function controlRect(element: Element): DOMRect | null {
  const list = element.classList;

  if (element.localName === 'estanza-scene-view') {
    return rect(0, 0, stage.width, stage.height);
  }
  if (list.contains('views')) return rect(12, 12, 97, 57);
  if (list.contains('floors')) {
    const folded = element.querySelectorAll('button').length <= 1;

    return folded ? rect(12, 67, 58, 113) : rect(12, 67, 58, 229);
  }
  if (list.contains('pages')) return rect(12, 121, 148, 167);
  if (list.contains('sheet')) {
    const height = Math.min(SHEET_PX, stage.height / 2);

    return rect(0, stage.height - height, stage.width, stage.height);
  }

  return null;
}

async function tapRoom(card: EstanzaCard, slug: string): Promise<void> {
  planOf(card)?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: {
        scopeType: 'room',
        scopeId: slug,
        gesture: 'tap',
        x: stage.width / 2,
        y: stage.height / 2,
      },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
  await wait(card, SETTLE_MS);
}

async function closeSheet(card: EstanzaCard): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle(card);
  await wait(card, SETTLE_MS);
}

function planOf(card: EstanzaCard): EstanzaPlanView | null {
  return card.shadowRoot?.querySelector('estanza-plan-view') ?? null;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await planOf(card)?.updateComplete;
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await settle(card);
  }
}

async function press(card: EstanzaCard, selector: string): Promise<void> {
  card.shadowRoot?.querySelector<HTMLButtonElement>(selector)?.click();
  await settle(card);
  await wait(card, SETTLE_MS);
}

function entityOf(slug: string): string {
  return slug.replaceAll('-', '_');
}

function linksOf(home: HomeDocument): {
  bindings: SceneBinding[];
  states: HassEntityState[];
} {
  const rooms = deriveFloors(home).flatMap((floor) =>
    floor.rooms.map((room) => room.slug),
  );

  return {
    bindings: [
      ...rooms.map((slug) => ({
        scope: { type: 'room' as const, id: slug },
        temperature_entity_id: `sensor.${entityOf(slug)}_temperature`,
      })),
      ...home.additions.lights.map((light) => ({
        scope: { type: 'light' as const, id: light.slug },
        entity_id: `light.${entityOf(light.slug)}`,
      })),
    ],
    states: [
      ...rooms.map((slug) =>
        mockSensor(
          `sensor.${entityOf(slug)}_temperature`,
          'temperature',
          20.5,
          '°C',
        ),
      ),
      ...home.additions.lights.map((light) =>
        mockLight(`light.${entityOf(light.slug)}`, { on: false }),
      ),
    ],
  };
}

async function mountCard(
  home: HomeDocument,
  dashboard: Dashboard,
  linked: boolean,
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');
  const links = linked ? linksOf(home) : { bindings: [], states: [] };

  stage = dashboard.stage;
  vi.stubGlobal('innerWidth', dashboard.viewport);
  if (dashboard.layout) card.layout = dashboard.layout;
  card.hass = createMockHass({ states: links.states });
  card.setConfig({
    type: cardType,
    home_document: home,
    bindings: links.bindings,
    tablet: 'off',
    default_view: '2d',
  });
  document.body.append(card);
  await settle(card);
  await wait(card, SETTLE_MS);

  return card;
}

async function showFloor(card: EstanzaCard, floor: string): Promise<void> {
  const chip = card.shadowRoot?.querySelector('.floors button[aria-expanded]');

  if (chip) await press(card, '.floors button[aria-expanded]');

  await press(card, `.floors button[data-floor="${floor}"]`);
}

function shoot(
  card: EstanzaCard,
  home: HomeDocument,
  label: string,
  single: boolean,
): Shot {
  const plan = planOf(card);

  if (!plan) throw new Error(`no plan at ${label}`);

  const floors = deriveFloors(home);
  const floorOf = new Map(
    floors.flatMap((floor) => floor.rooms.map((room) => [room.slug, floor.id])),
  );
  const named = floors.flatMap((floor) =>
    floor.rooms
      .filter((room) => !room.nameHidden && room.label.trim())
      .map((room) => room.slug),
  );
  const words = plan.wordBoxes();
  const rooms = new Map(
    [...plan.roomFootprints(named)].map(([slug, footprint]): [string, Room] => [
      slug,
      {
        slug,
        floor: floorOf.get(slug) ?? '',
        ring: footprint.floor,
        inner: footprint.inner ?? footprint.floor,
      },
    ]),
  );
  const tags = new Map(
    named.flatMap((slug): [string, Tag][] => {
      const name = words.find((word) => word.key === `name:${slug}`);
      const steps = words.filter((word) => word.key === `lead:${slug}`);

      if (!name || !rooms.has(slug)) return [];

      return [
        [
          slug,
          {
            slug,
            name,
            lead: steps.length > 1 ? steps : null,
            veiled: plan.veiled.includes(slug),
            loose: plan.loose.includes(slug),
            plate: plan.plates.includes(slug),
          },
        ],
      ];
    }),
  );
  const lights = home.additions.lights.flatMap((light) => {
    const at = plan.anchorOf({ type: 'light', id: light.slug });

    return at
      ? [{ ...at, width: LIGHT_SYMBOL_PX, height: LIGHT_SYMBOL_PX }]
      : [];
  });

  return {
    label,
    size: stage,
    single,
    tags,
    rooms,
    lights,
    furniture: plan.furnitureBoxes(),
  };
}

async function shootAll(
  card: EstanzaCard,
  home: HomeDocument,
  label: string,
  single: boolean,
): Promise<Shot[]> {
  const pages = [
    ...(card.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      '.pages button[data-page]',
    ) ?? []),
  ].map((button) => button.dataset.page ?? '');

  if (pages.length === 0) return [shoot(card, home, label, single)];

  const shots: Shot[] = [];

  for (const page of pages) {
    await press(card, `.pages button[data-page="${page}"]`);
    shots.push(shoot(card, home, `${label}, page ${page}`, single));
  }

  return shots;
}

function ink(name: MarkBox): MarkBox {
  return {
    ...name,
    width: Math.max(name.width - 2 * NAME_PAD_PX - 2 * SLACK_PX, 0),
    height: Math.max(name.height * NAME_INK_SHARE - 2 * SLACK_PX, 0),
  };
}

function hits(one: MarkBox, two: MarkBox): boolean {
  return (
    Math.abs(one.x - two.x) < (one.width + two.width) / 2 &&
    Math.abs(one.y - two.y) < (one.height + two.height) / 2
  );
}

function wholeOnStage(shot: Shot): string[] {
  return [...shot.tags.values()].flatMap((tag) => {
    const { x, y, width, height } = ink(tag.name);
    const cut =
      x - width / 2 < 0 ||
      y - height / 2 < 0 ||
      x + width / 2 > shot.size.width ||
      y + height / 2 > shot.size.height;

    return !tag.veiled && cut
      ? [`${shot.label}: ${tag.slug} is cut by the card edge`]
      : [];
  });
}

function inItsRoomOrLed(shot: Shot): string[] {
  return [...shot.tags.values()].flatMap((tag) => {
    const room = shot.rooms.get(tag.slug);

    if (!room || tag.veiled) return [];
    if (!tag.lead) {
      const box = ink(tag.name);

      return boxInside(box, box.width, box.height, room.inner)
        ? []
        : [`${shot.label}: ${tag.slug} crosses its wall`];
    }

    const storey = [...shot.rooms.values()].filter(
      (other) => other.floor === room.floor,
    );
    const anchor = tag.lead[tag.lead.length - 1];
    const outside = storey.every(
      (other) =>
        !overlapsRing(ink(tag.name), other.ring) &&
        !insidePolygon(tag.name, other.ring),
    );

    if (!outside) return [`${shot.label}: ${tag.slug} leads out over a wall`];

    return insidePolygon(anchor, room.ring)
      ? []
      : [`${shot.label}: ${tag.slug} leads to a spot outside its room`];
  });
}

function clearOf(
  kind: 'lights' | 'furniture',
  plates: boolean,
): (shot: Shot) => string[] {
  return (shot) =>
    [...shot.tags.values()].flatMap((tag) =>
      !tag.veiled &&
      (plates || !tag.plate) &&
      shot[kind].some((symbol) => hits(ink(tag.name), symbol))
        ? [`${shot.label}: ${tag.slug} is over ${kind}`]
        : [],
    );
}

function widthOf(room: Room): number {
  const xs = room.ring.map((point) => point.x);

  return Math.max(...xs) - Math.min(...xs);
}

function sameChoice(shots: readonly Shot[]): string[] {
  const alone = shots.filter((shot) => shot.single);
  const together = shots.filter((shot) => !shot.single);

  return together.flatMap((all) =>
    [...all.tags.values()].flatMap((tag) => {
      const own = alone.find((shot) => shot.tags.has(tag.slug));
      const mine = own?.tags.get(tag.slug);
      const room = all.rooms.get(tag.slug);
      const ownRoom = own?.rooms.get(tag.slug);

      if (!own || !mine || !room || !ownRoom || tag.veiled || mine.veiled) {
        return [];
      }

      const scale = widthOf(room) / widthOf(ownRoom);
      const inside = tag.lead === null;
      const ownInside = mine.lead === null;
      const smaller = scale < 1 - SAME_SIZE_SHARE;
      const larger = scale > 1 + SAME_SIZE_SHARE;

      if (inside && !ownInside && !larger) {
        return [
          `${all.label}: ${tag.slug} sits inside on All floors but leads out on its own floor`,
        ];
      }
      if (!inside && ownInside && !smaller) {
        return [
          `${all.label}: ${tag.slug} leads out on All floors but sits inside on its own floor`,
        ];
      }

      return [];
    }),
  );
}

const cases = homes.flatMap(
  ([name, home], index): [string, HomeDocument, boolean, boolean][] => [
    [`${name}, names only`, home, false, index === 0],
    [`${name}, linked`, home, true, index === 0],
  ],
);

describe.each(cases)('the room names in %s', (_, home, linked, taps) => {
  const floors = deriveFloors(home);
  const choices: [string, string][] = [
    ...floors.map((floor): [string, string] => [floor.id, floor.id]),
    ...(floors.length > 1 ? [['all floors', 'all'] as [string, string]] : []),
  ];
  const shots: Shot[] = [];
  const byDashboard = new Map<string, Shot[]>();

  beforeAll(async () => {
    vi.useFakeTimers({
      now: new Date(2026, 8, 29, 12, 0),
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (kind: string) => (kind === '2d' ? fakeContext() : null) as never,
    );
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
      function (this: Element) {
        if (this.localName === 'estanza-card') return stage.width;

        return this.classList.contains('stage') ||
          this.localName === 'estanza-plan-view'
          ? stage.width
          : 0;
      },
    );
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: Element) {
        return this.classList.contains('stage') ||
          this.localName === 'estanza-plan-view'
          ? stage.height
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('sheet') ? 272 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        if (!this.classList.contains('sheet')) return 0;

        return this.classList.contains('bottom')
          ? Math.min(SHEET_PX, stage.height / 2)
          : SHEET_PX;
      },
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        return controlRect(this) ?? rect(0, 0, 0, 0);
      },
    );

    for (const dashboard of dashboards) {
      const taken: Shot[] = [];

      for (const [shown, floor] of choices) {
        const card = await mountCard(home, dashboard, linked);

        await showFloor(card, floor);

        const rest = await shootAll(
          card,
          home,
          `${dashboard.name}, ${shown}`,
          floor !== 'all',
        );

        taken.push(...rest);

        for (const slug of taps
          ? rest.flatMap((shot) => [...shot.tags.keys()])
          : []) {
          await tapRoom(card, slug);
          shots.push(
            shoot(
              card,
              home,
              `${dashboard.name}, ${shown}, ${slug} sheet`,
              true,
            ),
          );
          await closeSheet(card);
          shots.push(
            shoot(
              card,
              home,
              `${dashboard.name}, ${shown}, ${slug} closed`,
              true,
            ),
          );
        }

        card.remove();
      }

      byDashboard.set(dashboard.name, taken);
      shots.push(...taken);
    }
  }, SPEC_TIMEOUT_MS);

  afterAll(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws every room name whole inside the card', () => {
    expect(shots.flatMap(wholeOnStage)).toEqual([]);
  });

  it('keeps every room name inside its own room, or leads it out through its own wall', () => {
    expect(shots.flatMap(inItsRoomOrLed)).toEqual([]);
  });

  it('keeps every room name off the light symbols', () => {
    expect(shots.flatMap(clearOf('lights', true))).toEqual([]);
  });

  it('keeps every unplated room name off the furniture', () => {
    expect(shots.flatMap(clearOf('furniture', false))).toEqual([]);
  });

  it('makes the same choice for a room on All floors as on its own floor', () => {
    expect([...byDashboard.values()].flatMap(sameChoice)).toEqual([]);
  });
});
