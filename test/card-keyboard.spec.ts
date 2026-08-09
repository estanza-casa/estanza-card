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
import { CONFIRM_GAP_MS } from '../src/control.js';
import { LONG_PRESS_MS, type Point } from '../src/gesture.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockCover,
  type MockHass,
  mockLock,
} from './mock-hass.js';

const LOCK = 'door:d1';
const GARAGE = 'door:d2';

const bindings: SceneBinding[] = [
  { scope: { type: 'door', id: 'd1' }, entity_id: 'lock.door_d1' },
  { scope: { type: 'door', id: 'd2' }, entity_id: 'cover.door_d2' },
];

let hass: MockHass;

async function mountCard(): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [mockLock('lock.door_d1', 'locked'), mockCover('cover.door_d2', 0)],
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

async function enter(card: EstanzaCard, key: string): Promise<void> {
  markOf(card, key)?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }),
  );
  await settle(card);
}

async function hold(card: EstanzaCard, key: string): Promise<void> {
  markOf(card, key)?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

async function escape(card: EstanzaCard): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle(card);
}

async function tab(
  card: EstanzaCard,
  from: HTMLElement | null,
  shiftKey = false,
): Promise<void> {
  from?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

function focused(card: EstanzaCard): Element | null {
  return card.shadowRoot?.activeElement ?? null;
}

function services(): string[] {
  return hass.serviceCalls.map((call) => `${call.domain}.${call.service}`);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 24, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  placeIn3d({ [LOCK]: { x: 120, y: 200 }, [GARAGE]: { x: 280, y: 100 } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the marks under a keyboard', () => {
  it('puts every mark in the Tab order, top to bottom', async () => {
    const card = await mountCard();
    const marks = [
      ...(card.shadowRoot?.querySelectorAll<HTMLButtonElement>('.mark') ?? []),
    ];

    expect(marks.map((mark) => mark.dataset.key)).toEqual([GARAGE, LOCK]);
    expect(marks.every((mark) => mark.tabIndex === 0)).toBe(true);
  });

  it('opens a garage on Enter only after a deliberate second Enter', async () => {
    const card = await mountCard();

    await enter(card, GARAGE);

    expect(services()).toEqual([]);
    expect(markOf(card, GARAGE)?.classList).toContain('armed');

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await enter(card, GARAGE);

    expect(services()).toEqual(['cover.toggle']);
  });

  it('cancels an armed confirm on Escape and clears its bar', async () => {
    const card = await mountCard();

    await enter(card, GARAGE);
    await escape(card);

    expect(markOf(card, GARAGE)?.classList).not.toContain('armed');
    expect(card.shadowRoot?.querySelector('.drain')).toBeNull();

    vi.advanceTimersByTime(CONFIRM_GAP_MS);
    await enter(card, GARAGE);

    expect(services()).toEqual([]);
  });

  it('never acts on the click a pointer tap adds', async () => {
    const card = await mountCard();

    markOf(card, GARAGE)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }),
    );
    await settle(card);

    expect(markOf(card, GARAGE)?.classList).not.toContain('armed');
  });
});

describe('a sheet opened from the keyboard', () => {
  it('takes the focus when it opens and hands it back to the mark when it closes', async () => {
    const card = await mountCard();

    markOf(card, GARAGE)?.focus();
    await hold(card, GARAGE);

    expect(focused(card)?.closest('.sheet')).not.toBeNull();

    await escape(card);

    expect(card.shadowRoot?.querySelector('.sheet')).toBeNull();
    expect(focused(card)).toBe(markOf(card, GARAGE));
  });

  it('keeps Tab inside the open sheet, round from its last control to its first and back', async () => {
    const card = await mountCard();

    markOf(card, GARAGE)?.focus();
    await hold(card, GARAGE);

    const stops = [
      ...(card.shadowRoot?.querySelectorAll<HTMLElement>(
        '.sheets :is(button, input)',
      ) ?? []),
    ];
    const first = stops[0];
    const last = stops[stops.length - 1];

    expect(stops.length).toBeGreaterThan(1);

    last.focus();
    await tab(card, last);

    expect(focused(card)).toBe(first);

    await tab(card, first, true);

    expect(focused(card)).toBe(last);
  });

  it('stays open when Escape closes a more-info dialog above the card', async () => {
    const card = await mountCard();
    const dialog = document.createElement('ha-more-info-dialog');

    document.body.append(dialog);
    markOf(card, GARAGE)?.focus();
    await hold(card, GARAGE);
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);

    expect(card.shadowRoot?.querySelector('.sheet')).not.toBeNull();
  });

  it('brings a stray focus back into the open sheet on Tab', async () => {
    const card = await mountCard();

    markOf(card, GARAGE)?.focus();
    await hold(card, GARAGE);

    const mark = markOf(card, LOCK);

    mark?.focus();
    await tab(card, mark);

    expect(focused(card)?.closest('.sheet')).not.toBeNull();
  });

  it('leaves the focus where it was when a pointer opens the sheet', async () => {
    const card = await mountCard();
    const mark = markOf(card, GARAGE);
    const at = {
      clientX: parseFloat(mark?.style.left ?? '0'),
      clientY: parseFloat(mark?.style.top ?? '0'),
    };

    mark?.dispatchEvent(
      Object.assign(
        new MouseEvent('pointerdown', { ...at, bubbles: true, composed: true }),
        { pointerType: 'mouse', isPrimary: true, pointerId: 1 },
      ),
    );
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    await settle(card);

    expect(card.shadowRoot?.querySelector('.sheet')).not.toBeNull();
    expect(focused(card)).toBeNull();
  });

  it('draws no focus ring where a mouse moved the focus, and draws it again on the next key', async () => {
    const card = await mountCard();
    const mark = markOf(card, GARAGE);
    const moves = vi.spyOn(HTMLElement.prototype, 'focus');

    mark?.focus();
    mark?.dispatchEvent(
      Object.assign(
        new MouseEvent('pointerdown', {
          clientX: parseFloat(mark.style.left),
          clientY: parseFloat(mark.style.top),
          bubbles: true,
          composed: true,
        }),
        { pointerType: 'mouse', isPrimary: true, pointerId: 1 },
      ),
    );
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    await settle(card);

    expect(focused(card)?.closest('.sheet')).not.toBeNull();
    expect(moves).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusVisible: false }),
    );
    expect(card.hasAttribute('data-pointer-focus')).toBe(true);

    await tab(card, focused(card) as HTMLElement);

    expect(card.hasAttribute('data-pointer-focus')).toBe(false);
  });

  it('asks for a focus ring when a key opened the sheet', async () => {
    const card = await mountCard();
    const moves = vi.spyOn(HTMLElement.prototype, 'focus');

    markOf(card, GARAGE)?.focus();
    await hold(card, GARAGE);

    expect(moves).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusVisible: true }),
    );
    expect(card.hasAttribute('data-pointer-focus')).toBe(false);
  });
});
