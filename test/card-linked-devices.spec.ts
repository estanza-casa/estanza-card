import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import { controlKinds } from '../src/control.js';
import type { Point } from '../src/gesture.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockClimate,
  mockEntityState,
  type MockHass,
  mockSensor,
  mockSwitch,
} from './mock-hass.js';

type Piece = {
  slug: string;
  type: string;
  room?: string;
  entity?: string;
  modelId?: string;
  width?: number;
  length?: number;
  height?: number;
};

const SPOT: Point = { x: 200, y: 200 };
const FAR: Point = { x: 320, y: 320 };

let hass: MockHass;

function homeWith(props: Piece[]) {
  const draft = structuredClone(homeFixture);

  Object.assign(draft.additions, { props });

  return homeDocumentSchema.parse(draft);
}

async function mountCard(
  props: Piece[],
  bindings: SceneBinding[] = [],
): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockEntityState('media_player.living_tv', 'playing', {
        friendly_name: 'Living TV',
      }),
      mockSwitch('switch.tv_plug', true),
      mockSensor('sensor.lounge_temperature', 'temperature', 22.5, '°C'),
      mockClimate('climate.bath_radiator', { currentTemperature: 24 }),
    ],
  });
  card.hass = hass;
  card.setConfig({ type: cardType, home_document: homeWith(props), bindings });
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

function mark(card: EstanzaCard, key: string): HTMLElement | null {
  return (
    card.shadowRoot?.querySelector<HTMLElement>(`.mark[data-key="${key}"]`) ??
    null
  );
}

function leader(card: EstanzaCard, key: string): Element | null {
  return (
    card.shadowRoot?.querySelector(`.mark-leader[data-key="${key}"]`) ?? null
  );
}

function spotOf(element: HTMLElement | null): Point {
  return {
    x: parseFloat(element?.style.left ?? 'NaN'),
    y: parseFloat(element?.style.top ?? 'NaN'),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 2, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tv: Piece = { slug: 'tv', type: 'tv', room: 'living-space' };

describe('a piece linked to a device the card cannot switch', () => {
  it('marks a television linked to a media player', async () => {
    placeIn3d({ 'prop:tv': SPOT });

    const card = await mountCard(
      [tv],
      [
        {
          scope: { type: 'prop', id: 'tv' },
          entity_id: 'media_player.living_tv',
        },
      ],
    );

    expect(card.controls.get('prop:tv')?.kind).toBe('gadget');
    expect(mark(card, 'prop:tv')?.classList).toContain('gadget');
  });

  it('opens Home Assistant’s details of the television on a tap', async () => {
    placeIn3d({ 'prop:tv': SPOT });

    const card = await mountCard(
      [tv],
      [
        {
          scope: { type: 'prop', id: 'tv' },
          entity_id: 'media_player.living_tv',
        },
      ],
    );
    const opened = vi.fn();

    card.addEventListener('hass-more-info', (event) =>
      opened((event as CustomEvent).detail),
    );
    mark(card, 'prop:tv')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }),
    );
    await settle(card);

    expect(opened).toHaveBeenCalledWith({ entityId: 'media_player.living_tv' });
    expect(hass.serviceCalls).toEqual([]);
  });

  it('leaves the television unmarked when its tap and hold are set to nothing', async () => {
    placeIn3d({ 'prop:tv': SPOT });

    const card = await mountCard(
      [tv],
      [
        {
          scope: { type: 'prop', id: 'tv' },
          entity_id: 'media_player.living_tv',
          tap_action: { action: 'none' },
        },
      ],
    );

    expect(mark(card, 'prop:tv')).toBeNull();
  });
});

describe('a link made in the Estanza editor', () => {
  it('marks a piece the editor linked, with no link in the card', async () => {
    placeIn3d({ 'prop:tv': SPOT });

    const card = await mountCard([{ ...tv, entity: 'media_player.living_tv' }]);

    expect(card.controls.get('prop:tv')).toMatchObject({
      kind: 'gadget',
      entityIds: ['media_player.living_tv'],
    });
    expect(mark(card, 'prop:tv')).not.toBeNull();
  });

  it('gives way to the card’s own link for the same piece', async () => {
    const card = await mountCard(
      [{ ...tv, entity: 'media_player.living_tv' }],
      [{ scope: { type: 'prop', id: 'tv' }, entity_id: 'switch.tv_plug' }],
    );

    expect(card.controls.get('prop:tv')).toMatchObject({
      kind: 'switch',
      entityIds: ['switch.tv_plug'],
    });
  });

  it('marks an uploaded model the editor linked, like any other piece', async () => {
    placeIn3d({ 'prop:speaker': SPOT });

    const card = await mountCard([
      {
        slug: 'speaker',
        type: 'model',
        modelId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        width: 30,
        length: 30,
        height: 90,
        room: 'living-space',
        entity: 'media_player.living_tv',
      },
    ]);

    expect(card.controls.get('prop:speaker')).toMatchObject({
      kind: 'gadget',
      entityIds: ['media_player.living_tv'],
    });
    expect(mark(card, 'prop:speaker')).not.toBeNull();
  });
});

describe('a thermometer or a thermostat on a piece', () => {
  const pieces: Piece[] = [
    {
      slug: 'thermometer',
      type: 'thermometer',
      room: 'living-space',
      entity: 'sensor.lounge_temperature',
    },
    {
      slug: 'radiator',
      type: 'radiator',
      room: 'bathroom',
      entity: 'climate.bath_radiator',
    },
  ];

  it('feeds its room’s temperature and adds no mark of its own', async () => {
    const card = await mountCard(pieces);

    expect(
      card.roomTemperatures.map(({ slug, text }) => [slug, text]).sort(),
    ).toEqual([
      ['bathroom', '24.0°'],
      ['living-space', '22.5°'],
    ]);
    expect(card.controls.has('prop:thermometer')).toBe(false);
    expect(card.controls.has('prop:radiator')).toBe(false);
  });

  it('keeps its mark when it is linked to more than a temperature', async () => {
    const card = await mountCard(
      [
        {
          slug: 'radiator',
          type: 'radiator',
          room: 'bathroom',
        },
      ],
      [
        {
          scope: { type: 'prop', id: 'radiator' },
          entity_ids: ['climate.bath_radiator', 'media_player.living_tv'],
        },
      ],
    );

    expect(card.controls.get('prop:radiator')?.kind).toBe('gadget');
  });
});

describe('where the mark of a linked device sits', () => {
  const pair: Piece[] = [
    { ...tv, entity: 'media_player.living_tv' },
    {
      slug: 'speaker',
      type: 'speaker',
      room: 'living-space',
      entity: 'media_player.living_tv',
    },
  ];

  it('never takes a style meant for something else, so every mark sits where it is laid', () => {
    const rules = EstanzaCard.styles.cssText;

    for (const kind of controlKinds) {
      expect(rules, kind).not.toMatch(
        new RegExp(`(^|[\\s,(>~+}])\\.${kind}(?![\\w-])`),
      );
    }
  });

  it('stays on its piece when nothing else is there', async () => {
    placeIn3d({ 'prop:tv': SPOT, 'prop:speaker': FAR });

    const card = await mountCard(pair);

    expect(spotOf(mark(card, 'prop:tv'))).toEqual(SPOT);
    expect(spotOf(mark(card, 'prop:speaker'))).toEqual(FAR);
    expect(leader(card, 'prop:tv')).toBeNull();
  });

  it('draws a leader back to its piece when another mark pushes it away', async () => {
    placeIn3d({ 'prop:tv': SPOT, 'prop:speaker': SPOT });

    const card = await mountCard(pair);
    const moved = ['prop:tv', 'prop:speaker'].filter(
      (key) =>
        spotOf(mark(card, key)).x !== SPOT.x ||
        spotOf(mark(card, key)).y !== SPOT.y,
    );

    expect(moved).toHaveLength(1);
    expect(leader(card, moved[0])).not.toBeNull();
  });
});
