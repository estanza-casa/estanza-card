import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType, type SceneBinding } from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import type { Point } from '../src/gesture.js';
import { LABEL_HEIGHT, TABLET_LABEL_HEIGHT } from '../src/living.js';
import { TOUCH_PX } from '../src/mark-layout.js';
import { VIEW_SWITCH_MS } from '../src/plan.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView, type RoomFootprint } from '../src/scene-view.js';
import { temperatureStyles } from '../src/temperature-view.js';
import { drawPlansAt } from './drawn-plan.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  type MockHass,
  mockLight,
  mockSensor,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const rooms: Record<string, { x: number; y: number }> = {
  hall: { x: 100, y: 150 },
  bathroom: { x: 400, y: 150 },
};

const bindings: SceneBinding[] = [
  {
    scope: { type: 'room', id: 'hall' },
    entity_id: 'light.hall',
    temperature_entity_id: 'sensor.hall_temperature',
  },
  {
    scope: { type: 'room', id: 'bathroom' },
    temperature_entity_id: 'sensor.bath_temperature',
  },
];

let hass: MockHass;

function anchorsOf(slugs: readonly string[]): Map<string, Point> {
  return new Map(
    slugs.flatMap((slug) => (rooms[slug] ? [[slug, rooms[slug]]] : [])),
  );
}

function roomsOf(
  halfWidth: number,
  halfHeight: number,
): (slugs: readonly string[]) => Map<string, RoomFootprint> {
  return (slugs) =>
    new Map(
      slugs.flatMap((slug) => {
        const centre = rooms[slug];

        if (!centre) return [];

        const floor = [
          { x: centre.x - halfWidth, y: centre.y - halfHeight },
          { x: centre.x + halfWidth, y: centre.y - halfHeight },
          { x: centre.x + halfWidth, y: centre.y + halfHeight },
          { x: centre.x - halfWidth, y: centre.y + halfHeight },
        ];

        return [[slug, { floor, top: floor }]];
      }),
    );
}

async function readHall(card: EstanzaCard, degrees: number): Promise<void> {
  hass.states['sensor.hall_temperature'] = mockSensor(
    'sensor.hall_temperature',
    'temperature',
    degrees,
    '°C',
  );
  card.hass = { ...hass };
  await settle(card);
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
    await card.shadowRoot?.querySelector('estanza-plan-view')?.updateComplete;
  }
}

async function mountCard(
  extra: Record<string, unknown> = {},
  roomBindings: SceneBinding[] = bindings,
  view: '2d' | '3d' = '2d',
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.hall', { on: false }),
      mockSensor('sensor.hall_temperature', 'temperature', 20, '°C'),
      mockSensor('sensor.bath_temperature', 'temperature', 31, '°C'),
    ],
  });
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    bindings: roomBindings,
    ...extra,
  });
  document.body.append(card);
  await settle(card);

  if (view === '3d') return card;

  card.shadowRoot
    ?.querySelector<HTMLButtonElement>('.views button[data-view="2d"]')
    ?.click();
  await settle(card);

  for (let step = 0; step < 2; step += 1) {
    await vi.advanceTimersByTimeAsync(VIEW_SWITCH_MS);
    await settle(card);
  }

  return card;
}

function pillOf(card: EstanzaCard, room: string): HTMLElement | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(`.temp[data-room="${room}"]`) ??
    null
  );
}

async function tap(card: EstanzaCard, target: Element | null): Promise<void> {
  target?.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, composed: true }),
  );
  target?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }),
  );
  await settle(card);
}

function sheetOf(card: EstanzaCard): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>('.sheet') ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 25, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  drawPlansAt({ width: 800, height: 600 });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the format of a temperature pill', () => {
  it('draws every pill as its reading alone, an outlier included', async () => {
    const card = await mountCard();
    const pills = [
      ...(card.shadowRoot?.querySelectorAll<HTMLElement>('.temp') ?? []),
    ];

    expect(pills.map((pill) => pill.dataset.room).sort()).toEqual([
      'bathroom',
      'hall',
    ]);
    expect(card.roomTemperatures.map((reading) => reading.flag)).toContain(
      'hot',
    );

    for (const pill of pills) {
      expect(pill.querySelector('.icon, svg')).toBeNull();
    }

    expect(pillOf(card, 'bathroom')?.textContent?.trim()).toBe('31.0°');
    expect(pillOf(card, 'hall')?.textContent?.trim()).toBe('20.0°');
  });

  it('keeps the decimal in a plan too small for a name above its pill', async () => {
    drawPlansAt({ width: 240, height: 180 });

    const card = await mountCard();

    await readHall(card, 20.6);

    expect(pillOf(card, 'hall')?.textContent?.trim()).toMatch(/ 20\.6°$/);
  });

  it('shows the same label for a room at every camera angle', async () => {
    vi.spyOn(EstanzaSceneView.prototype, 'roomAnchors').mockImplementation(
      anchorsOf,
    );

    const footprints = vi
      .spyOn(EstanzaSceneView.prototype, 'roomFootprints')
      .mockImplementation(roomsOf(90, 90));
    const card = await mountCard({}, bindings, '3d');

    await readHall(card, 20.6);

    const facing = pillOf(card, 'hall')?.textContent?.trim();

    footprints.mockImplementation(roomsOf(22, 14));
    card.shadowRoot
      ?.querySelector('estanza-scene-view')
      ?.dispatchEvent(new CustomEvent('view-change'));
    await settle(card);

    expect(facing).toBe('20.6°');
    expect(pillOf(card, 'hall')?.textContent?.trim()).toBe(facing);
  });
});

describe('a tap on a temperature pill', () => {
  it('opens the room sheet from anywhere on the pill', async () => {
    const card = await mountCard();

    await tap(card, pillOf(card, 'bathroom'));

    expect(sheetOf(card)?.dataset.kind).toBe('room');
    expect(sheetOf(card)?.textContent).toContain('31');
  });

  it('opens the room sheet from the face drawn inside the pill', async () => {
    const card = await mountCard();

    await tap(card, pillOf(card, 'hall')?.querySelector('.face') ?? null);

    expect(sheetOf(card)?.dataset.kind).toBe('room');
    expect(sheetOf(card)?.textContent).toContain('20');
  });

  it('opens the pill whose face is under the finger when a neighbour touch area reaches over it', async () => {
    const card = await mountCard();
    const face = pillOf(card, 'bathroom')?.querySelector('.face');
    const hall = pillOf(card, 'hall');

    if (!face || !hall) throw new Error('no pills');

    vi.spyOn(face, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(40, 40, 40, 20),
    );
    hall.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        composed: true,
        clientX: 60,
        clientY: 50,
      }),
    );
    hall.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }),
    );
    await settle(card);

    expect(sheetOf(card)?.textContent).toContain('31');
  });

  it('opens the room sheet even when a tap on the room is set to switch its lights', async () => {
    const card = await mountCard({}, [
      {
        ...bindings[0],
        tap_action: { action: 'toggle' },
      },
      bindings[1],
    ]);

    await tap(card, pillOf(card, 'hall'));

    expect(sheetOf(card)?.dataset.kind).toBe('room');
    expect(hass.serviceCalls).toEqual([]);
  });

  it('names the pill for the room it opens', async () => {
    const card = await mountCard();
    const pill = pillOf(card, 'bathroom');

    expect(pill?.localName).toBe('button');
    expect(pill?.getAttribute('aria-label')).toMatch(/31\.0°/);
  });

  it('opens nothing on a read-only card', async () => {
    const card = await mountCard({ interaction: 'none' });

    await tap(card, pillOf(card, 'bathroom'));

    expect(sheetOf(card)).toBeNull();
    expect(pillOf(card, 'bathroom')?.localName).not.toBe('button');
  });
});

describe('the pill of the room whose sheet is open', () => {
  function spotOf(pill: HTMLElement | null): string[] {
    return [pill?.style.left ?? '', pill?.style.top ?? ''];
  }

  it('stays where it was, drawn selected, after a tap on it', async () => {
    const card = await mountCard();
    const before = spotOf(pillOf(card, 'bathroom'));

    await tap(card, pillOf(card, 'bathroom'));

    const pill = pillOf(card, 'bathroom');

    expect(spotOf(pill)).toEqual(before);
    expect(pill?.classList).toContain('selected');
    expect(pill?.getAttribute('aria-expanded')).toBe('true');
    expect(pillOf(card, 'hall')?.classList).not.toContain('selected');
    expect(pillOf(card, 'hall')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('stays when the sheet covers its room, while another covered room gives its pill up', async () => {
    vi.stubGlobal('innerWidth', 390);

    const card = await mountCard();
    const before = spotOf(pillOf(card, 'bathroom'));
    const real = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('sheet')
          ? new DOMRect(0, 0, 800, 600)
          : real.call(this);
      },
    );
    await tap(card, pillOf(card, 'bathroom'));
    await settle(card);

    expect(spotOf(pillOf(card, 'bathroom'))).toEqual(before);
    expect(pillOf(card, 'bathroom')?.classList).toContain('selected');
    expect(pillOf(card, 'hall')).toBeNull();
  });

  it('draws the selected ring the other selected controls use', () => {
    const selected = temperatureStyles.cssText.match(
      /\.temp\.selected \.face \{([^}]*)\}/,
    );

    expect(selected?.[1]).toMatch(/box-shadow:[^;]*var\(--ez-chosen\)/);
  });
});

describe('the target of a temperature pill', () => {
  function blocks(selector: string, css: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return [
      ...css.matchAll(new RegExp(`(?:^|[\\s}])${escaped} \\{([^}]*)\\}`, 'g')),
    ].map((match) => match[1]);
  }

  function sizes(selector: string, css: string): string[] {
    return blocks(selector, css).flatMap((block) =>
      [...block.matchAll(/(?:^|\s)((?:min-)?(?:height|width)): ([^;]+);/g)].map(
        (match) => `${match[1]}: ${match[2]}`,
      ),
    );
  }

  const css = temperatureStyles.cssText;
  const [fine, coarse = ''] = css.split('@media (pointer: coarse)');

  it(`grows its target to ${TOUCH_PX}px each way under a finger, unless a neighbour needs the room`, () => {
    const reach = `min(0px, calc((100% - ${TOUCH_PX}px) / 2))`;

    expect(sizes('.temp', coarse)).toEqual([]);
    expect(blocks('button.temp::before', coarse).join(' ')).toContain(
      `inset: var(--hit-t, ${reach}) var(--hit-r, ${reach})`,
    );
    expect(blocks('button.temp::before', fine).join(' ')).toContain(
      'inset: var(--hit-t, 0px)',
    );
  });

  it('keeps the drawn pill its own size under a finger', () => {
    expect(sizes('.temp .face', fine)).toContain(`height: ${LABEL_HEIGHT}px`);
    expect(sizes('.temp .face', coarse)).toEqual([]);
  });
});

describe('the size of a temperature pill on a large plan', () => {
  it('draws the large pill for a tag the plan sets large', async () => {
    const tagLabels = EstanzaPlanView.prototype.tagLabels;

    vi.spyOn(EstanzaPlanView.prototype, 'tagLabels').mockImplementation(
      function (this: EstanzaPlanView) {
        return tagLabels
          .call(this)
          .map((tag) => ({ ...tag, kind: 'large' as const }));
      },
    );

    const card = await mountCard();

    expect(pillOf(card, 'hall')?.classList).toContain('large');
    expect(card.hasAttribute('large-pills')).toBe(false);
  });

  it('keeps the usual pill on a plan at the phone panel size', async () => {
    drawPlansAt({ width: 390, height: 300 });

    const card = await mountCard();

    expect(pillOf(card, 'hall')?.classList).not.toContain('large');
  });

  it(`sets a large pill ${TABLET_LABEL_HEIGHT}px tall with 15px text`, () => {
    const block = temperatureStyles.cssText.match(
      /\.temp\.large \.face \{([^}]*)\}/,
    );

    expect(block?.[1]).toContain(`height: ${TABLET_LABEL_HEIGHT}px`);
    expect(block?.[1]).toContain('font-size: 15px');
  });
});
