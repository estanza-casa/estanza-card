import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass, mockLight } from './mock-hass.js';

type Size = { width: number; height: number };

const PAINT_CAP = 40;
const SETTLE_BUDGET_MS = 3000;
const SPEC_TIMEOUT_MS = 60_000;
const SHEET = { width: 272, height: 480 };

const rooms = ['kitchen', 'hall', 'landing', 'bedroom'];
const bindings: SceneBinding[] = rooms.map((room) => ({
  scope: { type: 'room', id: room },
  entity_id: `light.${room}`,
}));

let stage: Size = { width: 700, height: 706 };
let paints = 0;

function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {
    font: '12px sans-serif',
    measureText(this: { font: string }, text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);

      return { width: text.length * px * 0.6 };
    },
  };

  return new Proxy(store, {
    get: (target, key) =>
      key in target
        ? target[key]
        : () => ({ addColorStop: () => undefined, width: 0 }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function sized(element: Element): boolean {
  return (
    element.classList.contains('stage') ||
    element.localName === 'estanza-plan-view'
  );
}

function planOf(card: EstanzaCard): EstanzaPlanView | null {
  return card.shadowRoot?.querySelector('estanza-plan-view') ?? null;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await planOf(card)?.updateComplete;
  }
}

async function wait(card: EstanzaCard, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(card);
}

async function mountCard(size: Size, innerWidth: number): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  stage = size;
  vi.stubGlobal('innerWidth', innerWidth);
  card.hass = createMockHass({
    states: rooms.map((room) => mockLight(`light.${room}`, { on: false })),
  });
  card.setConfig({
    type: cardType,
    home_document: aurora,
    bindings,
    tablet: false,
  });
  Object.defineProperty(card, 'clientWidth', {
    configurable: true,
    get: () => stage.width,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function press(card: EstanzaCard, selector: string): Promise<void> {
  card.shadowRoot?.querySelector<HTMLButtonElement>(selector)?.click();
  await settle(card);
}

async function allFloors(card: EstanzaCard, view: '2d' | '3d'): Promise<void> {
  await press(card, '.floors button[data-floor="all"]');

  if (view === '2d') {
    await press(card, '.views button[data-view="2d"]');
    await wait(card, VIEW_SWITCH_MS * 2);
  }
}

async function tapRoom(
  card: EstanzaCard,
  room: string,
  from: 'plan' | 'scene',
): Promise<void> {
  const surface = card.shadowRoot?.querySelector(
    from === 'plan' ? 'estanza-plan-view' : 'estanza-scene-view',
  );

  surface?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: {
        scopeType: 'room',
        scopeId: room,
        gesture: 'tap',
        x: 300,
        y: 200,
      },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

async function timed(card: EstanzaCard, act: () => Promise<void>) {
  const started = performance.now();

  paints = 0;
  await act();
  await wait(card, VIEW_SWITCH_MS * 2);
  await wait(card, 200);

  return { ms: performance.now() - started, paints };
}

beforeEach(() => {
  vi.useFakeTimers({
    now: new Date(2026, 8, 23, 20, 0),
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (kind: string) => (kind === '2d' ? fakeContext() : null) as never,
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return sized(this) ? stage.width : 0;
    },
  );
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: Element) {
      return sized(this) ? stage.height : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('sheet') ? SHEET.width : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('sheet') ? SHEET.height : 0;
    },
  );

  const paint = (
    EstanzaPlanView.prototype as unknown as {
      paint: (...args: unknown[]) => boolean;
    }
  ).paint;

  vi.spyOn(
    EstanzaPlanView.prototype as unknown as {
      paint: (...args: unknown[]) => boolean;
    },
    'paint',
  ).mockImplementation(function (this: EstanzaPlanView, ...args: unknown[]) {
    if (paints >= PAINT_CAP) return false;

    const drawn = paint.apply(this, args);

    if (drawn) paints += 1;

    return drawn;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opening a sheet on all floors', () => {
  const cases: [string, Size, string][] = [
    ['700 by 800', { width: 700, height: 706 }, 'kitchen'],
    ['820 by 1180', { width: 820, height: 1086 }, 'landing'],
    ['820 by 1180', { width: 820, height: 1086 }, 'kitchen'],
  ];

  for (const [name, size, room] of cases) {
    it(
      `settles the plan at ${name} when the ${room} name is tapped`,
      async () => {
        const card = await mountCard(size, size.width);

        await allFloors(card, '2d');

        const run = await timed(card, () => tapRoom(card, room, 'plan'));

        expect(card.shadowRoot?.querySelector('.sheet')).toBeTruthy();
        expect(run.paints).toBeLessThan(8);
        expect(run.ms).toBeLessThan(SETTLE_BUDGET_MS);
      },
      SPEC_TIMEOUT_MS,
    );
  }

  it(
    'settles the plan when a sheet opened in 3D at 820 is carried into 2D',
    async () => {
      const size = { width: 820, height: 1086 };
      const card = await mountCard(size, size.width);

      await allFloors(card, '3d');
      await tapRoom(card, 'hall', 'scene');

      const run = await timed(card, async () => {
        await press(card, '.views button[data-view="2d"]');
      });

      expect(card.shadowRoot?.querySelector('.sheet')).toBeTruthy();
      expect(run.paints).toBeLessThan(8);
      expect(run.ms).toBeLessThan(SETTLE_BUDGET_MS);
    },
    SPEC_TIMEOUT_MS,
  );

  it(
    'settles the plan when a phone with a sheet open widens to 700 by 800',
    async () => {
      const card = await mountCard({ width: 390, height: 750 }, 390);

      await allFloors(card, '2d');
      await tapRoom(card, 'kitchen', 'plan');

      const run = await timed(card, async () => {
        stage = { width: 700, height: 706 };
        vi.stubGlobal('innerWidth', 700);
        card.requestUpdate();
        planOf(card)?.requestUpdate();
        await settle(card);
      });

      expect(run.paints).toBeLessThan(8);
      expect(run.ms).toBeLessThan(SETTLE_BUDGET_MS);
    },
    SPEC_TIMEOUT_MS,
  );
});
