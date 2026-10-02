import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  bindingEntityIds,
  cardType,
  defaultApiOrigin,
  defaultModelsOrigin,
  findBindingsForScope,
  groupBindingsByScope,
  modelsBase,
  modelSource,
  parseCardConfig,
  scopeKey,
  shareDocumentEndpoint,
  shareIdFromConfig,
} from '../src/bindings.js';
import homeFixture from './fixtures/home.json';

describe('parseCardConfig', () => {
  it('accepts a share url with no bindings', () => {
    const config = parseCardConfig({
      type: cardType,
      share_url: 'https://estanza.casa/share/abc123',
    });

    expect(config.share_url).toBe('https://estanza.casa/share/abc123');
    expect(config.bindings).toEqual([]);
  });

  it('accepts a config with no share yet, as the card picker writes it', () => {
    const config = parseCardConfig({ type: cardType });

    expect(shareIdFromConfig(config)).toBeNull();
  });

  it('keeps a read only card read only', () => {
    expect(
      parseCardConfig({ type: cardType, interaction: 'none' }).interaction,
    ).toBe('none');
  });

  it('rejects an interaction mode it does not know', () => {
    expect(() =>
      parseCardConfig({ type: cardType, interaction: 'sometimes' }),
    ).toThrow(/interaction/);
  });

  it('reads the light spill a weak device asks for', () => {
    expect(parseCardConfig({ type: cardType, spill: 'pool' }).spill).toBe(
      'pool',
    );
  });

  it('rejects a light spill it does not know', () => {
    expect(() => parseCardConfig({ type: cardType, spill: 'flood' })).toThrow(
      /spill/,
    );
  });

  it('reads where night comes from', () => {
    expect(parseCardConfig({ type: cardType, night: 'night' }).night).toBe(
      'night',
    );
  });

  it('rejects a night source it does not know', () => {
    expect(() => parseCardConfig({ type: cardType, night: 'moon' })).toThrow(
      /night/,
    );
  });

  it('rejects the retired night sources', () => {
    expect(() => parseCardConfig({ type: cardType, night: 'sun' })).toThrow(
      /night/,
    );
    expect(() => parseCardConfig({ type: cardType, night: 'theme' })).toThrow(
      /night/,
    );
    expect(() => parseCardConfig({ type: cardType, night: 'off' })).toThrow(
      /night/,
    );
  });

  it('reads the quality the reader picked', () => {
    expect(
      parseCardConfig({ type: cardType, quality: 'balanced' }).quality,
    ).toBe('balanced');
    expect(parseCardConfig({ type: cardType, quality: 'auto' }).quality).toBe(
      'auto',
    );
  });

  it('leaves the quality unset when the config names none', () => {
    expect(parseCardConfig({ type: cardType }).quality).toBeUndefined();
  });

  it('rejects a quality it does not know', () => {
    expect(() => parseCardConfig({ type: cardType, quality: 'ultra' })).toThrow(
      /quality/,
    );
  });

  it('reads how the other floors are drawn', () => {
    expect(
      parseCardConfig({ type: cardType, other_floors: 'hidden' }).other_floors,
    ).toBe('hidden');
    expect(parseCardConfig({ type: cardType }).other_floors).toBeUndefined();
  });

  it('rejects another floors mode it does not know', () => {
    expect(() =>
      parseCardConfig({ type: cardType, other_floors: 'xray' }),
    ).toThrow(/other_floors/);
  });

  it('reads which view the card opens on', () => {
    expect(
      parseCardConfig({ type: cardType, default_view: '2d' }).default_view,
    ).toBe('2d');
    expect(parseCardConfig({ type: cardType }).default_view).toBeUndefined();
  });

  it('reads the view a tile opens on a tap', () => {
    expect(
      parseCardConfig({ type: cardType, navigation_path: '/home/wall' })
        .navigation_path,
    ).toBe('/home/wall');
  });

  it('reads the rows and columns the sections view gave the card', () => {
    expect(
      parseCardConfig({ type: cardType, grid_options: { rows: 2, columns: 6 } })
        .grid_options,
    ).toEqual({ rows: 2, columns: 6 });
    expect(
      parseCardConfig({ type: cardType, grid_options: { columns: 'full' } })
        .grid_options,
    ).toEqual({ columns: 'full' });
    expect(
      parseCardConfig({ type: cardType, grid_options: { rows: 'auto' } })
        .grid_options,
    ).toBeUndefined();
  });

  it('rejects a view it does not know', () => {
    expect(() =>
      parseCardConfig({ type: cardType, default_view: 'plan' }),
    ).toThrow(/default_view/);
  });

  it('reads the wall tablet settings', () => {
    const config = parseCardConfig({
      type: cardType,
      tablet: 'on',
      idle_seconds: 20,
      late_night: '22:30',
    });

    expect(config.tablet).toBe('on');
    expect(config.idle_seconds).toBe(20);
    expect(config.late_night).toBe('22:30');
  });

  it('reads a bare yes or no for the tablet, as YAML writes on and off', () => {
    expect(parseCardConfig({ type: cardType, tablet: true }).tablet).toBe('on');
    expect(parseCardConfig({ type: cardType, tablet: false }).tablet).toBe(
      'off',
    );
  });

  it('rejects a tablet mode it does not know', () => {
    expect(() => parseCardConfig({ type: cardType, tablet: 'wall' })).toThrow(
      /tablet/,
    );
  });

  it('rejects an idle time that is not a positive number of seconds', () => {
    expect(() => parseCardConfig({ type: cardType, idle_seconds: 0 })).toThrow(
      /idle_seconds/,
    );
    expect(() =>
      parseCardConfig({ type: cardType, idle_seconds: '45' }),
    ).toThrow(/idle_seconds/);
  });

  it('reads how many minutes a door may stay open before it is flagged', () => {
    expect(
      parseCardConfig({ type: cardType, open_alert_after: 5 }).open_alert_after,
    ).toBe(5);
  });

  it('rejects an open door threshold that is not a positive number', () => {
    expect(() =>
      parseCardConfig({ type: cardType, open_alert_after: 0 }),
    ).toThrow(/open_alert_after/);
    expect(() =>
      parseCardConfig({ type: cardType, open_alert_after: '10' }),
    ).toThrow(/open_alert_after/);
  });

  it('turns late night off with off or false', () => {
    expect(
      parseCardConfig({ type: cardType, late_night: 'off' }).late_night,
    ).toBe('off');
    expect(
      parseCardConfig({ type: cardType, late_night: false }).late_night,
    ).toBe('off');
  });

  it('rejects a late night start that is not a time of day', () => {
    expect(() =>
      parseCardConfig({ type: cardType, late_night: '25:00' }),
    ).toThrow(/late_night/);
    expect(() =>
      parseCardConfig({ type: cardType, late_night: 'midnight' }),
    ).toThrow(/late_night/);
  });

  it('reads a comfort band and the temperature tint', () => {
    expect(
      parseCardConfig({
        type: cardType,
        comfort_min: 19,
        comfort_max: 24,
        temperature_tint: true,
      }),
    ).toMatchObject({
      comfort_min: 19,
      comfort_max: 24,
      temperature_tint: true,
    });
  });

  it('rejects a comfort band that is not a number', () => {
    expect(() =>
      parseCardConfig({ type: cardType, comfort_min: 'cold' }),
    ).toThrow(/comfort_min/);
  });

  it('rejects a comfort band that runs backwards', () => {
    expect(() =>
      parseCardConfig({ type: cardType, comfort_min: 26, comfort_max: 20 }),
    ).toThrow(/comfort/);
  });

  it('rejects a temperature tint that is not on or off', () => {
    expect(() =>
      parseCardConfig({ type: cardType, temperature_tint: 'yes' }),
    ).toThrow(/temperature_tint/);
  });

  it('rejects a config with both share url and share id', () => {
    expect(() =>
      parseCardConfig({
        type: cardType,
        share_url: 'https://estanza.casa/share/abc123',
        share_id: 'abc123',
      }),
    ).toThrow(/only one/);
  });

  it('rejects a binding with an unknown scope type', () => {
    expect(() =>
      parseCardConfig({
        type: cardType,
        share_id: 'abc123',
        bindings: [
          { scope: { type: 'floor', id: 'r1' }, entity_id: 'light.a' },
        ],
      }),
    ).toThrow(/scope type/);
  });

  it('accepts every scope type the plan addresses', () => {
    const config = parseCardConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'light', id: 'l1' }, entity_id: 'light.a' },
        { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
        { scope: { type: 'prop', id: 'p1' }, entity_id: 'climate.a' },
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.a' },
        { scope: { type: 'window', id: 'w1' }, entity_id: 'binary_sensor.b' },
      ],
    });

    expect(config.bindings).toHaveLength(5);
  });

  it('rejects a binding with no entity or area', () => {
    expect(() =>
      parseCardConfig({
        type: cardType,
        share_id: 'abc123',
        bindings: [{ scope: { type: 'room', id: 'r1' } }],
      }),
    ).toThrow(/entity_id, entity_ids or area_id/);
  });

  it('keeps per sensor overrides on a room binding', () => {
    const config = parseCardConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        {
          scope: { type: 'room', id: 'kitchen' },
          area_id: 'kitchen',
          temperature_entity_id: 'sensor.kitchen_temperature',
          humidity_entity_id: 'sensor.kitchen_humidity',
        },
      ],
    });

    expect(config.bindings[0]?.temperature_entity_id).toBe(
      'sensor.kitchen_temperature',
    );
    expect(config.bindings[0]?.humidity_entity_id).toBe(
      'sensor.kitchen_humidity',
    );
  });

  it('rejects an entity id that is not a string', () => {
    expect(() =>
      parseCardConfig({
        type: cardType,
        share_id: 'abc123',
        bindings: [{ scope: { type: 'light', id: 'l1' }, entity_ids: [7] }],
      }),
    ).toThrow(/entity_ids\[0\]/);
  });

  it('rejects a non-object config', () => {
    expect(() => parseCardConfig('nope')).toThrow(/must be an object/);
  });

  it('keeps a pasted home document for the offline path', () => {
    const config = parseCardConfig({
      type: cardType,
      home_document: homeFixture,
    });

    expect(config.home_document).toEqual(homeDocumentSchema.parse(homeFixture));
    expect(shareIdFromConfig(config)).toBeNull();
  });

  it('rejects a home document that is not an Estanza home', () => {
    expect(() =>
      parseCardConfig({ type: cardType, home_document: { rooms: {} } }),
    ).toThrow(/home_document is not an Estanza home/);
  });
});

describe('tap and hold actions', () => {
  const scope = { type: 'door', id: 'garage-door' } as const;

  function bindingWith(extra: Record<string, unknown>) {
    return parseCardConfig({
      type: cardType,
      bindings: [{ scope, entity_id: 'cover.garage', ...extra }],
    }).bindings[0];
  }

  it('reads Home Assistant’s tap_action and hold_action on a binding', () => {
    const binding = bindingWith({
      tap_action: {
        action: 'perform-action',
        perform_action: 'cover.open_cover',
      },
      hold_action: { action: 'more-info' },
    });

    expect(binding.tap_action).toEqual({
      action: 'perform-action',
      perform_action: 'cover.open_cover',
    });
    expect(binding.hold_action).toEqual({ action: 'more-info' });
  });

  it('leaves both out when they are not set', () => {
    const binding = bindingWith({});

    expect(binding.tap_action).toBeUndefined();
    expect(binding.hold_action).toBeUndefined();
  });

  it('keeps any Home Assistant action as written, unknown ones included', () => {
    const popup = {
      action: 'fire-dom-event',
      browser_mod: { service: 'browser_mod.popup', data: { title: 'Door' } },
      confirmation: { text: 'Open it?' },
    };
    const binding = bindingWith({
      tap_action: popup,
      hold_action: { action: 'teleport', to: 'mars' },
      double_tap_action: { action: 'navigate', navigation_path: '/energy' },
    });

    expect(binding.tap_action).toEqual(popup);
    expect(binding.hold_action).toEqual({ action: 'teleport', to: 'mars' });
    expect(binding.double_tap_action).toEqual({
      action: 'navigate',
      navigation_path: '/energy',
    });
  });

  it('rejects an action that is not an action at all', () => {
    expect(() => bindingWith({ tap_action: 'toggle' })).toThrow(/tap_action/);
    expect(() =>
      bindingWith({ hold_action: { navigation_path: '/' } }),
    ).toThrow(/hold_action/);
  });

  it('finds the actions of a thing on any of its bindings', () => {
    expect(
      actionsFor(
        [
          { scope, entity_id: 'binary_sensor.garage' },
          { scope, entity_id: 'cover.garage', tap_action: { action: 'none' } },
          {
            scope: { type: 'light', id: 'l1' },
            entity_id: 'light.a',
            hold_action: { action: 'toggle' },
          },
        ],
        scope,
      ),
    ).toEqual({ tap: { action: 'none' } });
  });
});

describe('bindingEntityIds', () => {
  it('merges the single and list forms without duplicates', () => {
    const ids = bindingEntityIds({
      scope: { type: 'prop', id: 'lamp' },
      entity_id: 'light.a',
      entity_ids: ['light.a', 'light.b'],
    });

    expect(ids).toEqual(['light.a', 'light.b']);
  });

  it('counts the per sensor overrides of a room binding', () => {
    const ids = bindingEntityIds({
      scope: { type: 'room', id: 'kitchen' },
      temperature_entity_id: 'sensor.t',
      humidity_entity_id: 'sensor.h',
    });

    expect(ids).toEqual(['sensor.t', 'sensor.h']);
  });
});

describe('scopeKey', () => {
  it('joins the scope type and id', () => {
    expect(scopeKey({ type: 'room', id: 'kitchen' })).toBe('room:kitchen');
  });
});

describe('findBindingsForScope', () => {
  it('returns every binding on the scope', () => {
    const bindings = parseCardConfig({
      type: cardType,
      share_id: 'abc123',
      bindings: [
        { scope: { type: 'room', id: 'kitchen' }, entity_id: 'light.a' },
        { scope: { type: 'room', id: 'kitchen' }, entity_id: 'light.b' },
        { scope: { type: 'room', id: 'hall' }, entity_id: 'light.c' },
      ],
    }).bindings;

    expect(
      findBindingsForScope(bindings, { type: 'room', id: 'kitchen' }),
    ).toHaveLength(2);
  });
});

describe('groupBindingsByScope', () => {
  it('collects the bindings of one scope under its key', () => {
    const groups = groupBindingsByScope([
      { scope: { type: 'light', id: 'l1' }, entity_id: 'light.a' },
      { scope: { type: 'light', id: 'l1' }, entity_id: 'light.b' },
      { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.a' },
    ]);

    expect([...groups.keys()]).toEqual(['light:l1', 'door:d1']);
    expect(groups.get('light:l1')).toHaveLength(2);
  });
});

describe('shareIdFromConfig', () => {
  it('reads the id from an estanza share link', () => {
    const config = parseCardConfig({
      type: cardType,
      share_url: 'https://estanza.casa/share/abc123',
    });

    expect(shareIdFromConfig(config)).toBe('abc123');
  });

  it('ignores a query and a hash after the share id', () => {
    const config = parseCardConfig({
      type: cardType,
      share_url: 'https://estanza.casa/share/abc123?view=plan#top',
    });

    expect(shareIdFromConfig(config)).toBe('abc123');
  });

  it('prefers an explicit share id', () => {
    const config = parseCardConfig({ type: cardType, share_id: 'xyz789' });

    expect(shareIdFromConfig(config)).toBe('xyz789');
  });

  it('reads the same id from every way the one share link gets pasted', () => {
    const pasted = [
      { share_url: 'https://estanza.casa/share/abc123' },
      { share_url: 'estanza.casa/share/abc123' },
      { share_url: '  https://estanza.casa/share/abc123/  ' },
      { share_url: 'https://estanza.casa/share/abc123?from=/homes/x' },
      {
        share_url:
          'https://api.estanza.casa/v1/integrations/home-assistant/abc123',
      },
      { share_id: 'https://estanza.casa/share/abc123' },
      { share_id: ' abc123 ' },
    ];

    expect(
      pasted.map((share) =>
        shareIdFromConfig(parseCardConfig({ type: cardType, ...share })),
      ),
    ).toEqual(pasted.map(() => 'abc123'));
  });

  it('reads nothing from a link that carries no id', () => {
    const pasted = ['https://estanza.casa/', '   ', '?x=1'];

    expect(
      pasted.map((share_url) =>
        shareIdFromConfig(parseCardConfig({ type: cardType, share_url })),
      ),
    ).toEqual([null, null, null]);
  });
});

describe('shareDocumentEndpoint', () => {
  it('builds the home assistant integration endpoint for a token', () => {
    expect(shareDocumentEndpoint(defaultApiOrigin, 'abc123')).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/abc123',
    );
  });

  it('does not double up the slash when the origin has a trailing one', () => {
    expect(shareDocumentEndpoint('https://api.estanza.casa/', 'abc123')).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/abc123',
    );
  });

  it('escapes a token carrying a path character', () => {
    expect(shareDocumentEndpoint(defaultApiOrigin, 'a/b')).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/a%2Fb',
    );
  });
});

describe('modelSource', () => {
  it('reads an uploaded model through the share the card reads its home from', () => {
    const models = modelSource('https://api.estanza.casa/', 'a/b');

    expect(models.url('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/a%2Fb/models/7c9e6679-7425-40de-944b-e07fc1f90ae7',
    );
    expect(models.withCredentials).toBe(false);
  });

  it('has no address for a model when the home was pasted in without a share', () => {
    expect(
      modelSource(defaultApiOrigin, '').url(
        '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      ),
    ).toBeNull();
  });
});

describe('modelsBase', () => {
  it('points at the models the public webapp serves', () => {
    expect(modelsBase(defaultModelsOrigin)).toBe(
      'https://app.estanza.casa/assets/props',
    );
  });

  it('does not double up the slash when the origin has a trailing one', () => {
    expect(modelsBase('http://homeassistant.local:8080/')).toBe(
      'http://homeassistant.local:8080/assets/props',
    );
  });
});
