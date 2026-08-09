import type { Point } from './gesture.js';
import {
  boxInside,
  type Budget,
  covered,
  insidePolygon,
  LABEL_GAP,
  LABEL_HEIGHT,
  labelWidth,
  LEADER_REACH_PX,
  type MarkBox,
  overlapsRing,
  pillInside,
  SMALL_LABEL_HEIGHT,
  spotsAround,
  TABLET_LABEL_HEIGHT,
  TABLET_LABEL_SCALE,
} from './living.js';
import { NAME_STACK_GAP_PX } from './plan.js';

export type PillKind = 'large' | 'normal' | 'small';

export type TagTier = {
  px: number;
  pill: PillKind;
  compact: boolean;
  bare?: boolean;
};

export type TagRoom = {
  slug: string;
  label: string;
  reading: string | null;
  centre: Point;
  ring: readonly Point[];
  inner: readonly Point[];
  outer: boolean;
  storey?: string;
};

export type RoomTag = {
  slug: string;
  label: string;
  reading: string | null;
  tier: TagTier;
  name: MarkBox;
  pill: MarkBox | null;
  text: string;
  lead: Point | null;
  bend: Point | null;
  loose: boolean;
  quiet?: boolean;
  stranded?: boolean;
};

export type TagRules = { reach: number; crowded: boolean };

export type TagLabel = Point & {
  key: string;
  text: string;
  kind: PillKind;
  compact: boolean;
};

export type TagPin = {
  slug: string;
  at: Point;
  tier: TagTier;
  lead: Point | null;
  bend: Point | null;
  loose: boolean;
  quiet?: boolean;
};

export type TagArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TagField = {
  hard: readonly MarkBox[];
  beneath: readonly MarkBox[];
  glyphs: readonly MarkBox[];
  soft: readonly MarkBox[];
  furniture: readonly MarkBox[];
  rings: readonly (readonly Point[])[];
  area: TagArea;
  measure: (text: string, px: number) => number;
  lineHeight: (px: number) => number;
};

type Parts = { name: MarkBox; pill: MarkBox | null; block: MarkBox };

type Raster = {
  left: number;
  top: number;
  cols: number;
  rows: number;
  sums: Int32Array;
};

type Segment = { from: Point; to: Point };

type Side = 'left' | 'right' | 'top' | 'bottom';

type Reach = { dot: Point; depth: number; cost: number };

type Outsider = {
  room: TagRoom;
  shape: Parts;
  dots: Point[];
  rings: Ring[];
  reach: Map<Side, Reach>;
  tried: Set<Side>;
};

type Slot = { who: Outsider; want: number; at: number };

type Blocks = {
  hard: Raster;
  soft: Raster;
  line: Raster;
  bare: Raster;
  seen: Raster;
  tight: Raster;
  furniture: Raster;
  placed: MarkBox[];
  leads: Segment[];
  anchors: MarkBox[];
  area: TagArea;
  strict: boolean;
  reach: number;
};

type Placer = (
  rooms: readonly TagRoom[],
  field: TagField,
  tier: TagTier,
  pins: ReadonlyMap<string, TagPin>,
  budget: Budget,
  blocks: Blocks,
  last?: boolean,
) => RoomTag[] | null;

type Ring = { ring: readonly Point[]; bounds: TagArea };

export const NAME_PAD_PX = 6;
export const NAME_INK_SHARE = 0.8;
export const LARGE_TIER: TagTier = { px: 15, pill: 'large', compact: false };
export const COMPACT_TIER: TagTier = { px: 11.5, pill: 'small', compact: true };
export const VALUE_TIER: TagTier = { ...COMPACT_TIER, bare: true };
export const OPEN_RULES: TagRules = { reach: Infinity, crowded: false };
export const TAG_TIERS: readonly TagTier[] = [
  { px: 13, pill: 'normal', compact: false },
  { px: 12, pill: 'normal', compact: false },
  { px: 11, pill: 'small', compact: false },
  { px: 10, pill: 'small', compact: false },
  COMPACT_TIER,
];
const NARROW_TIER: TagTier = { px: 10, pill: 'small', compact: false };

const WALL_CLEAR_PX = 2;
const TAG_GAP_PX = 2;
const SOFT_REACH_PX = 40;
const ANCHOR_STEP_PX = 4;
const ANCHOR_DOT_PX = 6;
const ANCHOR_TRIES = 8;
const LINE_STEP_PX = 4;
const OUTSIDE_CLEAR_PX = 3;
const ROOM_WORK = 20_000;
const SPOT_WORK = 0.05;
const FAR_STEP_PX = 8;
const LOOSE_WORK = 16_000;
const LOOSE_REACH_PX = 600;
const SPOT_GRID_PX = 4;
const COMPACT_REACH_PX = 120;
const COMPACT_WORK = 40_000;
const STRAY_ROUNDS = 8;
const MARK_RIM_PX = 2;
const DOT_RIM_PX = 4;
const CELL_PX = 2;
const RASTER_MARGIN_PX = 400;
const SIDES: readonly Side[] = ['left', 'right', 'bottom', 'top'];
const SIDE_GAP_PX = 4;
const CARD_EDGE_PX = 3;
const SIDE_LOAD = 3;
const CROWD_COST = 10_000;
const ROW_GAP_PX = 5;
const RUN_PX = 6;
const CENTRE_PULL = 0.25;
const BOUNDARY_WORK = 60_000;
const CROSS_COST = 400;
const BOUNDARY_TURNS = 3;
const SIDE_SLACK_PX = 4;
const REACH_SLACK_PX = 8;

export function pillSize(text: string, kind: PillKind): MarkBox {
  if (kind === 'small') {
    return {
      x: 0,
      y: 0,
      width: labelWidth(text, true),
      height: SMALL_LABEL_HEIGHT,
    };
  }

  if (kind === 'large') {
    return {
      x: 0,
      y: 0,
      width: labelWidth(text) * TABLET_LABEL_SCALE,
      height: TABLET_LABEL_HEIGHT,
    };
  }

  return { x: 0, y: 0, width: labelWidth(text), height: LABEL_HEIGHT };
}

export function tagText(
  room: Pick<TagRoom, 'label' | 'reading'>,
  tier: TagTier,
): string {
  if (!tier.compact || tier.bare) return room.reading ?? '';

  return room.reading ? `${room.label} ${room.reading}` : room.label;
}

export function tagParts(tag: RoomTag): MarkBox[] {
  if (tag.tier.compact) return [tag.name];

  return tag.pill ? [tag.name, tag.pill] : [tag.name];
}

export function leaderStart(box: MarkBox, lead: Point): Point {
  const dx = lead.x - box.x;
  const dy = lead.y - box.y;
  const share = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
    1,
  );

  return { x: box.x + dx * share, y: box.y + dy * share };
}

export function leaderPath(
  box: MarkBox,
  lead: Point,
  bend: Point | null = null,
): Point[] {
  return bend
    ? [leaderStart(box, bend), bend, lead]
    : [leaderStart(box, lead), lead];
}

export function leaderSteps(
  box: MarkBox,
  lead: Point,
  bend: Point | null = null,
): Point[] {
  const path = leaderPath(box, lead, bend);

  return [
    ...path.slice(1).flatMap((to, index) => {
      const from = path[index];
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / LINE_STEP_PX),
      );

      return Array.from({ length: steps }, (_, step) => ({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      }));
    }),
    lead,
  ];
}

function segmentsOf(path: readonly Point[]): Segment[] {
  return path.slice(1).map((to, index) => ({ from: path[index], to }));
}

export function tagSpot(tag: RoomTag): Point {
  return { x: tag.name.x, y: tag.name.y };
}

export function layoutTags(
  rooms: readonly TagRoom[],
  field: TagField,
  tiers: readonly TagTier[],
  pin: TagPin | null,
  budget: Budget,
  kept: readonly TagPin[] = [],
  rules: TagRules = OPEN_RULES,
  hidden: readonly TagPin[] = [],
): RoomTag[] {
  const laid =
    kept.length === 0
      ? settle(rooms, field, tiers, pin, budget, rules)
      : tiers[0]?.bare
        ? keptValues(rooms, field, pin, kept)
        : layWith(rooms, field, tiers, pin, budget, kept, [], rules.reach);

  return laid.map((tag) => {
    const back = hidden.find((one) => one.slug === tag.slug);
    const room = rooms.find((one) => one.slug === tag.slug);

    if (!back || !room || tagFaults(tag, laid, rooms, field, rules) === 0) {
      return tag;
    }

    return pinnedTag(room, back.tier, shapeOf(room, back.tier, field), back);
  });
}

function settle(
  rooms: readonly TagRoom[],
  field: TagField,
  tiers: readonly TagTier[],
  pin: TagPin | null,
  budget: Budget,
  rules: TagRules,
): RoomTag[] {
  const work = budget.work;
  let tags = layWith(rooms, field, tiers, pin, budget, [], [], null);

  for (const own of storeysOf(rooms)) {
    const count = faults(tags, own, rooms, field, rules);

    if (count === 0) continue;

    const slugs = new Set(own.map((room) => room.slug));
    const others = tags.filter((tag) => !slugs.has(tag.slug));
    const held = pin && slugs.has(pin.slug) ? pin : null;
    const next = [
      ...others,
      ...layWith(own, field, tiers, held, { work }, [], others, rules.reach),
    ];
    const left = faults(next, own, rooms, field, rules);

    if (left > 0 && rules.crowded) {
      let good = layWith(
        own.filter((room) => room.reading !== null),
        field,
        [VALUE_TIER],
        held,
        { work },
        [],
        others,
        rules.reach,
      );

      for (let round = 0; round < own.length; round += 1) {
        const sound = good.filter(
          (tag) =>
            tagFaults(tag, [...others, ...good], rooms, field, rules) === 0,
        );

        if (sound.length === good.length) break;

        good = sound;
      }

      const placed = new Set(good.map((tag) => tag.slug));
      const rest = own.filter((room) => !placed.has(room.slug));

      tags = [
        ...others,
        ...good,
        ...valueTags(rest, field, [...others, ...good]),
      ];

      continue;
    }

    const narrow =
      left > 0
        ? [
            ...others,
            ...layWith(
              own,
              field,
              [NARROW_TIER],
              held,
              { work },
              [],
              others,
              rules.reach,
            ),
          ]
        : next;
    const rest =
      narrow === next ? left : faults(narrow, own, rooms, field, rules);

    if (rest < Math.min(left, count)) tags = narrow;
    else if (left < count) tags = next;
  }

  return tags;
}

function storeysOf(rooms: readonly TagRoom[]): TagRoom[][] {
  const storeys = new Map<string | undefined, TagRoom[]>();

  for (const room of rooms) {
    storeys.set(room.storey, [...(storeys.get(room.storey) ?? []), room]);
  }

  return [...storeys.values()];
}

function layWith(
  rooms: readonly TagRoom[],
  field: TagField,
  tiers: readonly TagTier[],
  pin: TagPin | null,
  budget: Budget,
  kept: readonly TagPin[],
  fixed: readonly RoomTag[],
  reach: number | null,
): RoomTag[] {
  const strict = reach !== null;
  const place: Placer = strict ? placeAll : placeFirst;
  const pinned = pin ? rooms.find((room) => room.slug === pin.slug) : undefined;
  const ordered = [...rooms].sort(
    (one, two) =>
      Number(two.slug === pinned?.slug) - Number(one.slug === pinned?.slug) ||
      areaOf(one.inner) - areaOf(two.inner) ||
      one.slug.localeCompare(two.slug),
  );
  const held = pinned && pin ? pin : null;
  const choices = held ? tiersFrom(tiers, held.tier) : tiers;
  const area = rasterArea(rooms, field.area);
  const hard = rasterOf(
    [...field.hard, ...field.beneath, ...field.glyphs],
    area,
    LABEL_GAP,
  );
  const soft = rasterOf(field.soft, area, LABEL_GAP);
  const bare = rasterOf(field.hard, area, 0);
  const grow = (boxes: readonly MarkBox[], by: number) =>
    boxes.map((box) => ({
      ...box,
      width: box.width + 2 * by,
      height: box.height + 2 * by,
    }));
  const tight = rasterOf(
    [
      ...grow(field.hard, LABEL_GAP),
      ...grow([...field.beneath, ...field.glyphs], TAG_GAP_PX),
    ],
    area,
    0,
  );
  const seen = rasterOf(
    [
      ...field.hard,
      ...[...field.beneath, ...field.glyphs].map((mark) => ({
        ...mark,
        width: mark.width - 2 * MARK_RIM_PX,
        height: mark.height - 2 * MARK_RIM_PX,
      })),
    ],
    area,
    0,
  );
  const line = rasterOf(
    [
      ...field.hard,
      ...field.beneath,
      ...field.glyphs.map((glyph) => ({
        ...glyph,
        width: glyph.width + 2 * LABEL_GAP,
        height: glyph.height + 2 * LABEL_GAP,
      })),
    ],
    area,
    0,
  );
  const furniture = rasterOf(field.furniture, area, 0);
  const blocks = (): Blocks => {
    const made: Blocks = {
      hard,
      soft,
      line,
      bare,
      seen,
      tight,
      furniture,
      placed: [],
      leads: [],
      anchors: [],
      area: field.area,
      strict,
      reach: reach ?? Infinity,
    };

    for (const tag of fixed) hold(made, tag);

    return made;
  };
  const pins = new Map([
    ...kept.map((one): [string, TagPin] => [one.slug, one]),
    ...(held ? [[held.slug, held] as [string, TagPin]] : []),
  ]);

  for (const tier of choices) {
    const tags = place(ordered, field, tier, pins, budget, blocks());

    if (tags && tier.compact) {
      return strayFirst(ordered, held?.slug, tags, (order) =>
        place(order, field, tier, pins, budget, blocks()),
      );
    }
    if (tags) return tags;
  }

  const last = choices.at(-1) ?? COMPACT_TIER;

  return place(ordered, field, last, pins, budget, blocks(), true) ?? [];
}

function placeFirst(
  rooms: readonly TagRoom[],
  field: TagField,
  tier: TagTier,
  pins: ReadonlyMap<string, TagPin>,
  budget: Budget,
  blocks: Blocks,
  last = false,
): RoomTag[] | null {
  const tags: RoomTag[] = [];
  const loose = tier.compact || last;
  let waiting = rooms.length;

  for (const room of rooms) {
    const allowance = Math.min(
      budget.work,
      Math.max(budget.work / Math.max(waiting, 1), ROOM_WORK),
    );
    const share: Budget = { work: allowance };
    const shape = shapeOf(room, tier, field);
    const pin = pins.get(room.slug);

    waiting -= 1;

    const tag = pin
      ? pinnedTag(room, tier, shape, pin)
      : (insideTag(room, tier, shape, blocks, share) ??
        (loose ? strayTag(room, tier, field, blocks, share) : null));

    budget.work -= allowance - Math.max(share.work, 0);

    if (!tag) return null;

    tags.push(tag);
    hold(blocks, tag);
  }

  return tags;
}

function valueTags(
  rooms: readonly TagRoom[],
  field: TagField,
  others: readonly RoomTag[],
): RoomTag[] {
  const blocks = valueBlocks(rooms, field, others);

  return [...rooms]
    .sort((one, two) => areaOf(one.inner) - areaOf(two.inner))
    .map((room) => {
      const shape = shapeOf(room, VALUE_TIER, field);
      const tag =
        room.reading === null
          ? null
          : insideTag(room, VALUE_TIER, shape, blocks, { work: ROOM_WORK });

      if (!tag) return quietTag(room, shape);

      hold(blocks, tag);

      return tag;
    });
}

function keptValues(
  rooms: readonly TagRoom[],
  field: TagField,
  pin: TagPin | null,
  kept: readonly TagPin[],
): RoomTag[] {
  const pins = new Map(kept.map((one) => [one.slug, one]));

  if (pin) pins.set(pin.slug, pin);

  const fixed = rooms.flatMap((room) => {
    const one = pins.get(room.slug);

    return one
      ? [pinnedTag(room, one.tier, shapeOf(room, one.tier, field), one)]
      : [];
  });
  const loose = rooms.filter((room) => !pins.has(room.slug));

  return [...fixed, ...valueTags(loose, field, fixed)];
}

function valueBlocks(
  rooms: readonly TagRoom[],
  field: TagField,
  others: readonly RoomTag[],
): Blocks {
  const area = rasterArea(rooms, field.area);
  const grow = (boxes: readonly MarkBox[], by: number) =>
    boxes.map((box) => ({
      ...box,
      width: box.width + 2 * by,
      height: box.height + 2 * by,
    }));
  const hard = rasterOf(
    [
      ...grow(field.hard, LABEL_GAP),
      ...grow([...field.beneath, ...field.glyphs], TAG_GAP_PX),
    ],
    area,
    0,
  );
  const blocks: Blocks = {
    hard,
    soft: rasterOf(field.soft, area, LABEL_GAP),
    line: hard,
    bare: hard,
    seen: hard,
    tight: hard,
    furniture: rasterOf(field.furniture, area, 0),
    placed: [],
    leads: [],
    anchors: [],
    area: field.area,
    strict: true,
    reach: Infinity,
  };

  for (const tag of others) hold(blocks, tag);

  return blocks;
}

function quietTag(room: TagRoom, shape: Parts): RoomTag {
  const parts = partsAt(shape, blockAtSpot(shape, room.centre, true), true);

  return { ...tagOf(room, VALUE_TIER, parts, null), quiet: true };
}

function faults(
  tags: readonly RoomTag[],
  own: readonly TagRoom[],
  rooms: readonly TagRoom[],
  field: TagField,
  rules: TagRules,
): number {
  const lost = own.filter(
    (room) => !tags.some((tag) => tag.slug === room.slug),
  ).length;

  return own.reduce((count, room) => {
    const tag = tags.find((one) => one.slug === room.slug);

    return tag ? count + tagFaults(tag, tags, rooms, field, rules) : count;
  }, lost);
}

function tagFaults(
  tag: RoomTag,
  tags: readonly RoomTag[],
  rooms: readonly TagRoom[],
  field: TagField,
  rules: TagRules,
): number {
  const room = rooms.find((one) => one.slug === tag.slug);

  if (tag.quiet || !room) return 0;

  const shown = tags.filter((one) => !one.quiet);
  const house = houseOf(rooms, room.storey);
  const houses = storeysOf(rooms)
    .filter((one) => one[0]?.storey !== room.storey)
    .map((one) => boxOfArea(houseOf(rooms, one[0]?.storey)));
  const blocking = [...field.hard, ...field.beneath, ...field.glyphs];
  const parts = tagParts(tag);
  const path = pathOf(tag);
  const others = shown.filter((one) => one.slug !== tag.slug);
  const steps = tag.lead
    ? leaderSteps(tag.name, tag.lead, tag.bend)
        .slice(1, -1)
        .map((step) => ({ ...step, width: 0, height: 0 }))
    : [];
  const strayed = parts.some((part) =>
    samplesOf(part).some((at) =>
      tag.lead
        ? rooms.some(
            (other) =>
              other.slug !== room.slug && insidePolygon(at, other.ring),
          )
        : !insidePolygon(at, room.ring),
    ),
  );
  const broken = [
    parts.some((part) => !withinArea(part, field.area)),
    parts.some((part) => under(part, blocking)),
    !tag.tier.compact &&
      under(
        {
          ...tag.name,
          width: tag.name.width - 2 * NAME_PAD_PX,
          height: tag.name.height * NAME_INK_SHARE,
        },
        field.furniture,
      ),
    strayed,
    others.some((other) =>
      tagParts(other).some((part) => under(part, parts) || under(part, steps)),
    ),
    segmentsOf(path).some((one) =>
      others.some((other) =>
        segmentsOf(pathOf(other)).some((two) => segmentsCross(one, two)),
      ),
    ),
    tag.lead !== null && lengthOf(path) > rules.reach - REACH_SLACK_PX,
    tag.lead !== null &&
      wrongSide(
        tag,
        house,
        field.area,
        [
          ...field.hard,
          ...[...field.beneath, ...field.glyphs].map((mark) => ({
            ...mark,
            width: mark.width - 2 * DOT_RIM_PX,
            height: mark.height - 2 * DOT_RIM_PX,
          })),
          ...others.flatMap(tagParts),
          ...houses,
        ],
        rules.reach - REACH_SLACK_PX,
      ),
  ];

  return broken.filter(Boolean).length;
}

function pathOf(tag: RoomTag): Point[] {
  return tag.lead ? leaderPath(tag.name, tag.lead, tag.bend) : [];
}

function samplesOf(box: MarkBox): Point[] {
  const left = box.x - box.width / 2;
  const top = box.y - box.height / 2;

  return [0.04, 0.5, 0.96].flatMap((across) =>
    [0.1, 0.5, 0.9].map((down) => ({
      x: left + box.width * across,
      y: top + box.height * down,
    })),
  );
}

function lengthOf(path: readonly Point[]): number {
  return segmentsOf(path).reduce(
    (sum, { from, to }) => sum + Math.hypot(to.x - from.x, to.y - from.y),
    0,
  );
}

function wrongSide(
  tag: RoomTag,
  house: TagArea,
  area: TagArea,
  taken: readonly MarkBox[],
  reach: number,
): boolean {
  const { name, lead } = tag;
  const out: [Side, number][] = [
    ['left', house.left - name.x],
    ['right', name.x - house.right],
    ['top', house.top - name.y],
    ['bottom', name.y - house.bottom],
  ];
  const [side, by] = out.reduce((best, next) =>
    next[1] > best[1] ? next : best,
  );

  if (by <= 0 || !lead) return false;

  const room = (one: Side): boolean => {
    const vertical = one === 'left' || one === 'right';
    const from = vertical ? house.top : house.left;
    const to = vertical ? house.bottom : house.right;
    const depth = SIDE_GAP_PX + (vertical ? name.width : name.height) / 2;

    for (let at = from; at <= to; at += ANCHOR_STEP_PX) {
      const slot = {
        x:
          one === 'left'
            ? house.left - depth
            : one === 'right'
              ? house.right + depth
              : at,
        y:
          one === 'top'
            ? house.top - depth
            : one === 'bottom'
              ? house.bottom + depth
              : at,
        width: name.width + 2 * TAG_GAP_PX,
        height: name.height + 2 * TAG_GAP_PX,
      };

      if (Math.hypot(slot.x - lead.x, slot.y - lead.y) > reach) continue;
      if (
        withinArea({ ...slot, width: name.width, height: name.height }, area) &&
        !under(slot, taken)
      )
        return true;
    }

    return false;
  };
  const free = SIDES.filter((one) => one === side || room(one));
  const nearest = Math.min(...free.map((one) => depthOf(one, lead, house)));

  return (
    free.includes(side) && depthOf(side, lead, house) > nearest + SIDE_SLACK_PX
  );
}

const fallbacks = new WeakSet<RoomTag>();

function fallback(tag: RoomTag): RoomTag {
  fallbacks.add(tag);

  return tag;
}

function strays(tags: readonly RoomTag[]): number {
  return tags.filter((tag) => fallbacks.has(tag)).length;
}

function strayFirst(
  rooms: readonly TagRoom[],
  held: string | undefined,
  first: RoomTag[],
  lay: (order: readonly TagRoom[]) => RoomTag[] | null,
): RoomTag[] {
  let best = first;
  let latest = first;
  const stray: string[] = [];

  for (let round = 0; round < STRAY_ROUNDS && strays(latest) > 0; round += 1) {
    for (const tag of latest) {
      if (!fallbacks.has(tag)) continue;
      if (stray.includes(tag.slug)) stray.splice(stray.indexOf(tag.slug), 1);

      stray.unshift(tag.slug);
    }

    const rank = (room: TagRoom): number =>
      room.slug === held
        ? -1
        : stray.includes(room.slug)
          ? stray.indexOf(room.slug)
          : stray.length;
    const next = lay([...rooms].sort((one, two) => rank(one) - rank(two)));

    if (!next) break;

    latest = next;

    if (strays(next) >= strays(best)) break;

    best = next;
  }

  return best;
}

function tiersFrom(
  tiers: readonly TagTier[],
  held: TagTier,
): readonly TagTier[] {
  if (held.compact) return [COMPACT_TIER];

  const stacked = tiers.filter((tier) => !tier.compact);
  const from = stacked.findIndex(
    (tier) => tier.px === held.px && tier.pill === held.pill,
  );

  return from < 0 ? [held] : stacked.slice(from);
}

function placeAll(
  rooms: readonly TagRoom[],
  field: TagField,
  tier: TagTier,
  pins: ReadonlyMap<string, TagPin>,
  budget: Budget,
  blocks: Blocks,
  last = false,
): RoomTag[] | null {
  const start = {
    placed: blocks.placed.length,
    leads: blocks.leads.length,
    anchors: blocks.anchors.length,
  };
  const settle = (early: ReadonlySet<string>): RoomTag[] | null => {
    const placed = new Map<string, RoomTag>();
    const outside: TagRoom[] = [];
    const loose = tier.compact || last;
    let waiting = rooms.length - pins.size;

    blocks.placed.length = start.placed;
    blocks.leads.length = start.leads;
    blocks.anchors.length = start.anchors;

    for (const room of rooms) {
      const pin = pins.get(room.slug);

      if (!pin) continue;

      const tag = pinnedTag(
        room,
        pin.tier,
        shapeOf(room, pin.tier, field),
        pin,
      );

      placed.set(room.slug, tag);
      hold(blocks, tag);
    }

    for (const room of rooms) {
      if (placed.has(room.slug)) continue;

      if (early.has(room.slug)) {
        const tag = strayTag(room, tier, field, blocks);

        placed.set(room.slug, tag);
        hold(blocks, tag);

        continue;
      }

      const allowance = Math.min(
        budget.work,
        Math.max(budget.work / Math.max(waiting, 1), ROOM_WORK),
      );
      const share: Budget = { work: allowance };
      const shape = shapeOf(room, tier, field);

      waiting -= 1;

      const tag = insideTag(room, tier, shape, blocks, share);

      budget.work -= allowance - Math.max(share.work, 0);

      if (tag) {
        placed.set(room.slug, tag);
        hold(blocks, tag);

        continue;
      }

      if (!loose) return null;

      outside.push(room);
    }

    for (const own of storeysOf(outside)) {
      const house = houseOf(rooms, own[0].storey);

      for (const tag of boundaryTags(own, field, tier, blocks, house, {
        work: BOUNDARY_WORK,
      })) {
        placed.set(tag.slug, tag);
      }
    }

    const left = outside.filter((room) => !placed.has(room.slug));

    if (left.length > 0 && early.size < rooms.length) {
      return settle(new Set([...early, ...left.map((room) => room.slug)]));
    }

    for (const room of left) {
      const tag = strayTag(room, tier, field, blocks);

      placed.set(room.slug, tag);
      hold(blocks, tag);
    }

    return rooms.flatMap((room) => {
      const tag = placed.get(room.slug);

      return tag ? [tag] : [];
    });
  };

  return settle(new Set());
}

function strayTag(
  room: TagRoom,
  tier: TagTier,
  field: TagField,
  blocks: Blocks,
  share: Budget = { work: ROOM_WORK },
): RoomTag {
  const shape = shapeOf(room, tier, field);

  if (!tier.compact) {
    return (
      outsideTag(room, tier, shape, field, blocks, share, false) ??
      outsideTag(room, tier, shape, field, blocks, share, true) ??
      looseTag(room, tier, shape, field, blocks, { work: LOOSE_WORK })
    );
  }

  return (
    compactTag(room, tier, shape, field, blocks, COMPACT_REACH_PX, {
      work: COMPACT_WORK,
    }) ??
    compactTag(room, tier, shape, field, blocks, LOOSE_REACH_PX, {
      work: COMPACT_WORK,
    }) ??
    fallback(looseTag(room, tier, shape, field, blocks, { work: LOOSE_WORK }))
  );
}

function houseOf(
  rooms: readonly TagRoom[],
  storey: string | undefined,
): TagArea {
  return boundsOf(
    rooms.filter((room) => room.storey === storey).flatMap((room) => room.ring),
  );
}

function boxOfArea(area: TagArea): MarkBox {
  return {
    x: (area.left + area.right) / 2,
    y: (area.top + area.bottom) / 2,
    width: area.right - area.left,
    height: area.bottom - area.top,
  };
}

function alongOf(side: Side, at: Point): number {
  return side === 'left' || side === 'right' ? at.y : at.x;
}

function depthOf(side: Side, at: Point, house: TagArea): number {
  if (side === 'left') return at.x - house.left;
  if (side === 'right') return house.right - at.x;
  if (side === 'top') return at.y - house.top;

  return house.bottom - at.y;
}

function lineOf(side: Side, house: TagArea): number {
  if (side === 'left') return house.left - SIDE_GAP_PX;
  if (side === 'right') return house.right + SIDE_GAP_PX;
  if (side === 'top') return house.top - SIDE_GAP_PX;

  return house.bottom + SIDE_GAP_PX;
}

function alongSize(side: Side, shape: Parts): number {
  return side === 'left' || side === 'right'
    ? shape.block.height
    : shape.block.width;
}

function fitsSide(
  side: Side,
  shape: Parts,
  house: TagArea,
  edge: TagArea,
): boolean {
  const line = lineOf(side, house);
  const { width, height } = shape.block;

  if (side === 'left') return line - width >= edge.left;
  if (side === 'right') return line + width <= edge.right;
  if (side === 'top') return line - height >= edge.top;

  return line + height <= edge.bottom;
}

function blockAt(side: Side, shape: Parts, house: TagArea, at: number): Point {
  const line = lineOf(side, house);
  const { width, height } = shape.block;

  if (side === 'left') return { x: line - width / 2, y: at };
  if (side === 'right') return { x: line + width / 2, y: at };
  if (side === 'top') return { x: at, y: line - height / 2 };

  return { x: at, y: line + height / 2 };
}

function reachOf(
  side: Side,
  dots: readonly Point[],
  room: TagRoom,
  rings: readonly Ring[],
  house: TagArea,
): Reach | null {
  let best: Reach | null = null;

  for (const dot of dots) {
    const depth = depthOf(side, dot, house);
    const cost =
      CROSS_COST * roomsCrossed([dot, outOf(side, dot, house)], room, rings) +
      depth +
      CENTRE_PULL * Math.abs(alongOf(side, dot) - alongOf(side, room.centre));

    if (!best || cost < best.cost) best = { dot, depth, cost };
  }

  return best;
}

function outOf(side: Side, at: Point, house: TagArea): Point {
  const line = lineOf(side, house);

  return side === 'left' || side === 'right'
    ? { x: line, y: at.y }
    : { x: at.x, y: line };
}

function roomsCrossed(
  path: readonly Point[],
  room: TagRoom,
  rings: readonly Ring[],
): number {
  const crossed = new Set<Ring>();

  for (const { from, to } of segmentsOf(path)) {
    const span = {
      left: Math.min(from.x, to.x),
      top: Math.min(from.y, to.y),
      right: Math.max(from.x, to.x),
      bottom: Math.max(from.y, to.y),
    };
    const near = rings.filter(({ bounds }) => overlapping(bounds, span));
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / LINE_STEP_PX),
    );

    for (let step = 0; step <= count && near.length > 0; step += 1) {
      const at = {
        x: from.x + ((to.x - from.x) * step) / count,
        y: from.y + ((to.y - from.y) * step) / count,
      };

      if (insidePolygon(at, room.ring)) continue;

      for (const other of near) {
        if (insidePolygon(at, other.ring)) crossed.add(other);
      }
    }
  }

  return crossed.size;
}

function boundaryTags(
  rooms: readonly TagRoom[],
  field: TagField,
  tier: TagTier,
  blocks: Blocks,
  house: TagArea,
  budget: Budget,
): RoomTag[] {
  if (rooms.length === 0) return [];

  const area = rasterArea(rooms, blocks.area);
  const edge = {
    left: area.left + CARD_EDGE_PX,
    top: area.top + CARD_EDGE_PX,
    right: area.right - CARD_EDGE_PX,
    bottom: area.bottom - CARD_EDGE_PX,
  };
  const sides = tier.compact ? SIDES : SIDES.filter((side) => side !== 'top');
  const outsiders = rooms.flatMap((room): Outsider[] => {
    if (room.inner.length < 3) return [];

    const shape = shapeOf(room, tier, field);
    const dots = anchorDots(room, blocks, budget, blocks.seen);
    const rings = ringsOf(field, room);
    const reach = new Map<Side, Reach>();

    for (const side of sides) {
      const best = fitsSide(side, shape, house, edge)
        ? reachOf(side, dots, room, rings, house)
        : null;

      if (best) reach.set(side, best);
    }

    return reach.size > 0
      ? [{ room, shape, dots, rings, reach, tried: new Set() }]
      : [];
  });
  const held = {
    placed: blocks.placed.length,
    leads: blocks.leads.length,
    anchors: blocks.anchors.length,
  };
  const attempt = (first: readonly Outsider[]): RoomTag[] => {
    blocks.placed.length = held.placed;
    blocks.leads.length = held.leads;
    blocks.anchors.length = held.anchors;

    return assignSides(
      outsiders,
      first,
      sides,
      tier,
      house,
      edge,
      blocks,
      budget,
    );
  };
  let first: Outsider[] = [];
  let best = { first, count: -1 };

  for (let turn = 0; turn < BOUNDARY_TURNS; turn += 1) {
    const tags = attempt(first);

    if (tags.length > best.count) best = { first, count: tags.length };
    if (tags.length === outsiders.length) return tags;

    const left = outsiders.filter(
      (one) => !tags.some((tag) => tag.slug === one.room.slug),
    );

    first = [...left, ...first.filter((one) => !left.includes(one))];
  }

  return attempt(best.first);
}

function assignSides(
  outsiders: readonly Outsider[],
  first: readonly Outsider[],
  sides: readonly Side[],
  tier: TagTier,
  house: TagArea,
  edge: TagArea,
  blocks: Blocks,
  budget: Budget,
): RoomTag[] {
  const nearest = (one: Outsider): number =>
    Math.min(...[...one.reach.values()].map((reach) => reach.cost));
  const rank = (one: Outsider): number =>
    first.includes(one) ? first.indexOf(one) : first.length;
  const queue = [...outsiders].sort(
    (one, two) =>
      rank(one) - rank(two) ||
      nearest(one) - nearest(two) ||
      one.room.slug.localeCompare(two.room.slug),
  );
  const load = new Map<Side, Outsider[]>(sides.map((side) => [side, []]));
  const held = {
    placed: blocks.placed.length,
    leads: blocks.leads.length,
    anchors: blocks.anchors.length,
  };
  let tags: RoomTag[] = [];

  for (const one of outsiders) one.tried.clear();

  for (let round = 0; round < SIDES.length && queue.length > 0; round += 1) {
    for (const one of queue.splice(0)) {
      const side = pickSide(one, load);

      if (side) {
        one.tried.add(side);
        load.get(side)?.push(one);
      }
    }

    blocks.placed.length = held.placed;
    blocks.leads.length = held.leads;
    blocks.anchors.length = held.anchors;
    tags = [];

    for (const side of sides) {
      const members = load.get(side) ?? [];

      if (members.length === 0) continue;

      const { laid, left } = layColumn(
        side,
        members,
        tier,
        house,
        edge,
        blocks,
        budget,
        rank,
      );

      for (const tag of laid) {
        tags.push(tag);
        hold(blocks, tag);
      }

      queue.push(...left);
      load.set(
        side,
        members.filter((one) => !left.includes(one)),
      );
    }
  }

  return tags;
}

function pickSide(
  one: Outsider,
  load: ReadonlyMap<Side, readonly Outsider[]>,
): Side | null {
  let best: Side | null = null;
  let cost = Infinity;

  for (const [side, reach] of one.reach) {
    if (one.tried.has(side)) continue;

    const crowded = (load.get(side)?.length ?? 0) >= SIDE_LOAD;
    const next = reach.cost + (crowded ? CROWD_COST : 0);

    if (next < cost) {
      cost = next;
      best = side;
    }
  }

  return best;
}

function layColumn(
  side: Side,
  members: readonly Outsider[],
  tier: TagTier,
  house: TagArea,
  edge: TagArea,
  blocks: Blocks,
  budget: Budget,
  rank: (one: Outsider) => number,
): { laid: RoomTag[]; left: Outsider[] } {
  const near = layColumnAt(
    side,
    members,
    tier,
    house,
    edge,
    blocks,
    budget,
    rank,
  );
  const deep = Math.max(
    0,
    ...members.map((one) =>
      side === 'left' || side === 'right'
        ? one.shape.block.width
        : one.shape.block.height,
    ),
  );
  const slack = {
    left: house.left - SIDE_GAP_PX - deep - edge.left,
    right: edge.right - house.right - SIDE_GAP_PX - deep,
    top: house.top - SIDE_GAP_PX - deep - edge.top,
    bottom: edge.bottom - house.bottom - SIDE_GAP_PX - deep,
  }[side];

  if (near.left.length === 0 || slack < 1) return near;

  const pushed = {
    ...house,
    [side]:
      side === 'left' || side === 'top'
        ? house[side] - slack
        : house[side] + slack,
  };
  const held = {
    placed: blocks.placed.length,
    leads: blocks.leads.length,
    anchors: blocks.anchors.length,
  };

  for (const tag of near.laid) hold(blocks, tag);

  const far = layColumnAt(
    side,
    near.left,
    tier,
    pushed,
    edge,
    blocks,
    budget,
    rank,
  );

  blocks.placed.length = held.placed;
  blocks.leads.length = held.leads;
  blocks.anchors.length = held.anchors;

  return { laid: [...near.laid, ...far.laid], left: far.left };
}

function layColumnAt(
  side: Side,
  members: readonly Outsider[],
  tier: TagTier,
  house: TagArea,
  edge: TagArea,
  blocks: Blocks,
  budget: Budget,
  rank: (one: Outsider) => number,
): { laid: RoomTag[]; left: Outsider[] } {
  const vertical = side === 'left' || side === 'right';
  const start = vertical ? edge.top : edge.left;
  const end = vertical ? edge.bottom : edge.right;
  const lines = blocks.leads.flatMap(({ from, to }) =>
    leaderSteps({ ...from, width: 0, height: 0 }, to).map((step) => ({
      ...step,
      width: LINE_STEP_PX,
      height: LINE_STEP_PX,
    })),
  );
  const free = (one: Outsider, at: number): boolean => {
    const parts = partsAt(
      one.shape,
      blockAt(side, one.shape, house, at),
      tier.compact,
    );

    budget.work -= 1;

    return partsList(parts, tier.compact).every(
      (box) =>
        withinArea(box, edge) &&
        !rasterHits(blocks.tight, box) &&
        !covered(box, blocks.placed) &&
        !under(box, lines) &&
        offRings(box, one.rings),
    );
  };
  let slots: Slot[] = [...members]
    .map((who) => {
      const reach = who.reach.get(side);
      const want = reach ? alongOf(side, reach.dot) : 0;

      return { who, want, at: want };
    })
    .sort((one, two) => one.want - two.want);
  const left: Outsider[] = [];

  while (slots.length > 0 && !stack(slots, side, start, end, free)) {
    const depth = (slot: Slot): number => slot.who.reach.get(side)?.depth ?? 0;
    const deepest = slots.reduce((kept, next) =>
      rank(next.who) > rank(kept.who) ||
      (rank(next.who) === rank(kept.who) && depth(next) > depth(kept))
        ? next
        : kept,
    );

    left.push(deepest.who);
    slots = slots.filter((slot) => slot !== deepest);
  }

  const laid: RoomTag[] = [];
  const leads: Segment[] = [];

  const boxes = slots.map((slot) =>
    partsList(
      partsAt(
        slot.who.shape,
        blockAt(side, slot.who.shape, house, slot.at),
        tier.compact,
      ),
      tier.compact,
    ),
  );

  for (const [index, slot] of slots.entries()) {
    const siblings = boxes.flatMap((parts, other) =>
      other === index ? [] : parts,
    );
    const tag = leadHome(slot, side, tier, house, blocks, leads, siblings);

    if (!tag) {
      left.push(slot.who);

      continue;
    }

    laid.push(tag);

    if (tag.lead) {
      leads.push(...segmentsOf(leaderPath(tag.name, tag.lead, tag.bend)));
    }
  }

  return { laid, left };
}

function stack(
  slots: Slot[],
  side: Side,
  start: number,
  end: number,
  free: (one: Outsider, at: number) => boolean,
): boolean {
  const half = (slot: Slot): number => alongSize(side, slot.who.shape) / 2;
  let cursor = start;

  for (const slot of slots) {
    let at = Math.max(slot.want, cursor + half(slot));

    while (at + half(slot) <= end && !free(slot.who, at)) at += 1;

    slot.at = at;
    cursor = at + half(slot) + ROW_GAP_PX;
  }

  if (slots.every((slot) => slot.at + half(slot) <= end)) return true;

  cursor = end;

  for (const slot of [...slots].reverse()) {
    let at = Math.min(slot.at, cursor - half(slot));

    while (at - half(slot) >= start && !free(slot.who, at)) at -= 1;

    if (at - half(slot) < start) return false;

    slot.at = at;
    cursor = at - half(slot) - ROW_GAP_PX;
  }

  return true;
}

function leadHome(
  slot: Slot,
  side: Side,
  tier: TagTier,
  house: TagArea,
  blocks: Blocks,
  leads: readonly Segment[],
  siblings: readonly MarkBox[],
): RoomTag | null {
  const { room, shape, dots, rings } = slot.who;
  const parts = partsAt(
    shape,
    blockAt(side, shape, house, slot.at),
    tier.compact,
  );
  const vertical = side === 'left' || side === 'right';
  const level = alongOf(side, parts.name);
  const toward = side === 'left' || side === 'top' ? 1 : -1;
  const ranked = [...dots].sort(
    (one, two) =>
      depthOf(side, one, house) +
      2 * Math.abs(alongOf(side, one) - level) -
      (depthOf(side, two, house) + 2 * Math.abs(alongOf(side, two) - level)),
  );

  let best: { tag: RoomTag; crossed: number } | null = null;

  for (const dot of ranked.slice(0, ANCHOR_TRIES * 4)) {
    const off = alongOf(side, dot) - level;
    const straight = Math.abs(off) <= ANCHOR_STEP_PX / 2;
    const lead = straight
      ? vertical
        ? { x: dot.x, y: level }
        : { x: level, y: dot.y }
      : dot;
    const bend = straight
      ? null
      : bendFor(side, parts.name, lead, Math.abs(off), toward);
    const path = leaderPath(parts.name, lead, bend);

    if (lengthOf(path) > blocks.reach - REACH_SLACK_PX) continue;
    if (!pathClear(path, tier, blocks, leads, siblings)) continue;

    const crossed = roomsCrossed(path, room, rings);

    if (!best || crossed < best.crossed) {
      best = { tag: tagOf(room, tier, parts, lead, false, bend), crossed };
    }

    if (crossed === 0) break;
  }

  return best?.tag ?? null;
}

function bendFor(
  side: Side,
  name: MarkBox,
  lead: Point,
  off: number,
  toward: number,
): Point | null {
  const vertical = side === 'left' || side === 'right';
  const edge = vertical
    ? name.x + (toward * name.width) / 2
    : name.y + (toward * name.height) / 2;
  const deep = vertical ? lead.x : lead.y;
  const at =
    toward > 0
      ? Math.max(edge + RUN_PX, deep - off)
      : Math.min(edge - RUN_PX, deep + off);

  if (toward > 0 ? at > deep : at < deep) return null;

  return vertical ? { x: at, y: name.y } : { x: name.x, y: at };
}

function pathClear(
  path: readonly Point[],
  tier: TagTier,
  blocks: Blocks,
  leads: readonly Segment[],
  siblings: readonly MarkBox[],
): boolean {
  const segments = segmentsOf(path);
  const tags = [...blocks.placed, ...siblings];
  const others = [...blocks.leads, ...leads];

  if (segments.some((one) => others.some((two) => segmentsCross(one, two)))) {
    return false;
  }

  const raster = tier.compact ? blocks.bare : blocks.line;
  const lead = path[path.length - 1];
  const steps = segments.flatMap(({ from, to }) => {
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / LINE_STEP_PX),
    );

    return Array.from({ length: count }, (_, step) => ({
      x: from.x + ((to.x - from.x) * step) / count,
      y: from.y + ((to.y - from.y) * step) / count,
      width: LINE_STEP_PX,
      height: LINE_STEP_PX,
    }));
  });

  return (
    !covered({ ...lead, width: ANCHOR_DOT_PX, height: ANCHOR_DOT_PX }, tags) &&
    steps.every((step) => !rasterHits(raster, step) && !under(step, tags))
  );
}

function rasterArea(rooms: readonly TagRoom[], area: TagArea): TagArea {
  const finite = [area.left, area.top, area.right, area.bottom].every(
    Number.isFinite,
  );

  if (finite && area.right > area.left && area.bottom > area.top) return area;

  const all = boundsOf(rooms.flatMap((room) => room.ring));

  return {
    left: Number.isFinite(area.left) ? area.left : all.left - RASTER_MARGIN_PX,
    top: Number.isFinite(area.top) ? area.top : all.top - RASTER_MARGIN_PX,
    right: Number.isFinite(area.right)
      ? area.right
      : all.right + RASTER_MARGIN_PX,
    bottom: Number.isFinite(area.bottom)
      ? area.bottom
      : all.bottom + RASTER_MARGIN_PX,
  };
}

function cellSpan(
  from: number,
  to: number,
  origin: number,
  count: number,
): [number, number] {
  return [
    Math.min(Math.max(Math.floor((from - origin) / CELL_PX), 0), count),
    Math.min(Math.max(Math.ceil((to - origin) / CELL_PX), 0), count),
  ];
}

function rasterOf(
  boxes: readonly MarkBox[],
  area: TagArea,
  gap: number,
): Raster {
  const left = Math.floor(area.left);
  const top = Math.floor(area.top);
  const cols = Math.max(1, Math.ceil((area.right - left) / CELL_PX));
  const rows = Math.max(1, Math.ceil((area.bottom - top) / CELL_PX));
  const width = cols + 1;
  const marks = new Int32Array(width * (rows + 1));

  for (const box of boxes) {
    const [c0, c1] = cellSpan(
      box.x - box.width / 2 - gap,
      box.x + box.width / 2 + gap,
      left,
      cols,
    );
    const [r0, r1] = cellSpan(
      box.y - box.height / 2 - gap,
      box.y + box.height / 2 + gap,
      top,
      rows,
    );

    if (c0 >= c1 || r0 >= r1) continue;

    marks[r0 * width + c0] += 1;
    marks[r0 * width + c1] -= 1;
    marks[r1 * width + c0] -= 1;
    marks[r1 * width + c1] += 1;
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const at = row * width + col;

      marks[at] +=
        (row > 0 ? marks[at - width] : 0) +
        (col > 0 ? marks[at - 1] : 0) -
        (row > 0 && col > 0 ? marks[at - width - 1] : 0);
    }
  }

  const sums = new Int32Array(width * (rows + 1));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const at = (row + 1) * width + col + 1;

      sums[at] =
        (marks[row * width + col] > 0 ? 1 : 0) +
        sums[at - width] +
        sums[at - 1] -
        sums[at - width - 1];
    }
  }

  return { left, top, cols, rows, sums };
}

function rasterHits(raster: Raster, box: MarkBox): boolean {
  const { left, top, cols, rows, sums } = raster;
  const width = cols + 1;
  const [c0, c1] = cellSpan(
    box.x - box.width / 2,
    box.x + box.width / 2,
    left,
    cols,
  );
  const [r0, r1] = cellSpan(
    box.y - box.height / 2,
    box.y + box.height / 2,
    top,
    rows,
  );

  if (c0 >= c1 || r0 >= r1) return false;

  return (
    sums[r1 * width + c1] -
      sums[r0 * width + c1] -
      sums[r1 * width + c0] +
      sums[r0 * width + c0] >
    0
  );
}

function blocked(blocks: Blocks, box: MarkBox, soft = false): boolean {
  return (
    rasterHits(blocks.hard, box) ||
    (soft && rasterHits(blocks.soft, box)) ||
    covered(box, blocks.placed)
  );
}

function withinArea(box: MarkBox, area: TagArea): boolean {
  return (
    box.x - box.width / 2 >= area.left &&
    box.x + box.width / 2 <= area.right &&
    box.y - box.height / 2 >= area.top &&
    box.y + box.height / 2 <= area.bottom
  );
}

function shapeOf(room: TagRoom, tier: TagTier, field: TagField): Parts {
  const text = tagText(room, tier);

  if (tier.compact) {
    const pill = pillSize(text, tier.pill);

    return { name: pill, pill, block: pill };
  }

  const name = {
    x: 0,
    y: 0,
    width: field.measure(room.label, tier.px) + 2 * NAME_PAD_PX,
    height: field.lineHeight(tier.px),
  };
  const pill = room.reading ? pillSize(text, tier.pill) : null;
  const height = name.height + (pill ? NAME_STACK_GAP_PX + pill.height : 0);

  return {
    name,
    pill,
    block: {
      x: 0,
      y: 0,
      width: Math.max(name.width, pill?.width ?? 0),
      height,
    },
  };
}

function partsAt(shape: Parts, at: Point, compact: boolean): Parts {
  const block = { ...shape.block, x: at.x, y: at.y };

  if (compact) {
    const pill = { ...shape.block, x: at.x, y: at.y };

    return { name: pill, pill, block };
  }

  const name = {
    ...shape.name,
    x: at.x,
    y: at.y - block.height / 2 + shape.name.height / 2,
  };
  const pill = shape.pill
    ? {
        ...shape.pill,
        x: at.x,
        y: name.y + name.height / 2 + NAME_STACK_GAP_PX + shape.pill.height / 2,
      }
    : null;

  return { name, pill, block };
}

function blockAtSpot(shape: Parts, spot: Point, compact: boolean): Point {
  if (compact) return spot;

  return {
    x: spot.x,
    y: spot.y + shape.block.height / 2 - shape.name.height / 2,
  };
}

function tagOf(
  room: TagRoom,
  tier: TagTier,
  parts: Parts,
  lead: Point | null,
  loose = false,
  bend: Point | null = null,
): RoomTag {
  return {
    slug: room.slug,
    label: room.label,
    reading: room.reading,
    tier,
    name: parts.name,
    pill: parts.pill,
    text: tagText(room, tier),
    lead,
    bend: lead ? bend : null,
    loose,
  };
}

function tagBoxes(tag: RoomTag): MarkBox[] {
  const grow = (box: MarkBox): MarkBox => ({
    ...box,
    width: box.width + 2 * TAG_GAP_PX,
    height: box.height + 2 * TAG_GAP_PX,
  });
  const line = tag.lead
    ? leaderSteps(tag.name, tag.lead, tag.bend).map((step) => ({
        ...step,
        width: LINE_STEP_PX,
        height: LINE_STEP_PX,
      }))
    : [];

  return [
    ...tagParts(tag).map(grow),
    ...line,
    ...(tag.lead
      ? [{ ...tag.lead, width: ANCHOR_DOT_PX, height: ANCHOR_DOT_PX }]
      : []),
  ];
}

function hold(blocks: Blocks, tag: RoomTag): void {
  if (tag.quiet) return;

  if (tag.lead && (blocks.strict || tag.tier.compact)) {
    blocks.leads.push(...segmentsOf(leaderPath(tag.name, tag.lead, tag.bend)));
  }

  if (!tag.tier.compact) {
    blocks.placed.push(...tagBoxes(tag));

    return;
  }

  blocks.placed.push({
    ...tag.name,
    width: tag.name.width + 2 * TAG_GAP_PX,
    height: tag.name.height + 2 * TAG_GAP_PX,
  });

  if (!tag.lead) return;

  const dot = { ...tag.lead, width: ANCHOR_DOT_PX, height: ANCHOR_DOT_PX };

  blocks.placed.push(
    dot,
    ...(blocks.strict ? leaderSteps(tag.name, tag.lead, tag.bend) : [])
      .slice(1, -1)
      .map((step) => ({ ...step, width: LINE_STEP_PX, height: LINE_STEP_PX })),
  );
  blocks.anchors.push(dot);
}

function partsList(parts: Parts, compact: boolean): MarkBox[] {
  if (compact || !parts.pill) return [parts.name];

  return [parts.name, parts.pill];
}

function inside(
  parts: Parts,
  inner: readonly Point[],
  compact: boolean,
): boolean {
  const { name, pill } = parts;
  const wall = 2 * WALL_CLEAR_PX;

  if (compact) {
    return pillInside(name, name.width + wall, name.height + wall, inner);
  }

  return (
    boxInside(
      name,
      name.width - 2 * NAME_PAD_PX + wall,
      name.height * NAME_INK_SHARE + wall,
      inner,
    ) &&
    (!pill || pillInside(pill, pill.width + wall, pill.height + wall, inner))
  );
}

function onFurniture(raster: Raster, parts: Parts, tier: TagTier): boolean {
  const { name } = parts;

  return (
    !tier.compact &&
    rasterHits(raster, {
      ...name,
      width: name.width - 2 * NAME_PAD_PX,
      height: name.height * NAME_INK_SHARE,
    })
  );
}

function overlapping(one: TagArea, two: TagArea): boolean {
  return (
    one.left <= two.right &&
    one.right >= two.left &&
    one.top <= two.bottom &&
    one.bottom >= two.top
  );
}

function boundsOf(ring: readonly Point[]): TagArea {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function insideTag(
  room: TagRoom,
  tier: TagTier,
  shape: Parts,
  blocks: Blocks,
  budget: Budget,
): RoomTag | null {
  if (room.inner.length < 3) return null;

  const bounds = boundsOf(room.inner);
  const { width, height } = shape.block;
  const region = {
    left: bounds.left + width / 2,
    top: bounds.top + height / 2,
    right: bounds.right - width / 2,
    bottom: bounds.bottom - height / 2,
  };

  if (region.left > region.right || region.top > region.bottom) return null;

  const reach = Math.max(
    ...[
      [region.left, region.top],
      [region.right, region.top],
      [region.left, region.bottom],
      [region.right, region.bottom],
    ].map(([x, y]) => Math.hypot(x - room.centre.x, y - room.centre.y)),
  );
  const search = (limit: number, soft: boolean): Parts | null => {
    for (const spot of spotsAround(room.centre, limit)) {
      if (spot.x < region.left || spot.x > region.right) continue;
      if (spot.y < region.top || spot.y > region.bottom) continue;

      budget.work -= 1 + blocks.placed.length / 8;

      if (budget.work < 0) return null;

      const parts = partsAt(shape, spot, tier.compact);
      const boxes = partsList(parts, tier.compact);

      if (boxes.some((box) => !withinArea(box, blocks.area))) continue;
      if (boxes.some((box) => blocked(blocks, box, soft))) continue;
      if (onFurniture(blocks.furniture, parts, tier)) continue;
      if (inside(parts, room.inner, tier.compact)) return parts;
    }

    return null;
  };
  const parts =
    search(Math.min(reach, SOFT_REACH_PX), true) ?? search(reach, false);

  return parts ? tagOf(room, tier, parts, null) : null;
}

function anchorDots(
  room: TagRoom,
  blocks: Blocks,
  budget: Budget,
  raster = blocks.line,
): Point[] {
  const bounds = boundsOf(room.inner);
  const dots: Point[] = [];

  for (
    let y = bounds.top + ANCHOR_STEP_PX / 2;
    y <= bounds.bottom;
    y += ANCHOR_STEP_PX
  ) {
    for (
      let x = bounds.left + ANCHOR_STEP_PX / 2;
      x <= bounds.right;
      x += ANCHOR_STEP_PX
    ) {
      const dot = { x, y, width: ANCHOR_DOT_PX, height: ANCHOR_DOT_PX };

      budget.work -= 0.25;

      if (!boxInside(dot, ANCHOR_DOT_PX, ANCHOR_DOT_PX, room.inner)) continue;
      if (rasterHits(raster, dot)) continue;
      if (
        raster === blocks.seen
          ? under(dot, blocks.placed)
          : covered(dot, blocks.placed)
      ) {
        continue;
      }

      dots.push({ x, y });
    }
  }

  return dots;
}

function under(box: MarkBox, others: readonly MarkBox[]): boolean {
  return others.some(
    (other) =>
      Math.abs(box.x - other.x) < (box.width + other.width) / 2 &&
      Math.abs(box.y - other.y) < (box.height + other.height) / 2,
  );
}

function edgeDots(dots: readonly Point[]): Point[] {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const keys = new Set(dots.map((dot) => key(dot.x, dot.y)));
  const has = (x: number, y: number) => keys.has(key(x, y));

  return dots.filter(
    ({ x, y }) =>
      !has(x - ANCHOR_STEP_PX, y) ||
      !has(x + ANCHOR_STEP_PX, y) ||
      !has(x, y - ANCHOR_STEP_PX) ||
      !has(x, y + ANCHOR_STEP_PX),
  );
}

function nearestDots(dots: readonly Point[], from: Point): Point[] {
  return dots
    .map((dot) => ({ dot, away: Math.hypot(dot.x - from.x, dot.y - from.y) }))
    .sort((one, two) => one.away - two.away)
    .map(({ dot }) => dot);
}

function leadClear(
  box: MarkBox,
  anchor: Point,
  room: TagRoom,
  others: readonly Ring[],
  blocks: Blocks,
  reach: number,
): boolean {
  const from = leaderStart(box, anchor);

  if (Math.hypot(anchor.x - from.x, anchor.y - from.y) > reach) return false;
  if (
    blocks.strict &&
    blocks.leads.some((other) => segmentsCross({ from, to: anchor }, other))
  ) {
    return false;
  }

  for (const step of leaderSteps(box, anchor)) {
    const dot = { ...step, width: LINE_STEP_PX, height: LINE_STEP_PX };

    if (rasterHits(blocks.line, dot) || covered(dot, blocks.placed)) {
      return false;
    }
  }

  return !crossesRooms(from, anchor, room, others);
}

function crossesRooms(
  from: Point,
  anchor: Point,
  room: TagRoom,
  others: readonly Ring[],
): boolean {
  const span = {
    left: Math.min(from.x, anchor.x),
    top: Math.min(from.y, anchor.y),
    right: Math.max(from.x, anchor.x),
    bottom: Math.max(from.y, anchor.y),
  };
  const rings = others.filter(({ bounds }) => overlapping(bounds, span));

  if (rings.length === 0) return false;

  const crossed = new Set<Ring>();
  const allowed = room.outer ? 0 : 1;
  const length = Math.hypot(anchor.x - from.x, anchor.y - from.y);
  const samples = Math.max(1, Math.ceil(length));

  for (let sample = 0; sample <= samples; sample += 1) {
    const at = {
      x: from.x + ((anchor.x - from.x) * sample) / samples,
      y: from.y + ((anchor.y - from.y) * sample) / samples,
    };

    if (insidePolygon(at, room.ring)) continue;

    for (const other of rings) {
      if (insidePolygon(at, other.ring)) crossed.add(other);
    }

    if (crossed.size > allowed) return true;
  }

  return false;
}

function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function segmentsCross(one: Segment, two: Segment): boolean {
  return (
    turn(one.from, one.to, two.from) * turn(one.from, one.to, two.to) < 0 &&
    turn(two.from, two.to, one.from) * turn(two.from, two.to, one.to) < 0
  );
}

function underClear(
  box: MarkBox,
  anchor: Point,
  room: TagRoom,
  others: readonly Ring[],
  blocks: Blocks,
): boolean {
  const lead = { from: leaderStart(box, anchor), to: anchor };
  const tags = blocks.strict
    ? blocks.placed.filter((one) => one.height > ANCHOR_DOT_PX)
    : [];

  if (
    Math.hypot(anchor.x - lead.from.x, anchor.y - lead.from.y) < ANCHOR_DOT_PX
  ) {
    return false;
  }
  if (blocks.leads.some((other) => segmentsCross(lead, other))) return false;

  for (const step of leaderSteps(box, anchor).slice(0, -1)) {
    const dot = { ...step, width: LINE_STEP_PX, height: LINE_STEP_PX };

    if (
      rasterHits(blocks.bare, dot) ||
      covered(dot, blocks.anchors) ||
      under(dot, tags)
    ) {
      return false;
    }
  }

  return !crossesRooms(lead.from, anchor, room, others);
}

function compactTag(
  room: TagRoom,
  tier: TagTier,
  shape: Parts,
  field: TagField,
  blocks: Blocks,
  reach: number,
  budget: Budget,
): RoomTag | null {
  if (room.ring.length < 3 || room.inner.length < 3) return null;

  const dots = anchorDots(room, blocks, budget, blocks.seen);

  if (dots.length === 0) return null;

  const others = ringsOf(field, room);
  const own = boundsOf(room.ring);
  const rings = [{ ring: room.ring, bounds: own }, ...others];
  const { width, height } = shape.block;
  const clear = {
    width: width + 2 * OUTSIDE_CLEAR_PX,
    height: height + 2 * OUTSIDE_CLEAR_PX,
  };
  const area = rasterArea([room], blocks.area);
  const bounds = {
    left: Math.max(area.left, own.left - reach) + width / 2,
    top: Math.max(area.top, own.top - reach) + height / 2,
    right: Math.min(area.right, own.right + reach) - width / 2,
    bottom: Math.min(area.bottom, own.bottom + reach) - height / 2,
  };
  const spots: { parts: Parts; away: number }[] = [];

  for (let y = bounds.top; y <= bounds.bottom; y += SPOT_GRID_PX) {
    for (let x = bounds.left; x <= bounds.right; x += SPOT_GRID_PX) {
      budget.work -= SPOT_WORK;

      const parts = partsAt(shape, { x, y }, true);
      const spaced = {
        ...parts.name,
        width: parts.name.width + 2 * TAG_GAP_PX,
        height: parts.name.height + 2 * TAG_GAP_PX,
      };

      if (
        rasterHits(blocks.tight, parts.name) ||
        under(spaced, blocks.placed)
      ) {
        continue;
      }

      const wide = { ...parts.block, ...clear };
      const box = {
        left: x - clear.width / 2,
        top: y - clear.height / 2,
        right: x + clear.width / 2,
        bottom: y + clear.height / 2,
      };

      budget.work -= 1;

      if (
        rings.some(
          (ring) =>
            overlapping(ring.bounds, box) &&
            (insidePolygon(wide, ring.ring) || overlapsRing(wide, ring.ring)),
        )
      ) {
        continue;
      }

      spots.push({
        parts,
        away: Math.min(
          ...dots.map((dot) => {
            const from = leaderStart(parts.name, dot);

            return Math.hypot(dot.x - from.x, dot.y - from.y);
          }),
        ),
      });
    }
  }

  spots.sort((one, two) => one.away - two.away);

  for (const { parts } of spots) {
    budget.work -= ANCHOR_TRIES * 4;

    if (budget.work < 0) return null;

    const anchor = nearestDots(dots, parts.name)
      .slice(0, ANCHOR_TRIES)
      .find((dot) => underClear(parts.name, dot, room, others, blocks));

    if (anchor) return tagOf(room, tier, parts, anchor);
  }

  return null;
}

function offRings(box: MarkBox, rings: readonly Ring[]): boolean {
  const span = {
    left: box.x - box.width / 2,
    top: box.y - box.height / 2,
    right: box.x + box.width / 2,
    bottom: box.y + box.height / 2,
  };

  return rings.every(
    ({ ring, bounds }) =>
      !overlapping(bounds, span) ||
      (!insidePolygon(box, ring) && !overlapsRing(box, ring)),
  );
}

function ringsOf(field: TagField, room: TagRoom): Ring[] {
  return field.rings
    .filter((ring) => ring !== room.ring)
    .map((ring) => ({ ring, bounds: boundsOf(ring) }));
}

function outsideTag(
  room: TagRoom,
  tier: TagTier,
  shape: Parts,
  field: TagField,
  blocks: Blocks,
  budget: Budget,
  far: boolean,
): RoomTag | null {
  if (room.ring.length < 3 || room.inner.length < 3) return null;
  if (far && !room.outer) return null;

  const dots = edgeDots(anchorDots(room, blocks, budget));

  if (dots.length === 0) return null;

  const others = ringsOf(field, room);
  const bounds = boundsOf(room.ring);
  const { width, height } = shape.block;
  const radius = Math.max(
    ...room.ring.map((corner) =>
      Math.hypot(corner.x - room.centre.x, corner.y - room.centre.y),
    ),
  );
  const short = room.outer && !far;
  const spread = short ? LEADER_REACH_PX : Infinity;
  const shortLimit = radius + LEADER_REACH_PX + Math.hypot(width, height);
  const tried = far ? shortLimit : -1;
  const limit = short
    ? shortLimit
    : radius +
      2 * Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) +
      LEADER_REACH_PX +
      Math.hypot(width, height);
  const { area } = field;
  const reachable = {
    left: Math.max(room.centre.x - limit, area.left),
    top: Math.max(room.centre.y - limit, area.top),
    right: Math.min(room.centre.x + limit, area.right),
    bottom: Math.min(room.centre.y + limit, area.bottom),
  };
  const rings = [{ ring: room.ring, bounds }, ...others].filter(
    ({ bounds: box }) => overlapping(box, reachable),
  );
  const clearance = {
    width: width + 2 * OUTSIDE_CLEAR_PX,
    height: height + 2 * OUTSIDE_CLEAR_PX,
  };
  const within = ({ bounds: box }: Ring, spot: MarkBox): boolean =>
    spot.x + spot.width / 2 >= box.left &&
    spot.x - spot.width / 2 <= box.right &&
    spot.y + spot.height / 2 >= box.top &&
    spot.y - spot.height / 2 <= box.bottom;

  for (const spot of spotsAround(
    room.centre,
    limit,
    far ? FAR_STEP_PX : undefined,
  )) {
    budget.work -= SPOT_WORK;

    if (budget.work < 0) return null;

    const block = { ...shape.block, x: spot.x, y: spot.y };

    if (!withinArea(block, area)) continue;
    if (Math.hypot(spot.x - room.centre.x, spot.y - room.centre.y) <= tried) {
      continue;
    }

    budget.work -= 1;

    const point = { ...spot, width: 0, height: 0 };

    if (
      rings.some(
        (ring) => within(ring, point) && insidePolygon(spot, ring.ring),
      )
    ) {
      continue;
    }

    const parts = partsAt(shape, spot, tier.compact);

    budget.work -= 1 + blocks.placed.length / 8;

    if (partsList(parts, tier.compact).some((box) => blocked(blocks, box))) {
      continue;
    }

    const wide = { ...parts.block, ...clearance };

    budget.work -= rings.length;

    if (
      rings.some((ring) => within(ring, wide) && overlapsRing(wide, ring.ring))
    ) {
      continue;
    }

    const from = parts.name;
    const nearest = nearestDots(dots, from).slice(0, ANCHOR_TRIES);
    const first = nearest[0];

    if (
      !first ||
      Math.hypot(first.x - from.x, first.y - from.y) >
        spread + Math.hypot(from.width, from.height) / 2
    ) {
      continue;
    }

    budget.work -= ANCHOR_TRIES * 4;

    const anchor = nearest.find((dot) =>
      leadClear(from, dot, room, others, blocks, spread),
    );

    if (anchor) return tagOf(room, tier, parts, anchor);
  }

  return null;
}

function looseTag(
  room: TagRoom,
  tier: TagTier,
  shape: Parts,
  field: TagField,
  blocks: Blocks,
  budget: Budget,
): RoomTag {
  const { area } = blocks;
  const reach = Math.max(
    ...[
      [area.left, area.top],
      [area.right, area.top],
      [area.left, area.bottom],
      [area.right, area.bottom],
    ].map(([x, y]) => Math.hypot(x - room.centre.x, y - room.centre.y)),
  );
  const dots = anchorDots(room, blocks, budget);
  const rings = [
    { ring: room.ring, bounds: boundsOf(room.ring) },
    ...ringsOf(field, room),
  ];
  const clear = (parts: Parts): boolean =>
    partsList(parts, tier.compact).every((part) =>
      offRings(
        {
          ...part,
          width: part.width + 2 * OUTSIDE_CLEAR_PX,
          height: part.height + 2 * OUTSIDE_CLEAR_PX,
        },
        rings,
      ),
    );
  let first: Parts | null = null;

  for (const spot of spotsAround(
    room.centre,
    Math.min(reach, LOOSE_REACH_PX),
    FAR_STEP_PX,
  )) {
    budget.work -= SPOT_WORK;

    if (budget.work < 0) break;

    const parts = partsAt(shape, spot, tier.compact);
    const boxes = partsList(parts, tier.compact);

    if (boxes.some((box) => !withinArea(box, area))) continue;

    budget.work -= blocks.placed.length / 64;

    if (boxes.some((box) => blocked(blocks, box))) continue;
    if (onFurniture(blocks.furniture, parts, tier)) continue;
    if (inside(parts, room.inner, tier.compact)) {
      return tagOf(room, tier, parts, null);
    }

    budget.work -= rings.length;

    if (!clear(parts)) continue;

    budget.work -= dots.length;

    const anchor = nearestDots(dots, parts.name).find((dot) =>
      leadClear(parts.name, dot, room, [], blocks, Infinity),
    );

    if (anchor) return tagOf(room, tier, parts, anchor, true);

    first ??= parts;
  }

  if (first) {
    const anchor = nearestDots(dots, first.name)[0] ?? room.centre;

    return tagOf(room, tier, first, anchor, true);
  }

  const { width, height } = shape.block;
  const parts = partsAt(
    shape,
    {
      x: Math.min(
        Math.max(room.centre.x, area.left + width / 2),
        area.right - width / 2,
      ),
      y: Math.min(
        Math.max(room.centre.y, area.top + height / 2),
        area.bottom - height / 2,
      ),
    },
    tier.compact,
  );
  const lead = inside(parts, room.inner, tier.compact)
    ? null
    : (nearestDots(dots, parts.name)[0] ?? null);

  return { ...tagOf(room, tier, parts, lead, true), stranded: true };
}

function pinnedTag(
  room: TagRoom,
  tier: TagTier,
  shape: Parts,
  pin: TagPin,
): RoomTag {
  const parts = partsAt(
    shape,
    blockAtSpot(shape, pin.at, tier.compact),
    tier.compact,
  );

  const tag = tagOf(room, tier, parts, pin.lead, pin.loose, pin.bend);

  return pin.quiet ? { ...tag, quiet: true } : tag;
}

function areaOf(ring: readonly Point[]): number {
  return Math.abs(
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];

      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}
