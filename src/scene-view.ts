import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema, type Light } from '@estanza/plan-engine/document';
import { catalogById } from '@estanza/plan-engine/geometry/catalog.js';
import {
  allFloorSources,
  type DerivedFloor,
  deriveFloors,
  DOOR_DEFAULT_OPEN,
  groundFloor,
} from '@estanza/plan-engine/geometry/geometry.js';
import HomeScene, {
  type SunDirection,
} from '@estanza/scene/components/HomeScene.js';
import { ViewerQuality } from '@estanza/scene/components/ViewerQuality.js';
import { sceneConfig } from '@estanza/scene/config.js';
import { motionLive } from '@estanza/scene/env.js';
import { floorLifts } from '@estanza/scene/explode.js';
import { runStoreyPass } from '@estanza/scene/floor-pass.js';
import {
  canvasFrameloop,
  closeFrame,
  type NamedTier,
  openingTier,
  pauseMeter,
  type QualityTier,
  resumeMeter,
  tierSettings,
  TOP_TIER,
} from '@estanza/scene/quality.js';
import { redrawShadows } from '@estanza/scene/shadows.js';
import type { SpillQuality } from '@estanza/scene/spill.js';
import type { CardUpdate } from '@estanza/shared/card';
import { tokens } from '@estanza/tokens';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, type RootState, useFrame, useThree } from '@react-three/fiber';
import {
  css,
  html,
  LitElement,
  type PropertyValues,
  type TemplateResult,
  unsafeCSS,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  Component,
  createElement,
  type ReactElement,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Box3,
  type Camera,
  MathUtils,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  setConsoleFunction,
  TOUCH,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';

import {
  DEFAULT_OTHER_FLOORS,
  defaultApiOrigin,
  defaultModelsOrigin,
  modelsBase,
  type OtherFloors,
  type SceneScope,
  scopeKey,
  shareDocumentEndpoint,
} from './bindings.js';
import { BuriedLawn, PitLid } from './buried-lawn.js';
import {
  CameraRig,
  groundPoints,
  HOME_CAMERA,
  ORBIT_SETUP,
  type PlanCell,
  type Rect,
  RigDriver,
  type RigSheet,
  type Spot,
} from './camera-rig.js';
import {
  cardHeaders,
  cardUpdateOf,
  homeTooNew,
  latestCardVersionOf,
  OUTDATED_WORDS,
} from './card-update.js';
import {
  type FloorChoice,
  isMarked,
  reframes,
  sceneStoreys,
  storeyView,
} from './floors.js';
import {
  GestureTracker,
  isSecondaryPress,
  pickTarget,
  type Point,
  type ScreenAnchor,
  TARGET_RADIUS_PX,
} from './gesture.js';
import {
  insidePolygon,
  type MarkBox,
  pillInside,
  type SunAngles,
  type Vec2,
} from './living.js';
import type { MarkSpots } from './mark-layout.js';
import { visualCentre } from './plan.js';
import { rimOf, type RoomMarks, RoomMarksLayer } from './room-marks.js';
import {
  type Faded,
  fadePieces,
  inSight,
  markSeen,
  roomSamples,
  screening,
} from './scene-sight.js';
import {
  SHELL_FLOOR,
  SHELL_SLAB,
  ShellSlab,
  StoreyEdge,
} from './shell-slab.js';
import type { Framing, HomePlace } from './tablet.js';

export type PickedScope = {
  scopeType: string;
  scopeId: string;
};

export type SceneGesture = 'tap' | 'press';

export type ScopeSelectDetail = PickedScope & {
  gesture: SceneGesture;
  x: number;
  y: number;
};

export type SceneLightOverlay = {
  on: boolean;
  brightness: number | null;
  color: string | null;
};

export type SceneOverlay = {
  lights: Record<string, SceneLightOverlay>;
  rooms: Record<string, SceneLightOverlay>;
  doors: Record<string, number>;
  windows: Record<string, number>;
};

export type SharedHome = {
  name: string;
  document: HomeDocument;
  watermark: boolean;
};

export type SceneStatus =
  'idle' | 'loading' | 'ready' | 'missing' | 'failed' | 'outdated';

export type ScreenOutline = {
  fill: string;
  edge: string;
};

export type RoomFootprint = { floor: Point[]; top: Point[]; inner?: Point[] };

export type SceneSheet = { scope: SceneScope; covered: Rect; reach?: Rect };

export type SceneFrameloop = ReturnType<typeof canvasFrameloop>;

export const unsupportedNotice = '3D is unavailable on this device';
export const pausedNotice = '3D view paused';
export const furnitureNotice = 'Furniture could not be loaded';

export const REVALIDATE_MS = 5 * 60 * 1000;

const CAMERA = { position: HOME_CAMERA, fov: 50 };
const SWIPE_PX = 48;
const ORBIT_TOUCHES = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
const PAGING_TOUCHES = { TWO: TOUCH.DOLLY_ROTATE };
export const CANVAS_RESIZE = { offsetSize: true, scroll: false };
const OCCLUSION_SLACK = 0.05;
const SIGHT_LEVELS = [0.5, 0.75];
const LABEL_LIFT_CM = 30;
const WINDOW_MARK_LIFT_M = 0.4;
const LIFT_STEPS = 12;
const ANCHOR_ROOM_PX = { width: 56, height: 26 };
const GROUND_KINDS = new Set(['groundZone', 'path', 'gardenSteps', 'balcony']);
const GARDEN_KINDS = new Set(['groundZone', 'path', 'gardenSteps']);
const VEILED = 'estanzaVeiled';
const FRAMED = 'estanzaFramed';
const SHADOW_CELL_PX = 8;

const CLOCK_DEPRECATION = 'THREE.Clock: This module has been deprecated';

setConsoleFunction((type, message, ...params) => {
  // @react-three/fiber still builds a THREE.Clock for every canvas, which three.js now reports.
  if (message.startsWith(CLOCK_DEPRECATION)) return;

  console[type](message, ...params);
});

export function emptyOverlay(): SceneOverlay {
  return { lights: {}, rooms: {}, doors: {}, windows: {} };
}

export function sceneFrameloop(
  visibility: DocumentVisibilityState,
  paused = false,
  tier: NamedTier = TOP_TIER,
): SceneFrameloop {
  return canvasFrameloop(tierSettings(tier), visibility === 'visible', paused);
}

export function sceneSun(sun: SunAngles | null): SunDirection | undefined {
  if (!sun) return undefined;

  const tenth = (degrees: number): number => Math.round(degrees * 10) / 10;

  return {
    elevation: MathUtils.degToRad(tenth(sun.elevation)),
    azimuth: MathUtils.degToRad(tenth(sun.azimuth)),
  };
}

function meterFrames(gl: WebGLRenderer): void {
  const draw = gl.render.bind(gl);

  gl.render = (scene, camera) => {
    draw(scene, camera);
    closeFrame(performance.now());
  };
}

function lightState(
  light: Light,
  overlay: SceneOverlay,
): SceneLightOverlay | undefined {
  return (
    own(overlay.lights, light.slug) ??
    (light.room ? own(overlay.rooms, light.room) : undefined)
  );
}

export function overlayBrightness(
  home: HomeDocument,
  overlay: SceneOverlay,
): Record<string, number> {
  const brightness: Record<string, number> = {};

  for (const light of home.additions.lights) {
    const state = lightState(light, overlay);

    if (state?.on && state.brightness !== null) {
      brightness[light.slug] = clamp01(state.brightness);
    }
  }

  return brightness;
}

export function applyOverlay(
  home: HomeDocument,
  overlay: SceneOverlay,
): HomeDocument {
  const lights = home.additions.lights.map((light) => {
    const state = lightState(light, overlay);

    if (!state) return { ...light, on: false };

    return { ...light, on: state.on, color: state.color ?? light.color };
  });

  const doors = { ...home.overrides.doors };

  for (const { id } of allFloorSources(home).flatMap(
    (floor) => floor.doors ?? [],
  )) {
    doors[id] = { ...doors[id], open: doorOpen(overlay, id) };
  }

  const windows = { ...slidingWindows(home).overrides.windows };

  for (const [id, open] of Object.entries(overlay.windows)) {
    windows[id] = { ...windows[id], open: clamp01(open) };
  }

  return {
    ...home,
    additions: { ...home.additions, lights },
    overrides: { ...home.overrides, doors, windows },
  };
}

export function slidingWindows(home: HomeDocument): HomeDocument {
  const windows = { ...home.overrides.windows };

  for (const pane of allFloorSources(home).flatMap(
    (floor) => floor.windows ?? [],
  )) {
    const override = windows[pane.id];
    const type = override?.type ?? pane.type;
    const sliding = override?.sliding ?? pane.sliding;

    if (type === 'sliding' && !sliding) {
      windows[pane.id] = { ...override, sliding: true };
    }
  }

  return { ...home, overrides: { ...home.overrides, windows } };
}

function doorOpen(overlay: SceneOverlay, id: string): number {
  return clamp01(own(overlay.doors, id) ?? 0) * DOOR_DEFAULT_OPEN;
}

export function withDoorsOf(
  floors: DerivedFloor[],
  overlay: SceneOverlay,
): DerivedFloor[] {
  return floors.map((floor) => ({
    ...floor,
    floor: {
      ...floor.floor,
      doors: floor.floor.doors.map((door) => ({
        ...door,
        open: doorOpen(overlay, door.id),
      })),
    },
  }));
}

export function openFractionsOf(
  floors: readonly DerivedFloor[],
  overlay: SceneOverlay,
): Map<string, number> {
  return new Map(
    floors.flatMap((floor) => [
      ...floor.floor.doors.map((door): [string, number] => [
        door.id,
        doorOpen(overlay, door.id),
      ]),
      ...floor.floor.windows.map((pane): [string, number] => [
        pane.id,
        clamp01(own(overlay.windows, pane.id) ?? 0),
      ]),
    ]),
  );
}

function namedPieces(
  home: HomeDocument,
  scope: SceneScope,
): { slug: string; label?: string }[] {
  if (scope.type === 'room') return Object.values(home.rooms);
  if (scope.type === 'light') return home.additions.lights;
  if (scope.type === 'prop') return home.additions.props;

  return [];
}

export type FloorsMemo = {
  source: HomeDocument;
  openings: string;
  floors: DerivedFloor[];
};

export function floorsFor(
  memo: FloorsMemo | null,
  source: HomeDocument,
  overlay: SceneOverlay,
): FloorsMemo {
  const { doors, windows } = overlay;
  const openings = JSON.stringify([doors, windows]);

  if (memo && memo.source === source && memo.openings === openings) {
    return memo;
  }

  return {
    source,
    openings,
    floors: withFloorColours(
      deriveFloors(applyOverlay(source, { ...emptyOverlay(), doors, windows })),
    ),
  };
}

export function withFloorColours(floors: DerivedFloor[]): DerivedFloor[] {
  return floors.map((floor) => {
    if (floor.rooms.every((room) => room.floorColor !== null)) return floor;

    const rooms = floor.rooms.map((room) =>
      room.floorColor === null
        ? { ...room, floorColor: SHELL_FLOOR.day }
        : room,
    );

    return {
      ...floor,
      rooms,
      roomsBySlug: new Map(rooms.map((room) => [room.slug, room])),
    };
  });
}

function wallBounds(floor: DerivedFloor): Rect | null {
  const ends = floor.floor.walls.flatMap((wall) => [wall.start, wall.end]);

  if (ends.length === 0) return null;

  return {
    left: Math.min(...ends.map((end) => end.x)),
    top: Math.min(...ends.map((end) => end.y)),
    right: Math.max(...ends.map((end) => end.x)),
    bottom: Math.max(...ends.map((end) => end.y)),
  };
}

export function planStoreys<T extends { floor: { id: string } }>(
  storeys: readonly T[],
  floor: FloorChoice,
  laidOut: boolean,
): T[] {
  const shown = storeys.filter((storey) => storey.floor.id === floor);

  return laidOut || shown.length === 0 ? [...storeys] : shown;
}

export function storeyPoints(floor: DerivedFloor, matrix: Matrix4): Vector3[] {
  const walls = floor.floor.walls;
  const top = Math.max(0, ...walls.map((wall) => wall.height));
  const place = (x: number, height: number, z: number): Vector3 =>
    new Vector3(x, height, z).applyMatrix4(matrix);

  return [
    ...walls.flatMap((wall) =>
      [wall.start, wall.end].flatMap((end) => [
        place(end.x, 0, end.y),
        place(end.x, wall.height, end.y),
      ]),
    ),
    ...floor.rooms.flatMap((room) =>
      room.poly.flatMap(([x, z]) => [place(x, 0, z), place(x, top, z)]),
    ),
  ];
}

export function withoutCatalogProps(home: HomeDocument): HomeDocument {
  const props = home.additions.props.filter((prop) => prop.type !== 'catalog');

  return { ...home, additions: { ...home.additions, props } };
}

function catalogUrl(
  prop: HomeDocument['additions']['props'][number],
): string | null {
  const def =
    prop.type === 'catalog' && prop.catalogId
      ? catalogById.get(prop.catalogId)
      : undefined;

  return def ? `${sceneConfig.modelBase}/${def.file}` : null;
}

export function catalogUrls(home: HomeDocument): string[] {
  return [
    ...new Set(home.additions.props.flatMap((prop) => catalogUrl(prop) ?? [])),
  ];
}

export function withLoadedProps(
  home: HomeDocument,
  loaded: ReadonlySet<string>,
): HomeDocument {
  const props = home.additions.props.filter((prop) => {
    const url = catalogUrl(prop);

    return url === null || loaded.has(url);
  });

  return { ...home, additions: { ...home.additions, props } };
}

function ModelLoad({ url }: { url: string }): null {
  useGLTF(url);

  return null;
}

function Loaded({ onLoaded }: { onLoaded: () => void }): null {
  useEffect(onLoaded, [onLoaded]);

  return null;
}

export function ModelsLoaded({
  urls,
  onLoaded,
}: {
  urls: string[];
  onLoaded: (urls: string[]) => void;
}): ReactElement {
  return createElement(
    Suspense,
    { fallback: null },
    ...urls.map((url) => createElement(ModelLoad, { key: url, url })),
    createElement(Loaded, { key: 'loaded', onLoaded: () => onLoaded(urls) }),
  );
}

type ModelGuardProps = {
  onFailure: (error: unknown) => void;
  children?: ReactNode;
};

export class ModelGuard extends Component<
  ModelGuardProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onFailure(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function own<TValue>(
  record: Record<string, TValue>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

type ScopedNode = {
  userData?: { sel?: SceneSelection };
  parent?: ScopedNode | null;
};

type Keep = (object: Object3D) => boolean;

type SceneSelection = { type: string; id: string };

type Shell = { walls: Object3D[]; openings: Object3D[] };

type PairedCell = { floor: DerivedFloor; cell: PlanCell; box: Rect };

type StoreySpread = {
  floor: DerivedFloor;
  anchor: Object3D;
  lifted: Object3D;
  level: Object3D;
  base: Vector3;
  flat: Vector3;
  size: number;
};

export function pickedScope(
  intersections: readonly { object: ScopedNode }[],
  accept: (sel: SceneSelection) => boolean = () => true,
): PickedScope | null {
  for (const hit of intersections) {
    for (
      let node: ScopedNode | null | undefined = hit.object;
      node;
      node = node.parent
    ) {
      const sel = node.userData?.sel;

      if (!sel) continue;
      if (accept(sel)) return { scopeType: sel.type, scopeId: sel.id };

      break;
    }
  }

  return null;
}

export function veilStorey(
  storey: Object3D,
  veiled: boolean,
  hidden: Set<Object3D>,
  keep?: Keep,
): number {
  storey.userData[VEILED] = veiled;

  if (!veiled) {
    for (const object of hidden) object.visible = true;

    hidden.clear();

    return 0;
  }

  if (keep) {
    for (const object of hidden) {
      if (!keep(object)) continue;

      object.visible = true;
      hidden.delete(object);
    }
  }

  const before = hidden.size;

  storey.traverse((object) => {
    if (!drawsItself(object) || !object.visible) return;
    if (keep?.(object)) return;

    object.visible = false;
    hidden.add(object);
  });

  return hidden.size - before;
}

export function ghostStorey(
  storey: Object3D,
  { linked, keep }: { linked: boolean; keep?: Keep },
  onChange?: () => void,
): () => void {
  storey.userData[VEILED] = true;

  const stop = runStoreyPass(
    storey,
    { active: false, linked, xray: false, keep },
    onChange,
  );

  return () => {
    stop();
    storey.userData[VEILED] = false;
  };
}

export function keepVeiled(
  storey: Object3D,
  hidden: Set<Object3D>,
  { gl, scene, camera }: Pick<RootState, 'gl' | 'scene' | 'camera'>,
  keep?: Keep,
): void {
  if (veilStorey(storey, true, hidden, keep) > 0) {
    gl.compile(scene, camera);
  }
}

export function gardenPiece(
  object: Object3D,
  outdoorProps: ReadonlySet<string>,
): boolean {
  for (
    let node: ScopedNode | null | undefined = object;
    node;
    node = node.parent
  ) {
    const sel = node.userData?.sel;

    if (!sel) continue;

    return (
      GARDEN_KINDS.has(sel.type) ||
      (sel.type === 'prop' && outdoorProps.has(sel.id))
    );
  }

  return false;
}

export function isVeiled(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.userData[VEILED] === true) return true;
  }

  return false;
}

function isFramed(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.userData[FRAMED] === true) return true;
  }

  return false;
}

function drawsItself(object: Object3D): boolean {
  const drawn = object as Object3D & {
    isMesh?: boolean;
    isLine?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
  };

  return Boolean(
    drawn.isMesh || drawn.isLine || drawn.isPoints || drawn.isSprite,
  );
}

export function boundMeshes(
  root: Object3D,
  wanted: ReadonlySet<string>,
): Map<string, Object3D[]> {
  const meshes = new Map<string, Object3D[]>();

  root.traverse((object) => {
    if (!(object as Mesh).isMesh || isVeiled(object)) return;

    const picked = pickedScope([{ object }]);

    if (!picked) return;

    const key = `${picked.scopeType}:${picked.scopeId}`;

    if (!wanted.has(key)) return;

    meshes.set(key, [...(meshes.get(key) ?? []), object]);
  });

  return meshes;
}

export function groundPieces(root: Object3D): Object3D[] {
  const pieces: Object3D[] = [];

  root.traverse((object) => {
    const kind = (object as ScopedNode).userData?.sel?.type;

    if (isVeiled(object) && !isFramed(object)) return;
    if (object.name === SHELL_SLAB || (kind && GROUND_KINDS.has(kind))) {
      pieces.push(object);
    }
  });

  return pieces;
}

export function inScene(object: Object3D, scene: Object3D): boolean {
  let root = object;

  while (root.parent) root = root.parent;

  return root === scene;
}

function insideOf(object: Object3D, group: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node === group) return true;
  }

  return false;
}

function heardBy(surface: Element, origin: EventTarget, lift: Event): boolean {
  if (lift.type === 'pointerup') {
    return !(origin instanceof Node) || origin.isConnected;
  }

  const target = lift.composedPath()[0];

  return target instanceof Node && surface.contains(target);
}

export function lowestMesh(meshes: readonly Object3D[]): Mesh | null {
  let lowest: Mesh | null = null;
  let lowestY = Infinity;

  for (const mesh of meshes) {
    const y = mesh.getWorldPosition(new Vector3()).y;

    if (y < lowestY) {
      lowest = mesh as Mesh;
      lowestY = y;
    }
  }

  return lowest;
}

export function projectOutline(
  mesh: Mesh,
  camera: Camera,
  size: { width: number; height: number },
): ScreenOutline | null {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = index ? index.count : position.count;
  const corners: number[] = [];

  for (let i = 0; i < count; i += 1) corners.push(index ? index.getX(i) : i);

  const screen = new Map<number, Point | null>();
  const pointOf = (vertex: number): Point | null => {
    if (!screen.has(vertex)) {
      const projected = new Vector3()
        .fromBufferAttribute(position, vertex)
        .applyMatrix4(mesh.matrixWorld)
        .project(camera);

      screen.set(
        vertex,
        projected.z > 1
          ? null
          : {
              x: ((projected.x + 1) / 2) * size.width,
              y: ((1 - projected.y) / 2) * size.height,
            },
      );
    }

    return screen.get(vertex) ?? null;
  };

  const fill: string[] = [];
  const edges = new Map<string, number>();

  for (let i = 0; i + 2 < corners.length; i += 3) {
    const triangle = [corners[i], corners[i + 1], corners[i + 2]];
    const points = triangle.map(pointOf);

    if (points.some((point) => point === null)) continue;

    fill.push(
      `M${points.map((point) => `${round(point?.x)},${round(point?.y)}`).join('L')}Z`,
    );

    for (let side = 0; side < 3; side += 1) {
      const key = edgeKey(triangle[side], triangle[(side + 1) % 3]);

      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  if (fill.length === 0) return null;

  const edge = [...edges]
    .filter(([, uses]) => uses === 1)
    .map(([key]) => {
      const [a, b] = key.split('-').map(Number).map(pointOf);

      return `M${round(a?.x)},${round(a?.y)}L${round(b?.x)},${round(b?.y)}`;
    });

  return { fill: fill.join(''), edge: edge.join('') };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function round(value: number | undefined): number {
  return Math.round((value ?? 0) * 10) / 10;
}

export function shadowBoxes(
  meshes: readonly Mesh[],
  camera: Camera,
  size: { width: number; height: number },
): MarkBox[] {
  const rows = new Map<number, Set<number>>();
  const mark = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) return;

    const row = Math.floor(y / SHADOW_CELL_PX);
    const cols = rows.get(row) ?? new Set<number>();

    cols.add(Math.floor(x / SHADOW_CELL_PX));
    rows.set(row, cols);
  };

  for (const mesh of meshes) {
    const hull = screenHull(mesh, camera, size);

    if (hull) shade(hull, size, mark);
  }

  return [...rows].flatMap(([row, cols]) =>
    runsOf([...cols].sort((a, b) => a - b)).map(([first, last]) => ({
      x: ((first + last + 1) / 2) * SHADOW_CELL_PX,
      y: (row + 0.5) * SHADOW_CELL_PX,
      width: (last - first + 1) * SHADOW_CELL_PX,
      height: SHADOW_CELL_PX,
    })),
  );
}

function screenHull(
  mesh: Mesh,
  camera: Camera,
  size: { width: number; height: number },
): Point[] | null {
  const geometry = mesh.geometry;

  if (!geometry.boundingBox) geometry.computeBoundingBox();

  const box = geometry.boundingBox;

  if (!box || box.isEmpty()) return null;

  const points: Point[] = [];

  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const projected = new Vector3(x, y, z)
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);

        if (projected.z > 1) return null;

        const point = {
          x: ((projected.x + 1) / 2) * size.width,
          y: ((1 - projected.y) / 2) * size.height,
        };

        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

        points.push(point);
      }
    }
  }

  return convexHull(points);
}

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly Point[]): Point[] => {
    const chain: Point[] = [];

    for (const point of list) {
      while (
        chain.length >= 2 &&
        turn(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }

      chain.push(point);
    }

    chain.pop();

    return chain;
  };

  return [...half(sorted), ...half([...sorted].reverse())];
}

function shade(
  hull: readonly Point[],
  size: { width: number; height: number },
  mark: (x: number, y: number) => void,
): void {
  const step = SHADOW_CELL_PX / 2;
  const most = Math.ceil((2 * (size.width + size.height)) / step);

  hull.forEach((from, index) => {
    const to = hull[(index + 1) % hull.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.min(most, Math.max(1, Math.ceil(length / step)));

    for (let n = 0; n <= steps; n += 1) {
      mark(
        from.x + ((to.x - from.x) * n) / steps,
        from.y + ((to.y - from.y) * n) / steps,
      );
    }
  });

  const xs = hull.map((point) => point.x);
  const ys = hull.map((point) => point.y);
  const right = Math.min(Math.max(...xs), size.width);
  const bottom = Math.min(Math.max(...ys), size.height);

  for (let y = Math.max(Math.min(...ys), 0); y <= bottom; y += step) {
    for (let x = Math.max(Math.min(...xs), 0); x <= right; x += step) {
      if (insidePolygon({ x, y }, hull)) mark(x, y);
    }
  }
}

function runsOf(cols: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];

  for (const col of cols) {
    const last = runs[runs.length - 1];

    if (last && col === last[1] + 1) last[1] = col;
    else runs.push([col, col]);
  }

  return runs;
}

const NO_MARKS: RoomMarks = {};

function spanOf(poly: readonly Vec2[]): [Vec2, Vec2] {
  const xs = poly.map(([x]) => x);
  const zs = poly.map(([, z]) => z);

  return [
    [Math.min(...xs), Math.min(...zs)],
    [Math.max(...xs), Math.max(...zs)],
  ];
}

export function centreOf(meshes: readonly Object3D[]): Vector3 | null {
  if (meshes.length === 0) return null;

  const box = new Box3();

  for (const mesh of meshes) box.expandByObject(mesh);

  return box.getCenter(box.min.clone());
}

export function aboveOf(meshes: readonly Object3D[]): Vector3 | null {
  const box = frameBox(meshes);

  if (!box) return null;

  return box.getCenter(new Vector3()).setY(box.max.y + WINDOW_MARK_LIFT_M);
}

export function pinSpot(
  scope: SceneScope,
  meshes: readonly Object3D[],
): Vector3 | null {
  return markBox(scope, meshes)?.getCenter(new Vector3()) ?? null;
}

export function markSpot(
  scope: SceneScope,
  meshes: readonly Object3D[],
): Vector3 | null {
  if (scope.type === 'window') return aboveOf(meshes);

  return pinSpot(scope, meshes);
}

export function sightSpots(
  scope: SceneScope,
  meshes: readonly Object3D[],
): Vector3[] {
  const opening = scope.type === 'window' || scope.type === 'door';
  const box = opening ? frameBox(meshes) : null;

  if (!box) {
    const centre = centreOf(meshes);

    return centre ? [centre] : [];
  }

  const centre = box.getCenter(new Vector3());

  return [centre, centre.clone().setY(box.max.y)];
}

function markBox(scope: SceneScope, meshes: readonly Object3D[]): Box3 | null {
  if (scope.type === 'window') return frameBox(meshes);
  if (scope.type === 'door') return doorBox(meshes);
  if (meshes.length === 0) return null;

  const box = new Box3();

  for (const mesh of meshes) box.expandByObject(mesh);

  return box;
}

function doorBox(meshes: readonly Object3D[]): Box3 | null {
  const depths = new Set(meshes.map(depthOf));

  if (depths.size !== 1) return frameBox(meshes);

  const box = new Box3();

  for (const mesh of meshes) box.union(shutBox(mesh));

  return box;
}

// Each leaf hangs on a hinge group that turns as the door opens.
function shutBox(mesh: Object3D): Box3 {
  const hinge = mesh.parent;
  const base = hinge?.parent;
  const geometry = (mesh as Mesh).geometry as Mesh['geometry'] | undefined;

  if (!hinge || !base || !geometry) return new Box3().setFromObject(mesh);

  geometry.computeBoundingBox();

  const shut = new Matrix4()
    .compose(hinge.position, new Quaternion(), hinge.scale)
    .premultiply(base.matrixWorld)
    .multiply(mesh.matrix);

  return (geometry.boundingBox ?? new Box3()).clone().applyMatrix4(shut);
}

function frameBox(meshes: readonly Object3D[]): Box3 | null {
  if (meshes.length === 0) return null;

  const box = new Box3();
  const depths = meshes.map(depthOf);
  const frame = Math.min(...depths);

  meshes.forEach((mesh, index) => {
    if (depths[index] === frame) box.expandByObject(mesh);
  });

  return box;
}

function depthOf(object: Object3D): number {
  let depth = 0;

  for (let parent = object.parent; parent; parent = parent.parent) depth += 1;

  return depth;
}

function Committed({ onCommit }: { onCommit: () => void }): null {
  useEffect(() => onCommit());

  return null;
}

function Drawn({ onFrame }: { onFrame: () => void }): null {
  useFrame(() => onFrame());

  return null;
}

function StoreyVeil({
  hidden,
  faded,
  linked,
  framed,
  keep,
  revision,
}: {
  hidden: boolean;
  faded: boolean;
  linked: boolean;
  framed: boolean;
  keep?: Keep;
  revision: number;
}): ReactElement {
  const anchor = useRef<Object3D | null>(null);
  const kept = useRef(new Set<Object3D>());
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const storey = (): Object3D | null => anchor.current?.parent?.parent ?? null;

  useLayoutEffect(() => {
    const root = storey();

    if (root) veilStorey(root, hidden, kept.current, keep);
  }, [hidden, keep]);

  useLayoutEffect(() => {
    const root = storey();

    if (root) root.userData[FRAMED] = framed;
  }, [framed]);

  useLayoutEffect(() => {
    const root = storey();

    if (!root || !faded) return;

    return ghostStorey(root, { linked, keep }, () => {
      redrawShadows(gl);
      invalidate();
    });
  }, [faded, linked, keep, revision, gl, invalidate]);

  useFrame((state) => {
    const root = storey();

    if (hidden && root) keepVeiled(root, kept.current, state, keep);
  });

  return createElement('group', { ref: anchor });
}

function webglSupported(owner: Document): boolean {
  try {
    const probe = owner.createElement('canvas');

    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

@customElement('estanza-scene-view')
export class EstanzaSceneView extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      height: 100%;
      min-height: 220px;
    }

    /* Out of flow, so the canvas the renderer sizes from this box never resizes it. */
    .stage {
      position: absolute;
      inset: 0;
      touch-action: none;
    }

    .stage canvas {
      display: block;
      outline: none;
    }

    .unframed canvas {
      visibility: hidden;
    }

    .notice {
      position: absolute;
      inset: auto 0 0 0;
      padding: 12px 16px;
      color: var(--secondary-text-color, #6b7280);
      font-size: 14px;
      text-align: center;
    }

    .notice span {
      background: var(--ha-card-background, var(--card-background-color, #fff));
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      padding: 4px 10px;
    }
  `;

  @property({ attribute: false }) shareId = '';

  @property({ attribute: false }) homeDocument: HomeDocument | null = null;

  @property({ attribute: false }) apiOrigin = defaultApiOrigin;

  @property({ attribute: false }) modelsOrigin = defaultModelsOrigin;

  @property({ type: Boolean }) night = false;

  @property({ attribute: false }) sun: SunAngles | null = null;

  @property({ attribute: false }) spill: SpillQuality = 'wash';

  @property({ attribute: false }) quality: QualityTier = 'auto';

  @property({ attribute: false }) roomMarks: RoomMarks = {};

  @property({ attribute: false }) overlay: SceneOverlay = emptyOverlay();

  @property({ type: Boolean }) interactive = true;

  @property({ attribute: false }) targets: SceneScope[] = [];

  @property({ attribute: false }) floor: FloorChoice = null;

  @property({ attribute: false }) otherFloors: OtherFloors =
    DEFAULT_OTHER_FLOORS;

  @property({ type: Boolean }) paging = false;

  @property({ attribute: false }) exposure = 1;

  @property({ attribute: false }) framing: Framing = {
    raise: 0,
    zoom: 1,
    house: false,
  };

  @property({ attribute: false }) targetRadius = TARGET_RADIUS_PX;

  markSpots: MarkSpots | null = null;

  @property({ attribute: false }) clear: Rect[] | null = null;

  @property({ attribute: false }) under = 0;

  @property({ attribute: false }) sheet: SceneSheet | null = null;

  @property({ attribute: false }) planFrame: Rect | null = null;

  @property({ attribute: false }) planCells: readonly PlanCell[] | null = null;

  @property({ type: Boolean }) paused = false;

  @property({ type: Boolean }) headless = false;

  @state() private status: SceneStatus = 'idle';

  @state() private home: SharedHome | null = null;

  private verdict: CardUpdate = 'ok';

  @state() private latest: string | null = null;

  @state() private contextLost = false;

  @state() private furnitureBroken = false;

  @state() private loadedModels: ReadonlySet<string> = new Set();

  private readonly pointers = new Set<number>();
  private readonly handed = new Map<number, (lift: Event | null) => void>();

  private dragEnded = false;

  @state() private tier: NamedTier = openingTier(this.quality).applied;

  @state() private meterSettled = false;

  @state() private landed = false;

  private supported: boolean | null = null;

  private root: Root | null = null;

  private sceneState: RootState | null = null;

  private pending: AbortController | null = null;

  private observer: ResizeObserver | null = null;

  private loadedFrom = '';

  private etag: string | null = null;

  private revalidating: AbortController | null = null;

  private revalidateTimer: ReturnType<typeof setTimeout> | null = null;

  private paintedHome: SharedHome | null = null;

  private paintedModel = '';

  private paintedLook = '';

  private looks = 0;

  private meshes: Map<string, Object3D[]> | null = null;

  private meshesFor: { commit: number; targets: SceneScope[] } = {
    commit: -1,
    targets: [],
  };

  private commits = 0;

  private drawnFrames = 0;

  private roomCentres = new Map<string, Vec2>();

  private roomTops = new Map<string, number>();

  private roomSpans = new Map<string, [Vec2, Vec2]>();

  private roomPolys = new Map<string, Vec2[]>();

  private itemRooms = new Map<string, string>();

  private outdoorProps = new Set<string>();
  private readonly inGarden = (object: Object3D): boolean =>
    gardenPiece(object, this.outdoorProps);

  private shell: Shell = { walls: [], openings: [] };

  private shellFor = -1;

  private sight = { pose: '', seen: new Map<string, boolean>() };

  private readonly marksSeen = new Map<string, boolean>();

  private screensPose = '';

  private screens: Object3D[] = [];

  private outdoor: Object3D[] = [];

  private outdoorFor = -1;

  private balconyShadow: { pose: string; boxes: MarkBox[] } = {
    pose: '',
    boxes: [],
  };

  private readonly faded: Faded = new WeakMap();

  private framedStoreys: DerivedFloor[] = [];

  private exploded = 0;

  private lifted = 0;

  private spread = 0;

  private readonly anchors = new Map<string, Object3D>();

  private floorsMemo: FloorsMemo | null = null;
  private swipeFrom: (Point & { id: number }) | null = null;
  private storeyEdges: {
    floors: DerivedFloor[];
    outlines: Map<string, Vec2[][]>;
  } | null = null;

  private roomFloors: Map<string, Mesh> | null = null;

  private roomFloorsFor = -1;

  private grounds: Object3D[] = [];

  private groundsFor = -1;

  private readonly pieceMeshes = new Map<string, Object3D[]>();

  private pieceMeshesFor = -1;

  private announcedHome: SharedHome | null = null;

  private announcedOutdated = false;

  private announcedLatest: string | null = null;

  private motionQuery: MediaQueryList | null = null;

  private readonly gestures = new GestureTracker((at) =>
    this.report(at, 'press'),
  );

  private menuPress = false;

  private readonly rig = new CameraRig(
    () => {
      this.landed = this.rig.landed;
      this.spreadStoreys();
      this.announceView();

      if (this.liftDue()) this.requestUpdate();
    },
    () => this.housePoints(),
    () => this.groundAtRest(),
    () => this.planHouse(),
    () => this.drawnHouse(),
  );

  get sceneStatus(): SceneStatus {
    return this.status;
  }

  get sharedHome(): SharedHome | null {
    return this.home;
  }

  get cardUpdate(): CardUpdate {
    return this.verdict;
  }

  get latestCardVersion(): string | null {
    return this.latest;
  }

  get qualityTier(): NamedTier {
    return this.tier;
  }

  private get live(): RootState | null {
    return this.sceneState?.get() ?? null;
  }

  get rendererNotice(): string {
    if (this.status !== 'ready') return '';
    if (this.furnitureBroken) return furnitureNotice;
    if (this.supported === false) return unsupportedNotice;

    return this.contextLost ? pausedNotice : '';
  }

  render(): TemplateResult {
    return html`
      <div
        class=${this.landed ? 'stage' : 'stage unframed'}
        id="stage"
        part="stage"
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @contextmenu=${this.onContextMenu}
        @wheel=${this.onWheel}
      ></div>
      ${
        this.notice
          ? html`<div class="notice"><span>${this.notice}</span></div>`
          : null
      }
    `;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.watchSize();
    this.watchMotion();
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    if (this.hasUpdated) {
      this.requestUpdate();
      this.armRevalidation();
    }
  }

  disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopRevalidation();

    if (this.pending) {
      this.pending.abort();
      this.pending = null;
      this.loadedFrom = '';
    }

    this.observer?.disconnect();
    this.observer = null;
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.motionQuery = null;
    this.gestures.cancel();
    this.teardownScene();
    super.disconnectedCallback();
  }

  pickAt(at: Point): SceneScope | null {
    const scene = this.live;

    if (!scene) return null;

    const byKey = new Map(
      this.targets.map((scope) => [scopeKey(scope), scope]),
    );
    const spots = this.markSpots;
    const seen = spots ? pickTarget(at, spots.shown, this.targetRadius) : null;
    const seenTarget = seen ? byKey.get(seen) : undefined;

    if (seenTarget) return seenTarget;

    const unseen = this.objectAnchors().filter(
      (anchor) =>
        !spots ||
        (!spots.tucked.has(anchor.key) &&
          spots.shown.every((spot) => spot.key !== anchor.key)),
    );
    const near = seen ? null : pickTarget(at, unseen, this.targetRadius);

    if (near) return byKey.get(near) ?? null;

    const { width, height } = scene.size;

    if (width === 0 || height === 0) return null;

    scene.raycaster.setFromCamera(
      new Vector2((at.x / width) * 2 - 1, 1 - (at.y / height) * 2),
      scene.camera,
    );

    const picked = pickedScope(
      scene.raycaster
        .intersectObjects(scene.scene.children, true)
        .filter((hit) => !isVeiled(hit.object)),
      (sel) => {
        const scope = byKey.get(`${sel.type}:${sel.id}`);

        return (
          scope !== undefined &&
          (!seen || sel.type === 'room') &&
          !this.outOfSight(scope)
        );
      },
    );

    return picked
      ? (byKey.get(`${picked.scopeType}:${picked.scopeId}`) ?? null)
      : null;
  }

  get reframing(): boolean {
    return this.rig.reframing;
  }

  get flying(): boolean {
    return this.rig.flying || this.unframed;
  }

  get unframed(): boolean {
    return this.live !== null && !this.rig.landed;
  }

  get frames(): number {
    return this.drawnFrames;
  }

  get flatAndStill(): boolean {
    return this.rig.flatAndStill;
  }

  redraw(): void {
    this.live?.invalidate();
  }

  get drawable(): boolean {
    return (
      this.status === 'ready' &&
      !this.headless &&
      this.supported !== false &&
      !this.contextLost &&
      document.visibilityState === 'visible'
    );
  }

  get easing(): boolean {
    return this.rig.moving || this.rig.reframing;
  }

  orbitFrom(event: PointerEvent): void {
    const controls = this.live?.controls as { domElement?: Element } | null;
    const surface = controls?.domElement;

    if (!surface) return;

    this.handed.get(event.pointerId)?.(null);
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: 0,
        buttons: 1,
      }),
    );
    this.handOver(event, surface);
    this.gestures.cancel();
  }

  private handOver(event: PointerEvent, surface: Element): void {
    const { pointerId, pointerType } = event;
    const origin = event.composedPath()[0] ?? window;
    const end = (lift: Event | null): void => {
      if (lift && (lift as PointerEvent).pointerId !== pointerId) return;

      origin.removeEventListener('pointerup', end);
      origin.removeEventListener('pointercancel', end);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      this.handed.delete(pointerId);

      if (lift instanceof PointerEvent && lift.type === 'pointerup') {
        this.swiped(lift);
      }
      if (lift && heardBy(surface, origin, lift)) return;

      surface.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId, pointerType }),
      );
    };

    origin.addEventListener('pointerup', end);
    origin.addEventListener('pointercancel', end);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    this.handed.set(pointerId, end);
  }

  goHome(place: HomePlace, ms: number): void {
    this.rig.goHome(place, ms);
  }

  endDrag(): void {
    if (this.pointers.size === 0) return;

    this.dragEnded = true;
    this.gestures.cancel();
    this.rig.holdInput();
  }

  flyTo(scope: SceneScope, place: HomePlace, ms: number): void {
    this.rig.flyTo(() => this.spotOf(scope), place, ms);
  }

  tiltDown(place: HomePlace, ms: number): void {
    this.rig.tiltDown(place, ms);
  }

  tiltUp(place: HomePlace, ms: number): void {
    this.rig.tiltUp(place, ms);
  }

  pinAnchors(scopes: readonly SceneScope[]): Map<string, Point> {
    const scene = this.live;
    const anchors = new Map<string, Point>();

    if (!scene) return anchors;

    scene.scene.updateMatrixWorld();

    const eye = scene.camera.getWorldPosition(new Vector3());

    for (const scope of scopes) {
      const spot = this.pinSight(scope, eye);

      if (!spot) continue;

      const projected = spot.project(scene.camera);

      if (projected.z > 1 || Math.abs(projected.x) > 1) continue;
      if (Math.abs(projected.y) > 1) continue;

      anchors.set(scopeKey(scope), {
        x: ((projected.x + 1) / 2) * scene.size.width,
        y: ((1 - projected.y) / 2) * scene.size.height,
      });
    }

    return anchors;
  }

  private pinSight(scope: SceneScope, eye: Vector3): Vector3 | null {
    const spot = this.worldOf(scope);

    if (!spot) return null;

    const floors = this.floorMeshes();
    const room =
      scope.type === 'room' ? scope.id : this.itemRooms.get(scopeKey(scope));
    const own = room ? floors.get(room) : undefined;
    const poly = room ? this.roomPolys.get(room) : undefined;
    const others = [...floors.values()].filter((floor) => floor !== own);
    const height =
      scope.type === 'room' ? (this.roomTops.get(room ?? '') ?? 0) : 0;
    const samples =
      own && poly && poly.length >= 3 && scope.type === 'room'
        ? roomSamples(poly, visualCentre(poly), height).map((sample) =>
            sample.applyMatrix4(own.matrixWorld),
          )
        : [];

    return (
      [spot, ...samples].find((candidate) =>
        inSight(eye, candidate, others, OCCLUSION_SLACK),
      ) ?? null
    );
  }

  nameOf(scope: SceneScope): string | null {
    const document = this.home?.document;

    if (!document) return null;

    const piece = namedPieces(document, scope).find(
      (candidate) => candidate.slug === scope.id,
    );

    return piece?.label?.trim() || null;
  }

  outlineOf(scope: SceneScope): ScreenOutline | null {
    const scene = this.live;

    if (!scene) return null;

    const key = scopeKey(scope);

    scene.scene.updateMatrixWorld();

    const floor = lowestMesh(
      boundMeshes(scene.scene, new Set([key])).get(key) ?? [],
    );

    return floor ? projectOutline(floor, scene.camera, scene.size) : null;
  }

  anchorOf(scope: SceneScope): Point | null {
    const scene = this.live;
    const meshes = this.drawnMeshes(scope);
    const centre = markSpot(scope, meshes);

    if (!scene || !centre) return null;

    const projected = centre.clone().project(scene.camera);

    if (projected.z > 1) return null;

    return {
      x: ((projected.x + 1) / 2) * scene.size.width,
      y: ((1 - projected.y) / 2) * scene.size.height,
    };
  }

  roomAnchors(slugs: readonly string[], hidden = false): Map<string, Point> {
    const scene = this.live;
    const anchors = new Map<string, Point>();

    if (!scene) return anchors;

    scene.scene.updateMatrixWorld();

    const floors = this.floorMeshes();
    const rims = this.roomFootprints(slugs);

    for (const slug of slugs) {
      const floor = floors.get(slug);
      const poly = this.roomPolys.get(slug);

      if (!floor || !poly) continue;

      const [x, z] = visualCentre(poly);
      const top = Math.max(this.roomTops.get(slug) ?? 0, LABEL_LIFT_CM);
      const rim = rims.get(slug)?.top ?? null;
      const toScreen = (vector: Vector3): Point => ({
        x: ((vector.x + 1) / 2) * scene.size.width,
        y: ((1 - vector.y) / 2) * scene.size.height,
      });
      const heights = Array.from(
        { length: LIFT_STEPS + 1 },
        (_value, step) =>
          LABEL_LIFT_CM + ((top - LABEL_LIFT_CM) * step) / LIFT_STEPS,
      );
      const spots = heights.map((height) =>
        new Vector3(x, height, z).applyMatrix4(floor.matrixWorld),
      );
      const spot =
        spots.find(
          (candidate) =>
            !rim ||
            pillInside(
              toScreen(candidate.clone().project(scene.camera)),
              ANCHOR_ROOM_PX.width,
              ANCHOR_ROOM_PX.height,
              rim,
            ),
        ) ?? spots[spots.length - 1];
      const projected = spot.clone().project(scene.camera);

      if (projected.z > 1) continue;

      if (hidden) {
        anchors.set(slug, toScreen(projected));
        continue;
      }

      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;

      anchors.set(slug, toScreen(projected));
    }

    return anchors;
  }

  outOfSight(scope: SceneScope): boolean {
    const scene = this.live;

    if (!scene) return false;

    const key = scopeKey(scope);
    const pose = this.poseOf(scene);

    if (this.sight.pose !== pose) this.sight = { pose, seen: new Map() };

    const known = this.sight.seen.get(key);

    if (known !== undefined) return !known;

    const seen = this.seenNow(scope, scene);

    this.sight.seen.set(key, seen);

    return !seen;
  }

  fadeScreens(): void {
    const scene = this.live;

    if (!scene) return;

    const pose = this.poseOf(scene);

    if (pose === this.screensPose) return;

    this.screensPose = pose;

    const pieces = this.outdoorPieces();
    const eye = scene.camera.getWorldPosition(new Vector3());
    const screens = screening(eye, this.roomSpots(), pieces);

    fadePieces([...new Set([...this.screens, ...pieces])], screens, this.faded);
    this.screens = pieces;
  }

  roomFootprints(slugs: readonly string[]): Map<string, RoomFootprint> {
    const scene = this.live;
    const footprints = new Map<string, RoomFootprint>();

    if (!scene) return footprints;

    scene.scene.updateMatrixWorld();

    const floors = this.floorMeshes();

    for (const slug of slugs) {
      const floor = floors.get(slug);
      const poly = this.roomPolys.get(slug);

      if (!floor || !poly || poly.length < 3) continue;

      const top = this.roomTops.get(slug) ?? 0;
      const ring = (height: number): Point[] | null => {
        const points: Point[] = [];

        for (const [x, z] of poly) {
          const projected = new Vector3(x, height, z)
            .applyMatrix4(floor.matrixWorld)
            .project(scene.camera);

          if (projected.z > 1) return null;

          points.push({
            x: ((projected.x + 1) / 2) * scene.size.width,
            y: ((1 - projected.y) / 2) * scene.size.height,
          });
        }

        return points;
      };
      const base = ring(0);
      const rim = ring(top);

      if (base && rim) footprints.set(slug, { floor: base, top: rim });
    }

    return footprints;
  }

  balconyBoxes(): MarkBox[] {
    const scene = this.live;

    if (!scene) return [];

    const pose = this.poseOf(scene);

    if (this.balconyShadow.pose === pose) return this.balconyShadow.boxes;

    const meshes: Mesh[] = [];

    scene.scene.updateMatrixWorld();
    scene.scene.traverseVisible((object) => {
      const kind = (object as ScopedNode).userData?.sel?.type;

      if (kind !== 'balcony' || !(object as Mesh).isMesh) return;
      if (!isVeiled(object)) meshes.push(object as Mesh);
    });

    const boxes = shadowBoxes(meshes, scene.camera, scene.size);

    this.balconyShadow = { pose, boxes };

    return boxes;
  }

  furnitureFailed(error: unknown): void {
    console.error(
      `estanza-card: furniture from ${modelsBase(this.modelsOrigin)} did not load as a model, so the home is drawn without it`,
      error,
    );
    this.furnitureBroken = true;
  }

  private modelsLoaded(urls: string[]): void {
    this.loadedModels = new Set([...this.loadedModels, ...urls]);
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('modelsOrigin')) this.furnitureBroken = false;
    if (changed.has('quality')) {
      this.tier = openingTier(this.quality).applied;
      this.meterSettled = false;
    }
    if (
      reframes(changed.get('floor'), this.floor) ||
      (changed.has('paging') && changed.get('paging') !== undefined)
    ) {
      this.rig.switchFloor();
    }

    sceneConfig.modelBase = modelsBase(this.modelsOrigin);
    void this.loadDocument();

    if (this.status === 'ready' && !this.headless) {
      this.supported ??= webglSupported(document);
    }
  }

  protected updated(): void {
    const outdated = this.status === 'outdated';

    if (
      this.home !== this.announcedHome ||
      outdated !== this.announcedOutdated ||
      this.latest !== this.announcedLatest
    ) {
      this.announcedHome = this.home;
      this.announcedOutdated = outdated;
      this.announcedLatest = this.latest;
      this.dispatchEvent(new Event('home-change'));
      // Paint only after the card has answered the new home, so the first paint already has its floor.
      queueMicrotask(() => this.requestUpdate());

      return;
    }

    this.rig.setFraming(this.framing);

    if (this.clear) this.rig.setClear(this.clear, this.under);

    this.rig.setSheet(this.rigSheet());
    this.rig.setPlanFrame(this.planFrame ?? this.cellsFrame());
    this.spreadStoreys();
    this.paint();
    this.applyExposure();
  }

  private rigSheet(): RigSheet | null {
    const sheet = this.sheet;

    if (!sheet) return null;

    const scope = sheet.scope;

    return {
      key: scopeKey(scope),
      covered: sheet.covered,
      ...(sheet.reach ? { reach: sheet.reach } : {}),
      room: () => {
        const box = markBox(scope, this.drawnMeshes(scope));
        const outline = scope.type === 'room' ? this.roomOutline(scope.id) : [];

        if (!box) return outline;

        return [
          ...[0, 1, 2, 3, 4, 5, 6, 7].map(
            (corner) =>
              new Vector3(
                corner & 1 ? box.max.x : box.min.x,
                corner & 2 ? box.max.y : box.min.y,
                corner & 4 ? box.max.z : box.min.z,
              ),
          ),
          ...outline,
        ];
      },
    };
  }

  private roomOutline(slug: string): Vector3[] {
    const floor = this.floorMeshes().get(slug);
    const poly = this.roomPolys.get(slug);

    if (!floor || !poly) return [];

    const top = this.roomTops.get(slug) ?? 0;

    return [0, top].flatMap((height) =>
      poly.map(([x, z]) =>
        new Vector3(x, height, z).applyMatrix4(floor.matrixWorld),
      ),
    );
  }

  private get notice(): string {
    if (this.rendererNotice) return this.rendererNotice;
    if (this.status === 'outdated') return OUTDATED_WORDS;
    if (this.status === 'missing') {
      return 'Could not read this link. Copy the share link again in Estanza';
    }
    if (this.status === 'failed') return 'Cannot reach Estanza';
    if (this.status === 'idle') return 'No home configured';

    return '';
  }

  private watchSize(): void {
    if (this.observer || typeof ResizeObserver === 'undefined') return;

    this.observer = new ResizeObserver(() => this.resizeScene());
    this.observer.observe(this);
  }

  private resizeScene(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('#stage');
    const scene = this.live;

    if (!stage || !scene) return;

    scene.setSize(stage.clientWidth, stage.clientHeight);
    scene.invalidate();
    this.announceView();
  }

  private async loadDocument(): Promise<void> {
    const inline = this.homeDocument;

    if (inline) {
      if (this.home?.document === inline) return;

      this.pending?.abort();
      this.pending = null;
      this.stopRevalidation();
      this.loadedFrom = 'inline';
      this.verdict = 'ok';
      this.home = { name: '', document: inline, watermark: false };
      this.status = 'ready';

      return;
    }

    const shareId = this.shareId;

    if (!shareId) {
      this.stopRevalidation();
      this.loadedFrom = '';
      this.status = 'idle';
      this.home = null;

      return;
    }

    const key = `${this.apiOrigin}|${shareId}`;
    if (key === this.loadedFrom) return;

    this.loadedFrom = key;
    this.etag = null;
    this.stopRevalidation();
    this.pending?.abort();

    const controller = new AbortController();

    this.pending = controller;
    this.status = 'loading';

    try {
      const response = await fetch(
        shareDocumentEndpoint(this.apiOrigin, shareId),
        {
          signal: controller.signal,
          headers: cardHeaders({ accept: 'application/json' }),
        },
      );

      if (controller.signal.aborted) return;

      this.verdict = cardUpdateOf(response);

      if (this.verdict === 'required') {
        this.outdate();

        return;
      }

      if (response.status === 404) {
        this.home = null;
        this.status = 'missing';

        return;
      }

      if (!response.ok) {
        this.home = null;
        this.status = 'failed';

        return;
      }

      const body = (await response.json()) as { home?: SharedHome };

      if (controller.signal.aborted) return;

      this.latest = latestCardVersionOf(body);

      if (homeTooNew(body.home?.document)) {
        this.outdate();

        return;
      }

      const parsed = homeDocumentSchema.safeParse(body.home?.document);

      if (!body.home || !parsed.success) {
        this.home = null;
        this.status = 'failed';

        return;
      }

      this.home = { ...body.home, document: parsed.data };
      this.status = 'ready';
      this.etag = response.headers.get('etag');
    } catch {
      if (controller.signal.aborted) return;

      this.home = null;
      this.status = 'failed';
    } finally {
      if (this.pending === controller) this.pending = null;
    }

    this.armRevalidation();
  }

  private get canRevalidate(): boolean {
    return (
      this.isConnected &&
      document.visibilityState === 'visible' &&
      this.status === 'ready' &&
      this.home !== null &&
      this.loadedFrom !== '' &&
      this.loadedFrom !== 'inline'
    );
  }

  private armRevalidation(): void {
    this.stopRevalidation();

    if (!this.canRevalidate) return;

    this.revalidateTimer = setTimeout(() => {
      this.revalidateTimer = null;
      void this.revalidate();
    }, REVALIDATE_MS);
  }

  private stopRevalidation(): void {
    if (this.revalidateTimer) clearTimeout(this.revalidateTimer);

    this.revalidateTimer = null;
    this.revalidating?.abort();
    this.revalidating = null;
  }

  private outdate(): void {
    this.home = null;
    this.status = 'outdated';
  }

  private async revalidate(): Promise<void> {
    const current = this.home;
    const key = this.loadedFrom;

    if (!current || !this.canRevalidate || this.pending) return;

    const controller = new AbortController();
    const headers = cardHeaders({ accept: 'application/json' });

    if (this.etag) headers['if-none-match'] = this.etag;

    this.revalidating = controller;

    try {
      const response = await fetch(
        shareDocumentEndpoint(this.apiOrigin, this.shareId),
        { signal: controller.signal, headers },
      );

      if (controller.signal.aborted || key !== this.loadedFrom) return;

      this.verdict = cardUpdateOf(response);

      if (this.verdict === 'required') {
        this.outdate();

        return;
      }

      if (response.status === 304) return;

      if (response.status === 404) {
        this.home = null;
        this.status = 'missing';

        return;
      }

      const etag = response.headers.get('etag');

      if (!response.ok || (etag !== null && etag === this.etag)) return;

      const body = (await response.json()) as { home?: SharedHome };

      if (controller.signal.aborted) return;

      this.latest = latestCardVersionOf(body);

      if (homeTooNew(body.home?.document)) {
        this.outdate();

        return;
      }

      const parsed = homeDocumentSchema.safeParse(body.home?.document);

      if (!body.home || !parsed.success) return;

      this.etag = etag;

      if (JSON.stringify(parsed.data) === JSON.stringify(current.document)) {
        return;
      }

      this.home = { ...body.home, document: parsed.data };
    } catch {
      return;
    } finally {
      if (this.revalidating === controller) {
        this.revalidating = null;
        this.armRevalidation();
      }
    }
  }

  private liftDue(): boolean {
    return this.lifted !== this.exploded && !this.rig.flying;
  }

  private paint(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('#stage');
    const home = this.home;

    if (!stage || !home || this.status !== 'ready' || this.headless) {
      this.teardownScene();

      return;
    }

    if (this.supported === false) return;

    const frameloop = sceneFrameloop(
      document.visibilityState,
      this.paused,
      this.tier,
    );
    const look = `${this.night}|${JSON.stringify(sceneSun(this.sun))}|${this.spill}|${this.furnitureBroken}|${this.loadedModels.size}|${this.modelsOrigin}|${this.quality}|${this.tier}|${this.otherFloors}|${JSON.stringify(this.overlay)}`;
    const model = `${look}|${frameloop}|${this.meterSettled}|${this.floor}|${this.paging}|${this.liftDue()}|${JSON.stringify(this.roomMarks)}`;

    if (this.root && home === this.paintedHome && model === this.paintedModel) {
      return;
    }

    if (home !== this.paintedHome || look !== this.paintedLook) this.looks += 1;

    this.paintedLook = look;
    this.paintedHome = home;
    this.paintedModel = model;
    this.root ??= createRoot(stage);
    this.root.render(this.sceneTree(home.document, frameloop));
  }

  private sceneTree(
    source: HomeDocument,
    frameloop: SceneFrameloop,
  ): ReturnType<typeof createElement> {
    const overlaid = applyOverlay(source, this.overlay);
    const model = this.furnitureBroken
      ? withoutCatalogProps(overlaid)
      : overlaid;
    this.floorsMemo = floorsFor(this.floorsMemo, source, this.overlay);

    const view = storeyView(model, this.floorsMemo.floors, this.floor);
    const built = sceneStoreys(
      model,
      this.floorsMemo.floors,
      this.floor,
      this.paging ? 'paged' : this.otherFloors,
    );
    const looks = this.looks;

    this.rig.setStacked(view.explode > 0);
    this.exploded = view.explode;

    // The camera frames the stack from where it will stand, so storeys that rise mid-flight outrun it.
    if (view.explode < this.lifted || !this.rig.flying) {
      this.lifted = view.explode;
    }

    const slabs = storeyView(model, this.floorsMemo.floors, null).slabs;
    const marks = this.roomMarks;
    const night = this.night;
    const settings = tierSettings(this.tier);
    const lidded =
      !this.paging &&
      (this.floorsMemo.floors.find((floor) => floor.id === this.floor)?.level ??
        0) > 0;

    this.roomCentres = new Map(
      view.floors.flatMap((floor) =>
        floor.rooms.map((room) => [room.slug, room.center] as const),
      ),
    );
    this.roomTops = new Map(
      view.floors.flatMap((floor) =>
        floor.rooms.map(
          (room) =>
            [room.slug, rimOf(room, floor.floor.walls)?.[0]?.[1] ?? 0] as const,
        ),
      ),
    );
    this.roomSpans = new Map(
      view.floors.flatMap((floor) =>
        floor.rooms.map((room) => [room.slug, spanOf(room.poly)] as const),
      ),
    );
    this.roomPolys = new Map(
      view.floors.flatMap((floor) =>
        floor.rooms.map((room) => [room.slug, room.poly] as const),
      ),
    );
    this.itemRooms = new Map([
      ...model.additions.lights.flatMap((light) =>
        light.room ? [[`light:${light.slug}`, light.room] as const] : [],
      ),
      ...model.additions.props.flatMap((prop) =>
        prop.room ? [[`prop:${prop.slug}`, prop.room] as const] : [],
      ),
    ]);
    this.outdoorProps = new Set(
      model.additions.props
        .filter((prop) => !prop.room)
        .map((prop) => prop.slug),
    );

    const top = Math.max(...view.floors.map((floor) => floor.level));
    const ground = groundFloor(this.floorsMemo.floors).id;
    const gardenFloor =
      built.faded.has(ground) || built.hidden.has(ground) ? ground : null;

    const all = this.floorsMemo.floors;

    if (this.storeyEdges?.floors !== all) {
      this.storeyEdges = {
        floors: all,
        outlines: new Map(
          all.map((floor) => [floor.id, floor.rooms.map((room) => room.poly)]),
        ),
      };
    }

    const edges = this.storeyEdges.outlines;

    this.framedStoreys = view.floors.filter(
      (floor) => view.explode > 0 || floor.level >= 0 || floor.level === top,
    );

    const loading = catalogUrls(built.home).filter(
      (url) => !this.loadedModels.has(url),
    );

    return createElement(
      Canvas,
      {
        shadows: 'percentage',
        frameloop,
        dpr: settings.dpr,
        camera: CAMERA,
        resize: CANVAS_RESIZE,
        onCreated: (created: RootState) => this.adoptScene(created),
      },
      createElement(
        ModelGuard,
        {
          key: `${this.furnitureBroken}|${this.modelsOrigin}`,
          onFailure: (error: unknown) => this.furnitureFailed(error),
        },
        loading.length > 0
          ? createElement(ModelsLoaded, {
              key: loading.join('|'),
              urls: loading,
              onLoaded: (urls: string[]) => this.modelsLoaded(urls),
            })
          : null,
        createElement(HomeScene, {
          home: withLoadedProps(built.home, this.loadedModels),
          floors: this.floorsMemo.floors,
          active: null,
          night: this.night,
          sun: sceneSun(this.sun),
          shadowMap: settings.sunShadowMap,
          bulbShadows: settings.bulbShadows,
          onTap: () => undefined,
          explode: this.lifted,
          spill: this.spill,
          bulbGlow: true,
          nightGarden: true,
          brightness: overlayBrightness(view.home, this.overlay),
          onFit: this.onFit,
          labels: (floor: DerivedFloor) => [
            createElement('group', {
              key: 'anchor',
              ref: (group: Object3D | null) => {
                if (group) this.anchors.set(floor.id, group);
              },
            }),
            slabs.has(floor.id)
              ? createElement(ShellSlab, {
                  key: 'slab',
                  outline: slabs.get(floor.id) ?? [],
                  night,
                })
              : null,
            view.explode > 0
              ? createElement(StoreyEdge, {
                  key: 'edge',
                  loops: edges.get(floor.id) ?? [],
                  night,
                })
              : null,
            createElement(RoomMarksLayer, {
              key: 'marks',
              floor,
              marks:
                !built.hidden.has(floor.id) &&
                !built.faded.has(floor.id) &&
                isMarked(view, floor)
                  ? marks
                  : NO_MARKS,
              night,
            }),
            createElement(StoreyVeil, {
              key: 'veil',
              hidden: built.hidden.has(floor.id),
              faded: built.faded.has(floor.id),
              linked: built.linked.has(floor.id),
              framed: built.framed.has(floor.id),
              keep: floor.id === gardenFloor ? this.inGarden : undefined,
              revision: looks,
            }),
            floor.id === this.floorsMemo?.floors[0]?.id
              ? createElement(RigDriver, { key: 'rig', rig: this.rig })
              : null,
          ],
        }),
      ),
      createElement(BuriedLawn, {
        home: view.home,
        floors: this.floorsMemo.floors,
        shown: view.floors,
        night: this.night,
        lit: this.night || this.sun !== null,
      }),
      lidded
        ? createElement(PitLid, {
            home: view.home,
            floors: this.floorsMemo.floors,
            night: this.night,
            lit: this.night || this.sun !== null,
          })
        : null,
      createElement(Committed, { onCommit: this.onCommit }),
      createElement(Drawn, { onFrame: this.onFrame }),
      this.quality === 'auto'
        ? createElement(ViewerQuality, {
            tier: this.tier,
            settled: this.meterSettled,
            onTier: this.onTier,
            onSettled: this.onMeterSettled,
          })
        : null,
      createElement(OrbitControls, {
        makeDefault: true,
        ...ORBIT_SETUP,
        touches: this.paging ? PAGING_TOUCHES : ORBIT_TOUCHES,
        onChange: this.announceView,
      }),
    );
  }

  private adoptScene(scene: RootState): void {
    this.sceneState = scene;
    this.contextLost = false;

    const canvas = scene.gl.domElement;

    meterFrames(scene.gl);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.applyExposure();
    this.resizeScene();
  }

  private applyExposure(): void {
    const scene = this.live;

    if (!scene || scene.gl.toneMappingExposure === this.exposure) return;

    scene.gl.toneMappingExposure = this.exposure;
    scene.invalidate();
  }

  private onTier = (tier: NamedTier): void => {
    if (this.quality !== 'auto') return;

    this.tier = tier;
    this.meterSettled = false;
  };

  private onMeterSettled = (): void => {
    this.meterSettled = true;
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') resumeMeter();
    else pauseMeter();

    this.requestUpdate();
    this.stopRevalidation();

    if (this.canRevalidate) void this.revalidate();
  };

  private onContextLost = (): void => {
    this.contextLost = true;
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.live?.invalidate();
  };

  private objectAnchors(): ScreenAnchor[] {
    return this.targets
      .filter((scope) => scope.type !== 'room' && !this.outOfSight(scope))
      .flatMap((scope) => {
        const anchor = this.anchorOf(scope);

        return anchor ? [{ key: scopeKey(scope), ...anchor }] : [];
      });
  }

  private objectMeshes(): Map<string, Object3D[]> {
    const scene = this.live;

    if (!scene) return new Map();

    const cached = this.meshesFor;

    if (
      this.meshes &&
      this.meshes.size > 0 &&
      cached.commit === this.commits &&
      cached.targets === this.targets
    ) {
      return this.meshes;
    }

    const wanted = new Set(
      this.targets
        .filter((scope) => scope.type !== 'room')
        .map((scope) => scopeKey(scope)),
    );

    scene.scene.updateMatrixWorld();
    this.meshes = boundMeshes(scene.scene, wanted);
    this.meshesFor = { commit: this.commits, targets: this.targets };

    return this.meshes;
  }

  private worldOf(scope: SceneScope): Vector3 | null {
    if (scope.type === 'room') {
      const floor = this.floorMeshes().get(scope.id);
      const centre = this.roomCentres.get(scope.id);

      const top = this.roomTops.get(scope.id) ?? 0;

      return floor && centre
        ? new Vector3(centre[0], top, centre[1]).applyMatrix4(floor.matrixWorld)
        : null;
    }

    return pinSpot(scope, this.piecesOf(scope));
  }

  drawnFloors(): DerivedFloor[] {
    const source = this.home?.document;

    if (!source) return [];

    this.floorsMemo = floorsFor(this.floorsMemo, source, this.overlay);

    return storeyView(source, this.floorsMemo.floors, this.floor).floors;
  }

  private housePoints(): Vector3[] {
    return this.storeysAt((storey) => ({ at: storey.base, size: 1 }));
  }

  // The camera frames where the storeys come to rest, not where their lift or spread has them now.
  private groundAtRest(): Vector3[] {
    const rests = this.storeySpreads().map((storey) => ({
      lifted: storey.lifted,
      move: storey.level.matrixWorld
        .clone()
        .multiply(new Matrix4().makeTranslation(storey.base))
        .multiply(storey.lifted.matrixWorld.clone().invert()),
    }));

    return this.groundMeshes().flatMap((ground) => {
      const rest = rests.find(({ lifted }) => insideOf(ground, lifted));
      const points = groundPoints([ground]);

      return rest
        ? points.map((point) => point.applyMatrix4(rest.move))
        : points;
    });
  }

  private planHouse(): Vector3[] {
    const laidOut = this.pairedCells().length > 0;

    return this.storeysAt(
      (storey) => ({ at: storey.flat, size: storey.size }),
      (storeys) => planStoreys(storeys, this.floor, laidOut),
    );
  }

  private drawnHouse(): Vector3[] {
    return this.storeysAt((storey) => ({
      at: storey.lifted.position,
      size: storey.lifted.scale.x,
    }));
  }

  private storeysAt(
    pose: (storey: StoreySpread) => { at: Vector3; size: number },
    pick: (storeys: StoreySpread[]) => StoreySpread[] = (storeys) => storeys,
  ): Vector3[] {
    const scene = this.live?.scene;

    if (!scene) return [];

    return pick(this.storeySpreads()).flatMap((storey) => {
      if (!inScene(storey.anchor, scene)) return [];

      storey.anchor.updateWorldMatrix(true, false);

      const { at, size } = pose(storey);
      const placed = new Matrix4().compose(
        at,
        new Quaternion(),
        new Vector3(size, size, size),
      );
      const matrix = storey.level.matrixWorld
        .clone()
        .multiply(placed)
        .multiply(storey.anchor.matrix);

      return storeyPoints(storey.floor, matrix);
    });
  }

  private spreadStoreys(): void {
    const flat = this.pairedCells().length > 0 ? this.rig.flatness : 0;

    if (flat === 0 && this.spread === 0) return;

    for (const storey of this.storeySpreads()) {
      storey.lifted.position.lerpVectors(storey.base, storey.flat, flat);
      storey.lifted.scale.setScalar(MathUtils.lerp(1, storey.size, flat));
    }

    this.spread = flat;

    const scene = this.live;

    if (scene) redrawShadows(scene.gl);
  }

  private storeySpreads(): StoreySpread[] {
    const lifts = floorLifts(this.framedStoreys, this.exploded);
    const paired = this.pairedCells();
    const mean = (values: readonly number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const middle = {
      x: mean(paired.map(({ box }) => (box.left + box.right) / 2)),
      y: mean(paired.map(({ box }) => (box.top + box.bottom) / 2)),
    };
    const drawn = {
      x: mean(paired.map(({ cell }) => cell.centre.x)),
      y: mean(paired.map(({ cell }) => cell.centre.y)),
    };
    const scale = mean(paired.map(({ cell }) => cell.scale));

    return this.framedStoreys.flatMap((floor): StoreySpread[] => {
      const anchor = this.anchors.get(floor.id);
      const lifted = anchor?.parent;
      const level = lifted?.parent;

      if (!anchor || !lifted || !level) return [];

      const base = new Vector3(0, lifts.get(floor.id) ?? 0, 0);
      const pair = paired.find((one) => one.floor === floor);

      if (!pair) {
        return [{ floor, anchor, lifted, level, base, flat: base, size: 1 }];
      }

      const { box, cell } = pair;
      const size = cell.scale / scale;
      const flat = new Vector3(
        middle.x +
          (cell.centre.x - drawn.x) / scale -
          (size * (box.left + box.right)) / 2,
        -level.position.y,
        middle.y +
          (cell.centre.y - drawn.y) / scale -
          (size * (box.top + box.bottom)) / 2,
      );

      return [{ floor, anchor, lifted, level, base, flat, size }];
    });
  }

  private cellsFrame(): Rect | null {
    const rects = this.pairedCells().map(({ box, cell }) => {
      const across = ((box.right - box.left) * cell.scale) / 2;
      const down = ((box.bottom - box.top) * cell.scale) / 2;

      return {
        left: cell.centre.x - across,
        top: cell.centre.y - down,
        right: cell.centre.x + across,
        bottom: cell.centre.y + down,
      };
    });

    if (rects.length === 0) return null;

    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
  }

  private pairedCells(): PairedCell[] {
    const cells = this.planCells ?? [];
    const paired = this.framedStoreys.flatMap((floor): PairedCell[] => {
      const cell = cells.find((one) => one.floor === floor.id);
      const box = wallBounds(floor);

      return cell && box ? [{ floor, cell, box }] : [];
    });

    return paired.length > 1 && paired.length === this.framedStoreys.length
      ? paired
      : [];
  }

  private spotOf(scope: SceneScope): Spot | null {
    this.live?.scene.updateMatrixWorld();

    if (scope.type !== 'room') {
      const meshes = this.piecesOf(scope);

      if (meshes.length === 0) return null;

      const box = new Box3();

      for (const mesh of meshes) box.expandByObject(mesh);

      return { centre: box.getCenter(new Vector3()), axis: null };
    }

    const floor = this.floorMeshes().get(scope.id);
    const span = this.roomSpans.get(scope.id);
    const centre = this.roomCentres.get(scope.id);

    if (!floor || !span || !centre) return null;

    const [[x0, z0], [x1, z1]] = span;
    const wide = x1 - x0 >= z1 - z0;
    const middle = (this.roomTops.get(scope.id) ?? 0) / 2;

    return {
      centre: new Vector3(centre[0], middle, centre[1]).applyMatrix4(
        floor.matrixWorld,
      ),
      axis: new Vector3(Number(wide), 0, Number(!wide)).transformDirection(
        floor.matrixWorld,
      ),
    };
  }

  private drawnMeshes(scope: SceneScope): Object3D[] {
    const scene = this.live;
    const meshes = this.objectMeshes().get(scopeKey(scope));

    if (scene && meshes?.every((mesh) => inScene(mesh, scene.scene))) {
      return meshes;
    }

    return this.piecesOf(scope);
  }

  private piecesOf(scope: SceneScope): Object3D[] {
    const scene = this.live;

    if (!scene) return [];

    const key = scopeKey(scope);

    if (this.pieceMeshesFor !== this.commits) {
      this.pieceMeshes.clear();
      this.pieceMeshesFor = this.commits;
    }

    const cached = this.pieceMeshes.get(key);
    const meshes =
      (cached?.every((mesh) => inScene(mesh, scene.scene)) ? cached : null) ??
      boundMeshes(scene.scene, new Set([key])).get(key) ??
      [];

    if (meshes.length > 0) this.pieceMeshes.set(key, meshes);

    return meshes;
  }

  private floorMeshes(): Map<string, Mesh> {
    const scene = this.live;

    if (!scene) return new Map();
    if (
      this.roomFloors &&
      this.roomFloors.size > 0 &&
      this.roomFloorsFor === this.commits &&
      [...this.roomFloors.values()].every((floor) =>
        inScene(floor, scene.scene),
      )
    ) {
      return this.roomFloors;
    }

    const wanted = new Set(
      [...this.roomCentres.keys()].map((slug) =>
        scopeKey({ type: 'room', id: slug }),
      ),
    );
    const floors = new Map<string, Mesh>();

    for (const [key, meshes] of boundMeshes(scene.scene, wanted)) {
      const floor = lowestMesh(meshes);

      if (floor) floors.set(key.slice('room:'.length), floor);
    }

    this.roomFloors = floors;
    this.roomFloorsFor = this.commits;

    return floors;
  }

  private groundMeshes(): Object3D[] {
    const scene = this.live;

    if (!scene) return [];
    if (
      this.groundsFor === this.commits &&
      this.grounds.every((ground) => inScene(ground, scene.scene))
    ) {
      return this.grounds;
    }

    this.grounds = groundPieces(scene.scene);
    this.groundsFor = this.commits;

    return this.grounds;
  }

  private poseOf(scene: RootState): string {
    const { camera, size } = scene;

    return [
      ...camera.position.toArray(),
      ...camera.quaternion.toArray(),
      size.width,
      size.height,
      this.commits,
    ].join();
  }

  private seenNow(scope: SceneScope, scene: RootState): boolean {
    const eye = scene.camera.getWorldPosition(new Vector3());
    const room =
      scope.type === 'room' ? scope.id : this.itemRooms.get(scopeKey(scope));

    if (room && !this.roomSeen(room, eye)) return false;
    if (scope.type === 'room') return true;

    const spots = sightSpots(scope, this.drawnMeshes(scope));
    const blockers = room
      ? [...this.sightBlockers(null), ...this.openingMeshes()]
      : this.sightBlockers(null);

    const seen = markSeen(
      eye,
      spots,
      blockers,
      this.marksSeen.get(scopeKey(scope)) ?? false,
    );

    this.marksSeen.set(scopeKey(scope), seen);

    return seen;
  }

  private roomSeen(slug: string, eye: Vector3): boolean {
    const floor = this.floorMeshes().get(slug);
    const poly = this.roomPolys.get(slug);

    if (!floor || !poly || poly.length < 3) return true;

    const blockers = [...this.sightBlockers(floor), ...this.openingMeshes()];
    const top = this.roomTops.get(slug) ?? 0;
    const heights = [
      LABEL_LIFT_CM,
      ...SIGHT_LEVELS.map((level) => top * level),
    ];

    return heights.some((height) =>
      roomSamples(poly, visualCentre(poly), height).some((sample) =>
        inSight(
          eye,
          sample.applyMatrix4(floor.matrixWorld),
          blockers,
          OCCLUSION_SLACK,
        ),
      ),
    );
  }

  private sightBlockers(own: Mesh | null): Object3D[] {
    const floors = [...this.floorMeshes().values()];

    return [...this.wallMeshes(), ...floors.filter((floor) => floor !== own)];
  }

  private wallMeshes(): Object3D[] {
    return this.shellMeshes().walls.filter((wall) => !isVeiled(wall));
  }

  private openingMeshes(): Object3D[] {
    return this.shellMeshes().openings.filter((pane) => !isVeiled(pane));
  }

  private shellMeshes(): Shell {
    const scene = this.live;

    if (!scene) return { walls: [], openings: [] };

    const cached = this.shell;
    const all = [...cached.walls, ...cached.openings];

    if (
      this.shellFor === this.commits &&
      all.every((mesh) => inScene(mesh, scene.scene))
    ) {
      return cached;
    }

    const shell: Shell = { walls: [], openings: [] };

    scene.scene.traverse((object) => {
      if (!(object as Mesh).isMesh) return;

      const kind = pickedScope([{ object }])?.scopeType;

      if (kind === 'wall') shell.walls.push(object);
      if (kind === 'door' || kind === 'window') shell.openings.push(object);
    });

    this.shell = shell;
    this.shellFor = this.commits;

    return shell;
  }

  private outdoorPieces(): Object3D[] {
    const scene = this.live;

    if (!scene || this.outdoorProps.size === 0) return [];
    if (
      this.outdoorFor === this.commits &&
      this.outdoor.every((piece) => inScene(piece, scene.scene))
    ) {
      return this.outdoor;
    }

    const pieces: Object3D[] = [];

    scene.scene.traverse((object) => {
      const sel = (object as ScopedNode).userData?.sel;

      if (sel?.type === 'prop' && this.outdoorProps.has(sel.id)) {
        pieces.push(object);
      }
    });

    this.outdoor = pieces;
    this.outdoorFor = this.commits;

    return pieces;
  }

  private roomSpots(): Vector3[] {
    return [...this.floorMeshes()].flatMap(([slug, floor]) => {
      const poly = this.roomPolys.get(slug);

      if (!poly || poly.length < 3) return [];

      return roomSamples(poly, visualCentre(poly), LABEL_LIFT_CM).map(
        (sample) => sample.applyMatrix4(floor.matrixWorld),
      );
    });
  }

  private onFit = (): void => {
    this.rig.refit();
  };

  private onCommit = (): void => {
    this.commits += 1;
    this.rig.sceneCommitted();
    this.live?.invalidate();
    this.announceView();
  };

  private watchMotion(): void {
    if (this.motionQuery || typeof window.matchMedia !== 'function') return;

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.onMotionChange);
    motionLive.reduced = this.motionQuery.matches;
  }

  private onMotionChange = (): void => {
    motionLive.reduced = this.motionQuery?.matches ?? false;
  };

  private localPoint(event: MouseEvent): Point {
    const stage = event.currentTarget as HTMLElement;
    const rect = stage.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onWheel = (): void => {
    this.dispatchEvent(new Event('camera-input'));
    this.rig.cancel();
  };

  private lift(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);

    if (this.pointers.size === 0) this.forgetPointers();
  }

  private forgetPointers(): void {
    this.pointers.clear();

    if (!this.dragEnded) return;

    this.dragEnded = false;
    this.rig.releaseInput();
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.menuPress = isSecondaryPress(event);

    if (this.menuPress) return;
    if (event.isPrimary !== false) this.forgetPointers();

    this.pointers.add(event.pointerId);
    this.swipeFrom =
      this.paging && event.pointerType === 'touch' && this.pointers.size === 1
        ? { x: event.clientX, y: event.clientY, id: event.pointerId }
        : null;

    if (this.dragEnded) return;

    this.dispatchEvent(new Event('camera-input'));
    this.rig.cancel();

    if (!this.interactive) return;
    if (event.isPrimary !== false) this.gestures.cancel();

    this.gestures.down(this.localPoint(event));
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.gestures.move(this.localPoint(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (isSecondaryPress(event)) return;

    const at = this.localPoint(event);
    const swiped = this.swiped(event);

    this.lift(event);

    if (swiped) {
      this.gestures.cancel();

      return;
    }

    if (this.gestures.up(at) === 'tap') this.report(at, 'tap');
  };

  private swiped(event: PointerEvent): boolean {
    const from = this.swipeFrom;

    if (!from || from.id !== event.pointerId) return false;

    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;

    this.swipeFrom = null;

    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) {
      return false;
    }

    this.dispatchEvent(
      new CustomEvent<number>('page-swipe', { detail: dx < 0 ? 1 : -1 }),
    );

    return true;
  }

  private onPointerCancel = (event: PointerEvent): void => {
    this.swipeFrom = null;
    this.lift(event);
    this.gestures.cancel();
  };

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

  private onFrame = (): void => {
    this.drawnFrames += 1;
    this.fadeScreens();
    this.announceView();
  };

  private announceView = (): void => {
    this.dispatchEvent(new Event('view-change'));
  };

  private teardownScene(): void {
    const canvas = this.live?.gl.domElement;

    canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);

    for (const end of [...this.handed.values()]) end(null);

    const root = this.root;

    this.root = null;
    this.sceneState = null;
    this.paintedHome = null;
    this.paintedModel = '';
    this.meshes = null;
    this.roomFloors = null;
    this.floorsMemo = null;
    this.pieceMeshes.clear();
    this.anchors.clear();
    this.rig.forgetScene();
    this.landed = false;
    root?.unmount();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'estanza-scene-view': EstanzaSceneView;
  }
}
