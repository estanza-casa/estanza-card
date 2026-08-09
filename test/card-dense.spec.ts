import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import { TOUCH_PX } from '../src/mark-layout.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import denseFixture from './fixtures/dense-home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockCover,
  mockLight,
  mockSensor,
} from './mock-hass.js';

type Vec = { x: number; y: number };

const home = homeDocumentSchema.parse(denseFixture);
const floor = denseFixture.plan.floors[0];

function wallPoint(wallId: string, position: number): Vec {
  const wall = floor.walls.find((entry) => entry.id === wallId);

  if (!wall) throw new Error(`no wall ${wallId}`);

  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * position,
    y: wall.start.y + (wall.end.y - wall.start.y) * position,
  };
}

function roomCentre(slug: string): Vec {
  const id = Object.entries(denseFixture.rooms).find(
    ([, room]) => room.slug === slug,
  )?.[0];
  const room = floor.rooms.find((entry) => entry.id === id);
  const ends = (room?.walls ?? []).flatMap((wallId) => [
    wallPoint(wallId, 0),
    wallPoint(wallId, 1),
  ]);

  return {
    x: ends.reduce((sum, end) => sum + end.x, 0) / ends.length,
    y: ends.reduce((sum, end) => sum + end.y, 0) / ends.length,
  };
}

function project({ x, y }: Vec): Point {
  return { x: 20 + x * 0.32, y: 160 + y * 0.18 };
}

const lights = denseFixture.additions.lights.map((light) => ({
  scope: { type: 'light', id: light.slug } as SceneScope,
  at: project(
    'at' in light && Array.isArray(light.at)
      ? { x: light.at[0], y: light.at[1] }
      : roomCentre(light.room),
  ),
  entity: `light.${light.slug.replaceAll('-', '_')}`,
}));
const doors = floor.doors.map((door) => ({
  scope: { type: 'door', id: door.id } as SceneScope,
  at: project(wallPoint(door.wallId, door.position)),
  entity: `cover.${door.id.replaceAll('-', '_')}`,
}));
const things = [...lights, ...doors];
const rooms = Object.values(denseFixture.rooms).map((room) => room.slug);
const temperatureOf = (slug: string): string =>
  `sensor.${slug.replaceAll('-', '_')}_temperature`;

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
  }
}

async function mountDense(): Promise<EstanzaCard> {
  const anchors = new Map(
    things.map((thing) => [scopeKey(thing.scope), thing.at]),
  );

  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
    (scope) => anchors.get(scopeKey(scope)) ?? null,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
  );

  const card = document.createElement('estanza-card');
  const bindings: SceneBinding[] = [
    ...things.map((thing) => ({
      scope: thing.scope,
      entity_id: thing.entity,
    })),
    ...rooms.map((slug) => ({
      scope: { type: 'room' as const, id: slug },
      temperature_entity_id: temperatureOf(slug),
    })),
  ];

  card.hass = createMockHass({
    states: [
      ...lights.map((light) => mockLight(light.entity, { on: false })),
      ...doors.map((door) => mockCover(door.entity, 0)),
      ...rooms.map((slug) =>
        mockSensor(temperatureOf(slug), 'temperature', 20, '°C'),
      ),
    ],
  });
  card.setConfig({ type: cardType, home_document: home, bindings });
  document.body.append(card);
  await settle(card);

  return card;
}

function sceneOf(card: EstanzaCard): EstanzaSceneView {
  const scene = card.shadowRoot?.querySelector('estanza-scene-view');

  if (!scene) throw new Error('no scene');

  Object.assign(scene, {
    sceneState: {
      size: { width: 390, height: 400 },
      camera: new PerspectiveCamera(),
      gl: {},
      scene: {
        children: [],
        updateMatrixWorld: () => undefined,
        traverse: () => undefined,
      },
      raycaster: {
        setFromCamera: () => undefined,
        intersectObjects: () => [],
      },
      get() {
        return this;
      },
    },
  });

  return scene;
}

function spotOf(element: Element): Point {
  const style = (element as HTMLElement).style;

  return { x: parseFloat(style.left), y: parseFloat(style.top) };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 24, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the marks of a dense home at phone width', () => {
  it('crowds its marks closer than a finger before they are laid out', () => {
    const crowded = things.some((one) =>
      things.some(
        (other) =>
          one !== other &&
          Math.abs(one.at.x - other.at.x) < TOUCH_PX &&
          Math.abs(one.at.y - other.at.y) < TOUCH_PX,
      ),
    );

    expect(crowded).toBe(true);
  });

  it('never lets two of its marks other than shut doors overlap', async () => {
    const card = await mountDense();
    const shown = [
      ...(card.shadowRoot?.querySelectorAll('.mark:not(.dot), .bubble') ?? []),
    ].map(spotOf);

    expect(card.shadowRoot?.querySelector('.mark.dot')).not.toBeNull();

    for (const [index, one] of shown.entries()) {
      for (const other of shown.slice(index + 1)) {
        expect(
          Math.abs(one.x - other.x) >= TOUCH_PX - 0.01 ||
            Math.abs(one.y - other.y) >= TOUCH_PX - 0.01,
        ).toBe(true);
      }
    }
  });

  it('picks every shown door and light where its mark is drawn', async () => {
    const card = await mountDense();
    const marks = [...(card.shadowRoot?.querySelectorAll('.mark') ?? [])];
    const scene = sceneOf(card);

    expect(marks.length).toBeGreaterThan(0);

    for (const mark of marks) {
      const picked = scene.pickAt(spotOf(mark));

      expect(picked ? scopeKey(picked) : null).toBe(
        (mark as HTMLElement).dataset.key,
      );
    }
  });

  it('gives no shut door a leader or a bubble of its own', async () => {
    const card = await mountDense();
    const root = card.shadowRoot;
    const doorKeys = new Set(doors.map((door) => scopeKey(door.scope)));
    const leaders = [
      ...(root?.querySelectorAll<HTMLElement>('.mark-leader') ?? []),
    ].map((leader) => leader.dataset.key);

    expect(leaders.filter((key) => doorKeys.has(key ?? ''))).toEqual([]);

    for (const bubble of root?.querySelectorAll<HTMLElement>('.bubble') ?? []) {
      bubble.click();
      await settle(card);

      const members = [
        ...(root?.querySelectorAll<HTMLElement>('.sheet.chooser .choice') ??
          []),
      ].map((choice) => choice.dataset.key ?? '');

      expect(
        members.some((key) => !doorKeys.has(key)),
        members.join(),
      ).toBe(true);
      root
        ?.querySelector<HTMLElement>(
          '.sheet.chooser button[aria-label="Close"]',
        )
        ?.click();
      await settle(card);
    }
  });

  it('reaches every light through its own mark or a bubble, and every shut door through its mark, a bubble or its room sheet', async () => {
    const card = await mountDense();
    const root = card.shadowRoot;
    const reached = new Set(
      [...(root?.querySelectorAll<HTMLElement>('.mark') ?? [])].map(
        (mark) => mark.dataset.key,
      ),
    );
    const bubbles = [
      ...(root?.querySelectorAll<HTMLElement>('.bubble') ?? []),
    ].map((bubble) => bubble.dataset.key);

    for (const key of bubbles) {
      root?.querySelector<HTMLElement>(`.bubble[data-key="${key}"]`)?.click();
      await settle(card);

      for (const choice of root?.querySelectorAll<HTMLElement>(
        '.sheet.chooser .choice:not([disabled])',
      ) ?? []) {
        reached.add(choice.dataset.key);
      }

      root
        ?.querySelector<HTMLElement>(
          '.sheet.chooser button[aria-label="Close"]',
        )
        ?.click();
      await settle(card);
    }

    for (const slug of rooms) {
      root?.querySelector('estanza-scene-view')?.dispatchEvent(
        new CustomEvent('scope-select', {
          detail: {
            scopeType: 'room',
            scopeId: slug,
            gesture: 'press',
            x: 20,
            y: 20,
          },
        }),
      );
      await settle(card);

      for (const row of root?.querySelectorAll<HTMLElement>(
        '.sheet .row[data-key]',
      ) ?? []) {
        reached.add(row.dataset.key);
      }

      root
        ?.querySelector<HTMLElement>('.sheet button[aria-label="Close"]')
        ?.click();
      await settle(card);
    }

    for (const thing of things) {
      expect(reached.has(scopeKey(thing.scope)), scopeKey(thing.scope)).toBe(
        true,
      );
    }
  });
});
