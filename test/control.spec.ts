import { describe, expect, it } from 'vitest';

import type { SceneBinding } from '../src/bindings.js';
import {
  actionOf,
  type Control,
  controlFor,
  controlKindOf,
  controlKinds,
  deedChoices,
  deedLabel,
  deedOf,
  defaultDeed,
  markedControl,
  opensHome,
  planBrightness,
  planCover,
  planDeed,
  planPosition,
  planToggle,
  planWhite,
  settled,
} from '../src/control.js';
import { mapScopeStates } from '../src/hass-state.js';
import {
  createHouseHass,
  createMockHass,
  mockEntityState,
  type MockHass,
  mockLock,
} from './mock-hass.js';

function controlOf(hass: MockHass, binding: SceneBinding) {
  const states = mapScopeStates(hass, [binding]);
  const scopeState = Object.values(states)[0];

  return scopeState ? controlFor(scopeState) : null;
}

const strip: SceneBinding = {
  scope: { type: 'light', id: 'kitchen-strip' },
  entity_id: 'light.kitchen_strip',
};

describe('what a tap controls', () => {
  it('controls a bound light', () => {
    expect(controlOf(createHouseHass(), strip)).toMatchObject({
      kind: 'light',
      key: 'light:kitchen-strip',
      entityIds: ['light.kitchen_strip'],
      name: 'Kitchen strip',
    });
  });

  it('controls a switch bound to a lamp', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'light', id: 'fountain' },
      entity_id: 'switch.garden_fountain',
    });

    expect(control?.kind).toBe('switch');
  });

  it('controls a cover bound to a door', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'garage-door' },
      entity_id: 'cover.garage',
    });

    expect(control?.kind).toBe('cover');
  });

  it('prefers the lock of a door that also has a sensor', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'front-door' },
      entity_ids: ['binary_sensor.front_door', 'lock.front_door'],
    });

    expect(control).toMatchObject({
      kind: 'lock',
      entityIds: ['lock.front_door'],
    });
  });

  it('controls the lights of a bound room and nothing else in it', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'room', id: 'kitchen' },
      area_id: 'kitchen',
    });

    expect(control).toMatchObject({
      kind: 'room',
      name: 'Kitchen',
      entityIds: ['light.kitchen_ceiling', 'light.kitchen_strip'],
    });
  });

  it('leaves a plug in the room out of the room lights', () => {
    const hass = createHouseHass();

    hass.entities = {
      ...hass.entities,
      'switch.garden_fountain': {
        entity_id: 'switch.garden_fountain',
        area_id: 'kitchen',
      },
    };

    const control = controlOf(hass, {
      scope: { type: 'room', id: 'kitchen' },
      area_id: 'kitchen',
    });

    expect(control?.entityIds).not.toContain('switch.garden_fountain');
  });

  it('leaves a door with only a sensor alone', () => {
    expect(
      controlOf(createHouseHass(), {
        scope: { type: 'door', id: 'front-door' },
        entity_id: 'binary_sensor.front_door',
      }),
    ).toBeNull();
  });

  it('marks a thermostat on a piece, whose tap shows its details', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'prop', id: 'radiator' },
      entity_id: 'climate.bedroom_radiator',
    });

    expect(control).toMatchObject({
      kind: 'gadget',
      entityIds: ['climate.bedroom_radiator'],
    });
    expect(control && deedOf(control.kind, 'tap', undefined)).toBe('more-info');
  });

  it('marks any entity linked to a piece, whatever its domain', () => {
    const hass = createMockHass({
      states: [
        mockEntityState('media_player.living_tv', 'playing'),
        mockEntityState('vacuum.robot', 'docked'),
        mockEntityState('script.movie_night', 'off'),
      ],
    });

    for (const entityId of [
      'media_player.living_tv',
      'vacuum.robot',
      'script.movie_night',
    ]) {
      expect(
        controlOf(hass, {
          scope: { type: 'prop', id: 'thing' },
          entity_id: entityId,
        }),
      ).toMatchObject({ kind: 'gadget', entityIds: [entityId] });
    }
  });

  it('leaves a linked piece without a mark when its tap and hold do nothing', () => {
    const hass = createMockHass({
      states: [mockEntityState('media_player.living_tv', 'playing')],
    });
    const scopeState = Object.values(
      mapScopeStates(hass, [
        {
          scope: { type: 'prop', id: 'tv' },
          entity_id: 'media_player.living_tv',
        },
      ]),
    )[0];

    expect(controlFor(scopeState, { tap: { action: 'none' } })).toBeNull();
    expect(
      controlFor(scopeState, {
        tap: { action: 'none' },
        hold: { action: 'more-info' },
      }),
    ).not.toBeNull();
  });

  it('marks a control whose entity is unavailable', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'light', id: 'hall-light' },
      entity_id: 'light.hall_ceiling',
    });

    expect(control?.unavailable).toBe(true);
  });
});

describe('what opens the home to the outside', () => {
  function coverOf(deviceClass: string, state: string): Control {
    return {
      kind: 'cover',
      key: 'door:d1',
      scope: { type: 'door', id: 'd1' },
      entityIds: ['cover.d1'],
      states: [
        mockEntityState('cover.d1', state, { device_class: deviceClass }),
      ],
      name: 'Door',
      unavailable: false,
    };
  }

  it('counts opening a garage, a gate or a door cover', () => {
    for (const deviceClass of ['garage', 'gate', 'door']) {
      expect(opensHome(coverOf(deviceClass, 'closed'), 'toggle')).toBe(true);
      expect(opensHome(coverOf(deviceClass, 'closed'), 'open')).toBe(true);
      expect(opensHome(coverOf(deviceClass, 'open'), 'open')).toBe(true);
    }
  });

  it('never counts closing one', () => {
    expect(opensHome(coverOf('garage', 'open'), 'toggle')).toBe(false);
    expect(opensHome(coverOf('garage', 'closed'), 'close')).toBe(false);
  });

  it('never counts a blind, a shutter or a window', () => {
    for (const deviceClass of ['blind', 'shutter', 'window', 'curtain']) {
      expect(opensHome(coverOf(deviceClass, 'closed'), 'open')).toBe(false);
    }
  });

  it('counts unlocking a lock, and never locking it', () => {
    const lock = (state: string) =>
      controlOf(createMockHass({ states: [mockLock('lock.front', state)] }), {
        scope: { type: 'door', id: 'front' },
        entity_id: 'lock.front',
      });
    const locked = lock('locked');
    const unlocked = lock('unlocked');

    expect(locked && opensHome(locked, 'toggle')).toBe(true);
    expect(locked && opensHome(locked, 'unlock')).toBe(true);
    expect(unlocked && opensHome(unlocked, 'toggle')).toBe(false);
    expect(unlocked && opensHome(unlocked, 'lock')).toBe(false);
  });
});

describe('the call a tap makes', () => {
  it('toggles a light through light.toggle', () => {
    const control = controlOf(createHouseHass(), strip);

    expect(control && planToggle(control).calls).toEqual([
      {
        domain: 'light',
        service: 'toggle',
        data: { entity_id: 'light.kitchen_strip' },
      },
    ]);
  });

  it('shows a light off at once while the call is out', () => {
    const control = controlOf(createHouseHass(), strip);
    const plan = control && planToggle(control);

    expect(plan?.optimistic.map((state) => state.state)).toEqual(['off']);
  });

  it('toggles a switch through switch.toggle', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'light', id: 'fountain' },
      entity_id: 'switch.garden_fountain',
    });

    expect(control && planToggle(control)).toMatchObject({
      calls: [
        {
          domain: 'switch',
          service: 'toggle',
          data: { entity_id: 'switch.garden_fountain' },
        },
      ],
      optimistic: [{ entity_id: 'switch.garden_fountain', state: 'on' }],
    });
  });

  it('toggles a cover through cover.toggle and draws it closing', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'garage-door' },
      entity_id: 'cover.garage',
    });

    expect(control && planToggle(control)).toMatchObject({
      calls: [
        {
          domain: 'cover',
          service: 'toggle',
          data: { entity_id: 'cover.garage' },
        },
      ],
      optimistic: [
        {
          entity_id: 'cover.garage',
          state: 'closed',
          attributes: { current_position: 0 },
        },
      ],
      expect: [{ entityId: 'cover.garage', states: ['closed', 'closing'] }],
    });
  });

  it('unlocks a locked door', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'front-door' },
      entity_id: 'lock.front_door',
    });

    expect(control && planToggle(control).calls).toEqual([
      {
        domain: 'lock',
        service: 'unlock',
        data: { entity_id: 'lock.front_door' },
      },
    ]);
  });

  it('turns every light of a room off when any is on', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'room', id: 'kitchen' },
      area_id: 'kitchen',
    });

    expect(control && planToggle(control).calls).toEqual([
      {
        domain: 'light',
        service: 'turn_off',
        data: { entity_id: ['light.kitchen_ceiling', 'light.kitchen_strip'] },
      },
    ]);
  });

  it('turns every light of a dark room on', () => {
    const hass = createHouseHass();

    hass.setState('light.kitchen_ceiling', 'off');
    hass.setState('light.kitchen_strip', 'off');

    const control = controlOf(hass, {
      scope: { type: 'room', id: 'kitchen' },
      area_id: 'kitchen',
    });

    expect(control && planToggle(control).calls[0]?.service).toBe('turn_on');
  });
});

describe('the calls the control sheet makes', () => {
  it('sets brightness as a percentage', () => {
    const control = controlOf(createHouseHass(), strip);

    expect(control && planBrightness(control, 40)).toMatchObject({
      calls: [
        {
          domain: 'light',
          service: 'turn_on',
          data: { entity_id: 'light.kitchen_strip', brightness_pct: 40 },
        },
      ],
      optimistic: [{ state: 'on', attributes: { brightness: 102 } }],
    });
  });

  it('turns a light off when its brightness goes to zero', () => {
    const control = controlOf(createHouseHass(), strip);

    expect(control && planBrightness(control, 0).calls[0]?.service).toBe(
      'turn_off',
    );
  });

  it('picks a white by its colour temperature', () => {
    const control = controlOf(createHouseHass(), strip);

    expect(control && planWhite(control, 4000).calls[0]?.data).toEqual({
      entity_id: 'light.kitchen_strip',
      color_temp_kelvin: 4000,
    });
  });

  it('moves a cover to a position', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'garage-door' },
      entity_id: 'cover.garage',
    });

    expect(control && planPosition(control, 25).calls[0]).toEqual({
      domain: 'cover',
      service: 'set_cover_position',
      data: { entity_id: 'cover.garage', position: 25 },
    });
  });

  it('stops a cover without guessing where it ends up', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'garage-door' },
      entity_id: 'cover.garage',
    });

    expect(control && planCover(control, 'stop')).toMatchObject({
      calls: [{ domain: 'cover', service: 'stop_cover' }],
      optimistic: [],
      expect: [],
    });
  });
});

describe('what a tap and a hold do', () => {
  it('keeps today’s defaults for every kind', () => {
    const defaults = controlKinds.map((kind) => [
      kind,
      defaultDeed(kind, 'tap'),
      defaultDeed(kind, 'hold'),
    ]);

    expect(defaults).toEqual([
      ['light', 'toggle', 'sheet'],
      ['switch', 'toggle', 'sheet'],
      ['cover', 'toggle', 'sheet'],
      ['lock', 'toggle', 'more-info'],
      ['room', 'sheet', 'sheet'],
      ['sensor', 'none', 'none'],
      ['gadget', 'more-info', 'none'],
    ]);
  });

  it('offers each kind its own actions, details and nothing, the default first', () => {
    expect(deedChoices('light', 'tap')).toEqual([
      'toggle',
      'more-info',
      'none',
    ]);
    expect(deedChoices('light', 'hold')).toEqual([
      'sheet',
      'toggle',
      'more-info',
      'none',
    ]);
    expect(deedChoices('cover', 'tap')).toEqual([
      'toggle',
      'open',
      'close',
      'more-info',
      'none',
    ]);
    expect(deedChoices('lock', 'tap')).toEqual([
      'toggle',
      'lock',
      'unlock',
      'more-info',
      'none',
    ]);
    expect(deedChoices('room', 'tap')).toEqual(['sheet', 'toggle', 'none']);
    expect(deedChoices('sensor', 'tap')).toEqual(['none', 'more-info']);
    expect(deedChoices('gadget', 'tap')).toEqual(['more-info', 'none']);
    expect(deedChoices('gadget', 'hold')).toEqual(['none', 'more-info']);
  });

  it('says what each choice does in the words of its kind', () => {
    expect(deedLabel('light', 'toggle')).toBe('Turn on or off');
    expect(deedLabel('cover', 'toggle')).toBe('Open or close');
    expect(deedLabel('cover', 'open')).toBe('Open');
    expect(deedLabel('lock', 'toggle')).toBe('Lock or unlock');
    expect(deedLabel('room', 'toggle')).toBe('Turn its lights on or off');
    expect(deedLabel('light', 'sheet')).toBe('Show controls');
    expect(deedLabel('room', 'sheet')).toBe('Show the room');
    expect(deedLabel('sensor', 'more-info')).toBe('Show details');
    expect(deedLabel('sensor', 'none')).toBe('Nothing');
  });

  it('writes a choice in Home Assistant’s own action shape', () => {
    expect(actionOf('toggle')).toEqual({ action: 'toggle' });
    expect(actionOf('more-info')).toEqual({ action: 'more-info' });
    expect(actionOf('none')).toEqual({ action: 'none' });
    expect(actionOf('open')).toEqual({
      action: 'perform-action',
      perform_action: 'cover.open_cover',
    });
    expect(actionOf('unlock')).toEqual({
      action: 'perform-action',
      perform_action: 'lock.unlock',
    });
    expect(actionOf('sheet')).toBeUndefined();
  });

  it('reads an action back, and falls back to the default when the kind cannot do it', () => {
    const open = actionOf('open');

    expect(deedOf('cover', 'tap', open)).toBe('open');
    expect(deedOf('light', 'tap', open)).toBe('toggle');
    expect(deedOf('sensor', 'hold', { action: 'toggle' })).toBe('none');
    expect(deedOf('light', 'hold', undefined)).toBe('sheet');
    expect(deedOf('light', 'hold', { action: 'more-info' })).toBe('more-info');
  });

  it('opens and closes a cover whatever state it is in', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'garage-door' },
      entity_id: 'cover.garage',
    });

    expect(control && planDeed(control, 'open').calls).toEqual([
      {
        domain: 'cover',
        service: 'open_cover',
        data: { entity_id: 'cover.garage' },
      },
    ]);
    expect(control && planDeed(control, 'close').calls[0].service).toBe(
      'close_cover',
    );
  });

  it('locks and unlocks a lock on request', () => {
    const control = controlOf(createHouseHass(), {
      scope: { type: 'door', id: 'front-door' },
      entity_id: 'lock.front_door',
    });

    expect(control && planDeed(control, 'unlock').calls[0].service).toBe(
      'unlock',
    );
    expect(control && planDeed(control, 'lock').calls[0].service).toBe('lock');
  });

  it('knows a sensor-only door or window and has no toggle for it', () => {
    expect(controlKindOf({ type: 'door', id: 'd1' }, ['binary_sensor.x'])).toBe(
      'sensor',
    );
    expect(controlKindOf({ type: 'window', id: 'w1' }, ['cover.blind'])).toBe(
      'cover',
    );
    expect(controlKindOf({ type: 'room', id: 'hall' }, [])).toBe('room');
  });

  it('calls a piece linked to something it cannot switch a device, never a sensor', () => {
    expect(controlKindOf({ type: 'prop', id: 'tv' }, ['media_player.tv'])).toBe(
      'gadget',
    );
    expect(controlKindOf({ type: 'light', id: 'lamp' }, ['sensor.lux'])).toBe(
      'gadget',
    );
    expect(controlKindOf({ type: 'prop', id: 'tv' }, ['switch.tv_plug'])).toBe(
      'switch',
    );
    expect(controlKindOf({ type: 'window', id: 'w1' }, ['sensor.x'])).toBe(
      'sensor',
    );
  });

  it('lets a sensor-only door be tapped only when it asks for its details', () => {
    const hass = createHouseHass();
    const door: SceneBinding = {
      scope: { type: 'door', id: 'front-door' },
      entity_id: 'binary_sensor.front_door',
    };
    const scopeState = Object.values(mapScopeStates(hass, [door]))[0];

    expect(controlFor(scopeState)).toBeNull();
    expect(
      controlFor(scopeState, { hold: { action: 'more-info' } }),
    ).toMatchObject({
      kind: 'sensor',
      entityIds: ['binary_sensor.front_door'],
    });
  });

  it('still describes a sensor-only door for its mark, though a tap leaves it alone', () => {
    const hass = createHouseHass();
    const door: SceneBinding = {
      scope: { type: 'door', id: 'front-door' },
      entity_id: 'binary_sensor.front_door',
    };
    const scopeState = Object.values(mapScopeStates(hass, [door]))[0];

    expect(markedControl(scopeState)).toMatchObject({
      kind: 'sensor',
      key: 'door:front-door',
      entityIds: ['binary_sensor.front_door'],
    });
  });
});

describe('confirmation', () => {
  it('waits while the real state still differs', () => {
    const hass = createHouseHass();
    const control = controlOf(hass, strip);
    const plan = control && planToggle(control);

    expect(plan && settled(plan, hass.states)).toBe(false);
  });

  it('settles once Home Assistant reports the new state', () => {
    const hass = createHouseHass();
    const control = controlOf(hass, strip);
    const plan = control && planToggle(control);

    hass.setState('light.kitchen_strip', 'off', {});

    expect(plan && settled(plan, hass.states)).toBe(true);
  });

  it('settles a brightness only near the value asked for', () => {
    const hass = createHouseHass();
    const control = controlOf(hass, strip);
    const plan = control && planBrightness(control, 40);

    hass.setState('light.kitchen_strip', 'on', { brightness: 90 });

    expect(plan && settled(plan, hass.states)).toBe(false);

    hass.setState('light.kitchen_strip', 'on', { brightness: 103 });

    expect(plan && settled(plan, hass.states)).toBe(true);
  });
});
