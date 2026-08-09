import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { EstanzaSceneView, REVALIDATE_MS } from '../src/scene-view.js';
import {
  BURN_IN_EVERY_MS,
  BURN_IN_SHIFT_MS,
  burnInPlace,
  controlDrift,
  framingOf,
  IDLE_RETURN_MS,
  LATE_EXPOSURE,
  REFRAME_WAIT_MS,
} from '../src/tablet.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createHouseHass,
  createMockHass,
  type MockHass,
  mockLight,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const IDLE_MS = 45_000;

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
];

type Watched = { callback: ResizeObserverCallback; target: Element };

let watched: Watched[] = [];
let hass: MockHass;

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    watched.push({ callback: this.callback, target });
  }

  unobserve(): void {
    return;
  }

  disconnect(): void {
    watched = watched.filter((entry) => entry.callback !== this.callback);
  }
}

function resize(card: EstanzaCard, width: number, height: number): void {
  for (const entry of watched.filter((item) => item.target === card)) {
    entry.callback(
      [
        {
          target: card,
          contentRect: { width, height },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  }
}

async function mountCard(
  layout: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({ states: [mockLight('light.living', { on: true })] });
  card.hass = hass;
  card.layout = layout;
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    bindings,
    ...extra,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await sceneOf(card)?.updateComplete;
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(card);
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

async function touch(card: EstanzaCard): Promise<void> {
  card.dispatchEvent(
    new Event('pointerdown', { bubbles: true, composed: true }),
  );
  await settle(card);
}

async function choose(card: EstanzaCard, floor: string): Promise<void> {
  await touch(card);
  card.shadowRoot
    ?.querySelector<HTMLButtonElement>(`.floors button[data-floor="${floor}"]`)
    ?.click();
  await settle(card);
}

async function openSheet(card: EstanzaCard): Promise<void> {
  await touch(card);
  sceneOf(card)?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: {
        scopeType: 'light',
        scopeId: 'living-space-light',
        gesture: 'press',
        x: 200,
        y: 150,
      },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

function sheet(card: EstanzaCard): Element | null {
  return card.shadowRoot?.querySelector('.sheet') ?? null;
}

let goHome: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  watched = [];
  goHome = vi.spyOn(EstanzaSceneView.prototype, 'goHome');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('choosing wall tablet mode', () => {
  it('becomes a wall tablet in a panel view', async () => {
    const card = await mountCard('panel');

    expect(card.hasAttribute('tablet')).toBe(true);
  });

  it('stays a card in a sections grid', async () => {
    const card = await mountCard('grid');

    expect(card.hasAttribute('tablet')).toBe(false);
  });

  it('follows tablet on and off over the view it sits in', async () => {
    expect(
      (await mountCard('grid', { tablet: 'on' })).hasAttribute('tablet'),
    ).toBe(true);
    expect(
      (await mountCard('panel', { tablet: 'off' })).hasAttribute('tablet'),
    ).toBe(false);
  });

  it('gives the scene the larger targets a finger on a wall needs', async () => {
    const tablet = await mountCard('panel');
    const card = await mountCard('grid');

    expect(sceneOf(tablet)?.targetRadius).toBe(28);
    expect(sceneOf(card)?.targetRadius).toBe(22);
  });
});

describe('the tablet layout', () => {
  it('stays landscape on a wide screen, with the house filling the middle', async () => {
    const card = await mountCard('panel');

    resize(card, 1280, 800);
    await settle(card);

    expect(card.hasAttribute('portrait')).toBe(false);
    expect(sceneOf(card)?.framing).toEqual(framingOf(true, 'landscape'));
  });

  it('goes portrait on a tall screen and lifts the house into the top two thirds', async () => {
    const card = await mountCard('panel');

    resize(card, 800, 1280);
    await settle(card);

    expect(card.hasAttribute('portrait')).toBe(true);
    expect(sceneOf(card)?.framing).toEqual(framingOf(true, 'portrait'));
  });

  it('fits the house of a card that is not a tablet without raising or zooming it', async () => {
    const card = await mountCard('grid');

    resize(card, 400, 900);
    await settle(card);

    expect(sceneOf(card)?.framing).toEqual({
      raise: 0,
      zoom: 1,
      house: true,
    });
  });
});

describe('the idle return', () => {
  it('closes an open sheet 45 seconds after the last touch, not before', async () => {
    const card = await mountCard('panel');

    await openSheet(card);
    await wait(card, IDLE_MS - 1);

    expect(sheet(card)).not.toBeNull();

    await wait(card, 1);

    expect(sheet(card)).toBeNull();
  });

  it('starts counting again at every touch', async () => {
    const card = await mountCard('panel');

    await openSheet(card);
    await wait(card, IDLE_MS - 1000);
    await touch(card);
    await wait(card, IDLE_MS - 1);

    expect(sheet(card)).not.toBeNull();
  });

  it('eases the camera home at once when the floor has not moved', async () => {
    const card = await mountCard('panel');

    await touch(card);
    await wait(card, IDLE_MS);

    expect(goHome).toHaveBeenCalledOnce();
    expect(goHome).toHaveBeenCalledWith(burnInPlace(0), IDLE_RETURN_MS);
  });

  it('puts the floor back to its default, then eases home once the storeys have moved', async () => {
    const card = await mountCard('panel');

    await choose(card, 'bfloor');
    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.floor).toBe('f1');
    expect(goHome).not.toHaveBeenCalled();

    await wait(card, REFRAME_WAIT_MS);

    expect(goHome).toHaveBeenCalledWith(burnInPlace(0), IDLE_RETURN_MS);
  });

  it('returns from the basement after a pick that came as a click alone, as a screen reader sends it', async () => {
    const card = await mountCard('panel');

    await touch(card);
    await wait(card, IDLE_MS);
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('.floors button[data-floor="bfloor"]')
      ?.click();
    await settle(card);
    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.floor).toBe('f1');
  });

  it('keeps the floor a reader chose for the next time the card opens', async () => {
    const card = await mountCard('panel');

    await choose(card, 'f1');
    await wait(card, IDLE_MS);
    card.remove();

    const again = await mountCard('panel');

    expect(sceneOf(again)?.floor).toBe('f1');
  });

  it('waits the configured idle time', async () => {
    const card = await mountCard('panel', { idle_seconds: 5 });

    await openSheet(card);
    await wait(card, 5000);

    expect(sheet(card)).toBeNull();
  });

  it('leaves a card that is not a tablet alone', async () => {
    const card = await mountCard('grid');

    await openSheet(card);
    await wait(card, IDLE_MS * 2);

    expect(sheet(card)).not.toBeNull();
    expect(goHome).not.toHaveBeenCalled();
  });

  it('holds the floor and the camera of a critical alert', async () => {
    const card = await mountCard('panel');

    card.idleHold = { floor: 'bfloor' };
    await choose(card, 'bfloor');
    await wait(card, IDLE_MS + REFRAME_WAIT_MS);

    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(goHome).not.toHaveBeenCalled();
  });

  it('stops counting once the card leaves the page', async () => {
    const card = await mountCard('panel');

    card.remove();
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2 + BURN_IN_EVERY_MS);

    expect(goHome).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a home republished while the tablet is on the wall', () => {
  function tagged(document: unknown, etag: string): Response {
    return new Response(
      JSON.stringify({ home: { name: 'Home', document, watermark: false } }),
      { status: 200, headers: { etag } },
    );
  }

  it('swaps in without moving the floor, the camera, a sheet or the idle clock', async () => {
    const first = threeStoreyHome();
    const next = threeStoreyHome();

    next.additions.lights = next.additions.lights.slice(1);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(tagged(first, '"v1"'))
        .mockResolvedValueOnce(tagged(next, '"v2"')),
    );

    const card = document.createElement('estanza-card');

    card.hass = createMockHass({
      states: [mockLight('light.living', { on: true })],
    });
    card.layout = 'panel';
    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings,
      idle_seconds: 600,
    });
    document.body.append(card);
    await wait(card, 0);
    await choose(card, 'bfloor');
    await openSheet(card);

    const swapped = sceneOf(card)?.sharedHome;

    await wait(card, REVALIDATE_MS);

    expect(sceneOf(card)?.sharedHome).not.toBe(swapped);
    expect(sceneOf(card)?.sceneStatus).toBe('ready');
    expect(sceneOf(card)?.floor).toBe('bfloor');
    expect(sheet(card)).not.toBeNull();
    expect(goHome).not.toHaveBeenCalled();
  });

  it('keeps an open sheet open and the idle clock running across the swap', async () => {
    const first = threeStoreyHome();
    const next = threeStoreyHome();

    next.additions.lights = next.additions.lights.slice(1);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(tagged(first, '"v1"'))
        .mockResolvedValueOnce(tagged(next, '"v2"')),
    );

    const card = document.createElement('estanza-card');

    card.hass = createMockHass({
      states: [mockLight('light.living', { on: true })],
    });
    card.layout = 'panel';
    card.setConfig({ type: cardType, share_id: 'abc123', bindings });
    document.body.append(card);
    await wait(card, REVALIDATE_MS - IDLE_MS + 5_000);
    await openSheet(card);
    await wait(card, IDLE_MS - 5_000);

    expect(sheet(card)).not.toBeNull();

    await wait(card, 5_000);

    expect(sheet(card)).toBeNull();
  });
});

describe('burn-in', () => {
  it('eases to the next home position every 15 minutes while idle, over 3 seconds', async () => {
    const card = await mountCard('panel');

    await wait(card, BURN_IN_EVERY_MS);

    expect(goHome).toHaveBeenLastCalledWith(burnInPlace(1), BURN_IN_SHIFT_MS);

    await wait(card, BURN_IN_EVERY_MS);

    expect(goHome).toHaveBeenLastCalledWith(burnInPlace(2), BURN_IN_SHIFT_MS);
  });

  it('moves nothing between the quarter hours', async () => {
    const card = await mountCard('panel');

    await wait(card, IDLE_MS);
    goHome.mockClear();
    await wait(card, BURN_IN_EVERY_MS - IDLE_MS - 1);

    expect(goHome).not.toHaveBeenCalled();
  });

  it('moves the floating controls with the house', async () => {
    const card = await mountCard('panel');

    await wait(card, BURN_IN_EVERY_MS);

    const stage = card.shadowRoot?.querySelector<HTMLElement>('.stage');
    const drift = controlDrift(burnInPlace(1));

    expect(stage?.style.getPropertyValue('--ez-drift-x')).toBe(`${drift.x}px`);
    expect(stage?.style.getPropertyValue('--ez-drift-y')).toBe(`${drift.y}px`);
  });

  it('never shifts under a reader, and takes the new position at the next idle return', async () => {
    const card = await mountCard('panel');

    await wait(card, BURN_IN_EVERY_MS - 10_000);
    await touch(card);
    goHome.mockClear();
    await wait(card, 10_000);

    expect(goHome).not.toHaveBeenCalled();

    await wait(card, IDLE_MS);

    expect(goHome).toHaveBeenCalledWith(burnInPlace(1), IDLE_RETURN_MS);
  });
});

describe('late night', () => {
  async function roomCard(
    extra: Record<string, unknown> = {},
  ): Promise<EstanzaCard> {
    const card = document.createElement('estanza-card');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      (slugs) => new Map(slugs.map((slug) => [slug, { x: 200, y: 150 }])),
    );
    card.hass = createHouseHass();
    card.layout = 'panel';
    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
      ],
      ...extra,
    });
    document.body.append(card);
    await settle(card);

    return card;
  }

  function temperatures(card: EstanzaCard): number {
    return card.shadowRoot?.querySelectorAll('.temp').length ?? 0;
  }

  it('keeps full exposure and the temperatures before 23:00', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 22, 0));

    const card = await roomCard();

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(1);
    expect(temperatures(card)).toBe(1);
  });

  it('drops the exposure and hides the temperatures once idle after 23:00', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 22, 59));

    const card = await roomCard();

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(1);

    await wait(card, 60_000);

    expect(sceneOf(card)?.exposure).toBe(LATE_EXPOSURE);
    expect(temperatures(card)).toBe(0);
  });

  it('comes back to full the moment someone touches the tablet', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 23, 30));

    const card = await roomCard();

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(LATE_EXPOSURE);

    await touch(card);

    expect(sceneOf(card)?.exposure).toBe(1);
    expect(temperatures(card)).toBe(1);
  });

  it('is not late night while someone is using the tablet', async () => {
    vi.setSystemTime(new Date(2026, 8, 24, 1, 0));

    const card = await roomCard();

    expect(sceneOf(card)?.exposure).toBe(1);
  });

  it('ends at six in the morning', async () => {
    vi.setSystemTime(new Date(2026, 8, 24, 5, 50));

    const card = await roomCard();

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(LATE_EXPOSURE);

    await wait(card, 10 * 60_000);

    expect(sceneOf(card)?.exposure).toBe(1);
  });

  it('follows a configured start', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 22, 0));

    const card = await roomCard({ late_night: '21:30' });

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(LATE_EXPOSURE);
  });

  it('can be switched off', async () => {
    vi.setSystemTime(new Date(2026, 8, 23, 23, 30));

    const card = await roomCard({ late_night: 'off' });

    await wait(card, IDLE_MS);

    expect(sceneOf(card)?.exposure).toBe(1);
    expect(temperatures(card)).toBe(1);
  });
});
