import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import { EstanzaSceneView, type RoomFootprint } from '../src/scene-view.js';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass, mockLight } from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

type Band = { top: number; bottom: number };

const GLYPH_HALF_PX = 16;

const lights = [
  'living-space-light',
  'bathroom-light',
  'hall-light',
  'cellar-light',
  'bedroom-light',
];

const floorOfRoom: Record<string, string> = {
  'living-space': 'f1',
  bathroom: 'f1',
  hall: 'f1',
  cellar: 'bfloor',
  bedroom: 'ufloor',
};

const bindings: SceneBinding[] = lights.map((slug) => ({
  scope: { type: 'light', id: slug },
  entity_id: `light.${slug.replaceAll('-', '_')}`,
}));

const stacked: Record<string, Band> = {
  ufloor: { top: 100, bottom: 200 },
  f1: { top: 140, bottom: 240 },
  bfloor: { top: 180, bottom: 280 },
};

const apart: Record<string, Band> = {
  ufloor: { top: 20, bottom: 100 },
  f1: { top: 140, bottom: 240 },
  bfloor: { top: 300, bottom: 380 },
};

const stackedLights: Record<string, Point> = {
  'light:living-space-light': { x: 140, y: 170 },
  'light:bathroom-light': { x: 220, y: 175 },
  'light:hall-light': { x: 270, y: 180 },
  'light:cellar-light': { x: 200, y: 215 },
  'light:bedroom-light': { x: 200, y: 130 },
};

const apartLights: Record<string, Point> = {
  'light:living-space-light': { x: 140, y: 170 },
  'light:bathroom-light': { x: 220, y: 175 },
  'light:hall-light': { x: 270, y: 210 },
  'light:cellar-light': { x: 200, y: 340 },
  'light:bedroom-light': { x: 200, y: 60 },
};

function drawFloors(bands: Record<string, Band>): void {
  vi.spyOn(EstanzaSceneView.prototype, 'roomFootprints').mockImplementation(
    (slugs) =>
      new Map(
        slugs.flatMap((slug): [string, RoomFootprint][] => {
          const band = bands[floorOfRoom[slug] ?? ''];

          if (!band) return [];

          const floor = [
            { x: 100, y: band.top },
            { x: 300, y: band.top },
            { x: 300, y: band.bottom },
            { x: 100, y: band.bottom },
          ];

          return [[slug, { floor, top: floor }]];
        }),
      ),
  );
}

function placeIn3d(where: Record<string, Point>): void {
  const at = (scope: SceneScope): Point | null =>
    Object.hasOwn(where, scopeKey(scope)) ? where[scopeKey(scope)] : null;

  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(at);
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
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
    states: lights.map((slug) =>
      mockLight(`light.${slug.replaceAll('-', '_')}`, { on: false }),
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

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function all(card: EstanzaCard, selector: string): HTMLElement[] {
  return [...(card.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}

function shownMarks(card: EstanzaCard): string[] {
  return all(card, '.mark:not(.under)')
    .map((mark) => mark.dataset.key ?? '')
    .sort();
}

async function choose(card: EstanzaCard, floor: string): Promise<void> {
  find(card, `.floors button[data-floor="${floor}"]`)?.click();
  await settle(card);
}

async function allFloors(card: EstanzaCard): Promise<void> {
  if (find(card, '.floors button[data-floor="all"]')?.ariaPressed !== 'true') {
    await choose(card, 'all');
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 17, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marks on all floors of a tall home', () => {
  it('folds a storey whose marks fall on the floor above into one mark with a count', async () => {
    drawFloors(stacked);
    placeIn3d(stackedLights);

    const card = await mountCard();

    await allFloors(card);

    expect(shownMarks(card)).toEqual(['light:bedroom-light']);
    expect(
      find(card, '.bubble[data-key="floor:f1"]')?.textContent?.trim(),
    ).toBe('3');
    expect(
      find(card, '.bubble[data-key="floor:bfloor"]')?.textContent?.trim(),
    ).toBe('1');
    expect(
      find(card, '.bubble[data-key="floor:f1"]')?.getAttribute('aria-label'),
    ).toBe('Ground floor, 3 lights');
  });

  it('keeps the top storey drawn mark by mark, since no floor lies over it', async () => {
    drawFloors(stacked);
    placeIn3d(stackedLights);

    const card = await mountCard();

    await allFloors(card);

    expect(find(card, '.bubble[data-key="floor:ufloor"]')).toBeNull();
  });

  it('opens the storey of a folded mark when it is tapped', async () => {
    drawFloors(stacked);
    placeIn3d(stackedLights);

    const card = await mountCard();

    await allFloors(card);
    find(card, '.bubble[data-key="floor:f1"]')?.click();
    await settle(card);

    expect(
      find(card, '.floors button[data-floor="f1"]')?.getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(find(card, '.sheet.chooser')).toBeNull();
    expect(shownMarks(card)).toEqual([
      'light:bathroom-light',
      'light:hall-light',
      'light:living-space-light',
    ]);
  });

  it('leaves every mark of storeys that stand apart where it is', async () => {
    drawFloors(apart);
    placeIn3d(apartLights);

    const card = await mountCard();

    await allFloors(card);

    expect(all(card, '.bubble')).toEqual([]);
    expect(shownMarks(card)).toEqual(
      [...lights.map((slug) => `light:${slug}`)].sort(),
    );
  });

  it('never folds the marks of a single storey shown on its own', async () => {
    drawFloors(stacked);
    placeIn3d(stackedLights);

    const card = await mountCard();

    await choose(card, 'f1');

    expect(all(card, '.bubble')).toEqual([]);
    expect(shownMarks(card)).toEqual([
      'light:bathroom-light',
      'light:hall-light',
      'light:living-space-light',
    ]);
  });
});

describe('marks under the open floor picker', () => {
  it('draws no mark over the floor picker while it is open', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    drawFloors(apart);
    placeIn3d(apartLights);

    const picker = new DOMRect(0, 100, 400, 400);
    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const open =
          this.classList.contains('floors') &&
          !this.querySelector('[data-floor="chip"]');

        return open ? picker : real.call(this);
      },
    );

    const card = await mountCard();

    await choose(card, 'chip');
    await choose(card, 'f1');

    expect(shownMarks(card)).toContain('light:hall-light');

    await choose(card, 'chip');

    expect(find(card, '.floors [data-floor="all"]')).not.toBeNull();
    expect(
      all(card, '.mark:not(.under), .bubble:not(.under)')
        .filter((mark) => {
          const x = parseFloat(mark.style.left);
          const y = parseFloat(mark.style.top);

          return (
            x + GLYPH_HALF_PX > picker.left &&
            x - GLYPH_HALF_PX < picker.right &&
            y + GLYPH_HALF_PX > picker.top &&
            y - GLYPH_HALF_PX < picker.bottom
          );
        })
        .map((mark) => mark.dataset.key),
    ).toEqual([]);

    await choose(card, 'f1');

    expect(shownMarks(card)).toContain('light:hall-light');
  });

  it('draws no mark or leader for a thing the open floor picker covers, even moved clear of it', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    drawFloors(apart);
    placeIn3d(apartLights);

    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const open =
          this.classList.contains('floors') &&
          !this.querySelector('[data-floor="chip"]');

        return open ? new DOMRect(0, 150, 400, 300) : real.call(this);
      },
    );

    const card = await mountCard();

    await choose(card, 'chip');
    await choose(card, 'f1');
    await choose(card, 'chip');

    expect(shownMarks(card)).toEqual([]);
    expect(all(card, '.mark-leader')).toEqual([]);
  });
});
