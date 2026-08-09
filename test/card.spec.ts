import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  defaultApiOrigin,
  defaultModelsOrigin,
} from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import type { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import {
  createHouseHass,
  createMockHass,
  mockEntityState,
  mockLight,
} from './mock-hass.js';

function createCard(): EstanzaCard {
  return document.createElement('estanza-card');
}

function houseCard(): EstanzaCard {
  const card = createCard();

  card.hass = createHouseHass();

  return card;
}

async function mountCard(card: EstanzaCard): Promise<EstanzaCard> {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  document.body.append(card);
  await card.updateComplete;

  return card;
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('estanza-card registration', () => {
  it('defines the custom element', () => {
    expect(customElements.get('estanza-card')).toBe(EstanzaCard);
  });

  it('defines the editor element', () => {
    expect(customElements.get('estanza-card-editor')).toBeDefined();
  });

  it('defines the scene element', () => {
    expect(customElements.get('estanza-scene-view')).toBeDefined();
  });

  it('announces itself to the dashboard card picker', () => {
    const entry = window.customCards?.find(
      (card) => card.type === 'estanza-card',
    );

    expect(entry?.name).toBeTruthy();
  });

  it('goes by one word, so the editor title Home Assistant builds from it fits a phone', () => {
    const entry = window.customCards?.find(
      (card) => card.type === 'estanza-card',
    );

    expect(entry?.name).toBe('Estanza');
  });

  it('asks the card picker to show it live, drawn from its stub as the calm no-home face', async () => {
    const entry = window.customCards?.find(
      (card) => card.type === 'estanza-card',
    );
    const card = createCard();

    card.setConfig(EstanzaCard.getStubConfig());
    document.body.append(card);
    await card.updateComplete;

    expect(entry?.preview).toBe(true);
    expect(card.shadowRoot?.querySelector('.face.no-home')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).toBeNull();

    card.remove();
  });

  it('offers a config element to the visual editor', () => {
    expect(EstanzaCard.getConfigElement().tagName.toLowerCase()).toBe(
      'estanza-card-editor',
    );
  });

  it('offers a stub config carrying the card type', () => {
    expect(EstanzaCard.getStubConfig().type).toBe(cardType);
  });

  it('offers a stub config the card itself accepts', () => {
    expect(() =>
      createCard().setConfig(EstanzaCard.getStubConfig()),
    ).not.toThrow();
  });
});

describe('estanza-card configuration', () => {
  it('carries no share until one is configured', () => {
    const card = createCard();

    card.setConfig({ type: cardType });

    expect(card.shareId).toBe('');
  });

  it('takes the share id straight from the config', () => {
    const card = createCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });

    expect(card.shareId).toBe('abc123');
  });

  it('reads the share id out of a pasted estanza share link', () => {
    const card = createCard();

    card.setConfig({
      type: cardType,
      share_url: 'https://estanza.casa/share/abc123',
    });

    expect(card.shareId).toBe('abc123');
  });

  it('reads the estanza api from the public origin by default', () => {
    const card = createCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });

    expect(card.apiOrigin).toBe(defaultApiOrigin);
  });

  it('honours a self hosted api origin', () => {
    const card = createCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      api_origin: 'http://homeassistant.local:8930',
    });

    expect(card.apiOrigin).toBe('http://homeassistant.local:8930');
  });

  it('reads the catalog models from the public webapp by default', () => {
    const card = createCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });

    expect(card.modelsOrigin).toBe(defaultModelsOrigin);
  });

  it('honours a self hosted models origin', () => {
    const card = createCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      models_origin: 'http://homeassistant.local:8080',
    });

    expect(card.modelsOrigin).toBe('http://homeassistant.local:8080');
  });

  it('reports a grid size for the sections view', () => {
    expect(createCard().getGridOptions().columns).toBe(12);
  });

  it('asks the sections view for room to show a home', () => {
    expect(createCard().getGridOptions()).toEqual({
      rows: 8,
      columns: 12,
      min_rows: 2,
      min_columns: 6,
    });
  });

  it('counts the title in its masonry height', () => {
    const plain = createCard();
    const titled = createCard();

    plain.setConfig({ type: cardType });
    titled.setConfig({ type: cardType, title: 'Ground floor' });

    expect(plain.getCardSize()).toBe(6);
    expect(titled.getCardSize()).toBe(7);
  });
});

describe('estanza-card sizing', () => {
  function hostRules(): string {
    return EstanzaCard.styles.cssText.replace(/\s+/g, ' ');
  }

  it('fills the height its dashboard gives it', () => {
    expect(hostRules()).toMatch(/:host \{ display: block; height: 100%;/);
  });

  it('sets its own sans font instead of taking the page one', () => {
    expect(hostRules()).toMatch(/:host \{[^}]*font-family:[^}]*sans-serif/);
  });

  it('keeps the 4:3 shape in a sections cell whose height is not set', () => {
    expect(hostRules()).not.toMatch(
      /layout='grid'\][^{]*\.stage \{[^}]*aspect-ratio: auto/,
    );
  });

  it('lets the scene shrink to a panel or a sections cell', () => {
    expect(hostRules()).toContain(
      ":host([layout='panel']) estanza-scene-view, :host([layout='grid']) estanza-scene-view { min-height: 0; }",
    );
  });

  it('gives the scene its own shape in a masonry column', () => {
    expect(hostRules()).toMatch(/ \.stage \{[^}]*aspect-ratio: 4 \/ 3;/);
  });

  it('shows the layout it was placed in', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });
    card.layout = 'panel';
    await mountCard(card);

    expect(card.getAttribute('layout')).toBe('panel');
  });
});

describe('estanza-card scene overlay', () => {
  it('carries no overlay without a hass object', () => {
    const card = createCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });

    expect(card.overlay).toEqual({
      lights: {},
      rooms: {},
      doors: {},
      windows: {},
    });
  });

  it('lights a bound room when a light in its area is on', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
      ],
    });

    expect(card.overlay.rooms.kitchen?.on).toBe(true);
  });

  it('ignores a motion sensor when deciding a room is lit', () => {
    const card = createCard();

    card.hass = createMockHass({
      states: [
        mockLight('light.bedroom_ceiling', { on: false }),
        mockEntityState('binary_sensor.bedroom_motion', 'on', {
          device_class: 'motion',
        }),
      ],
      entities: [
        { entity_id: 'light.bedroom_ceiling', area_id: 'bedroom' },
        { entity_id: 'binary_sensor.bedroom_motion', area_id: 'bedroom' },
      ],
      areas: [{ area_id: 'bedroom', name: 'Bedroom' }],
    });

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'bedroom' }, area_id: 'bedroom' },
      ],
    });

    expect(card.overlay.rooms.bedroom?.on).toBe(false);
  });

  it('leaves a room dark when its area holds no light at all', () => {
    const card = createCard();

    card.hass = createMockHass({
      states: [
        mockEntityState('binary_sensor.hall_motion', 'on', {
          device_class: 'motion',
        }),
      ],
      entities: [{ entity_id: 'binary_sensor.hall_motion', area_id: 'hall' }],
      areas: [{ area_id: 'hall', name: 'Hall' }],
    });

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [{ scope: { type: 'room', id: 'hall' }, area_id: 'hall' }],
    });

    expect(card.overlay.rooms.hall?.on).toBe(false);
  });

  it('reads the colour and brightness of a bound light', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'kitchen-strip' },
          entity_id: 'light.kitchen_strip',
        },
      ],
    });

    expect(card.overlay.lights['kitchen-strip']).toEqual({
      on: true,
      brightness: 90 / 255,
      color: '#ff6ea8',
    });
  });

  it('follows the light that is on when a room holds several', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'room', id: 'kitchen' },
          entity_ids: ['light.bedroom_ceiling', 'light.kitchen_strip'],
        },
      ],
    });

    expect(card.overlay.rooms.kitchen?.color).toBe('#ff6ea8');
  });

  it('leaves a light dark when its entity is unavailable', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'hall-light' },
          entity_id: 'light.hall_ceiling',
        },
      ],
    });

    expect(card.overlay.lights['hall-light']?.on).toBe(false);
  });

  it('opens a bound door when its sensor reads open', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'door', id: 'front-door' },
          entity_id: 'binary_sensor.front_door',
        },
      ],
    });

    expect(card.overlay.doors['front-door']).toBe(1);
  });

  it('opens a bound door part way from a cover position', () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'door', id: 'garage-door' },
          entity_id: 'cover.garage',
        },
      ],
    });

    expect(card.overlay.doors['garage-door']).toBeCloseTo(0.6);
  });

  function windowCard(entityId: string): EstanzaCard {
    const card = createCard();
    const hass = createHouseHass();

    hass.setState('binary_sensor.kitchen_window', 'on');
    hass.setState('cover.skylight', 'open', {
      device_class: 'window',
      current_position: 40,
    });
    hass.setState('cover.study_window', 'open', { device_class: 'window' });
    card.hass = hass;
    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'window', id: 'win1' }, entity_id: entityId },
      ],
    });

    return card;
  }

  it('opens a bound window when its sensor reads open', () => {
    const card = windowCard('binary_sensor.kitchen_window');

    expect(card.overlay.windows.win1).toBe(1);
  });

  it('opens a bound window from a door sensor fitted to it', () => {
    const card = windowCard('binary_sensor.front_door');

    expect(card.overlay.windows.win1).toBe(1);
  });

  it('opens a bound window part way from a window cover position', () => {
    const card = windowCard('cover.skylight');

    expect(card.overlay.windows.win1).toBeCloseTo(0.4);
  });

  it('opens a bound window all the way from a cover with no position', () => {
    const card = windowCard('cover.study_window');

    expect(card.overlay.windows.win1).toBe(1);
  });

  it('leaves the doors alone when only a window is bound', () => {
    const card = windowCard('binary_sensor.kitchen_window');

    expect(card.overlay.doors).toEqual({});
  });
});

describe('estanza-card temperatures on the floors', () => {
  function roomCard(extra: Record<string, unknown> = {}): EstanzaCard {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
        { scope: { type: 'room', id: 'bedroom' }, area_id: 'bedroom' },
        { scope: { type: 'room', id: 'garage' }, area_id: 'garage' },
      ],
      ...extra,
    });

    return card;
  }

  it('reads each room with a thermometer as a number and a degree', () => {
    expect(roomCard().roomTemperatures).toEqual([
      {
        slug: 'kitchen',
        text: '21.4°',
        band: 'comfort',
        flag: null,
      },
      {
        slug: 'bedroom',
        text: '18.9°',
        band: 'comfort',
        flag: null,
      },
    ]);
  });

  it('gives every room the same precision once one reading needs a decimal', () => {
    const card = roomCard();
    const hass = createHouseHass();

    hass.setState('sensor.kitchen_temperature', '19');
    card.hass = hass;

    expect(card.roomTemperatures.map((reading) => reading.text)).toEqual([
      '19.0°',
      '18.9°',
    ]);
  });

  it('keeps one decimal when no reading needs one', () => {
    const card = roomCard();
    const hass = createHouseHass();

    hass.setState('sensor.kitchen_temperature', '21');
    hass.setState('sensor.bedroom_thermometer', '19.02');
    card.hass = hass;

    expect(card.roomTemperatures.map((reading) => reading.text)).toEqual([
      '21.0°',
      '19.0°',
    ]);
  });

  it('puts the thermometer only on a room outside the band', () => {
    const readings = roomCard({ comfort_max: 21 }).roomTemperatures;

    expect(readings.map((reading) => reading.flag)).toEqual(['hot', null]);
  });

  it('flags a room outside the configured band', () => {
    const readings = roomCard({
      comfort_min: 19,
      comfort_max: 21,
    }).roomTemperatures;

    expect(readings.map((reading) => reading.band)).toEqual(['hot', 'cold']);
  });

  it('reads a thermostat on an object for the room it stands in', async () => {
    const card = houseCard();
    const home = structuredClone(homeFixture) as Record<string, unknown> & {
      additions: { props: unknown[] };
    };

    home.additions.props = [
      { slug: 'thermostat', type: 'plug', room: 'living-space' },
    ];
    card.setConfig({
      type: cardType,
      home_document: home,
      bindings: [
        {
          scope: { type: 'prop', id: 'thermostat' },
          entity_id: 'climate.bedroom_radiator',
        },
      ],
    });
    await mountCard(card);
    await sceneOf(card)?.updateComplete;
    await card.updateComplete;

    expect(card.roomTemperatures).toEqual([
      {
        slug: 'living-space',
        text: '19.0°',
        band: 'comfort',
        flag: null,
      },
    ]);
  });

  it('leaves the chip column out', async () => {
    const card = await mountCard(roomCard());

    expect(card.shadowRoot?.querySelector('.chips')).toBeNull();
    expect(card.shadowRoot?.querySelector('.chip')).toBeNull();
  });

  it('keeps humidity for the room sheet rather than the floor', () => {
    const card = roomCard();

    expect(JSON.stringify(card.roomTemperatures)).not.toContain('47');
  });
});

describe('estanza-card occupied rooms and tint', () => {
  function roomCard(extra: Record<string, unknown> = {}): EstanzaCard {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
        { scope: { type: 'room', id: 'bedroom' }, area_id: 'bedroom' },
      ],
      ...extra,
    });

    return card;
  }

  it('outlines a room whose motion sensor is on', () => {
    expect(roomCard().roomMarks.kitchen?.occupied).toBe(true);
  });

  it('leaves a quiet room without an outline', () => {
    expect(roomCard().roomMarks.bedroom?.occupied).toBe(false);
  });

  it('tints nothing by default', () => {
    const marks = roomCard({ comfort_min: 19 }).roomMarks;

    expect(marks.bedroom?.tint).toBeNull();
  });

  it('tints a cold room navy when the tint is on', () => {
    const marks = roomCard({
      comfort_min: 19,
      temperature_tint: true,
    }).roomMarks;

    expect(marks.bedroom?.tint).toBe('#8296cf');
    expect(marks.kitchen?.tint).toBeNull();
  });
});

describe('estanza-card light and night', () => {
  it('spills light on floors and walls by default', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });
    await mountCard(card);

    expect(sceneOf(card)?.spill).toBe('wash');
  });

  it('keeps to a pool of light on a weak device', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123', spill: 'pool' });
    await mountCard(card);

    expect(sceneOf(card)?.spill).toBe('pool');
  });

  it('draws on Auto when the config names no quality', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });
    await mountCard(card);

    expect(sceneOf(card)?.quality).toBe('auto');
  });

  it('hands the scene the quality the reader picked', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123', quality: 'saver' });
    await mountCard(card);

    expect(sceneOf(card)?.quality).toBe('saver');
  });

  it('falls to night with the sunset, not with a dark theme, by default', async () => {
    const card = createCard();
    const hass = createHouseHass();

    card.hass = { ...hass, themes: { darkMode: true } };
    card.setConfig({ type: cardType, share_id: 'abc123' });
    await mountCard(card);

    expect(sceneOf(card)?.night).toBe(false);
    expect(sceneOf(card)?.sun).toEqual({ elevation: 30, azimuth: 180 });

    hass.setState('sun.sun', 'below_horizon', {
      elevation: -20,
      azimuth: 300,
    });
    card.hass = { ...hass, themes: { darkMode: false } };
    await card.updateComplete;

    expect(sceneOf(card)?.night).toBe(true);
  });

  it('keeps the day by local daytime on a Home Assistant with no location, and turns night on the clock', async () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 29, 19, 58) });

    try {
      const card = createCard();

      card.hass = {
        ...createMockHass({
          location: null,
          states: [
            mockEntityState('sun.sun', 'below_horizon', {
              elevation: -20,
              azimuth: 300,
            }),
          ],
        }),
        themes: { darkMode: true },
      };
      card.setConfig({ type: cardType, share_id: 'abc123' });
      await mountCard(card);

      expect(sceneOf(card)?.night).toBe(false);
      expect(sceneOf(card)?.sun).toBeNull();

      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      await card.updateComplete;

      expect(sceneOf(card)?.night).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the scene the sun Home Assistant reports when told to follow it', async () => {
    const card = createCard();
    const hass = createHouseHass();

    hass.setState('sun.sun', 'above_horizon', {
      elevation: 5,
      azimuth: 262,
    });
    card.hass = hass;
    card.setConfig({ type: cardType, share_id: 'abc123', night: 'auto' });
    await mountCard(card);

    expect(sceneOf(card)?.sun).toEqual({ elevation: 5, azimuth: 262 });
    expect(sceneOf(card)?.night).toBe(false);

    hass.setState('sun.sun', 'below_horizon', {
      elevation: -3.5,
      azimuth: 270,
    });
    card.hass = { ...hass };
    await card.updateComplete;

    expect(sceneOf(card)?.sun).toEqual({ elevation: -3.5, azimuth: 270 });
    expect(sceneOf(card)?.night).toBe(true);
  });

  it('keeps the night scene with no sun at midday when told to', async () => {
    const card = createCard();
    const hass = createHouseHass();

    hass.setState('sun.sun', 'above_horizon', {
      elevation: 20,
      azimuth: 180,
    });
    card.hass = hass;
    card.setConfig({ type: cardType, share_id: 'abc123', night: 'night' });
    await mountCard(card);

    expect(sceneOf(card)?.night).toBe(true);
    expect(sceneOf(card)?.sun).toBeNull();
  });

  it('keeps the day scene through the evening clock on a Home Assistant with no location when told to', async () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 29, 19, 58) });

    try {
      const card = createCard();

      card.hass = createMockHass({ location: null });
      card.setConfig({ type: cardType, share_id: 'abc123', night: 'day' });
      await mountCard(card);

      expect(sceneOf(card)?.night).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      await card.updateComplete;

      expect(sceneOf(card)?.night).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('estanza-card rendering', () => {
  it('hands the scene the share id and the origins it loads from', async () => {
    const card = houseCard();

    card.setConfig({ type: cardType, share_id: 'abc123' });
    await mountCard(card);

    expect(sceneOf(card)?.shareId).toBe('abc123');
    expect(sceneOf(card)?.apiOrigin).toBe(defaultApiOrigin);
    expect(sceneOf(card)?.modelsOrigin).toBe(defaultModelsOrigin);
  });

  it('hands the scene a configured home document for the offline path', async () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      home_document: homeFixture,
    });
    await mountCard(card);

    expect(sceneOf(card)?.homeDocument).toEqual(
      homeDocumentSchema.parse(homeFixture),
    );
    expect(card.shareId).toBe('');
  });

  it('hands the scene the overlay built from hass', async () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'kitchen-strip' },
          entity_id: 'light.kitchen_strip',
        },
      ],
    });
    await mountCard(card);

    expect(sceneOf(card)?.overlay.lights['kitchen-strip']?.color).toBe(
      '#ff6ea8',
    );
  });

  it('repaints the scene when an entity changes', async () => {
    const card = createCard();
    const hass = createHouseHass();

    card.hass = hass;
    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'bedroom-light' },
          entity_id: 'light.bedroom_ceiling',
        },
      ],
    });
    await mountCard(card);

    expect(sceneOf(card)?.overlay.lights['bedroom-light']?.on).toBe(false);

    hass.setState('light.bedroom_ceiling', 'on', { brightness: 255 });
    card.hass = { ...hass };
    await card.updateComplete;

    expect(sceneOf(card)?.overlay.lights['bedroom-light']?.on).toBe(true);
  });

  it('rebuilds the overlay when the bindings are edited', async () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'kitchen-strip' },
          entity_id: 'light.kitchen_strip',
        },
      ],
    });
    await mountCard(card);

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'light', id: 'bedroom-light' },
          entity_id: 'light.bedroom_ceiling',
        },
      ],
    });
    await card.updateComplete;

    expect(sceneOf(card)?.overlay.lights['kitchen-strip']).toBeUndefined();
    expect(sceneOf(card)?.overlay.lights['bedroom-light']?.on).toBe(false);
  });

  it('draws the configured title', async () => {
    const card = houseCard();

    card.setConfig({
      type: cardType,
      share_id: 'abc123',
      title: 'Ground floor',
    });
    await mountCard(card);

    expect(card.shadowRoot?.querySelector('.title')?.textContent).toBe(
      'Ground floor',
    );
  });
});
