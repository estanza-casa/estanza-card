import type { HomeDocument } from '@estanza/plan-engine';
import type { GroundZone, Light, Prop } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  doorLeafReaches,
  doorSwingSide,
  floorOfItem,
  groundFloor,
  resolveMount,
  resolvePosition,
  wallFrame,
} from '@estanza/plan-engine/geometry/geometry.js';
import {
  balconyAnchor,
  balconyCorners,
  PLOT_MATERIAL_IDS,
  type PlotMaterialId,
} from '@estanza/plan-engine/geometry/plot.js';
import {
  type Bounds,
  type CanvasState,
  drawGrid,
  drawPlan,
  drawProp,
  fitCamera,
  type FitReserve,
  MIN_RESERVED_SPAN,
  NO_FIT_RESERVE,
  planPalette,
  type PlanScheme,
  type PlanWords,
  propAngle,
  propFootprint,
  reserveStairs,
  screenOf,
  stairShafts,
  VIEWER_MAX_FIT_ZOOM,
  worldOf,
} from '@estanza/plan2d';
import { motionLive } from '@estanza/scene/env.js';
import type { UnitSystem } from '@estanza/shared';
import { tokens } from '@estanza/tokens';
import { css, html, LitElement, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { PIN_HEAD_PX, PIN_STEM_PX } from './alert-view.js';
import { type SceneScope, scopeKey } from './bindings.js';
import {
  clearInsets,
  LENS_EASE_MS,
  type PlanCell,
  type Rect,
  SHEET_GLIDE_MS,
} from './camera-rig.js';
import { floorName, floorOfScope, type Storey, storeys } from './floors.js';
import {
  GestureTracker,
  isSecondaryPress,
  type Point,
  type ScreenAnchor,
  TARGET_RADIUS_PX,
} from './gesture.js';
import {
  boxInside,
  covered,
  insetPolygon,
  insidePolygon,
  LABEL_GAP,
  type LabelSize,
  type MarkBox,
  type Vec2,
} from './living.js';
import type { MarkSpots } from './mark-layout.js';
import {
  type Glow,
  NAME_HEIGHT_PX,
  type OpeningSpan,
  openingSpan,
  planFills,
  planGlows,
  planPoint,
  roomAtPoint,
  visualCentre,
} from './plan.js';
import { DANGER_FILL, markColour, type RoomMarks } from './room-marks.js';
import {
  COMPACT_TIER,
  LARGE_TIER,
  layoutTags,
  leaderPath,
  leaderSteps,
  NAME_PAD_PX,
  type RoomTag,
  TAG_TIERS,
  type TagArea,
  type TagField,
  type TagLabel,
  tagParts,
  type TagPin,
  type TagRoom,
  type TagRules,
  tagSpot,
} from './room-tags.js';
import {
  applyOverlay,
  emptyOverlay,
  openFractionsOf,
  type RoomFootprint,
  type SceneGesture,
  type SceneOverlay,
  type ScopeSelectDetail,
  type ScreenOutline,
  withDoorsOf,
} from './scene-view.js';
import { mostlyUnderSheet } from './sheet.js';

export const planWords: PlanWords = {
  north: 'N',
  up: 'Up',
  down: 'Down',
  asDrawn: 'as drawn',
};

export const FIT_PADDING_CM = 200;
export const STILL_FIT_PADDING_CM = 140;
export const POOL_CM = 300;
export const POOL_ALPHA = 0.55;
export const NIGHT_POOL_ALPHA = 0.8;

const GROUND_REACH_CM = 100_000;
const SWING_SLICES = 4;
const OUTLINE_INSET_PX = 4;
const OUTLINE_WIDTH_PX = 2;
const DANGER_WIDTH_PX = 3;
const DANGER_WASH = 0.5;
const SELECTED_WIDTH_PX = 3;
const SELECTED_WASH = 0.14;
const OPENING_CLEAR_PX = 16;
const CENTRE_LINE_GAP_PX = 1;
const ROOM_NAME_PX = tokens.typography.roles.caption.size;
const ROOM_NAME_LINE = tokens.typography.roles.caption.lineHeight;
const ROOM_NAME_MIN_PX = 10;
const LARGE_PLAN_ZOOM = 0.5;
const ROOM_NAME_WEIGHT = 600;
const TAG_WORK = 400_000;
const GLYPH_BOX: LabelSize = { width: 32, height: 32 };
const DOT_BOX: LabelSize = { width: 18, height: 18 };
const STAIR_CLEAR_PX = 2;
const OUTER_PROBE_CM = 40;
const LEADER_LINE_PX = 1.25;
const LEADER_HALO_PX = 3.25;
const LEADER_HALO_ALPHA = 0.6;
const LEADER_DOT_RADIUS_PX = 2.5;
const LEADER_DOT_PX = 10;
const LEADER_STEP_PX = 4;
const SIDE_MARGIN_PX = 16;
const STAIR_WIDTH_CM = 100;
const STAIR_DEPTH_CM = 300;
const STAIR_HALO_PX = 3;
const FIXTURE_CLEAR_PX = 8;
const PIN_GLYPH_GAP_PX = 24;
const PIN_STEP_PX = 4;
const PIN_REACH_STEPS = 24;
const PIN_NUDGES_PX: Point[] = Array.from(
  { length: (PIN_REACH_STEPS * 2 + 1) ** 2 },
  (_, index) => ({
    x: ((index % (PIN_REACH_STEPS * 2 + 1)) - PIN_REACH_STEPS) * PIN_STEP_PX,
    y:
      (Math.floor(index / (PIN_REACH_STEPS * 2 + 1)) - PIN_REACH_STEPS) *
      PIN_STEP_PX,
  }),
).sort((one, two) => Math.hypot(one.x, one.y) - Math.hypot(two.x, two.y));
const CAPTION_PX = 28;
const READABLE_ZOOM = 0.2;
const TILING_SNAP = 0.02;
const LEADER_CARD_SHARE = 0.35;
const SWIPE_PX = 48;
const GLIDE_RECHECK_MS = 16;
const CENTRE_SNAP_PX = 0.5;
export const RETILE_MS = 3 * LENS_EASE_MS;

const documentIds = new WeakMap<object, number>();

let nextDocumentId = 0;

type Swing = { hinge: Point; radius: number; out: Point; along: Point };

type StairFlight = {
  id: string;
  centre: Point;
  across: number;
  along: number;
  turn: number;
};

type PlacedProp = { prop: Prop; at: Vec2; box: MarkBox; indoor: boolean };

type Span = { x: number; y: number };

type Part = { start: number; size: number; lead: number; trail: number };

type Cell = {
  floor: string | null;
  at: Point;
  width: number;
  height: number;
  reserve: FitReserve;
  padding: number;
  clip: Rect | null;
  caption: string | null;
  cs: CanvasState | null;
};

type Tile = { house: Rect; cell: Rect };

type Retiling = { frame: HTMLCanvasElement; tiles: Map<string, Tile> };

type Margin = { left: number; top: number; right: number; bottom: number };

const NO_MARGIN: Margin = { left: 0, top: 0, right: 0, bottom: 0 };

type PlacedTag = RoomTag & {
  world: Point;
  leadWorld: Point | null;
  bendWorld: Point | null;
  zoom: number;
};

type WorldPin = Omit<TagPin, 'at' | 'lead' | 'bend'> & {
  world: Point;
  leadWorld: Point | null;
  bendWorld: Point | null;
  size: LabelSize;
  extent?: MarkBox;
  stranded?: boolean;
};

export type GlyphSpot = { scope: SceneScope; nudge: Point };

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const copy = document.createElement('canvas');

  copy.width = canvas.width;
  copy.height = canvas.height;

  const ctx = copy.getContext('2d');

  if (!ctx || copy.width === 0 || copy.height === 0) return null;

  ctx.drawImage(canvas, 0, 0);

  return copy;
}

function sameRect(one: Rect, two: Rect): boolean {
  return (
    Math.abs(one.left - two.left) < 0.5 &&
    Math.abs(one.top - two.top) < 0.5 &&
    Math.abs(one.right - two.right) < 0.5 &&
    Math.abs(one.bottom - two.bottom) < 0.5
  );
}

function between(from: Rect, to: Rect, value: number): Rect {
  const at = (one: number, two: number) => one + (two - one) * value;

  return {
    left: at(from.left, to.left),
    top: at(from.top, to.top),
    right: at(from.right, to.right),
    bottom: at(from.bottom, to.bottom),
  };
}

function blit(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  tile: Tile,
  house: Rect,
  alpha: number,
  dpr: number,
): void {
  const scale =
    (house.right - house.left) /
    Math.max(tile.house.right - tile.house.left, 1);
  const x = house.left - tile.house.left * scale;
  const y = house.top - tile.house.top * scale;
  const { left, top, right, bottom } = tile.cell;

  if (right <= left || bottom <= top) return;

  ctx.globalAlpha = alpha;
  ctx.drawImage(
    image,
    left * dpr,
    top * dpr,
    (right - left) * dpr,
    (bottom - top) * dpr,
    (left * scale + x) * dpr,
    (top * scale + y) * dpr,
    (right - left) * scale * dpr,
    (bottom - top) * scale * dpr,
  );
}

function roomNameFont(px: number): string {
  return `${ROOM_NAME_WEIGHT} ${px}px ${tokens.typography.family.web}`;
}

function nameHeight(px: number): number {
  return px === ROOM_NAME_PX ? NAME_HEIGHT_PX : px * ROOM_NAME_LINE;
}

function swingBoxes({ hinge, radius, out, along }: Swing): MarkBox[] {
  const at = (outward: number, sideways: number): Point => ({
    x: hinge.x + out.x * outward + along.x * sideways,
    y: hinge.y + out.y * outward + along.y * sideways,
  });

  return Array.from({ length: SWING_SLICES }, (_, slice) => {
    const near = (slice / SWING_SLICES) * radius;
    const far = ((slice + 1) / SWING_SLICES) * radius;
    const reach = Math.sqrt(radius * radius - near * near);
    const corners = [at(near, 0), at(far, 0), at(near, reach), at(far, reach)];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;

    return { x: left + width / 2, y: top + height / 2, width, height };
  });
}

function worldPin(cs: CanvasState, tag: RoomTag): WorldPin {
  const spot = tagSpot(tag);
  const parts = tagParts(tag);
  const left = Math.min(...parts.map((part) => part.x - part.width / 2));
  const top = Math.min(...parts.map((part) => part.y - part.height / 2));
  const right = Math.max(...parts.map((part) => part.x + part.width / 2));
  const bottom = Math.max(...parts.map((part) => part.y + part.height / 2));

  return {
    extent: {
      x: (left + right) / 2 - spot.x,
      y: (top + bottom) / 2 - spot.y,
      width: right - left,
      height: bottom - top,
    },
    slug: tag.slug,
    tier: tag.tier,
    loose: tag.loose,
    world: worldOf(cs, spot.x, spot.y),
    leadWorld: tag.lead && worldOf(cs, tag.lead.x, tag.lead.y),
    bendWorld: tag.bend && worldOf(cs, tag.bend.x, tag.bend.y),
    size: { width: tag.name.width, height: tag.name.height },
    quiet: tag.quiet,
    stranded: tag.stranded,
  };
}

function leaderBoxes(box: MarkBox, lead: Point, bend: Point | null): MarkBox[] {
  return [
    ...leaderSteps(box, lead, bend)
      .slice(0, -1)
      .map((step) => ({
        ...step,
        width: LEADER_STEP_PX,
        height: LEADER_STEP_PX,
      })),
    { ...lead, width: LEADER_DOT_PX, height: LEADER_DOT_PX },
  ];
}

function hasOuterWall(floor: DerivedFloor, slug: string): boolean {
  const room = floor.roomsBySlug.get(slug);

  if (!room) return false;

  const toPoints = (poly: readonly Vec2[]): Point[] =>
    poly.map(([x, y]) => ({ x, y }));
  const own = toPoints(room.poly);
  const others = floor.rooms
    .filter((other) => other.slug !== slug)
    .map((other) => toPoints(other.poly));

  return room.poly.some(([x, y], index) => {
    const [nx, ny] = room.poly[(index + 1) % room.poly.length];
    const length = Math.hypot(nx - x, ny - y) || 1;
    const middle = { x: (x + nx) / 2, y: (y + ny) / 2 };

    return [1, -1].some((side) => {
      const probe = {
        x: middle.x + ((ny - y) / length) * side * OUTER_PROBE_CM,
        y: middle.y - ((nx - x) / length) * side * OUTER_PROBE_CM,
      };

      return (
        !insidePolygon(probe, own) &&
        !others.some((other) => insidePolygon(probe, other))
      );
    });
  });
}

function widest(one: FitReserve, other: FitReserve): FitReserve {
  return {
    top: Math.max(one.top, other.top),
    right: Math.max(one.right, other.right),
    bottom: Math.max(one.bottom, other.bottom),
    left: Math.max(one.left, other.left),
  };
}

function heldReserve(
  width: number,
  height: number,
  reserve: FitReserve,
): FitReserve {
  const roomy =
    width - reserve.left - reserve.right >= width * MIN_RESERVED_SPAN &&
    height - reserve.top - reserve.bottom >= height * MIN_RESERVED_SPAN;

  return roomy ? reserve : NO_FIT_RESERVE;
}

function strip(
  total: number,
  weights: number[],
  before: number,
  after: number,
  fixed = 0,
): Part[] {
  const count = weights.length;

  if (count === 1) {
    const side = Math.max(before, after);

    return [{ start: 0, size: total, lead: side, trail: side }];
  }

  const free = total - before - after - count * fixed;
  const sum = weights.reduce((all, weight) => all + weight, 0);
  let start = 0;

  return weights.map((weight, index) => {
    const lead = index === 0 ? before : 0;
    const trail = index === count - 1 ? after : 0;
    const size = (free * weight) / sum + fixed + lead + trail;
    const part = { start, size, lead, trail };

    start += size;

    return part;
  });
}

function identityOf(value: object): number {
  const known = documentIds.get(value);

  if (known !== undefined) return known;

  nextDocumentId += 1;
  documentIds.set(value, nextDocumentId);

  return nextDocumentId;
}

@customElement('estanza-plan-view')
export class EstanzaPlanView extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
      touch-action: none;
    }

    :host([dim]) canvas {
      filter: brightness(0.6);
    }
  `;

  @property({ attribute: false }) home: HomeDocument | null = null;

  @property({ attribute: false }) floors: DerivedFloor[] = [];

  @property({ attribute: false }) active: string | null = null;

  @property({ attribute: false }) scheme: PlanScheme = 'light';

  @property({ attribute: false }) night = false;

  @property({ attribute: false }) overlay: SceneOverlay = emptyOverlay();

  @property({ attribute: false }) roomMarks: RoomMarks = {};

  @property({ attribute: false }) readings: Record<string, string> = {};

  @property({ type: Boolean }) largeTags = false;

  @property({ type: Boolean }) crowded = false;

  @property({ attribute: false }) covers: MarkBox[] = [];

  @property({ attribute: false }) glyphs: GlyphSpot[] = [];

  @property({ attribute: false }) sheets: MarkBox[] = [];

  veiled: string[] = [];

  loose: string[] = [];

  quiet: string[] = [];

  plates: string[] = [];

  @property({ type: Boolean }) interactive = true;

  @property({ type: Boolean }) still = false;

  @property({ attribute: false }) targets: SceneScope[] = [];

  markSpots: MarkSpots | null = null;

  @property({ attribute: false }) targetRadius = TARGET_RADIUS_PX;

  @property({ attribute: false }) reserve: FitReserve = NO_FIT_RESERVE;

  @property({ attribute: false }) beside: FitReserve = NO_FIT_RESERVE;

  @property({ attribute: false }) dots: readonly string[] = [];

  @property({ attribute: false }) corner = 0;

  @property({ attribute: false }) clear: readonly Rect[] = [];

  @property({ attribute: false }) shift: Point = { x: 0, y: 0 };

  @property({ attribute: false }) units: UnitSystem = 'metric';

  @property({ type: Boolean, reflect: true }) dim = false;

  @property({ attribute: false }) selected: string | null = null;

  painted: {
    width: number;
    height: number;
    clear: readonly Rect[];
    shift: Point;
    beside: FitReserve;
  } | null = null;

  @property({ attribute: false }) page: string | null = null;

  pages: string[] = [];

  shownPage: string | null = null;
  besideHeld = true;

  private swipeFrom: Point | null = null;

  private cells: Cell[] = [];

  private stage = { width: 0, height: 0 };

  private current: Cell | null = null;

  private readonly tags = new Map<string, PlacedTag>();

  private readonly restTags = new Map<
    string,
    { zoom: number; pins: WorldPin[] }
  >();

  private pin: (WorldPin & { zoom: number }) | null = null;

  private pinFor: string | null = null;

  private readonly stairWords = new Map<string, Point & LabelSize>();

  private readonly captionTexts = new Map<string, Point & LabelSize>();

  private drawnKey = '';

  private moving: object | null = null;

  private settled: Point | null = null;

  private margin = NO_MARGIN;

  private settling: {
    shift: Point;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private observer: ResizeObserver | null = null;

  private readonly gestures = new GestureTracker((at) =>
    this.report(at, 'press'),
  );

  private menuPress = false;

  render(): TemplateResult {
    return html`<canvas
      part="plan"
      role="img"
      aria-label="Floor plan"
      @pointerdown=${this.onPointerDown}
      @pointermove=${this.onPointerMove}
      @pointerup=${this.onPointerUp}
      @pointercancel=${this.onPointerCancel}
      @contextmenu=${this.onContextMenu}
    ></canvas>`;
  }

  connectedCallback(): void {
    super.connectedCallback();

    if (!this.observer && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(this);
    }
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.gestures.cancel();
    this.drawnKey = '';
    this.stopMoving();
    this.stopSettling();
    this.settled = null;
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.draw();
  }

  anchorOf(scope: SceneScope): Point | null {
    if (this.offPage(scope)) return null;

    return this.within(this.cellOf(scope), () => {
      const span = openingSpan(this.floors, this.storey, scope);

      if (span) {
        return this.shut(scope)
          ? this.onScreen(span.at)
          : this.besideWall(span);
      }

      const home = this.home;
      const point = home
        ? planPoint(home, this.floors, this.storey, scope)
        : null;

      return point ? this.onScreen(point) : null;
    });
  }

  pinAnchors(scopes: readonly SceneScope[]): Map<string, Point> {
    const anchors = new Map<string, Point>();

    for (const scope of scopes) {
      if (this.offPage(scope)) continue;

      const at = this.within(this.cellOf(scope), () => {
        const span = openingSpan(this.floors, this.storey, scope);

        if (span) return this.onScreen(span.at);

        const at = this.anchorOf(scope);

        return at && scope.type === 'room' ? this.pinBeside(scope.id, at) : at;
      });

      if (at) anchors.set(scopeKey(scope), at);
    }

    return anchors;
  }

  roomFootprints(slugs: readonly string[]): Map<string, RoomFootprint> {
    const footprints = new Map<string, RoomFootprint>();

    for (const slug of slugs) {
      const ring = this.roomRing(slug);
      const inner = this.roomRing(slug, true);

      if (ring) {
        footprints.set(slug, {
          floor: ring,
          top: ring,
          ...(inner ? { inner } : {}),
        });
      }
    }

    return footprints;
  }

  houseFrame(): Rect | null {
    const cs = this.cells.length === 1 ? this.cells[0].cs : null;
    const box = this.wallBox(this.shownFloors());

    if (!cs || !box) return null;

    const [from, to] = [
      screenOf(cs, box.minX, box.minY),
      screenOf(cs, box.maxX, box.maxY),
    ];
    const at = this.cells[0].at;

    return {
      left: Math.min(from.x, to.x) + at.x,
      top: Math.min(from.y, to.y) + at.y,
      right: Math.max(from.x, to.x) + at.x,
      bottom: Math.max(from.y, to.y) + at.y,
    };
  }

  cellFrames(): PlanCell[] {
    if (this.cells.length < 2) return [];

    return this.cells.flatMap((cell): PlanCell[] => {
      const box = this.wallBox(
        this.floors.filter((floor) => floor.id === cell.floor),
      );

      if (!cell.cs || cell.floor === null || !box) return [];

      const centre = screenOf(
        cell.cs,
        (box.minX + box.maxX) / 2,
        (box.minY + box.maxY) / 2,
      );

      return [
        {
          floor: cell.floor,
          centre: { x: centre.x + cell.at.x, y: centre.y + cell.at.y },
          scale: cell.cs.zoom,
        },
      ];
    });
  }

  outlineOf(scope: SceneScope): ScreenOutline | null {
    const ring = scope.type === 'room' ? this.roomRing(scope.id) : null;

    if (!ring) return null;

    const path = `M${ring.map((point) => `${point.x},${point.y}`).join('L')}Z`;

    return { fill: path, edge: path };
  }

  pickAt(at: Point): SceneScope | null {
    const cell = this.cellAt(at);

    if (!cell) return null;

    const named = this.nameAt(at);

    if (named) return named;

    return this.within(cell, () => {
      const cs = this.cs;

      if (!cs) return null;

      const near = this.nearestMark(cs, at);
      const target = this.targets.find((scope) => scopeKey(scope) === near);

      if (target) return target;

      const { x, y } = this.offset;
      const world = worldOf(cs, at.x - x, at.y - y);
      const room = roomAtPoint(this.floors, this.storey, [world.x, world.y]);

      return (
        this.targets.find(
          (scope) => scope.type === 'room' && scope.id === room,
        ) ?? null
      );
    });
  }

  private shut(scope: SceneScope): boolean {
    const { doors, windows } = this.overlay;
    const open =
      scope.type === 'door'
        ? doors[scope.id]
        : scope.type === 'window'
          ? windows[scope.id]
          : undefined;

    return (open ?? 0) <= 0;
  }

  private nameAt(at: Point): SceneScope | null {
    const x = at.x - this.shift.x;
    const y = at.y - this.shift.y;

    for (const { slug, name, quiet } of this.tags.values()) {
      if (quiet || this.veiled.includes(slug)) continue;
      if (Math.abs(x - name.x) > name.width / 2) continue;
      if (Math.abs(y - name.y) > name.height / 2) continue;

      const room = this.targets.find(
        (scope) => scope.type === 'room' && scope.id === slug,
      );

      if (room) return room;
    }

    return null;
  }

  private holdPin(): void {
    const selected = this.selected;

    if (selected === this.pinFor && (this.pin || selected === null)) return;

    const tag = selected ? this.tags.get(selected) : undefined;

    this.pinFor = selected;
    this.pin = tag
      ? {
          slug: tag.slug,
          world: tag.world,
          tier: tag.tier,
          leadWorld: tag.leadWorld,
          bendWorld: tag.bendWorld,
          size: { width: tag.name.width, height: tag.name.height },
          loose: tag.loose,
          quiet: tag.quiet,
          zoom: tag.zoom,
        }
      : null;
  }

  private get canvas(): HTMLCanvasElement | null {
    return this.renderRoot.querySelector('canvas');
  }

  private get cell(): Cell | null {
    return this.current ?? (this.cells.length === 1 ? this.cells[0] : null);
  }

  private get cs(): CanvasState | null {
    return this.cell?.cs ?? null;
  }

  private get storey(): string | null {
    return this.cell ? this.cell.floor : this.active;
  }

  private get offset(): Point {
    const at = this.origin;

    return { x: this.shift.x + at.x, y: this.shift.y + at.y };
  }

  private within<TResult>(cell: Cell | null, run: () => TResult): TResult {
    const before = this.current;

    this.current = cell;

    try {
      return run();
    } finally {
      this.current = before;
    }
  }

  private cellOf(scope: SceneScope): Cell | null {
    const home = this.home;

    if ((this.cells.length < 2 && this.pages.length === 0) || !home) {
      return this.cell;
    }

    const floor = floorOfScope(home, this.floors, scope);

    return this.cells.find((cell) => cell.floor === floor) ?? null;
  }

  private offPage(scope: SceneScope): boolean {
    return this.pages.length > 0 && this.cellOf(scope) === null;
  }

  private cellAt(at: Point): Cell | null {
    if (this.cells.length < 2) return this.cell;

    const x = at.x - this.shift.x;
    const y = at.y - this.shift.y;

    return (
      this.cells.find(
        (cell) =>
          x >= cell.at.x &&
          x <= cell.at.x + cell.width &&
          y >= cell.at.y &&
          y <= cell.at.y + cell.height,
      ) ?? null
    );
  }

  private eachCell<TItem>(run: (cs: CanvasState) => TItem[]): TItem[] {
    return this.cells.flatMap((cell) =>
      this.within(cell, () => (cell.cs ? run(cell.cs) : [])),
    );
  }

  private draw(): void {
    const canvas = this.canvas;
    const home = this.home;
    const width = Math.round(this.clientWidth);
    const height = Math.round(this.clientHeight);

    if (!canvas || !home || width === 0 || height === 0) return;

    const kept = this.cells;
    const from = this.retileFrom(canvas, width, height);

    this.cells = [];

    if (!this.paint(canvas, home, width, height, from)) this.cells = kept;
  }

  private retileFrom(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): Retiling | null {
    const painted = this.painted;

    if (motionLive.reduced || this.cells.length < 2) return null;
    if (this.margin !== NO_MARGIN) return null;
    if (painted?.width !== width || painted.height !== height) return null;
    if (painted.shift.x !== this.shift.x || painted.shift.y !== this.shift.y) {
      return null;
    }

    const frame = copyOf(canvas);

    return frame ? { frame, tiles: this.tiles() } : null;
  }

  private tiles(): Map<string, Tile> {
    const { width, height } = this.stage;

    return new Map(
      this.cells.flatMap((cell): [string, Tile][] => {
        const box = this.wallBox(
          this.floors.filter((floor) => floor.id === cell.floor),
        );

        if (!cell.cs || cell.floor === null || !box) return [];

        const from = screenOf(cell.cs, box.minX, box.minY);
        const to = screenOf(cell.cs, box.maxX, box.maxY);
        const x = this.shift.x + cell.at.x;
        const y = this.shift.y + cell.at.y;

        return [
          [
            cell.floor,
            {
              house: {
                left: Math.min(from.x, to.x) + x,
                top: Math.min(from.y, to.y) + y,
                right: Math.max(from.x, to.x) + x,
                bottom: Math.max(from.y, to.y) + y,
              },
              cell: {
                left: Math.max(x, 0),
                top: Math.max(y, 0),
                right: Math.min(x + cell.width, width),
                bottom: Math.min(y + cell.height, height),
              },
            },
          ],
        ];
      }),
    );
  }

  private retile(
    from: Retiling,
    canvas: HTMLCanvasElement,
    dpr: number,
    page: string,
  ): void {
    const to = this.tiles();
    const still = [...to].every(([floor, tile]) => {
      const was = from.tiles.get(floor)?.house;

      return was && sameRect(was, tile.house);
    });
    const ctx = canvas.getContext('2d');

    if (to.size < 2 || to.size !== from.tiles.size || still || !ctx) return;

    const next = copyOf(canvas);

    if (!next) return;

    const token = {};
    const start = performance.now();
    const full = 1 - Math.exp(-RETILE_MS / LENS_EASE_MS);
    const step = (now: number): void => {
      if (this.moving !== token) return;

      const spent = Math.min(Math.max(now - start, 0), RETILE_MS);
      const value = (1 - Math.exp(-spent / LENS_EASE_MS)) / full;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = page;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const [floor, was] of from.tiles) {
        const now = to.get(floor);

        if (!now) continue;

        const house = between(was.house, now.house, value);

        blit(ctx, from.frame, was, house, 1 - value, dpr);
        blit(ctx, next, now, house, value, dpr);
      }

      if (spent >= RETILE_MS) {
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(next, 0, 0);
      }

      ctx.restore();

      if (spent < RETILE_MS) {
        requestAnimationFrame(step);

        return;
      }

      this.stopMoving();
    };

    this.moving = token;
    this.dispatchEvent(new CustomEvent('plan-move', { detail: true }));
    step(start);
  }

  private settle(): Point {
    const shift = this.shift;
    const was = this.settled;

    const still = was?.x === shift.x && was.y === shift.y;

    if (!was || motionLive.reduced || still) {
      this.stopSettling();
      this.settled = shift;

      return shift;
    }

    const pending = this.settling?.shift;

    if (pending?.x === shift.x && pending.y === shift.y) return was;

    this.stopSettling();
    this.settling = {
      shift,
      timer: setTimeout(this.finishSettling, SHEET_GLIDE_MS),
    };

    return was;
  }

  private finishSettling = (): void => {
    const settling = this.settling;

    if (!settling) return;

    if (this.translated) {
      settling.timer = setTimeout(this.finishSettling, GLIDE_RECHECK_MS);

      return;
    }

    this.settling = null;
    this.settled = this.shift;
    this.draw();
  };

  private get translated(): boolean {
    const translate = getComputedStyle(this).translate;

    return /[1-9]/.test(translate === 'none' ? '' : translate);
  }

  private overscan(settled: Point): Margin {
    const to = this.shift;
    const was = this.painted?.shift ?? to;
    const margin = {
      left: Math.ceil(Math.max(0, Math.max(settled.x, was.x) - to.x)),
      top: Math.ceil(Math.max(0, Math.max(settled.y, was.y) - to.y)),
      right: Math.ceil(Math.max(0, to.x - Math.min(settled.x, was.x))),
      bottom: Math.ceil(Math.max(0, to.y - Math.min(settled.y, was.y))),
    };
    const none = Object.values(margin).every((side) => side === 0);

    return none || motionLive.reduced ? NO_MARGIN : margin;
  }

  private placeCanvas(canvas: HTMLCanvasElement): void {
    const { left, top, right, bottom } = this.margin;
    const style = canvas.style;
    const none = this.margin === NO_MARGIN;

    style.marginLeft = none ? '' : `${-left}px`;
    style.marginTop = none ? '' : `${-top}px`;
    style.width = none ? '' : `calc(100% + ${left + right}px)`;
    style.height = none ? '' : `calc(100% + ${top + bottom}px)`;
    this.toggleAttribute('overscan', !none);
  }

  private stopSettling(): void {
    if (this.settling) clearTimeout(this.settling.timer);

    this.settling = null;
  }

  private get rest(): Point {
    const origin = this.origin;
    const settled = this.settled ?? this.shift;

    return { x: origin.x + settled.x, y: origin.y + settled.y };
  }

  private get target(): Point {
    const origin = this.origin;

    return { x: origin.x + this.shift.x, y: origin.y + this.shift.y };
  }

  private stopMoving(): void {
    if (!this.moving) return;

    this.moving = null;
    this.dispatchEvent(new CustomEvent('plan-move', { detail: false }));
  }

  private paint(
    canvas: HTMLCanvasElement,
    home: HomeDocument,
    width: number,
    height: number,
    from: Retiling | null = null,
  ): boolean {
    const dpr = window.devicePixelRatio || 1;
    const overlaid = applyOverlay(home, this.overlay);
    const fills = planFills(
      home,
      this.floors,
      this.overlay,
      this.roomMarks,
      this.night,
    );
    const glows = planGlows(home, this.floors, this.active, this.overlay);
    const reserve = this.fitReserve(width, height);
    const shown = this.shownFloors();
    const rooms = new Set(
      shown.flatMap((floor) => floor.rooms.map((room) => room.slug)),
    );
    const doors = new Set(
      shown.flatMap((floor) => floor.floor.doors.map((door) => door.id)),
    );
    const windows = new Set(
      shown.flatMap((floor) => floor.floor.windows.map((pane) => pane.id)),
    );
    const settled = this.settle();
    const key = JSON.stringify([
      settled,
      glows,
      identityOf(home),
      identityOf(this.floors),
      this.active,
      this.scheme,
      this.night,
      this.units,
      this.still,
      width,
      height,
      dpr,
      this.shift,
      reserve,
      this.beside,
      this.dots,
      [...fills].filter(([slug]) => rooms.has(slug)),
      overlaid.additions.lights
        .filter((light) => this.onShownFloor(light))
        .map((light) => light.on === true),
      Object.entries(this.overlay.doors).filter(([id]) => doors.has(id)),
      Object.entries(this.overlay.windows).filter(([id]) => windows.has(id)),
      Object.entries(this.roomMarks)
        .filter(([slug]) => rooms.has(slug))
        .map(([slug, mark]) => [slug, mark.occupied, mark.danger]),
      this.readings,
      this.largeTags,
      this.covers,
      this.glyphs,
      this.sheets,
      this.selected,
      this.page,
    ]);

    if (key === this.drawnKey) return false;

    const ctx = canvas.getContext('2d');

    if (!ctx) return false;

    const palette = planPalette(this.scheme);
    const alpha = this.night ? NIGHT_POOL_ALPHA : POOL_ALPHA;

    this.stopMoving();
    this.drawnKey = key;
    this.stage = { width, height };
    this.painted = {
      width,
      height,
      clear: this.clear,
      shift: this.shift,
      beside: this.beside,
    };
    this.cells = this.layout(width, height, reserve);
    this.holdPin();
    this.stairWords.clear();
    this.captionTexts.clear();
    this.tags.clear();
    this.veiled = [];
    this.loose = [];
    this.quiet = [];
    this.plates = [];
    this.margin = this.overscan(settled);

    const { left, top, right, bottom } = this.margin;
    const mx = left * dpr;
    const my = top * dpr;

    canvas.width = Math.round((width + left + right) * dpr);
    canvas.height = Math.round((height + top + bottom) * dpr);
    this.placeCanvas(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, mx, my);

    for (const cell of this.cells) {
      this.within(cell, () => {
        const { x, y } = this.offset;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, x * dpr + mx, y * dpr + my);

        if (cell.clip) {
          const { left, top, right, bottom } = cell.clip;

          ctx.beginPath();
          ctx.rect(left, top, right - left, bottom - top);
          ctx.clip();
        }

        cell.cs = drawPlan(ctx, {
          home: this.planted(overlaid, cell.floor),
          floors: withDoorsOf(this.floors, this.overlay),
          active: cell.floor,
          width: cell.width,
          height: cell.height,
          palette,
          units: this.units,
          words: planWords,
          labels: false,
          reserve: cell.reserve,
          fit: 'building',
          fitPaddingCm: cell.padding,
          roomFills: fills,
          openFractions: openFractionsOf(this.floors, this.overlay),
          neutralDoorLeaves: true,
          ...(this.still ? { stairWordSize: ROOM_NAME_MIN_PX } : {}),
          overlay: (cs) => {
            cell.cs = cs;
            this.drawGarden(cs);
            this.drawGlows(
              cs,
              planGlows(home, this.floors, cell.floor, this.overlay),
              alpha,
            );
            this.drawMarks(cs);

            if (!this.still) {
              this.keepStairWords(cs);
              this.drawTags(cs);
            }
          },
        });

        if (cell.cs) this.drawCaption(cell.cs);

        ctx.restore();

        if (cell.cs && cell === this.paperCell()) {
          this.drawStageGrid(cell.cs, dpr);
        }
      });
    }

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      this.shift.x * dpr + mx,
      this.shift.y * dpr + my,
    );
    this.drawSeams(ctx);

    if (from) this.retile(from, canvas, dpr, palette.page);

    this.dispatchEvent(new Event('view-change'));

    return true;
  }

  private captionBox(cs: CanvasState): MarkBox | null {
    const caption = this.cell?.caption;

    if (!caption) return null;

    const box = this.wallBox(this.shownFloors());
    const corner = box ? screenOf(cs, box.minX, box.minY) : null;
    const far = box ? screenOf(cs, box.maxX, box.minY) : null;
    const top = this.cell?.reserve.top ?? 0;

    cs.ctx.font = roomNameFont(ROOM_NAME_PX);

    return {
      x: corner && far ? (corner.x + far.x) / 2 : cs.width / 2,
      y: top - CAPTION_PX / 2,
      width: cs.ctx.measureText(caption).width + NAME_PAD_PX * 2,
      height: NAME_HEIGHT_PX,
    };
  }

  private drawCaption(cs: CanvasState): void {
    const caption = this.cell?.caption;
    const box = this.captionBox(cs);

    if (!caption || !box) return;

    const { ctx, palette } = cs;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.page;
    ctx.lineWidth = STAIR_HALO_PX;
    ctx.strokeText(caption, box.x, box.y);
    ctx.fillStyle = palette.ink;
    ctx.fillText(caption, box.x, box.y);
    this.captionTexts.set(
      this.storey ?? '',
      this.shifted([box], this.origin)[0],
    );
  }

  private stacked(): Storey[] {
    if (this.active !== null) return [];

    const stacked = storeys(
      this.floors.filter((floor) => floor.floor.walls.length > 0),
    );

    return stacked.length > 1 ? stacked : [];
  }

  private layout(width: number, height: number, reserve: FitReserve): Cell[] {
    const stacked = this.stacked();

    this.pages = [];
    this.shownPage = null;
    this.besideHeld = true;

    if (stacked.length > 0) {
      const focus = this.focusStorey(stacked);

      if (focus) {
        const reserved = widest(this.fitReserve(width, height), this.beside);

        this.besideHeld =
          heldReserve(width, height, reserved) !== NO_FIT_RESERVE;

        return this.paged(width, height, stacked, focus);
      }

      const { left, right } = this.beside;
      const narrow = width - left - right;
      const options = this.reserveOptions(width, height).map((option) => ({
        ...option,
        left: Math.max(option.left - left, 0),
        right: Math.max(option.right - right, 0),
      }));
      const held = options.filter(
        (option) => heldReserve(narrow, height, option) !== NO_FIT_RESERVE,
      );
      const grids = (held.length > 0 ? held : options).flatMap((option) => {
        const grid = this.grid(narrow, height, option, stacked);

        return grid ? [grid] : [];
      });
      const best = grids.reduce<(typeof grids)[number] | null>(
        (kept, next) => (!kept || next.zoom > kept.zoom ? next : kept),
        null,
      );

      return (
        best?.cells.map((cell) => ({
          ...cell,
          at: { x: cell.at.x + left, y: cell.at.y },
        })) ?? this.paged(width, height, stacked)
      );
    }

    return [this.whole(this.active, width, height, reserve)];
  }

  private whole(
    floor: string | null,
    width: number,
    height: number,
    reserve: FitReserve,
  ): Cell {
    const padding = this.paddingFor(width, height, reserve);

    return {
      floor,
      at: { x: 0, y: 0 },
      width,
      height,
      reserve: this.centred(width, height, reserve, padding),
      padding,
      clip: null,
      caption: null,
      cs: null,
    };
  }

  private focusStorey(stacked: Storey[]): string | null {
    const { left, right } = this.beside;
    const selected = this.selected;

    if (left + right <= 0 || !selected) return null;

    const floor = this.floors.find((one) =>
      one.rooms.some((room) => room.slug === selected),
    );

    return floor && stacked.some((storey) => storey.id === floor.id)
      ? floor.id
      : null;
  }

  private paged(
    width: number,
    height: number,
    stacked: Storey[],
    focus: string | null = null,
  ): Cell[] {
    const ids = stacked.map((storey) => storey.id);
    const ground = stacked.find((storey) => storey.level === 0) ?? stacked[0];
    const page =
      focus ?? (this.page && ids.includes(this.page) ? this.page : ground.id);
    const alone: Cell = {
      floor: page,
      at: { x: 0, y: 0 },
      width,
      height,
      reserve: NO_FIT_RESERVE,
      padding: 0,
      clip: null,
      caption: null,
      cs: null,
    };

    this.pages = ids;
    this.shownPage = page;

    return [
      this.within(alone, () =>
        this.whole(
          page,
          width,
          height,
          this.besideHeld
            ? widest(this.fitReserve(width, height), this.beside)
            : this.fitReserve(width, height),
        ),
      ),
    ];
  }

  private centred(
    width: number,
    height: number,
    reserve: FitReserve,
    padding: number,
  ): FitReserve {
    const box = this.wallBox(this.shownFloors());
    const held = heldReserve(width, height, reserve);

    if (!box || held === NO_FIT_RESERVE) return reserve;

    const { zoom } = fitCamera(
      box,
      width,
      height,
      padding,
      VIEWER_MAX_FIT_ZOOM,
      reserve,
    );
    const along = (full: number, from: number, to: number, span: number) => {
      const half = (zoom * (span + padding)) / 2;
      const fits = full / 2 >= from + half && full / 2 <= to - half;
      const want = fits ? full / 2 : (from + to) / 2;
      const move = 2 * (want - (from + to) / 2);

      return Math.abs(move) > CENTRE_SNAP_PX ? move : 0;
    };
    const across = along(
      width,
      held.left,
      width - held.right,
      box.maxX - box.minX,
    );
    const down = along(
      height,
      held.top,
      height - held.bottom,
      box.maxY - box.minY,
    );
    const moved = {
      left: held.left + Math.max(0, across),
      right: held.right + Math.max(0, -across),
      top: held.top + Math.max(0, down),
      bottom: held.bottom + Math.max(0, -down),
    };

    return heldReserve(width, height, moved) === NO_FIT_RESERVE
      ? reserve
      : moved;
  }

  private grid(
    width: number,
    height: number,
    reserve: FitReserve,
    stacked: Storey[],
  ): { cells: Cell[]; zoom: number } | null {
    const held = heldReserve(width, height, reserve);
    const spans = stacked.map(
      (storey) =>
        this.wallSpan(
          this.floors.filter((floor) => floor.id === storey.id),
        ) ?? {
          x: 1,
          y: 1,
        },
    );
    const pad = this.fitPadding;
    const tiling = (columns: number) => {
      const rows = Array.from(
        { length: Math.ceil(stacked.length / columns) },
        (_, row) => spans.slice(row * columns, (row + 1) * columns),
      );
      const bands = strip(
        height,
        rows.map((row) => Math.max(...row.map((span) => span.y + pad))),
        held.top,
        held.bottom,
        CAPTION_PX,
      );
      const tiles = bands.flatMap((band, row) =>
        strip(
          width,
          rows[row].map((span) => span.x + pad),
          held.left,
          held.right,
        ).map((part) => ({
          row,
          x: part,
          y: band,
          across: part.size - part.lead - part.trail,
          down: band.size - band.lead - band.trail - CAPTION_PX,
        })),
      );
      const drawable = tiles.every(
        ({ x, y }) =>
          heldReserve(x.size, y.size, {
            left: x.lead,
            top: y.lead + CAPTION_PX,
            right: x.trail,
            bottom: y.trail,
          }) !== NO_FIT_RESERVE,
      );
      const zoom = drawable
        ? Math.min(
            ...tiles.map((tile, index) =>
              Math.min(
                tile.across / (spans[index].x + pad),
                tile.down / (spans[index].y + pad),
              ),
            ),
          )
        : 0;

      return { tiles, zoom };
    };
    const { tiles, zoom } = stacked
      .map((_, index) => tiling(stacked.length - index))
      .reduce((kept, next) =>
        next.zoom > kept.zoom * (1 + TILING_SNAP) ? next : kept,
      );

    if (zoom < READABLE_ZOOM && !this.still) return null;

    const belows = tiles.map(({ y, down }, index) =>
      Math.max(
        0,
        Math.min(
          down - zoom * (spans[index].y + pad),
          y.size * (1 - MIN_RESERVED_SPAN) - y.lead - CAPTION_PX - y.trail,
        ),
      ),
    );
    const lowered = tiles.map(
      ({ row }) =>
        Math.min(...belows.filter((_, index) => tiles[index].row === row)) / 2,
    );

    const cells = stacked.map((storey, index): Cell => {
      const { x, y, across, down } = tiles[index];
      const span = spans[index];
      const below = belows[index] - lowered[index];

      return {
        floor: storey.id,
        at: { x: x.start, y: y.start },
        width: x.size,
        height: y.size,
        reserve: {
          left: x.lead,
          top: y.lead + CAPTION_PX + lowered[index],
          right: x.trail,
          bottom: y.trail + below,
        },
        padding: Math.min(
          across / zoom - span.x,
          (down - below - lowered[index]) / zoom - span.y,
        ),
        clip: {
          left: x.start > 0 ? 0 : -width,
          top: y.start > 0 ? 0 : -height,
          right: x.start + x.size < width - 1 ? x.size : x.size + width,
          bottom: y.start + y.size < height - 1 ? y.size : y.size + height,
        },
        caption: floorName(storey.level),
        cs: null,
      };
    });

    return { cells, zoom };
  }

  private drawSeams(ctx: CanvasRenderingContext2D): void {
    if (this.cells.length < 2) return;

    const { lineStrong } = planPalette(this.scheme);

    ctx.strokeStyle = lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (const { at, width, height } of this.cells) {
      if (at.x > 0) {
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(at.x, at.y + height);
      }

      if (at.y > 0) {
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(at.x + width, at.y);
      }
    }

    ctx.stroke();
  }

  private planted(overlaid: HomeDocument, floor: string | null): HomeDocument {
    if (this.still) {
      return {
        ...overlaid,
        additions: {
          ...overlaid.additions,
          props: [],
          lights: [],
          groundZones: [],
          paths: [],
          gardenSteps: [],
        },
      };
    }

    const inside = indoors(overlaid, this.floors);

    if (this.offGround(floor) || this.cells.length > 1) return inside;

    return withGroundToTheEdges({
      ...overlaid,
      additions: { ...overlaid.additions, props: inside.additions.props },
    });
  }

  private offGround(floor: string | null): boolean {
    return (
      floor !== null &&
      this.floors.length > 1 &&
      floor !== groundFloor([...this.floors]).id
    );
  }

  private paperCell(): Cell | null {
    const toward = (cell: Cell) =>
      -this.shift.x * (cell.at.x + cell.width / 2) -
      this.shift.y * (cell.at.y + cell.height / 2);

    return this.cells.reduce<Cell | null>(
      (best, cell) => (!best || toward(cell) > toward(best) ? cell : best),
      null,
    );
  }

  private drawStageGrid(cs: CanvasState, dpr: number): void {
    const { ctx, palette, zoom } = cs;
    const { left, top, right, bottom } = this.margin;
    const width = this.stage.width + left + right;
    const height = this.stage.height + top + bottom;
    const { x, y } = this.offset;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    drawGrid({
      ...cs,
      width,
      height,
      camX: cs.camX - (x + left + cs.width / 2 - width / 2) / zoom,
      camY: cs.camY - (y + top + cs.height / 2 - height / 2) / zoom,
      palette: { ...palette, page: 'rgba(0, 0, 0, 0)' },
    });
    ctx.fillStyle = palette.page;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  private drawGarden(cs: CanvasState): void {
    if (this.cells.length > 1) return;

    for (const { prop, at, indoor } of this.placedProps(cs)) {
      if (!indoor) drawProp(cs, prop, at, false, null, null);
    }
  }

  private placedProps(cs: CanvasState): PlacedProp[] {
    const home = this.home;

    if (!home || this.still) return [];

    const rooms = new Map(
      this.floors.flatMap((floor) => [...floor.roomsBySlug]),
    );

    return home.additions.props
      .filter((prop) => this.onShownFloor(prop))
      .flatMap((prop) => {
        const hung = prop.mount ? resolveMount(prop.mount, this.floors) : null;
        const at = hung?.at ?? resolvePosition(prop, rooms, this.floors);
        const [width, depth] = propFootprint(prop);
        const turn = propAngle(prop, hung);
        const cos = Math.abs(Math.cos(turn));
        const sin = Math.abs(Math.sin(turn));
        const box = {
          ...screenOf(cs, at[0], at[1]),
          width: (width * cos + depth * sin) * cs.zoom,
          height: (width * sin + depth * cos) * cs.zoom,
        };
        const indoor = isIndoor(prop, this.floors, rooms);

        const shown = indoor || (this.cells.length === 1 && this.onStage(box));

        return shown ? [{ prop, at, box, indoor }] : [];
      });
  }

  private onStage(box: MarkBox): boolean {
    const { x, y } = this.offset;
    const { width, height } = this.stage;

    return (
      box.x - box.width / 2 >= -x &&
      box.x + box.width / 2 <= width - x &&
      box.y - box.height / 2 >= -y &&
      box.y + box.height / 2 <= height - y
    );
  }

  private get fitPadding(): number {
    return this.still ? STILL_FIT_PADDING_CM : FIT_PADDING_CM;
  }

  private shownFloors(): DerivedFloor[] {
    return this.floors.filter(
      (floor) => this.storey === null || floor.id === this.storey,
    );
  }

  private onShownFloor(item: Light | Prop): boolean {
    return (
      this.storey === null || floorOfItem(item, this.floors).id === this.storey
    );
  }

  private fitReserve(width: number, height: number): FitReserve {
    const options = this.reserveOptions(width, height);
    const span = this.buildingSpan();

    if (!span) return options[0];

    const zoomWith = (held: FitReserve): number =>
      Math.min(
        (width - held.left - held.right) / span.x,
        (height - held.top - held.bottom) / span.y,
      );

    return options.reduce((best, option) =>
      zoomWith(option) > zoomWith(best) ? option : best,
    );
  }

  private reserveOptions(width: number, height: number): FitReserve[] {
    const bases =
      this.clear.length > 0
        ? clearInsets(this.clear, { width, height }).map((insets) =>
            widest(this.reserve, insets),
          )
        : [this.reserve];
    return this.corner <= 0
      ? bases
      : bases.flatMap((base) => [
          { ...base, top: Math.max(base.top, this.corner) },
          { ...base, right: Math.max(base.right, this.corner) },
        ]);
  }

  private buildingSpan(): { x: number; y: number } | null {
    const span = this.wallSpan();

    return span
      ? { x: span.x + this.fitPadding, y: span.y + this.fitPadding }
      : null;
  }

  private wallSpan(floors = this.shownFloors()): Span | null {
    const box = this.wallBox(floors);

    return box ? { x: box.maxX - box.minX, y: box.maxY - box.minY } : null;
  }

  private wallBox(floors: DerivedFloor[]): Bounds | null {
    const ends = floors.flatMap((floor) =>
      floor.floor.walls.flatMap((wall) => [wall.start, wall.end]),
    );

    if (ends.length === 0) return null;

    const xs = ends.map((end) => end.x);
    const ys = ends.map((end) => end.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  private paddingFor(
    width: number,
    height: number,
    reserve: FitReserve,
  ): number {
    const span = this.wallSpan();
    const across = width - reserve.left - reserve.right - 2 * SIDE_MARGIN_PX;
    const down = height - reserve.top - reserve.bottom - 2 * SIDE_MARGIN_PX;

    if (this.still || height <= width || !span) return this.fitPadding;
    if (across <= 0 || down <= 0) return this.fitPadding;

    return Math.min(
      this.fitPadding,
      Math.max(
        (2 * SIDE_MARGIN_PX * span.x) / across,
        (2 * SIDE_MARGIN_PX * span.y) / down,
      ),
    );
  }

  private drawGlows(
    cs: CanvasState,
    glows: readonly Glow[],
    alpha: number,
  ): void {
    const { ctx } = cs;

    for (const glow of glows) {
      const poly = this.roomPoly(glow.room);

      if (!poly) continue;

      const at = screenOf(cs, glow.at[0], glow.at[1]);
      const reach = POOL_CM * cs.zoom * (0.5 + glow.strength / 2);
      const pool = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, reach);

      pool.addColorStop(0, withAlpha(glow.colour, alpha * glow.strength));
      pool.addColorStop(1, withAlpha(glow.colour, 0));
      ctx.save();
      trace(cs, poly);
      ctx.clip();
      ctx.fillStyle = pool;
      ctx.fillRect(at.x - reach, at.y - reach, reach * 2, reach * 2);
      ctx.restore();
    }
  }

  private drawMarks(cs: CanvasState): void {
    const { ctx } = cs;

    for (const floor of this.floors) {
      if (this.storey !== null && floor.id !== this.storey) continue;

      for (const room of floor.rooms) {
        const mark = Object.hasOwn(this.roomMarks, room.slug)
          ? this.roomMarks[room.slug]
          : null;

        if (room.poly.length < 3) continue;

        if (mark?.danger === 'room') {
          trace(cs, room.poly);
          ctx.save();
          ctx.globalAlpha = DANGER_WASH;
          ctx.fillStyle = DANGER_FILL;
          ctx.fill();
          ctx.restore();
        }

        if (room.slug === this.selected) {
          trace(cs, room.poly);
          ctx.fillStyle = withAlpha(cs.palette.accent, SELECTED_WASH);
          ctx.fill();
        }

        if (mark?.occupied) {
          const inset = insetPolygon(room.poly, OUTLINE_INSET_PX / cs.zoom);

          trace(cs, inset);
          ctx.strokeStyle = markColour(this.scheme === 'dark');
          ctx.lineWidth = OUTLINE_WIDTH_PX;
          ctx.stroke();
        }

        if (room.slug === this.selected) {
          trace(cs, insetPolygon(room.poly, OUTLINE_INSET_PX / cs.zoom));
          ctx.strokeStyle = cs.palette.accent;
          ctx.lineWidth = SELECTED_WIDTH_PX;
          ctx.stroke();
        }

        if (mark?.danger) {
          trace(cs, room.poly);
          ctx.strokeStyle = DANGER_FILL;
          ctx.lineWidth = DANGER_WIDTH_PX;
          ctx.stroke();
        }
      }
    }
  }

  private doorBoxes(cs: CanvasState): MarkBox[] {
    return this.shownFloors().flatMap((floor) =>
      [
        ...floor.floor.doors.map((door) => ({
          type: 'door' as const,
          id: door.id,
        })),
        ...floor.floor.windows
          .filter((pane) => pane.sliding)
          .map((pane) => ({ type: 'window' as const, id: pane.id })),
      ].flatMap((scope) => {
        const span = openingSpan([floor], null, scope);

        if (!span) return [];

        const from = screenOf(cs, span.from[0], span.from[1]);
        const to = screenOf(cs, span.to[0], span.to[1]);

        return [
          {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2,
            width: Math.abs(to.x - from.x) + OPENING_CLEAR_PX,
            height: Math.abs(to.y - from.y) + OPENING_CLEAR_PX,
          },
        ];
      }),
    );
  }

  tagLabels(): TagLabel[] {
    return [...this.tags.values()].flatMap((tag) => {
      if (tag.quiet || !tag.pill || tag.reading === null) return [];
      if (this.veiled.includes(tag.slug)) return [];

      return [
        {
          key: tag.slug,
          x: tag.pill.x + this.shift.x,
          y: tag.pill.y + this.shift.y,
          text: tag.text,
          kind: tag.tier.pill,
          compact: tag.tier.compact,
        },
      ];
    });
  }

  nameTargets(): (MarkBox & { key: string })[] {
    return [...this.tags.values()].flatMap((tag) => {
      if (tag.quiet || this.veiled.includes(tag.slug)) return [];
      if (tag.tier.compact && tag.reading !== null) return [];

      return [
        {
          ...tag.name,
          key: `room:${tag.slug}`,
          x: tag.name.x + this.shift.x,
          y: tag.name.y + this.shift.y,
        },
      ];
    });
  }

  wordBoxes(): (Point & LabelSize & { key: string })[] {
    return [
      ...[...this.tags.values()]
        .filter((tag) => !tag.quiet)
        .map((tag) => ({ key: `name:${tag.slug}`, ...tag.name })),
      ...[...this.tags.values()].flatMap((tag) =>
        tag.lead
          ? leaderBoxes(tag.name, tag.lead, tag.bend).map((box) => ({
              key: `lead:${tag.slug}`,
              ...box,
            }))
          : [],
      ),
      ...[...this.stairWords].map(([id, box]) => ({
        key: `stair:${id}`,
        ...box,
      })),
      ...[...this.captionTexts].map(([id, box]) => ({
        key: `caption:${id}`,
        ...box,
      })),
    ].map((box) => ({
      ...box,
      x: box.x + this.shift.x,
      y: box.y + this.shift.y,
    }));
  }

  tagBounds(slug: string, withLead = true): Rect | null {
    const tag = this.tags.get(slug);

    if (!tag) return null;

    const boxes = [
      ...tagParts(tag),
      ...(tag.lead && withLead
        ? leaderBoxes(tag.name, tag.lead, tag.bend)
        : []),
    ];

    return {
      left:
        Math.min(...boxes.map((box) => box.x - box.width / 2)) + this.shift.x,
      top:
        Math.min(...boxes.map((box) => box.y - box.height / 2)) + this.shift.y,
      right:
        Math.max(...boxes.map((box) => box.x + box.width / 2)) + this.shift.x,
      bottom:
        Math.max(...boxes.map((box) => box.y + box.height / 2)) + this.shift.y,
    };
  }

  stairBoxes(): MarkBox[] {
    return this.eachCell((cs) => this.shifted(this.flightBoxes(cs)));
  }

  furnitureBoxes(): MarkBox[] {
    return this.eachCell((cs) => this.shifted(this.propBoxes(cs)));
  }

  keepClearBoxes(): MarkBox[] {
    return this.eachCell((cs) =>
      this.shifted([
        ...this.doorBoxes(cs),
        ...this.swings(cs).flatMap(swingBoxes),
        ...this.fixturePoints(cs).map((at) => ({
          ...at,
          width: 2 * FIXTURE_CLEAR_PX,
          height: 2 * FIXTURE_CLEAR_PX,
        })),
      ]),
    );
  }

  private fixturePoints(cs: CanvasState): Point[] {
    const home = this.home;

    if (!home || this.still) return [];

    return home.additions.lights.flatMap((light) => {
      const at = planPoint(home, this.floors, this.storey, {
        type: 'light',
        id: light.slug,
      });

      return at ? [screenOf(cs, at[0], at[1])] : [];
    });
  }

  private shifted<TBox extends Point>(boxes: TBox[], by = this.offset): TBox[] {
    return boxes.map((box) => ({ ...box, x: box.x + by.x, y: box.y + by.y }));
  }

  private get origin(): Point {
    return this.cell?.at ?? { x: 0, y: 0 };
  }

  private flightBoxes(cs: CanvasState): MarkBox[] {
    return this.flights(cs).map((flight) => {
      const cos = Math.abs(Math.cos(flight.turn));
      const sin = Math.abs(Math.sin(flight.turn));

      return {
        ...flight.centre,
        width: flight.across * cos + flight.along * sin,
        height: flight.across * sin + flight.along * cos,
      };
    });
  }

  private propBoxes(cs: CanvasState): MarkBox[] {
    return this.placedProps(cs).map(({ box }) => box);
  }

  private flights(cs: CanvasState): StairFlight[] {
    return this.shownFloors().flatMap((floor) =>
      stairShafts(floor.floor.stairs ?? [], (stair) => stair.position).map(
        (shaft): StairFlight => {
          const centre = screenOf(cs, shaft.at.x, shaft.at.y);

          return {
            id: shaft.lead.id,
            centre,
            across: (shaft.lead.width ?? STAIR_WIDTH_CM) * cs.zoom,
            along: (shaft.lead.depth ?? STAIR_DEPTH_CM) * cs.zoom,
            turn: ((shaft.lead.rotation ?? 0) * Math.PI) / 180,
          };
        },
      ),
    );
  }

  private keepStairWords(cs: CanvasState): void {
    cs.ctx.save();

    for (const floor of this.shownFloors()) {
      for (const shaft of stairShafts(
        floor.floor.stairs ?? [],
        (stair) => stair.position,
      )) {
        const plate: CanvasState = { ...cs, labels: [] };

        reserveStairs(plate, shaft.lead, shaft.at);

        const [{ x0, x1, y0, y1 }] = plate.labels;
        const box = {
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          width: x1 - x0,
          height: y1 - y0,
        };

        this.stairWords.set(shaft.lead.id, this.shifted([box], this.origin)[0]);
      }
    }

    cs.ctx.restore();
  }

  private drawTags(cs: CanvasState): void {
    const { ctx } = cs;
    const offset = this.offset;
    const origin = this.origin;
    const rest = this.rest;
    const moving = rest.x !== offset.x || rest.y !== offset.y;
    const panned = this.shift.x !== 0 || this.shift.y !== 0;
    const veils = moving ? [...this.sheets, ...this.covers] : this.sheets;
    const { width, height } = this.stage;
    const cut = (part: MarkBox): boolean =>
      part.x - part.width / 2 < 0 ||
      part.y - part.height / 2 < 0 ||
      part.x + part.width / 2 > width ||
      part.y + part.height / 2 > height;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const tag of this.layoutTags(cs)) {
      const spot = tagSpot(tag);
      const onStage = tagParts(tag).map((part) => ({
        ...part,
        x: part.x + offset.x,
        y: part.y + offset.y,
      }));

      this.tags.set(tag.slug, {
        ...tag,
        name: this.shifted([tag.name], origin)[0],
        pill: tag.pill && this.shifted([tag.pill], origin)[0],
        lead: tag.lead && this.shifted([tag.lead], origin)[0],
        bend: tag.bend && this.shifted([tag.bend], origin)[0],
        world: worldOf(cs, spot.x, spot.y),
        leadWorld: tag.lead && worldOf(cs, tag.lead.x, tag.lead.y),
        bendWorld: tag.bend && worldOf(cs, tag.bend.x, tag.bend.y),
        zoom: cs.zoom,
      });

      if (tag.loose) this.loose.push(tag.slug);
      if (tag.tier.compact) this.plates.push(tag.slug);

      if (tag.quiet) {
        this.quiet.push(tag.slug);

        continue;
      }

      if (
        (tag.stranded && this.sheets.length > 0) ||
        (tag.slug !== this.selected &&
          onStage.some((part) => covered(part, veils) || (panned && cut(part))))
      ) {
        this.veiled.push(tag.slug);

        continue;
      }

      if (tag.lead) this.drawLeader(cs, tag.name, tag.lead, tag.bend);

      if (tag.tier.compact) {
        if (tag.reading === null) this.drawPlate(cs, tag);

        continue;
      }

      ctx.font = roomNameFont(tag.tier.px);
      ctx.fillStyle = cs.palette.ink;
      ctx.fillText(tag.label, tag.name.x, tag.name.y);
      cs.labels.push({
        x0: tag.name.x - tag.name.width / 2,
        x1: tag.name.x + tag.name.width / 2,
        y0: tag.name.y - tag.name.height / 2,
        y1: tag.name.y + tag.name.height / 2,
      });
    }

    ctx.restore();
  }

  private layoutTags(cs: CanvasState): RoomTag[] {
    const floors = this.shownFloors();
    const rings = new Map(
      floors.flatMap((floor) =>
        floor.rooms.map((room): [string, Point[]] => [
          room.slug,
          room.poly.map(([px, py]) => screenOf(cs, px, py)),
        ]),
      ),
    );
    const rooms = floors.flatMap((floor) =>
      floor.rooms.flatMap((room): TagRoom[] => {
        const label = room.label.trim();
        const ring = rings.get(room.slug);

        if (room.nameHidden || !label || !ring || ring.length < 3) return [];

        const [x, y] = visualCentre(room.poly);
        const faces =
          room.innerPoly && room.innerPoly.length > 2
            ? room.innerPoly
            : room.poly;

        return [
          {
            slug: room.slug,
            label,
            reading: Object.hasOwn(this.readings, room.slug)
              ? this.readings[room.slug]
              : null,
            centre: screenOf(cs, x, y),
            ring,
            inner: faces.map(([px, py]) => screenOf(cs, px, py)),
            outer: hasOuterWall(floor, room.slug),
            storey: floor.id,
          },
        ];
      }),
    );
    const rest = this.target;
    const sheets = this.shifted(this.sheets, { x: -rest.x, y: -rest.y });
    const field: TagField = {
      hard: [...this.tagObstacles(cs), ...sheets],
      beneath: [
        ...this.beneathObstacles(cs),
        ...this.fixturePoints(cs).map((at) => ({
          ...at,
          width: 2 * FIXTURE_CLEAR_PX,
          height: 2 * FIXTURE_CLEAR_PX,
        })),
      ],
      glyphs: this.glyphBoxes(),
      soft: [
        ...this.propBoxes(cs),
        ...this.doorBoxes(cs),
        ...this.swings(cs).flatMap(swingBoxes),
      ],
      furniture: this.propBoxes(cs),
      rings: [...rings.values(), ...this.decks(cs)],
      area: this.shownArea(),
      measure: (text, px) => {
        cs.ctx.font = roomNameFont(px);

        return cs.ctx.measureText(text).width;
      },
      lineHeight: nameHeight,
    };
    const large = cs.zoom >= LARGE_PLAN_ZOOM || this.largeTags;
    const pin = this.pin;
    const pinned = pin && {
      ...screenOf(cs, pin.world.x, pin.world.y),
      ...pin.size,
    };
    const whole = (box: MarkBox): boolean =>
      box.x - box.width / 2 >= field.area.left &&
      box.y - box.height / 2 >= field.area.top &&
      box.x + box.width / 2 <= field.area.right &&
      box.y + box.height / 2 <= field.area.bottom;
    const rules: TagRules = {
      reach: LEADER_CARD_SHARE * Math.min(this.stage.width, this.stage.height),
      crowded: this.crowded,
    };
    const pinLead = pin?.leadWorld
      ? screenOf(cs, pin.leadWorld.x, pin.leadWorld.y)
      : null;
    const held =
      pin &&
      pinned &&
      whole(pinned) &&
      !covered(pinned, field.hard) &&
      (!pinLead ||
        (pin.zoom === cs.zoom &&
          Math.hypot(pinned.x - pinLead.x, pinned.y - pinLead.y) <=
            rules.reach)) &&
      rooms.some((room) => room.slug === pin.slug)
        ? {
            slug: pin.slug,
            tier: pin.tier,
            loose: pin.loose,
            at: screenOf(cs, pin.world.x, pin.world.y),
            lead: pinLead,
            bend:
              pin.bendWorld && screenOf(cs, pin.bendWorld.x, pin.bendWorld.y),
          }
        : null;
    const tiers = large ? [LARGE_TIER, ...TAG_TIERS] : TAG_TIERS;
    const view = this.tierKey();
    const still = this.restTags.get(view);
    const chosen = (
      still?.pins.find((one) => one.slug === pin?.slug) ?? still?.pins[0]
    )?.tier;
    const blocking = [...field.hard, ...field.beneath, ...field.glyphs];
    const controls = this.tagObstacles(cs);
    const sheetBoxes = sheets.map((box) => ({
      left: box.x - box.width / 2,
      top: box.y - box.height / 2,
      right: box.x + box.width / 2,
      bottom: box.y + box.height / 2,
    }));
    const buried = new Set(
      rooms
        .filter((room) => mostlyUnderSheet(room.ring, sheetBoxes))
        .map((room) => room.slug),
    );
    const keep = (stuck: ReadonlySet<string>): TagPin[] =>
      this.sheets.length > 0 && still && still.zoom === cs.zoom
        ? still.pins.flatMap((one): TagPin[] => {
            const at = screenOf(cs, one.world.x, one.world.y);
            const reach = one.extent ?? { x: 0, y: 0, ...one.size };
            const box = { ...reach, x: at.x + reach.x, y: at.y + reach.y };

            if (one.slug === held?.slug || one.stranded) return [];
            if (!one.quiet && !whole(box)) return [];
            if (!one.quiet && covered(box, controls)) return [];
            if (
              !one.quiet &&
              !buried.has(one.slug) &&
              !stuck.has(one.slug) &&
              covered(
                {
                  ...box,
                  width: box.width - 2 * LABEL_GAP,
                  height: box.height - 2 * LABEL_GAP,
                },
                blocking,
              )
            ) {
              return [];
            }

            return [
              {
                slug: one.slug,
                tier: one.tier,
                loose: one.loose,
                at,
                lead:
                  one.leadWorld &&
                  screenOf(cs, one.leadWorld.x, one.leadWorld.y),
                bend:
                  one.bendWorld &&
                  screenOf(cs, one.bendWorld.x, one.bendWorld.y),
                quiet: one.quiet,
              },
            ];
          })
        : [];
    const hidden =
      this.sheets.length > 0 && still && still.zoom === cs.zoom
        ? still.pins.flatMap((one): TagPin[] => {
            const at = screenOf(cs, one.world.x, one.world.y);
            const reach = one.extent ?? { x: 0, y: 0, ...one.size };
            const box = { ...reach, x: at.x + reach.x, y: at.y + reach.y };

            if (
              one.slug === pin?.slug ||
              one.stranded ||
              !covered(box, sheets)
            ) {
              return [];
            }

            return [
              {
                slug: one.slug,
                tier: one.tier,
                loose: one.loose,
                at,
                lead:
                  one.leadWorld &&
                  screenOf(cs, one.leadWorld.x, one.leadWorld.y),
                bend:
                  one.bendWorld &&
                  screenOf(cs, one.bendWorld.x, one.bendWorld.y),
                quiet: one.quiet,
              },
            ];
          })
        : [];
    const sunk = rooms
      .filter(
        (room) =>
          (covered({ ...room.centre, width: 1, height: 1 }, sheets) ||
            !room.ring.some(
              (at) =>
                at.x > field.area.left &&
                at.x < field.area.right &&
                at.y > field.area.top &&
                at.y < field.area.bottom,
            )) &&
          room.slug !== pin?.slug &&
          !hidden.some((one) => one.slug === room.slug),
      )
      .map((room): TagPin => ({
        slug: room.slug,
        tier: chosen ?? COMPACT_TIER,
        loose: false,
        at: room.centre,
        lead: null,
        bend: null,
      }));
    const lay = (stuck: ReadonlySet<string>): RoomTag[] =>
      layoutTags(
        rooms,
        field,
        chosen && this.sheets.length > 0 ? [chosen] : tiers,
        held,
        { work: TAG_WORK },
        keep(stuck),
        rules,
        [...hidden, ...sunk],
      );
    const first = lay(new Set());
    const resting = new Set(still?.pins.map((one) => one.slug));
    const stuck = new Set(
      this.sheets.length > 0
        ? first
            .filter(
              (tag) =>
                tag.loose && tag.slug !== pin?.slug && resting.has(tag.slug),
            )
            .map((tag) => tag.slug)
        : [],
    );
    const tags = stuck.size > 0 ? lay(stuck) : first;

    if (tags.length > 0 && this.sheets.length === 0) {
      this.restTags.set(view, {
        zoom: cs.zoom,
        pins: tags.map((tag) => worldPin(cs, tag)),
      });
    }

    return tags;
  }

  private tierKey(): string {
    return JSON.stringify([
      this.storey,
      this.active,
      this.stage.width,
      this.stage.height,
      this.cells.length,
      this.largeTags,
      this.readings,
    ]);
  }

  private localBox(box: MarkBox): MarkBox {
    return { ...box, x: box.x - this.offset.x, y: box.y - this.offset.y };
  }

  private glyphBoxes(): MarkBox[] {
    return this.glyphs.flatMap(({ scope, nudge }) => {
      const at = this.anchorOf(scope);

      return at
        ? [
            this.localBox({
              x: at.x + nudge.x,
              y: at.y + nudge.y,
              ...GLYPH_BOX,
            }),
          ]
        : [];
    });
  }

  private beneathObstacles(cs: CanvasState): MarkBox[] {
    const stairs = [
      ...this.flightBoxes(cs),
      ...this.shifted([...this.stairWords.values()], {
        x: -this.origin.x,
        y: -this.origin.y,
      }),
    ].map((box) => ({
      ...box,
      width: box.width + 2 * STAIR_CLEAR_PX,
      height: box.height + 2 * STAIR_CLEAR_PX,
    }));
    const dots = this.targets
      .filter((scope) => this.dots.includes(scopeKey(scope)))
      .flatMap((scope) => {
        const at = this.anchorOf(scope);

        return at ? [this.localBox({ ...at, ...DOT_BOX })] : [];
      });

    return [...stairs, ...dots];
  }

  private tagObstacles(cs: CanvasState): MarkBox[] {
    const caption = this.captionBox(cs);
    const rest = this.target;

    return [
      ...this.shifted(this.covers, { x: -rest.x, y: -rest.y }),
      ...(caption ? [caption] : []),
    ];
  }

  private decks(cs: CanvasState): Point[][] {
    const home = this.home;
    const shown = new Set(this.shownFloors().map((floor) => floor.id));

    return (home?.additions.balconies ?? []).flatMap((balcony) => {
      const anchor = balconyAnchor(balcony, this.floors);

      if (!anchor || !shown.has(anchor.fd.id)) return [];

      return [
        balconyCorners(balcony, anchor).map(([px, py]) => screenOf(cs, px, py)),
      ];
    });
  }

  private shownArea(): TagArea {
    const clip = this.cell?.clip;
    const offset = this.target;

    return {
      left: Math.max(clip?.left ?? -Infinity, -offset.x),
      top: Math.max(clip?.top ?? -Infinity, -offset.y),
      right: Math.min(
        clip?.right ?? Infinity,
        Math.round(this.clientWidth) - offset.x,
      ),
      bottom: Math.min(
        clip?.bottom ?? Infinity,
        Math.round(this.clientHeight) - offset.y,
      ),
    };
  }

  private drawLeader(
    cs: CanvasState,
    box: MarkBox,
    lead: Point,
    bend: Point | null,
  ): void {
    const { ctx } = cs;
    const [from, ...rest] = leaderPath(box, lead, bend);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);

    for (const to of rest) ctx.lineTo(to.x, to.y);
    ctx.globalAlpha = LEADER_HALO_ALPHA;
    ctx.strokeStyle = cs.palette.page;
    ctx.lineWidth = LEADER_HALO_PX;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cs.palette.ink;
    ctx.lineWidth = LEADER_LINE_PX;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lead.x, lead.y, LEADER_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = cs.palette.ink;
    ctx.fill();
    ctx.restore();
  }

  private drawPlate(cs: CanvasState, tag: RoomTag): void {
    const { ctx, palette } = cs;
    const { x, y, width, height } = tag.name;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
    ctx.fillStyle = palette.ink;
    ctx.fill();
    ctx.font = roomNameFont(tag.tier.px);
    ctx.fillStyle = palette.page;
    ctx.fillText(tag.text, x, y);
    ctx.restore();
  }

  private swings(cs: CanvasState): Swing[] {
    return this.shownFloors().flatMap((floor) =>
      floor.floor.doors.flatMap((door) => {
        const scope = { type: 'door' as const, id: door.id };
        const span = openingSpan(this.floors, this.storey, scope);
        const wall = floor.floor.walls.find(({ id }) => id === door.wallId);

        if (!span || !wall || this.shut(scope)) return [];

        const { normal } = wallFrame(wall);
        const face = doorSwingSide(wall, door, floor.roomAt);
        const reaches = doorLeafReaches(door);
        const leaf = door.width / reaches.length;

        return reaches.map((along): Swing => {
          const [x, y] = along > 0 ? span.from : span.to;
          const [ox, oy] = along > 0 ? span.to : span.from;
          const hinge = screenOf(cs, x, y);
          const tip = screenOf(
            cs,
            x + normal[0] * face * leaf,
            y + normal[1] * face * leaf,
          );
          const jamb = screenOf(cs, ox, oy);
          const radius = Math.hypot(tip.x - hinge.x, tip.y - hinge.y) || 1;
          const width = Math.hypot(jamb.x - hinge.x, jamb.y - hinge.y) || 1;

          return {
            hinge,
            radius,
            out: {
              x: (tip.x - hinge.x) / radius,
              y: (tip.y - hinge.y) / radius,
            },
            along: {
              x: (jamb.x - hinge.x) / width,
              y: (jamb.y - hinge.y) / width,
            },
          };
        });
      }),
    );
  }

  private besideWall(span: OpeningSpan): Point | null {
    const cs = this.cs;
    const at = this.onScreen(span.at);

    if (!cs || !at) return null;

    const reach = this.markReach(span, cs.zoom);

    return {
      x: at.x + span.inward[0] * reach,
      y: at.y + span.inward[1] * reach,
    };
  }

  private markReach(span: OpeningSpan, zoom: number): number {
    const face = (span.thickness / 2) * zoom;
    const beside = face + OPENING_CLEAR_PX;

    return span.inner === null
      ? beside
      : Math.min(beside, Math.max(face, (span.inner * zoom) / 2));
  }

  private hitsOpening(cs: CanvasState, span: OpeningSpan, at: Point): boolean {
    const { x, y } = this.offset;
    const world = worldOf(cs, at.x - x, at.y - y);
    const dx = world.x - span.at[0];
    const dy = world.y - span.at[1];
    const length = Math.hypot(
      span.to[0] - span.from[0],
      span.to[1] - span.from[1],
    );
    const alongX = length > 0 ? (span.to[0] - span.from[0]) / length : 0;
    const alongY = length > 0 ? (span.to[1] - span.from[1]) / length : 0;
    const across = Math.abs(dx * alongX + dy * alongY);
    const into = dx * span.inward[0] + dy * span.inward[1];

    const radius = this.targetRadius / cs.zoom;
    const short = CENTRE_LINE_GAP_PX / cs.zoom;
    const mark = this.markReach(span, cs.zoom) / cs.zoom;
    const deepest = Math.min(mark + radius, (span.inner ?? Infinity) - short);
    const shallowest = Math.max(
      Math.min(-span.thickness / 2, mark - radius),
      short - (span.outer ?? Infinity),
    );

    return (
      across <= Math.max(length / 2, radius) &&
      into < deepest &&
      into > shallowest
    );
  }

  private toStrip(span: OpeningSpan, at: Point): number {
    const from = this.onScreen(span.from);
    const to = this.onScreen(span.to);

    if (!from || !to) return Infinity;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.min(
            1,
            Math.max(0, ((at.x - from.x) * dx + (at.y - from.y) * dy) / length),
          )
        : 0;

    return Math.hypot(from.x + dx * t - at.x, from.y + dy * t - at.y);
  }

  private nearestMark(cs: CanvasState, at: Point): string | null {
    const spots = this.markSpots;
    const shown = new Map(spots?.shown.map((spot) => [spot.key, spot]));
    let best: string | null = null;
    let bestDistance = Infinity;

    for (const scope of this.targets) {
      if (scope.type === 'room') continue;

      const key = scopeKey(scope);
      const anchor = this.anchorOf(scope);
      const spot = spots?.tucked.has(key) ? null : (shown.get(key) ?? anchor);
      const span = openingSpan(this.floors, this.storey, scope);

      shown.delete(key);

      if (!spot && !span) continue;

      const toMark = spot ? Math.hypot(spot.x - at.x, spot.y - at.y) : Infinity;
      const distance = span ? Math.min(toMark, this.toStrip(span, at)) : toMark;

      if (distance >= bestDistance) continue;

      const moved =
        spot !== null && (spot.x !== anchor?.x || spot.y !== anchor.y);
      const hit = span
        ? this.hitsOpening(cs, span, at) ||
          (moved && toMark <= this.targetRadius)
        : toMark <= this.targetRadius;

      if (!hit) continue;

      best = key;
      bestDistance = distance;
    }

    for (const spot of shown.values()) {
      const distance = Math.hypot(spot.x - at.x, spot.y - at.y);

      if (distance >= bestDistance || distance > this.targetRadius) continue;

      best = spot.key;
      bestDistance = distance;
    }

    return best;
  }

  private onScreen([x, y]: Vec2): Point | null {
    const cs = this.cs;

    if (!cs) return null;

    return this.shifted([screenOf(cs, x, y)])[0];
  }

  private roomPoly(slug: string, faces = false): Vec2[] | null {
    for (const floor of this.floors) {
      if (this.storey !== null && floor.id !== this.storey) continue;

      const room = floor.roomsBySlug.get(slug);
      const inner = faces ? room?.innerPoly : null;

      if (inner && inner.length >= 3) return inner;
      if (room && room.poly.length >= 3) return room.poly;
    }

    return null;
  }

  private roomRing(slug: string, faces = false): Point[] | null {
    const room: SceneScope = { type: 'room', id: slug };

    if (this.offPage(room)) return null;

    return this.within(this.cellOf(room), () => {
      const ring = this.roomPoly(slug, faces)?.map((point) =>
        this.onScreen(point),
      );

      return ring?.every((point): point is Point => point !== null)
        ? ring
        : null;
    });
  }

  private pinBeside(slug: string, centre: Point): Point {
    const ring = this.roomRing(slug);
    const glyphs = this.objectAnchors();

    if (!ring) return centre;

    const lamps = glyphs.filter((glyph) => glyph.key.startsWith('light:'));
    const clear = (tip: Point, of: readonly Point[]): boolean =>
      of.every(
        (glyph) =>
          Math.abs(glyph.x - tip.x) >= PIN_HEAD_PX / 2 + PIN_GLYPH_GAP_PX ||
          glyph.y <= tip.y - PIN_HEAD_PX - PIN_STEM_PX - PIN_GLYPH_GAP_PX ||
          glyph.y >= tip.y + PIN_GLYPH_GAP_PX,
      );
    const tips = PIN_NUDGES_PX.map((nudge) => ({
      x: centre.x + nudge.x,
      y: centre.y + nudge.y,
    })).filter((tip) => insidePolygon(tip, ring));
    const pinHeight = PIN_HEAD_PX + PIN_STEM_PX;
    const whole = tips.filter((tip) =>
      boxInside(
        { x: tip.x, y: tip.y - pinHeight / 2 },
        PIN_HEAD_PX,
        pinHeight,
        ring,
      ),
    );

    return (
      whole.find((tip) => clear(tip, glyphs)) ??
      whole.find((tip) => clear(tip, lamps)) ??
      tips.find((tip) => clear(tip, glyphs)) ??
      tips.find((tip) => clear(tip, lamps)) ??
      centre
    );
  }

  private objectAnchors(): ScreenAnchor[] {
    return this.targets
      .filter((scope) => scope.type !== 'room')
      .flatMap((scope) => {
        const anchor = this.anchorOf(scope);

        return anchor ? [{ key: scopeKey(scope), ...anchor }] : [];
      });
  }

  private localPoint(event: MouseEvent): Point {
    const rect = this.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.menuPress = isSecondaryPress(event);

    if (!this.interactive || this.menuPress) return;
    if (event.isPrimary !== false) this.gestures.cancel();

    this.swipeFrom = this.localPoint(event);
    this.gestures.down(this.swipeFrom);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.gestures.move(this.localPoint(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (isSecondaryPress(event)) return;

    const at = this.localPoint(event);
    const from = this.swipeFrom;

    this.swipeFrom = null;

    if (this.gestures.up(at) === 'tap') this.report(at, 'tap');
    if (from) this.turnPage(at.x - from.x, at.y - from.y);
  };

  private onPointerCancel = (): void => {
    this.swipeFrom = null;
    this.gestures.cancel();
  };

  private turnPage(dx: number, dy: number): void {
    const at = this.shownPage ? this.pages.indexOf(this.shownPage) : -1;

    if (at < 0 || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) {
      return;
    }

    const next = this.pages[at + (dx < 0 ? 1 : -1)];

    if (!next) return;

    this.dispatchEvent(
      new CustomEvent<string>('page-change', {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onContextMenu = (event: MouseEvent): void => {
    if (!this.interactive) return;

    event.preventDefault();

    if (!this.menuPress) return;

    this.menuPress = false;
    this.report(this.localPoint(event), 'press');
  };

  private report(at: Point, gesture: SceneGesture): void {
    if (!this.interactive) return;

    const scope = this.pickAt(at);

    if (!scope) return;

    this.dispatchEvent(
      new CustomEvent<ScopeSelectDetail>('scope-select', {
        detail: {
          scopeType: scope.type,
          scopeId: scope.id,
          gesture,
          x: at.x,
          y: at.y,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function groundMaterial(home: HomeDocument): PlotMaterialId | null {
  const ground = home.additions.ground;
  const skin =
    typeof ground === 'object' && ground !== null && 'skin' in ground
      ? ground.skin
      : null;

  return PLOT_MATERIAL_IDS.find((id) => id === skin) ?? null;
}

function withGroundToTheEdges(home: HomeDocument): HomeDocument {
  const material = groundMaterial(home);
  const ends = home.plan.floors.flatMap((floor) =>
    floor.walls.flatMap((wall) => [wall.start, wall.end]),
  );

  if (!material || ends.length === 0) return home;

  const xs = ends.map((end) => end.x);
  const ys = ends.map((end) => end.y);
  const left = Math.min(...xs) - GROUND_REACH_CM;
  const right = Math.max(...xs) + GROUND_REACH_CM;
  const top = Math.min(...ys) - GROUND_REACH_CM;
  const bottom = Math.max(...ys) + GROUND_REACH_CM;
  const lawn: GroundZone = {
    slug: 'card-ground',
    material,
    points: [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
  };

  return {
    ...home,
    additions: {
      ...home.additions,
      groundZones: [
        lawn,
        ...home.additions.groundZones.filter(
          (zone) => (zone.material ?? 'grass') !== material,
        ),
      ],
    },
  };
}

function isIndoor(
  prop: Prop,
  floors: DerivedFloor[],
  rooms: DerivedFloor['roomsBySlug'],
): boolean {
  return (
    prop.mount !== undefined ||
    floorOfItem(prop, floors).roomAt(resolvePosition(prop, rooms, floors)) !==
      null
  );
}

function indoors(home: HomeDocument, floors: DerivedFloor[]): HomeDocument {
  const rooms = new Map(floors.flatMap((floor) => [...floor.roomsBySlug]));
  const inside = (prop: Prop): boolean => isIndoor(prop, floors, rooms);

  return {
    ...home,
    additions: {
      ...home.additions,
      groundZones: [],
      paths: [],
      gardenSteps: [],
      props: home.additions.props.filter(inside),
    },
  };
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);

  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function trace(cs: CanvasState, poly: readonly Vec2[]): void {
  const { ctx } = cs;

  ctx.beginPath();
  poly.forEach(([x, y], index) => {
    const at = screenOf(cs, x, y);

    if (index === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  });
  ctx.closePath();
}

declare global {
  interface HTMLElementTagNameMap {
    'estanza-plan-view': EstanzaPlanView;
  }
}
