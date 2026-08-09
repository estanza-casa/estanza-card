import { describe, expect, it } from 'vitest';

import type { Point } from '../src/gesture.js';
import {
  boxInside,
  covered,
  insidePolygon,
  type MarkBox,
  overlapsRing,
  pillInside,
} from '../src/living.js';
import {
  COMPACT_TIER,
  layoutTags,
  leaderPath,
  type RoomTag,
  TAG_TIERS,
  type TagField,
  tagParts,
  type TagRoom,
} from '../src/room-tags.js';

type Rect = { left: number; top: number; right: number; bottom: number };

const STAGE: Rect = { left: 0, top: 0, right: 600, bottom: 400 };
const WORK = 400_000;

function ringOf({ left, top, right, bottom }: Rect): Point[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function room(
  slug: string,
  box: Rect,
  reading: string | null = '20.0°',
  outer = true,
): TagRoom {
  return {
    slug,
    label: slug[0].toUpperCase() + slug.slice(1),
    reading,
    centre: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
    ring: ringOf(box),
    inner: ringOf({
      left: box.left + 3,
      top: box.top + 3,
      right: box.right - 3,
      bottom: box.bottom - 3,
    }),
    outer,
  };
}

function field(
  rooms: readonly TagRoom[],
  hard: MarkBox[] = [],
  glyphs: MarkBox[] = [],
): TagField {
  return {
    hard,
    beneath: [],
    glyphs,
    soft: [],
    furniture: [],
    rings: rooms.map((one) => one.ring),
    area: STAGE,
    measure: (text, px) => text.length * px * 0.6,
    lineHeight: (px) => px * 1.3,
  };
}

function lay(
  rooms: readonly TagRoom[],
  hard: MarkBox[] = [],
  glyphs: MarkBox[] = [],
): RoomTag[] {
  return layoutTags(rooms, field(rooms, hard, glyphs), TAG_TIERS, null, {
    work: WORK,
  });
}

function inRoom(tag: RoomTag, one: TagRoom): boolean {
  return tagParts(tag).every((part) =>
    tag.tier.compact
      ? pillInside(part, part.width, part.height, one.inner)
      : boxInside(part, part.width - 12, part.height * 0.8, one.inner),
  );
}

describe('the tags of a storey', () => {
  const big = room('kitchen', { left: 40, top: 40, right: 300, bottom: 260 });
  const wide = room('living', { left: 300, top: 40, right: 560, bottom: 260 });

  it('gives every room one tag, the pill centred under the name, inside the room', () => {
    const tags = lay([big, wide]);

    expect(tags.map((tag) => tag.slug).sort()).toEqual(['kitchen', 'living']);

    for (const tag of tags) {
      const one = tag.slug === 'kitchen' ? big : wide;

      expect(tag.tier.compact).toBe(false);
      expect(tag.lead).toBeNull();
      expect(tag.pill?.x).toBeCloseTo(tag.name.x);
      expect((tag.pill?.y ?? 0) > tag.name.y).toBe(true);
      expect(inRoom(tag, one)).toBe(true);
    }
  });

  it('writes a room with no reading as a name alone', () => {
    const [tag] = lay([
      room('hall', { left: 40, top: 40, right: 300, bottom: 260 }, null),
    ]);

    expect(tag.pill).toBeNull();
    expect(tag.text).toBe('');
  });

  it('draws every tag of a storey at the one size the smallest room allows', () => {
    const narrow = room('study', {
      left: 300,
      top: 40,
      right: 372,
      bottom: 120,
    });
    const alone = lay([big])[0].tier;
    const tags = lay([big, narrow]);

    expect(new Set(tags.map((tag) => JSON.stringify(tag.tier))).size).toBe(1);
    expect(tags[0].tier.px).toBeLessThanOrEqual(alone.px);
  });

  it('turns the whole storey to one pill per room when a room is too small for any size', () => {
    const cupboard = room('cupboard', {
      left: 300,
      top: 40,
      right: 330,
      bottom: 70,
    });
    const tags = lay([big, cupboard]);

    expect(tags.every((tag) => tag.tier === COMPACT_TIER)).toBe(true);
    expect(tags.find((tag) => tag.slug === 'kitchen')?.text).toBe(
      'Kitchen 20.0°',
    );
  });

  it('sets a tag that fits no room outside, by its own outer wall, with a leader back in', () => {
    const cupboard = room('cupboard', {
      left: 300,
      top: 150,
      right: 330,
      bottom: 180,
    });
    const tag = lay([big, cupboard]).find((one) => one.slug === 'cupboard');

    expect(tag?.lead).not.toBeNull();
    expect(tag?.loose).toBe(false);
    expect(tag?.lead && insidePolygon(tag.lead, cupboard.ring)).toBe(true);
    expect(
      tag && [big, cupboard].some((one) => insidePolygon(tag.name, one.ring)),
    ).toBe(false);
  });

  it('keeps every tag off a light glyph', () => {
    const glyph = { x: 170, y: 150, width: 28, height: 28 };
    const [tag] = lay([big], [], [glyph]);

    expect(tagParts(tag).some((part) => covered(part, [glyph]))).toBe(false);
  });

  it('never drops a tag, even with no room anywhere', () => {
    const rooms = [
      room('a', { left: 0, top: 0, right: 300, bottom: 400 }),
      room('b', { left: 300, top: 0, right: 330, bottom: 30 }),
      room('c', { left: 330, top: 0, right: 600, bottom: 400 }),
    ];
    const tags = lay(rooms);

    expect(tags.map((tag) => tag.slug).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leads into a small room even when its light leaves only a thin band free', () => {
    const cupboard = room('cupboard', {
      left: 300,
      top: 150,
      right: 356,
      bottom: 208,
    });
    const rooms = [
      room('kitchen', { left: 40, top: 40, right: 300, bottom: 260 }),
      cupboard,
    ];
    const glyphs = [{ x: 328, y: 179, width: 28, height: 28 }];
    const tag = lay(rooms, [], glyphs).find((one) => one.slug === 'cupboard');

    expect(tag?.loose).toBe(false);
    expect(tag?.lead && insidePolygon(tag.lead, cupboard.ring)).toBe(true);
    expect(tag && tagParts(tag).some((part) => covered(part, glyphs))).toBe(
      false,
    );
  });

  it('keeps every tag it sets loose on its own room or leads it home', () => {
    const rooms = [
      room('a', { left: 0, top: 0, right: 300, bottom: 400 }),
      room('b', { left: 300, top: 0, right: 330, bottom: 30 }),
      room('c', { left: 330, top: 0, right: 600, bottom: 400 }),
    ];
    const loose = lay(rooms).filter((tag) => tag.loose);

    expect(loose.length).toBeGreaterThan(0);

    for (const tag of loose) {
      const own = rooms.find((one) => one.slug === tag.slug);
      const onRoom = own !== undefined && overlapsRing(tag.name, own.ring);
      const ledHome =
        own !== undefined &&
        tag.lead !== null &&
        insidePolygon(tag.lead, own.ring);

      expect(onRoom || ledHome).toBe(true);
    }
  });
});

function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  const turn = (p: Point, q: Point, r: Point): number =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

function segments(tag: RoomTag): [Point, Point][] {
  if (!tag.lead) return [];

  const path = leaderPath(tag.name, tag.lead, tag.bend);

  return path.slice(1).map((end, index) => [path[index], end]);
}

describe('the tags set outside the house', () => {
  const house = { left: 150, top: 60, right: 450, bottom: 340 };
  const cupboards = [80, 130, 180, 230, 280].map((top, index) =>
    room(`cupboard${index}`, {
      left: 150,
      top,
      right: 178,
      bottom: top + 28,
    }),
  );
  const rooms = [
    room('hall', { left: 178, top: house.top, right: 450, bottom: 340 }),
    ...cupboards,
  ];
  const tags = lay(rooms);
  const outside = tags.filter((tag) => tag.lead !== null);

  it('leads every room too small for its tag from a spot outside the house', () => {
    expect(tags).toHaveLength(rooms.length);
    expect(outside.map((tag) => tag.slug).sort()).toEqual(
      cupboards.map((one) => one.slug),
    );

    for (const tag of outside) {
      const own = cupboards.find((one) => one.slug === tag.slug);

      expect(own && tag.lead && insidePolygon(tag.lead, own.ring)).toBe(true);
      expect(rooms.some((one) => overlapsRing(tag.name, one.ring))).toBe(false);
    }
  });

  it('keeps every outside tag whole inside the card', () => {
    for (const part of outside.flatMap(tagParts)) {
      expect(part.x - part.width / 2).toBeGreaterThanOrEqual(STAGE.left);
      expect(part.y - part.height / 2).toBeGreaterThanOrEqual(STAGE.top);
      expect(part.x + part.width / 2).toBeLessThanOrEqual(STAGE.right);
      expect(part.y + part.height / 2).toBeLessThanOrEqual(STAGE.bottom);
    }
  });

  it('stacks the tags of one side in the order of their rooms', () => {
    const left = outside
      .filter((tag) => tag.name.x < house.left)
      .sort((a, b) => a.name.y - b.name.y);

    expect(left.length).toBeGreaterThan(1);
    expect(left.map((tag) => tag.lead?.y)).toEqual(
      [...left.map((tag) => tag.lead?.y ?? 0)].sort((a, b) => a - b),
    );
  });

  it('never lets one leader cross another, and bends each at most once', () => {
    for (const tag of outside) {
      expect(segments(tag).length).toBeLessThanOrEqual(2);
    }

    outside.forEach((one, index) => {
      for (const two of outside.slice(index + 1)) {
        for (const [a, b] of segments(one)) {
          for (const [c, d] of segments(two)) {
            expect(crossing(a, b, c, d)).toBe(false);
          }
        }
      }
    });
  });
});

describe('the tag of a tapped room', () => {
  it('keeps its spot when the storey is laid out again', () => {
    const kitchen = room('kitchen', {
      left: 40,
      top: 40,
      right: 300,
      bottom: 260,
    });
    const [first] = lay([kitchen]);
    const pin = {
      slug: 'kitchen',
      at: { x: first.name.x, y: first.name.y },
      tier: first.tier,
      lead: null,
      bend: null,
      loose: false,
    };
    const glyph = { x: first.name.x, y: first.name.y, width: 28, height: 28 };
    const [again] = layoutTags(
      [kitchen],
      field([kitchen], [], [glyph]),
      TAG_TIERS,
      pin,
      { work: WORK },
    );

    expect(again.name.x).toBeCloseTo(first.name.x);
    expect(again.name.y).toBeCloseTo(first.name.y);
  });
});
