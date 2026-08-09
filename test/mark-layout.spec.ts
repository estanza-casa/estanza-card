import { describe, expect, it } from 'vitest';

import { pickTarget, type Point } from '../src/gesture.js';
import {
  layoutMarks,
  type MarkLayout,
  type MarkRequest,
  splitHits,
  TOUCH_PX,
} from '../src/mark-layout.js';

const AREA = { width: 390, height: 750 };
const GLYPH = { width: 32, height: 32 };
const DOT = { width: 14, height: 14 };

function request(
  key: string,
  x: number,
  y: number,
  extra: Partial<MarkRequest> = {},
): MarkRequest {
  return { key, x, y, rank: 1, fixed: false, ...GLYPH, ...extra };
}

function spots(layout: MarkLayout): (Point & { key: string })[] {
  return [
    ...layout.marks,
    ...layout.bubbles.map((bubble) => ({ ...bubble, key: bubble.key })),
  ];
}

function apart(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) >= TOUCH_PX - 0.01 ||
    Math.abs(a.y - b.y) >= TOUCH_PX - 0.01
  );
}

const crowd: MarkRequest[] = [
  request('light:hall', 227, 279),
  request('light:living', 251, 313),
  request('light:kitchen', 176, 269),
  request('light:study', 289, 288),
  request('light:washroom', 214, 250),
  request('light:garage', 114, 302),
  request('door:d2', 282, 294, { rank: 0, width: 14, height: 14 }),
  request('door:d7', 82, 338, { rank: 0, width: 14, height: 14 }),
];

describe('laying marks out on screen', () => {
  it('leaves marks that already stand apart where they were projected', () => {
    const layout = layoutMarks(
      [request('light:a', 100, 100), request('light:b', 200, 100)],
      [],
      AREA,
    );

    expect(layout.bubbles).toEqual([]);
    expect(layout.marks.map(({ key, x, y }) => ({ key, x, y }))).toEqual([
      { key: 'light:a', x: 100, y: 100 },
      { key: 'light:b', x: 200, y: 100 },
    ]);
  });

  it('never lets two marks or bubbles overlap after projection', () => {
    const layout = layoutMarks(crowd, [], AREA);
    const shown = spots(layout);

    for (const [index, one] of shown.entries()) {
      for (const other of shown.slice(index + 1)) {
        expect(apart(one, other), `${one.key} and ${other.key}`).toBe(true);
      }
    }
  });

  it('accounts for every mark, shown on its own or inside a bubble', () => {
    const layout = layoutMarks(crowd, [], AREA);
    const kept = [
      ...layout.marks.map((mark) => mark.key),
      ...layout.bubbles.flatMap((bubble) => bubble.members),
    ];

    expect(kept.sort()).toEqual(crowd.map((mark) => mark.key).sort());
  });

  it('shifts a crowded mark along a leader line from where it was projected', () => {
    const layout = layoutMarks(
      [request('light:a', 100, 100), request('light:b', 110, 104)],
      [],
      AREA,
    );
    const moved = layout.marks.find((mark) => mark.key === 'light:b');

    expect(layout.bubbles).toEqual([]);
    expect(moved?.anchor).toEqual({ x: 110, y: 104 });
    expect(apart(layout.marks[0], moved ?? { x: 0, y: 0 })).toBe(true);
    expect(
      Math.hypot((moved?.x ?? 0) - 110, (moved?.y ?? 0) - 104),
    ).toBeLessThanOrEqual(TOUCH_PX + 8);
  });

  it('keeps the higher ranked mark where it was projected', () => {
    const layout = layoutMarks(
      [
        request('door:d1', 100, 100, { rank: 0, width: 14, height: 14 }),
        request('light:a', 104, 100),
      ],
      [],
      AREA,
    );

    expect(layout.marks.find((mark) => mark.key === 'light:a')).toMatchObject({
      x: 104,
      y: 100,
    });
    expect(layout.marks.find((mark) => mark.key === 'door:d1')?.x).not.toBe(
      100,
    );
  });

  it('never moves or folds a mark the user is acting on', () => {
    const layout = layoutMarks(
      [
        request('light:a', 100, 100),
        request('light:b', 102, 100, { fixed: true, rank: 0 }),
      ],
      [],
      AREA,
    );

    expect(layout.marks.find((mark) => mark.key === 'light:b')).toMatchObject({
      x: 102,
      y: 100,
      anchor: { x: 102, y: 100 },
    });
  });

  it('keeps a shifted mark off the pins and controls it must not cover', () => {
    const pin = { x: 160, y: 100, width: 30, height: 60 };
    const layout = layoutMarks(
      [request('light:a', 100, 100), request('light:b', 104, 100)],
      [pin],
      AREA,
    );
    const moved = layout.marks.find((mark) => mark.key === 'light:b');

    expect(moved).toBeDefined();
    expect(
      Math.abs((moved?.x ?? 0) - pin.x) >= (GLYPH.width + pin.width) / 2 ||
        Math.abs((moved?.y ?? 0) - pin.y) >= (GLYPH.height + pin.height) / 2,
    ).toBe(true);
  });

  it('folds marks that cannot shift clear into one count bubble', () => {
    const packed = Array.from({ length: 9 }, (_, index) =>
      request(
        `light:${index}`,
        60 + (index % 3) * 4,
        60 + Math.floor(index / 3) * 4,
      ),
    );
    const layout = layoutMarks(packed, [], { width: 120, height: 120 });

    expect(layout.bubbles.length).toBeGreaterThan(0);

    for (const bubble of layout.bubbles) {
      expect(bubble.members.length).toBeGreaterThan(1);
    }

    const kept = [
      ...layout.marks.map((mark) => mark.key),
      ...layout.bubbles.flatMap((bubble) => bubble.members),
    ];

    expect(kept.sort()).toEqual(packed.map((mark) => mark.key).sort());
  });

  it('keeps a moved mark inside the home it marks', () => {
    const home = { x0: 60, y0: 60, x1: 120, y1: 160 };
    const layout = layoutMarks(
      [request('light:a', 100, 100), request('light:b', 104, 100)],
      [],
      {
        ...AREA,
        within: (at) =>
          at.x >= home.x0 &&
          at.x <= home.x1 &&
          at.y >= home.y0 &&
          at.y <= home.y1,
      },
    );

    for (const mark of layout.marks) {
      expect(mark.x >= home.x0 && mark.x <= home.x1, mark.key).toBe(true);
      expect(mark.y >= home.y0 && mark.y <= home.y1, mark.key).toBe(true);
    }
  });

  it('folds a mark rather than lead it back across another mark', () => {
    const walled = [
      request('light:under', 100, 100),
      request('light:up', 100, 40),
      request('light:up-left', 50, 44),
      request('light:up-right', 150, 44),
      request('light:left', 44, 96),
      request('light:right', 156, 96),
      request('light:over', 100, 88),
    ];
    const layout = layoutMarks(walled, [], AREA);
    const moved = layout.marks.filter(
      (mark) => mark.x !== mark.anchor.x || mark.y !== mark.anchor.y,
    );

    expect(layout.bubbles.flatMap((bubble) => bubble.members)).toContain(
      'light:over',
    );

    for (const mark of moved) {
      const { anchor } = mark;
      const dx = mark.x - anchor.x;
      const dy = mark.y - anchor.y;
      const length = Math.hypot(dx, dy);

      for (const other of spots(layout)) {
        if (other.key === mark.key) continue;

        const along =
          ((other.x - anchor.x) * dx + (other.y - anchor.y) * dy) / length;
        const across =
          Math.abs((other.x - anchor.x) * dy - (other.y - anchor.y) * dx) /
          length;

        expect(
          along > 0 && along < length && across < 16,
          `${mark.key} across ${other.key}`,
        ).toBe(false);
      }
    }
  });

  it('draws a closed opening only where it sits, with no leader', () => {
    const layout = layoutMarks(
      [
        request('light:a', 100, 100),
        request('door:d1', 110, 104, { rank: 0, still: true, ...DOT }),
        request('door:d2', 200, 100, { rank: 0, still: true, ...DOT }),
      ],
      [],
      AREA,
    );

    expect(layout.marks.find((mark) => mark.key === 'door:d1')).toEqual({
      key: 'door:d1',
      x: 110,
      y: 104,
      anchor: { x: 110, y: 104 },
    });
    expect(layout.marks.find((mark) => mark.key === 'door:d2')).toEqual({
      key: 'door:d2',
      x: 200,
      y: 100,
      anchor: { x: 200, y: 100 },
    });
    expect(layout.hidden).toEqual([]);
  });

  it('keeps a closed opening a light stands close to but does not cover', () => {
    const layout = layoutMarks(
      [
        request('light:a', 100, 100),
        request('door:d1', 130, 100, { rank: 0, still: true, ...DOT }),
        request('door:d2', 100, 70, { rank: 0, still: true, ...DOT }),
      ],
      [],
      AREA,
    );

    expect(layout.hidden).toEqual([]);
    expect(layout.marks.map(({ key, x, y }) => ({ key, x, y }))).toEqual([
      { key: 'light:a', x: 100, y: 100 },
      { key: 'door:d1', x: 130, y: 100 },
      { key: 'door:d2', x: 100, y: 70 },
    ]);
  });

  it('keeps two closed openings that stand clear of each other by less than a finger', () => {
    const layout = layoutMarks(
      [
        request('door:d1', 100, 100, { rank: 0, still: true, ...DOT }),
        request('window:w1', 124, 100, { rank: 0, still: true, ...DOT }),
      ],
      [],
      AREA,
    );

    expect(layout.hidden).toEqual([]);
  });

  it('keeps a closed opening whose spot is taken where it sits, never folded into a bubble of its own', () => {
    const layout = layoutMarks(
      [
        request('door:d1', 100, 100, { rank: 0, still: true, ...DOT }),
        request('door:d2', 104, 100, { rank: 0, still: true, ...DOT }),
        request('window:w1', 100, 106, { rank: 0, still: true, ...DOT }),
      ],
      [],
      AREA,
    );

    expect(layout.bubbles).toEqual([]);
    expect(layout.marks.map((mark) => mark.key)).toEqual([
      'door:d1',
      'door:d2',
      'window:w1',
    ]);
    expect(layout.hidden).toEqual([]);
  });

  it('keeps a closed opening out of a bubble that formed where it sits', () => {
    const packed = Array.from({ length: 9 }, (_, index) =>
      request(`light:${index}`, 60, 60),
    );
    const layout = layoutMarks(
      [...packed, request('door:d1', 60, 60, { rank: 0, still: true, ...DOT })],
      [],
      { width: 120, height: 120 },
    );

    expect(layout.bubbles.length).toBeGreaterThan(0);
    expect(layout.bubbles.flatMap((bubble) => bubble.members)).not.toContain(
      'door:d1',
    );
    expect(layout.marks.map((mark) => mark.key)).toContain('door:d1');
  });

  it('still shifts an open opening along a leader beside a light', () => {
    const layout = layoutMarks(
      [request('light:a', 100, 100), request('door:d1', 110, 104, { rank: 0 })],
      [],
      AREA,
    );
    const moved = layout.marks.find((mark) => mark.key === 'door:d1');

    expect(moved?.anchor).toEqual({ x: 110, y: 104 });
    expect(moved?.x !== 110 || moved?.y !== 104).toBe(true);
    expect(layout.hidden).toEqual([]);
  });

  it('hides a mark the stage edge would cut rather than lead it in over a neighbour', () => {
    const layout = layoutMarks(
      [request('light:a', 200, 6), request('light:b', 200, 60)],
      [],
      AREA,
    );

    expect(layout.marks).toEqual([
      { key: 'light:b', x: 200, y: 60, anchor: { x: 200, y: 60 } },
    ]);
    expect(layout.bubbles).toEqual([]);
    expect(layout.hidden).toEqual(['light:a']);
  });

  it('hides a closed opening the stage edge would cut', () => {
    const layout = layoutMarks(
      [request('door:d1', 3, 200, { rank: 0, still: true, ...DOT })],
      [],
      AREA,
    );

    expect(layout.marks).toEqual([]);
    expect(layout.hidden).toEqual(['door:d1']);
  });

  it('hides a mark the user is acting on while the stage edge would cut it', () => {
    const layout = layoutMarks(
      [request('light:a', 200, AREA.height - 4, { fixed: true })],
      [],
      AREA,
    );

    expect(layout.marks).toEqual([]);
    expect(layout.hidden).toEqual(['light:a']);
  });

  it('keeps every shown mark reachable by a finger 44px across', () => {
    const layout = layoutMarks(crowd, [], AREA);
    const shown = spots(layout);
    const radius = TOUCH_PX / 2;

    for (const mark of layout.marks) {
      for (let turn = 0; turn < 16; turn += 1) {
        const angle = (turn / 16) * Math.PI * 2;
        const at = {
          x: mark.x + Math.cos(angle) * (radius - 1),
          y: mark.y + Math.sin(angle) * (radius - 1),
        };

        expect(pickTarget(at, shown, radius), `${mark.key} at ${turn}`).toBe(
          mark.key,
        );
      }
    }
  });
});

describe('splitting the hit areas of neighbours', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  });

  it('cuts two overlapping hit areas halfway between what each shows', () => {
    const hits = splitHits([
      {
        key: 'a',
        shown: box(0, 0, 20, 20),
        hit: box(-12, -12, 32, 32),
        fixed: false,
      },
      {
        key: 'b',
        shown: box(30, 0, 50, 20),
        hit: box(18, -12, 62, 32),
        fixed: false,
      },
    ]);

    expect(hits[0].right).toBe(25);
    expect(hits[1].left).toBe(25);
    expect(hits[0].top).toBe(-12);
  });

  it('cuts along the axis the two are further apart on', () => {
    const hits = splitHits([
      {
        key: 'a',
        shown: box(0, 0, 40, 20),
        hit: box(-4, -12, 44, 32),
        fixed: false,
      },
      {
        key: 'b',
        shown: box(10, 26, 50, 46),
        hit: box(6, 14, 54, 58),
        fixed: false,
      },
    ]);

    expect(hits[0].bottom).toBe(23);
    expect(hits[1].top).toBe(23);
  });

  it('trims only the grown one against a name drawn on the plan', () => {
    const hits = splitHits([
      {
        key: 'a',
        shown: box(0, 0, 20, 20),
        hit: box(-12, -12, 32, 32),
        fixed: false,
      },
      {
        key: 'b',
        shown: box(24, 0, 80, 20),
        hit: box(24, 0, 80, 20),
        fixed: true,
      },
    ]);

    expect(hits[0].right).toBe(22);
    expect(hits[1]).toEqual(box(24, 0, 80, 20));
  });

  it('leaves apart areas and two parts of one thing alone', () => {
    const lone = splitHits([
      {
        key: 'a',
        shown: box(0, 0, 20, 20),
        hit: box(0, 0, 20, 20),
        fixed: false,
      },
      {
        key: 'b',
        shown: box(40, 0, 60, 20),
        hit: box(40, 0, 60, 20),
        fixed: false,
      },
      {
        key: 'a',
        shown: box(10, 0, 30, 20),
        hit: box(8, 0, 32, 20),
        fixed: true,
      },
    ]);

    expect(lone[0]).toEqual(box(0, 0, 20, 20));
    expect(lone[1]).toEqual(box(40, 0, 60, 20));
  });
});
