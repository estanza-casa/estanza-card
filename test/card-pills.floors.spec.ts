import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import { covered, LABEL_HEIGHT, labelWidth } from '../src/living.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaSceneView, type RoomFootprint } from '../src/scene-view.js';
import { drawPlansAt } from './drawn-plan.js';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass, mockSensor } from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const PILL_SETTLE_MS = 150;

const rooms: Record<string, Point> = {
  hall: { x: 120, y: 300 },
  bedroom: { x: 300, y: 120 },
  cellar: { x: 480, y: 420 },
};

const bindings: SceneBinding[] = Object.keys(rooms).map((room) => ({
  scope: { type: 'room', id: room },
  temperature_entity_id: `sensor.${room}_temperature`,
}));

function anchorsOf(slugs: readonly string[]): Map<string, Point> {
  return new Map(
    slugs.flatMap((slug) => (rooms[slug] ? [[slug, rooms[slug]]] : [])),
  );
}

function footprintsOf(slugs: readonly string[]): Map<string, RoomFootprint> {
  return new Map(
    slugs.flatMap((slug) => {
      const centre = rooms[slug];

      if (!centre) return [];

      const floor = [
        { x: centre.x - 70, y: centre.y - 60 },
        { x: centre.x + 70, y: centre.y - 60 },
        { x: centre.x + 70, y: centre.y + 60 },
        { x: centre.x - 70, y: centre.y + 60 },
      ];

      return [[slug, { floor, top: floor }]];
    }),
  );
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
  }
}

async function mountCard(): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  card.hass = createMockHass({
    states: Object.keys(rooms).map((room) =>
      mockSensor(`sensor.${room}_temperature`, 'temperature', 20, '°C'),
    ),
  });
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    bindings,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function choose(card: EstanzaCard, floor: string): Promise<void> {
  card.shadowRoot
    ?.querySelector<HTMLButtonElement>(`.floors button[data-floor="${floor}"]`)
    ?.click();
  await settle(card);
  await vi.advanceTimersByTimeAsync(PILL_SETTLE_MS);
  await settle(card);
}

async function point(
  card: EstanzaCard,
  type: 'pointermove' | 'pointerleave',
  pointerType = 'mouse',
  buttons = 0,
): Promise<void> {
  const event = new MouseEvent(type, {
    bubbles: true,
    composed: true,
    clientX: 300,
    clientY: 120,
    buttons,
  });

  Object.defineProperty(event, 'pointerType', { value: pointerType });
  card.shadowRoot?.querySelector('.stage')?.dispatchEvent(event);
  await settle(card);
}

function pills(card: EstanzaCard): string[] {
  return [
    ...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? []),
  ].map((pill) => pill.dataset.room ?? '');
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 25, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
    anchorsOf,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'roomFootprints').mockImplementation(
    footprintsOf,
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('temperatures on the pulled apart house', () => {
  it('shows the pills of every storey at rest in 3D, with no pointer over the card', async () => {
    const card = await mountCard();

    await choose(card, 'all');

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar', 'hall']);
  });

  it('keeps every storey on show after a finger touches and lifts', async () => {
    const card = await mountCard();

    await choose(card, 'all');
    await point(card, 'pointermove', 'touch');
    await point(card, 'pointerleave', 'touch');

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar', 'hall']);
  });

  it('keeps every storey on show when the mouse moves over the card and leaves it', async () => {
    const card = await mountCard();

    await choose(card, 'all');
    await point(card, 'pointermove');

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar', 'hall']);

    await point(card, 'pointerleave');

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar', 'hall']);
  });

  it('keeps a pill off a balcony drawn over its room', async () => {
    const landing = { x: 120, y: 300, width: 48, height: 40 };

    vi.spyOn(EstanzaSceneView.prototype, 'balconyBoxes').mockReturnValue([
      landing,
    ]);

    const card = await mountCard();

    await choose(card, 'f1');

    const pill = card.shadowRoot?.querySelector<HTMLElement>('.temp');
    const box = {
      x: parseFloat(pill?.style.left ?? 'NaN'),
      y: parseFloat(pill?.style.top ?? 'NaN'),
      width: labelWidth(pill?.textContent?.trim() ?? ''),
      height: LABEL_HEIGHT,
    };

    expect(pill?.dataset.room).toBe('hall');
    expect(covered(box, [landing])).toBe(false);
  });

  it('shows every pill of a single storey without a pointer', async () => {
    const card = await mountCard();

    await choose(card, 'f1');

    expect(pills(card)).toEqual(['hall']);
  });

  it('groups a storey whose pills have no room, and never shows a part of it', async () => {
    vi.spyOn(EstanzaSceneView.prototype, 'balconyBoxes').mockReturnValue([
      { x: 120, y: 300, width: 1000, height: 1000 },
    ]);

    const card = await mountCard();

    await choose(card, 'all');

    expect(pills(card)).toEqual([]);
  });

  it('groups a storey whose pill loses its room between two camera moves', async () => {
    const card = await mountCard();

    await choose(card, 'all');

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar', 'hall']);

    vi.spyOn(EstanzaSceneView.prototype, 'balconyBoxes').mockReturnValue([
      { x: 120, y: 300, width: 300, height: 300 },
    ]);
    card.requestUpdate();
    await settle(card);

    expect(pills(card).sort()).toEqual(['bedroom', 'cellar']);
  });

  it('keeps a grouped storey grouped until the house is drawn clearly bigger', async () => {
    const blocked = vi
      .spyOn(EstanzaSceneView.prototype, 'balconyBoxes')
      .mockReturnValue([{ x: 120, y: 300, width: 1000, height: 1000 }]);
    const card = await mountCard();

    await choose(card, 'f1');

    expect(pills(card)).toEqual([]);

    blocked.mockReturnValue([]);
    await choose(card, 'all');
    await choose(card, 'f1');

    expect(pills(card)).toEqual([]);

    vi.spyOn(EstanzaSceneView.prototype, 'roomFootprints').mockImplementation(
      (slugs) =>
        new Map(
          [...footprintsOf(slugs)].map(([slug, print]) => [
            slug,
            {
              floor: print.floor.map((at) => ({
                x: at.x * 1.3,
                y: at.y * 1.3,
              })),
              top: print.top.map((at) => ({ x: at.x * 1.3, y: at.y * 1.3 })),
            },
          ]),
        ),
    );
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) =>
        new Map(
          [...anchorsOf(slugs)].map(([slug, at]) => [
            slug,
            { x: at.x * 1.3, y: at.y * 1.3 },
          ]),
        ),
    );
    card.requestUpdate();
    await settle(card);
    await vi.advanceTimersByTimeAsync(PILL_SETTLE_MS * 4);
    await settle(card);

    expect(pills(card)).toEqual(['hall']);
  });

  it('shows the pills of the next storey on the plan as soon as the switch settles', async () => {
    drawPlansAt({ width: 800, height: 600 });

    const card = await mountCard();

    await choose(card, 'f1');
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.views button[data-view="2d"]')
      ?.click();

    for (let step = 0; step < 3; step += 1) {
      await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
      await settle(card);
    }

    expect(pills(card)).toEqual(['hall']);

    await choose(card, 'ufloor');

    expect(pills(card)).toEqual(['bedroom']);
  });
});
