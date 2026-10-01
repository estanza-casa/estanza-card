import './plan-view.js';
import './scene-view.js';

import type { HomeDocument } from '@estanza/plan-engine';
import { DEFAULT_LIGHT_COLOR } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';
import { type FitReserve, NO_FIT_RESERVE, planPalette } from '@estanza/plan2d';
import { motionLive } from '@estanza/scene/env.js';
import { glideStep } from '@estanza/scene/explode.js';
import type { UnitSystem } from '@estanza/shared';
import { tokens } from '@estanza/tokens';
import {
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
  unsafeCSS,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  alertStyles,
  armedTemplate,
  bannerTemplate,
  besideGlyphs,
  PIN_FADE_MS,
  PIN_HEAD_PX,
  PIN_STEM_PX,
  pinBox,
  pinsTemplate,
  type PinView,
} from './alert-view.js';
import {
  alertIcons,
  alertName,
  type AlertReading,
  alertStates,
  armedAlarm,
  formatAgo,
  type HomeAlert,
  isArmed,
  openAlertAfterMs,
  readAlerts,
} from './alerts.js';
import {
  actionsFor,
  cardTag,
  cardType,
  DEFAULT_NIGHT,
  DEFAULT_OTHER_FLOORS,
  defaultApiOrigin,
  defaultModelsOrigin,
  type EstanzaCardConfig,
  type NightSource,
  parseCardConfig,
  type SceneBinding,
  type SceneScope,
  scopeKey,
  shareIdFromConfig,
  type View,
} from './bindings.js';
import {
  type PlanCell,
  planSheetPlacement,
  type Rect,
  sameRects,
  SHEET_GLIDE_MS,
  type SheetMove,
} from './camera-rig.js';
import {
  type Face,
  faceStyles,
  faceTemplate,
  manualUpdateDue,
  manualUpdateStyles,
  manualUpdateTemplate,
  readDismissedUpdate,
  writeDismissedUpdate,
} from './card-update.js';
import { type HighlightDetail, highlightEvent } from './config-editor.js';
import {
  CONFIRM_GAP_MS,
  CONFIRMED_FADE_MS,
  type Control,
  controlFor,
  type ControlPlan,
  deedOf,
  FAILED_MARK_MS,
  friendlyName,
  isGuarded,
  isLocked,
  isOn,
  isPlanned,
  LOCK_CONFIRM_MS,
  markedControl,
  opensHome,
  PENDING_LIMIT_MS,
  planBrightness,
  planCover,
  planDeed,
  type PlannedDeed,
  planPosition,
  planToggle,
  planWhite,
  settled,
  TOAST_MS,
} from './control.js';
import {
  type AlertRow,
  ARMED_BOX,
  armedRow,
  bubbleTemplate,
  type ChoiceRow,
  chooserTemplate,
  controlStyles,
  type DeviceRow,
  doorIcon,
  lampState,
  leadersTemplate,
  markIcon,
  type MarkPhase,
  type MarkPointer,
  markTemplate,
  type OpeningLook,
  openingRowIcon,
  type RoomRow,
  SHEET_FADE_MS,
  type SheetActions,
  type SheetSwipe,
  sheetTemplate,
  type Toast,
  toastTemplate,
  toneOf,
} from './control-view.js';
import {
  DANGER_DOT,
  floorPagesTemplate,
  floorStackTemplate,
  floorStyles,
  NOTICE_DOT,
} from './floor-view.js';
import {
  defaultFloor,
  type FloorChoice,
  floorOfScope,
  floorStorageKey,
  linksByFloor,
  readFloorChoice,
  roomOfOpening,
  roomOfPiece,
  type Storey,
  storeys,
  writeFloorChoice,
} from './floors.js';
import {
  DRAG_THRESHOLD_PX,
  GestureTracker,
  isSecondaryPress,
  LONG_PRESS_MS,
  type Point,
  TARGET_RADIUS_PX,
} from './gesture.js';
import {
  entityDomain,
  type HassEntityState,
  type HomeAssistant,
  isOccupied,
  isUnavailable,
  lightColorPresets,
  lightOverlay,
  mapScopeStates,
  sceneOverlayOf,
  type ScopeState,
  type ScopeStateMap,
} from './hass-state.js';
import type { IconName } from './icons.js';
import {
  formatState,
  type PickDetail,
  pickEvent,
  sceneObjectsFromDocument,
  scopeLabels,
  thingsOf,
} from './linking.js';
import {
  type Band,
  bandOf,
  comfortBand,
  covered,
  type Flag,
  flagOf,
  followsClock,
  formatHumidity,
  formatTemperature,
  homedPills,
  insidePolygon,
  LABEL_HEIGHT,
  type LabelSize,
  labelWidth,
  lineClear,
  type Look,
  lookOf,
  type MarkBox,
  msToClockNightChange,
  nudgedPills,
  overStorey,
  pillInside,
  type PillRequest,
  placedBoxes,
  type PlacedLabel,
  placePills,
  roomsInView,
  sitsOnStorey,
  SMALL_LABEL_HEIGHT,
  spotsAround,
  type StoreyPlace,
  strandedPills,
  strayKeys,
  type SunAngles,
  sunOf,
  TABLET_LABEL_HEIGHT,
  TABLET_LABEL_SCALE,
  tintOf,
  uncrossed,
} from './living.js';
import {
  type HitTarget,
  layoutMarks,
  type MarkBubble,
  type MarkRequest,
  type MarkSpots,
  splitHits,
  TOUCH_PX,
} from './mark-layout.js';
import { namesStyles, numberRepeats, openingRowName } from './names.js';
import {
  planFloor,
  readViewChoice,
  VIEW_SWITCH_MS,
  viewKey,
  writeViewChoice,
} from './plan.js';
import type { EstanzaPlanView, GlyphSpot } from './plan-view.js';
import {
  applyChanges,
  emptyRegistry,
  entityChanges,
  type EntityRegistry,
  refreshRegistry,
  REGISTRY_GAP_MS,
  registryDueIn,
  unsettledLinks,
} from './registry.js';
import type { RoomMarks } from './room-marks.js';
import { pillSize } from './room-tags.js';
import {
  emptyOverlay,
  type EstanzaSceneView,
  type RoomFootprint,
  type SceneGesture,
  type SceneOverlay,
  type SceneSheet,
  type ScopeSelectDetail,
  slidingWindows,
} from './scene-view.js';
import {
  type Box,
  boxOf,
  type Dock,
  dockCovers,
  dockSpot,
  mostlyUnderSheet,
  openingsInRoom,
  SHEET_EDGE_PX,
  SHEET_GUESS,
  sheetsBelow,
  type Size,
  swipeCloses,
  underSheet,
} from './sheet.js';
import { switchStyles, viewSwitchTemplate } from './switch-view.js';
import {
  BURN_IN_EVERY_MS,
  BURN_IN_SHIFT_MS,
  burnInPlace,
  controlDrift,
  type Drift,
  framingOf,
  type HomePlace,
  IDLE_RETURN_MS,
  type IdleHold,
  idleMs,
  idleReturn,
  isLateNight,
  isTablet,
  LATE_EXPOSURE,
  lateNightEnd,
  lateNightStart,
  msToLateNightChange,
  type Orientation,
  orientationOf,
  PORTRAIT_CONTROLS_PX,
  REFRAME_WAIT_MS,
  TABLET_TARGET_RADIUS_PX,
} from './tablet.js';
import { tabletStyles } from './tablet-view.js';
import {
  pillTemplate,
  type TemperatureLabel,
  temperaturesTemplate,
  temperatureStyles,
} from './temperature-view.js';
import {
  isTile,
  isWideTile,
  lightsOn,
  navigate,
  TILE_KEYS,
  tileFloors,
} from './tile.js';
import {
  houseTemplate,
  type TileAlert,
  tileStatusTemplate,
  tileStoreyClear,
  tileStyles,
} from './tile-view.js';
import { cardScriptUrl, cardVersion, logCardVersion } from './version.js';

type Mark = { phase: MarkPhase; at: Point };

type Arming = { deed: PlannedDeed; since: number };

type ShownMark = {
  key: string;
  control: Control;
  at: Point;
  opening: OpeningLook | null;
};

type LaidMark = ShownMark & { anchor: Point };

type LaidBubble = MarkBubble & { host: ShownMark | null };

type LaidMarks = { marks: LaidMark[]; bubbles: LaidBubble[]; hidden: string[] };

type Focusable = {
  key: string;
  at: Point;
  room: string | null;
  template: TemplateResult;
};

type Opener = { kind: string; id: string };

type OpenChooser = { key: string; at: Point; members: string[] };

type OpenSheet = {
  key: string;
  at: Point;
  framed: boolean;
  cover: Box | null;
  move: SheetMove;
  stage: { width: number; height: number } | null;
};

const STILL: SheetMove = { scale: 1, x: 0, y: 0 };

type PlanFraming = Pick<OpenSheet, 'key' | 'at' | 'cover' | 'move' | 'stage'>;

type PlanProps = Pick<
  EstanzaPlanView,
  | 'floors'
  | 'active'
  | 'scheme'
  | 'night'
  | 'overlay'
  | 'roomMarks'
  | 'interactive'
  | 'targets'
  | 'targetRadius'
  | 'reserve'
  | 'beside'
  | 'dots'
  | 'corner'
  | 'clear'
  | 'shift'
  | 'units'
  | 'readings'
  | 'largeTags'
  | 'crowded'
  | 'covers'
  | 'glyphs'
  | 'sheets'
  | 'selected'
  | 'page'
  | 'dim'
> & { home: HomeDocument };

type LeftPlan = {
  laid: LaidMarks;
  labels: TemperatureLabel[];
  props: PlanProps;
};

type Swipe = {
  id: number;
  sheet: HTMLElement;
  from: number;
  drop: number;
  at: number;
  speed: number;
  moving: boolean;
};

const SHEET_MOTION_MS = Number.parseInt(tokens.motion.sheet, 10);

type Press = Point & { at: number; picked: boolean };

type Flight = {
  plan: ControlPlan;
  at: Point;
  make: (control: Control, firm: boolean) => ControlPlan;
};

const MARK_CLICK_MS = 400;
const PILL_SETTLE_MS = 150;
const PILL_SETTLE_MAX_MS = 600;
const DRIFT_PX = 0.5;
const PILL_GLIDE_MS = 150;
const GLIDE_FRAME_MS = 16;
const GLIDE_STEP_MAX_MS = 2 * GLIDE_FRAME_MS;
const SWITCH_WAIT_MS = 4000;

const MINUTE_MS = 60 * 1000;

type HomeFloors = {
  document: HomeDocument;
  floors: DerivedFloor[];
  storeys: Storey[];
  floorOf: Map<string, string | null>;
};

type SettledPills = {
  anchors: Map<string, Point>;
  spans: Map<string, number>;
  labels: TemperatureLabel[];
  picked: string | null;
  view: View;
};

type Arranged = { labels: TemperatureLabel[]; lost: Set<string> };
type StoreyRings = { rings: Point[][]; floors: Point[][] };
type PillGlide = { from: Map<string, Point>; target: string; start: number };
type MoveGlide = { from: Drift; to: Drift; spent: number; last: number | null };

type Surface = Pick<
  EstanzaSceneView,
  'anchorOf' | 'outlineOf' | 'pinAnchors' | 'roomFootprints'
>;

const GLYPH_BOX: LabelSize = { width: 32, height: 32 };
const GLYPH_DISC: LabelSize = { width: 24, height: 24 };
const GLYPH_CLEAR: LabelSize = { width: 38, height: 38 };
const GLYPH_HELD: LabelSize = { width: 28, height: 28 };
const BUBBLE_CLEAR: LabelSize = { width: 58, height: 38 };
const GLYPH_REACH: LabelSize = { width: TOUCH_PX, height: TOUCH_PX };
const DOT_BOX: LabelSize = { width: 14, height: 14 };
const UNGROUP_ROOM = 1.15;
const LEADER_STEP_PX = 6;
const HELD_NUDGE_PX = 24;
const ARRANGE_RETRIES = 2;
const FIXTURE_DOT_CLEAR_PX = 5;
const CROWDED_CARD_PX = 400;
const PLAN_CLEAR_PX = 112;
const TABLET_PLAN_CLEAR_PX = 148;
const CORNER_CLEAR_PX = 68;
const TABLET_CORNER_CLEAR_PX = 84;
const FLOOR_CHIP_CARD_PX = 480;
const PAGED_SCENE_CARD_PX = 500;
const CALM_CARD_PX = 400;
const PIN_ROOM_SHARE = 0.1;

const noTargets: SceneScope[] = [];
const noClear: Rect[] = [];

const touchEvents = ['pointerdown', 'click', 'wheel', 'keydown'] as const;

const burstEvents = ['pointermove', 'pointerup', 'pointercancel'] as const;

const TAP_BURST_MS = 150;

const tapSurfaces = ['marks', 'temps', 'pins', 'sheets', 'bubble'];

function onTapSurface(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        tapSurfaces.some((name) => node.classList.contains(name)),
    );
}

function swallow(event: Event): void {
  event.stopImmediatePropagation();
  event.preventDefault();
}

const tabletTimers = ['idle', 'burn', 'late', 'home'] as const;

const origin: Point = { x: 0, y: 0 };

function readingOrder(one: Point, two: Point): number {
  const rise = one.y - two.y;

  return Math.abs(rise) > GLYPH_BOX.height / 2 ? rise : one.x - two.x;
}

function inReadingOrder(
  pills: readonly Focusable[],
  marks: readonly Focusable[],
): Focusable[] {
  const groups = new Map<
    string,
    { pill: Focusable | null; marks: Focusable[] }
  >();

  for (const pill of pills) {
    groups.set(`room:${pill.room ?? ''}`, { pill, marks: [] });
  }

  for (const mark of marks) {
    const group = mark.room === null ? mark.key : `room:${mark.room}`;
    const held = groups.get(group) ?? { pill: null, marks: [] };

    held.marks.push(mark);
    groups.set(group, held);
  }

  return [...groups.values()]
    .map(({ pill, marks: held }) => {
      const sorted = held.sort((one, two) => readingOrder(one.at, two.at));

      return pill ? [pill, ...sorted] : sorted;
    })
    .sort(([one], [two]) => readingOrder(one.at, two.at))
    .flat();
}

function climateState(
  state: HassEntityState,
  hass: HomeAssistant | undefined,
): string {
  const action = state.attributes.hvac_action;

  if (typeof action === 'string' && action !== '') {
    return action.charAt(0).toUpperCase() + action.slice(1);
  }

  return hass ? formatState(hass, state) : state.state;
}

function openerOf(element: Element | null | undefined): Opener | null {
  if (!(element instanceof HTMLElement)) return null;

  const id = element.dataset.key ?? element.dataset.room;
  const kind = element.classList[0];

  return id && kind ? { kind, id } : null;
}

function sameClear(a: readonly Rect[], b: readonly Rect[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameSpots(
  a: ReadonlyMap<string, Point>,
  b: ReadonlyMap<string, Point>,
): boolean {
  if (a.size !== b.size) return false;

  return [...a].every(([key, spot]) => {
    const other = b.get(key);

    return (
      other !== undefined &&
      Math.hypot(spot.x - other.x, spot.y - other.y) < DRIFT_PX
    );
  });
}

function carried(
  from: Point,
  to: Point,
  scale: number,
): (point: Point) => Point {
  return (point: Point): Point => ({
    x: to.x + (point.x - from.x) * scale,
    y: to.y + (point.y - from.y) * scale,
  });
}

function floorSpan(rooms: readonly RoomFootprint[]): number {
  const points = rooms.flatMap((room) => [...room.floor, ...room.top]);

  if (points.length === 0) return 0;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
}

function footprintSpans(
  rooms: ReadonlyMap<string, RoomFootprint>,
): Map<string, number> {
  return new Map(
    [...rooms].map(([slug, room]) => {
      const points = [...room.floor, ...room.top];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);

      return [
        slug,
        Math.hypot(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ),
      ];
    }),
  );
}

function spanScale(before?: number, now?: number): number {
  return before && now ? now / before : 1;
}

function sharesRooms(
  a: ReadonlyMap<string, Point>,
  b: ReadonlyMap<string, Point>,
): boolean {
  return [...a.keys()].some((key) => b.has(key));
}

export type CustomCardRegistration = {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
};

export type CardGridOptions = {
  rows: number;
  columns: number;
  min_rows?: number;
  min_columns?: number;
};

export type RoomTemperature = {
  slug: string;
  text: string;
  band: Band;
  flag: Flag | null;
};

type Reading = { value: number; unit: string | null };

export const cardName = 'Estanza';

export const cardDescription =
  'A live 3D view of your home, with entities bound to rooms and objects.';

@customElement('estanza-card')
export class EstanzaCard extends LitElement {
  static styles = css`
    ${controlStyles}
    ${namesStyles}
    ${floorStyles}
    ${temperatureStyles}
    ${tabletStyles}
    ${switchStyles}
    ${alertStyles}
    ${tileStyles}
    ${faceStyles}
    ${manualUpdateStyles}

    :host {
      display: block;
      height: 100%;
      font-family: var(
        --ha-font-family-body,
        ${unsafeCSS(tokens.typography.family.web)}
      );
    }

    ha-card {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .title {
      padding: 12px 16px 0;
      font-size: 16px;
      font-weight: 500;
    }

    .stage {
      display: flex;
      flex: 1;
      min-height: 0;
      position: relative;
      aspect-ratio: 4 / 3;
    }

    estanza-scene-view {
      flex: 1;
      min-height: 220px;
    }

    :host([layout='panel']) {
      height: calc(100dvh - var(--header-height, 56px));
    }

    :host([layout='panel']) .stage {
      aspect-ratio: auto;
    }

    :host([layout='panel']) estanza-scene-view,
    :host([layout='grid']) estanza-scene-view {
      min-height: 0;
    }

    .sheets {
      display: contents;
    }

    .stage.on-plan :is(estanza-plan-view, .highlight, .marks, .temps, .pins) {
      translate: var(--ez-glide-x, 0px) var(--ez-glide-y, 0px);
    }

    .stage.covered
      :is(
        .dock,
        estanza-scene-view,
        estanza-plan-view,
        .highlight,
        .marks,
        .temps,
        .pins
      ) {
      visibility: hidden;
    }

    .stage:has(> estanza-plan-view[overscan]) {
      overflow: hidden;
    }

    :host([gliding]) .stage.on-plan {
      overflow: hidden;
      background: var(--ez-plan-page);
    }

    :host([gliding]) .stage.on-plan estanza-scene-view {
      visibility: hidden;
    }

    :host([data-pointer-focus]) :focus-visible,
    :host([data-pointer-focus]) :focus-visible .disc,
    :host([data-pointer-focus]) :focus-visible .face {
      outline: none;
    }

    .highlight {
      height: 100%;
      inset: 0;
      pointer-events: none;
      position: absolute;
      width: 100%;
    }

    .highlight-fill {
      fill: var(--ez-chosen);
      fill-opacity: 0.2;
    }

    .highlight-edge {
      fill: none;
      stroke: var(--ez-chosen);
      stroke-linejoin: round;
      stroke-width: 2.5;
    }
  `;

  @property({ attribute: false }) hass?: HomeAssistant;

  @property({ reflect: true }) layout?: string;

  @property({ type: Boolean }) preview = false;

  @property({ attribute: false }) scriptUrl = cardScriptUrl;

  @state() private latestCard: string | null = null;

  @state() private dismissedUpdate = readDismissedUpdate();

  @state() private highlight: SceneScope | null = null;

  @state() private config: EstanzaCardConfig | null = null;

  @state() private sheet: OpenSheet | null = null;

  @state() private sheetSizes: Record<string, Size> = {};

  @state() private sheetRise = 0;

  @state() private chooser: OpenChooser | null = null;

  private opener: Opener | null = null;

  private pointerLast = false;

  private lastTapAt = Number.NEGATIVE_INFINITY;

  private burstPointer: (Point & { id: number }) | null = null;

  private swallowClick = false;

  private touchDown: { path: EventTarget[]; at: number } | null = null;

  private shownSheet: string | null = null;

  private laid: LaidMarks = { marks: [], bubbles: [], hidden: [] };
  private labels: TemperatureLabel[] = [];
  private pillAnchors = new Map<string, Point>();
  private settledPills: SettledPills | null = null;
  private pillsMoving = false;
  private lastShift = 0;
  private shiftGap = PILL_SETTLE_MS;
  private glide: PillGlide | null = null;
  private moveGlide: MoveGlide | null = null;
  private shownMove: Drift = { x: 0, y: 0 };
  private glideFrame: number | null = null;
  private groupedFloors = new Set<string>();
  private groupedSpans = new Map<string, { span: number; scene: string }>();
  private groupedAnchors: ReadonlyMap<string, Point> | null = null;
  private groupedPick: string | null = null;

  private keptStage = '';

  @state() private marks: Record<string, Mark> = {};

  @state() private toast: Toast | null = null;

  @state() private optimistic: Record<string, HassEntityState> = {};

  @state() private draft: number | null = null;

  @state() private planPage: string | null = null;

  @state() private planPages: { ids: string[]; shown: string | null } = {
    ids: [],
    shown: null,
  };

  @state() private floor: FloorChoice = null;

  private lastStorey: string | null = null;

  @state() private homeFloors: HomeFloors | null = null;

  @state() private outdated = false;

  @state() private idle = false;

  @state() private lateClock = false;

  @state() private orientation: Orientation = 'landscape';

  @state() private drift: Drift = { x: 0, y: 0 };

  @state() private planMoving = false;

  @state() private alertClock = 0;

  @state() private leavingAlerts: HomeAlert[] = [];

  @state() private bannerKey: string | null = null;

  @state() private registry: EntityRegistry = emptyRegistry();

  @state() private view: View = '3d';

  @state() private homeDrawn = false;

  @state() private planLeaving = false;

  @state() private planHeld = false;

  private framesAtSwitch = 0;

  private leftPlan: LeftPlan | null = null;

  private planFraming: PlanFraming | null = null;

  private flattenScene = false;

  private switchWatch: number | null = null;

  private switchDeadline = 0;

  private planFrame: {
    floor: FloorChoice;
    frame: Rect | null;
    cells: PlanCell[];
  } | null = null;

  @state() private sceneResting = false;

  @state() private planArriving = false;

  @state() private chipFloors = false;

  @state() private narrowCard = false;

  @state() private floorsOpen = false;

  private controlsClear: Rect[] | null = null;

  private sceneClear: Rect[] | null = null;

  @state() private house: EstanzaCard | null = null;

  idleHold: IdleHold | null = null;

  private viewFor = '';

  private heldForAlert = false;

  private knownAlerts = new Map<string, HomeAlert>();

  private builtAlerts: AlertReading = { alerts: [], recheckIn: null };

  private alertsFrom: ScopeStateMap | null = null;

  private alertsFor: EstanzaCardConfig | null = null;

  private alertsAt = -1;

  private syncedAlerts: AlertReading | null = null;

  private syncedIn: HomeFloors | null = null;

  private tabletFor: EstanzaCardConfig | null = null;

  private burnIndex = 0;

  private sizeObserver: ResizeObserver | null = null;

  private press: Press | null = null;

  private pressedBubble: string | null = null;
  private pressedPill: string | null = null;
  private markDrag: (Point & { id: number }) | null = null;
  private pressedMark: { scope: SceneScope; at: Point } | null = null;
  private markTouch: { x: number; y: number; at: number } | null = null;
  private menuPress = false;

  private readonly markGestures = new GestureTracker(() =>
    this.selectMark('press'),
  );

  private readonly flights = new Map<string, Flight>();

  private readonly armings = new Map<string, Arming>();

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private states: ScopeStateMap = {};

  private statesFrom: HomeAssistant | null = null;

  private statesFor: EstanzaCardConfig | null = null;

  private statesWith: Record<string, HassEntityState> | null = null;

  private builtOverlay: SceneOverlay = emptyOverlay();

  private overlayFrom: ScopeStateMap | null = null;

  private builtControls = new Map<string, Control>();

  private controlsFrom: ScopeStateMap | null = null;

  private controlsNamed: Map<string, string> | null = null;

  private builtNames = new Map<string, string>();

  private namesIn: HomeFloors | null = null;

  private builtOpenings = new Map<string, Control>();

  private openingsFrom: Map<string, Control> | null = null;

  private builtTargets: SceneScope[] = noTargets;

  private builtMarks: RoomMarks = {};

  private marksFrom: ScopeStateMap | null = null;

  private marksFor: EstanzaCardConfig | null = null;

  private marksIn: HomeFloors | null = null;

  private marksWith: AlertReading | null = null;

  private targetKeys = '';

  private builtPickable: SceneScope[] = noTargets;

  private pickableIn: HomeFloors | null = null;

  private pickableWith: SceneBinding[] | null = null;

  private builtLive: EstanzaCardConfig | null = null;

  private liveFor: EstanzaCardConfig | null = null;

  private liveFrom: Record<string, HassEntityState> | null = null;

  private liveWith: EntityRegistry | null = null;

  private liveKey = '';

  private readonly steadyValues = new Map<
    string,
    { key: string; value: unknown }
  >();

  private swipe: Swipe | null = null;

  static getConfigElement(): HTMLElement {
    return document.createElement('estanza-card-editor');
  }

  static getStubConfig(): EstanzaCardConfig {
    return { type: cardType, bindings: [] };
  }

  setConfig(config: unknown): void {
    this.config = parseCardConfig(config);
    this.outdated = false;
    this.followRenames();
    this.restoreView();

    if (this.interactive) return;

    this.sheet = null;
    this.marks = {};
    this.toast = null;
  }

  get interactive(): boolean {
    return this.config?.interaction !== 'none';
  }

  get tablet(): boolean {
    return isTablet(this.config?.tablet ?? 'auto', this.layout);
  }

  get largePills(): boolean {
    return this.tablet && this.view === '3d';
  }

  get lateNight(): boolean {
    return this.tablet && this.idle && this.lateClock;
  }

  get defaultView(): View {
    return this.config?.default_view ?? '3d';
  }

  getCardSize(): number {
    return this.config?.title ? 7 : 6;
  }

  getGridOptions(): CardGridOptions {
    return { rows: 8, columns: 12, min_rows: 2, min_columns: 6 };
  }

  get tile(): boolean {
    return isTile(this.config?.grid_options);
  }

  get shareId(): string {
    return this.config ? (shareIdFromConfig(this.config) ?? '') : '';
  }

  get homeDocument(): HomeDocument | null {
    return this.config?.home_document ?? null;
  }

  private get face(): Face | null {
    if (this.outdated) return 'outdated';
    if (!this.shareId && !this.homeDocument) return 'no-home';

    return null;
  }

  get apiOrigin(): string {
    return this.config?.api_origin ?? defaultApiOrigin;
  }

  get modelsOrigin(): string {
    return this.config?.models_origin ?? defaultModelsOrigin;
  }

  get liveConfig(): EstanzaCardConfig | null {
    const config = this.config;
    const states = this.hass?.states;

    if (!config || !states) return config;

    if (
      config === this.liveFor &&
      states === this.liveFrom &&
      this.registry === this.liveWith
    ) {
      return this.builtLive;
    }

    const changes = entityChanges(config, states, this.registry);
    const key = JSON.stringify([...changes]);

    if (config !== this.liveFor || key !== this.liveKey) {
      this.builtLive = applyChanges(config, changes);
    }

    this.liveFor = config;
    this.liveFrom = states;
    this.liveWith = this.registry;
    this.liveKey = key;

    return this.builtLive;
  }

  get scopeStates(): ScopeStateMap {
    const config = this.liveConfig;
    const hass = this.hass;

    if (!config || !hass) return {};

    if (
      hass !== this.statesFrom ||
      config !== this.statesFor ||
      this.optimistic !== this.statesWith
    ) {
      this.statesFrom = hass;
      this.statesFor = config;
      this.statesWith = this.optimistic;
      this.states = mapScopeStates(
        withStates(hass, this.optimistic),
        config.bindings,
      );
    }

    return this.states;
  }

  get overlay(): SceneOverlay {
    const scopeStates = this.scopeStates;

    if (scopeStates === this.overlayFrom) return this.builtOverlay;

    this.overlayFrom = scopeStates;
    this.builtOverlay = sceneOverlayOf(scopeStates);

    return this.builtOverlay;
  }

  get controls(): Map<string, Control> {
    const scopeStates = this.scopeStates;

    const names = this.thingNames;

    if (scopeStates === this.controlsFrom && names === this.controlsNamed) {
      return this.builtControls;
    }

    const controls = new Map<string, Control>();

    const bindings = this.config?.bindings ?? [];

    for (const scopeState of Object.values(scopeStates)) {
      const control = controlFor(
        scopeState,
        actionsFor(bindings, scopeState.scope),
        names.get(scopeKey(scopeState.scope)) ?? null,
      );

      if (control) controls.set(control.key, control);
    }

    this.controlsFrom = scopeStates;
    this.controlsNamed = names;
    this.builtControls = controls;

    return controls;
  }

  private get thingNames(): Map<string, string> {
    const home = this.homeFloors;

    if (home !== this.namesIn) {
      this.namesIn = home;
      this.builtNames = new Map(
        sceneObjectsFromDocument(home?.document).map((option) => [
          option.key,
          option.short,
        ]),
      );
    }

    return this.builtNames;
  }

  private thingName(scope: SceneScope): string {
    return this.thingNames.get(scopeKey(scope)) ?? scopeLabels[scope.type];
  }

  get targets(): SceneScope[] {
    if (!this.preview && !this.interactive) return noTargets;

    const shown = this.preview
      ? this.pickable
      : [...this.controls.values(), ...this.readOnlyOpenings()].map(
          (control) => control.scope,
        );
    const scopes = shown.filter((scope) => this.inView(scope));
    const keys = scopes.map(scopeKey).join('|');

    if (keys !== this.targetKeys) {
      this.targetKeys = keys;
      this.builtTargets = scopes;
    }

    return this.builtTargets;
  }

  private get pickable(): SceneScope[] {
    const home = this.homeFloors;
    const bindings = this.config?.bindings ?? [];

    if (!home) return noTargets;

    if (home !== this.pickableIn || bindings !== this.pickableWith) {
      this.pickableIn = home;
      this.pickableWith = bindings;
      this.builtPickable = thingsOf(home.document, home.floors, bindings).map(
        (thing) => thing.scope,
      );
    }

    return this.builtPickable;
  }

  get storeys(): Storey[] {
    const floors = this.homeFloors;

    return floors && floors.storeys.length > 1 ? floors.storeys : [];
  }

  get floorDots(): Map<string, string> {
    const dots = new Map<string, string>();

    for (const scopeState of Object.values(this.scopeStates)) {
      const { type } = scopeState.scope;

      if (type !== 'light' && type !== 'room') continue;

      const light = lightOverlay(scopeState);
      const floor = this.floorOf(scopeState.scope);

      if (!light.on || !floor || dots.has(floor)) continue;

      dots.set(floor, light.color ?? DEFAULT_LIGHT_COLOR);
    }

    for (const alert of this.alerts) {
      const floor = alert.scope ? this.floorOf(alert.scope) : null;

      if (!floor) continue;
      if (alert.severity === 'critical') dots.set(floor, DANGER_DOT);
      else if (!dots.has(floor)) dots.set(floor, NOTICE_DOT);
    }

    return dots;
  }

  get alerts(): HomeAlert[] {
    return this.alertReading.alerts;
  }

  get armed(): boolean {
    return this.hass ? isArmed(this.hass) : false;
  }

  private renderShield(): TemplateResult | typeof nothing {
    const alarm = this.hass ? armedAlarm(this.hass) : null;

    if (!alarm) return nothing;

    return armedTemplate(alarm, () => this.openMoreInfo(alarm.entityId));
  }

  private get alertReading(): AlertReading {
    const scopeStates = this.scopeStates;
    const hass = this.hass;

    if (!hass || !this.config) return this.builtAlerts;

    if (
      scopeStates !== this.alertsFrom ||
      this.config !== this.alertsFor ||
      this.alertClock !== this.alertsAt
    ) {
      this.alertsFrom = scopeStates;
      this.alertsFor = this.config;
      this.alertsAt = this.alertClock;
      this.builtAlerts = readAlerts(
        hass,
        scopeStates,
        Date.now(),
        openAlertAfterMs(this.config),
      );
    }

    return this.builtAlerts;
  }

  private get criticalAlerts(): HomeAlert[] {
    return this.alerts.filter((alert) => alert.severity === 'critical');
  }

  private get shownAlert(): HomeAlert | null {
    const critical = this.criticalAlerts;

    return (
      critical.find((alert) => alert.key === this.bannerKey) ??
      critical[0] ??
      null
    );
  }

  get look(): Look {
    return lookOf(this.nightSource, this.hass);
  }

  get sun(): SunAngles | null {
    return sunOf(this.nightSource, this.hass);
  }

  private get nightSource(): NightSource {
    return this.config?.night ?? DEFAULT_NIGHT;
  }

  get roomTemperatures(): RoomTemperature[] {
    const readings = [...this.readings()];
    const values = readings.map(([, reading]) => reading.value);
    const system = this.systemUnit;

    return readings.map(([slug, reading]) => ({
      slug,
      text: formatTemperature(reading.value, reading.unit, system),
      band: this.bandOf(reading),
      flag: flagOf(
        reading.value,
        values,
        comfortBand(this.config ?? {}, reading.unit),
        reading.unit,
      ),
    }));
  }

  get roomMarks(): RoomMarks {
    const scopeStates = this.scopeStates;
    const alerts = this.alertReading;

    if (
      scopeStates === this.marksFrom &&
      this.config === this.marksFor &&
      this.homeFloors === this.marksIn &&
      alerts === this.marksWith
    ) {
      return this.builtMarks;
    }

    const readings = this.readings();
    const tinted = this.config?.temperature_tint === true;
    const marks: RoomMarks = {};

    for (const scopeState of Object.values(scopeStates)) {
      const { type, id } = scopeState.scope;

      if (type !== 'room') continue;

      const reading = readings.get(id);
      const usable = scopeState.states.filter((state) => !isUnavailable(state));

      marks[id] = {
        occupied: isOccupied(usable),
        tint: tinted && reading ? tintOf(this.bandOf(reading)) : null,
        danger: null,
      };
    }

    this.markDanger(marks, alerts.alerts);
    this.marksFrom = scopeStates;
    this.marksFor = this.config;
    this.marksIn = this.homeFloors;
    this.marksWith = alerts;
    this.builtMarks = marks;

    return marks;
  }

  private markDanger(marks: RoomMarks, alerts: HomeAlert[]): void {
    const blank = { occupied: false, tint: null, danger: null };

    for (const alert of alerts) {
      if (alert.severity !== 'critical') continue;

      if (!alert.scope) {
        for (const floor of this.homeFloors?.floors ?? []) {
          for (const room of floor.rooms) {
            const mark = own(marks, room.slug) ?? blank;

            marks[room.slug] = { ...mark, danger: mark.danger ?? 'rim' };
          }
        }

        continue;
      }

      const room = this.roomOfAlert(alert);

      if (room)
        marks[room] = { ...(own(marks, room) ?? blank), danger: 'room' };
    }
  }

  private roomAlertRows(room: string): AlertRow[] {
    return this.criticalAlerts
      .filter((alert) => this.roomOfAlert(alert) === room)
      .map((alert) => ({
        entityId: alert.entityId,
        icon: alertIcons[alert.kind],
        name: this.alertName(alert),
        state: `${alertStates[alert.kind]} · ${formatAgo(Date.now() - alert.since)}`,
      }));
  }

  private alertName(alert: HomeAlert): string {
    return alertName(alert.kind, alert.scope ? this.whereOf(alert) : null);
  }

  private onPinTap = (key: string): void => {
    const alert = this.alerts.find((entry) => entry.key === key);

    if (!alert) return;

    const room = this.roomOfAlert(alert);
    const roomKey = room ? scopeKey({ type: 'room', id: room }) : null;
    const at = this.pinViews().find((pin) => pin.key === key)?.at ?? origin;

    if (this.interactive && roomKey && this.controls.has(roomKey)) {
      this.closeSheet();
      this.openSheet(roomKey, at);

      return;
    }

    this.openMoreInfo(alert.entityId);
  };

  private roomOfAlert(alert: HomeAlert): string | null {
    const scope = alert.scope;

    if (scope?.type === 'room') return scope.id;
    if (scope?.type === 'prop') return this.roomOfPiece(scope);

    return null;
  }

  render(): TemplateResult | null {
    if (!this.config) return null;

    const face = this.face;

    if (face) {
      return html`<ha-card class=${this.tile ? 'tile' : ''}>
        ${faceTemplate(face)}
      </ha-card>`;
    }

    if (this.tile) return this.renderTile();

    const left = this.planLeaving ? this.leftPlan : null;
    const drawn = left?.laid ?? this.laidMarks();
    const labels = left?.labels ?? this.temperatureLabels(drawn);
    const laid =
      left?.laid ?? this.clearOfPills(this.groupedMarks(drawn), labels);
    const look = this.look;

    this.laid = laid;
    this.labels = labels;

    return html`
      <ha-card>
        ${
          this.config.title
            ? html`<div class="title">${this.config.title}</div>`
            : nothing
        }
        <div
          class=${[
            'stage',
            this.armed ? 'armed' : '',
            this.onPlan ? 'on-plan' : '',
            this.planLeaving
              ? this.planHeld
                ? 'plan-held'
                : 'plan-leaving'
              : '',
            this.planArriving ? 'plan-arriving' : '',
            this.planMoving ? 'retiling' : '',
            this.bottomSheet || this.bottomChooser ? 'sheet-up' : '',
            this.sheetCovers ? 'covered' : '',
            this.pillsMoving ? 'pills-moving' : '',
            this.homeDrawn ? '' : 'undrawn',
          ]
            .filter(Boolean)
            .join(' ')}
          data-look=${look.theme}
          style=${this.stageStyle || nothing}
          @pointerdown=${this.onStagePointer}
          @pointerup=${this.onStageRelease}
          @pointermove=${this.onStageMove}
          @contextmenu=${this.onStageMenu}
        >
          <div class="dock">
            ${this.renderViewSwitch()}${this.renderFloors()}${this.renderPages()}
          </div>
          <estanza-scene-view
            .shareId=${this.shareId}
            .homeDocument=${this.homeDocument}
            .apiOrigin=${this.apiOrigin}
            .modelsOrigin=${this.modelsOrigin}
            .overlay=${this.overlay}
            .night=${look.night}
            .sun=${this.sun}
            .spill=${this.config.spill ?? 'wash'}
            .quality=${this.config.quality ?? 'auto'}
            .roomMarks=${this.roomMarks}
            .interactive=${this.interactive || this.preview}
            .targets=${this.targets}
            .floor=${this.sceneFloor}
            .otherFloors=${this.config.other_floors ?? DEFAULT_OTHER_FLOORS}
            .paging=${this.scenePaging}
            .exposure=${this.lateNight ? LATE_EXPOSURE : 1}
            .framing=${framingOf(this.tablet, this.orientation)}
            .targetRadius=${this.targetRadius}
            .clear=${this.sceneClear}
            .sheet=${this.sceneSheet}
            .planFrame=${
              this.planFrame?.floor === this.floor ? this.planFrame.frame : null
            }
            .planCells=${
              this.planFrame?.floor === this.floor ? this.planFrame.cells : null
            }
            .paused=${this.view === '2d' && this.sceneResting}
            @scope-select=${this.onSceneSelect}
            @view-change=${this.onViewChange}
            @home-change=${this.onHomeChange}
            @camera-input=${this.onCameraInput}
            @page-swipe=${this.onPageSwipe}
          ></estanza-scene-view>
          ${this.renderPlan(look)} ${this.renderHighlight()}
          ${this.renderPins()}
          ${temperaturesTemplate(
            labels,
            look.theme,
            this.interactive || this.preview ? this.onPill : null,
            !this.interactive,
          )}
          ${this.renderBanner()} ${this.renderControls(laid, labels)}
          ${this.renderShield()}
        </div>
        ${this.renderManualUpdate()}
      </ha-card>
    `;
  }

  private renderManualUpdate(): TemplateResult | typeof nothing {
    const latest = this.latestCard;

    if (
      latest === null ||
      latest === this.dismissedUpdate ||
      !manualUpdateDue(cardVersion, latest, this.scriptUrl)
    ) {
      return nothing;
    }

    return manualUpdateTemplate(latest, () => {
      this.dismissedUpdate = latest;
      writeDismissedUpdate(latest);
    });
  }

  private get stageStyle(): string {
    return [
      this.tablet
        ? `--ez-drift-x:${this.drift.x}px;--ez-drift-y:${this.drift.y}px`
        : '',
      this.sheetRise > 0 ? `--ez-sheet-rise:${this.sheetRise}px` : '',
      `--ez-plan-page:${planPalette(this.look.theme).page}`,
    ]
      .filter(Boolean)
      .join(';');
  }

  private renderTile(): TemplateResult {
    const home = this.homeFloors;
    const look = this.look;

    return html`
      <ha-card
        class="tile"
        style="--ez-tile-page:${planPalette(look.theme).page}"
        role="button"
        tabindex="0"
        aria-label="Open the house"
        title="Open the house"
        @click=${this.openHouse}
        @keydown=${this.onTileKey}
      >
        <estanza-scene-view
          headless
          .shareId=${this.shareId}
          .homeDocument=${this.homeDocument}
          .apiOrigin=${this.apiOrigin}
          .modelsOrigin=${this.modelsOrigin}
          @home-change=${this.onHomeChange}
        ></estanza-scene-view>
        ${
          home
            ? html`<div class="tile-plans">
                  ${tileFloors(
                    home.floors,
                    this.tileFloor,
                    isWideTile(this.config?.grid_options),
                  ).map((floor) => this.renderTileFloor(home, floor, look))}
                </div>
                ${tileStatusTemplate({
                  lights: lightsOn(this.scopeStates),
                  alert: this.tileAlert,
                })}`
            : nothing
        }
      </ha-card>
      ${
        this.house
          ? houseTemplate({
              house: this.house,
              title: this.houseTitle,
              close: this.closeHouse,
            })
          : nothing
      }
    `;
  }

  private renderTileFloor(
    home: HomeFloors,
    floor: FloorChoice,
    look: Look,
  ): TemplateResult {
    const storey = this.storeys.find((shown) => shown.id === floor);

    return html`<div class="tile-floor">
      ${
        storey
          ? html`<span class="tile-storey" aria-hidden="true"
              >${storey.label}</span
            >`
          : nothing
      }
      <estanza-plan-view
        .home=${home.document}
        .floors=${home.floors}
        .active=${floor}
        .scheme=${look.theme}
        .night=${look.theme === 'dark'}
        .overlay=${this.overlay}
        .roomMarks=${this.roomMarks}
        .interactive=${false}
        still
        .clear=${storey ? tileStoreyClear : noClear}
        .units=${this.planUnits}
      ></estanza-plan-view>
    </div>`;
  }

  private get tileFloor(): FloorChoice {
    const scope = this.shownAlert?.scope;
    const floor = scope && this.storeys.length > 0 ? this.floorOf(scope) : null;

    return floor ?? this.floor;
  }

  private get tileAlert(): TileAlert | null {
    const alert = this.shownAlert ?? this.alerts[0] ?? null;

    if (!alert) return null;

    return {
      kind: alert.kind,
      severity: alert.severity,
      words: this.alertName(alert),
    };
  }

  private openHouse = (): void => {
    const config = this.config;

    if (!config) return;

    if (config.navigation_path) {
      navigate(config.navigation_path);

      return;
    }

    const house = document.createElement('estanza-card');

    house.layout = 'grid';
    house.setConfig({
      ...config,
      title: undefined,
      grid_options: undefined,
      navigation_path: undefined,
    });
    house.hass = this.hass;
    this.house = house;
  };

  private get houseTitle(): string {
    return (
      this.config?.title?.trim() ||
      this.sceneView?.sharedHome?.name.trim() ||
      this.homeFloors?.document.plan.name?.trim() ||
      cardName
    );
  }

  private closeHouse = (): void => {
    this.house = null;
  };

  private onTileKey = (event: KeyboardEvent): void => {
    if (event.target !== event.currentTarget) return;
    if (!(TILE_KEYS as readonly string[]).includes(event.key)) return;

    event.preventDefault();
    this.openHouse();
  };

  protected updated(): void {
    const dialog =
      this.renderRoot.querySelector<HTMLDialogElement>('dialog.house');

    if (dialog && !dialog.open) dialog.showModal();

    this.measureSheet();
    this.frameForSheet();
    this.measureControls();
    this.shareMarkSpots();
    this.moveFocus();
    this.flattenOnce();
    this.splitTargets();
  }

  private flattenOnce(): void {
    const scene = this.sceneView;

    if (!this.flattenScene || !scene) return;

    this.flattenScene = false;
    scene.tiltDown(burnInPlace(this.burnIndex), 0);
  }

  private splitTargets(): void {
    const stage = this.stage;

    if (!stage) return;

    const origin = stage.getBoundingClientRect();
    const boxOn = (element: Element): Box => {
      const rect = element.getBoundingClientRect();

      return {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        right: rect.right - origin.left,
        bottom: rect.bottom - origin.top,
      };
    };
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
    const buttons = [
      ...stage.querySelectorAll<HTMLElement>(
        '.mark:not(.under, .dot), .bubble:not(.under), button.temp',
      ),
    ];
    const targets = buttons.map((button): HitTarget => {
      const own = boxOn(button);
      const shown = boxOn(button.querySelector('.disc, .face') ?? button);
      const pill = button.classList.contains('temp');
      const reach = coarse && pill ? TOUCH_PX : 0;

      return {
        key: pill ? `room:${button.dataset.room}` : (button.dataset.key ?? ''),
        shown,
        hit: pill
          ? grownTo(shown, reach)
          : {
              left: Math.min(own.left, shown.left),
              top: Math.min(own.top, shown.top),
              right: Math.max(own.right, shown.right),
              bottom: Math.max(own.bottom, shown.bottom),
            },
        fixed: false,
      };
    });
    const plan = this.view === '2d' ? this.planView : null;
    const at = plan ? boxOn(plan) : null;
    const names = (plan?.nameTargets() ?? []).map((name): HitTarget => {
      const shown = {
        left: name.x - name.width / 2 + (at?.left ?? 0),
        top: name.y - name.height / 2 + (at?.top ?? 0),
        right: name.x + name.width / 2 + (at?.left ?? 0),
        bottom: name.y + name.height / 2 + (at?.top ?? 0),
      };

      return { key: name.key, shown, hit: shown, fixed: true };
    });
    const hits = splitHits([...targets, ...names]);

    buttons.forEach((button, index) => {
      const own = boxOn(button);
      const hit = hits[index];

      button.style.setProperty('--hit-t', `${hit.top - own.top}px`);
      button.style.setProperty('--hit-r', `${own.right - hit.right}px`);
      button.style.setProperty('--hit-b', `${own.bottom - hit.bottom}px`);
      button.style.setProperty('--hit-l', `${hit.left - own.left}px`);
    });
  }

  private noteOpener(): void {
    const key = this.openKey;
    const active = this.shadowRoot?.activeElement;

    if (key === null || key === this.shownSheet) return;
    if (active?.closest('.sheets')) return;

    this.opener = openerOf(active);
  }

  private moveFocus(): void {
    const key = this.openKey;
    const was = this.shownSheet;
    const root = this.shadowRoot;

    this.shownSheet = key;

    if (key === was || !root) return;

    if (key !== null) {
      const close = root.querySelector<HTMLElement>('.sheets button');

      if (this.opener && close) this.focusFor(close);

      return;
    }

    const opener = this.opener;

    this.opener = null;

    if (!opener || root.activeElement) return;

    const back = [
      ...root.querySelectorAll<HTMLElement>(`.${opener.kind}`),
    ].find((element) => openerOf(element)?.id === opener.id);

    if (back) this.focusFor(back);
  }

  private focusFor(element: HTMLElement): void {
    const byPointer = this.pointerLast;

    this.toggleAttribute('data-pointer-focus', byPointer);
    element.focus({ preventScroll: true, focusVisible: !byPointer });
  }

  private readonly onPointerInput = (): void => {
    this.pointerLast = true;
  };

  private readonly onBurstDown = (event: PointerEvent): void => {
    if (event.isPrimary === false) return;

    this.touchDown =
      event.pointerType === 'touch'
        ? { path: event.composedPath(), at: event.timeStamp }
        : null;

    if (!onTapSurface(event)) return;

    const now = Date.now();
    const inBurst = now - this.lastTapAt < TAP_BURST_MS;

    this.lastTapAt = now;
    this.burstPointer = inBurst
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
    this.swallowClick = inBurst;

    if (inBurst) swallow(event);
  };

  private readonly onBurstRest = (event: PointerEvent): void => {
    const start = this.burstPointer;

    if (!start || event.pointerId !== start.id) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);

    if (event.type === 'pointermove' && moved > DRAG_THRESHOLD_PX) {
      this.burstPointer = null;
      this.swallowClick = false;
      this.sceneView?.orbitFrom(event);

      return;
    }
    if (event.type !== 'pointermove') this.burstPointer = null;

    swallow(event);
  };

  private readonly onBurstClick = (event: MouseEvent): void => {
    if (event.detail === 0) return;

    const burst = this.swallowClick;
    const moved = this.clickMovedOff(event);

    this.swallowClick = false;
    this.touchDown = null;

    if (burst || moved) swallow(event);
  };

  // A touch click lands on whatever is under the lifted finger, even a sheet the tap just opened.
  private clickMovedOff(event: MouseEvent): boolean {
    const touch = this.touchDown;

    if (!touch || event.timeStamp - touch.at > MARK_CLICK_MS) return false;

    const [pressed] = touch.path;
    const path = event.composedPath();

    return !touch.path.includes(path[0]) && !path.includes(pressed);
  }

  private shareMarkSpots(): void {
    const spots: MarkSpots = {
      shown: this.laid.marks.map(({ key, at }) => ({ key, ...at })),
      tucked: new Set([
        ...this.laid.bubbles.flatMap((bubble) => bubble.members),
        ...this.laid.hidden,
      ]),
    };

    const plan = this.view === '2d' ? this.planView : null;

    for (const surface of [this.sceneView, plan]) {
      if (surface) surface.markSpots = spots;
    }
  }

  private measureControls(): void {
    const scene = this.sceneView;

    if (!scene || this.floorsOpen) return;

    const clear = this.measure('.dock .views, .dock .floors, .dock .pages');
    const banner = this.measure('.banner').map((rect) => ({
      ...rect,
      bottom: rect.bottom + this.pinRoom,
    }));
    const sceneClear = [...clear, ...banner];

    if (
      this.controlsClear &&
      this.sceneClear &&
      sameClear(this.controlsClear, clear) &&
      sameClear(this.sceneClear, sceneClear)
    ) {
      return;
    }

    this.controlsClear = clear;
    this.sceneClear = sceneClear;
    scene.clear = sceneClear;
    scene.under = Math.max(0, ...banner.map((rect) => rect.bottom));

    // Pins turn away from the controls measured here, so draw them again once the new controls are in place.
    if (this.alerts.length > 0) queueMicrotask(() => this.requestUpdate());

    const plan = this.view === '2d' ? this.planView : null;

    if (plan) {
      plan.clear = this.planClear;
      plan.reserve = this.planReserve;
    }
  }

  private get pinRoom(): number {
    const reach = PIN_HEAD_PX + PIN_STEM_PX;
    const tall = (this.stage?.clientHeight ?? 0) * PIN_ROOM_SHARE >= reach;

    return this.shownAlert?.scope && tall ? reach : 0;
  }

  private measure(selector: string): Rect[] {
    const scene = this.sceneView;

    if (!scene) return [];

    const stage = scene.getBoundingClientRect();

    return [...this.renderRoot.querySelectorAll<HTMLElement>(selector)].map(
      (control) => {
        const rect = control.getBoundingClientRect();

        return {
          left: Math.round(rect.left - stage.left),
          top: Math.round(rect.top - stage.top),
          right: Math.round(rect.right - stage.left),
          bottom: Math.round(rect.bottom - stage.top),
        };
      },
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(highlightEvent, this.onHighlight);
    window.addEventListener('keydown', this.onKey);

    for (const type of touchEvents) {
      this.addEventListener(type, this.onTouch, { capture: true });
    }

    this.addEventListener('click', this.onClickAfterMark, { capture: true });
    this.addEventListener('pointerdown', this.onPointerInput, {
      capture: true,
    });
    this.addEventListener('pointerdown', this.onBurstDown, { capture: true });
    this.addEventListener('click', this.onBurstClick, { capture: true });

    for (const type of burstEvents) {
      this.addEventListener(type, this.onBurstRest, { capture: true });
    }

    if (!this.sizeObserver && typeof ResizeObserver !== 'undefined') {
      this.sizeObserver = new ResizeObserver(this.onResize);
      this.sizeObserver.observe(this);
    }

    if (this.planHeld || this.planArriving) this.watchSwitch();
    if (this.hasUpdated) this.requestUpdate();
  }

  disconnectedCallback(): void {
    window.removeEventListener(highlightEvent, this.onHighlight);
    window.removeEventListener('keydown', this.onKey);

    for (const type of touchEvents) {
      this.removeEventListener(type, this.onTouch, { capture: true });
    }

    this.removeEventListener('click', this.onClickAfterMark, { capture: true });
    this.removeEventListener('pointerdown', this.onPointerInput, {
      capture: true,
    });
    this.removeEventListener('pointerdown', this.onBurstDown, {
      capture: true,
    });
    this.removeEventListener('click', this.onBurstClick, { capture: true });

    for (const type of burstEvents) {
      this.removeEventListener(type, this.onBurstRest, { capture: true });
    }

    this.sizeObserver?.disconnect();
    this.sizeObserver = null;

    for (const timer of this.timers.values()) clearTimeout(timer);

    this.timers.clear();
    this.markGestures.cancel();
    this.pressedMark = null;
    this.flights.clear();
    this.optimistic = {};
    this.tabletFor = null;
    this.syncedAlerts = null;
    this.leavingAlerts = [];
    this.house = null;
    this.endGlide(this.moveGlide?.to ?? this.shownMove);
    this.stopWatch();
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (this.clientWidth > 0) {
      this.chipFloors = this.clientWidth < FLOOR_CHIP_CARD_PX;
      this.narrowCard = this.clientWidth < PAGED_SCENE_CARD_PX;
    }

    this.noteOpener();
    this.followMove();
    this.syncTablet();
    this.syncClockNight();
    this.toggleAttribute('tablet', this.tablet);
    this.toggleAttribute('large-pills', this.largePills);
    this.toggleAttribute(
      'portrait',
      this.tablet && this.orientation === 'portrait',
    );
    this.syncAlerts();
    this.noteHomeDrawn();

    if (!changed.has('hass')) return;
    if (this.house) this.house.hass = this.hass;

    this.followRenames();

    this.toggleAttribute('dark', this.look.theme === 'dark');

    const states = this.hass?.states ?? {};

    for (const [key, flight] of this.flights) {
      if (flight.plan.expect.length > 0 && settled(flight.plan, states)) {
        this.confirm(key, flight);
      }
    }
  }

  private renderControls(
    laid: LaidMarks,
    labels: TemperatureLabel[],
  ): TemplateResult | typeof nothing {
    if (!this.interactive) return nothing;

    return html`
      <div class="marks">${this.renderMarks(laid, labels)}</div>
      <div class="sheets" data-look=${this.look.theme}>
        ${this.renderSheet()} ${this.renderChooser()}
      </div>
      ${this.toast ? toastTemplate(this.toast, this.onRetry) : nothing}
    `;
  }

  private renderHighlight(): TemplateResult | typeof nothing {
    const outline =
      this.highlight && !this.betweenViews
        ? this.surface?.outlineOf(this.highlight)
        : null;

    if (!outline) return nothing;

    return html`
      <svg class="highlight" aria-hidden="true">
        <path class="highlight-fill" d=${outline.fill}></path>
        <path class="highlight-edge" d=${outline.edge}></path>
      </svg>
    `;
  }

  private onHighlight = (event: Event): void => {
    if (!this.preview) return;

    this.highlight = (event as CustomEvent<HighlightDetail>).detail.scope;
  };

  private renderFloors(): TemplateResult | typeof nothing {
    const storeys = this.storeys;

    if (storeys.length === 0) return nothing;

    return floorStackTemplate({
      storeys,
      chosen: this.shownFloor,
      dots: this.floorDots,
      choose: this.chooseFloor,
      collapsed: this.stackFolded,
      toggle: this.chipFloors ? this.toggleFloors : null,
      ...(this.paging ? { page: this.pages.shown } : {}),
    });
  }

  private get stackFolded(): boolean {
    return this.chipFloors && !this.floorsOpen;
  }

  private get paging(): boolean {
    return (
      this.scenePaging ||
      (this.view === '2d' &&
        this.shownFloor === null &&
        this.planPages.ids.length > 1)
    );
  }

  private get scenePaging(): boolean {
    return (
      this.view === '3d' &&
      this.floor === null &&
      this.narrowCard &&
      this.storeys.length > 1
    );
  }

  private get pages(): { ids: string[]; shown: string | null } {
    if (!this.scenePaging) return this.planPages;

    const ids = this.storeys.map((storey) => storey.id);
    const ground =
      this.storeys.find((storey) => storey.level === 0) ?? this.storeys[0];
    const shown =
      this.planPage && ids.includes(this.planPage) ? this.planPage : ground.id;

    return { ids, shown };
  }

  private get sceneFloor(): FloorChoice {
    if (this.scenePaging) return this.pages.shown;

    const underPlan = this.view === '2d' || this.planLeaving;

    if (underPlan && this.floor === null && this.planPages.ids.length > 1) {
      return this.planPages.shown;
    }

    return this.focusStorey ?? this.floor;
  }

  private get viewedFloor(): FloorChoice {
    return this.scenePaging
      ? this.pages.shown
      : (this.focusStorey ?? this.shownFloor);
  }

  private get focusStorey(): string | null {
    if (this.view !== '3d' || this.floor !== null || this.scenePaging) {
      return null;
    }

    const scope = this.sheet ? this.controlOfMark(this.sheet.key)?.scope : null;
    const floor = scope ? this.floorOf(scope) : null;
    const top = this.storeys.reduce<Storey | null>(
      (best, storey) => (!best || storey.level > best.level ? storey : best),
      null,
    );

    return floor && top && floor !== top.id ? floor : null;
  }

  private renderPages(): TemplateResult | typeof nothing {
    const { ids, shown } = this.pages;

    if (!this.paging || !this.stackFolded) return nothing;

    return floorPagesTemplate({
      storeys: ids.flatMap(
        (id) => this.storeys.find((storey) => storey.id === id) ?? [],
      ),
      shown,
      turn: this.turnPage,
    });
  }

  private renderViewSwitch(): TemplateResult | typeof nothing {
    if (!this.homeFloors) return nothing;

    return viewSwitchTemplate({ chosen: this.view, choose: this.chooseView });
  }

  private renderPlan(look: Look): TemplateResult | typeof nothing {
    const home = this.homeFloors;

    if (!home || (this.view === '3d' && !this.leftPlan)) return nothing;

    const kept = this.view === '3d' ? this.leftPlan?.props : undefined;
    const plan = kept ?? this.planProps(home, look);

    if (this.onPlan) {
      this.leftPlan = { laid: this.laid, labels: this.labels, props: plan };
    }

    return html`<estanza-plan-view
      class=${this.planClass}
      .home=${plan.home}
      .floors=${plan.floors}
      .active=${plan.active}
      .scheme=${plan.scheme}
      .night=${plan.night}
      .overlay=${plan.overlay}
      .roomMarks=${plan.roomMarks}
      .interactive=${plan.interactive}
      .targets=${plan.targets}
      .targetRadius=${plan.targetRadius}
      .reserve=${plan.reserve}
      .beside=${plan.beside}
      .dots=${plan.dots}
      .corner=${plan.corner}
      .clear=${plan.clear}
      .shift=${plan.shift}
      .units=${plan.units}
      .readings=${plan.readings}
      .largeTags=${plan.largeTags}
      .crowded=${plan.crowded}
      .covers=${plan.covers}
      .glyphs=${plan.glyphs}
      .sheets=${plan.sheets}
      .selected=${plan.selected}
      .page=${plan.page}
      ?dim=${plan.dim}
      @scope-select=${this.onSceneSelect}
      @view-change=${this.onViewChange}
      @page-change=${this.onPageChange}
      @plan-move=${this.onPlanMove}
    ></estanza-plan-view>`;
  }

  private planProps(home: HomeFloors, look: Look): PlanProps {
    return {
      home: home.document,
      floors: home.floors,
      active: this.planActive,
      scheme: look.theme,
      night: look.theme === 'dark',
      overlay: this.overlay,
      roomMarks: this.roomMarks,
      interactive: this.interactive || this.preview,
      targets: this.targets,
      targetRadius: this.targetRadius,
      reserve: this.planReserve,
      beside: this.planBeside,
      dots: this.planDots(),
      corner: this.armed ? this.cornerClear : 0,
      clear: this.planClear,
      shift: this.planShift,
      units: this.planUnits,
      readings: this.planReadings(),
      largeTags: this.tablet,
      crowded: this.crowdedPlan,
      covers: this.planCovers(),
      glyphs: this.planGlyphs(),
      sheets: this.planSheets(),
      selected: this.pickedRoom,
      page: this.planPage,
      dim: this.lateNight,
    };
  }

  private get planClass(): string {
    if (this.planLeaving) return this.planHeld ? 'holding' : 'leaving';
    if (this.view === '3d') return 'away';

    return this.planArriving ? 'arriving' : '';
  }

  private get sceneSheet(): SceneSheet | null {
    const sheet = this.sheet;
    const scope = sheet ? this.controlOfMark(sheet.key)?.scope : undefined;

    const underPlan = this.view === '2d' || this.planLeaving;

    if (!sheet?.cover || !scope || underPlan || this.sheetCovers) {
      return null;
    }

    const reach = scope.type === 'room' ? this.pillReach(scope.id) : null;

    return { scope, covered: sheet.cover, ...(reach ? { reach } : {}) };
  }

  private pillReach(room: string): Rect | null {
    const label = this.labels.find((candidate) => candidate.key === room);
    const footprint = this.surface?.roomFootprints([room]).get(room);
    const box = footprint
      ? boxOf([...footprint.floor, ...footprint.top])
      : null;

    if (!label || !box) return null;

    const size = label.large
      ? pillSize(label.text, 'large')
      : this.pillSize(label, label.small);
    const half = { x: size.width / 2, y: size.height / 2 };

    return {
      left: Math.max(0, box.left - (label.x - half.x)),
      top: Math.max(0, box.top - (label.y - half.y)),
      right: Math.max(0, label.x + half.x - box.right),
      bottom: Math.max(0, label.y + half.y - box.bottom),
    };
  }

  private get planClear(): Rect[] {
    return this.controlsClear ?? [];
  }

  private get planShift(): Drift {
    const move = this.sheet?.move ?? STILL;

    return { x: this.drift.x + move.x, y: this.drift.y + move.y };
  }

  private followMove(): void {
    const target = this.sheet?.move ?? STILL;
    const to = this.moveGlide?.to ?? this.shownMove;

    if (to.x === target.x && to.y === target.y) return;

    const end = { x: target.x, y: target.y };

    if (motionLive.reduced) {
      this.endGlide(end);

      return;
    }

    this.moveGlide = { from: this.shownMove, to: end, spent: 0, last: null };
    this.showGlide(this.shownMove, end);
    this.glideFrame ??= requestAnimationFrame(this.stepGlide);
  }

  private stepGlide = (): void => {
    const glide = this.moveGlide;
    const now = performance.now();

    this.glideFrame = null;

    if (!glide) return;

    // A slow frame advances the glide by two frames at most, so it still glides.
    glide.spent += Math.min(now - (glide.last ?? now), GLIDE_STEP_MAX_MS);
    glide.last = now;

    const { value, done } = glideStep(
      { from: 0, to: 1, start: 0, ms: SHEET_GLIDE_MS },
      glide.spent,
    );

    if (done) {
      this.endGlide(glide.to);

      return;
    }

    this.shownMove = {
      x: glide.from.x + (glide.to.x - glide.from.x) * value,
      y: glide.from.y + (glide.to.y - glide.from.y) * value,
    };
    this.showGlide(this.shownMove, glide.to);
    this.glideFrame = requestAnimationFrame(this.stepGlide);
  };

  private showGlide(shown: Drift, to: Drift): void {
    this.toggleAttribute('gliding', true);
    this.style.setProperty('--ez-glide-x', `${shown.x - to.x}px`);
    this.style.setProperty('--ez-glide-y', `${shown.y - to.y}px`);
  }

  private endGlide(at: Drift): void {
    if (this.glideFrame !== null) cancelAnimationFrame(this.glideFrame);

    this.glideFrame = null;
    this.moveGlide = null;
    this.shownMove = at;
    this.toggleAttribute('gliding', false);
    this.style.removeProperty('--ez-glide-x');
    this.style.removeProperty('--ez-glide-y');
  }

  private get stage(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.stage');
  }

  private get planUnits(): UnitSystem {
    return this.systemUnit === '°F' ? 'imperial' : 'metric';
  }

  private get systemUnit(): string | null {
    return this.hass?.config?.unit_system?.temperature ?? null;
  }

  private get targetRadius(): number {
    return this.tablet ? TABLET_TARGET_RADIUS_PX : TARGET_RADIUS_PX;
  }

  private get tilesBesideSheet(): boolean {
    return (
      (this.view === '2d' || this.planLeaving) &&
      this.floor === null &&
      this.storeys.length > 1 &&
      !this.sheetsBelow &&
      !this.sheetCovers
    );
  }

  private get planBeside(): FitReserve {
    return this.besideCover(
      this.sheet?.cover ?? null,
      this.sheet?.stage?.width ?? 0,
    );
  }

  private besideCover(cover: Box | null, width: number): FitReserve {
    if (!this.tilesBesideSheet || !cover || width === 0) {
      return NO_FIT_RESERVE;
    }
    if (cover.left + cover.right > width) {
      return { ...NO_FIT_RESERVE, right: width - cover.left };
    }

    return { ...NO_FIT_RESERVE, left: cover.right };
  }

  private get planReserve(): FitReserve {
    const top = this.shownAlert ? this.cornerClear : 0;

    if (this.controlsClear) return { ...NO_FIT_RESERVE, top };

    if (this.tablet && this.orientation === 'portrait') {
      return { ...NO_FIT_RESERVE, top, bottom: PORTRAIT_CONTROLS_PX };
    }

    return {
      ...NO_FIT_RESERVE,
      top,
      left: this.tablet ? TABLET_PLAN_CLEAR_PX : PLAN_CLEAR_PX,
    };
  }

  private get cornerClear(): number {
    return this.tablet ? TABLET_CORNER_CLEAR_PX : CORNER_CLEAR_PX;
  }

  private chooseView = (view: View): void => {
    if (this.config) writeViewChoice(viewKey(this.config), view);

    this.showView(view);
  };

  private showView(view: View): void {
    if (view === this.view) return;

    const ms = motionLive.reduced ? 0 : VIEW_SWITCH_MS;
    const place = burnInPlace(this.burnIndex);

    this.view = view;
    this.cancel('view');
    this.stopWatch();

    if (view === '2d' && this.planLeaving) {
      this.planLeaving = false;
      this.planHeld = false;
      this.later('view', ms, this.rest);

      return;
    }

    const scene = this.sceneView;
    const drawable = scene?.drawable ?? false;

    if (view === '2d') {
      this.reframeSheet();
      scene?.tiltDown(place, ms);

      if (ms === 0 || !drawable) {
        this.planArriving = false;
        this.sceneResting = true;
      } else {
        this.planArriving = true;
        this.watchSwitch();
      }

      return;
    }

    const shown = !this.planArriving;

    if (shown) this.keepPlanFraming();

    this.sceneResting = false;
    this.planArriving = false;

    if (shown && scene && drawable) {
      this.planLeaving = true;
      this.planHeld = true;
      this.framesAtSwitch = scene.frames;
      this.watchSwitch();

      return;
    }

    if (ms > 0 && shown) {
      this.planLeaving = true;
      this.later('view', ms, () => this.leavePlan(place, ms));

      return;
    }

    this.leavePlan(place, ms);
  }

  private keepPlanFraming(): void {
    const sheet = this.sheet;

    this.planFraming = sheet?.framed
      ? {
          key: sheet.key,
          at: sheet.at,
          cover: sheet.cover,
          move: sheet.move,
          stage: sheet.stage,
        }
      : null;
  }

  private reframeSheet(): void {
    const sheet = this.sheet;

    if (!sheet) return;

    const kept = this.view === '2d' ? this.planFraming : null;

    if (
      kept &&
      kept.key === sheet.key &&
      kept.at.x === sheet.at.x &&
      kept.at.y === sheet.at.y
    ) {
      this.sheet = { ...sheet, ...kept, framed: true };

      return;
    }

    this.sheet = { ...sheet, framed: false, cover: null, move: STILL };
  }

  private watchSwitch(): void {
    this.switchDeadline = performance.now() + SWITCH_WAIT_MS;
    this.switchWatch ??= requestAnimationFrame(this.checkSwitch);
  }

  private stopWatch(): void {
    if (this.switchWatch !== null) cancelAnimationFrame(this.switchWatch);

    this.switchWatch = null;
  }

  private checkSwitch = (): void => {
    const scene = this.sceneView;
    const late = performance.now() > this.switchDeadline;
    const flat = !scene?.drawable || scene.flatAndStill;

    this.switchWatch = null;

    if (this.planHeld) {
      const drawn = !scene?.drawable || scene.frames > this.framesAtSwitch;

      if ((drawn && flat) || late) {
        this.releasePlan();

        return;
      }

      scene?.redraw();
      this.switchWatch = requestAnimationFrame(this.checkSwitch);

      return;
    }

    if (!this.planArriving) return;

    if (flat || late) {
      this.showPlan();
    } else {
      this.switchWatch = requestAnimationFrame(this.checkSwitch);
    }
  };

  private releasePlan(): void {
    const ms = motionLive.reduced ? 0 : VIEW_SWITCH_MS;
    const place = burnInPlace(this.burnIndex);

    this.planHeld = false;

    if (ms === 0) {
      this.leavePlan(place, 0);

      return;
    }

    this.later('view', ms, () => this.leavePlan(place, ms));
  }

  private get betweenViews(): boolean {
    return this.planLeaving || this.planArriving;
  }

  private get onPlan(): boolean {
    return this.view === '2d' && !this.betweenViews;
  }

  private showPlan(): void {
    this.planArriving = false;
    this.later('view', VIEW_SWITCH_MS, this.rest);
  }

  private rest = (): void => {
    this.sceneResting = true;
  };

  private leavePlan(place: HomePlace, ms: number): void {
    this.planLeaving = false;
    this.planHeld = false;
    this.reframeSheet();
    this.sceneView?.tiltUp(place, ms);
  }

  private onCameraInput = (): void => {
    if (!this.planLeaving || this.planHeld) return;

    this.cancel('view');
    this.leavePlan(burnInPlace(this.burnIndex), 0);
  };

  private restoreView(): void {
    const config = this.config;

    if (!config) return;

    const key = viewKey(config);

    if (key === this.viewFor) return;

    this.viewFor = key;
    this.view = readViewChoice(key) ?? this.defaultView;
    this.sceneResting = this.view === '2d';
    this.flattenScene = this.view === '2d';
    this.planLeaving = false;
    this.planHeld = false;
    this.planArriving = false;
    this.leftPlan = null;
    this.stopWatch();
  }

  private get surface(): Surface | null {
    if (this.view === '3d') return this.sceneView;

    return this.renderRoot.querySelector<EstanzaPlanView>('estanza-plan-view');
  }

  private onHomeChange = (): void => {
    const home = this.sceneView?.sharedHome?.document ?? null;

    this.outdated = this.sceneView?.sceneStatus === 'outdated';
    this.latestCard = this.sceneView?.latestCardVersion ?? null;

    if (!home) {
      this.homeFloors = null;

      return;
    }

    const previous = this.homeFloors?.document;

    if (home === previous) return;

    const floors = deriveFloors(slidingWindows(home));
    const swapped =
      previous !== undefined && this.floorKey(previous) === this.floorKey(home);
    const shown = swapped ? this.floor : readFloorChoice(this.floorKey(home));
    const valid =
      shown === null ||
      (floors.length > 1 && floors.some((floor) => floor.id === shown));

    this.homeFloors = {
      document: home,
      floors,
      storeys: storeys(floors),
      floorOf: new Map(),
    };
    this.floor =
      shown !== undefined && valid ? shown : this.openingFloor(home, floors);
  };

  private openingFloor(
    home: HomeDocument,
    floors: DerivedFloor[],
  ): FloorChoice {
    const bindings = this.config?.bindings ?? [];

    return defaultFloor(floors, linksByFloor(home, floors, bindings));
  }

  private toggleFloors = (): void => {
    this.floorsOpen = !this.floorsOpen;
  };

  private chooseFloor = (choice: FloorChoice): void => {
    const home = this.homeFloors?.document;
    const floors = this.homeFloors?.floors ?? [];
    const kept = floors.some((floor) => floor.id === this.lastStorey);
    const page = this.paging ? this.pages.shown : null;
    const back =
      page ??
      (kept ? this.lastStorey : home ? this.openingFloor(home, floors) : null);
    const next = choice === null && this.floor === null ? back : choice;

    if (this.floor !== null) this.lastStorey = this.floor;
    if (next === null && this.floor !== null) this.planPage = this.floor;

    this.floor = next;
    this.floorsOpen = false;
    this.closeSheet();

    if (home) writeFloorChoice(this.floorKey(home), next);
  };

  private floorKey(document: HomeDocument): string {
    return floorStorageKey(this.shareId, document);
  }

  private floorOf(scope: SceneScope): string | null {
    const home = this.homeFloors;

    if (!home) return null;

    const key = scopeKey(scope);

    if (!home.floorOf.has(key)) {
      home.floorOf.set(key, floorOfScope(home.document, home.floors, scope));
    }

    return home.floorOf.get(key) ?? null;
  }

  private get shownFloor(): FloorChoice {
    if (this.storeys.length === 0) return null;
    if (this.view === '3d') return this.floor;

    return this.planActive;
  }

  private get planActive(): string | null {
    if (this.floor === null) return null;

    return planFloor(this.homeFloors?.floors ?? [], this.floor);
  }

  private inView(scope: SceneScope): boolean {
    const shown = this.viewedFloor;

    if (shown === null) return true;

    const floor = this.floorOf(scope);

    return floor === null || floor === shown;
  }

  private renderMarks(
    laid: LaidMarks,
    labels: TemperatureLabel[],
  ): (TemplateResult | typeof nothing)[] {
    const sheets = this.sheetBoxes();
    const stairWords = (
      this.view === '2d' ? (this.planView?.wordBoxes() ?? []) : []
    ).filter((word) => word.key.startsWith('stair:'));
    const leaders = laid.marks
      .filter(({ at, anchor }) => at.x !== anchor.x || at.y !== anchor.y)
      .map((mark) => offWords(mark, stairWords));

    const marks = laid.marks.map((shown): Focusable => {
      const { key, control, at, opening } = shown;
      const mark = own(this.marks, key);
      const size = this.isDot(shown) ? DOT_BOX : GLYPH_BOX;

      return {
        key: `mark:${key}`,
        at,
        room: this.roomOfMark(control.scope),
        template: markTemplate({
          control,
          at: mark?.phase === 'armed' ? this.insideStage(at, ARMED_BOX) : at,
          under: underSheet(at, size, sheets),
          phase: mark?.phase ?? null,
          selected: this.sheet?.key === key,
          lamp: this.lampOf(key),
          opening,
          pointer:
            mark?.phase === 'armed'
              ? null
              : this.markPointer(control.scope, at),
          onConfirm: () => this.confirmArmed(key),
          onKey: (gesture) => this.keyOnMark(control.scope, at, gesture),
        }),
      };
    });
    const bubbles = laid.bubbles.map((bubble): Focusable => {
      const members = bubble.members.flatMap((key) => {
        const control = this.controlOfMark(key);

        return control ? [control] : [];
      });
      const at = { x: bubble.x, y: bubble.y };

      return {
        key: `bubble:${bubble.key}`,
        at,
        room: bubble.room,
        template: bubbleTemplate({
          key: bubble.key,
          at,
          icon: this.dominantIcon(members),
          count: bubble.members.length,
          label: this.countWords(bubble.members),
          under: underSheet(at, GLYPH_BOX, sheets),
          selected: this.chooser?.key === bubble.key,
          onOpen: (event: MouseEvent) => {
            if (event.detail > 0 && this.pressedBubble !== bubble.key) return;

            this.openChooser(bubble);
          },
        }),
      };
    });
    const pills = labels.map((label): Focusable => ({
      key: `pill:${label.key}`,
      at: { x: label.x, y: label.y },
      room: label.key,
      template: pillTemplate(label, this.onPill),
    }));
    const read = inReadingOrder(pills, [...marks, ...bubbles]);

    return [
      leadersTemplate(leaders),
      html`${repeat(
        read,
        (item) => item.key,
        (item) => item.template,
      )}`,
    ];
  }

  private keyOnMark(scope: SceneScope, at: Point, gesture: SceneGesture): void {
    this.pressedMark = { scope, at };
    this.selectMark(gesture);
    this.pressedMark = null;
  }

  private laidMarks(crowded: ReadonlySet<string> = new Set()): LaidMarks {
    const shown = this.placedMarks();
    const tucked = shown
      .filter(
        ({ key, control }) =>
          crowded.has(this.floorOf(control.scope) ?? '') &&
          this.isPassive(key) &&
          !this.isFixed(key),
      )
      .map(({ key }) => key);
    const placed = shown.filter(({ key }) => !tucked.includes(key));
    const plan = this.view === '2d' ? this.planView : null;
    const words = plan?.wordBoxes() ?? [];
    const stairWords = words.filter((word) => word.key.startsWith('stair:'));
    const stage = this.stage;
    const outlines = this.homeOutlines(placed.length > 0);
    const area =
      stage && stage.clientWidth > 0 && stage.clientHeight > 0
        ? {
            width: stage.clientWidth,
            height: stage.clientHeight,
            within: (at: Point) =>
              outlines.length === 0 ||
              outlines.some((outline) => insidePolygon(at, outline)),
          }
        : null;
    const requests = placed.map((shown): MarkRequest => {
      const dot = this.isDot(shown);
      const fixed = this.isFixed(shown.key);

      return {
        key: shown.key,
        ...(fixed ? this.drawnSpot(shown.key, shown.at) : shown.at),
        ...(dot ? DOT_BOX : GLYPH_BOX),
        rank: dot ? 0 : 1,
        fixed,
        still: dot,
        passive: this.isPassive(shown.key),
        room: this.roomOfMark(shown.control.scope),
        avoid: dot ? words : stairWords,
      };
    });
    const layout = layoutMarks(
      requests,
      [...this.pinBoxes(), ...this.controlBoxes()],
      area,
    );
    const byKey = new Map(placed.map((shown) => [shown.key, shown]));

    return {
      marks: layout.marks.flatMap((laid): LaidMark[] => {
        const shown = byKey.get(laid.key);

        return shown
          ? [{ ...shown, at: { x: laid.x, y: laid.y }, anchor: shown.at }]
          : [];
      }),
      bubbles: layout.bubbles.map((bubble) => ({
        ...bubble,
        host: byKey.get(bubble.members[0]) ?? null,
      })),
      hidden: [...tucked, ...layout.hidden],
    };
  }

  private clearOfPills(
    laid: LaidMarks,
    labels: readonly TemperatureLabel[],
  ): LaidMarks {
    const pills = labels.map((label) => ({
      ...(label.large
        ? pillSize(label.text, 'large')
        : this.pillSize(label, label.small)),
      x: label.x,
      y: label.y,
    }));
    const under = new Set(
      this.view === '2d'
        ? laid.marks
            .filter(
              (mark) =>
                this.isDot(mark) && covered({ ...mark.at, ...DOT_BOX }, pills),
            )
            .map((mark) => mark.key)
        : [],
    );

    if (under.size === 0) return laid;

    return {
      marks: laid.marks.filter((mark) => !under.has(mark.key)),
      bubbles: laid.bubbles,
      hidden: [...laid.hidden, ...under],
    };
  }

  private groupedMarks(laid: LaidMarks): LaidMarks {
    if (this.view !== '3d' || this.groupedFloors.size === 0) return laid;

    return this.laidMarks(this.groupedFloors);
  }

  private homeOutlines(needed: boolean): Point[][] {
    const floors = this.homeFloors?.floors ?? [];
    const shown = this.viewedFloor;

    if (!needed) return [];

    const slugs = floors
      .filter((floor) => shown === null || floor.id === shown)
      .flatMap((floor) => [...floor.roomsBySlug.keys()]);
    const footprints = this.surface?.roomFootprints(slugs);

    return [...(footprints?.values() ?? [])].flatMap((footprint) => [
      footprint.floor,
      footprint.top,
    ]);
  }

  private drawnSpot(key: string, anchor: Point): Point {
    const drawn = this.laid.marks.find((mark) => mark.key === key);

    if (drawn?.anchor.x !== anchor.x || drawn.anchor.y !== anchor.y) {
      return anchor;
    }

    return drawn.at;
  }

  private isFixed(key: string): boolean {
    return own(this.marks, key) !== undefined || this.sheet?.key === key;
  }

  private isPassive(key: string): boolean {
    return this.openings.has(key) && !this.controls.has(key);
  }

  private dominantIcon(members: readonly Control[]): IconName | null {
    const counts = new Map<IconName, number>();
    const controls = members.filter((control) => !this.isPassive(control.key));

    for (const control of controls.length > 0 ? controls : members) {
      const icon = this.iconOfMark(control);

      counts.set(icon, (counts.get(icon) ?? 0) + 1);
    }

    const [first] = [...counts].sort((a, b) => b[1] - a[1]);

    return first ? first[0] : null;
  }

  private iconOfMark(control: Control): IconName {
    const opening = this.openingLook(control.key);

    if (control.kind === 'lock') return markIcon(control, false, opening);

    if (control.scope.type === 'door') {
      return doorIcon(control.states, opening === 'open');
    }

    if (control.scope.type === 'window') return 'app-window';

    return markIcon(control, false, opening);
  }

  private controlOfMark(key: string): Control | null {
    return this.controls.get(key) ?? this.openings.get(key) ?? null;
  }

  private countWords(keys: readonly string[]): string {
    const counts = new Map<string, number>();

    for (const key of keys) {
      const type = this.controlOfMark(key)?.scope.type ?? 'light';

      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return [...counts]
      .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
      .join(', ');
  }

  private planDots(): string[] {
    return [...this.controls.values(), ...this.openings.values()].flatMap(
      (control) => {
        const opening = this.openingLook(control.key);
        const shown = { key: control.key, control, at: origin, opening };

        return this.isDot(shown) ? [scopeKey(control.scope)] : [];
      },
    );
  }

  private isDot(shown: ShownMark): boolean {
    return (
      shown.opening === 'shut' &&
      shown.control.kind !== 'lock' &&
      !own(this.marks, shown.key) &&
      this.sheet?.key !== shown.key
    );
  }

  private placedMarks(): ShownMark[] {
    if (!this.interactive || this.planLeaving) return [];
    if (this.view === '3d' && this.sceneView?.unframed) return [];

    const controls = this.controls;
    const openings = this.openings;
    const keys = new Set(Object.keys(this.marks));

    if (this.sheet) keys.add(this.sheet.key);

    for (const control of controls.values()) {
      if (openings.has(control.key) || !this.inView(control.scope)) continue;

      keys.add(control.key);
    }

    for (const opening of openings.values()) {
      if (this.inView(opening.scope)) keys.add(opening.key);
    }

    const winners = [...this.pinBoxes(), ...this.controlBoxes()];
    const alerted = new Set(
      [...this.alerts, ...this.leavingAlerts].flatMap((alert) =>
        alert.scope ? [scopeKey(alert.scope)] : [],
      ),
    );
    const pinned = this.pinnedScopes();

    return [...keys].flatMap((key): ShownMark[] => {
      const control = controls.get(key) ?? openings.get(key);
      const mark = own(this.marks, key);

      if (!control || control.kind === 'room') return [];
      if (pinned.has(key) && mark?.phase !== 'armed') return [];

      const at =
        this.anchorOf(control.scope) ??
        mark?.at ??
        (this.sheet?.key === key ? this.sheet.at : null);

      if (!at) return [];

      const yields =
        (this.isFixed(key) || alerted.has(key)) && mark?.phase !== 'armed';

      if (
        yields &&
        covered({ ...this.drawnSpot(key, at), ...GLYPH_BOX }, winners)
      ) {
        return [];
      }

      return [{ key, control, at, opening: this.openingLook(key) }];
    });
  }

  private get openings(): Map<string, Control> {
    const scopeStates = this.scopeStates;
    const controls = this.controls;

    if (controls === this.openingsFrom) return this.builtOpenings;

    const openings = new Map<string, Control>();

    for (const scopeState of Object.values(scopeStates)) {
      const { type } = scopeState.scope;

      if (type !== 'door' && type !== 'window') continue;
      if (scopeState.entityIds.length === 0) continue;

      const key = scopeKey(scopeState.scope);

      openings.set(
        key,
        controls.get(key) ??
          markedControl(scopeState, this.thingNames.get(key) ?? null),
      );
    }

    this.openingsFrom = controls;
    this.builtOpenings = openings;

    return openings;
  }

  private readOnlyOpenings(): Control[] {
    const controls = this.controls;

    return [...this.openings.values()].filter(
      (opening) => !controls.has(opening.key),
    );
  }

  private openingLook(key: string): OpeningLook | null {
    const scope = this.openings.get(key)?.scope;

    if (!scope) return null;

    const { doors, windows } = this.overlay;
    const open = own(scope.type === 'door' ? doors : windows, scope.id) ?? 0;

    return open > 0 ? 'open' : 'shut';
  }

  private renderSheet(): TemplateResult | typeof nothing {
    const sheet = this.sheet;
    const control = sheet ? this.controls.get(sheet.key) : undefined;
    const scopeState = sheet ? own(this.scopeStates, sheet.key) : undefined;

    if (!sheet || !control || !scopeState) return nothing;

    const reading = scopeState.reading;
    const area = reading?.kind === 'area' ? reading : null;
    const systemUnit = this.systemUnit;
    const room = control.kind === 'room';
    const devices = room ? this.roomDevices(control.scope, scopeState) : [];

    return sheetTemplate(
      {
        control,
        scopeState,
        title: control.name,
        spot: this.dockSpot,
        rows: room ? this.roomRows(control, scopeState) : [],
        alerts: room ? this.roomAlertRows(control.scope.id) : [],
        devices,
        phase: own(this.marks, sheet.key)?.phase ?? null,
        draft: this.draft,
        lamp: this.lampOf(sheet.key) ?? lightColorPresets[0].hex,
        lampChip: this.showsLampChip(control, devices),
        temperature:
          area?.temperature === undefined || area.temperature === null
            ? null
            : formatTemperature(
                area.temperature,
                area.temperatureUnit ?? systemUnit,
                systemUnit,
              ),
        humidity:
          area?.humidity === undefined || area.humidity === null
            ? null
            : formatHumidity(area.humidity),
      },
      this.sheetActions(sheet.key),
    );
  }

  private renderChooser(): TemplateResult | typeof nothing {
    const chooser = this.chooser;

    if (!chooser) return nothing;

    const rows = chooser.members.flatMap((key): ChoiceRow[] => {
      const control = this.controlOfMark(key);

      if (!control) return [];

      const opening = this.openingLook(key);
      const light = opening === null && control.scope.type === 'light';
      const state = control.states[0];

      return [
        {
          key,
          icon: this.iconOfMark(control),
          name: control.name,
          state:
            light || !this.hass || !state
              ? lampState(control)
              : formatState(this.hass, state),
          lamp: light ? this.lampOf(key) : null,
          on: light && isOn(control),
          tone: toneOf(control, opening),
        },
      ];
    });

    return chooserTemplate(
      {
        title: this.countWords(chooser.members),
        rows: numberRepeats(rows),
        spot: this.dockSpot,
      },
      {
        close: () => this.closeSheet(),
        choose: this.choose,
        swipe: this.sheetSwipe,
      },
    );
  }

  private get bottomChooser(): boolean {
    return this.chooser !== null && this.sheetsBelow;
  }

  private openChooser(bubble: MarkBubble): void {
    this.closeSheet();
    this.chooser = {
      key: bubble.key,
      at: { x: bubble.x, y: bubble.y },
      members: [...bubble.members],
    };
  }

  private choose = (key: string): void => {
    const at = this.chooser?.at ?? { x: 0, y: 0 };

    this.chooser = null;
    this.reach(key, at);
  };

  private reachFromSheet(key: string): void {
    const control = this.controlOfMark(key);
    const at =
      (control ? this.anchorOf(control.scope) : null) ??
      this.sheet?.at ??
      origin;

    this.reach(key, at);
  }

  private actFromSheet(row: RoomRow): void {
    const control = row.key === null ? undefined : this.controls.get(row.key);

    if (!control || !this.interactive) {
      this.openMoreInfo(row.entityId);

      return;
    }

    if (own(this.marks, control.key)?.phase === 'armed') {
      this.confirmArmed(control.key);

      return;
    }

    if (control.unavailable) {
      this.showToast(`${control.name} is unavailable`, null);

      return;
    }

    const deed = deedOf(
      control.kind,
      'tap',
      actionsFor(this.config?.bindings ?? [], control.scope).tap,
    );

    if (isPlanned(deed)) {
      this.perform(
        control,
        deed,
        this.anchorOf(control.scope) ?? this.sheet?.at ?? origin,
      );

      return;
    }

    this.openMoreInfo(control.entityIds[0] ?? row.entityId);
  }

  private reach(key: string, at: Point): void {
    const control = this.controlOfMark(key);

    if (!control) return;

    this.onSceneSelect(
      new CustomEvent<ScopeSelectDetail>('scope-select', {
        detail: {
          scopeType: control.scope.type,
          scopeId: control.scope.id,
          gesture: 'press',
          ...at,
        },
      }),
    );
  }

  private get sheetsBelow(): boolean {
    const stage = this.stage;

    if (!stage) return true;

    return sheetsBelow(window.innerWidth, {
      width: stage.clientWidth,
      height: stage.clientHeight,
    });
  }

  private insideStage(at: Point, size: LabelSize): Point {
    const stage = this.stage;

    if (!stage) return at;

    const reach = {
      x: size.width / 2 + SHEET_EDGE_PX,
      y: size.height / 2 + SHEET_EDGE_PX,
    };

    return {
      x: Math.min(Math.max(at.x, reach.x), stage.clientWidth - reach.x),
      y: Math.min(Math.max(at.y, reach.y), stage.clientHeight - reach.y),
    };
  }

  private get bottomSheet(): boolean {
    const sheet = this.sheet;

    return sheet !== null && this.sheetsBelow && this.controls.has(sheet.key);
  }

  private get crowdedPlan(): boolean {
    const width = this.stage?.clientWidth ?? 0;
    const masonry = this.layout !== 'panel' && this.layout !== 'grid';

    return masonry && width > 0 && width < CROWDED_CARD_PX;
  }

  private get sheetCovers(): boolean {
    const stage = this.stage;

    if (!stage || this.sheetsBelow || (!this.sheet && !this.chooser)) {
      return false;
    }

    return dockCovers({ width: stage.clientWidth, height: stage.clientHeight });
  }

  private get dockSpot(): Dock | null {
    const stage = this.stage;

    if (!stage || this.sheetsBelow) return null;

    const portrait = this.tablet && this.orientation === 'portrait';

    return dockSpot(
      { width: stage.clientWidth, height: stage.clientHeight },
      this.shownAlert || this.armed ? this.cornerClear : SHEET_EDGE_PX,
      portrait ? PORTRAIT_CONTROLS_PX : 0,
    );
  }

  private houseBox(scope: SceneScope): Box | null {
    const floors = this.homeFloors?.floors ?? [];
    const id = this.floorOf(scope) ?? this.viewedFloor;
    const floor = floors.find((candidate) => candidate.id === id) ?? floors[0];

    if (!floor) return null;

    const footprints = this.surface?.roomFootprints([
      ...floor.roomsBySlug.keys(),
    ]);

    return boxOf(
      [...(footprints?.values() ?? [])].flatMap((footprint) => [
        ...footprint.floor,
        ...footprint.top,
      ]),
    );
  }

  private boxOf(control: Control, tapped: Point): Box {
    const { scope } = control;

    if (scope.type === 'room') {
      const footprint = this.surface?.roomFootprints([scope.id]).get(scope.id);
      const box = footprint
        ? boxOf([...footprint.floor, ...footprint.top])
        : null;

      if (box) return box;
    }

    const at =
      scope.type === 'room' ? tapped : (this.anchorOf(scope) ?? tapped);

    return {
      left: at.x - TARGET_RADIUS_PX,
      top: at.y - TARGET_RADIUS_PX,
      right: at.x + TARGET_RADIUS_PX,
      bottom: at.y + TARGET_RADIUS_PX,
    };
  }

  private roomRows(control: Control, scopeState: ScopeState): RoomRow[] {
    const rows = openingsInRoom(
      this.homeFloors?.floors ?? [],
      control.scope.id,
      this.scopeStates,
      scopeState.states,
    ).map((thing): RoomRow => {
      const hass = this.hass;
      const key = thing.scope ? scopeKey(thing.scope) : null;
      const opening = key === null ? undefined : this.openings.get(key);
      const shown = [
        ...new Set([thing.entityId, ...(thing.lock ? [thing.lock] : [])]),
      ].flatMap((entityId) => {
        const state = hass?.states[entityId];

        return hass && state ? [formatState(hass, state)] : [];
      });
      const acting = key === null ? undefined : this.controls.get(key);
      const drawn = key === null ? null : this.controlOfMark(key);
      const look: OpeningLook =
        (key === null ? null : this.openingLook(key)) ??
        (thing.open ? 'open' : 'shut');
      const contact = hass?.states[thing.entityId];

      return {
        key,
        icon: openingRowIcon(drawn, thing.kind, contact ? [contact] : [], look),
        tone: toneOf(drawn, look),
        entityId: thing.entityId,
        kind: thing.kind,
        name:
          opening?.name ??
          openingRowName(thing.kind, thing.beyond, control.name),
        state: shown.join(' · '),
        armed:
          acting &&
          key !== null &&
          own(this.marks, acting.key)?.phase === 'armed'
            ? armedRow(acting, this.openingLook(key))
            : null,
      };
    });

    return numberRepeats(rows);
  }

  private showsLampChip(control: Control, devices: DeviceRow[]): boolean {
    const [only, ...more] = control.entityIds;

    if (only === undefined) return false;
    if (more.length > 0) return true;

    return !devices.some((row) =>
      this.controls.get(row.key)?.entityIds.includes(only),
    );
  }

  private roomDevices(room: SceneScope, roomState: ScopeState): DeviceRow[] {
    const hass = this.hass;
    const inRoom = [...this.controls.values()].filter(
      (control) =>
        (control.scope.type === 'light' || control.scope.type === 'prop') &&
        this.roomOfPiece(control.scope) === room.id,
    );
    const isLight = (key: string): boolean =>
      this.controls.get(key)?.scope.type === 'light';
    const listed = new Set(inRoom.flatMap((control) => control.entityIds));
    const climates = this.climatesIn(room.id, roomState).filter(
      (state) => !listed.has(state.entity_id),
    );
    const rows = inRoom.map((control): DeviceRow => {
      const light = isLight(control.key);
      const state = control.states[0];

      return {
        key: control.key,
        entityId: null,
        kind: control.kind,
        icon: this.iconOfMark(control),
        name: control.name,
        state:
          light || !hass || !state
            ? lampState(control)
            : formatState(hass, state),
        lamp: light ? this.lampOf(control.key) : null,
        on: isOn(control),
        tone: toneOf(control, this.openingLook(control.key)),
        toggles:
          ['light', 'switch', 'cover'].includes(control.kind) &&
          !isGuarded(control),
      };
    });
    const heaters = climates.map((state): DeviceRow => ({
      key: `entity:${state.entity_id}`,
      entityId: state.entity_id,
      kind: 'sensor',
      icon: 'thermometer',
      name: friendlyName([state]) ?? state.entity_id,
      state: climateState(state, hass),
      lamp: null,
      on: false,
      tone: null,
      toggles: false,
    }));

    return numberRepeats([
      ...rows.sort(
        (a, b) =>
          Number(isLight(b.key)) - Number(isLight(a.key)) ||
          a.name.localeCompare(b.name),
      ),
      ...heaters,
    ]);
  }

  private climatesIn(room: string, roomState: ScopeState): HassEntityState[] {
    const found = new Map<string, HassEntityState>();
    const isClimate = (state: HassEntityState): boolean =>
      entityDomain(state.entity_id) === 'climate';

    for (const state of roomState.states.filter(isClimate)) {
      found.set(state.entity_id, state);
    }

    for (const scopeState of Object.values(this.scopeStates)) {
      if (scopeState.scope.type !== 'prop') continue;
      if (this.roomOfThing(scopeState) !== room) continue;

      for (const state of scopeState.states.filter(isClimate)) {
        found.set(state.entity_id, state);
      }
    }

    return [...found.values()];
  }

  private roomOfThing(scopeState: ScopeState): string | null {
    const placed = this.roomOfPiece(scopeState.scope);

    if (placed) return placed;

    const ids = new Set(scopeState.entityIds);
    const holder = Object.values(this.scopeStates).find(
      (candidate) =>
        candidate.scope.type === 'room' &&
        candidate.entityIds.some((entityId) => ids.has(entityId)),
    );

    return holder?.scope.id ?? null;
  }

  private readonly sheetSwipe: SheetSwipe = {
    down: (event) => {
      const sheet = event.currentTarget as HTMLElement;
      const target = event.target as Element | null;
      const hold = target?.closest('.grip, .sheet-head');

      if (!sheet.classList.contains('bottom') || !hold) return;
      if (target?.closest('button')) return;

      this.swipe = {
        id: event.pointerId,
        sheet,
        from: event.clientY,
        drop: 0,
        at: event.timeStamp,
        speed: 0,
        moving: false,
      };
    },
    move: (event) => {
      const swipe = this.swipe;

      if (!swipe || event.pointerId !== swipe.id) return;

      const drop = Math.max(0, event.clientY - swipe.from);

      if (!swipe.moving && drop < DRAG_THRESHOLD_PX) return;

      if (!swipe.moving) {
        swipe.moving = true;
        swipe.sheet.style.transition = 'none';

        if ('setPointerCapture' in swipe.sheet) {
          swipe.sheet.setPointerCapture(swipe.id);
        }
      }

      const ms = event.timeStamp - swipe.at;

      if (ms > 0) swipe.speed = (drop - swipe.drop) / ms;

      swipe.drop = drop;
      swipe.at = event.timeStamp;
      swipe.sheet.style.transform = `translateY(${drop}px)`;
    },
    up: (event) => this.endSwipe(event.pointerId),
    cancel: () => this.endSwipe(null),
  };

  private endSwipe(pointerId: number | null): void {
    const swipe = this.swipe;

    if (!swipe || (pointerId !== null && pointerId !== swipe.id)) return;

    this.swipe = null;

    if (!swipe.moving) return;

    const { sheet } = swipe;
    const closes =
      pointerId !== null &&
      swipeCloses(swipe.drop, sheet.offsetHeight, swipe.speed);
    const ms = motionLive.reduced ? 0 : SHEET_MOTION_MS;
    const open = this.openKey;

    sheet.style.transition = `transform ${ms}ms ease-out`;
    sheet.style.transform = closes ? 'translateY(100%)' : '';
    this.later('swipe', ms, () => {
      sheet.style.transition = '';
      sheet.style.transform = '';

      if (closes && this.openKey === open) this.closeSheet(false);
    });
  }

  private sheetActions(key: string): SheetActions {
    return {
      close: () => this.closeSheet(),
      swipe: this.sheetSwipe,
      more: (entityId) => this.openMoreInfo(entityId),
      reach: (mark) => this.reachFromSheet(mark),
      act: (row) => this.actFromSheet(row),
      toggle: () => this.run(key, planToggle),
      device: (device) => this.run(device, planToggle),
      draft: (percent) => {
        this.draft = percent;
      },
      brightness: (percent) => {
        this.draft = null;
        this.run(key, (control) => planBrightness(control, percent));
      },
      white: (kelvin) => this.run(key, (control) => planWhite(control, kelvin)),
      position: (percent) => {
        this.draft = null;
        this.run(key, (control) => planPosition(control, percent));
      },
      cover: (move) => this.run(key, (control) => planCover(control, move)),
    };
  }

  private anchorOf(scope: SceneScope): Point | null {
    return this.surface?.anchorOf(scope) ?? null;
  }

  private get planView(): EstanzaPlanView | null {
    return this.renderRoot.querySelector<EstanzaPlanView>('estanza-plan-view');
  }

  private get sceneView(): EstanzaSceneView | null {
    return this.renderRoot.querySelector<EstanzaSceneView>(
      'estanza-scene-view',
    );
  }

  private lampOf(key: string): string | null {
    const scopeState = own(this.scopeStates, key);

    return scopeState ? lightOverlay(scopeState).color : null;
  }

  private onSceneSelect = (event: CustomEvent<ScopeSelectDetail>): void => {
    const { scopeType, scopeId, gesture, x, y } = event.detail;

    if (this.press) this.press.picked = true;

    if (this.preview) {
      const scope = this.pickable.find(
        (entry) => entry.type === scopeType && entry.id === scopeId,
      );

      if (scope) {
        window.dispatchEvent(
          new CustomEvent<PickDetail>(pickEvent, { detail: { scope } }),
        );
      }

      return;
    }

    if (!this.interactive || this.reframing) return;

    const key = `${scopeType}:${scopeId}`;
    const control = this.controls.get(key);

    if (!control) {
      this.showReadOnly(key);

      return;
    }

    const at = { x, y };

    this.closeSheet();

    if (control.unavailable) {
      this.showToast(`${control.name} is unavailable`, null);

      return;
    }

    const trigger = gesture === 'press' ? 'hold' : 'tap';
    const deed = deedOf(
      control.kind,
      trigger,
      actionsFor(this.config?.bindings ?? [], control.scope)[trigger],
    );

    if (deed === 'sheet') {
      this.openSheet(control.key, at);

      return;
    }

    if (deed === 'more-info') {
      this.openMoreInfo(control.entityIds[0] ?? '');

      return;
    }

    if (!isPlanned(deed)) return;

    this.perform(control, deed, at);
  };

  private get reframing(): boolean {
    const sheet = this.sheet;

    if (!sheet) return false;
    if (!sheet.framed) return true;

    return this.view === '3d' && (this.sceneView?.reframing ?? false);
  }

  private onPill = (clicked: PlacedLabel, event: MouseEvent): void => {
    const label =
      event.detail > 0
        ? this.labels.find((shown) => shown.key === this.pressedPill)
        : clicked;

    if (!label || this.reframing) return;

    const at = { x: label.x, y: label.y };
    const key = scopeKey({ type: 'room', id: label.key });
    const control = this.controls.get(key);

    if (this.preview || !control || control.unavailable) {
      this.onSceneSelect(
        new CustomEvent<ScopeSelectDetail>('scope-select', {
          detail: {
            scopeType: 'room',
            scopeId: label.key,
            gesture: 'tap',
            ...at,
          },
        }),
      );

      return;
    }

    this.closeSheet();
    this.openSheet(key, at);
  };

  private markPointer(scope: SceneScope, at: Point): MarkPointer {
    const onScreen = (event: PointerEvent): Point => ({
      x: event.clientX,
      y: event.clientY,
    });

    return {
      down: (event) => {
        if (event.isPrimary === false) return;

        this.markGestures.cancel();
        this.pressedMark = { scope, at };

        if (isSecondaryPress(event)) return;

        this.markGestures.down(onScreen(event));

        if (event.pointerType !== 'touch') {
          (event.currentTarget as Element | null)?.setPointerCapture?.(
            event.pointerId,
          );
        }
      },
      move: (event) => this.markGestures.move(onScreen(event)),
      up: (event) => {
        if (isSecondaryPress(event)) return;
        if (this.markGestures.up(onScreen(event)) === 'tap') {
          this.markTouch =
            event.pointerType === 'touch'
              ? { ...onScreen(event), at: event.timeStamp }
              : null;
          this.selectMark('tap');
        }

        this.pressedMark = null;
      },
      cancel: () => {
        this.markGestures.cancel();
        this.pressedMark = null;
      },
    };
  }

  private selectMark(gesture: SceneGesture): void {
    const pressed = this.pressedMark;

    if (!pressed) return;

    this.onSceneSelect(
      new CustomEvent<ScopeSelectDetail>('scope-select', {
        detail: {
          scopeType: pressed.scope.type,
          scopeId: pressed.scope.id,
          gesture,
          ...pressed.at,
        },
      }),
    );
  }

  private perform(control: Control, deed: PlannedDeed, at: Point): void {
    const { key } = control;

    if (own(this.marks, key)?.phase === 'armed') {
      this.confirmArmed(key);

      return;
    }

    if (deed === 'lock' || deed === 'unlock') {
      const locked = isLocked(control);

      if (locked === (deed === 'lock')) {
        this.showToast(`${control.name} is already ${deed}ed`, null);

        return;
      }
    }

    if (!opensHome(control, deed)) {
      this.run(key, (next, firm) => planDeed(next, deed, firm), at);

      return;
    }

    this.armings.set(key, { deed, since: performance.now() });
    this.setMark(key, { phase: 'armed', at });
    this.later(`mark:${key}`, LOCK_CONFIRM_MS, () =>
      this.dropMark(key, 'armed'),
    );
  }

  private confirmArmed(key: string): void {
    const mark = own(this.marks, key);
    const arming = this.armings.get(key);

    if (mark?.phase !== 'armed' || !arming) return;

    const now = performance.now();

    if (now - arming.since < CONFIRM_GAP_MS) {
      this.armings.set(key, { ...arming, since: now });

      return;
    }

    this.armings.delete(key);
    this.run(key, (next, firm) => planDeed(next, arming.deed, firm), mark.at);
  }

  private run(key: string, make: Flight['make'], at?: Point): void {
    const hass = this.hass;
    const control = this.controls.get(key);

    if (!hass || !control || !this.interactive) return;

    if (control.unavailable) {
      this.showToast(`${control.name} is unavailable`, null);

      return;
    }

    const pending = this.flights.get(key);
    const plan = make(control, pending !== undefined);
    const spot = at ?? own(this.marks, key)?.at ?? this.sheet?.at ?? origin;
    const flight: Flight = { plan, at: spot, make };

    if (pending) this.land(key, pending);

    this.flights.set(key, flight);
    this.optimistic = {
      ...this.optimistic,
      ...Object.fromEntries(
        plan.optimistic.map((state) => [state.entity_id, state]),
      ),
    };
    this.setMark(key, { phase: 'pending', at: spot });
    this.cancel(`mark:${key}`);
    this.later(`deadline:${key}`, PENDING_LIMIT_MS, () =>
      this.fail(key, flight, control),
    );

    Promise.all(
      plan.calls.map((call) =>
        hass.callService(call.domain, call.service, call.data),
      ),
    ).then(
      () => {
        const done =
          plan.expect.length === 0 || settled(plan, this.hass?.states ?? {});

        if (done) this.confirm(key, flight);
      },
      () => this.fail(key, flight, control),
    );
  }

  private confirm(key: string, flight: Flight): void {
    if (this.flights.get(key) !== flight) return;

    this.land(key, flight);
    this.setMark(key, { phase: 'confirmed', at: flight.at });
    this.later(`mark:${key}`, CONFIRMED_FADE_MS, () =>
      this.dropMark(key, 'confirmed'),
    );
  }

  private fail(key: string, flight: Flight, control: Control): void {
    if (this.flights.get(key) !== flight) return;

    this.land(key, flight);
    this.setMark(key, { phase: 'failed', at: flight.at });
    this.later(`mark:${key}`, FAILED_MARK_MS, () =>
      this.dropMark(key, 'failed'),
    );

    const subject =
      control.kind === 'room' ? `${control.name} lights` : control.name;

    this.showToast(`${subject} did not respond`, () =>
      this.run(key, flight.make, flight.at),
    );
  }

  private land(key: string, flight: Flight): void {
    const landed = new Set(
      flight.plan.optimistic.map((state) => state.entity_id),
    );

    this.flights.delete(key);
    this.cancel(`deadline:${key}`);
    this.optimistic = Object.fromEntries(
      Object.entries(this.optimistic).filter(
        ([entityId]) => !landed.has(entityId),
      ),
    );
  }

  private setMark(key: string, mark: Mark): void {
    this.marks = { ...this.marks, [key]: mark };
  }

  private dropMark(key: string, phase: MarkPhase): void {
    if (own(this.marks, key)?.phase !== phase) return;

    const { [key]: _dropped, ...rest } = this.marks;

    this.marks = rest;
  }

  private showToast(message: string, retry: (() => void) | null): void {
    this.toast = { message, retry };
    this.later('toast', TOAST_MS, () => {
      this.toast = null;
    });
  }

  private onRetry = (): void => {
    const retry = this.toast?.retry;

    this.toast = null;
    this.cancel('toast');
    retry?.();
  };

  private openSheet(key: string, at: Point): void {
    this.sheet = {
      key,
      at,
      framed: false,
      cover: null,
      move: STILL,
      stage: null,
    };
    this.draft = null;
  }

  private frameForSheet(): void {
    const sheet = this.sheet;
    const control = sheet ? this.controls.get(sheet.key) : undefined;
    const size = {
      width: this.stage?.clientWidth ?? 0,
      height: this.stage?.clientHeight ?? 0,
    };

    if (!sheet || !control) return;

    if (sheet.framed) {
      const was = sheet.stage;

      if (!was || (was.width === size.width && was.height === size.height)) {
        return;
      }

      this.sheet = { ...sheet, framed: false, cover: null, move: STILL };

      return;
    }

    if (this.planUndrawn || this.planStale(size)) return;

    const opened = this.sheetCover();
    const house = this.houseBox(control.scope);

    if (!opened || !house) {
      this.sheet = {
        ...sheet,
        framed: true,
        cover: opened,
        move: STILL,
        stage: size,
      };

      return;
    }

    const wanted = this.besideCover(opened, size.width);

    if (JSON.stringify(wanted) !== JSON.stringify(this.planBeside)) {
      this.sheet = { ...sheet, cover: opened, stage: size };

      return;
    }

    const clear = this.controlsClear ?? [];
    const room = this.boxOf(control, sheet.at);
    const tag =
      control.scope.type === 'room'
        ? (this.planView?.tagBounds(control.scope.id, false) ?? null)
        : null;
    const move =
      this.view === '2d' && !this.sheetCovers
        ? planSheetPlacement(room, opened, clear, size, tag)
        : STILL;
    this.sheet = {
      ...sheet,
      framed: true,
      cover: opened,
      move,
      stage: size,
    };
  }

  private get planUndrawn(): boolean {
    return this.view === '2d' && this.planView?.hasUpdated === false;
  }

  private planStale(size: { width: number; height: number }): boolean {
    const painted =
      this.view === '2d'
        ? this.renderRoot.querySelector<EstanzaPlanView>('estanza-plan-view')
            ?.painted
        : null;

    if (!painted) return false;

    const shift = this.planShift;

    return (
      painted.width !== size.width ||
      painted.height !== size.height ||
      painted.shift.x !== shift.x ||
      painted.shift.y !== shift.y ||
      JSON.stringify(painted.beside) !== JSON.stringify(this.planBeside) ||
      !sameRects(painted.clear, this.planClear)
    );
  }

  private sheetCover(): Box | null {
    const shown = this.renderRoot.querySelector<HTMLElement>('.sheet');
    const width = this.stage?.clientWidth ?? 0;
    const height = this.stage?.clientHeight ?? 0;

    if (!shown || width === 0 || height === 0) return null;
    if (!this.sheetsBelow) return this.sheetBoxes()[0] ?? null;

    return {
      left: 0,
      top: height - shown.offsetHeight,
      right: width,
      bottom: height,
    };
  }

  private get openKey(): string | null {
    return this.sheet?.key ?? this.chooser?.key ?? null;
  }

  private get sheetSize(): Size {
    const key = this.openKey;

    return (
      (key === null ? undefined : own(this.sheetSizes, key)) ?? SHEET_GUESS
    );
  }

  private measureSheet(): void {
    const shown = this.renderRoot.querySelector<HTMLElement>('.sheet');
    const key = this.openKey;
    const rise = shown?.classList.contains('bottom') ? shown.offsetHeight : 0;

    if (rise !== this.sheetRise) this.sheetRise = rise;
    if (!shown || key === null || shown.classList.contains('bottom')) return;

    const size = { width: shown.offsetWidth, height: shown.offsetHeight };
    const known = own(this.sheetSizes, key);

    if (known?.width === size.width && known.height === size.height) return;

    this.sheetSizes = { ...this.sheetSizes, [key]: size };
  }

  private onKey = (event: KeyboardEvent): void => {
    this.pointerLast = false;
    this.removeAttribute('data-pointer-focus');

    if (event.key === 'Tab') {
      this.keepFocusInSheet(event);

      return;
    }

    if (event.key !== 'Escape' || this.keyElsewhere(event)) return;
    if (this.disarm()) return;
    if (this.sheet || this.chooser) this.closeSheet();
  };

  private keyElsewhere(event: KeyboardEvent): boolean {
    const path = event.composedPath();
    const from = path[0];

    if (path.includes(this)) return false;

    return (
      from instanceof Element &&
      from !== document.body &&
      from !== document.documentElement
    );
  }

  private disarm(): boolean {
    const armed = Object.keys(this.marks).filter(
      (key) => own(this.marks, key)?.phase === 'armed',
    );

    for (const key of armed) {
      this.armings.delete(key);
      this.cancel(`mark:${key}`);
      this.dropMark(key, 'armed');
    }

    return armed.length > 0;
  }

  private keepFocusInSheet(event: KeyboardEvent): void {
    const root = this.shadowRoot;

    if (
      this.openKey === null ||
      !root ||
      !event.composedPath().includes(this)
    ) {
      return;
    }

    const stops = [
      ...root.querySelectorAll<HTMLElement>(
        '.sheets > .sheet:not(.leaving) :is(button, input)',
      ),
    ].filter((stop) => !stop.hasAttribute('disabled'));

    if (stops.length === 0) return;

    const at = stops.indexOf(root.activeElement as HTMLElement);
    const step = event.shiftKey ? -1 : 1;
    const next =
      at === -1
        ? event.shiftKey
          ? stops.length - 1
          : 0
        : (at + step + stops.length) % stops.length;

    event.preventDefault();
    stops[next].focus({ preventScroll: true });
  }

  private closeSheet(fade = true): void {
    if (fade) this.fadeOutSheet();

    this.sheet = null;
    this.chooser = null;
    this.draft = null;
  }

  private fadeOutSheet(): void {
    const shown = this.renderRoot.querySelector<HTMLElement>(
      '.sheets > .sheet:not(.leaving)',
    );

    if (!shown || motionLive.reduced || !('animate' in shown)) return;

    this.dropLeavingSheets();

    const ghost = shown.cloneNode(true) as HTMLElement;

    ghost.classList.add('leaving');
    ghost.setAttribute('inert', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('role');

    for (const named of ghost.querySelectorAll('[id]')) {
      named.removeAttribute('id');
    }

    shown.parentElement?.append(ghost);

    // An idle page draws no frames, so a fade started now would count from the last frame drawn.
    requestAnimationFrame(() => {
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: SHEET_FADE_MS,
        easing: 'ease-out',
        fill: 'forwards',
      });
      this.later('sheet-leave', SHEET_FADE_MS, () => this.dropLeavingSheets());
    });
  }

  private dropLeavingSheets(): void {
    for (const ghost of this.renderRoot.querySelectorAll('.sheet.leaving')) {
      ghost.remove();
    }
  }

  private showReadOnly(key: string): void {
    const opening = this.openings.get(key);

    if (!opening) return;

    this.closeSheet();
    this.openMoreInfo(opening.entityIds[0] ?? '');
  }

  private openMoreInfo(entityId: string): void {
    if (!entityId) return;

    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onStagePointer = (event: PointerEvent): void => {
    const target = (event.target as Element | null)?.localName;

    this.markTouch = null;
    this.menuPress = isSecondaryPress(event);
    this.pressedBubble =
      (event.target as Element | null)?.closest<HTMLElement>('.bubble')?.dataset
        .key ?? null;
    this.pressedPill = this.pillUnder(event);
    this.markDrag =
      !this.menuPress &&
      this.view === '3d' &&
      (event.target as Element | null)?.closest('.mark, .bubble, .temp')
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;

    this.press =
      !this.menuPress &&
      (target === 'estanza-scene-view' || target === 'estanza-plan-view')
        ? {
            x: event.clientX,
            y: event.clientY,
            at: event.timeStamp,
            picked: false,
          }
        : null;
  };

  private pillUnder(event: PointerEvent): string | null {
    const pill = (event.target as Element | null)?.closest<HTMLElement>(
      '.temp',
    );

    if (!pill) return null;

    const own = pill.querySelector<HTMLElement>('.face');
    const faces = [
      ...(own ? [own] : []),
      ...(this.shadowRoot?.querySelectorAll<HTMLElement>('.temp .face') ?? []),
    ];
    const face = faces.find((node) => {
      const box = node.getBoundingClientRect();

      return (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom &&
        getComputedStyle(node.parentElement ?? node).pointerEvents !== 'none'
      );
    });

    return (face?.closest<HTMLElement>('.temp') ?? pill).dataset.room ?? null;
  }

  private onStageRelease = (event: PointerEvent): void => {
    const press = this.press;

    this.press = null;
    this.markDrag = null;

    if (!press || press.picked || (!this.sheet && !this.chooser)) return;

    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);

    if (moved > DRAG_THRESHOLD_PX) return;
    if (event.timeStamp - press.at >= LONG_PRESS_MS) return;

    this.closeSheet();
  };

  private orbitFromMark(event: PointerEvent): void {
    const drag = this.markDrag;

    if (!drag || drag.id !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);

    if (moved <= DRAG_THRESHOLD_PX) return;

    this.markDrag = null;
    this.markGestures.cancel();
    this.pressedMark = null;
    this.pressedPill = null;
    this.pressedBubble = null;
    this.sceneView?.orbitFrom(event);
  }

  private onStageMove = (event: PointerEvent): void => {
    this.orbitFromMark(event);
  };

  private onStageMenu = (event: MouseEvent): void => {
    const thing = (event.target as Element | null)?.closest(
      '.mark, .bubble, .temp, .pin',
    );

    if (!thing || (!this.interactive && !this.preview)) return;

    event.preventDefault();

    if (!this.menuPress) return;

    this.menuPress = false;

    if (thing.matches('.mark')) {
      this.selectMark('press');
      this.pressedMark = null;

      return;
    }

    const pill = thing.matches('.temp')
      ? this.labels.find((shown) => shown.key === this.pressedPill)
      : undefined;

    if (!pill) return;

    this.onSceneSelect(
      new CustomEvent<ScopeSelectDetail>('scope-select', {
        detail: {
          scopeType: 'room',
          scopeId: pill.key,
          gesture: 'press',
          x: pill.x,
          y: pill.y,
        },
      }),
    );
  };

  private readPages(): void {
    const plan = this.planView;
    const ids = plan?.pages ?? [];
    const shown = plan?.shownPage ?? null;
    const kept = this.planPages;

    if (kept.shown === shown && kept.ids.join() === ids.join()) return;

    this.planPages = { ids: [...ids], shown };
  }

  private turnPage = (page: string): void => {
    this.planPage = page;
    this.closeSheet();
  };

  private onPageChange = (event: Event): void => {
    this.turnPage((event as CustomEvent<string>).detail);
  };

  private onPageSwipe = (event: Event): void => {
    const { ids, shown } = this.pages;
    const at = shown ? ids.indexOf(shown) : -1;
    const next = ids[at + (event as CustomEvent<number>).detail];

    if (at >= 0 && next) this.turnPage(next);
  };

  private onPlanMove = (event: Event): void => {
    this.planMoving = (event as CustomEvent<boolean>).detail;
  };

  private noteHomeDrawn(): void {
    if (this.homeDrawn || !this.homeFloors) return;

    const scene = this.sceneView;
    const undrawn =
      this.view === '3d' && scene?.drawable === true && scene.frames === 0;

    if (!undrawn) this.homeDrawn = true;
  }

  private onViewChange = (): void => {
    this.noteHomeDrawn();

    if (this.view === '2d') {
      const plan =
        this.renderRoot.querySelector<EstanzaPlanView>('estanza-plan-view');
      const frame = plan?.houseFrame();
      const cells = plan?.cellFrames() ?? [];
      const move = this.sheet?.move ?? STILL;

      if (frame) {
        this.planFrame = {
          floor: this.floor,
          frame: {
            left: frame.left + move.x,
            top: frame.top + move.y,
            right: frame.right + move.x,
            bottom: frame.bottom + move.y,
          },
          cells: [],
        };
      } else if (cells.length > 0) {
        this.planFrame = {
          floor: this.floor,
          frame: null,
          cells: cells.map((cell) => ({
            ...cell,
            centre: { x: cell.centre.x + move.x, y: cell.centre.y + move.y },
          })),
        };
      }

      this.readPages();
      this.requestUpdate();

      return;
    }

    if (
      this.highlight ||
      this.roomTemperatures.length > 0 ||
      this.alerts.length > 0 ||
      this.leavingAlerts.length > 0
    ) {
      this.requestUpdate();
    }

    if (!this.interactive) return;

    const floating =
      this.sheet !== null ||
      this.chooser !== null ||
      this.openings.size > 0 ||
      this.controls.size > 0 ||
      Object.keys(this.marks).length > 0;

    if (floating) this.requestUpdate();
  };

  private syncAlerts(): void {
    const reading = this.alertReading;

    if (!this.isConnected) return;
    if (reading === this.syncedAlerts && this.homeFloors === this.syncedIn) {
      return;
    }

    this.syncedAlerts = reading;
    this.syncedIn = this.homeFloors;
    this.scheduleAlerts(reading);

    if (!this.homeFloors) return;

    const current = new Map(reading.alerts.map((alert) => [alert.key, alert]));
    const gone = [...this.knownAlerts.values()].filter(
      (alert) => !current.has(alert.key),
    );
    const fresh = this.criticalAlerts.filter(
      (alert) => !this.knownAlerts.has(alert.key),
    );

    this.knownAlerts = current;
    this.leaveAlerts(gone, current);

    if (fresh[0]) {
      this.bannerKey = null;
      this.closeSheet();
      this.follow(fresh[0]);
    }

    this.holdForAlert();
  }

  private scheduleAlerts(reading: AlertReading): void {
    const shown = reading.alerts.find((alert) => alert.severity === 'critical');
    const tick = shown
      ? MINUTE_MS - (Math.max(0, Date.now() - shown.since) % MINUTE_MS)
      : null;
    const next = [reading.recheckIn, tick].filter(
      (ms): ms is number => ms !== null,
    );

    if (next.length === 0) {
      this.cancel('alerts');

      return;
    }

    this.later('alerts', Math.min(...next), () => {
      this.alertClock += 1;
    });
  }

  private leaveAlerts(
    gone: HomeAlert[],
    current: Map<string, HomeAlert>,
  ): void {
    const staying = this.leavingAlerts.filter(
      (alert) => !current.has(alert.key),
    );

    if (gone.length === 0 && staying.length === this.leavingAlerts.length) {
      return;
    }

    if (motionLive.reduced) {
      this.leavingAlerts = [];

      return;
    }

    this.leavingAlerts = [...staying, ...gone];
    this.later('alerts-leave', PIN_FADE_MS, () => {
      this.leavingAlerts = [];
    });
  }

  private holdForAlert(): void {
    const shown = this.shownAlert;

    if (!shown) {
      if (this.heldForAlert) this.idleHold = null;

      this.heldForAlert = false;

      return;
    }

    const floor = shown.scope ? this.floorOf(shown.scope) : null;

    this.heldForAlert = true;
    this.idleHold = shown.scope
      ? { floor: this.storeys.length > 0 ? floor : null, room: shown.scope }
      : { floor: this.floor };
  }

  private follow(alert: HomeAlert): void {
    const scope = alert.scope;

    if (!scope || this.tile) return;

    const floor = this.storeys.length > 0 ? this.floorOf(scope) : null;
    const moved = floor !== null && floor !== this.floor;

    this.sceneView?.endDrag();

    if (moved) {
      this.floor = floor;
      this.closeSheet();
    }

    this.later('fly', moved ? REFRAME_WAIT_MS : 0, () => this.flyTo(scope));
  }

  private flyTo(scope: SceneScope): void {
    if (this.view === '2d' || this.tile) return;

    const place = burnInPlace(this.burnIndex);

    this.drift = controlDrift(place);
    this.sceneView?.flyTo(scope, place, IDLE_RETURN_MS);
  }

  private nextAlert = (): void => {
    const critical = this.criticalAlerts;
    const shown = this.shownAlert;

    if (!shown || critical.length < 2) return;

    const next = critical[(critical.indexOf(shown) + 1) % critical.length];

    this.bannerKey = next.key;
    this.follow(next);
    this.holdForAlert();
  };

  private renderBanner(): TemplateResult | typeof nothing {
    const shown = this.shownAlert;

    if (!shown) return nothing;

    return bannerTemplate({
      kind: shown.kind,
      name: this.alertName(shown),
      state: alertStates[shown.kind],
      ago: formatAgo(Date.now() - shown.since),
      more: this.criticalAlerts.length - 1,
      next: this.nextAlert,
    });
  }

  private whereOf(alert: HomeAlert): string {
    if (!alert.scope) return 'Whole house';

    const room = this.roomOfAlert(alert);
    const named = room
      ? this.sceneView?.nameOf({ type: 'room', id: room })
      : this.sceneView?.nameOf(alert.scope);

    return (
      named ?? this.thingName(room ? { type: 'room', id: room } : alert.scope)
    );
  }

  private renderPins(): TemplateResult | typeof nothing {
    const pins = this.pinViews();

    return pins.length > 0 ? pinsTemplate(pins, this.onPinTap) : nothing;
  }

  private pinViews(): PinView[] {
    const leaving = new Set(this.leavingAlerts.map((alert) => alert.key));
    const placed = [...this.alerts, ...this.leavingAlerts].filter(
      (alert): alert is HomeAlert & { scope: SceneScope } =>
        alert.scope !== null,
    );

    if (placed.length === 0) return [];

    const shown = placed.filter((alert) => this.inView(alert.scope));
    const surface = this.betweenViews ? null : this.surface;
    const anchors =
      surface?.pinAnchors(shown.map((alert) => alert.scope)) ??
      new Map<string, Point>();
    const controls = this.controlBoxes();
    const stage = {
      width: this.stage?.clientWidth ?? 0,
      height: this.stage?.clientHeight ?? 0,
    };
    const whole = (box: MarkBox): boolean =>
      stage.width === 0 ||
      (box.x - box.width / 2 >= 0 &&
        box.y - box.height / 2 >= 0 &&
        box.x + box.width / 2 <= stage.width &&
        box.y + box.height / 2 <= stage.height);

    const glyphs = this.glyphSpots();

    return placed.map((alert) => {
      const seen = this.inView(alert.scope)
        ? (anchors.get(scopeKey(alert.scope)) ?? null)
        : null;
      const anchor = seen && besideGlyphs(seen, alert.severity, glyphs);
      const up = anchor && pinBox(anchor, alert.severity, false);
      const down = anchor && pinBox(anchor, alert.severity, true);
      const standing = up !== null && whole(up);
      const hanging = down !== null && whole(down);
      const low =
        hanging &&
        (!standing ||
          (up !== null &&
            down !== null &&
            covered(up, controls) &&
            !covered(down, controls)));
      const at = standing || hanging ? anchor : null;

      return {
        key: alert.key,
        kind: alert.kind,
        name: this.alertName(alert),
        severity: alert.severity,
        at,
        low,
        leaving: leaving.has(alert.key),
      };
    });
  }

  private pinnedScopes(): Set<string> {
    const scopes = new Map(
      [...this.alerts, ...this.leavingAlerts].flatMap(
        (alert): [string, string][] =>
          alert.scope ? [[alert.key, scopeKey(alert.scope)]] : [],
      ),
    );

    return new Set(
      this.pinViews().flatMap((pin) => {
        const scope = scopes.get(pin.key);

        return pin.at && scope ? [scope] : [];
      }),
    );
  }

  private syncTablet(): void {
    if (!this.config || !this.tablet || !this.isConnected) {
      if (this.tabletFor) this.stopTablet();

      return;
    }

    if (this.tabletFor === this.config) return;

    const starting = this.tabletFor === null;

    this.tabletFor = this.config;
    this.armIdle();
    this.scheduleLate();

    if (starting) this.later('burn', BURN_IN_EVERY_MS, this.burnTick);
  }

  private stopTablet(): void {
    for (const name of tabletTimers) this.cancel(name);

    this.tabletFor = null;
    this.idle = false;
    this.drift = { x: 0, y: 0 };
  }

  private onClickAfterMark = (event: MouseEvent): void => {
    const touch = this.markTouch;

    this.markTouch = null;

    if (!touch || event.detail === 0) return;
    if (event.timeStamp - touch.at > MARK_CLICK_MS) return;

    const moved = Math.hypot(event.clientX - touch.x, event.clientY - touch.y);
    const onMark = event
      .composedPath()
      .some(
        (node) => node instanceof Element && node.classList.contains('mark'),
      );

    if (moved > DRAG_THRESHOLD_PX || onMark) return;

    // WebKit moves the click of a touch to the nearest button, even after a mark took the tap.
    event.stopPropagation();
    event.preventDefault();
  };

  private onTouch = (): void => {
    if (!this.tabletFor) return;

    this.idle = false;
    this.cancel('home');
    this.armIdle();
  };

  private onResize = (entries: ResizeObserverEntry[]): void => {
    const box = entries[0]?.contentRect;

    if (!box) return;

    this.orientation = orientationOf(box.width, box.height);
    this.chipFloors = box.width < FLOOR_CHIP_CARD_PX;
    this.narrowCard = box.width < PAGED_SCENE_CARD_PX;

    if (this.sheet) this.requestUpdate();
  };

  private armIdle(): void {
    this.later('idle', idleMs(this.config ?? {}), this.goIdle);
  }

  private goIdle = (): void => {
    const home = this.homeFloors;
    const back = idleReturn(
      this.idleHold,
      home ? this.openingFloor(home.document, home.floors) : null,
    );
    const moved = back.floor !== this.floor;

    this.idle = true;
    this.closeSheet();
    this.floor = back.floor;
    this.showView(this.defaultView);

    if (this.view === '2d') return;

    const room = this.idleHold?.room;

    if (!back.camera && room) {
      this.later('home', moved ? REFRAME_WAIT_MS : 0, () => this.flyTo(room));
    }

    if (!back.camera) return;

    if (moved) {
      this.later('home', REFRAME_WAIT_MS, () => this.goHome(IDLE_RETURN_MS));
    } else {
      this.goHome(IDLE_RETURN_MS);
    }
  };

  private burnTick = (): void => {
    this.burnIndex += 1;
    this.later('burn', BURN_IN_EVERY_MS, this.burnTick);

    if (this.idle && !this.idleHold) this.goHome(BURN_IN_SHIFT_MS);
  };

  private goHome(ms: number): void {
    const place = burnInPlace(this.burnIndex);

    this.drift = controlDrift(place);

    if (this.view === '3d') this.sceneView?.goHome(place, ms);
  }

  private syncClockNight(): void {
    if (!this.isConnected || !followsClock(this.nightSource, this.hass)) {
      this.cancel('clock');

      return;
    }

    if (this.timers.has('clock')) return;

    this.later('clock', msToClockNightChange(new Date()), () =>
      this.requestUpdate(),
    );
  }

  private scheduleLate = (): void => {
    const start = lateNightStart(this.config ?? {});

    if (start === null) {
      this.lateClock = false;
      this.cancel('late');

      return;
    }

    const now = new Date();
    const end = lateNightEnd();

    this.lateClock = isLateNight(now, start, end);
    this.later('late', msToLateNightChange(now, start, end), this.scheduleLate);
  };

  private followRenames(): void {
    const config = this.config;
    const hass = this.hass;

    if (!config || !hass) return;

    const unsettled = unsettledLinks(config, hass.states, this.registry);

    if (unsettled.length === 0) return;

    const now = Date.now();
    const dueIn = registryDueIn(this.registry, unsettled, now);

    if (dueIn === null) return;

    if (dueIn > 0) {
      if (dueIn <= REGISTRY_GAP_MS) {
        this.later('registry', dueIn, () => this.followRenames());
      }

      return;
    }

    this.registry = refreshRegistry(
      this.registry,
      hass,
      unsettled,
      now,
      (next) => {
        this.registry = next;
      },
    );
  }

  private later(name: string, ms: number, run: () => void): void {
    this.cancel(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        run();
      }, ms),
    );
  }

  private cancel(name: string): void {
    const timer = this.timers.get(name);

    if (timer) clearTimeout(timer);

    this.timers.delete(name);
  }

  private readings(): Map<string, Reading> {
    const systemUnit = this.systemUnit;
    const readings = new Map<string, Reading>();
    const fromProps: [string, Reading][] = [];

    for (const scopeState of Object.values(this.scopeStates)) {
      const { type, id } = scopeState.scope;
      const reading = scopeState.reading;

      if (type === 'room' && reading?.kind === 'area') {
        if (reading.temperature === null) continue;

        readings.set(id, {
          value: reading.temperature,
          unit: reading.temperatureUnit ?? systemUnit,
        });
      }

      if (type === 'prop' && reading?.kind === 'climate') {
        const room = this.roomOfThing(scopeState);

        if (!room || reading.currentTemperature === null) continue;

        fromProps.push([
          room,
          {
            value: reading.currentTemperature,
            unit: reading.unit ?? systemUnit,
          },
        ]);
      }
    }

    for (const [room, reading] of fromProps) {
      if (!readings.has(room)) readings.set(room, reading);
    }

    return readings;
  }

  private roomOfPiece(scope: SceneScope): string | null {
    const home = this.homeFloors;

    return home ? roomOfPiece(home.document, home.floors, scope) : null;
  }

  private roomOfMark(scope: SceneScope): string | null {
    return (
      this.roomOfPiece(scope) ??
      roomOfOpening(this.homeFloors?.floors ?? [], scope)
    );
  }

  private bandOf(reading: Reading): Band {
    return bandOf(reading.value, comfortBand(this.config ?? {}, reading.unit));
  }

  private pillSize(
    temperature: Pick<RoomTemperature, 'text'>,
    small = false,
  ): LabelSize {
    if (small) {
      return {
        width: labelWidth(temperature.text, true),
        height: SMALL_LABEL_HEIGHT,
      };
    }

    const width = labelWidth(temperature.text);

    if (!this.largePills) return { width, height: LABEL_HEIGHT };

    return { width: width * TABLET_LABEL_SCALE, height: TABLET_LABEL_HEIGHT };
  }

  private get calmCard(): boolean {
    const width = this.stage?.clientWidth ?? 0;
    const height = this.stage?.clientHeight ?? 0;

    return width > 0 && Math.min(width, height) < CALM_CARD_PX;
  }

  private stageEdgeBoxes(): MarkBox[] {
    const width = this.stage?.clientWidth ?? 0;
    const height = this.stage?.clientHeight ?? 0;

    if (width === 0 || height === 0) return [];

    const reach = width + height;

    return [
      { x: -reach / 2, y: height / 2, width: reach, height: 3 * reach },
      { x: width + reach / 2, y: height / 2, width: reach, height: 3 * reach },
      { x: width / 2, y: -reach / 2, width: 3 * reach, height: reach },
      { x: width / 2, y: height + reach / 2, width: 3 * reach, height: reach },
    ];
  }

  private glyphBoxes(
    laid: LaidMarks,
    size: LabelSize,
    bubbleSize: LabelSize = size,
  ): MarkBox[] {
    return [
      ...laid.marks
        .filter((mark) => !this.isDot(mark))
        .map((mark) => ({ ...mark.at, ...size })),
      ...laid.bubbles.map((bubble) => ({ ...bubble, ...bubbleSize })),
    ];
  }

  private clearBoxes(laid: LaidMarks): MarkBox[] {
    return this.glyphBoxes(laid, GLYPH_CLEAR, BUBBLE_CLEAR);
  }

  private neighbourRings(slugs: readonly string[]): Map<string, Point[][]> {
    const all = this.homeFloors?.floors ?? [];
    const stacked = this.view === '3d' && this.viewedFloor === null;
    const floors = stacked
      ? all
      : all.filter((floor) =>
          slugs.some((slug) => floor.roomsBySlug.has(slug)),
        );
    const footprints =
      this.surface?.roomFootprints(
        floors.flatMap((floor) => [...floor.roomsBySlug.keys()]),
      ) ?? new Map<string, RoomFootprint>();
    const rings = new Map<string, Point[][]>();

    for (const slug of slugs) {
      const floor = floors.find((candidate) => candidate.roomsBySlug.has(slug));
      const others = [...(floor?.roomsBySlug.keys() ?? [])].filter(
        (other) => other !== slug,
      );
      const above = floors
        .filter((candidate) => floor && candidate.level > floor.level)
        .flatMap((candidate) => [...candidate.roomsBySlug.keys()]);

      rings.set(slug, [
        ...others.flatMap((other) => {
          const top = footprints.get(other)?.top;

          return top ? [top] : [];
        }),
        ...above.flatMap((other) => {
          const footprint = footprints.get(other);

          return footprint ? [footprint.floor, footprint.top] : [];
        }),
      ]);
    }

    return rings;
  }

  private storeyRings(slugs: readonly string[]): Map<string, StoreyRings> {
    const floors = (this.homeFloors?.floors ?? []).filter((floor) =>
      slugs.some((slug) => floor.roomsBySlug.has(slug)),
    );
    const footprints =
      this.surface?.roomFootprints(
        floors.flatMap((floor) => [...floor.roomsBySlug.keys()]),
      ) ?? new Map<string, RoomFootprint>();
    const byFloor = new Map(
      floors.map((floor) => {
        const prints = [...floor.roomsBySlug.keys()].flatMap((slug) => {
          const footprint = footprints.get(slug);

          return footprint ? [footprint] : [];
        });

        return [
          floor,
          {
            rings: prints.flatMap((print) => [print.floor, print.top]),
            floors: prints.map((print) => print.floor),
          },
        ];
      }),
    );

    return new Map(
      slugs.flatMap((slug) => {
        const floor = floors.find((candidate) =>
          candidate.roomsBySlug.has(slug),
        );
        const storey = floor ? byFloor.get(floor) : undefined;

        return storey && storey.rings.length > 0 ? [[slug, storey]] : [];
      }),
    );
  }

  private temperatureLabels(laid: LaidMarks): TemperatureLabel[] {
    this.pillsMoving = false;

    if (this.view === '2d') {
      this.settledPills = null;

      return this.planLabels();
    }

    const temperatures = this.roomTemperatures;

    if (
      temperatures.length === 0 ||
      this.lateNight ||
      this.betweenViews ||
      this.sceneView?.unframed
    ) {
      return [];
    }

    const shown = roomsInView(
      temperatures.map((temperature) => temperature.slug),
      this.viewedFloor,
      (slug) => this.floorOf({ type: 'room', id: slug }),
    );
    const anchors =
      this.sceneView?.roomAnchors(shown) ?? new Map<string, Point>();
    const bySlug = new Map(temperatures.map((entry) => [entry.slug, entry]));
    const picked = this.pickedRoom;
    const settled = this.settledPills;
    const shifted = !sameSpots(anchors, this.pillAnchors);
    const stage = `${this.stage?.clientWidth}x${this.stage?.clientHeight}`;
    const resized = stage !== this.keptStage;

    this.keptStage = stage;

    if (shifted) {
      const now = performance.now();

      this.shiftGap = now - this.lastShift;
      this.lastShift = now;
    }

    const easing = this.view === '3d' && (this.sceneView?.easing ?? false);
    const moving =
      !resized &&
      settled !== null &&
      settled.view === this.view &&
      settled.picked === picked &&
      sharesRooms(anchors, settled.anchors) &&
      (shifted || easing || this.timers.has('pills'));

    this.pillAnchors = anchors;

    if (moving) {
      if (shifted || easing) {
        const wait = Math.min(
          Math.max(2 * this.shiftGap, PILL_SETTLE_MS),
          PILL_SETTLE_MAX_MS,
        );

        this.later('pills', wait, () => this.requestUpdate());
      }

      this.glide = null;
      this.pillsMoving = true;

      const tapped =
        picked && !anchors.has(picked)
          ? this.sceneView?.roomAnchors([picked], true).get(picked)
          : undefined;

      return this.carriedLabels(
        settled,
        tapped && picked ? new Map([...anchors, [picked, tapped]]) : anchors,
        bySlug,
        picked,
        laid,
      );
    }

    const rooms = this.surface?.roomFootprints(shown) ?? new Map();
    const dots = laid.marks
      .filter((mark) => this.isDot(mark))
      .map((mark) => ({ ...mark.at, ...DOT_BOX }));
    const soft = [
      ...dots,
      ...laid.marks
        .filter((mark) => !this.isDot(mark))
        .map((mark) => ({ ...mark.at, ...GLYPH_REACH })),
      ...laid.bubbles.map((bubble) => ({ ...bubble, ...GLYPH_REACH })),
    ];
    const sheetEdges = this.sheetBoxes();
    const sheets = sheetEdges.map((box) => ({
      x: (box.left + box.right) / 2,
      y: (box.top + box.bottom) / 2,
      width: box.right - box.left,
      height: box.bottom - box.top,
    }));
    const fixed: MarkBox[] = [
      ...laid.marks.flatMap(leaderBoxes),
      ...this.pinBoxes(),
      ...this.controlBoxes(),
      ...this.stageEdgeBoxes(),
      ...(this.view === '3d' ? (this.sceneView?.balconyBoxes() ?? []) : []),
    ];
    const glyphs = this.clearBoxes(laid);
    const taken = [...fixed, ...glyphs];
    const neighbours = this.neighbourRings(shown);
    const storeys = this.storeyRings(shown);
    const calm = this.calmCard;
    const requests = shown.flatMap((slug): PillRequest[] => {
      const at = anchors.get(slug);
      const temperature = bySlug.get(slug);
      const room = rooms.get(slug)?.top ?? null;
      const floor = rooms.get(slug)?.floor;
      const inner = rooms.get(slug)?.inner;
      const storey = storeys.get(slug);

      if (!at || !temperature) return [];
      if (slug !== picked && room && mostlyUnderSheet(room, sheetEdges)) {
        return [];
      }

      return [
        {
          key: slug,
          ...at,
          ...this.pillSize(temperature),
          priority: temperature.flag === null ? 0 : 1,
          room,
          ...(floor ? { floor } : {}),
          ...(inner ? { inner } : {}),
          others: neighbours.get(slug) ?? [],
          ...(storey ? { storey: storey.rings, floors: storey.floors } : {}),
        },
      ];
    });
    const arrange = (
      pills: readonly PillRequest[],
      boost: ReadonlySet<string>,
      anywhere = false,
    ): Arranged => {
      const sizes = new Map(pills.map((pill) => [pill.key, pill]));
      const sizeOf = (key: string): LabelSize => {
        const pill = sizes.get(key);

        return { width: pill?.width ?? 0, height: pill?.height ?? 0 };
      };
      const boxesOf = (labels: readonly PlacedLabel[]): MarkBox[] =>
        labels.flatMap((label) => placedBoxes(label, sizeOf(label.key)));
      const seat = (
        wanted: readonly PillRequest[],
        blocked: readonly MarkBox[],
      ): PlacedLabel[] => placePills(wanted, blocked, soft);

      const pickedPill = pills.find((pill) => pill.key === picked);
      const held = pickedPill
        ? this.heldPill(
            pickedPill,
            anchors,
            rooms,
            resized,
            this.glyphBoxes(laid, GLYPH_HELD, BUBBLE_CLEAR),
          )
        : null;

      if (held && pickedPill) {
        sizes.set(held.key, { ...pickedPill, ...held.size });
      }

      const alone = picked && !held ? seat(pills, taken) : null;
      const first =
        held ??
        alone?.find((label) => label.key === picked) ??
        (picked
          ? seat(
              pills.filter((pill) => pill.key === picked),
              taken,
            ).at(0)
          : undefined);
      const grounded =
        calm && pickedPill && (!first || !overStorey(first, pickedPill.storey))
          ? this.storeyPill(
              pickedPill,
              [...fixed, ...sheets],
              [...glyphs, ...dots],
            )
          : null;

      if (grounded && pickedPill) {
        sizes.set(pickedPill.key, { ...pickedPill, ...grounded.size });
      }

      const pinned = grounded ?? first;
      const lone = pinned ? placedBoxes(pinned, sizeOf(pinned.key)) : [];
      const hurried = pills.flatMap((pill) => {
        const temperature = bySlug.get(pill.key);

        if (!boost.has(pill.key) || pill.key === picked || !temperature) {
          return [];
        }

        return [{ ...pill, ...this.pillSize(temperature, true) }];
      });

      const early =
        this.view === '3d' && hurried.length > 0
          ? strandedPills(
              hurried,
              [...fixed, ...sheets, ...lone],
              [...glyphs, ...dots],
              false,
            )
          : [];
      const hastened = new Set(early.map((label) => label.key));

      for (const pill of hurried) {
        if (hastened.has(pill.key)) sizes.set(pill.key, pill);
      }

      const around = [...taken, ...sheets, ...lone, ...boxesOf(early)];
      const kept = this.keptPills(
        pills.filter((pill) => pill.key !== picked && !hastened.has(pill.key)),
        around,
        rooms,
        resized || boost.size > 0,
      );

      for (const label of kept) {
        const pill = sizes.get(label.key);

        if (pill) sizes.set(label.key, { ...pill, ...label.size });
      }

      const keeps = new Set(kept.map((label) => label.key));
      const rest = seat(
        pills.filter(
          (pill) =>
            pill.key !== picked &&
            !keeps.has(pill.key) &&
            !hastened.has(pill.key),
        ),
        [...around, ...boxesOf(kept)],
      );
      const placed = [...(pinned ? [pinned] : []), ...early, ...kept, ...rest];
      const seated = new Set(placed.map((label) => label.key));
      const shrunk = pills.flatMap((pill) => {
        const temperature = bySlug.get(pill.key);

        if (seated.has(pill.key) || !temperature) return [];

        return [{ ...pill, ...this.pillSize(temperature, true) }];
      });

      for (const pill of shrunk) sizes.set(pill.key, pill);

      const squeezeTaken = [
        ...fixed,
        ...(this.view === '3d' ? glyphs : this.glyphBoxes(laid, GLYPH_DISC)),
        ...sheets,
        ...boxesOf(placed),
      ];
      const squeezed = shrunk.length > 0 ? seat(shrunk, squeezeTaken) : [];
      const housed = new Set(squeezed.map((label) => label.key));
      const strays = shrunk.flatMap((pill): PillRequest[] => {
        const centre = anchors.get(pill.key);

        if (housed.has(pill.key) || !centre) return [];
        if (centre.x === pill.x && centre.y === pill.y) return [];

        return [{ ...pill, ...centre }];
      });
      const rescued =
        strays.length > 0
          ? seat(strays, [...squeezeTaken, ...boxesOf(squeezed)])
          : [];
      const lodged = new Set(
        [...squeezed, ...rescued].map((label) => label.key),
      );
      const stranded =
        this.view === '3d'
          ? strandedPills(
              shrunk.filter((pill) => !lodged.has(pill.key)),
              [
                ...fixed,
                ...sheets,
                ...boxesOf([...placed, ...squeezed, ...rescued]),
              ],
              [...glyphs, ...dots],
              anywhere,
            )
          : [];
      const small = new Set(
        [
          ...early,
          ...squeezed,
          ...rescued,
          ...stranded,
          ...kept.filter((label) => label.small),
          ...(held?.small ? [held] : []),
          ...(grounded ? [grounded] : []),
        ].map((label) => label.key),
      );
      const labels = [...placed, ...squeezed, ...rescued, ...stranded].flatMap(
        (label) => {
          const temperature = bySlug.get(label.key);
          const selected = label.key === picked;
          const box = { x: label.x, y: label.y, ...sizeOf(label.key) };

          if (!temperature) return [];
          if (!selected && covered(box, sheets)) return [];

          return [
            {
              ...label,
              text: temperature.text,
              name:
                this.sceneView?.nameOf({ type: 'room', id: label.key }) ?? null,
              selected,
              small: small.has(label.key),
              large: false,
            },
          ];
        },
      );
      const found = new Set(
        [...placed, ...squeezed, ...rescued, ...stranded].map(
          (label) => label.key,
        ),
      );

      return {
        labels,
        lost: new Set(
          pills.filter((pill) => !found.has(pill.key)).map((pill) => pill.key),
        ),
      };
    };

    const place = (
      pills: readonly PillRequest[],
    ): { labels: TemperatureLabel[]; stuck: ReadonlySet<string> } => {
      let best = arrange(pills, new Set());
      let hurry = calm ? new Set<string>() : best.lost;

      for (
        let tries = 0;
        tries < ARRANGE_RETRIES && hurry.size > 0;
        tries += 1
      ) {
        const again = arrange(pills, hurry);

        if (again.lost.size < best.lost.size) best = again;

        hurry = new Set([...hurry, ...again.lost]);
      }

      const pickedLost = picked !== null && best.lost.has(picked);

      if (pickedLost) {
        const anywhere = arrange(pills, best.lost, true);
        const found = pickedLost && !anywhere.lost.has(picked);

        if (found || anywhere.lost.size < best.lost.size) best = anywhere;
      }

      const held = new Set(picked ? [picked] : []);
      const swapped = uncrossed(
        best.labels,
        (label) => this.pillSize(label, label.small),
        [...fixed, ...glyphs, ...dots, ...sheets],
        held,
      );
      const placeOf = (key: string): StoreyPlace | undefined => {
        const label = swapped.find((one) => one.key === key);
        const footprint = rooms.get(key);

        if (!label || !footprint) return undefined;

        return {
          ...this.pillSize(label, label.small),
          room: footprint.top,
          floor: footprint.floor,
          storey: storeys.get(key)?.rings,
          floors: storeys.get(key)?.floors,
        };
      };
      const strays = strayKeys(
        swapped,
        placeOf,
        this.glyphBoxes(laid, GLYPH_HELD, BUBBLE_CLEAR),
        held,
        this.view === '3d' ? dots : [],
      );
      const seated = swapped.filter((label) => !strays.has(label.key));
      const homeless = pills.flatMap((pill): PillRequest[] => {
        const temperature = bySlug.get(pill.key);

        if (!temperature) return [];
        if (!strays.has(pill.key) && !best.lost.has(pill.key)) return [];

        return [{ ...pill, ...this.pillSize(temperature, true) }];
      });
      const homing = homedPills(
        homeless,
        [
          ...fixed,
          ...sheets,
          ...laid.bubbles.map((bubble) => ({ ...bubble, ...BUBBLE_CLEAR })),
          ...seated.flatMap((label) =>
            placedBoxes(label, this.pillSize(label, label.small)),
          ),
        ],
        [
          ...laid.marks
            .filter((mark) => !this.isDot(mark))
            .map((mark) => ({ ...mark.at, ...GLYPH_CLEAR })),
          ...dots,
        ],
      );
      const homed = homing.labels.flatMap((label): TemperatureLabel[] => {
        const temperature = bySlug.get(label.key);
        const selected = label.key === picked;

        if (!temperature) return [];

        const box = { ...label, ...this.pillSize(temperature, true) };

        if (!selected && covered(box, sheets)) return [];

        return [
          {
            ...label,
            text: temperature.text,
            name:
              this.sceneView?.nameOf({ type: 'room', id: label.key }) ?? null,
            selected,
            small: true,
            large: false,
          },
        ];
      });
      return { labels: [...seated, ...homed], stuck: homing.stuck };
    };

    const floorOfRoom = (slug: string): string =>
      this.floorOf({ type: 'room', id: slug }) ?? '';
    const due =
      resized ||
      this.groupedAnchors === null ||
      this.groupedPick !== picked ||
      !sameSpots(anchors, this.groupedAnchors);
    const every = due ? place(requests) : null;

    if (every) {
      this.regroup(requests, every.stuck, rooms, picked, floorOfRoom);
      this.groupedAnchors = anchors;
      this.groupedPick = picked;
    }

    const keptPills = (): PillRequest[] =>
      requests.filter(
        (pill) =>
          pill.key === picked || !this.groupedFloors.has(floorOfRoom(pill.key)),
      );
    let kept = keptPills();
    let shownPills =
      every && kept.length === requests.length ? every : place(kept);

    for (let round = 0; round < requests.length; round += 1) {
      const late = [...shownPills.stuck].filter((key) => key !== picked);

      if (late.length === 0) break;

      this.regroup(kept, shownPills.stuck, rooms, picked, floorOfRoom);
      kept = keptPills();
      shownPills = place(kept);
    }

    const labels = shownPills.labels;

    this.cancel('pills');
    this.settledPills = {
      anchors,
      spans: footprintSpans(rooms),
      labels,
      picked,
      view: this.view,
    };

    const glided = this.glided(labels);

    return this.glide ? this.offMarks(glided, laid, rooms) : glided;
  }

  private regroup(
    requests: readonly PillRequest[],
    stuck: ReadonlySet<string>,
    rooms: ReadonlyMap<string, RoomFootprint>,
    picked: string | null,
    floorOfRoom: (slug: string) => string,
  ): void {
    const byFloor = new Map<string, string[]>();

    for (const pill of requests) {
      const floor = floorOfRoom(pill.key);

      byFloor.set(floor, [...(byFloor.get(floor) ?? []), pill.key]);
    }

    const scene = `${this.keptStage}|${picked ?? ''}`;

    for (const [floor, slugs] of byFloor) {
      const fits = slugs.every((slug) => !stuck.has(slug));
      const span = floorSpan(slugs.flatMap((slug) => rooms.get(slug) ?? []));
      const grouped = this.groupedSpans.get(floor);

      if (grouped) {
        const roomy = span >= grouped.span * UNGROUP_ROOM;

        if (fits && (roomy || grouped.scene !== scene)) {
          this.groupedFloors.delete(floor);
          this.groupedSpans.delete(floor);
        }
      } else if (!fits) {
        this.groupedFloors.add(floor);
        this.groupedSpans.set(floor, { span, scene });
      }
    }
  }

  private heldPill(
    pill: PillRequest,
    anchors: ReadonlyMap<string, Point>,
    rooms: ReadonlyMap<string, RoomFootprint>,
    resized: boolean,
    blocked: readonly MarkBox[],
  ): (PlacedLabel & { size: LabelSize; small: boolean }) | null {
    const settled = this.settledPills;

    if (this.view !== '3d' || resized || settled?.view !== this.view) {
      return null;
    }

    const label = settled.labels.find((shown) => shown.key === pill.key);
    const from = settled.anchors.get(pill.key);
    const to = anchors.get(pill.key);

    if (!label || !from || !to) return null;

    const size = label.small
      ? { width: labelWidth(label.text, true), height: SMALL_LABEL_HEIGHT }
      : { width: pill.width, height: pill.height };
    const spans = footprintSpans(rooms);
    const shift = carried(
      from,
      to,
      spanScale(settled.spans.get(pill.key), spans.get(pill.key)),
    );
    const width = this.stage?.clientWidth ?? 0;
    const height = this.stage?.clientHeight ?? 0;
    const clear = (spot: Point): boolean => {
      const box = { ...spot, ...size };

      return (
        box.x - box.width / 2 >= 0 &&
        box.y - box.height / 2 >= 0 &&
        box.x + box.width / 2 <= width &&
        box.y + box.height / 2 <= height &&
        !covered(box, blocked)
      );
    };
    const at = [...spotsAround(shift(label), HELD_NUDGE_PX, 2)].find(clear);

    if (!at) return null;

    return {
      key: pill.key,
      ...at,
      ...(label.anchor ? { anchor: shift(label.anchor) } : {}),
      size,
      small: label.small,
    };
  }

  private storeyPill(
    pill: PillRequest,
    taken: readonly MarkBox[],
    glyphs: readonly MarkBox[],
  ): (PlacedLabel & { size: LabelSize; small: boolean }) | null {
    const temperature = this.roomTemperatures.find(
      (entry) => entry.slug === pill.key,
    );

    if (!temperature) return null;

    const size = this.pillSize(temperature, true);
    const [spot] = strandedPills([{ ...pill, ...size }], taken, glyphs, false);

    return spot ? { ...spot, size, small: true } : null;
  }

  private keptPills(
    pills: readonly PillRequest[],
    blocked: readonly MarkBox[],
    rooms: ReadonlyMap<string, RoomFootprint>,
    resized: boolean,
  ): (PlacedLabel & { size: LabelSize; small: boolean })[] {
    if (this.view !== '3d' || resized) return [];

    const shown = new Map(this.labels.map((label) => [label.key, label]));
    const taken = [...blocked];

    return pills.flatMap((pill) => {
      const label = shown.get(pill.key);
      const ring = rooms.get(pill.key)?.top;

      if (!label || !ring) return [];

      const size = label.small
        ? { width: labelWidth(label.text, true), height: SMALL_LABEL_HEIGHT }
        : { width: pill.width, height: pill.height };
      const box = { x: label.x, y: label.y, ...size };
      const { anchor } = label;
      const seated = anchor
        ? insidePolygon(anchor, ring) &&
          lineClear(box, anchor, taken) &&
          sitsOnStorey(label, { ...pill, ...size }, [])
        : pillInside(label, size.width, size.height, pill.inner ?? ring);

      if (!seated || covered(box, taken)) return [];

      const kept = {
        key: label.key,
        x: label.x,
        y: label.y,
        ...(anchor ? { anchor } : {}),
      };

      taken.push(...placedBoxes(kept, size));

      return [{ ...kept, size, small: label.small }];
    });
  }

  private planLabels(): TemperatureLabel[] {
    if (this.planLeaving) return [];

    const picked = this.pickedRoom;

    return (this.planView?.tagLabels() ?? []).map((tag) => ({
      key: tag.key,
      x: tag.x,
      y: tag.y,
      text: tag.text,
      name: tag.compact
        ? null
        : (this.sceneView?.nameOf({ type: 'room', id: tag.key }) ?? null),
      selected: tag.key === picked,
      small: tag.kind === 'small',
      large: tag.kind === 'large',
    }));
  }

  private glided(labels: TemperatureLabel[]): TemperatureLabel[] {
    const now = Date.now();
    const target = JSON.stringify(labels.map(({ key, x, y }) => [key, x, y]));
    let glide = this.glide;

    if (glide && glide.target !== target && now - glide.start < PILL_GLIDE_MS) {
      glide = { ...glide, target };
      this.glide = glide;
    }

    if (!glide || glide.target !== target) {
      const from = new Map(
        this.labels.map((label) => [label.key, { x: label.x, y: label.y }]),
      );
      const moves = labels.some((label) => {
        const was = from.get(label.key);

        return was !== undefined && (was.x !== label.x || was.y !== label.y);
      });

      if (!moves || motionLive.reduced || this.moveGlide) {
        this.glide = null;
        this.cancel('glide');

        return labels;
      }

      glide = { from, target, start: now };
      this.glide = glide;
    }

    const progress = (now - glide.start) / PILL_GLIDE_MS;

    if (progress >= 1) {
      this.glide = null;

      return labels;
    }

    this.later('glide', GLIDE_FRAME_MS, () => this.requestUpdate());

    const eased = 1 - (1 - progress) ** 3;
    const from = glide.from;

    return labels.map((label) => {
      const was = from.get(label.key);

      if (!was) return label;

      return {
        ...label,
        x: was.x + (label.x - was.x) * eased,
        y: was.y + (label.y - was.y) * eased,
      };
    });
  }

  private carriedLabels(
    settled: SettledPills,
    anchors: ReadonlyMap<string, Point>,
    bySlug: ReadonlyMap<string, RoomTemperature>,
    picked: string | null,
    laid: LaidMarks,
  ): TemperatureLabel[] {
    const rooms: ReadonlyMap<string, RoomFootprint> =
      this.surface?.roomFootprints([
        ...new Set([
          ...settled.labels.map((label) => label.key),
          ...anchors.keys(),
        ]),
      ]) ?? new Map();
    const spans = footprintSpans(rooms);

    const carriedOn = settled.labels.flatMap((label) => {
      const from = settled.anchors.get(label.key);
      const to = anchors.get(label.key);
      const temperature = bySlug.get(label.key);

      if (!from || !to || !temperature) return [];

      const shift = carried(
        from,
        to,
        spanScale(settled.spans.get(label.key), spans.get(label.key)),
      );

      return [
        {
          ...label,
          ...this.insideStage(
            shift(label),
            this.pillSize(temperature, label.small),
          ),
          ...(label.anchor ? { anchor: shift(label.anchor) } : {}),
          text: temperature.text,
          selected: label.key === picked,
        },
      ];
    });
    const known = new Set(carriedOn.map((label) => label.key));
    const sheets = this.sheetBoxes();
    const arrived = [...anchors].flatMap(([key, at]): TemperatureLabel[] => {
      const temperature = bySlug.get(key);
      const shaded = sheets.some(
        (box) =>
          at.x >= box.left &&
          at.x <= box.right &&
          at.y >= box.top &&
          at.y <= box.bottom,
      );

      const floor = this.floorOf({ type: 'room', id: key }) ?? '';

      if (known.has(key) || !temperature || shaded) return [];
      if (this.groupedFloors.has(floor)) return [];

      return [
        {
          key,
          ...this.insideStage(at, this.pillSize(temperature, true)),
          text: temperature.text,
          name: this.sceneView?.nameOf({ type: 'room', id: key }) ?? null,
          selected: key === picked,
          small: true,
          large: false,
        },
      ];
    });
    return this.offMarks([...carriedOn, ...arrived], laid, rooms);
  }

  private offMarks(
    labels: readonly TemperatureLabel[],
    laid: LaidMarks,
    rooms: ReadonlyMap<string, RoomFootprint>,
  ): TemperatureLabel[] {
    const loose = labels.filter((label) => !label.selected);
    const nudged = nudgedPills(
      loose.map((label): PillRequest => {
        const room = rooms.get(label.key);

        return {
          key: label.key,
          x: label.x,
          y: label.y,
          ...this.pillSize(label, label.small),
          priority: 0,
          room: room?.top ?? null,
          ...(room ? { floor: room.floor } : {}),
          ...(room?.inner ? { inner: room.inner } : {}),
        };
      }),
      [
        ...this.clearBoxes(laid),
        ...laid.marks
          .filter((mark) => this.isDot(mark))
          .map((mark) => ({ ...mark.at, ...DOT_BOX })),
        ...this.pinBoxes(),
        ...this.controlBoxes(),
        ...this.stageEdgeBoxes(),
        ...labels.flatMap((label) =>
          label.selected
            ? [{ ...label, ...this.pillSize(label, label.small) }]
            : [],
        ),
      ],
    );
    const spots = new Map(nudged.map((spot) => [spot.key, spot]));

    return labels.map((label) => ({ ...label, ...spots.get(label.key) }));
  }

  private get pickedRoom(): string | null {
    const scope = this.sheet ? this.controlOfMark(this.sheet.key)?.scope : null;

    return scope?.type === 'room' ? scope.id : null;
  }

  private sheetBoxes(): Box[] {
    if (!this.sheet && !this.chooser) return [];

    const spot = this.dockSpot;

    if (!spot) return this.measure('.sheet');

    return [
      {
        left: spot.x,
        top: spot.y,
        right: spot.x + spot.width,
        bottom: spot.y + Math.min(this.sheetSize.height, spot.room),
      },
    ];
  }

  private glyphSpots(): MarkBox[] {
    const openings = this.openings;
    const alerted = new Set(
      [...this.alerts, ...this.leavingAlerts].flatMap((alert) =>
        alert.scope ? [scopeKey(alert.scope)] : [],
      ),
    );

    return [...this.controls.values(), ...openings.values()].flatMap(
      (control) => {
        const shut =
          openings.has(control.key) && this.openingLook(control.key) === 'shut';

        if (control.kind === 'room' || shut || alerted.has(control.key)) {
          return [];
        }
        if (!this.inView(control.scope)) return [];

        const at = this.anchorOf(control.scope);

        return at ? [{ ...at, ...GLYPH_BOX }] : [];
      },
    );
  }

  private pinBoxes(): MarkBox[] {
    return this.pinViews().flatMap((pin) =>
      pin.at ? [pinBox(pin.at, pin.severity, pin.low)] : [],
    );
  }

  private controlBoxes(): MarkBox[] {
    return this.boxesOf('.dock .views, .dock .floors, .dock .pages, .banner');
  }

  private boxesOf(selector: string): MarkBox[] {
    return this.measure(selector).map((rect) => ({
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    }));
  }

  private planReadings(): Record<string, string> {
    const readings = this.lateNight
      ? {}
      : Object.fromEntries(
          this.roomTemperatures.map((temperature) => [
            temperature.slug,
            temperature.text,
          ]),
        );

    return this.steady('readings', readings);
  }

  private planCovers(): MarkBox[] {
    return this.steady('covers', [...this.pinBoxes(), ...this.controlBoxes()]);
  }

  private planGlyphs(): GlyphSpot[] {
    const nudged = (host: ShownMark, anchor: Point, at: Point): GlyphSpot => ({
      scope: host.control.scope,
      nudge: { x: at.x - anchor.x, y: at.y - anchor.y },
    });
    const glyphs = [
      ...this.laid.marks
        .filter((mark) => !this.isDot(mark))
        .map((mark) => nudged(mark, mark.anchor, mark.at)),
      ...this.laid.bubbles.flatMap(({ host, ...bubble }) =>
        host ? [nudged(host, host.at, bubble)] : [],
      ),
    ];

    return this.steady('glyphs', glyphs);
  }

  private planSheets(): MarkBox[] {
    const boxes = this.sheetCovers ? [] : this.sheetBoxes();

    return this.steady(
      'sheets',
      boxes.map((box) => ({
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2,
        width: box.right - box.left,
        height: box.bottom - box.top,
      })),
    );
  }

  private steady<TValue>(slot: string, value: TValue): TValue {
    const key = JSON.stringify(value);
    const kept = this.steadyValues.get(slot);

    if (kept?.key === key) return kept.value as TValue;

    this.steadyValues.set(slot, { key, value });

    return value;
  }
}

function leaderBoxes({ at, anchor }: LaidMark): MarkBox[] {
  const length = Math.hypot(at.x - anchor.x, at.y - anchor.y);
  const steps = Math.ceil(length / LEADER_STEP_PX);

  return Array.from({ length: steps }, (_, step) => {
    const t = (step + 1) / steps;

    return {
      x: anchor.x + (at.x - anchor.x) * t,
      y: anchor.y + (at.y - anchor.y) * t,
      width: LEADER_STEP_PX,
      height: LEADER_STEP_PX,
    };
  });
}

function grownTo(box: Box, size: number): Box {
  const width = Math.max(box.right - box.left, size);
  const height = Math.max(box.bottom - box.top, size);
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;

  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
  };
}

function offWords(mark: LaidMark, words: readonly MarkBox[]): LaidMark {
  const { at, anchor } = mark;
  const length = Math.hypot(at.x - anchor.x, at.y - anchor.y);
  const clear = (spot: Point): boolean =>
    !words.some(
      (word) =>
        Math.abs(spot.x - word.x) < word.width / 2 + FIXTURE_DOT_CLEAR_PX &&
        Math.abs(spot.y - word.y) < word.height / 2 + FIXTURE_DOT_CLEAR_PX,
    );

  for (let back = 0; back < length; back += 1) {
    const spot = {
      x: anchor.x + ((at.x - anchor.x) * back) / length,
      y: anchor.y + ((at.y - anchor.y) * back) / length,
    };

    if (clear(spot)) return back === 0 ? mark : { ...mark, anchor: spot };
  }

  return mark;
}

function withStates(
  hass: HomeAssistant,
  overrides: Record<string, HassEntityState>,
): HomeAssistant {
  if (Object.keys(overrides).length === 0) return hass;

  return { ...hass, states: { ...hass.states, ...overrides } };
}

function own<TValue>(
  record: Record<string, TValue>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const registry: CustomCardRegistration[] = (window.customCards =
  window.customCards ?? []);

if (!registry.some((card) => card.type === cardTag)) {
  logCardVersion();
  registry.push({
    type: cardTag,
    name: cardName,
    description: cardDescription,
    preview: true,
    documentationURL: 'https://github.com/estanza-casa/estanza-card',
  });
}

declare global {
  interface HTMLElementTagNameMap {
    'estanza-card': EstanzaCard;
  }

  interface Window {
    customCards?: CustomCardRegistration[];
  }
}
