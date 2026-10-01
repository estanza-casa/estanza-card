import type { Point, ScreenAnchor } from './gesture.js';
import { covered, type LabelSize, type MarkBox } from './living.js';
import type { Box } from './sheet.js';

export const TOUCH_PX = 44;

export type MarkRequest = ScreenAnchor &
  LabelSize & {
    rank: number;
    fixed: boolean;
    still?: boolean;
    passive?: boolean;
    room?: string | null;
    avoid?: readonly MarkBox[];
  };

export type LaidMark = ScreenAnchor & { anchor: Point };

export type MarkBubble = ScreenAnchor & {
  members: string[];
  room: string | null;
};

export type MarkLayout = {
  marks: LaidMark[];
  bubbles: MarkBubble[];
  hidden: string[];
};

export type LayoutArea = {
  width: number;
  height: number;
  within?: (at: Point) => boolean;
};

export type MarkSpots = {
  shown: readonly ScreenAnchor[];
  tucked: ReadonlySet<string>;
};

export type HitTarget = { key: string; shown: Box; hit: Box; fixed: boolean };

type Placed = LaidMark &
  LabelSize & { fixed: boolean; still: boolean; room: string | null };

const STILL_GAP_PX = 6;
const SHIFT_STEP_PX = 8;
const SHIFT_REACH_PX = 48;
const SHIFT_TURNS = 16;
const LEADER_CLEAR_PX = 16;

export function layoutMarks(
  requests: readonly MarkRequest[],
  blocked: readonly MarkBox[],
  area: LayoutArea | null,
  touch = TOUCH_PX,
): MarkLayout {
  const ordered = requests
    .map((request, index) => ({ request, index }))
    .sort(
      (a, b) =>
        Number(b.request.fixed) - Number(a.request.fixed) ||
        Number(a.request.passive ?? false) -
          Number(b.request.passive ?? false) ||
        b.request.rank - a.request.rank ||
        a.index - b.index,
    )
    .map(({ request }) => request);
  const placed: Placed[] = [];
  const bubbles: MarkBubble[] = [];
  const hidden: string[] = [];
  const taken = (): Point[] => [...placed, ...bubbles];
  const spacing = (request: MarkRequest, other: Point | Placed): number =>
    request.still && 'width' in other
      ? (request.width + other.width) / 2 + STILL_GAP_PX
      : touch;
  const clear = (at: Point, request: MarkRequest): boolean => {
    const box = { ...at, width: request.width, height: request.height };

    return (
      taken().every((other) => apart(at, other, spacing(request, other))) &&
      !covered(box, blocked) &&
      !covered(box, request.avoid ?? [])
    );
  };

  for (const request of ordered) {
    const anchor = { x: request.x, y: request.y };
    const still = request.still ?? false;
    const room = request.room ?? null;

    const box = { ...anchor, width: request.width, height: request.height };

    if (
      !whole(anchor, request, area) ||
      (still && covered(box, request.avoid ?? []))
    ) {
      hidden.push(request.key);

      continue;
    }

    const lay = (at: Point, fixed: boolean): void => {
      placed.push({
        key: request.key,
        ...at,
        anchor,
        width: request.width,
        height: request.height,
        fixed,
        still,
        room,
      });
    };

    if (request.fixed || still || clear(anchor, request)) {
      lay(anchor, request.fixed);

      continue;
    }

    const spot = shiftedSpot(request, taken(), area, (at) =>
      clear(at, request),
    );

    if (spot) {
      lay(spot, false);

      continue;
    }

    if (request.passive) {
      hidden.push(request.key);

      continue;
    }

    if (!fold(request.key, anchor, room, placed, bubbles, touch)) {
      lay(anchor, false);
    }
  }

  return {
    marks: placed.map(({ key, x, y, anchor }) => ({ key, x, y, anchor })),
    bubbles,
    hidden,
  };
}

function shiftedSpot(
  request: MarkRequest,
  taken: readonly Point[],
  area: LayoutArea | null,
  clear: (at: Point) => boolean,
): Point | null {
  const nearest = taken.reduce<Point | null>(
    (best, other) =>
      !best ||
      Math.hypot(other.x - request.x, other.y - request.y) <
        Math.hypot(best.x - request.x, best.y - request.y)
        ? other
        : best,
    null,
  );
  const away = nearest
    ? Math.atan2(request.y - nearest.y, request.x - nearest.x)
    : -Math.PI / 2;
  const turns = Array.from(
    { length: SHIFT_TURNS },
    (_, turn) => (turn / SHIFT_TURNS) * Math.PI * 2,
  ).sort((a, b) => bend(a, away) - bend(b, away));

  for (
    let reach = SHIFT_STEP_PX;
    reach <= SHIFT_REACH_PX;
    reach += SHIFT_STEP_PX
  ) {
    for (const turn of turns) {
      const at = {
        x: request.x + Math.cos(turn) * reach,
        y: request.y + Math.sin(turn) * reach,
      };

      if (
        inside(at, request, area) &&
        clear(at) &&
        taken.every((other) => !crosses(request, at, other))
      ) {
        return at;
      }
    }
  }

  return null;
}

function fold(
  key: string,
  anchor: Point,
  room: string | null,
  placed: Placed[],
  bubbles: MarkBubble[],
  touch: number,
): boolean {
  const bubble = bubbles.find(
    (other) => other.room === room && !apart(anchor, other, touch),
  );

  if (bubble) {
    bubble.members.push(key);

    return true;
  }

  const index = placed.findIndex(
    (other) =>
      other.room === room &&
      !other.fixed &&
      !other.still &&
      !apart(anchor, other, touch),
  );

  if (index < 0) return false;

  const [host] = placed.splice(index, 1);

  bubbles.push({
    key: `bubble:${host.key}`,
    x: host.x,
    y: host.y,
    members: [host.key, key],
    room,
  });

  return true;
}

function crosses(from: Point, to: Point, other: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) return false;

  const along = ((other.x - from.x) * dx + (other.y - from.y) * dy) / length;
  const across =
    Math.abs((other.x - from.x) * dy - (other.y - from.y) * dx) / length;

  return along > 0 && along < length && across < LEADER_CLEAR_PX;
}

function apart(a: Point, b: Point, touch: number): boolean {
  return Math.abs(a.x - b.x) >= touch || Math.abs(a.y - b.y) >= touch;
}

function bend(turn: number, away: number): number {
  const gap = Math.abs(turn - away) % (Math.PI * 2);

  return Math.min(gap, Math.PI * 2 - gap);
}

function inside(at: Point, size: LabelSize, area: LayoutArea | null): boolean {
  return whole(at, size, area) && (area?.within?.(at) ?? true);
}

function whole(at: Point, size: LabelSize, area: LayoutArea | null): boolean {
  if (!area) return true;

  return (
    at.x - size.width / 2 >= 0 &&
    at.y - size.height / 2 >= 0 &&
    at.x + size.width / 2 <= area.width &&
    at.y + size.height / 2 <= area.height
  );
}

export function splitHits(targets: readonly HitTarget[]): Box[] {
  const hits = targets.map((target) => ({ ...target.hit }));

  targets.forEach((one, i) => {
    targets.slice(i + 1).forEach((two, offset) => {
      const j = i + 1 + offset;

      if (one.key === two.key || (one.fixed && two.fixed)) return;
      if (!boxesMeet(hits[i], hits[j])) return;

      const across =
        Math.max(
          two.shown.left - one.shown.right,
          one.shown.left - two.shown.right,
        ) >=
        Math.max(
          two.shown.top - one.shown.bottom,
          one.shown.top - two.shown.bottom,
        );
      const [low, high] = across
        ? (['left', 'right'] as const)
        : (['top', 'bottom'] as const);
      const first =
        one.shown[low] + one.shown[high] <= two.shown[low] + two.shown[high];
      const [near, far] = first ? [i, j] : [j, i];
      const nearShown = targets[near].shown;
      const farShown = targets[far].shown;
      const line =
        farShown[low] >= nearShown[high]
          ? (nearShown[high] + farShown[low]) / 2
          : (nearShown[low] +
              nearShown[high] +
              farShown[low] +
              farShown[high]) /
            4;

      if (!targets[near].fixed) {
        hits[near][high] = Math.min(hits[near][high], line);
      }

      if (!targets[far].fixed) {
        hits[far][low] = Math.max(hits[far][low], line);
      }
    });
  });

  return hits;
}

function boxesMeet(one: Box, two: Box): boolean {
  return (
    one.left < two.right &&
    two.left < one.right &&
    one.top < two.bottom &&
    two.top < one.bottom
  );
}
