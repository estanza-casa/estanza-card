import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { controlStyles } from '../src/control-view.js';
import type { Point } from '../src/gesture.js';
import {
  boxInside,
  covered,
  insidePolygon,
  LABEL_HEIGHT,
  labelWidth,
  type MarkBox,
  overlapsRing,
  pillInside,
  SMALL_LABEL_HEIGHT,
  TABLET_LABEL_HEIGHT,
  TABLET_LABEL_SCALE,
} from '../src/living.js';
import type { EstanzaPlanView } from '../src/plan-view.js';
import { NAME_INK_SHARE, NAME_PAD_PX } from '../src/room-tags.js';
import {
  dockCovers,
  dockSpot,
  SHEET_EDGE_PX,
  sheetsBelow,
} from '../src/sheet.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockLight,
  mockLock,
  mockSensor,
} from './mock-hass.js';

type Size = { width: number; height: number };

type Dashboard = {
  name: string;
  viewport: number;
  stage: Size;
  layout: string | undefined;
};

type Lead = { from: Point; to: Point; path: readonly Point[] };

type Tag = {
  slug: string;
  floor: string;
  name: MarkBox;
  pill: (MarkBox & { kind: string; text: string }) | null;
  compact: boolean;
  veiled: boolean;
  loose: boolean;
  lead: Lead | null;
};

type Room = { slug: string; floor: string; ring: Point[]; inner: Point[] };

type Shot = {
  label: string;
  tapped: string | null;
  tags: Map<string, Tag>;
  rooms: Map<string, Room>;
  glyphs: MarkBox[];
  dots: MarkBox[];
  stairs: MarkBox[];
  captions: MarkBox[];
  controls: MarkBox[];
  sheet: MarkBox | null;
  covered: boolean;
  quiet: string[];
};

type Visit = { before: Shot; open: Shot; closed: Shot };

const home = homeDocumentSchema.parse(aurora);
const floors = deriveFloors(home);
const SHEET_PX = 330;
const SPEC_TIMEOUT_MS = 600_000;
const SETTLE_MS = 1200;
const SLACK_PX = 0.5;
const DISC_PX = Number(
  /\.mark \.disc \{[^}]*width: (\d+)px/.exec(controlStyles.cssText)?.[1],
);
const DOT_PX = 14;
const ANCHOR_PX = 4;
const GAP_PX = 4;
const TAPPED_LEAD_SHARE = 0.15;
const readings = [18.5, 19.2, 19.9, 20.6];

const dashboards: Dashboard[] = [
  {
    name: 'phone portrait panel',
    viewport: 390,
    stage: { width: 390, height: 750 },
    layout: 'panel',
  },
  {
    name: 'phone landscape panel',
    viewport: 844,
    stage: { width: 844, height: 300 },
    layout: 'panel',
  },
  {
    name: 'tablet panel',
    viewport: 820,
    stage: { width: 820, height: 1086 },
    layout: 'panel',
  },
  {
    name: 'desktop panel',
    viewport: 1280,
    stage: { width: 1280, height: 806 },
    layout: 'panel',
  },
  {
    name: 'wide panel',
    viewport: 1920,
    stage: { width: 1920, height: 986 },
    layout: 'panel',
  },
  {
    name: 'sections',
    viewport: 1280,
    stage: { width: 498, height: 464 },
    layout: 'grid',
  },
  {
    name: 'phone masonry',
    viewport: 390,
    stage: { width: 372, height: 279 },
    layout: undefined,
  },
  {
    name: 'tablet masonry',
    viewport: 820,
    stage: { width: 396, height: 297 },
    layout: undefined,
  },
  {
    name: 'desktop masonry',
    viewport: 1280,
    stage: { width: 308, height: 231 },
    layout: undefined,
  },
  {
    name: 'wide masonry',
    viewport: 1920,
    stage: { width: 468, height: 351 },
    layout: undefined,
  },
];

const floorOfRoom = new Map(
  floors.flatMap((floor) => floor.rooms.map((room) => [room.slug, floor.id])),
);
const labelOf = new Map(
  floors.flatMap((floor) =>
    floor.rooms.map((room) => [room.slug, room.label.trim()]),
  ),
);
const named = floors.flatMap((floor) =>
  floor.rooms
    .filter((room) => !room.nameHidden && room.label.trim())
    .map((room) => room.slug),
);

let stage: Size = { width: 0, height: 0 };
let viewport = 0;

function entityOf(slug: string): string {
  return slug.replaceAll('-', '_');
}

function areaOf(poly: readonly [number, number][]): number {
  return Math.abs(
    poly.reduce((sum, [x, y], index) => {
      const [nx, ny] = poly[(index + 1) % poly.length];

      return sum + x * ny - nx * y;
    }, 0) / 2,
  );
}

function outerWalls(floor: DerivedFloor, slug: string): number {
  const room = floor.roomsBySlug.get(slug);

  if (!room) return 0;

  const others = floor.rooms
    .filter((other) => other.slug !== slug)
    .map((other) => other.poly.map(([x, y]) => ({ x, y })));
  const own = room.poly.map(([x, y]) => ({ x, y }));

  return room.poly.filter(([x, y], index) => {
    const [nx, ny] = room.poly[(index + 1) % room.poly.length];
    const length = Math.hypot(nx - x, ny - y) || 1;
    const middle = { x: (x + nx) / 2, y: (y + ny) / 2 };
    const normal = { x: (ny - y) / length, y: -(nx - x) / length };

    return [1, -1].some((side) => {
      const probe = {
        x: middle.x + normal.x * side * 40,
        y: middle.y + normal.y * side * 40,
      };

      return (
        !insidePolygon(probe, own) &&
        !others.some((other) => insidePolygon(probe, other))
      );
    });
  }).length;
}

function sheetRooms(floor: DerivedFloor): string[] {
  const rooms = floor.rooms.filter((room) => named.includes(room.slug));
  const byArea = [...rooms].sort((a, b) => areaOf(b.poly) - areaOf(a.poly));
  const big = byArea[0].slug;
  const small = byArea[byArea.length - 1].slug;
  const inner = [...rooms]
    .filter((room) => room.slug !== big && room.slug !== small)
    .sort(
      (a, b) =>
        outerWalls(floor, a.slug) - outerWalls(floor, b.slug) ||
        areaOf(a.poly) - areaOf(b.poly),
    )[0].slug;

  return [big, small, inner];
}

function bindings(): SceneBinding[] {
  return [
    ...named.map((slug) => ({
      scope: { type: 'room' as const, id: slug },
      temperature_entity_id: `sensor.${entityOf(slug)}_temperature`,
    })),
    ...home.additions.lights.map((light) => ({
      scope: { type: 'light' as const, id: light.slug },
      entity_id: `light.${entityOf(light.slug)}`,
    })),
    ...floors.flatMap((floor) => [
      ...floor.floor.doors.map((door) =>
        door.id === 'd1'
          ? {
              scope: { type: 'door' as const, id: door.id },
              entity_ids: [`binary_sensor.door_${door.id}`, 'lock.front_door'],
            }
          : {
              scope: { type: 'door' as const, id: door.id },
              entity_id: `binary_sensor.door_${door.id}`,
            },
      ),
      ...floor.floor.windows.map((pane) => ({
        scope: { type: 'window' as const, id: pane.id },
        entity_id: `binary_sensor.window_${pane.id}`,
      })),
    ]),
  ];
}

function states() {
  return [
    ...named.map((slug, index) =>
      mockSensor(
        `sensor.${entityOf(slug)}_temperature`,
        'temperature',
        readings[index % readings.length],
        '°C',
      ),
    ),
    ...home.additions.lights.map((light, index) =>
      mockLight(`light.${entityOf(light.slug)}`, { on: index % 3 === 0 }),
    ),
    ...floors.flatMap((floor) => [
      ...floor.floor.doors.map((door) =>
        mockBinarySensor(`binary_sensor.door_${door.id}`, 'door', false),
      ),
      ...floor.floor.windows.map((pane) =>
        mockBinarySensor(`binary_sensor.window_${pane.id}`, 'window', false),
      ),
    ]),
    mockLock('lock.front_door', 'locked'),
  ];
}

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

async function mountCard(dashboard: Dashboard): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  stage = dashboard.stage;
  viewport = dashboard.viewport;
  vi.stubGlobal('innerWidth', viewport);

  if (dashboard.layout) card.layout = dashboard.layout;

  card.hass = createMockHass({ states: states() });
  card.setConfig({
    type: cardType,
    home_document: aurora,
    bindings: bindings(),
    tablet: 'off',
    default_view: '2d',
  });
  document.body.append(card);
  await settle(card);
  await wait(card, SETTLE_MS);

  return card;
}

async function showFloor(card: EstanzaCard, floor: string): Promise<void> {
  const chip = card.shadowRoot?.querySelector<HTMLButtonElement>(
    '.floors button[aria-expanded]',
  );

  if (chip) await press(card, '.floors button[aria-expanded]');

  await press(card, `.floors button[data-floor="${floor}"]`);
}

async function turnTo(card: EstanzaCard, storey: string): Promise<void> {
  const tab = card.shadowRoot?.querySelector(
    `.pages button[data-page="${storey}"]`,
  );

  await press(
    card,
    tab
      ? `.pages button[data-page="${storey}"]`
      : `.floors button[data-floor="${storey}"]`,
  );
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

function pillSize(card: EstanzaCard, element: HTMLElement, text: string) {
  if (element.classList.contains('small')) {
    return {
      kind: 'small',
      width: labelWidth(text, true),
      height: SMALL_LABEL_HEIGHT,
    };
  }

  if (element.classList.contains('large') || card.hasAttribute('large-pills')) {
    return {
      kind: 'large',
      width: labelWidth(text) * TABLET_LABEL_SCALE,
      height: TABLET_LABEL_HEIGHT,
    };
  }

  return { kind: 'normal', width: labelWidth(text), height: LABEL_HEIGHT };
}

function boxFrom(bounds: DOMRect): MarkBox {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

function shoot(card: EstanzaCard, label: string, tapped: string | null): Shot {
  const root = card.shadowRoot;
  const plan = planOf(card);

  if (!root || !plan) throw new Error(`no plan at ${label}`);

  const words = plan.wordBoxes();
  const footprints = plan.roomFootprints(named);
  const rooms = new Map(
    [...footprints].map(([slug, footprint]): [string, Room] => [
      slug,
      {
        slug,
        floor: floorOfRoom.get(slug) ?? '',
        ring: footprint.floor,
        inner: footprint.inner ?? footprint.floor,
      },
    ]),
  );
  const pills = new Map(
    [...root.querySelectorAll<HTMLElement>('.temp')].map((element) => {
      const text = element.querySelector('.face')?.textContent?.trim() ?? '';

      return [
        element.dataset.room ?? '',
        {
          x: parseFloat(element.style.left),
          y: parseFloat(element.style.top),
          text,
          ...pillSize(card, element, text),
        },
      ] as const;
    }),
  );
  const pillLeads = new Map(
    [...root.querySelectorAll<SVGGElement>('.leader')].map((element) => {
      const line = element.querySelector('line');
      const value = (name: string) => Number(line?.getAttribute(name));

      const from = { x: value('x1'), y: value('y1') };
      const to = { x: value('x2'), y: value('y2') };

      return [
        element.dataset.room ?? '',
        { from, to, path: [from, to] },
      ] as const;
    }),
  );
  const tags = new Map(
    named.flatMap((slug): [string, Tag][] => {
      const name = words.find((word) => word.key === `name:${slug}`);
      const steps = words.filter((word) => word.key === `lead:${slug}`);
      const pill = pills.get(slug) ?? null;
      const text = labelOf.get(slug) ?? '';
      const compact =
        pill !== null &&
        (pill.text.startsWith(text) ||
          (name !== undefined &&
            Math.hypot(name.x - pill.x, name.y - pill.y) <= SLACK_PX));
      const lead =
        steps.length > 1
          ? { from: steps[0], to: steps[steps.length - 1], path: steps }
          : (pillLeads.get(slug) ?? null);

      if (!rooms.has(slug)) return [];
      if (!name && !pill) return [];

      return [
        [
          slug,
          {
            slug,
            floor: floorOfRoom.get(slug) ?? '',
            name: name ?? { ...pill!, width: 0, height: 0 },
            pill,
            compact,
            veiled: plan.veiled.includes(slug),
            loose: plan.loose.includes(slug),
            lead,
          },
        ],
      ];
    }),
  );
  const marks = [...root.querySelectorAll<HTMLElement>('.mark, .bubble')]
    .filter((element) => !element.classList.contains('under'))
    .map((element) => ({
      dot: element.classList.contains('dot'),
      at: {
        x: parseFloat(element.style.left),
        y: parseFloat(element.style.top),
      },
    }));
  const controls = [
    ...root.querySelectorAll<HTMLElement>(
      '.dock .views, .dock .floors, .dock .pages',
    ),
  ].flatMap((element) => {
    const bounds = controlRect(element);

    return bounds ? [boxFrom(bounds)] : [];
  });
  const sheetElement = root.querySelector<HTMLElement>('.sheet');
  const docked = !sheetsBelow(viewport, stage);
  const dock = dockSpot(stage, SHEET_EDGE_PX);
  const sheet = sheetElement
    ? docked
      ? {
          x: dock.x + dock.width / 2,
          y: dock.y + Math.min(SHEET_PX, dock.room) / 2,
          width: dock.width,
          height: Math.min(SHEET_PX, dock.room),
        }
      : boxFrom(controlRect(sheetElement) ?? rect(0, 0, 0, 0))
    : null;

  return {
    label,
    tapped,
    tags,
    rooms,
    glyphs: marks
      .filter((mark) => !mark.dot)
      .map((mark) => ({ ...mark.at, width: DISC_PX, height: DISC_PX })),
    dots: marks
      .filter((mark) => mark.dot)
      .map((mark) => ({ ...mark.at, width: DOT_PX, height: DOT_PX })),
    stairs: [
      ...words.filter((word) => word.key.startsWith('stair:')),
      ...plan.stairBoxes(),
    ],
    captions: words.filter((word) => word.key.startsWith('caption:')),
    controls,
    sheet,
    covered: root.querySelector('.stage.covered') !== null,
    quiet: [...plan.quiet],
  };
}

function inset(box: MarkBox, by: number): MarkBox {
  return {
    ...box,
    width: Math.max(box.width - 2 * by, 0),
    height: Math.max(box.height - 2 * by, 0),
  };
}

function partsOf(tag: Tag): MarkBox[] {
  if (tag.compact && tag.pill) return [tag.pill];

  return tag.pill ? [tag.name, tag.pill] : [tag.name];
}

function segmentsOf(lead: Lead): [Point, Point][] {
  return lead.path.slice(1).map((to, index) => [lead.path[index], to]);
}

function leadSteps(tag: Tag): MarkBox[] {
  if (!tag.lead) return [];

  return segmentsOf(tag.lead).flatMap(([from, to], index) => {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4),
    );

    return Array.from({ length: steps + 1 }, (_, step) => ({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
      width: 1,
      height: 1,
    })).slice(index === 0 ? 0 : 1);
  });
}

function oneTagEach(shot: Shot): string[] {
  return [...shot.rooms.keys()].flatMap((slug) => {
    const tag = shot.tags.get(slug);

    if (!tag && shot.quiet.includes(slug)) return [];
    if (!tag) return [`${shot.label}: ${slug} has no tag`];
    if (!tag.veiled && !tag.pill && !tag.compact) {
      return [`${shot.label}: ${slug} shows no temperature`];
    }
    if (tag.veiled && tag.pill && !tag.compact) {
      return [`${shot.label}: ${slug} shows its pill without its name`];
    }

    return [];
  });
}

function together(shot: Shot): string[] {
  return [...shot.tags.values()].flatMap((tag) => {
    const { name, pill } = tag;

    if (!pill || tag.veiled) return [];
    if (tag.compact) {
      return Math.hypot(name.x - pill.x, name.y - pill.y) <= 1
        ? []
        : [`${shot.label}: ${tag.slug} compact pill away from its name`];
    }

    const gap = pill.y - pill.height / 2 - (name.y + name.height / 2);
    const centred = Math.abs(pill.x - name.x) <= 1;

    return centred && gap >= GAP_PX - 1 && gap <= GAP_PX + 3
      ? []
      : [
          `${shot.label}: ${tag.slug} pill ${Math.round(pill.x - name.x)},${Math.round(gap)} from its name`,
        ];
  });
}

function overlaps(box: MarkBox, at: Point, size: number): boolean {
  return (
    Math.abs(box.x - at.x) < (box.width + size) / 2 &&
    Math.abs(box.y - at.y) < (box.height + size) / 2
  );
}

function clearOfEverything(shot: Shot): string[] {
  const shown = [...shot.tags.values()].filter((tag) => !tag.veiled);

  return shown.flatMap((tag) => {
    const parts = partsOf(tag).map((part) => inset(part, SLACK_PX));
    const line = leadSteps(tag);
    const others = shown
      .filter((other) => other !== tag)
      .flatMap((other) => partsOf(other));
    const under = tag.compact ? [] : line;
    const hits = (what: string, boxes: readonly MarkBox[], with_ = parts) =>
      with_.some((part) => covered(part, boxes)) ? [what] : [];
    const hides = (what: string, boxes: readonly MarkBox[]) =>
      tag.lead && boxes.some((box) => overlaps(box, tag.lead!.to, ANCHOR_PX))
        ? [what]
        : [];
    const found = [
      ...hits('a glyph', shot.glyphs),
      ...hits('a glyph', shot.glyphs, under),
      ...hits('a mark', shot.dots),
      ...hits('the stairs', shot.stairs),
      ...hits('another tag', others),
      ...hits('another tag', others, under),
      ...hides('a glyph with its anchor', shot.glyphs),
      ...hides('another tag with its anchor', others),
      ...hits('the caption', shot.captions),
      ...hits('the controls', shot.controls),
      ...hits('the sheet', shot.sheet ? [shot.sheet] : []),
    ];

    return [...new Set(found)].map(
      (what) => `${shot.label}: ${tag.slug} is over ${what}`,
    );
  });
}

function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function leadersApart(shot: Shot): string[] {
  const led = [...shot.tags.values()].filter(
    (tag): tag is Tag & { lead: Lead } => !tag.veiled && tag.lead !== null,
  );
  const cross = ([a, b]: [Point, Point], [c, d]: [Point, Point]): boolean =>
    turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;

  return led.flatMap((one, index) =>
    led
      .slice(index + 1)
      .filter(({ lead }) =>
        segmentsOf(one.lead).some((mine) =>
          segmentsOf(lead).some((theirs) => cross(mine, theirs)),
        ),
      )
      .map(
        (two) => `${shot.label}: ${one.slug}'s leader crosses ${two.slug}'s`,
      ),
  );
}

function withinWalls(shot: Shot): string[] {
  return [...shot.tags.values()].flatMap((tag) => {
    const room = shot.rooms.get(tag.slug);

    if (!room || tag.veiled) return [];
    if (tag.loose) {
      if (!tag.compact) {
        return [
          `${shot.label}: ${tag.slug} was set loose on a storey with room to spare`,
        ];
      }

      return tag.lead !== null && insidePolygon(tag.lead.to, room.ring)
        ? []
        : [
            `${shot.label}: ${tag.slug} was set loose away from its room with no leader`,
          ];
    }

    const storey = [...shot.rooms.values()].filter(
      (other) => other.floor === tag.floor,
    );

    if (!tag.lead) {
      const nameInside =
        tag.compact ||
        boxInside(
          tag.name,
          tag.name.width - 2 * NAME_PAD_PX,
          tag.name.height * NAME_INK_SHARE,
          room.inner,
        );
      const pillInsideRoom =
        !tag.pill ||
        pillInside(tag.pill, tag.pill.width, tag.pill.height, room.inner);

      return nameInside && pillInsideRoom
        ? []
        : [`${shot.label}: ${tag.slug} crosses its wall`];
    }

    const outside = partsOf(tag).every((part) =>
      storey.every((other) => !overlapsRing(part, other.ring)),
    );
    const anchored = insidePolygon(tag.lead.to, room.ring);

    if (!outside) return [`${shot.label}: ${tag.slug} leads out over a wall`];

    return anchored
      ? []
      : [`${shot.label}: ${tag.slug} leads to a spot outside its room`];
  });
}

function spotOf(tag: Tag): MarkBox {
  return tag.compact && tag.pill ? tag.pill : tag.name;
}

function sameSpot(one: Tag, two: Tag): boolean {
  const a = spotOf(one);
  const b = spotOf(two);

  return (
    Math.abs(a.x - b.x) <= SLACK_PX &&
    Math.abs(a.y - b.y) <= SLACK_PX &&
    Math.abs((one.pill?.x ?? 0) - (two.pill?.x ?? 0)) <= SLACK_PX &&
    Math.abs((one.pill?.y ?? 0) - (two.pill?.y ?? 0)) <= SLACK_PX &&
    one.compact === two.compact &&
    (one.lead === null) === (two.lead === null)
  );
}

function frameOf(room: Room): { left: number; top: number; width: number } {
  const xs = room.ring.map((point) => point.x);
  const ys = room.ring.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
  };
}

function heldStill({ before, open, closed }: Visit): string[] {
  const slug = open.tapped ?? '';
  const was = before.tags.get(slug);
  const now = open.tags.get(slug);
  const roomWas = before.rooms.get(slug);
  const roomNow = open.rooms.get(slug);

  if (open.quiet.includes(slug)) return returned(before, closed);
  if (!was || !now || !roomWas || !roomNow) {
    return [`${open.label}: ${slug} has no tag to follow`];
  }

  const from = frameOf(roomWas);
  const to = frameOf(roomNow);
  const scale = to.width / Math.max(from.width, 1);
  const still =
    Math.abs(scale - 1) < 0.001 &&
    Math.abs(from.left - to.left) <= SLACK_PX &&
    Math.abs(from.top - to.top) <= SLACK_PX;
  const found: string[] = [];

  const sheets = open.sheet ? [open.sheet] : [];
  const shifted = (part: MarkBox): MarkBox => ({
    ...part,
    x: to.left + (part.x - from.left) * scale,
    y: to.top + (part.y - from.top) * scale,
  });
  const wasUnder = partsOf(was).some((part) =>
    covered(inset(shifted(part), SLACK_PX), sheets),
  );

  if (open.covered) return returned(before, closed);

  if (
    now.veiled ||
    partsOf(now).some((part) => covered(inset(part, SLACK_PX), sheets))
  ) {
    found.push(`${open.label}: ${slug} is under its own sheet`);
  }

  if (still) {
    if (!wasUnder && !sameSpot(was, now)) {
      found.push(`${open.label}: ${slug} moved`);
    }

    for (const [other, tag] of before.tags) {
      const kept = open.tags.get(other);

      if (other === slug || !kept || kept.veiled) continue;
      if (partsOf(tag).some((part) => covered(part, sheets))) continue;
      if (!sameSpot(tag, kept)) found.push(`${open.label}: ${other} re-placed`);
    }
  } else {
    const a = spotOf(was);
    const b = spotOf(now);
    const expected = {
      x: to.left + (a.x - from.left) * scale,
      y: to.top + (a.y - from.top) * scale,
    };

    const rescaledOutside = was.lead !== null && Math.abs(scale - 1) >= 0.001;

    if (wasUnder || rescaledOutside) {
      return [...found, ...returned(before, closed)];
    }

    if (
      Math.hypot(expected.x - b.x, expected.y - b.y) > 2 ||
      was.compact !== now.compact ||
      (was.lead === null) !== (now.lead === null)
    ) {
      found.push(
        `${open.label}: ${slug} left its spot in its room by ${Math.round(Math.hypot(expected.x - b.x, expected.y - b.y))}px`,
      );
    }
  }

  return [...found, ...returned(before, closed)];
}

function leadLength(lead: Lead): number {
  return segmentsOf(lead).reduce(
    (sum, [from, to]) => sum + Math.hypot(to.x - from.x, to.y - from.y),
    0,
  );
}

function tappedNearItsRoom({ before, open }: Visit): string[] {
  const slug = open.tapped ?? '';
  const now = open.tags.get(slug);
  const reframed = before.rooms.size !== open.rooms.size;

  if (!reframed || open.covered || !now?.lead || now.veiled) return [];

  const long = leadLength(now.lead);
  const limit = TAPPED_LEAD_SHARE * Math.min(stage.width, stage.height);

  return long <= limit
    ? []
    : [
        `${open.label}: ${slug} sits ${Math.round(long)}px from its room after the tap re-framed the plan`,
      ];
}

function returned(before: Shot, closed: Shot): string[] {
  return [...before.tags].flatMap(([slug, tag]) => {
    const back = closed.tags.get(slug);

    return back && sameSpot(tag, back)
      ? []
      : [`${closed.label}: ${slug} did not come back`];
  });
}

function coveredOnlyWhenNarrow(shot: Shot): string[] {
  if (!shot.sheet) return [];

  const narrow = !sheetsBelow(viewport, stage) && dockCovers(stage);

  if (shot.covered === narrow) return [];

  return [
    narrow
      ? `${shot.label}: the docked sheet leaves the plan showing on a narrow card`
      : `${shot.label}: the sheet hides the plan where it should share the card`,
  ];
}

function oneStyle(shot: Shot): string[] {
  const byFloor = new Map<string, Tag[]>();

  for (const tag of shot.tags.values()) {
    if (tag.veiled) continue;

    byFloor.set(tag.floor, [...(byFloor.get(tag.floor) ?? []), tag]);
  }

  return [...byFloor].flatMap(([floor, tags]) => {
    const looks = new Set(
      tags.map((tag) =>
        tag.compact
          ? `compact ${tag.pill?.kind ?? ''} ${Math.round(tag.name.height)}`
          : `stacked ${tag.pill?.kind ?? ''} ${Math.round(tag.name.height)}`,
      ),
    );

    return looks.size > 1
      ? [`${shot.label}: ${floor} mixes ${[...looks].join(' / ')}`]
      : [];
  });
}

describe.each(dashboards)('the room tags on the $name card', (dashboard) => {
  const choices: [string, string][] = [
    ...floors.map((floor): [string, string] => [floor.id, floor.id]),
    ['all floors', 'all'],
  ];

  describe.each(choices)('showing %s', (shown, floor) => {
    const shots: Shot[] = [];
    const visits: Visit[] = [];

    beforeAll(async () => {
      vi.useFakeTimers({
        now: new Date(2026, 8, 27, 12, 0),
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

      const card = await mountCard(dashboard);

      await showFloor(card, floor);

      const storeys = floors.filter(
        (candidate) => floor === 'all' || candidate.id === floor,
      );
      const before = shoot(card, `${dashboard.name}, ${shown}`, null);

      shots.push(before);

      for (const storey of storeys) {
        for (const slug of sheetRooms(storey)) {
          const drawn = shoot(card, `${dashboard.name}, ${shown}`, null);

          if (!drawn.rooms.has(slug)) await turnTo(card, storey.id);

          const start = shoot(card, `${dashboard.name}, ${shown}`, null);

          await tapRoom(card, slug);

          const open = shoot(
            card,
            `${dashboard.name}, ${shown}, ${slug} sheet`,
            slug,
          );

          await closeSheet(card);

          const closed = shoot(
            card,
            `${dashboard.name}, ${shown}, ${slug} closed`,
            null,
          );

          shots.push(open);
          visits.push({ before: start, open, closed });
        }
      }

      card.remove();
    }, SPEC_TIMEOUT_MS);

    afterAll(() => {
      document.body.replaceChildren();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const visible = (): Shot[] => shots.filter((shot) => !shot.covered);

    it('hides the plan under the sheet only on a card that could not keep 40% of it free', () => {
      expect(shots.flatMap(coveredOnlyWhenNarrow)).toEqual([]);
    });

    it('drops a name for a bare reading only on a masonry card under 400 px', () => {
      const crowded =
        dashboard.layout === undefined && dashboard.stage.width < 400;
      const dropped = shots.flatMap((shot) =>
        shot.quiet.map((slug) => `${shot.label}: ${slug} lost its name`),
      );

      expect(crowded ? [] : dropped).toEqual([]);
    });

    it('gives every room exactly one tag', () => {
      expect(visible().flatMap(oneTagEach)).toEqual([]);
    });

    it('keeps every name and its pill together', () => {
      expect(visible().flatMap(together)).toEqual([]);
    });

    it('keeps every tag off glyphs, marks, stairs, other tags, the caption and the controls', () => {
      expect(visible().flatMap(clearOfEverything)).toEqual([]);
    });

    it('never crosses one leader with another', () => {
      expect(visible().flatMap(leadersApart)).toEqual([]);
    });

    it('crosses no wall except by a leader out through its own wall', () => {
      expect(visible().flatMap(withinWalls)).toEqual([]);
    });

    it('moves the tapped room tag only out from under its sheet, and re-places nothing else the sheet leaves free', () => {
      expect(visits.flatMap(heldStill)).toEqual([]);
    });

    it('keeps the tapped room tag beside its room when the tap re-frames the plan', () => {
      expect(visits.flatMap(tappedNearItsRoom)).toEqual([]);
    });

    it('draws one style and one size per storey', () => {
      expect(visible().flatMap(oneStyle)).toEqual([]);
    });
  });
});
