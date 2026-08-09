import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { CONFIRM_GAP_MS, LOCK_CONFIRM_MS } from '../src/control.js';
import type { Point } from '../src/gesture.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockCover,
  type MockHass,
  mockLock,
} from './mock-hass.js';

const LOCK_AT = { x: 120, y: 200 };
const GARAGE_AT = { x: 280, y: 200 };
const LOCK = 'door:d1';
const GARAGE = 'door:d2';

const bindings: SceneBinding[] = [
  { scope: { type: 'door', id: 'd1' }, entity_id: 'lock.door_d1' },
  { scope: { type: 'door', id: 'd2' }, entity_id: 'cover.door_d2' },
];

type MountOptions = { lock?: string; garage?: number };

let hass: MockHass;

async function mountCard(options: MountOptions = {}): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLock('lock.door_d1', options.lock ?? 'locked'),
      mockCover('cover.door_d2', options.garage ?? 0),
    ],
  });
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: homeDocumentSchema.parse(structuredClone(homeFixture)),
    bindings,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
  }
}

function placeIn3d(where: Record<string, Point>): void {
  const at = (scope: SceneScope): Point | null =>
    Object.hasOwn(where, scopeKey(scope)) ? where[scopeKey(scope)] : null;

  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(at);
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
  );
}

function markOf(card: EstanzaCard, key: string): HTMLElement | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(`.mark[data-key="${key}"]`) ??
    null
  );
}

function pointer(
  element: HTMLElement | null,
  type: string,
  pointerType: string,
): void {
  const box = element?.style;

  element?.dispatchEvent(
    Object.assign(
      new MouseEvent(type, {
        clientX: parseFloat(box?.left ?? '0'),
        clientY: parseFloat(box?.top ?? '0'),
        bubbles: true,
        composed: true,
      }),
      { pointerType, isPrimary: true, pointerId: 1 },
    ),
  );
}

function click(element: HTMLElement | null): void {
  element?.dispatchEvent(
    new MouseEvent('click', {
      clientX: parseFloat(element.style.left),
      clientY: parseFloat(element.style.top),
      bubbles: true,
      composed: true,
      detail: 1,
    }),
  );
}

async function touchTap(card: EstanzaCard, key: string): Promise<void> {
  pointer(markOf(card, key), 'pointerdown', 'touch');
  pointer(markOf(card, key), 'pointerup', 'touch');
  await settle(card);
}

async function touchTapWithClick(
  card: EstanzaCard,
  key: string,
): Promise<void> {
  await touchTap(card, key);
  vi.advanceTimersByTime(50);
  click(markOf(card, key));
  await settle(card);
}

async function mouseClick(card: EstanzaCard, key: string): Promise<void> {
  pointer(markOf(card, key), 'pointerdown', 'mouse');
  pointer(markOf(card, key), 'pointerup', 'mouse');
  await settle(card);
  click(markOf(card, key));
  await settle(card);
}

function services(): string[] {
  return hass.serviceCalls.map((call) => `${call.domain}.${call.service}`);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 24, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  placeIn3d({ [LOCK]: LOCK_AT, [GARAGE]: GARAGE_AT });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('unlocking a door by touch', () => {
  it('only arms on a single touch tap', async () => {
    const card = await mountCard();

    await touchTap(card, LOCK);

    expect(services()).toEqual([]);
    expect(markOf(card, LOCK)?.classList).toContain('armed');
  });

  it('only arms on a touch tap followed by the click the browser adds to it', async () => {
    const card = await mountCard();

    await touchTapWithClick(card, LOCK);

    expect(services()).toEqual([]);
    expect(markOf(card, LOCK)?.classList).toContain('armed');
  });

  it('unlocks on a second touch tap after the pause and before the bar drains', async () => {
    const card = await mountCard();

    await touchTapWithClick(card, LOCK);
    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await touchTapWithClick(card, LOCK);

    expect(services()).toEqual(['lock.unlock']);
  });

  it('never unlocks on a second tap once the bar has drained', async () => {
    const card = await mountCard();

    await touchTapWithClick(card, LOCK);
    vi.advanceTimersByTime(LOCK_CONFIRM_MS);
    await settle(card);
    await touchTapWithClick(card, LOCK);

    expect(services()).toEqual([]);
    expect(markOf(card, LOCK)?.classList).toContain('armed');
  });
});

describe('unlocking a door with a mouse', () => {
  it('never unlocks on a double click under the pause', async () => {
    const card = await mountCard();

    await mouseClick(card, LOCK);
    vi.advanceTimersByTime(150);
    await mouseClick(card, LOCK);

    expect(services()).toEqual([]);
    expect(markOf(card, LOCK)?.classList).toContain('armed');
  });

  it('never unlocks on three clicks 150 ms apart', async () => {
    const card = await mountCard();

    await mouseClick(card, LOCK);
    vi.advanceTimersByTime(150);
    await mouseClick(card, LOCK);
    vi.advanceTimersByTime(150);
    await mouseClick(card, LOCK);

    expect(services()).toEqual([]);
  });

  it('unlocks on a deliberate second click', async () => {
    const card = await mountCard();

    await mouseClick(card, LOCK);
    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await mouseClick(card, LOCK);

    expect(services()).toEqual(['lock.unlock']);
  });
});

describe('the mark of a locked door on the house', () => {
  it('shows its padlock while shut, where a door without a lock is a dot', async () => {
    const card = await mountCard();

    expect(markOf(card, LOCK)?.classList).toContain('locked');
    expect(markOf(card, LOCK)?.classList).not.toContain('dot');
    expect(markOf(card, GARAGE)?.classList).toContain('dot');
  });

  it('turns to the open padlock when the door is unlocked', async () => {
    const card = await mountCard();

    hass.setState('lock.door_d1', 'unlocked');
    card.hass = { ...hass };
    await settle(card);

    expect(markOf(card, LOCK)?.classList).toContain('unlocked');
    expect(markOf(card, LOCK)?.classList).not.toContain('dot');
  });
});

describe('locking a door', () => {
  it('locks on one tap, with no confirm', async () => {
    const card = await mountCard({ lock: 'unlocked' });

    await touchTapWithClick(card, LOCK);

    expect(services()).toEqual(['lock.lock']);
  });
});

describe('a burst of taps', () => {
  async function burst(card: EstanzaCard, keys: string[], gap: number) {
    for (const key of keys) {
      pointer(markOf(card, key), 'pointerdown', 'touch');
      pointer(markOf(card, key), 'pointerup', 'touch');
      click(markOf(card, key));
      await settle(card);
      vi.advanceTimersByTime(gap);
    }
  }

  it('counts taps under 150 ms apart on one mark as one tap', async () => {
    const card = await mountCard({ garage: 100 });

    await burst(card, [GARAGE, GARAGE, GARAGE, GARAGE, GARAGE, GARAGE], 90);

    expect(services()).toEqual(['cover.toggle']);
  });

  it('lets the next mark in a fast burst act on nothing', async () => {
    const card = await mountCard({ garage: 100, lock: 'unlocked' });

    await burst(card, [LOCK, GARAGE, LOCK, GARAGE], 90);

    expect(services()).toEqual(['lock.lock']);
  });

  it('still pages on a swipe that starts straight after a tap', async () => {
    const card = await mountCard({ garage: 100 });
    const view = card.shadowRoot?.querySelector('estanza-scene-view');
    const stage = view?.shadowRoot?.querySelector<HTMLElement>('.stage');
    const paged = vi.fn();
    const touch = (type: string, x: number): Event =>
      Object.assign(
        new MouseEvent(type, {
          clientX: x,
          clientY: 60,
          bubbles: true,
          composed: true,
        }),
        { pointerType: 'touch', isPrimary: true, pointerId: 2 },
      );

    if (view) view.paging = true;
    view?.addEventListener('page-swipe', paged);
    await burst(card, [GARAGE], 90);
    stage?.dispatchEvent(touch('pointerdown', 150));
    stage?.dispatchEvent(touch('pointerup', 50));

    expect(stage).not.toBeNull();
    expect(paged).toHaveBeenCalledTimes(1);
  });

  it('lets a drag that starts on a mark in a burst turn the camera', async () => {
    const card = await mountCard({ garage: 100 });
    const view = card.shadowRoot?.querySelector('estanza-scene-view');
    const orbit = vi.spyOn(view as EstanzaSceneView, 'orbitFrom');
    const mark = markOf(card, GARAGE);
    const at = (type: string, dx: number): Event =>
      Object.assign(
        new MouseEvent(type, {
          clientX: GARAGE_AT.x + dx,
          clientY: GARAGE_AT.y,
          bubbles: true,
          composed: true,
        }),
        { pointerType: 'touch', isPrimary: true, pointerId: 3 },
      );

    await burst(card, [GARAGE], 90);
    mark?.dispatchEvent(at('pointerdown', 0));
    mark?.dispatchEvent(at('pointermove', 60));

    expect(orbit).toHaveBeenCalled();
  });

  it('takes a tap again once 150 ms have passed since the last one', async () => {
    const card = await mountCard({ garage: 100, lock: 'unlocked' });

    await burst(card, [LOCK], 150);
    await burst(card, [GARAGE], 0);

    expect(services()).toEqual(['lock.lock', 'cover.toggle']);
  });
});

describe('a garage door', () => {
  it('only arms on a single touch tap while it is shut', async () => {
    const card = await mountCard();

    await touchTapWithClick(card, GARAGE);

    expect(services()).toEqual([]);
    expect(markOf(card, GARAGE)?.classList).toContain('armed');
    expect(markOf(card, GARAGE)?.getAttribute('aria-label')).toMatch(/^Open /);
  });

  it('opens on a deliberate second tap', async () => {
    const card = await mountCard();

    await touchTapWithClick(card, GARAGE);
    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await touchTapWithClick(card, GARAGE);

    expect(services()).toEqual(['cover.toggle']);
  });

  it('never opens on a mouse double click under the pause', async () => {
    const card = await mountCard();

    await mouseClick(card, GARAGE);
    vi.advanceTimersByTime(150);
    await mouseClick(card, GARAGE);

    expect(services()).toEqual([]);
  });

  it('closes on one tap, with no confirm', async () => {
    const card = await mountCard({ garage: 100 });

    await touchTapWithClick(card, GARAGE);

    expect(services()).toEqual(['cover.toggle']);
  });
});
