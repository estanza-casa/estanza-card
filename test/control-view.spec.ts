import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { type Control, LOCK_CONFIRM_MS } from '../src/control.js';
import {
  controlStyles,
  markIcon,
  type MarkPhase,
  markTemplate,
  type OpeningLook,
  sheetTemplate,
} from '../src/control-view.js';
import { icon, type IconName } from '../src/icons.js';
import {
  mockCover,
  mockEntityState,
  mockLock,
  mockSwitch,
} from './mock-hass.js';

function plug(on: boolean): Control {
  return {
    kind: 'switch',
    key: 'prop:tv-plug',
    scope: { type: 'prop', id: 'tv-plug' },
    entityIds: ['switch.tv'],
    states: [mockSwitch('switch.tv', on)],
    name: 'Television plug',
    unavailable: false,
  };
}

function drawn(
  control: Control,
  phase: MarkPhase | null = null,
  opening: OpeningLook | null = null,
): HTMLElement {
  const holder = document.createElement('div');

  render(
    markTemplate({
      control,
      at: { x: 0, y: 0 },
      under: false,
      phase,
      selected: false,
      lamp: null,
      opening,
      pointer: null,
      onConfirm: () => undefined,
      onKey: () => undefined,
    }),
    holder,
  );

  const mark = holder.querySelector<HTMLElement>('.mark');

  if (!mark) throw new Error('no mark');

  return mark;
}

function frontDoor(state: string): Control {
  return {
    kind: 'lock',
    key: 'door:front-door',
    scope: { type: 'door', id: 'front-door' },
    entityIds: ['lock.front_door'],
    states: [mockLock('lock.front_door', state)],
    name: 'Front door',
    unavailable: false,
  };
}

function drawnIcon(name: IconName): string {
  const holder = document.createElement('div');

  render(icon(name, 16), holder);

  return holder.querySelector('svg')?.innerHTML ?? '';
}

describe('a lock waiting for its confirming tap', () => {
  it('shows the lock as it is, then as the tap will leave it', () => {
    const icons = [
      ...drawn(frontDoor('locked'), 'armed').querySelectorAll('svg.icon'),
    ].map((svg) => svg.innerHTML);

    expect(icons[0]).toBe(drawnIcon('lock'));
    expect(icons.at(-1)).toBe(drawnIcon('lock-open'));
  });

  it('turns the other way for an unlocked door', () => {
    const icons = [
      ...drawn(frontDoor('unlocked'), 'armed').querySelectorAll('svg.icon'),
    ].map((svg) => svg.innerHTML);

    expect(icons[0]).toBe(drawnIcon('lock-open'));
    expect(icons.at(-1)).toBe(drawnIcon('lock'));
  });

  it('drains a bar over the time the tap stays armed', () => {
    const drain = drawn(
      frontDoor('locked'),
      'armed',
    ).querySelector<HTMLElement>('.drain');
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(drain?.style.animationDuration).toBe(`${LOCK_CONFIRM_MS}ms`);
    expect(rules).toMatch(/\.drain \{[^}]*animation: ez-drain /);
    expect(rules).toMatch(/@keyframes ez-drain \{[^}]*scale: 0 1/);
  });

  it('names what the tap will do, with no text drawn', () => {
    const mark = drawn(frontDoor('locked'), 'armed');

    expect(mark.getAttribute('aria-label')).toBe('Unlock Front door');
    expect(mark.textContent?.trim()).toBe('');
  });
});

function garageDoor(position: number): Control {
  return {
    kind: 'cover',
    key: 'door:garage',
    scope: { type: 'door', id: 'garage' },
    entityIds: ['cover.garage'],
    states: [mockCover('cover.garage', position)],
    name: 'Garage',
    unavailable: false,
  };
}

function iconsOf(mark: HTMLElement): string[] {
  return [...mark.querySelectorAll('svg.icon')].map((svg) => svg.innerHTML);
}

describe('a garage door waiting for its confirming tap', () => {
  const garage = garageDoor(0);

  it('shows a shut garage, then an open garage', () => {
    const icons = iconsOf(drawn(garage, 'armed', 'shut'));

    expect(icons[0]).toBe(drawnIcon('garage'));
    expect(icons.at(-1)).toBe(drawnIcon('garage-open'));
  });

  it('names what the tap will do, with no text drawn', () => {
    const mark = drawn(garage, 'armed');

    expect(mark.getAttribute('aria-label')).toBe('Open Garage');
    expect(mark.textContent?.trim()).toBe('');
  });
});

describe('the mark of a garage door', () => {
  it('draws an open garage, never a blind, while it is open', () => {
    expect(iconsOf(drawn(garageDoor(100), null, 'open'))).toEqual([
      drawnIcon('garage-open'),
    ]);
  });

  it('keeps a blind for a cover on a window', () => {
    const blind: Control = {
      ...garageDoor(100),
      key: 'window:w1',
      scope: { type: 'window', id: 'w1' },
    };

    expect(iconsOf(drawn(blind, null, 'open'))).toEqual([drawnIcon('blinds')]);
  });
});

describe('the mark of a door with a lock', () => {
  const rules = controlStyles.cssText.replace(/\s+/g, ' ');

  it('shows a closed padlock on navy while locked, never a quiet dot', () => {
    const mark = drawn(frontDoor('locked'), null, 'shut');

    expect(mark.classList).toContain('locked');
    expect(mark.dataset.tone).toBe('lock');
    expect(mark.classList).not.toContain('dot');
    expect(iconsOf(mark)).toEqual([drawnIcon('lock')]);
    expect(rules).toMatch(
      /\.mark\[data-tone='lock'\] \.disc \{[^}]*background: var\(--ez-lock\)/,
    );
  });

  it('shows an open padlock in the accent while unlocked, even with the door open', () => {
    for (const opening of ['shut', 'open'] as const) {
      const mark = drawn(frontDoor('unlocked'), null, opening);

      expect(mark.classList).toContain('unlocked');
      expect(mark.dataset.tone).toBe('accent');
      expect(iconsOf(mark)).toEqual([drawnIcon('lock-open')]);
    }

    expect(rules).toMatch(
      /\.mark\[data-tone='accent'\] \.disc \{[^}]*background: var\(--ez-accent\)/,
    );
  });

  it('says the state in its name and draws no text', () => {
    const mark = drawn(frontDoor('locked'), null, 'shut');

    expect(mark.getAttribute('aria-label')).toBe('Front door, locked');
    expect(mark.textContent?.trim()).toBe('');
  });
});

describe('the brightness bar of a light sheet', () => {
  it('ends its fill on a line in the text colour, so a near-white lamp still shows its level', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(rules).toMatch(
      /\.level \.bar \.fill \{[^}]*box-shadow: inset -2px 0 0 var\(--ez-text\)/,
    );
  });
});

describe('the mark of a lit lamp', () => {
  it('glows in the colour of its lamp, so a day scene still shows it lit', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');
    const lit =
      /\.mark\[data-tone='lamp'\] \.disc \{([^}]*)\}/.exec(rules)?.[1] ?? '';

    expect(lit).toMatch(/box-shadow:[^;]*0 0 \d+px[^;]*var\(--lamp/);
  });
});

describe('the mark of a plug', () => {
  it('fills when the plug is on', () => {
    expect(drawn(plug(true)).classList).toContain('on');
  });

  it('stays empty when the plug is off', () => {
    expect(drawn(plug(false)).classList).not.toContain('on');
  });

  it('keeps a lamp wired to a switch warm, as a lamp', () => {
    const lamp = drawn({
      ...plug(true),
      key: 'light:fountain',
      scope: { type: 'light', id: 'fountain' },
    });

    expect(lamp.classList).toContain('on');
    expect(lamp.classList).not.toContain('plug');
  });

  it('fills in the accent, never in the warm colour of a lamp', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');

    expect(drawn(plug(true)).dataset.tone).toBe('accent');
    expect(drawn(plug(false)).dataset.tone).toBeUndefined();
    expect(rules).toMatch(
      /\.mark\[data-tone='accent'\] \.disc \{[^}]*background: var\(--ez-accent\)/,
    );
  });
});

function plugSheet(on: boolean): HTMLElement {
  return sheetOf(plug(on));
}

function sheetOf(control: Control, draft: number | null = null): HTMLElement {
  const holder = document.createElement('div');
  const none = (): void => undefined;

  render(
    sheetTemplate(
      {
        control,
        scopeState: {
          scope: control.scope,
          entityIds: control.entityIds,
          states: control.states,
          status: 'live',
          unavailable: false,
          reading: null,
        },
        title: 'Television',
        spot: null,
        phase: null,
        draft,
        lamp: '',
        lampChip: false,
        temperature: null,
        humidity: null,
        devices: [],
        rows: [],
        alerts: [],
      },
      {
        close: none,
        swipe: { down: none, move: none, up: none, cancel: none },
        more: none,
        reach: none,
        act: none,
        toggle: none,
        device: none,
        draft: none,
        brightness: none,
        white: none,
        position: none,
        cover: none,
      },
    ),
    holder,
  );

  return holder;
}

describe('the box of a garage door', () => {
  const words = (control: Control, draft: number | null = null) =>
    sheetOf(control, draft).querySelector('.bar .pct')?.textContent;
  const moving = (state: string, position: number): Control => {
    const door = garageDoor(position);

    return { ...door, states: [{ ...door.states[0], state }] };
  };

  it('reads Closed, Open, Opening or Closing, never a bare percent', () => {
    expect(words(garageDoor(0))).toBe('Closed');
    expect(words(garageDoor(100))).toBe('Open');
    expect(words(moving('opening', 30))).toBe('Opening');
    expect(words(moving('closing', 70))).toBe('Closing');
  });

  it('adds the position as a second value while it is partly open', () => {
    expect(words(garageDoor(40))).toBe('Open · 40%');
    expect(words(garageDoor(0), 40)).toBe('Open · 40%');
    expect(words(garageDoor(40), 0)).toBe('Closed');
  });
});

describe('the sheet of a plug', () => {
  it('says whether it is on or off beside its power button', () => {
    expect(plugSheet(true).querySelector('.power-state')?.textContent).toBe(
      'On',
    );
    expect(plugSheet(false).querySelector('.power-state')?.textContent).toBe(
      'Off',
    );
  });

  it('fills its pressed power button in the accent its mark and room row use', () => {
    const rules = controlStyles.cssText.replace(/\s+/g, ' ');
    const power = plugSheet(true).querySelector('[data-act="power"]');

    expect(power?.classList).toContain('plug');
    expect(power?.getAttribute('aria-pressed')).toBe('true');
    expect(rules).toMatch(
      /\.tb\.plug\[aria-pressed='true'\],[^{]*\{[^}]*background: var\(--ez-accent\)/,
    );
    expect(rules).toMatch(
      /\[data-tone='accent'\] \.lamp-icon \{[^}]*background: var\(--ez-accent\)/,
    );
  });
});

describe('the mark of a linked device', () => {
  function device(
    entityId: string,
    attributes: Record<string, unknown> = {},
  ): Control {
    return {
      kind: 'gadget',
      key: 'prop:thing',
      scope: { type: 'prop', id: 'thing' },
      entityIds: [entityId],
      states: [mockEntityState(entityId, 'on', attributes)],
      name: 'Thing',
      unavailable: false,
    };
  }

  it('draws what the device is', () => {
    const icons = [
      device('media_player.tv'),
      device('media_player.kitchen', { device_class: 'speaker' }),
      device('climate.radiator'),
      device('fan.ceiling'),
      device('camera.porch'),
      device('sensor.lounge', { device_class: 'temperature' }),
      device('sensor.bath', { device_class: 'humidity' }),
      device('sensor.power', { device_class: 'power' }),
      device('binary_sensor.motion', { device_class: 'motion' }),
      device('vacuum.robot'),
      device('scene.evening'),
      device('script.movie_night'),
      device('water_heater.boiler'),
    ].map((control) => markIcon(control, false, null));

    expect(icons).toEqual([
      'tv',
      'speaker',
      'thermometer',
      'fan',
      'camera',
      'thermometer',
      'droplet',
      'gauge',
      'activity',
      'vacuum',
      'sparkles',
      'sparkles',
      'box',
    ]);
  });

  it('keeps the light icon for a device linked to a lamp', () => {
    expect(
      markIcon(
        { ...device('media_player.tv'), scope: { type: 'light', id: 'l' } },
        false,
        null,
      ),
    ).toBe('tv');
    expect(
      markIcon(
        { ...device('sensor.lux'), scope: { type: 'light', id: 'l' } },
        false,
        null,
      ),
    ).toBe('gauge');
  });
});
